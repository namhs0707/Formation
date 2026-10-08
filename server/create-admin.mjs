// Creates the administrator account, or resets an existing account to administrator with a new password.
// Run on the VM through scripts/create-admin.ps1; the web app never creates administrators.
// The account gets a fresh one-year period, and the setup is added to the account history.
import pg from 'pg';
import { checkLoginId, checkNewPassword, hashPassword, lastPeriodDay, recordAccountEvent, todayText } from './auth.mjs';

const loginId = checkLoginId(process.env.FORMATION_ADMIN_ID);
const displayName = String(process.env.FORMATION_ADMIN_NAME || '').trim();
if (!displayName || displayName.length > 120) throw new Error('Name is required (max 120 characters).');
const passwordHash = await hashPassword(checkNewPassword(process.env.FORMATION_ADMIN_PASSWORD, loginId));
const validFrom = todayText();
const validUntil = lastPeriodDay(validFrom);

const client = new pg.Client({
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'formation_inspection',
  user: process.env.PGUSER || 'formation_app',
  password: process.env.PGPASSWORD
});
await client.connect();
try {
  await client.query('BEGIN');
  // last_login_at is reset too, so the hourly upkeep does not disable a re-enabled account straight away.
  const updated = await client.query(
    'UPDATE formation.app_users SET display_name = $2, role = \'admin\', status = \'active\', password_hash = $3, must_change_password = false, ' +
    'password_changed_at = now(), failed_attempts = 0, locked_until = NULL, approved_at = coalesce(approved_at, now()), disabled_at = NULL, ' +
    'disabled_reason = NULL, valid_from = $4, valid_until = $5, last_login_at = now() ' +
    'WHERE lower(login_id) = lower($1) AND status <> \'deleted\' RETURNING *',
    [loginId, displayName, passwordHash, validFrom, validUntil]
  );
  const user = updated.rows[0] || (await client.query(
    'INSERT INTO formation.app_users (login_id, display_name, role, status, password_hash, password_changed_at, approved_at, valid_from, valid_until, last_login_at) ' +
    'VALUES ($1, $2, \'admin\', \'active\', $3, now(), now(), $4, $5, now()) RETURNING *',
    [loginId, displayName, passwordHash, validFrom, validUntil]
  )).rows[0];
  await recordAccountEvent(client, user, 'admin_setup', { id: null, display_name: 'VM setup script' }, { validFrom, validUntil });
  await client.query('COMMIT');
  console.log((updated.rowCount ? 'Updated' : 'Created') + ' administrator account: ' + loginId + ' (valid until ' + validUntil + ')');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
