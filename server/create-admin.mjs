// Creates the administrator account, or resets an existing account to administrator with a new password.
// Run on the VM through scripts/create-admin.ps1; the web app never creates administrators.
import pg from 'pg';
import { checkLoginId, checkNewPassword, hashPassword } from './auth.mjs';

const loginId = checkLoginId(process.env.FORMATION_ADMIN_ID);
const displayName = String(process.env.FORMATION_ADMIN_NAME || '').trim();
if (!displayName || displayName.length > 120) throw new Error('Name is required (max 120 characters).');
const passwordHash = await hashPassword(checkNewPassword(process.env.FORMATION_ADMIN_PASSWORD, loginId));

const client = new pg.Client({
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'formation_inspection',
  user: process.env.PGUSER || 'formation_app',
  password: process.env.PGPASSWORD
});
await client.connect();
try {
  const updated = await client.query(
    'UPDATE formation.app_users SET display_name = $2, role = \'admin\', status = \'active\', password_hash = $3, must_change_password = false, ' +
    'failed_attempts = 0, locked_until = NULL, approved_at = coalesce(approved_at, now()), disabled_at = NULL, disabled_reason = NULL ' +
    'WHERE lower(login_id) = lower($1)',
    [loginId, displayName, passwordHash]
  );
  if (!updated.rowCount) {
    await client.query(
      'INSERT INTO formation.app_users (login_id, display_name, role, status, password_hash, approved_at) VALUES ($1, $2, \'admin\', \'active\', $3, now())',
      [loginId, displayName, passwordHash]
    );
  }
  console.log((updated.rowCount ? 'Updated' : 'Created') + ' administrator account: ' + loginId);
} finally {
  await client.end();
}
