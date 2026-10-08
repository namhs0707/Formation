// Confirmations and corrections of submitted records by part leaders, engineers and supervisors.
// Original rows are never changed: corrections are appended to formation.record_reviews and applied on read.
import { TEAMS, DEFECTS, TEMPERATURE_AREAS, TEMPERATURE_LABELS, CONDUCTIVE_UNITS_BY_MODE, IR_LOCATIONS, irResult } from './records.mjs';
import { REVIEWER_ROLES } from './auth.mjs';

const APPEARANCE = new Set(['before_hpcd', 'formation', 'degas']);
const STARTUP_STATUSES = ['Pass', 'Flagged', 'Incomplete', 'Completed', 'N/A', 'No'];

function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }

export function recordTypeOf(process) {
  if (APPEARANCE.has(process)) return 'appearance_inspections';
  if (TEMPERATURE_AREAS[process]) return 'temperature_readings';
  if (String(process).startsWith('startup_')) return process === 'startup_resealing' ? 'resealing_checks' : 'startup_checks';
  return { hta: 'hta_readings', maintenance: 'eol_maintenance', conductive: 'conductive_maintenance', ip_dsf: 'ip_checks', ir: 'ir_checks' }[process] || null;
}

const RECORD_TYPES = new Set(['appearance_inspections', 'hta_readings', 'temperature_readings', 'eol_maintenance',
  'conductive_maintenance', 'startup_checks', 'resealing_checks', 'ip_checks', 'ir_checks']);

const team = { key: 'team', label: 'Team', kind: 'choice', options: TEAMS, prop: 'team' };
const operator = (optional = false) => ({ key: 'operator_name', label: 'Operator name', kind: 'text', max: 120, optional, prop: 'operatorName' });
const comment = { key: 'comment', label: 'Comment', kind: 'text', max: 2000, optional: true, prop: 'comment' };

// The correctable fields of one record, given its stored row (with child rows where the form has them).
function fieldsFor(type, row) {
  if (type === 'appearance_inspections') {
    return [team, operator(),
      { key: 'tray_id', label: 'Tray ID', kind: 'text', max: 32, pattern: '^[A-Z0-9]+$', upper: true, prop: 'trayId' },
      { key: 'defect_types', label: 'Defect', kind: 'list', options: DEFECTS, exclusive: 'All OK', prop: 'defect', format: value => value.join(', ') },
      { key: 'cell_id', label: 'Cell ID', kind: 'text', max: 32, optional: true, prop: 'cellId' },
      { key: 'channel', label: 'Channel', kind: 'number', integer: true, min: 1, optional: true, prop: 'channel' },
      ...(row.process === 'formation' ? [
        { key: 'jig_line', label: 'Jig line', kind: 'text', max: 16, optional: true, prop: 'jigLine' },
        { key: 'hot_jig', label: 'Hot jig', kind: 'number', integer: true, min: 1, optional: true, prop: 'hotJig' }] : []),
      ...(row.process === 'degas' ? [{ key: 'degas_line', label: 'Degas line', kind: 'text', max: 16, optional: true, prop: 'degasLine' }] : []),
      comment];
  }
  if (type === 'hta_readings') {
    return [team, operator(), ...['11', '12', '21', '22', '31', '32', '41', '42'].map(suffix =>
      ({ key: 'hta' + suffix, label: 'HTA ' + suffix[0] + '-' + suffix[1], kind: 'number', prop: 'hta' + suffix }))];
  }
  if (type === 'temperature_readings') {
    const area = TEMPERATURE_AREAS[row.area];
    return [team, operator(),
      ...(area.line ? [area.line.options
        ? { key: 'line', label: 'Line', kind: 'choice', options: area.line.options, prop: 'line' }
        : { key: 'line', label: 'Line', kind: 'text', max: area.line.maxLength || 16, prop: 'line' }] : []),
      ...area.fields.map(key => ({ key: 'reading:' + key, label: TEMPERATURE_LABELS[key] || key, kind: 'number', optional: Boolean(area.optionalFields), prop: key })),
      { key: 'in_spec', label: 'Temperature(s) in spec?', kind: 'choice', options: ['Yes', 'No'], prop: 'tempInSpec' }];
  }
  if (type === 'eol_maintenance') {
    return [team, operator(),
      { key: 'line', label: 'Line', kind: 'choice', options: ['EOL 4-1', 'EOL 4-2', 'EOL 5-1', 'EOL 5-2'], prop: 'line' },
      { key: 'equipment', label: 'Target', kind: 'choice', options: ['Tape', 'Knife'], prop: 'equipment' },
      { key: 'maintenance', label: 'Action', kind: 'choice', options: ['Cleaning', 'Replace'], prop: 'maintenance' },
      { key: 'taping_line', label: 'Taping line', kind: 'choice', options: ['Both', 'A', 'B'], prop: 'tapingLine' }];
  }
  if (type === 'conductive_maintenance') {
    return [team, operator(),
      { key: 'line', label: 'Line', kind: 'choice', options: ['4-1', '4-2', '5-1', '5-2'], prop: 'line' },
      { key: 'units', label: 'Unit', kind: 'list', options: CONDUCTIVE_UNITS_BY_MODE[row.rubber_process + ' ' + row.measurement] || [], prop: 'units', format: value => value.join(', ') },
      { key: 'action', label: 'Action', kind: 'choice', options: ['Flip', 'Change', 'Other'], prop: 'action' },
      comment];
  }
  if (type === 'startup_checks') {
    return [team, operator(true),
      { key: 'frequency', label: 'Frequency', kind: 'choice', options: ['Shift', 'Weekly', 'Monthly'], prop: 'frequency' },
      ...(row.items || []).flatMap(item => [
        { key: 'item:' + item.position + '.status', label: item.item + ' — Status', kind: 'choice', options: STARTUP_STATUSES, position: item.position, prop: 'status' },
        { key: 'item:' + item.position + '.comment', label: item.item + ' — Comment', kind: 'text', max: 2000, optional: true, position: item.position, prop: 'comment' }])];
  }
  if (type === 'resealing_checks') {
    return [operator(),
      { key: 'shift', label: 'Shift', kind: 'text', max: 40, prop: 'shift' },
      { key: 'work_today', label: 'Work today', kind: 'text', max: 160, prop: 'work' },
      { key: 'inspection_status', label: 'Inspect resealing tool', kind: 'choice', options: ['Pass', 'Flagged', 'N/A'], prop: 'inspectionStatus' },
      { key: 'cleaning_status', label: 'Clean resealing tool', kind: 'choice', options: ['Completed', 'Incomplete', 'N/A'], prop: 'cleaningStatus' },
      comment];
  }
  if (type === 'ip_checks') {
    return [
      { key: 'check_date', label: 'Date', kind: 'date', prop: 'checkDate' },
      { key: 'line', label: 'Line', kind: 'choice', options: ['EOL #4-1', 'EOL #4-2', 'EOL #5-1', 'EOL #5-2'], prop: 'line' },
      ...(row.measurements || []).flatMap(measure => ['plus', 'minus'].map(side => ({
        key: 'measure:' + measure.measure_id + '.' + side,
        label: measure.process_label + (measure.lane === 'Common' ? '' : ' (' + measure.lane + ')') + ' (' + measure.point + ') ' + (side === 'plus' ? '(+)' : '(−)'),
        kind: 'number', measureId: measure.measure_id, prop: side })))];
  }
  if (type === 'ir_checks') {
    const trayId = (tray, prop) => ({ key: 'tray' + tray + '_id', label: 'Tray ' + tray + ' ID', kind: 'text', max: 32, pattern: '^[A-Z0-9]+$', upper: true, prop });
    return [team, operator(),
      { key: 'location', label: 'Where checked', kind: 'choice', options: IR_LOCATIONS, prop: 'location' },
      { key: 'pkg_lot_id', label: 'PKG Lot ID', kind: 'text', max: 100, prop: 'pkgLotId' },
      trayId(1, 'tray1Id'), trayId(2, 'tray2Id'),
      ...(row.values || []).map(item => ({
        key: 'irvalue:' + item.tray + '.' + item.channel, label: 'Tray ' + item.tray + ' CH ' + item.channel + ' (blank = OK)',
        kind: 'number', min: 0, optional: true, tray: item.tray, channel: item.channel, prop: 'value' }))];
  }
  return [];
}

function storedValue(row, field) {
  if (field.key.startsWith('reading:')) return row.readings?.[field.key.slice(8)] ?? '';
  if (field.key.startsWith('item:')) return (row.items || []).find(item => item.position === field.position)?.[field.prop] ?? '';
  if (field.key.startsWith('measure:')) {
    const measure = (row.measurements || []).find(item => item.measure_id === field.measureId);
    return measure ? Number(measure[field.prop === 'plus' ? 'plus_value' : 'minus_value']) : '';
  }
  if (field.key.startsWith('irvalue:')) {
    const item = (row.values || []).find(value => value.tray === field.tray && value.channel === field.channel);
    return item && item.ir_value != null ? Number(item.ir_value) : '';
  }
  const value = row[field.key];
  if (value == null) return field.kind === 'list' ? [] : '';
  if (field.kind === 'number') return Number(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value;
}

function normalize(field, value) {
  if (field.kind === 'list') {
    const values = Array.isArray(value) ? value.map(String) : [];
    if (!values.length || new Set(values).size !== values.length || values.some(item => !field.options.includes(item))) fail('Invalid ' + field.label + '.');
    if (field.exclusive && values.includes(field.exclusive) && values.length > 1) fail(field.exclusive + ' cannot be combined with other values.');
    return field.options.filter(option => values.includes(option));
  }
  if (field.kind === 'number') {
    if ((value === '' || value == null) && field.optional) return '';
    const number = Number(value);
    if (value === '' || value == null || !Number.isFinite(number)) fail(field.label + ' must be a number.');
    if (field.integer && !Number.isInteger(number)) fail(field.label + ' must be a whole number.');
    if (field.min != null && number < field.min) fail(field.label + ' must be at least ' + field.min + '.');
    return number;
  }
  let text = String(value ?? '').trim();
  if (field.upper) text = text.toUpperCase();
  if (field.kind === 'choice') { if (!field.options.includes(text)) fail('Invalid ' + field.label + '.'); return text; }
  if (field.kind === 'date') { if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) fail(field.label + ' must use YYYY-MM-DD.'); return text; }
  if (!text && !field.optional) fail(field.label + ' is required.');
  if (text.length > field.max) fail(field.label + ' is too long.');
  if (text && field.pattern && !new RegExp(field.pattern).test(text)) fail('Invalid ' + field.label + '.');
  return text;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function loadRow(pool, type, id) {
  if (!RECORD_TYPES.has(type)) fail('Unknown record type.');
  if (!/^\d+$/.test(String(id))) fail('Invalid record.');
  const row = (await pool.query('SELECT * FROM formation.' + type + ' WHERE id = $1', [id])).rows[0];
  if (!row) fail('Record not found.', 404);
  if (type === 'startup_checks') {
    row.items = (await pool.query('SELECT position, item, status, comment FROM formation.startup_check_items WHERE check_id = $1 ORDER BY position', [id])).rows;
  }
  if (type === 'ip_checks') {
    // Read the date as text: a JS Date would be midnight local time and can shift a day when formatted.
    row.check_date = (await pool.query('SELECT check_date::text AS value FROM formation.ip_checks WHERE id = $1', [id])).rows[0].value;
    row.measurements =(await pool.query('SELECT measure_id, process_label, point, lane, plus_value, minus_value FROM formation.ip_measurements WHERE check_id = $1 ORDER BY position', [id])).rows;
  }
  if (type === 'ir_checks') {
    row.values = (await pool.query('SELECT tray, channel, ir_value FROM formation.ir_values WHERE check_id = $1 ORDER BY tray, channel', [id])).rows;
  }
  return row;
}

async function eventsFor(pool, type, ids) {
  if (!ids.length) return new Map();
  const result = await pool.query(
    'SELECT record_id, recorded_at, action, changes, reason, user_name, user_role, host(client_ip) AS client_ip FROM formation.record_reviews ' +
    'WHERE record_type = $1 AND record_id = ANY($2::bigint[]) ORDER BY recorded_at, id',
    [type, ids]
  );
  const byId = new Map();
  for (const event of result.rows) {
    const key = String(event.record_id);
    if (!byId.has(key)) byId.set(key, []);
    byId.get(key).push(event);
  }
  return byId;
}

function reviewSummary(type, id, events) {
  const lastEdit = events.findLastIndex(event => event.action === 'edit');
  const confirm = events.findLastIndex(event => event.action === 'confirm');
  const confirmed = confirm > lastEdit ? events[confirm] : null;
  return {
    type, id: Number(id), status: confirmed ? 'confirmed' : 'pending', edited: lastEdit >= 0,
    confirmedBy: confirmed?.user_name || null, confirmedRole: confirmed?.user_role || null, confirmedAt: confirmed?.recorded_at || null
  };
}

// Applies the corrections of one record to an API record object, using each field's response property.
function applyChanges(type, record, events) {
  const changes = events.filter(event => event.action === 'edit').flatMap(event => event.changes);
  for (const change of changes) {
    const [, position, measureId] = change.key.match(/^item:(\d+)\.|^measure:(.+)\.(?:plus|minus)$/) || [];
    const [, irTray, irChannel] = change.key.match(/^irvalue:(\d+)\.(\d+)$/) || [];
    const prop = change.prop;
    const value = change.format === 'join' && Array.isArray(change.new) ? change.new.join(', ') : change.new;
    if (position) { if (Number(record.position) === Number(position)) record[prop] = value; continue; }
    if (irTray) {
      const item = (record.values || []).find(entry => entry.tray === Number(irTray) && entry.channel === Number(irChannel));
      if (item) { item.value = value === '' ? null : value; item.result = irResult(item.value); item.corrected = true; }
      continue;
    }
    if (measureId) {
      const measure = (record.measurements || []).find(item => item.id === measureId);
      if (measure) { measure[prop] = value; measure.corrected = true; }
      continue;
    }
    record[prop] = value;
  }
  if (type === 'hta_readings' && changes.length) {
    const out = ['11', '12', '21', '22', '31', '32', '41', '42'].filter(suffix => Number(record['hta' + suffix]) < 57 || Number(record['hta' + suffix]) > 63)
      .map(suffix => 'HTA ' + suffix[0] + '-' + suffix[1]);
    record.tempInSpec = out.length ? out.join(', ') : 'Spec in';
  }
}

// Adds corrections and a review summary to records read for the dashboard. idOf picks the parent record id.
export async function attachReviews(pool, process, records, idOf = record => record.id) {
  const type = recordTypeOf(process);
  if (!type || !records.length) return records;
  const byId = await eventsFor(pool, type, [...new Set(records.map(idOf).map(String))]);
  for (const record of records) {
    const id = idOf(record);
    const events = byId.get(String(id)) || [];
    applyChanges(type, record, events);
    record.review = reviewSummary(type, id, events);
  }
  return records;
}

export async function reviewDetail(pool, type, id) {
  const row = await loadRow(pool, type, id);
  const events = (await eventsFor(pool, type, [String(id)])).get(String(id)) || [];
  const current = currentValues(row, fieldsFor(type, row), events);
  return {
    ...reviewSummary(type, id, events),
    fields: fieldsFor(type, row).map(({ key, label, kind, options, optional, max, integer }) =>
      ({ key, label, kind, options, optional: Boolean(optional), max, integer: Boolean(integer), value: current[key] })),
    history: events.map(event => ({
      at: event.recorded_at, action: event.action, user: event.user_name, role: event.user_role, ip: event.client_ip,
      reason: event.reason, changes: event.changes.map(change => ({ label: change.label, old: change.old, new: change.new }))
    })).reverse()
  };
}

function currentValues(row, fields, events) {
  const values = Object.fromEntries(fields.map(field => [field.key, storedValue(row, field)]));
  for (const event of events) if (event.action === 'edit') for (const change of event.changes) values[change.key] = change.new;
  return values;
}

export async function submitReview(pool, user, input, clientIp) {
  if (!user || !REVIEWER_ROLES.has(user.role)) fail('Sign in as a part leader, engineer or supervisor.', 403);
  if (user.must_change_password) fail('Change your temporary password first.', 403);
  const type = String(input.type || '');
  const id = String(input.id ?? '');
  const row = await loadRow(pool, type, id);
  const events = (await eventsFor(pool, type, [id])).get(id) || [];
  const action = input.action;
  let changes = [];
  let reason = '';
  if (action === 'confirm') {
    if (reviewSummary(type, id, events).status === 'confirmed') fail('This record is already confirmed.');
  } else if (action === 'edit') {
    reason = String(input.reason ?? '').trim();
    if (!reason || reason.length > 500) fail('Enter a reason for the change (max 500 characters).');
    const fields = fieldsFor(type, row);
    const current = currentValues(row, fields, events);
    const requested = input.changes && typeof input.changes === 'object' ? input.changes : {};
    for (const [key, value] of Object.entries(requested)) {
      const field = fields.find(item => item.key === key);
      if (!field) fail('This field cannot be changed.');
      const next = normalize(field, value);
      if (!same(next, current[key])) {
        changes.push({ key, label: field.label, prop: field.prop, format: field.format ? 'join' : undefined, old: current[key], new: next });
      }
    }
    if (!changes.length) fail('No values were changed.');
  } else {
    fail('Unknown review action.');
  }
  await pool.query(
    'INSERT INTO formation.record_reviews (record_type, record_id, action, changes, reason, user_id, user_name, user_role, client_ip) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9)',
    [type, id, action, JSON.stringify(changes), reason, user.id, user.display_name, user.role, clientIp]
  );
  return reviewDetail(pool, type, id);
}
