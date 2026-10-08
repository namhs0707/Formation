// Sign-in, approval and review checks against a running server on a test database.
// The administrator account must exist first (create-admin.mjs with TEST_ADMIN_ID / TEST_ADMIN_PASSWORD).
import assert from 'node:assert/strict';

const base = process.env.TEST_API_URL || 'http://127.0.0.1:3001';
const adminId = process.env.TEST_ADMIN_ID;
const adminPassword = process.env.TEST_ADMIN_PASSWORD;
// Pretend to be the local IIS reverse proxy that terminates HTTPS.
const viaHttps = { 'X-Forwarded-Proto': 'https' };

async function call(method, path, { body, cookie, headers = {}, expect = 200 } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { ...viaHttps, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const data = await response.json();
  assert.equal(response.status, expect, method + ' ' + path + ' -> ' + JSON.stringify(data));
  const setCookie = response.headers.get('set-cookie');
  return { data, cookie: setCookie ? setCookie.split(';')[0] : null, setCookie };
}
const login = async (loginId, password, expect = 200) => call('POST', '/api/auth/login', { body: { loginId, password }, expect });
const pass = message => console.log('PASS ' + message);

// HTTPS only: the same request without the proxy header is refused.
const plain = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loginId: adminId, password: adminPassword }) });
assert.equal(plain.status, 403);
assert.equal((await (await fetch(base + '/api/auth/me')).json()).loginAvailable, false);
pass('sign-in refused over plain HTTP');

const admin = await login(adminId, adminPassword);
assert.match(admin.setCookie, /HttpOnly/);
assert.match(admin.setCookie, /SameSite=Strict/);
assert.match(admin.setCookie, /Secure/);
assert.equal((await call('GET', '/api/auth/me', { cookie: admin.cookie })).data.user.role, 'admin');
pass('administrator signs in with a secure, HttpOnly cookie');

await call('POST', '/api/auth/signup', { body: { loginId: 'eng.kim', displayName: 'Kim Engineer', password: 'short1' }, expect: 400 });
await call('POST', '/api/auth/signup', { body: { loginId: 'eng.kim', displayName: 'Kim Engineer', password: 'eng.kim-pass1' }, expect: 400 });
await call('POST', '/api/auth/signup', { body: { loginId: 'eng.kim', displayName: 'Kim Engineer', password: 'Formation2026' }, expect: 201 });
await call('POST', '/api/auth/signup', { body: { loginId: 'ENG.KIM', displayName: 'Copy', password: 'Formation2026' }, expect: 400 });
await login('eng.kim', 'Formation2026', 403);
pass('sign-up validates passwords, blocks duplicate IDs and waits for approval');

const users = (await call('GET', '/api/admin/users', { cookie: admin.cookie })).data.users;
const engineer = users.find(user => user.loginId === 'eng.kim');
assert.equal(engineer.status, 'pending');
await call('GET', '/api/admin/users', { expect: 401 });
await call('POST', '/api/admin/users/' + engineer.id, { cookie: admin.cookie, body: { action: 'approve', role: 'engineer' } });
const eng = await login('eng.kim', 'Formation2026');
await call('GET', '/api/admin/users', { cookie: eng.cookie, expect: 403 });
pass('administrator approves with a role; engineers cannot open user management');

// Reviews on a conductive rubber record submitted by an operator (no sign-in).
const saved = await call('POST', '/api/inspections', { body: { process: 'conductive', team: '1A', operatorName: 'Operator', rubberProcess: 'Degas', line: '4-1', measurement: 'IR', units: ['1A'], action: 'Flip', comment: '' }, expect: 201 });
const recordOf = async () => (await call('GET', '/api/inspections?process=conductive&action=records')).data.data.find(item => Number(item.id) === Number(saved.data.id));
assert.equal((await recordOf()).review.status, 'pending');
await call('GET', '/api/reviews?type=conductive_maintenance&id=' + saved.data.id, { expect: 401 });
const detail = (await call('GET', '/api/reviews?type=conductive_maintenance&id=' + saved.data.id, { cookie: eng.cookie })).data;
assert.deepEqual(detail.fields.find(field => field.key === 'units').value, ['1A']);
await call('POST', '/api/reviews', { cookie: eng.cookie, body: { type: 'conductive_maintenance', id: saved.data.id, action: 'confirm' } });
let record = await recordOf();
assert.equal(record.review.status, 'confirmed');
assert.equal(record.review.confirmedBy, 'Kim Engineer');
await call('POST', '/api/reviews', { cookie: eng.cookie, body: { type: 'conductive_maintenance', id: saved.data.id, action: 'confirm' }, expect: 400 });
pass('a single reviewer confirmation completes the record');

const edit = changes => ({ type: 'conductive_maintenance', id: saved.data.id, action: 'edit', changes, reason: 'Wrong unit entered' });
await call('POST', '/api/reviews', { cookie: eng.cookie, body: { ...edit({ units: ['1A', '2B'] }), reason: ' ' }, expect: 400 });
await call('POST', '/api/reviews', { cookie: eng.cookie, body: edit({ units: ['9Z'] }), expect: 400 });
await call('POST', '/api/reviews', { cookie: eng.cookie, body: edit({ units: ['1A'] }), expect: 400 });
await call('POST', '/api/reviews', { cookie: eng.cookie, body: edit({ line: '9-9' }), expect: 400 });
await call('POST', '/api/reviews', { cookie: eng.cookie, body: edit({ rubber_process: 'EOL' }), expect: 400 });
const edited = (await call('POST', '/api/reviews', { cookie: eng.cookie, body: edit({ units: ['2B', '1A'], comment: 'Checked on site' }) })).data;
assert.equal(edited.status, 'pending');
assert.equal(edited.history[0].changes.length, 2);
record = await recordOf();
assert.equal(record.units, '1A, 2B');
assert.equal(record.comment, 'Checked on site');
assert.equal(record.review.edited, true);
assert.equal(record.review.status, 'pending');
pass('corrections need a reason, are validated, show on reads and reopen the confirmation');

// Same-origin and JSON-only protection for changes.
await call('POST', '/api/reviews', { cookie: eng.cookie, body: { type: 'conductive_maintenance', id: saved.data.id, action: 'confirm' }, headers: { Origin: 'http://evil.example' }, expect: 403 });
const formPost = await fetch(base + '/api/reviews', { method: 'POST', headers: { ...viaHttps, Cookie: eng.cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'action=confirm' });
assert.equal(formPost.status, 415);
pass('cross-site and form posts are rejected');

// Other record shapes: start-up items, IP measurements, temperature readings and HTA recalculation.
const startup = await call('POST', '/api/inspections', { body: { process: 'startup_jig', team: '1A', lines: ['4-1'], checkCompleted: 'Yes', frequency: 'Shift', items: [{ item: 'Cell loader / Gripper pads', status: 'Pass', comment: '' }, { item: 'Cell loader / Conveyor', status: 'Pass', comment: '' }] }, expect: 201 });
await call('POST', '/api/reviews', { cookie: eng.cookie, body: { type: 'startup_checks', id: startup.data.id, action: 'edit', changes: { 'item:2.status': 'Flagged', 'item:2.comment': 'Belt worn' }, reason: 'Re-inspected' } });
const startupRows = (await call('GET', '/api/inspections?process=startup_jig&action=records')).data.data.filter(row => Number(row.checkId) === Number(startup.data.id));
assert.deepEqual(startupRows.map(row => row.status), ['Pass', 'Flagged']);
assert.equal(startupRows[1].comment, 'Belt worn');

const ip = await call('POST', '/api/inspections', { body: { process: 'ip_dsf', checkDate: '2026-10-02', line: 'EOL #4-2', measurements: [{ id: 'second-wing-a-common', process: '2nd Wing Press', point: 'a', name: 'Gap', target: '0.4 < X < 0.5', lane: 'Common', plus: 0.55, minus: 0.45, inRange: false }] }, expect: 201 });
await call('POST', '/api/reviews', { cookie: eng.cookie, body: { type: 'ip_checks', id: ip.data.id, action: 'edit', changes: { 'measure:second-wing-a-common.plus': 0.48, check_date: '2026-10-03' }, reason: 'Typo' } });
const ipRow = (await call('GET', '/api/inspections?process=ip_dsf&action=records')).data.data.find(row => Number(row.id) === Number(ip.data.id));
assert.equal(ipRow.checkDate, '2026-10-03');
assert.equal(ipRow.measurements[0].plus, 0.48);

const ir = await call('POST', '/api/inspections', { body: { process: 'ir', team: '2B', operatorName: 'Operator', location: 'Degas', pkgLotId: '7AMFJ015J2', trays: [
  { trayId: 'TRAYA1', values: [95, ...Array(17).fill('OK')] }, { trayId: 'TRAYB2', values: Array(18).fill('OK') }] }, expect: 201 });
await call('POST', '/api/reviews', { cookie: eng.cookie, body: { type: 'ir_checks', id: ir.data.id, action: 'edit', changes: { 'irvalue:1.1': '', 'irvalue:2.5': 80, tray2_id: 'trayb3' }, reason: 'Re-measured' } });
const irRow = (await call('GET', '/api/inspections?process=ir&action=records')).data.data.find(row => Number(row.id) === Number(ir.data.id));
assert.equal(irRow.tray2Id, 'TRAYB3');
assert.deepEqual(irRow.values.filter(item => item.result === 'NG').map(item => [item.tray, item.channel, item.value]), [[2, 5, 80]]);
assert.equal(irRow.values[0].value, null);

await call('POST', '/api/inspections', { body: { process: 'temperature', team: '1A', operatorName: 'Operator', areas: [
  { process: 'hta', values: { hta11: 60, hta12: 60, hta21: 60, hta22: 60, hta31: 60, hta32: 60, hta41: 60, hta42: 64 } },
  { process: 'temp_jig', line: '4', values: { floor1: 22, jig41: 24 }, inSpec: 'Yes' }] }, expect: 201 });
const chart = async area => (await call('GET', '/api/inspections?process=' + area + '&action=chart&startDate=2026-01-01&endDate=2026-12-31')).data.data.at(-1);
const hta = await chart('hta');
assert.equal(hta.tempInSpec, 'HTA 4-2');
await call('POST', '/api/reviews', { cookie: eng.cookie, body: { type: 'hta_readings', id: hta.id, action: 'edit', changes: { hta42: 61 }, reason: 'Probe misread' } });
assert.equal((await chart('hta')).tempInSpec, 'Spec in');
const jig = await chart('temp_jig');
await call('POST', '/api/reviews', { cookie: eng.cookie, body: { type: 'temperature_readings', id: jig.id, action: 'edit', changes: { 'reading:floor2': 23.5, 'reading:jig41': '' }, reason: 'Wrong probe' } });
const jigAfter = await chart('temp_jig');
assert.equal(jigAfter.floor2, 23.5);
assert.equal(jigAfter.jig41, '');
pass('start-up items, IP measurements, IR values, temperatures and HTA spec follow corrections');

// Lockout after five wrong passwords.
for (let attempt = 1; attempt <= 4; attempt++) await login('eng.kim', 'Wrong-pass-1', 401);
await login('eng.kim', 'Wrong-pass-1', 423);
await login('eng.kim', 'Formation2026', 423);
pass('five wrong passwords lock the account');

// Administrator reset: temporary password must be changed before reviewing.
const reset = (await call('POST', '/api/admin/users/' + engineer.id, { cookie: admin.cookie, body: { action: 'reset-password' } })).data;
assert.ok(reset.temporaryPassword);
const temp = await login('eng.kim', reset.temporaryPassword);
assert.equal(temp.data.user.mustChangePassword, true);
await call('POST', '/api/reviews', { cookie: temp.cookie, body: { type: 'startup_checks', id: startup.data.id, action: 'confirm' }, expect: 403 });
await call('POST', '/api/auth/password', { cookie: temp.cookie, body: { currentPassword: reset.temporaryPassword, newPassword: 'Formation2027' } });
await call('POST', '/api/reviews', { cookie: temp.cookie, body: { type: 'startup_checks', id: startup.data.id, action: 'confirm' } });
await call('GET', '/api/auth/me', { cookie: eng.cookie }).then(({ data }) => assert.equal(data.user, null));
pass('reset unlocks the account, forces a new password and signs out older sessions');

await call('POST', '/api/admin/users/' + engineer.id, { cookie: admin.cookie, body: { action: 'disable' } });
await login('eng.kim', 'Formation2027', 403);
assert.equal((await call('GET', '/api/auth/me', { cookie: temp.cookie })).data.user, null);
await call('POST', '/api/admin/users/' + engineer.id, { cookie: admin.cookie, body: { action: 'disable' } });
await call('POST', '/api/auth/logout', { cookie: admin.cookie, body: {} });
assert.equal((await call('GET', '/api/auth/me', { cookie: admin.cookie })).data.user, null);
pass('disabled accounts and signed-out sessions stop working');

const history = await fetch(base + '/api/inspections?process=conductive&action=records').then(response => response.json());
assert.ok(history.data.every(item => item.review));
console.log('All sign-in and review checks passed.');
