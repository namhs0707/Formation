import http from 'node:http';
import { isIP } from 'node:net';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { saveInspection } from './records.mjs';
import { readInspection, readPhoto } from './read.mjs';
import { SESSION_COOKIE, REVIEWER_ROLES, publicUser, signUp, logIn, logOut, sessionUser, peekSessionUser, changePassword,
  runAccountMaintenance, listUsers, manageUser, usersCsv, accountEventsCsv, sessionCookie } from './auth.mjs';
import { reviewDetail, submitReview } from './reviews.mjs';
import { readSummary } from './summary.mjs';
import { readStatus } from './status.mjs';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const host = process.env.FORMATION_HOST || '127.0.0.1';
const port = Number(process.env.FORMATION_PORT || 3000);
if (!process.env.PGPASSWORD) {
  throw new Error('PGPASSWORD is required. Use scripts/start-local-server.ps1 or set VM credentials.');
}
const pool = new pg.Pool({
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'formation_inspection',
  user: process.env.PGUSER || 'formation_app',
  password: process.env.PGPASSWORD,
  max: 10,
  connectionTimeoutMillis: 5000
});
await pool.query('SELECT 1');
// Login sends passwords, so it is only offered over HTTPS (IIS in front) unless explicitly allowed for testing.
const allowHttpLogin = process.env.FORMATION_ALLOW_HTTP_LOGIN === '1';
await runAccountMaintenance(pool);
setInterval(() => runAccountMaintenance(pool).catch(error => console.error('Account upkeep failed:', error)), 60 * 60 * 1000).unref();

// Account management opens only from registered administrator PCs (HQ.S1.05: extra check for admin pages).
// FORMATION_ADMIN_IPS lists IPv4 addresses or ranges such as 10.1.2.30,10.1.3.0/24. The VM itself always counts.
function ipv4Number(address) { return address.split('.').reduce((total, part) => total * 256 + Number(part), 0) >>> 0; }
const adminNetworks = String(process.env.FORMATION_ADMIN_IPS || '').split(',').map(entry => entry.trim()).filter(Boolean).map(entry => {
  const [address, bits = '32'] = entry.split('/');
  if (isIP(address) !== 4 || !/^\d+$/.test(bits) || Number(bits) > 32) throw new Error('Invalid FORMATION_ADMIN_IPS entry: ' + entry);
  return { base: ipv4Number(address), mask: Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0 };
});
function adminIpAllowed(ip) {
  if (!ip) return false;
  if (ip === '127.0.0.1' || ip === '::1') return true;
  if (isIP(ip) !== 4) return false;
  const value = ipv4Number(ip);
  return adminNetworks.some(network => ((value & network.mask) >>> 0) === ((network.base & network.mask) >>> 0));
}

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  });
  response.end(JSON.stringify(body));
}

// The submitting device's IP. Behind a reverse proxy on this VM (IIS for HTTPS), the proxy connects from
// loopback and passes the real address in X-Forwarded-For; that header is ignored from any other source.
function clientIpOf(request) {
  const remote = String(request.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (remote === '127.0.0.1' || remote === '::1') {
    const forwarded = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim().replace(/^::ffff:/, '');
    if (isIP(forwarded)) return forwarded;
  }
  return isIP(remote) ? remote : null;
}

function isLoopback(request) {
  const remote = String(request.socket.remoteAddress || '').replace(/^::ffff:/, '');
  return remote === '127.0.0.1' || remote === '::1';
}

// True when the browser reached us over HTTPS through the local reverse proxy.
function isSecure(request) {
  return isLoopback(request) && String(request.headers['x-forwarded-proto'] || '').toLowerCase() === 'https';
}

function sessionToken(request) {
  const match = String(request.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + SESSION_COOKIE + '=([A-Za-z0-9_-]+)'));
  return match ? match[1] : null;
}

function fail(message, status) { const error = new Error(message); error.status = status; throw error; }

// Account and review changes must come from this site's own pages as JSON, which blocks cross-site form posts.
function checkSameOrigin(request) {
  if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) fail('JSON request required.', 415);
  const origin = request.headers.origin;
  if (origin && new URL(origin).host !== request.headers.host) fail('Cross-site request blocked.', 403);
}

// At most 20 sign-in or sign-up attempts per device per 10 minutes, on top of the per-account lockout.
const attemptLog = new Map();
function limitAttempts(ip) {
  const now = Date.now();
  const recent = (attemptLog.get(ip) || []).filter(time => now - time < 10 * 60 * 1000);
  if (recent.length >= 20) fail('Too many attempts from this device. Wait 10 minutes.', 429);
  recent.push(now);
  attemptLog.set(ip, recent);
}

async function requireUser(request, roles) {
  const user = await sessionUser(pool, sessionToken(request));
  request.logUser = user;
  if (!user) fail('Sign in first.', 401);
  if (roles && !roles.has(user.role)) fail('Your role cannot do this.', 403);
  return user;
}

async function requireAdmin(request) {
  const admin = await requireUser(request, new Set(['admin']));
  if (!adminIpAllowed(clientIpOf(request))) {
    request.logEvent = 'admin_denied';
    fail('Account management opens only from a registered administrator PC.', 403);
  }
  if (admin.must_change_password) fail('Change your password first.', 403);
  return admin;
}

// Access log (HQ.S1.05, kept 3 years): every page load and API call with account, device IP, time and menu.
// Written after the response is sent, so a logging problem never blocks the user.
function menuOf(url) {
  const params = url.searchParams;
  const detail = params.get('process') || params.get('view') || params.get('type');
  const section = url.pathname.replace(/^\/api\//, '').replace(/\/\d+$/, '');
  return (detail ? section + ':' + detail : section).slice(0, 60);
}
function logAccess(request, response, url) {
  response.on('finish', async () => {
    try {
      let user = request.logUser;
      if (user === undefined) user = await peekSessionUser(pool, sessionToken(request));
      const loginId = user?.login_id ?? request.logLoginId ?? null;
      await pool.query(
        'INSERT INTO formation.access_log (user_id, login_id, client_ip, method, path, menu, event, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [user?.id ?? null, loginId ? String(loginId).slice(0, 40) : null, clientIpOf(request),
          request.method.slice(0, 8), url.pathname.slice(0, 200), menuOf(url), request.logEvent || 'request', response.statusCode]
      );
    } catch (error) {
      console.error('Access log failed:', error.message);
    }
  });
}

async function readJson(request) {
  const maxBytes = 12 * 1024 * 1024;
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      const error = new Error('Request is too large.');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Invalid JSON request.');
    error.status = 400;
    throw error;
  }
}

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
};
const publicFiles = new Set([
  '/formation.html',
  '/degas-defect-map.jpg',
  '/jig-formation-defect-map.jpg',
  '/ip-check-image1.png',
  '/ip-check-image2.png',
  '/ip-check-image3.png',
  '/conductive-degas-ir.jpg',
  '/conductive-eol-ir.jpg',
  '/conductive-eol-iv.jpg'
]);

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname.startsWith('/api/') || url.pathname === '/formation.html') logAccess(request, response, url);
    if (url.pathname === '/') {
      response.writeHead(302, { Location: '/formation.html' });
      response.end();
      return;
    }
    if (url.pathname === '/api/health' && request.method === 'GET') {
      await pool.query('SELECT 1');
      sendJson(response, 200, { status: 'ok', database: 'connected' });
      return;
    }
    if (url.pathname.startsWith('/api/auth/') || url.pathname.startsWith('/api/admin/') || url.pathname === '/api/reviews') {
      if (request.method === 'POST') checkSameOrigin(request);
      const clientIp = clientIpOf(request);
      const loginAvailable = allowHttpLogin || isSecure(request);
      if (url.pathname === '/api/auth/me' && request.method === 'GET') {
        const user = await sessionUser(pool, sessionToken(request));
        request.logUser = user;
        return sendJson(response, 200, { loginAvailable, user: publicUser(user),
          canManageAccounts: Boolean(user && user.role === 'admin' && adminIpAllowed(clientIp)) });
      }
      if (url.pathname === '/api/auth/signup' && request.method === 'POST') {
        if (!loginAvailable) fail('Sign-up is available only over HTTPS.', 403);
        limitAttempts(clientIp);
        await signUp(pool, await readJson(request), clientIp);
        return sendJson(response, 201, { result: 'success', message: 'Sign-up received. Wait for administrator approval.' });
      }
      if (url.pathname === '/api/auth/login' && request.method === 'POST') {
        if (!loginAvailable) fail('Sign-in is available only over HTTPS.', 403);
        limitAttempts(clientIp);
        const input = await readJson(request);
        request.logEvent = 'sign_in_failed';
        request.logLoginId = String(input.loginId ?? '').trim();
        request.logUser = null;
        const session = await logIn(pool, input, clientIp);
        request.logEvent = 'sign_in';
        request.logUser = { id: session.user.id, login_id: session.user.loginId };
        return sendJson(response, 200, { result: 'success', user: session.user }, { 'Set-Cookie': sessionCookie(session.token, isSecure(request)) });
      }
      if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
        request.logEvent = 'sign_out';
        request.logUser = await logOut(pool, sessionToken(request));
        return sendJson(response, 200, { result: 'success' }, { 'Set-Cookie': sessionCookie('', isSecure(request), 0) });
      }
      if (url.pathname === '/api/auth/password' && request.method === 'POST') {
        const user = await requireUser(request);
        await changePassword(pool, user, await readJson(request), sessionToken(request), clientIp);
        return sendJson(response, 200, { result: 'success' });
      }
      if (url.pathname === '/api/admin/users' && request.method === 'GET') {
        await requireAdmin(request);
        return sendJson(response, 200, { result: 'success', users: await listUsers(pool) });
      }
      const csvFiles = { '/api/admin/users.csv': ['accounts', usersCsv], '/api/admin/account-events.csv': ['account-history', accountEventsCsv] };
      if (csvFiles[url.pathname] && request.method === 'GET') {
        await requireAdmin(request);
        const [name, build] = csvFiles[url.pathname];
        const body = await build(pool);
        response.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="formation-' + name + '-' + new Date().toISOString().slice(0, 10) + '.csv"',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff'
        });
        response.end(body);
        return;
      }
      const userMatch = url.pathname.match(/^\/api\/admin\/users\/(\d+)$/);
      if (userMatch && request.method === 'POST') {
        const admin = await requireAdmin(request);
        return sendJson(response, 200, { result: 'success', ...(await manageUser(pool, admin, userMatch[1], await readJson(request), clientIp)) });
      }
      if (url.pathname === '/api/reviews' && request.method === 'GET') {
        await requireUser(request, REVIEWER_ROLES);
        return sendJson(response, 200, { result: 'success', ...(await reviewDetail(pool, url.searchParams.get('type'), url.searchParams.get('id'))) });
      }
      if (url.pathname === '/api/reviews' && request.method === 'POST') {
        const user = await requireUser(request, REVIEWER_ROLES);
        return sendJson(response, 200, { result: 'success', ...(await submitReview(pool, user, await readJson(request), clientIp)) });
      }
      fail('Not found.', 404);
    }
    if (url.pathname === '/api/inspections' && request.method === 'POST') {
      const input = await readJson(request);
      if (input && input.defectPhotoData) request.logEvent = 'photo_upload';
      const result = await saveInspection(pool, input, clientIpOf(request));
      sendJson(response, 201, { result: 'success', process: input.process, ...result });
      return;
    }
    if (url.pathname === '/api/summary' && request.method === 'GET') {
      sendJson(response, 200, { result: 'success', ...(await readSummary(pool)) });
      return;
    }
    if (url.pathname === '/api/status' && request.method === 'GET') {
      sendJson(response, 200, { result: 'success', ...(await readStatus(pool, url.searchParams.get('view'))) });
      return;
    }
    if (url.pathname === '/api/inspections' && request.method === 'GET') {
      const result = await readInspection(pool, url.searchParams);
      sendJson(response, 200, result);
      return;
    }
    const photoMatch = url.pathname.match(/^\/api\/photos\/(\d+)$/);
    if (photoMatch && request.method === 'GET') {
      request.logEvent = 'photo_view';
      const photo = await readPhoto(pool, photoMatch[1]);
      if (!photo) return sendJson(response, 404, { result: 'error', message: 'Photo not found.' });
      response.writeHead(200, {
        'Content-Type': photo.mime_type,
        'Content-Length': photo.image_data.length,
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff'
      });
      response.end(photo.image_data);
      return;
    }
    if (request.method === 'GET' && publicFiles.has(url.pathname)) {
      const path = join(root, url.pathname.slice(1));
      const extension = path.slice(path.lastIndexOf('.')).toLowerCase();
      const file = await readFile(path);
      response.writeHead(200, {
        'Content-Type': contentTypes[extension] || 'application/octet-stream',
        'Content-Length': file.length,
        'X-Content-Type-Options': 'nosniff'
      });
      response.end(file);
      return;
    }
    sendJson(response, 404, { result: 'error', message: 'Not found.' });
  } catch (error) {
    const status = error.status || (error.code?.startsWith('23') ? 400 : 500);
    if (status === 500) console.error('Request failed:', error);
    sendJson(response, status, {
      result: 'error',
      message: status === 500 ? 'Database request failed. Contact the administrator.' : error.message
    });
  }
});
server.listen(port, host, () => console.log('Formation server ready at http://' + host + ':' + port));
process.on('SIGINT', async () => { server.close(); await pool.end(); });