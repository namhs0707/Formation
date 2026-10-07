// Temporary in-app accounts for reviewers (part leaders, engineers, supervisors) until company AD sign-in
// is available. Operators never log in. Passwords are kept only as scrypt hashes, sessions only as SHA-256.
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
export const ROLES = ['part_leader', 'engineer', 'supervisor', 'admin'];
export const REVIEWER_ROLES = new Set(ROLES);
const SCRYPT = { N: 16384, r: 8, p: 1, keyLength: 64 };
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const SESSION_IDLE_MINUTES = 30;
const SESSION_MAX_HOURS = 12;
const INACTIVE_DAYS = 90;
export const SESSION_COOKIE = 'fi_session';

function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, SCRYPT.keyLength, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  const [scheme, N, r, p, salt, hash] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
  return timingSafeEqual(actual, expected);
}

// A wrong ID still costs one hash, so response time does not reveal which IDs exist.
const DUMMY_HASH = await hashPassword(randomBytes(12).toString('hex'));

export function checkLoginId(value) {
  const loginId = String(value ?? '').trim();
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(loginId)) fail('ID must be 3-40 letters, numbers, dot, dash or underscore.');
  return loginId;
}

export function checkNewPassword(password, loginId) {
  const text = String(password ?? '');
  if (text.length < 10 || text.length > 128) fail('Password must be 10-128 characters.');
  if (!/[A-Za-z]/.test(text) || !/[0-9]/.test(text)) fail('Password must include letters and numbers.');
  if (loginId && text.toLowerCase().includes(String(loginId).toLowerCase())) fail('Password must not contain the ID.');
  return text;
}

export function temporaryPassword() {
  // Unambiguous characters only, with a guaranteed letter and digit to satisfy the password rule.
  const letters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const all = letters + digits;
  const bytes = randomBytes(12);
  const chars = Array.from(bytes, byte => all[byte % all.length]);
  chars[0] = letters[bytes[0] % letters.length];
  chars[1] = digits[bytes[1] % digits.length];
  return chars.join('');
}

function tokenHash(token) { return createHash('sha256').update(token).digest('hex'); }

export function publicUser(row) {
  return row ? { id: Number(row.id), loginId: row.login_id, displayName: row.display_name, role: row.role,
    mustChangePassword: Boolean(row.must_change_password) } : null;
}

export async function signUp(pool, input, clientIp) {
  const loginId = checkLoginId(input.loginId);
  const displayName = String(input.displayName ?? '').trim();
  if (!displayName || displayName.length > 120) fail('Name is required (max 120 characters).');
  const password = checkNewPassword(input.password, loginId);
  try {
    await pool.query(
      'INSERT INTO formation.app_users (login_id, display_name, password_hash, created_ip) VALUES ($1, $2, $3, $4)',
      [loginId, displayName, await hashPassword(password), clientIp]
    );
  } catch (error) {
    if (error.code === '23505') fail('This ID is already registered.');
    throw error;
  }
}

export async function logIn(pool, input, clientIp) {
  const loginId = String(input.loginId ?? '').trim();
  const password = String(input.password ?? '');
  const result = await pool.query('SELECT * FROM formation.app_users WHERE lower(login_id) = lower($1)', [loginId]);
  const user = result.rows[0];
  if (!user || !user.password_hash) {
    await verifyPassword(password, DUMMY_HASH);
    fail('ID or password is incorrect.', 401);
  }
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    fail('Too many failed attempts. Try again in ' + LOCK_MINUTES + ' minutes or ask the administrator.', 423);
  }
  if (!(await verifyPassword(password, user.password_hash))) {
    const attempts = user.failed_attempts + 1;
    await pool.query(
      'UPDATE formation.app_users SET failed_attempts = CASE WHEN $2::int >= $3::int THEN 0 ELSE $2::int END, ' +
      'locked_until = CASE WHEN $2::int >= $3::int THEN now() + make_interval(mins => $4::int) END WHERE id = $1',
      [user.id, attempts, MAX_FAILED_ATTEMPTS, LOCK_MINUTES]
    );
    if (attempts >= MAX_FAILED_ATTEMPTS) fail('Too many failed attempts. The account is locked for ' + LOCK_MINUTES + ' minutes.', 423);
    fail('ID or password is incorrect.', 401);
  }
  if (user.status === 'pending') fail('Your account is waiting for administrator approval.', 403);
  if (user.status !== 'active') fail('This account is disabled. Ask the administrator.', 403);
  await pool.query('UPDATE formation.app_users SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [user.id]);
  const token = randomBytes(32).toString('base64url');
  await pool.query(
    'INSERT INTO formation.app_sessions (token_hash, user_id, expires_at, client_ip) VALUES ($1, $2, now() + make_interval(hours => $3), $4)',
    [tokenHash(token), user.id, SESSION_MAX_HOURS, clientIp]
  );
  return { token, user: publicUser(user) };
}

// Returns the signed-in user for a session token, extending the idle timer; null when absent or expired.
export async function sessionUser(pool, token) {
  if (!token) return null;
  const result = await pool.query(
    'UPDATE formation.app_sessions s SET last_seen_at = now() FROM formation.app_users u ' +
    'WHERE s.token_hash = $1 AND s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > now() ' +
    'AND s.last_seen_at > now() - make_interval(mins => $2) AND u.status = \'active\' RETURNING u.*',
    [tokenHash(token), SESSION_IDLE_MINUTES]
  );
  return result.rows[0] || null;
}

export async function logOut(pool, token) {
  if (token) await pool.query('UPDATE formation.app_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [tokenHash(token)]);
}

export async function changePassword(pool, user, input, token) {
  if (!(await verifyPassword(String(input.currentPassword ?? ''), user.password_hash))) fail('Current password is incorrect.', 401);
  const password = checkNewPassword(input.newPassword, user.login_id);
  if (await verifyPassword(password, user.password_hash)) fail('Choose a password different from the current one.');
  await pool.query('UPDATE formation.app_users SET password_hash = $2, must_change_password = false WHERE id = $1', [user.id, await hashPassword(password)]);
  // Sign out every other session of this account.
  await pool.query('UPDATE formation.app_sessions SET revoked_at = now() WHERE user_id = $1 AND token_hash <> $2 AND revoked_at IS NULL', [user.id, tokenHash(token)]);
}

// Accounts unused for 90 days are disabled and their password removed; the name stays in review history.
export async function disableInactiveAccounts(pool) {
  const result = await pool.query(
    'UPDATE formation.app_users SET status = \'disabled\', password_hash = NULL, must_change_password = false, ' +
    'disabled_at = now(), disabled_reason = $2 ' +
    'WHERE status <> \'disabled\' AND role IS DISTINCT FROM \'admin\' AND coalesce(last_login_at, approved_at, created_at) < now() - make_interval(days => $1) RETURNING id',
    [INACTIVE_DAYS, 'No sign-in for ' + INACTIVE_DAYS + ' days']
  );
  if (result.rows.length) {
    await pool.query('UPDATE formation.app_sessions SET revoked_at = now() WHERE user_id = ANY($1::bigint[]) AND revoked_at IS NULL', [result.rows.map(row => row.id)]);
  }
  return result.rows.length;
}

export async function listUsers(pool) {
  const result = await pool.query(
    'SELECT u.id, u.login_id, u.display_name, u.role, u.status, u.must_change_password, u.created_at, host(u.created_ip) AS created_ip, ' +
    'u.approved_at, a.display_name AS approved_by_name, u.last_login_at, u.locked_until, u.disabled_at, u.disabled_reason ' +
    'FROM formation.app_users u LEFT JOIN formation.app_users a ON a.id = u.approved_by ORDER BY (u.status = \'pending\') DESC, u.display_name'
  );
  return result.rows.map(row => ({
    id: Number(row.id), loginId: row.login_id, displayName: row.display_name, role: row.role, status: row.status,
    mustChangePassword: row.must_change_password, createdAt: row.created_at, createdIp: row.created_ip,
    approvedAt: row.approved_at, approvedBy: row.approved_by_name, lastLoginAt: row.last_login_at,
    locked: Boolean(row.locked_until && new Date(row.locked_until) > new Date()),
    disabledAt: row.disabled_at, disabledReason: row.disabled_reason
  }));
}

// Administrator actions. Returns a temporary password when one was issued, to be shown to the admin once.
export async function manageUser(pool, admin, userId, input) {
  const action = String(input.action || '');
  const target = (await pool.query('SELECT * FROM formation.app_users WHERE id = $1', [userId])).rows[0];
  if (!target) fail('User not found.', 404);
  if (Number(target.id) === Number(admin.id) && ['disable', 'role'].includes(action)) fail('You cannot change your own account here.');
  const role = input.role;
  if (['approve', 'role'].includes(action) && !ROLES.includes(role)) fail('Choose a role.');
  if (action === 'approve') {
    if (target.status !== 'pending') fail('Only pending sign-ups can be approved.');
    await pool.query('UPDATE formation.app_users SET status = \'active\', role = $2, approved_at = now(), approved_by = $3 WHERE id = $1', [target.id, role, admin.id]);
    return {};
  }
  if (action === 'role') {
    if (target.status === 'pending') fail('Approve the sign-up first.');
    await pool.query('UPDATE formation.app_users SET role = $2 WHERE id = $1', [target.id, role]);
    return {};
  }
  if (action === 'disable') {
    await pool.query('UPDATE formation.app_users SET status = \'disabled\', disabled_at = now(), disabled_reason = $2 WHERE id = $1', [target.id, 'Disabled by ' + admin.display_name]);
    await pool.query('UPDATE formation.app_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [target.id]);
    return {};
  }
  if (action === 'enable' || action === 'reset-password') {
    if (action === 'enable' && !target.role) fail('Approve the sign-up first.');
    if (action === 'reset-password' && target.status === 'pending') fail('Approve the sign-up first.');
    const password = temporaryPassword();
    await pool.query(
      'UPDATE formation.app_users SET password_hash = $2, must_change_password = true, failed_attempts = 0, locked_until = NULL, ' +
      'status = CASE WHEN $3 THEN \'active\' ELSE status END, disabled_at = CASE WHEN $3 THEN NULL ELSE disabled_at END, ' +
      'disabled_reason = CASE WHEN $3 THEN NULL ELSE disabled_reason END, last_login_at = CASE WHEN $3 THEN now() ELSE last_login_at END WHERE id = $1',
      [target.id, await hashPassword(password), action === 'enable']
    );
    await pool.query('UPDATE formation.app_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [target.id]);
    return { temporaryPassword: password };
  }
  fail('Unknown action.');
}

export function sessionCookie(token, secure, maxAgeSeconds = SESSION_MAX_HOURS * 3600) {
  return SESSION_COOKIE + '=' + token + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + maxAgeSeconds + (secure ? '; Secure' : '');
}
