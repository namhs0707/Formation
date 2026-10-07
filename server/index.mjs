import http from 'node:http';
import { isIP } from 'node:net';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { saveInspection } from './records.mjs';
import { readInspection, readPhoto } from './read.mjs';

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

function sendJson(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
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
    if (url.pathname === '/api/inspections' && request.method === 'POST') {
      const input = await readJson(request);
      const result = await saveInspection(pool, input, clientIpOf(request));
      sendJson(response, 201, { result: 'success', process: input.process, ...result });
      return;
    }
    if (url.pathname === '/api/inspections' && request.method === 'GET') {
      const result = await readInspection(pool, url.searchParams);
      sendJson(response, 200, result);
      return;
    }
    const photoMatch = url.pathname.match(/^\/api\/photos\/(\d+)$/);
    if (photoMatch && request.method === 'GET') {
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