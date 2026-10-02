const APPEARANCE = new Set(['before_hpcd', 'formation', 'degas']);
const STARTUP = new Set(['startup_hpcd', 'startup_jig', 'startup_degas', 'startup_cdc', 'startup_eol', 'startup_selector']);
const GENERAL = {
  hta: {
    table: 'formation.hta_readings',
    columns: 'id, recorded_at AS date, team, operator_name AS "operatorName", hta11, hta12, hta21, hta22, hta31, hta32, hta41, hta42, spec_result AS "tempInSpec"'
  },
  maintenance: {
    table: 'formation.eol_maintenance',
    columns: 'id, recorded_at AS date, team, operator_name AS "operatorName", line, equipment, maintenance, taping_line AS "tapingLine"'
  },
  conductive: {
    table: 'formation.conductive_maintenance',
    columns: 'id, recorded_at AS date, team, operator_name AS "operatorName", rubber_process AS "rubberProcess", line, measurement, array_to_string(units, \', \') AS units, action, comment'
  }
};
function invalid(message) { const error = new Error(message); error.status = 400; throw error; }
function dateRange(params) {
  const start = params.get('startDate');
  const end = params.get('endDate');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start || '') || !/^\d{4}-\d{2}-\d{2}$/.test(end || '')) invalid('startDate and endDate must use YYYY-MM-DD.');
  return [start, end];
}
function appearanceRecord(row) {
  return {
    id: row.id, date: row.date, team: row.team, operatorName: row.operatorName,
    trayId: row.trayId, cellId: row.cellId, channel: row.channel,
    jigLine: row.jigLine, hotJig: row.hotJig, degasLine: row.degasLine,
    defect: row.defects.join(', '), comment: row.comment,
    defectPhoto: row.defectPhoto, defectMap: JSON.stringify(row.defectMap || [])
  };
}
const appearanceSelect = [
  'a.id, a.recorded_at AS date, a.team, a.operator_name AS "operatorName",',
  'a.tray_id AS "trayId", a.cell_id AS "cellId", a.channel,',
  'a.jig_line AS "jigLine", a.hot_jig AS "hotJig", a.degas_line AS "degasLine",',
  'a.defect_types AS defects, a.comment, a.defect_map AS "defectMap",',
  'CASE WHEN p.inspection_id IS NOT NULL THEN \'/api/photos/\' || a.id ELSE a.legacy_photo_url END AS "defectPhoto"',
  'FROM formation.appearance_inspections a',
  'LEFT JOIN formation.appearance_photos p ON p.inspection_id = a.id'
].join(' ');

async function generalRecords(pool, process, limit, offset) {
  const config = GENERAL[process];
  const count = await pool.query('SELECT count(*)::int AS total FROM ' + config.table);
  const rows = await pool.query(
    'SELECT ' + config.columns + ' FROM ' + config.table + ' ORDER BY recorded_at DESC, id DESC LIMIT $1 OFFSET $2',
    [limit, offset]
  );
  return { data: rows.rows, total: count.rows[0].total };
}
async function appearanceRecords(pool, process, limit, offset) {
  const count = await pool.query(
    'SELECT count(*)::int AS total FROM formation.appearance_inspections WHERE process = $1',
    [process]
  );
  const rows = await pool.query(
    'SELECT ' + appearanceSelect + ' WHERE a.process = $1 ORDER BY a.recorded_at DESC, a.id DESC LIMIT $2 OFFSET $3',
    [process, limit, offset]
  );
  return { data: rows.rows.map(appearanceRecord), total: count.rows[0].total };
}
async function summary(pool, process, total, latest) {
  let defectCount = 0;
  if (APPEARANCE.has(process)) {
    const result = await pool.query(
      'SELECT count(*)::int AS count FROM formation.appearance_inspections WHERE process = $1 AND defect_types <> ARRAY[\'All OK\']::text[]',
      [process]
    );
    defectCount = result.rows[0].count;
  }
  return { totalRecords: total, defectCount, latest: latest || null };
}
function page(limit, offset, total) {
  return { limit, offset, nextOffset: offset + Math.min(limit, Math.max(0, total - offset)),
    hasMore: offset + limit < total, totalRecords: total };
}
async function rangeRecords(pool, process, params) {
  const [start, end] = dateRange(params);
  const zone = globalThis.process.env.FORMATION_TIME_ZONE || 'America/New_York';
  if (APPEARANCE.has(process)) {
    const rows = await pool.query(
      'SELECT ' + appearanceSelect + ' WHERE a.process = $1 AND (a.recorded_at AT TIME ZONE $4)::date BETWEEN $2::date AND $3::date ORDER BY a.recorded_at ASC, a.id ASC',
      [process, start, end, zone]
    );
    return rows.rows.map(appearanceRecord);
  }
  const rows = await pool.query(
    'SELECT ' + GENERAL.hta.columns + ' FROM formation.hta_readings WHERE (recorded_at AT TIME ZONE $3)::date BETWEEN $1::date AND $2::date ORDER BY recorded_at ASC, id ASC',
    [start, end, zone]
  );
  return rows.rows;
}
async function startupRecords(pool, process) {
  const rows = await pool.query(
    'SELECT c.recorded_at AS date, c.team, c.operator_name AS "operatorName", c.selector_type AS "selectorType", array_to_string(c.line_values, \', \') AS line, c.cdc_line AS "cdcLine", c.cdc_floor AS floor, c.check_completed AS "checkCompleted", c.frequency, i.item, i.status, i.comment FROM (SELECT * FROM formation.startup_checks WHERE process = $1 ORDER BY recorded_at DESC, id DESC LIMIT 1000) c JOIN formation.startup_check_items i ON i.check_id = c.id ORDER BY c.recorded_at ASC, c.id ASC, i.position ASC',
    [process]
  );
  return rows.rows.map(row => ({ ...row, line: process === 'startup_cdc' ? row.cdcLine : row.line }));
}
async function resealingRecords(pool) {
  const rows = await pool.query(
    'SELECT recorded_at AS date, operator_name AS "operatorName", shift, work_today AS work, inspection_status AS "inspectionStatus", cleaning_status AS "cleaningStatus", comment FROM (SELECT * FROM formation.resealing_checks ORDER BY recorded_at DESC, id DESC LIMIT 1000) r ORDER BY recorded_at ASC, id ASC'
  );
  return rows.rows;
}
async function ipRecords(pool) {
  const checks = await pool.query(
    'SELECT id, recorded_at AS date, check_date::text AS "checkDate", line FROM (SELECT * FROM formation.ip_checks ORDER BY recorded_at DESC, id DESC LIMIT 1000) c ORDER BY recorded_at ASC, id ASC'
  );
  if (!checks.rows.length) return [];
  const ids = checks.rows.map(row => row.id);
  const items = await pool.query(
    'SELECT check_id, measure_id AS id, process_label AS process, point, measure_name AS name, target, lane, plus_value AS plus, minus_value AS minus, in_range AS "inRange" FROM formation.ip_measurements WHERE check_id = ANY($1::bigint[]) ORDER BY check_id, position',
    [ids]
  );
  const byId = new Map(checks.rows.map(row => [String(row.id), { ...row, measurements: [] }]));
  for (const item of items.rows) byId.get(String(item.check_id)).measurements.push(item);
  return [...byId.values()];
}
export async function readInspection(pool, params) {
  const process = params.get('process');
  const action = params.get('action') || 'bootstrap';
  if (!APPEARANCE.has(process) && !STARTUP.has(process) && !GENERAL[process] && process !== 'startup_resealing' && process !== 'ip_dsf') invalid('Unknown process.');
  if (STARTUP.has(process) || process === 'startup_resealing' || process === 'ip_dsf') {
    if (!['bootstrap','records'].includes(action)) invalid('Unknown action.');
    const data = STARTUP.has(process) ? await startupRecords(pool, process)
      : process === 'startup_resealing' ? await resealingRecords(pool) : await ipRecords(pool);
    return { result: 'success', process, data };
  }
  if (action === 'map' || action === 'chart') {
    if ((action === 'map' && !APPEARANCE.has(process)) || (action === 'chart' && process !== 'hta')) invalid('Unsupported action.');
    return { result: 'success', process, data: await rangeRecords(pool, process, params) };
  }
  if (!['bootstrap','summary','records'].includes(action)) invalid('Unknown action.');
  const limit = Math.min(100, Math.max(1, Number(params.get('limit')) || 50));
  const offset = Math.max(0, Number(params.get('offset')) || 0);
  const results = APPEARANCE.has(process)
    ? await appearanceRecords(pool, process, limit, offset)
    : await generalRecords(pool, process, limit, offset);
  const response = { result: 'success', process,
    summary: await summary(pool, process, results.total, results.data[0]),
    data: results.data, pagination: page(limit, offset, results.total) };
  if (action === 'records') return response;
  if (action === 'summary') return { result: 'success', process, summary: response.summary };
  const rangeData = (APPEARANCE.has(process) || process === 'hta') ? await rangeRecords(pool, process, params) : [];
  return { result: 'success', process, summary: response.summary,
    records: response.data, pagination: response.pagination, rangeData };
}
export async function readPhoto(pool, id) {
  const rows = await pool.query(
    'SELECT mime_type, image_data FROM formation.appearance_photos WHERE inspection_id = $1',
    [id]
  );
  return rows.rows[0] || null;
}