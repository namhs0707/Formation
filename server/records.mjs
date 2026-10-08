const APPEARANCE = new Set(['before_hpcd', 'formation', 'degas']);
const STARTUP = new Set(['startup_hpcd', 'startup_jig', 'startup_degas', 'startup_cdc', 'startup_eol', 'startup_selector']);
const PROCESSES = new Set([...APPEARANCE, ...STARTUP, 'hta', 'temperature', 'maintenance', 'conductive', 'startup_resealing', 'ip_dsf', 'ir']);
export const IR_LOCATIONS = ['Degas', 'Shipping Aging'];
export const IR_CHANNELS = 18;
// A channel reads "OK" (stored as null) or a number; numbers below 100 are NG.
export function irResult(value) { return value != null && value !== '' && Number(value) < 100 ? 'NG' : 'OK'; }
const HTA_KEYS = ['hta11','hta12','hta21','hta22','hta31','hta32','hta41','hta42'];
export const CONDUCTIVE_UNITS_BY_MODE = { 'Degas IR': ['1A','1B','1C','1D','2A','2B','2C','2D'], 'EOL IR': ['1A','1B','1C','1D'], 'EOL IV': ['1A','1B','2A','2B'] };
export const TEMPERATURE_LABELS = {
  dcir: 'DCIR', pltEast: 'PLT East', pltWest: 'PLT West', dgs: 'DGS', eol: 'EOL',
  praEast: 'PRA East', praWest: 'PRA West', rtaEast: 'RTA East Area', rtaWest: 'RTA West Area'
};
const FIELD_LABEL_PREFIX = { floor: 'Floor ', jig: 'JIG ', shaEast: 'SHA East Aisle #', shaWest: 'SHA West Aisle #' };
const fieldKeys = (prefix, suffixes) => suffixes.map(suffix => {
  const key = prefix + suffix.replace(/[^0-9A-Za-z]/g, '');
  TEMPERATURE_LABELS[key] = FIELD_LABEL_PREFIX[prefix] + suffix;
  return key;
});
// Area temperature readings other than HTA, which keeps its own table. Mirrors TEMPERATURE_AREAS in Code.gs.
export const TEMPERATURE_AREAS = {
  temp_cdc: { line: { maxLength: 32 }, fields: [...fieldKeys('floor', ['1-1','1-2','2-1','2-2','3-1','3-2']), 'dcir'] },
  temp_plt: { fields: ['pltEast', 'pltWest'] },
  temp_dgs: { line: { options: ['4-1','4-2','5-1','5-2'] }, fields: ['dgs'] },
  temp_eol: { line: { options: ['4-1','4-2','5-1','5-2'] }, fields: ['eol'] },
  temp_jig: { line: { options: ['3','4','5','6'] }, optionalFields: true,
    fields: [...fieldKeys('floor', ['1','2','3']), ...fieldKeys('jig', ['4-1','4-2','4-3','5-1','5-2','5-3'])] },
  temp_pra: { line: { maxLength: 32 }, fields: ['praEast', 'praWest'] },
  temp_rta: { fields: ['rtaEast', 'rtaWest'] },
  temp_sha: { fields: [...fieldKeys('shaEast', ['1','2','3','4','5']), ...fieldKeys('shaWest', ['1','2','3','4','5'])] }
};
export const TEAMS = ['1A', '1B', '2A', '2B'];
export const DEFECTS = ['All OK', 'Dent', 'Contamination', 'Scratch', 'Lead bending', 'Wrinkles', 'Unsealing pouch', 'Others'];
function invalid(message) { const error = new Error(message); error.status = 400; throw error; }
function required(value, label, max = 200) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) invalid(label + ' is required (max ' + max + ' characters).');
  return text;
}
function optional(value, max = 2000) {
  const text = String(value ?? '').trim();
  if (text.length > max) invalid('Text is too long.');
  return text;
}
function choice(value, values, label) {
  if (!values.includes(value)) invalid('Invalid ' + label + '.');
  return value;
}
function list(value, label, max = 100) {
  if (!Array.isArray(value) || value.length > max) invalid('Invalid ' + label + '.');
  return value;
}
function numeric(value, label) {
  if (value === '' || value == null || !Number.isFinite(Number(value))) invalid('Invalid ' + label + '.');
  return Number(value);
}
function processOf(value) { if (!PROCESSES.has(value)) invalid('Unknown process.'); return value; }
function teamOf(input) { return choice(input.team, TEAMS, 'team'); }
function defectsOf(input) {
  const values = list(input.defect, 'defects', 8);
  if (!values.length || new Set(values).size !== values.length || values.some(value => !DEFECTS.includes(value))) invalid('Invalid defect selection.');
  if (values.includes('All OK') && values.length !== 1) invalid('All OK cannot be combined with defects.');
  return values;
}

async function saveAppearance(client, input) {
  const defects = defectsOf(input);
  const allOk = defects.length === 1 && defects[0] === 'All OK';
  const tray = required(input.trayId, 'Tray ID', 32).toUpperCase();
  if (!/^[A-Z0-9]+$/.test(tray)) invalid('Tray ID must contain letters and numbers only.');
  const cell = allOk ? null : required(input.cellId, 'Cell ID', 32);
  const channel = allOk ? null : numeric(input.channel, 'channel');
  if (channel != null && (!Number.isInteger(channel) || channel < 1)) invalid('Invalid channel.');
  const jigLine = input.process === 'formation' && !allOk ? required(input.jigLine, 'Jig line', 16) : null;
  const hotJig = input.process === 'formation' && !allOk ? numeric(input.hotJig, 'Hot jig') : null;
  const degasLine = input.process === 'degas' && !allOk ? required(input.degasLine, 'Degas line', 16) : null;
  let defectMap;
  try { defectMap = JSON.parse(input.defectMap || '[]'); } catch { invalid('Invalid defect map.'); }
  if (!Array.isArray(defectMap)) invalid('Invalid defect map.');
  const rows = await client.query(
    'INSERT INTO formation.appearance_inspections (process, team, operator_name, tray_id, cell_id, channel, jig_line, hot_jig, degas_line, defect_types, comment, defect_map) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb) RETURNING id',
    [input.process, teamOf(input), required(input.operatorName, 'Name', 120), tray, cell, channel,
      jigLine, hotJig, degasLine, defects, optional(input.comment), JSON.stringify(defectMap)]
  );
  const id = rows.rows[0].id;
  if (input.defectPhotoData) {
    const mime = choice(input.defectPhotoType, ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'], 'photo type');
    const encoded = String(input.defectPhotoData);
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) invalid('Invalid photo data.');
    const bytes = Buffer.from(encoded, 'base64');
    if (!bytes.length || bytes.length > 8 * 1024 * 1024) invalid('Photo must be 8 MB or smaller.');
    await client.query(
      'INSERT INTO formation.appearance_photos (inspection_id, original_name, mime_type, image_data) VALUES ($1,$2,$3,$4)',
      [id, required(input.defectPhotoName, 'Photo name', 160), mime, bytes]
    );
  }
  return { id };
}
async function saveHta(client, input, readings = input) {
  const values = HTA_KEYS.map(key => numeric(readings[key], key));
  const outOfSpec = HTA_KEYS.filter((key, index) => values[index] < 57 || values[index] > 63)
    .map(key => 'HTA ' + key.slice(3, 4) + '-' + key.slice(4));
  const rows = await client.query(
    'INSERT INTO formation.hta_readings (team, operator_name, hta11, hta12, hta21, hta22, hta31, hta32, hta41, hta42, spec_result) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id',
    [teamOf(input), required(input.operatorName, 'Name', 120), ...values, outOfSpec.length ? outOfSpec.join(', ') : 'Spec in']
  );
  return { id: rows.rows[0].id };
}
function isTemperatureValue(value) {
  return value !== '' && value != null && Number.isFinite(Number(value));
}
async function saveTemperature(client, input) {
  const areas = list(input.areas, 'areas', 20);
  if (!areas.length) invalid('Select at least one area.');
  if (new Set(areas.map(entry => entry && entry.process)).size !== areas.length) invalid('Each area can be submitted once.');
  const ids = [];
  for (const entry of areas) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) invalid('Invalid area reading.');
    const values = entry.values && typeof entry.values === 'object' ? entry.values : {};
    if (entry.process === 'hta') {
      ids.push((await saveHta(client, input, values)).id);
      continue;
    }
    const area = TEMPERATURE_AREAS[entry.process];
    if (!area) invalid('Unknown area.');
    let line = null;
    if (area.line) {
      line = required(entry.line, 'Line', area.line.maxLength || 16);
      if (area.line.options) choice(line, area.line.options, 'line');
    }
    const readings = {};
    for (const key of area.fields) {
      const value = values[key];
      if (isTemperatureValue(value)) readings[key] = Number(value);
      else if (!area.optionalFields || (value !== '' && value != null)) invalid('Invalid ' + key + ' temperature.');
    }
    if (!Object.keys(readings).length) invalid('Enter at least one temperature for each selected area.');
    const rows = await client.query(
      'INSERT INTO formation.temperature_readings (area, team, operator_name, line, readings, in_spec) VALUES ($1,$2,$3,$4,$5::jsonb,$6) RETURNING id',
      [entry.process, teamOf(input), required(input.operatorName, 'Name', 120), line, JSON.stringify(readings),
        choice(entry.inSpec, ['Yes','No'], 'in-spec answer')]
    );
    ids.push(rows.rows[0].id);
  }
  return { id: ids[0], ids };
}
async function saveMaintenance(client, input) {
  const rows = await client.query(
    'INSERT INTO formation.eol_maintenance (team, operator_name, line, equipment, maintenance, taping_line) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
    [teamOf(input), required(input.operatorName, 'Name', 120), choice(input.line, ['EOL 4-1','EOL 4-2','EOL 5-1','EOL 5-2'], 'line'),
      choice(input.equipment, ['Tape','Knife'], 'equipment'), choice(input.maintenance, ['Cleaning','Replace'], 'maintenance'),
      choice(input.tapingLine, ['Both','A','B'], 'taping line')]
  );
  return { id: rows.rows[0].id };
}
async function saveConductive(client, input) {
  const rubberProcess = choice(input.rubberProcess, ['Degas','EOL'], 'process');
  const measurement = choice(input.measurement, rubberProcess === 'Degas' ? ['IR'] : ['IR','IV'], 'measurement');
  const units = list(input.units, 'units', 8);
  const validUnits = CONDUCTIVE_UNITS_BY_MODE[`${rubberProcess} ${measurement}`];
  if (!units.length || new Set(units).size !== units.length || units.some(unit => !validUnits.includes(unit))) invalid('Invalid units.');
  const rows = await client.query(
    'INSERT INTO formation.conductive_maintenance (team, operator_name, rubber_process, line, measurement, units, action, comment) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
    [teamOf(input), required(input.operatorName, 'Name', 120), rubberProcess,
      choice(input.line, ['4-1','4-2','5-1','5-2'], 'line'), measurement,
      units, choice(input.action, ['Flip','Change','Other'], 'action'), optional(input.comment)]
  );
  return { id: rows.rows[0].id };
}
async function saveStartup(client, input) {
  const process = input.process;
  const lines = process === 'startup_cdc' ? [] : list(input.lines, 'lines', 12).map(value => required(value, 'Line', 16));
  if (process !== 'startup_cdc' && !lines.length) invalid('Select a line.');
  if (['startup_degas','startup_eol','startup_selector'].includes(process) && lines.length !== 1) invalid('Select one line.');
  const items = list(input.items, 'check items', 100);
  if (!items.length) invalid('Check items are required.');
  const checkCompleted = choice(input.checkCompleted, ['Yes','No'], 'completion');
  if (checkCompleted === 'No' && (items.length !== 1 || items[0].status !== 'No')) invalid('Incomplete check needs one overall item.');
  const cdcLine = process === 'startup_cdc' ? required(input.cdcLine, 'CDC line', 32) : null;
  const cdcFloor = process === 'startup_cdc' ? required(input.floor, 'Floor', 16) : null;
  const selector = process === 'startup_selector' ? choice(input.selectorType, ['Jig Selector','CDC Selector','OCV Selector'], 'selector') : null;
  const rows = await client.query(
    'INSERT INTO formation.startup_checks (process, team, operator_name, line_values, cdc_line, cdc_floor, selector_type, check_completed, frequency) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
    [process, teamOf(input), optional(input.operatorName, 120) || null, lines, cdcLine, cdcFloor, selector,
      checkCompleted, choice(input.frequency, ['Shift','Weekly','Monthly'], 'frequency')]
  );
  const id = rows.rows[0].id;
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const status = choice(item.status, ['Pass','Flagged','Incomplete','Completed','N/A','No'], 'status');
    const comment = optional(item.comment);
    if (['Flagged','Incomplete','No'].includes(status) && !comment) invalid('Add a comment for flagged or incomplete items.');
    await client.query(
      'INSERT INTO formation.startup_check_items (check_id, position, item, status, comment) VALUES ($1,$2,$3,$4,$5)',
      [id, index + 1, required(item.item, 'Item', 500), status, comment]
    );
  }
  return { id };
}
async function saveResealing(client, input) {
  const inspection = choice(input.inspectionStatus, ['Pass','Flagged','N/A'], 'inspection');
  const cleaning = choice(input.cleaningStatus, ['Completed','Incomplete','N/A'], 'cleaning');
  const comment = optional(input.comment);
  if ((inspection === 'Flagged' || cleaning === 'Incomplete') && !comment) invalid('Add a comment for unfinished work.');
  const rows = await client.query(
    'INSERT INTO formation.resealing_checks (operator_name, shift, work_today, inspection_status, cleaning_status, comment) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
    [required(input.operatorName, 'Name', 120), required(input.shift, 'Shift', 40),
      required(input.work, 'Work today', 160), inspection, cleaning, comment]
  );
  return { id: rows.rows[0].id };
}
async function saveIp(client, input) {
  const checkDate = required(input.checkDate, 'Date', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkDate)) invalid('Invalid date.');
  const measurements = list(input.measurements, 'measurements', 100);
  if (!measurements.length || new Set(measurements.map(item => item.id)).size !== measurements.length) invalid('Invalid measurements.');
  const rows = await client.query(
    'INSERT INTO formation.ip_checks (check_date, line) VALUES ($1,$2) RETURNING id',
    [checkDate, choice(input.line, ['EOL #4-1','EOL #4-2','EOL #5-1','EOL #5-2'], 'line')]
  );
  const id = rows.rows[0].id;
  for (let index = 0; index < measurements.length; index++) {
    const item = measurements[index];
    await client.query(
      'INSERT INTO formation.ip_measurements (check_id, position, measure_id, process_label, point, measure_name, target, lane, plus_value, minus_value, in_range) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [id, index + 1, required(item.id, 'Measurement ID', 80), required(item.process, 'Process', 80),
        required(item.point, 'Point', 8), required(item.name, 'Measurement', 500), required(item.target, 'Target', 100),
        choice(item.lane, ['Common','A','B'], 'lane'), numeric(item.plus, 'plus'), numeric(item.minus, 'minus'), Boolean(item.inRange)]
    );
  }
  return { id };
}
function irValue(value, label) {
  if (String(value ?? '').trim().toUpperCase() === 'OK') return null;
  const number = numeric(value, label);
  if (number < 0 || number >= 1e8) invalid('Invalid ' + label + '.');
  return number;
}
async function saveIr(client, input) {
  const trays = list(input.trays, 'trays', 2);
  if (trays.length !== 2) invalid('Both trays are required.');
  const parsed = trays.map((tray, index) => {
    if (!tray || typeof tray !== 'object') invalid('Invalid tray ' + (index + 1) + '.');
    const trayId = required(tray.trayId, 'Tray ' + (index + 1) + ' ID', 32).toUpperCase();
    if (!/^[A-Z0-9]+$/.test(trayId)) invalid('Tray ' + (index + 1) + ' ID must contain letters and numbers only.');
    const values = list(tray.values, 'tray ' + (index + 1) + ' values', IR_CHANNELS);
    if (values.length !== IR_CHANNELS) invalid('Tray ' + (index + 1) + ' needs ' + IR_CHANNELS + ' channel values.');
    return { trayId, values: values.map((value, channel) => irValue(value, 'tray ' + (index + 1) + ' channel ' + (channel + 1) + ' value')) };
  });
  const rows = await client.query(
    'INSERT INTO formation.ir_checks (team, operator_name, location, pkg_lot_id, tray1_id, tray2_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
    [teamOf(input), required(input.operatorName, 'Name', 120), choice(input.location, IR_LOCATIONS, 'location'),
      required(input.pkgLotId, 'PKG Lot ID', 100), parsed[0].trayId, parsed[1].trayId]
  );
  const id = rows.rows[0].id;
  for (const [index, tray] of parsed.entries()) {
    for (const [channel, value] of tray.values.entries()) {
      await client.query(
        'INSERT INTO formation.ir_values (check_id, tray, channel, ir_value, result) VALUES ($1,$2,$3,$4,$5)',
        [id, index + 1, channel + 1, value, irResult(value)]
      );
    }
  }
  return { id };
}
export async function saveInspection(pool, input, clientIp = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('Invalid inspection.');
  const process = processOf(input.process);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Every parent table's client_ip column defaults to this transaction-local setting.
    await client.query("SELECT set_config('formation.client_ip', $1, true)", [clientIp || '']);
    let result;
    if (APPEARANCE.has(process)) result = await saveAppearance(client, input);
    else if (process === 'hta') result = await saveHta(client, input);
    else if (process === 'temperature') result = await saveTemperature(client, input);
    else if (process === 'maintenance') result = await saveMaintenance(client, input);
    else if (process === 'conductive') result = await saveConductive(client, input);
    else if (STARTUP.has(process)) result = await saveStartup(client, input);
    else if (process === 'startup_resealing') result = await saveResealing(client, input);
    else if (process === 'ir') result = await saveIr(client, input);
    else result = await saveIp(client, input);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}