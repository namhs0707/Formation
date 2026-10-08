// In-app accounts for reviewers (part leaders, engineers, supervisors) until company AD sign-in is available,
// following the HQ.S1.05 access-control standard for systems without SSO. Operators never log in.
// Passwords are kept only as scrypt hashes, sessions only as SHA-256. Every account change is added to
// formation.account_events, which the app can add to but not change.
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
export const ACCOUNT_RULES = {
  passwordMaxAgeDays: 90,
  inactiveDisableDays: 60,
  inactiveDeleteDays: 180,
  expiryWarningDays: 14
};
export const SESSION_COOKIE = 'fi_session';
const SYSTEM = { id: null, display_name: 'System' };

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
  if (/^deleted-/i.test(loginId)) fail('This ID is reserved.');
  return loginId;
}

export function checkNewPassword(password, loginId) {
  const text = String(password ?? '');
  if (text.length < 10 || text.length > 128) fail('Password must be 10-128 characters.');
  if (!/[A-Za-z]/.test(text) || !/[0-9]/.test(text)) fail('Password must include letters and numbers.');
  if (loginId && text.toLowerCase().includes(String(loginId).toLowerCase())) fail('Password must not contain the ID.');
  return text;
}

// Account dates are plain YYYY-MM-DD in the factory's own calendar (the server's local time zone).
const pad = number => String(number).padStart(2, '0');
const localDate = date => date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
export const todayText = () => localDate(new Date());
function checkDate(value, label) {
  const text = String(value ?? '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const date = match && new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (!date || localDate(date) !== text) fail('Enter a valid ' + label + '.');
  return text;
}
function addDays(text, days) {
  const [year, month, day] = text.split('-').map(Number);
  return localDate(new Date(year, month - 1, day + days));
}
// The last allowed day of a period starting on `from`: one year counting both ends.
export function lastPeriodDay(from) {
  const [year, month, day] = from.split('-').map(Number);
  return localDate(new Date(year + 1, month - 1, day - 1));
}
function checkPeriod(from, until) {
  if (until < from) fail('The end date must be on or after the start date.');
  if (until > lastPeriodDay(from)) fail('An account can be used for at most one year.');
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
// pg returns DATE columns as local-midnight Date objects.
const dateText = value => value instanceof Date ? localDate(value) : value ? String(value).slice(0, 10) : null;

export async function recordAccountEvent(db, target, action, actor, details = {}, clientIp = null) {
  await db.query(
    'INSERT INTO formation.account_events (user_id, login_id, display_name, action, actor_id, actor_name, details, client_ip) ' +
    'VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)',
    [target.id, target.login_id, target.display_name, action, actor.id, actor.display_name, JSON.stringify(details), clientIp]
  );
}

export function publicUser(row) {
  if (!row) return null;
  const validUntil = dateText(row.valid_until);
  return { id: Number(row.id), loginId: row.login_id, displayName: row.display_name, role: row.role,
    mustChangePassword: Boolean(row.must_change_password), passwordExpired: Boolean(row.password_expired),
    validUntil, expiresSoon: Boolean(validUntil && validUntil <= addDays(todayText(), ACCOUNT_RULES.expiryWarningDays)) };
}

export async function signUp(pool, input, clientIp) {
  const loginId = checkLoginId(input.loginId);
  const displayName = String(input.displayName ?? '').trim();
  if (!displayName || displayName.length > 120) fail('Name is required (max 120 characters).');
  const reason = String(input.reason ?? '').trim();
  if (!reason || reason.length > 500) fail('Enter why you need an account (max 500 characters).');
  const today = todayText();
  const validFrom = checkDate(input.validFrom || today, 'start date');
  if (validFrom < today) fail('The start date cannot be in the past.');
  const validUntil = checkDate(input.validUntil || lastPeriodDay(validFrom), 'end date');
  checkPeriod(validFrom, validUntil);
  const password = checkNewPassword(input.password, loginId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const created = await client.query(
      'INSERT INTO formation.app_users (login_id, display_name, password_hash, password_changed_at, created_ip, valid_from, valid_until, request_reason) ' +
      'VALUES ($1, $2, $3, now(), $4, $5, $6, $7) RETURNING *',
      [loginId, displayName, await hashPassword(password), clientIp, validFrom, validUntil, reason]
    );
    const user = created.rows[0];
    await recordAccountEvent(client, user, 'request', user, { validFrom, validUntil, reason }, clientIp);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') fail('This ID is already registered.');
    throw error;
  } finally { client.release(); }
}

export async function logIn(pool, input, clientIp) {
  const loginId = String(input.loginId ?? '').trim();
  const password = String(input.password ?? '');
  const result = await pool.query(
    'SELECT *, password_changed_at < now() - make_interval(days => $2) AS password_expired ' +
    'FROM formation.app_users WHERE lower(login_id) = lower($1) AND status <> \'deleted\'',
    [loginId, ACCOUNT_RULES.passwordMaxAgeDays]
  );
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
  const validUntil = dateText(user.valid_until);
  if (user.status === 'active' && validUntil && validUntil < todayText()) {
    await expireAccounts(pool);
    fail('Your account period ended on ' + validUntil + '. Ask the administrator to extend it.', 403);
  }
  if (user.status !== 'active') fail('This account is disabled. Ask the administrator.', 403);
  const validFrom = dateText(user.valid_from);
  if (validFrom && validFrom > todayText()) fail('Your account can be used from ' + validFrom + '.', 403);
  // A password older than 90 days must be changed before anything else, the same way as a temporary one.
  await pool.query(
    'UPDATE formation.app_users SET failed_attempts = 0, locked_until = NULL, last_login_at = now(), ' +
    'must_change_password = must_change_password OR $2 WHERE id = $1',
    [user.id, Boolean(user.password_expired)]
  );
  const token = randomBytes(32).toString('base64url');
  await pool.query(
    'INSERT INTO formation.app_sessions (token_hash, user_id, expires_at, client_ip) VALUES ($1, $2, now() + make_interval(hours => $3), $4)',
    [tokenHash(token), user.id, SESSION_MAX_HOURS, clientIp]
  );
  return { token, user: publicUser({ ...user, must_change_password: user.must_change_password || user.password_expired }) };
}

const SESSION_USER_FILTER = 'AND s.revoked_at IS NULL AND s.expires_at > now() AND s.last_seen_at > now() - make_interval(mins => $2) ' +
  'AND u.status = \'active\' AND (u.valid_until IS NULL OR u.valid_until >= current_date)';

// Returns the signed-in user for a session token, extending the idle timer; null when absent or expired.
export async function sessionUser(pool, token) {
  if (!token) return null;
  const result = await pool.query(
    'UPDATE formation.app_sessions s SET last_seen_at = now() FROM formation.app_users u ' +
    'WHERE s.token_hash = $1 AND s.user_id = u.id ' + SESSION_USER_FILTER +
    ' RETURNING u.*, u.password_changed_at < now() - make_interval(days => $3) AS password_expired',
    [tokenHash(token), SESSION_IDLE_MINUTES, ACCOUNT_RULES.passwordMaxAgeDays]
  );
  return result.rows[0] || null;
}

// The same check without extending the session, for the access log.
export async function peekSessionUser(pool, token) {
  if (!token) return null;
  const result = await pool.query(
    'SELECT u.id, u.login_id FROM formation.app_sessions s JOIN formation.app_users u ON u.id = s.user_id ' +
    'WHERE s.token_hash = $1 ' + SESSION_USER_FILTER,
    [tokenHash(token), SESSION_IDLE_MINUTES]
  );
  return result.rows[0] || null;
}

export async function logOut(pool, token) {
  if (!token) return null;
  const result = await pool.query(
    'UPDATE formation.app_sessions s SET revoked_at = now() FROM formation.app_users u ' +
    'WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND u.id = s.user_id RETURNING u.id, u.login_id',
    [tokenHash(token)]
  );
  return result.rows[0] || null;
}

export async function changePassword(pool, user, input, token, clientIp) {
  if (!(await verifyPassword(String(input.currentPassword ?? ''), user.password_hash))) fail('Current password is incorrect.', 401);
  const password = checkNewPassword(input.newPassword, user.login_id);
  if (await verifyPassword(password, user.password_hash)) fail('Choose a password different from the current one.');
  await pool.query(
    'UPDATE formation.app_users SET password_hash = $2, must_change_password = false, password_changed_at = now() WHERE id = $1',
    [user.id, await hashPassword(password)]
  );
  await recordAccountEvent(pool, user, 'password_change', user, {}, clientIp);
  // Sign out every other session of this account.
  await pool.query('UPDATE formation.app_sessions SET revoked_at = now() WHERE user_id = $1 AND token_hash <> $2 AND revoked_at IS NULL', [user.id, tokenHash(token)]);
}

async function revokeSessions(db, ids) {
  if (ids.length) await db.query('UPDATE formation.app_sessions SET revoked_at = now() WHERE user_id = ANY($1::bigint[]) AND revoked_at IS NULL', [ids]);
}

// Accounts past their end date are disabled and signed out.
async function expireAccounts(pool) {
  const result = await pool.query(
    'UPDATE formation.app_users SET status = \'disabled\', disabled_at = now(), disabled_reason = \'Account period ended\' ' +
    'WHERE status IN (\'active\', \'pending\') AND valid_until < current_date RETURNING *'
  );
  for (const user of result.rows) await recordAccountEvent(pool, user, 'expire', SYSTEM, { validUntil: dateText(user.valid_until) });
  await revokeSessions(pool, result.rows.map(row => row.id));
  return result.rows.length;
}

// Account upkeep, run at start-up and hourly: end-of-period, 60 days unused -> disabled and password removed,
// 180 days unused -> deleted. Deletion clears the ID, name, password and request details from the account;
// the name already copied into review history and account_events stays. Logs past retention are removed.
export async function runAccountMaintenance(pool) {
  const expired = await expireAccounts(pool);
  const lastUse = 'coalesce(last_login_at, approved_at, created_at)';
  const disabled = await pool.query(
    'UPDATE formation.app_users SET status = \'disabled\', password_hash = NULL, must_change_password = false, ' +
    'disabled_at = now(), disabled_reason = $2 WHERE status IN (\'active\', \'pending\') AND ' + lastUse + ' < now() - make_interval(days => $1) RETURNING *',
    [ACCOUNT_RULES.inactiveDisableDays, 'No sign-in for ' + ACCOUNT_RULES.inactiveDisableDays + ' days']
  );
  for (const user of disabled.rows) await recordAccountEvent(pool, user, 'inactive_disable', SYSTEM, { days: ACCOUNT_RULES.inactiveDisableDays });
  await revokeSessions(pool, disabled.rows.map(row => row.id));
  const doomed = await pool.query(
    'SELECT * FROM formation.app_users WHERE status = \'disabled\' AND ' + lastUse + ' < now() - make_interval(days => $1)',
    [ACCOUNT_RULES.inactiveDeleteDays]
  );
  for (const user of doomed.rows) {
    await recordAccountEvent(pool, user, 'delete', SYSTEM, { days: ACCOUNT_RULES.inactiveDeleteDays });
    await pool.query(
      'UPDATE formation.app_users SET status = \'deleted\', login_id = \'deleted-\' || id, display_name = \'Deleted user\', ' +
      'password_hash = NULL, must_change_password = false, created_ip = NULL, request_reason = NULL, deleted_at = now() WHERE id = $1',
      [user.id]
    );
  }
  const purged = (await pool.query('SELECT formation.purge_expired_logs() AS count')).rows[0].count;
  return { expired, disabled: disabled.rows.length, deleted: doomed.rows.length, purgedLogs: purged };
}

export async function listUsers(pool) {
  const result = await pool.query(
    'SELECT u.*, host(u.created_ip) AS created_ip_text, a.display_name AS approved_by_name ' +
    'FROM formation.app_users u LEFT JOIN formation.app_users a ON a.id = u.approved_by ' +
    'WHERE u.status <> \'deleted\' ORDER BY (u.status = \'pending\') DESC, u.display_name'
  );
  return result.rows.map(row => ({
    id: Number(row.id), loginId: row.login_id, displayName: row.display_name, role: row.role, status: row.status,
    mustChangePassword: row.must_change_password, createdAt: row.created_at, createdIp: row.created_ip_text,
    approvedAt: row.approved_at, approvedBy: row.approved_by_name, lastLoginAt: row.last_login_at,
    locked: Boolean(row.locked_until && new Date(row.locked_until) > new Date()),
    disabledAt: row.disabled_at, disabledReason: row.disabled_reason,
    validFrom: dateText(row.valid_from), validUntil: dateText(row.valid_until), requestReason: row.request_reason,
    passwordChangedAt: row.password_changed_at
  }));
}

// Administrator actions. Returns a temporary password when one was issued, to be shown to the admin once.
export async function manageUser(pool, admin, userId, input, clientIp) {
  const action = String(input.action || '');
  const target = (await pool.query('SELECT * FROM formation.app_users WHERE id = $1 AND status <> \'deleted\'', [userId])).rows[0];
  if (!target) fail('User not found.', 404);
  // Extending your own period would approve yourself; another administrator or the VM setup script does it.
  if (Number(target.id) === Number(admin.id) && ['disable', 'role', 'extend'].includes(action)) fail('You cannot change your own account here.');
  const event = (name, details = {}) => recordAccountEvent(pool, target, name, admin, details, clientIp);
  const role = input.role;
  if (['approve', 'role'].includes(action) && !ROLES.includes(role)) fail('Choose a role.');
  if (action === 'approve') {
    if (target.status !== 'pending') fail('Only pending sign-ups can be approved.');
    await pool.query(
      'UPDATE formation.app_users SET status = \'active\', role = $2, approved_at = now(), approved_by = $3 WHERE id = $1',
      [target.id, role, admin.id]
    );
    await event('approve', { role });
    return {};
  }
  if (action === 'role') {
    if (target.status === 'pending') fail('Approve the sign-up first.');
    await pool.query('UPDATE formation.app_users SET role = $2 WHERE id = $1', [target.id, role]);
    await event('role_change', { from: target.role, to: role });
    return {};
  }
  if (action === 'disable') {
    const rejecting = target.status === 'pending';
    await pool.query('UPDATE formation.app_users SET status = \'disabled\', disabled_at = now(), disabled_reason = $2 WHERE id = $1',
      [target.id, (rejecting ? 'Request rejected by ' : 'Disabled by ') + admin.display_name]);
    await revokeSessions(pool, [target.id]);
    await event(rejecting ? 'reject' : 'disable');
    return {};
  }
  if (action === 'extend') {
    if (target.status === 'pending') fail('Approve the sign-up first.');
    // A renewal is a new period of at most one year starting today.
    const today = todayText();
    const validUntil = checkDate(input.validUntil, 'end date');
    if (validUntil < today) fail('The new end date cannot be in the past.');
    checkPeriod(today, validUntil);
    await pool.query('UPDATE formation.app_users SET valid_from = $2, valid_until = $3 WHERE id = $1', [target.id, today, validUntil]);
    await event('extend', { from: dateText(target.valid_until), to: validUntil });
    return {};
  }
  if (action === 'enable' || action === 'reset-password') {
    if (action === 'enable' && !target.role) fail('Approve the sign-up first.');
    if (action === 'enable' && dateText(target.valid_until) < todayText()) fail('The account period has ended. Extend it first.');
    if (action === 'reset-password' && target.status === 'pending') fail('Approve the sign-up first.');
    const password = temporaryPassword();
    await pool.query(
      'UPDATE formation.app_users SET password_hash = $2, must_change_password = true, password_changed_at = now(), failed_attempts = 0, locked_until = NULL, ' +
      'status = CASE WHEN $3 THEN \'active\' ELSE status END, disabled_at = CASE WHEN $3 THEN NULL ELSE disabled_at END, ' +
      'disabled_reason = CASE WHEN $3 THEN NULL ELSE disabled_reason END, last_login_at = CASE WHEN $3 THEN now() ELSE last_login_at END WHERE id = $1',
      [target.id, await hashPassword(password), action === 'enable']
    );
    await revokeSessions(pool, [target.id]);
    await event(action === 'enable' ? 'enable' : 'password_reset');
    return { temporaryPassword: password };
  }
  fail('Unknown action.');
}

// CSV files for the yearly access review (accounts) and the audit trail (account history). Excel opens UTF-8 with a BOM.
function csv(rows) {
  const cell = value => {
    const text = value == null ? '' : value instanceof Date ? value.toISOString() : String(value);
    // A leading = + - @ would run as a formula in Excel.
    const safe = /^[=+\-@]/.test(text) ? "'" + text : text;
    return /[",\r\n]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
  };
  return '﻿' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}

export async function usersCsv(pool) {
  const users = await listUsers(pool);
  return csv([
    ['ID', 'Name', 'Role', 'Status', 'Valid from', 'Valid until', 'Request reason', 'Approved by', 'Approved at',
      'Last sign-in', 'Password changed', 'Disabled reason'],
    ...users.map(user => [user.loginId, user.displayName, user.role, user.status, user.validFrom, user.validUntil, user.requestReason,
      user.approvedBy, user.approvedAt, user.lastLoginAt, user.passwordChangedAt, user.disabledReason])
  ]);
}

export async function accountEventsCsv(pool) {
  const result = await pool.query(
    'SELECT recorded_at, login_id, display_name, action, actor_name, details, host(client_ip) AS ip FROM formation.account_events ORDER BY recorded_at, id'
  );
  return csv([
    ['Time', 'ID', 'Name', 'Action', 'By', 'Details', 'IP'],
    ...result.rows.map(row => [row.recorded_at, row.login_id, row.display_name, row.action, row.actor_name,
      Object.keys(row.details).length ? JSON.stringify(row.details) : '', row.ip])
  ]);
}

export function sessionCookie(token, secure, maxAgeSeconds = SESSION_MAX_HOURS * 3600) {
  return SESSION_COOKIE + '=' + token + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + maxAgeSeconds + (secure ? '; Secure' : '');
}
