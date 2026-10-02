import assert from 'node:assert/strict';
const base = process.env.TEST_API_URL || 'http://127.0.0.1:3001';
const photoBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lYcAAAAASUVORK5CYII=';
const teams = { team: '1A', operatorName: 'API Test' };
async function post(payload, expected = 201) {
  const response = await fetch(base + '/api/inspections', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  const data = await response.json();
  assert.equal(response.status, expected, JSON.stringify(data));
  return data;
}
async function get(processName, action = 'bootstrap') {
  const query = new URLSearchParams({
    process: processName, action, startDate: '2026-01-01', endDate: '2026-12-31'
  });
  const response = await fetch(base + '/api/inspections?' + query);
  assert.equal(response.status, 200);
  return response.json();
}
const cases = [
  { process: 'before_hpcd', ...teams, trayId: 'TEST001', defect: ['All OK'], defectMap: '[]' },
  { process: 'formation', ...teams, trayId: 'TEST002', cellId: 'CELL1', channel: 1,
    jigLine: '3-1', hotJig: 1, defect: ['Scratch'], comment: 'Test photo',
    defectMap: '[{"x":0.5,"y":0.5}]', defectPhotoName: 'test.png',
    defectPhotoType: 'image/png', defectPhotoData: photoBase64 },
  { process: 'degas', ...teams, trayId: 'TEST003', cellId: 'CELL2', channel: 2,
    degasLine: '4-1', defect: ['Dent'], comment: 'Test', defectMap: '[]' },
  { process: 'hta', ...teams, hta11: 60, hta12: 60, hta21: 60, hta22: 60,
    hta31: 60, hta32: 60, hta41: 60, hta42: 60 },
  { process: 'maintenance', ...teams, line: 'EOL 4-1', equipment: 'Tape',
    maintenance: 'Cleaning', tapingLine: 'A' },
  { process: 'conductive', ...teams, rubberProcess: 'Degas', line: '4-1',
    measurement: 'IR', units: ['1A'], action: 'Flip', comment: '' },
  ...['startup_hpcd','startup_jig','startup_degas','startup_cdc','startup_eol','startup_selector'].map(processName => ({
    process: processName, ...teams, lines: processName === 'startup_cdc' ? [] : [processName === 'startup_selector' ? '#1' : '4-1'],
    cdcLine: processName === 'startup_cdc' ? '1' : '',
    floor: processName === 'startup_cdc' ? '1' : '',
    selectorType: processName === 'startup_selector' ? 'Jig Selector' : '',
    checkCompleted: 'No', frequency: 'Shift',
    items: [{ item: 'Check completed / Overall', status: 'No', comment: 'Test only' }]
  })),
  { process: 'startup_resealing', operatorName: 'API Test', shift: '1A',
    work: 'Test work', inspectionStatus: 'Pass', cleaningStatus: 'Completed', comment: '' },
  { process: 'ip_dsf', checkDate: '2026-10-01', line: 'EOL 4-1', measurements: [
    { id: 'test-common-a', process: 'Test', point: 'a', name: 'Gap', target: '0.4 < X < 0.5',
      lane: 'Common', plus: 0.45, minus: 0.46, inRange: true }
  ] }
];
let photoId;
for (const payload of cases) {
  const saved = await post(payload);
  assert.ok(saved.id, payload.process);
  if (payload.process === 'formation') photoId = saved.id;
  const loaded = await get(payload.process);
  const records = loaded.records || loaded.data || [];
  assert.ok(records.length > 0, payload.process + ' did not reload');
  console.log('PASS ' + payload.process + ' saved and reloaded');
}
const photo = await fetch(base + '/api/photos/' + photoId);
assert.equal(photo.status, 200);
assert.equal(photo.headers.get('content-type'), 'image/png');
assert.ok((await photo.arrayBuffer()).byteLength > 0);
console.log('PASS photo reloaded');
await post({ process: 'before_hpcd', ...teams, team: 'bad', trayId: 'TEST', defect: ['All OK'] }, 400);
const before = await get('startup_jig', 'records');
await post({ process: 'startup_jig', ...teams, lines: ['3-1'], checkCompleted: 'No', frequency: 'Shift',
  items: [{ item: 'Overall', status: 'No', comment: '' }] }, 400);
const after = await get('startup_jig', 'records');
assert.equal(after.data.length, before.data.length);
console.log('PASS validation and rollback');
console.log('All 14 form types passed.');