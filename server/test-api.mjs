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
  { process: 'before_hpcd', ...teams, trayId: 'TEST011', cellId: 'CELL11', channel: 3, hpcdLine: '5', defect: ['Dent'], comment: '', defectMap: '[]' },
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
  { process: 'ir', ...teams, location: 'Shipping Aging', pkgLotId: '7AMFJ015J2', trays: [
    { trayId: 'LHEE039851', values: Array(18).fill('OK') },
    { trayId: 'LHEE047613', values: [95, 120, ...Array(16).fill('ok')] }
  ] },
  { process: 'ip_dsf', checkDate: '2026-10-01', line: 'EOL #4-1', measurements: [
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
await post({ process: 'temperature', ...teams, areas: [
  { process: 'hta', values: { hta11: 60, hta12: 60, hta21: 60, hta22: 60, hta31: 60, hta32: 60, hta41: 60, hta42: 64 } },
  { process: 'temp_eol', line: '4-1', values: { eol: 23.5 }, inSpec: 'Yes' },
  { process: 'temp_jig', line: '4', values: { floor1: 22, floor2: '', floor3: '', jig41: 24, jig42: '', jig43: '', jig51: '', jig52: '', jig53: '' }, inSpec: 'Yes' }
] });
for (const area of ['hta', 'temp_eol', 'temp_jig']) {
  const chart = await get(area, 'chart');
  assert.ok(chart.data.length > 0, area + ' chart did not reload');
}
assert.equal((await get('temp_jig', 'chart')).data.at(-1).jig41, 24);
await post({ process: 'temperature', ...teams, areas: [{ process: 'temp_eol', line: '9-9', values: { eol: 23 }, inSpec: 'Yes' }] }, 400);
console.log('PASS temperature areas saved and charted');
await post({ process: 'conductive', ...teams, rubberProcess: 'EOL', line: '4-1', measurement: 'IV', units: ['2A'], action: 'Flip' });
await post({ process: 'conductive', ...teams, rubberProcess: 'EOL', line: '4-1', measurement: 'IV', units: ['1C'], action: 'Flip' }, 400);
await post({ process: 'ip_dsf', checkDate: '2026-10-01', line: 'ESHD #5-1', measurements: cases.at(-1).measurements }, 400);
console.log('PASS conductive units and IP line validation');
const irCase = cases.find(item => item.process === 'ir');
const irSaved = (await get('ir', 'records')).data.at(-1);
assert.equal(irSaved.values.length, 36);
assert.deepEqual(irSaved.values.filter(item => item.result === 'NG').map(item => [item.tray, item.channel, item.value]), [[2, 1, 95]]);
assert.equal(irSaved.values.find(item => item.tray === 2 && item.channel === 2).result, 'OK');
assert.equal(irSaved.values.find(item => item.tray === 1 && item.channel === 1).value, null);
await post({ ...irCase, trays: [irCase.trays[0], { trayId: 'LHEE047613', values: Array(17).fill('OK') }] }, 400);
await post({ ...irCase, trays: [irCase.trays[0], { trayId: 'LHEE047613', values: ['NG', ...Array(17).fill('OK')] }] }, 400);
await post({ ...irCase, trays: [irCase.trays[0]] }, 400);
await post({ ...irCase, location: 'EOL' }, 400);
console.log('PASS IR check results and validation');
await post({ process: 'before_hpcd', ...teams, team: 'bad', trayId: 'TEST', defect: ['All OK'] }, 400);
const before = await get('startup_jig', 'records');
await post({ process: 'startup_jig', ...teams, lines: ['3-1'], checkCompleted: 'No', frequency: 'Shift',
  items: [{ item: 'Overall', status: 'No', comment: '' }] }, 400);
const after = await get('startup_jig', 'records');
assert.equal(after.data.length, before.data.length);
const hpcdSaved = (await get('before_hpcd', 'records')).data.find(record => record.trayId === 'TEST011');
assert.equal(hpcdSaved.hpcdLine, '5');
await post({ process: 'before_hpcd', ...teams, trayId: 'TEST012', cellId: 'C', channel: 1, defect: ['Dent'], defectMap: '[]' }, 400);
await post({ process: 'before_hpcd', ...teams, trayId: 'TEST012', cellId: 'C', channel: 1, hpcdLine: '7', defect: ['Dent'], defectMap: '[]' }, 400);
console.log('PASS before HPCD line saved, required for defects and limited to 3-6');
console.log('PASS validation and rollback');
const summary = await (await fetch(base + '/api/summary')).json();
const statusOf = name => summary.groups.flatMap(group => group.items).find(item => item.name === name)?.status;
assert.equal(summary.result, 'success');
assert.deepEqual(summary.groups.map(group => group.name), ['Appearance', 'Temperature', 'Maintenance', 'Start-up', 'IP check sheet', 'IR']);
assert.equal(statusOf('Before HPCD'), 'bad', 'the before HPCD test record with Dent is a problem today');
assert.equal(statusOf('Jig Formation'), 'bad');
assert.equal(statusOf('HTA'), 'bad');
assert.equal(statusOf('SHA'), 'idle');
assert.equal(statusOf('EOL Tape/Knife'), 'info');
assert.equal(statusOf('Resealing Machine'), 'ok');
assert.equal(statusOf('IR'), 'bad');
assert.ok(summary.reviews.pending > 0);
console.log('PASS summary statuses');
const statusOfView = async view => (await fetch(base + '/api/status?view=' + view)).json();
const startupView = await statusOfView('startup');
assert.equal(startupView.sheets.length, 7);
assert.equal(startupView.days.at(-1), startupView.today);
const jigToday = startupView.sheets.find(sheet => sheet.process === 'startup_jig').days.at(-1);
assert.ok(jigToday.sheets >= 1 && jigToday.issues >= 1, 'jig sheet with "No" counts as an issue today');
assert.equal(startupView.sheets.find(sheet => sheet.process === 'startup_resealing').days.at(-1).issues, 0);
const tapeView = await statusOfView('maintenance');
assert.equal(tapeView.lines.find(line => line.line === 'EOL 4-1').cells[0].days, 0, 'EOL 4-1 tape cleaning was done today');
assert.equal(tapeView.lines.find(line => line.line === 'EOL 5-2').cells[0].days, null);
const rubberView = await statusOfView('conductive');
const eolIv = rubberView.modes.find(mode => mode.mode === 'EOL IV');
assert.equal(eolIv.lines.find(line => line.line === '4-1').cells[eolIv.units.indexOf('2A')].days, 0);
assert.equal((await fetch(base + '/api/status?view=nope')).status, 400);
console.log('PASS start-up and maintenance status views');
console.log('All 15 form types passed.');