// Today's status of every check, for the Summary page. "Today" is the calendar day in the plant time zone.
// bad = something out of spec today, idle = nothing recorded today, ok = recorded today and all fine,
// info = maintenance done only when needed, so only the last record is shown.
import { TEMPERATURE_AREAS } from './records.mjs';

const RECORD_TABLES = ['appearance_inspections', 'hta_readings', 'temperature_readings', 'eol_maintenance',
  'conductive_maintenance', 'startup_checks', 'resealing_checks', 'ip_checks', 'ir_checks'];
const APPEARANCE = [['before_hpcd', 'Before HPCD'], ['formation', 'Jig Formation'], ['degas', 'Degas']];
const STARTUP = [['startup_hpcd', 'HPCD'], ['startup_jig', 'Jig'], ['startup_degas', 'Degas'],
  ['startup_cdc', 'CDC'], ['startup_eol', 'EOL'], ['startup_selector', 'Selector']];
const AREA_NAMES = { temp_cdc: 'CDC', temp_plt: 'PLT', temp_dgs: 'DGS', temp_eol: 'EOL', temp_jig: 'JIG', temp_pra: 'PRA', temp_rta: 'RTA', temp_sha: 'SHA' };
// $1 = plant time zone, $2 = today's date in that zone.
const TODAY = '(recorded_at AT TIME ZONE $1)::date = $2::date';

const plural = (count, word) => count + ' ' + word + (count === 1 ? '' : 's');
const item = (name, process, status, detail, last) => ({ name, process, status, detail, last: last || null });

export async function readSummary(pool) {
  const zone = process.env.FORMATION_TIME_ZONE || 'America/New_York';
  const today = (await pool.query('SELECT (now() AT TIME ZONE $1)::date::text AS day', [zone])).rows[0].day;
  const ofToday = async sql => (await pool.query(sql, [zone, today])).rows;
  const ofAll = async sql => (await pool.query(sql)).rows;
  const lastBy = (rows, key, value) => rows.find(row => row[key] === value)?.last;

  const appearanceToday = await ofToday(
    'SELECT process, count(*)::int AS checks, count(*) FILTER (WHERE defect_types <> ARRAY[\'All OK\']::text[])::int AS defects, max(recorded_at) AS last ' +
    'FROM formation.appearance_inspections WHERE ' + TODAY + ' GROUP BY process');
  const appearanceLast = await ofAll('SELECT process, max(recorded_at) AS last FROM formation.appearance_inspections GROUP BY process');
  const appearance = APPEARANCE.map(([process, name]) => {
    const row = appearanceToday.find(r => r.process === process);
    if (!row) return item(name, process, 'idle', 'No inspection recorded today', lastBy(appearanceLast, 'process', process));
    return row.defects
      ? item(name, process, 'bad', plural(row.defects, 'defect') + ' in ' + plural(row.checks, 'check') + ' today', row.last)
      : item(name, process, 'ok', plural(row.checks, 'check') + ' today, no defects', row.last);
  });

  const htaToday = await ofToday('SELECT spec_result, recorded_at FROM formation.hta_readings WHERE ' + TODAY + ' ORDER BY recorded_at DESC');
  const htaLast = (await ofAll('SELECT max(recorded_at) AS last FROM formation.hta_readings'))[0].last;
  const htaOut = htaToday.filter(r => r.spec_result !== 'Spec in');
  const temperature = [
    !htaToday.length ? item('HTA', 'temperature', 'idle', 'No reading today', htaLast)
      : htaOut.length ? item('HTA', 'temperature', 'bad', 'Out of spec (57 to 63 °C): ' + htaOut[0].spec_result, htaToday[0].recorded_at)
      : item('HTA', 'temperature', 'ok', plural(htaToday.length, 'reading') + ' today, all in spec', htaToday[0].recorded_at)
  ];
  const areaToday = await ofToday(
    'SELECT area, count(*)::int AS readings, count(*) FILTER (WHERE in_spec = \'No\')::int AS out, max(recorded_at) AS last ' +
    'FROM formation.temperature_readings WHERE ' + TODAY + ' GROUP BY area');
  const areaLast = await ofAll('SELECT area, max(recorded_at) AS last FROM formation.temperature_readings GROUP BY area');
  for (const area of Object.keys(TEMPERATURE_AREAS)) {
    const row = areaToday.find(r => r.area === area);
    const name = AREA_NAMES[area];
    temperature.push(!row ? item(name, 'temperature', 'idle', 'No reading today', lastBy(areaLast, 'area', area))
      : row.out ? item(name, 'temperature', 'bad', plural(row.out, 'reading') + ' marked out of spec today', row.last)
      : item(name, 'temperature', 'ok', plural(row.readings, 'reading') + ' today, in spec', row.last));
  }

  const latest = async table => (await ofAll('SELECT * FROM formation.' + table + ' ORDER BY recorded_at DESC, id DESC LIMIT 1'))[0];
  const tape = await latest('eol_maintenance');
  const rubber = await latest('conductive_maintenance');
  const maintenance = [
    item('EOL Tape/Knife', 'maintenance', 'info',
      tape ? 'Last: ' + tape.line + ' ' + tape.equipment + ' ' + tape.maintenance.toLowerCase() : 'No record yet', tape?.recorded_at),
    item('Conductive Rubber', 'conductive', 'info',
      rubber ? 'Last: ' + rubber.rubber_process + ' ' + rubber.measurement + ' line ' + rubber.line + ', ' + rubber.action.toLowerCase() : 'No record yet', rubber?.recorded_at)
  ];

  const startupToday = await ofToday(
    'SELECT c.process, count(DISTINCT c.id)::int AS checks, max(c.recorded_at) AS last, ' +
    'count(DISTINCT c.id) FILTER (WHERE c.check_completed = \'No\' OR i.status IN (\'Flagged\', \'Incomplete\', \'No\'))::int AS issues ' +
    'FROM formation.startup_checks c LEFT JOIN formation.startup_check_items i ON i.check_id = c.id ' +
    'WHERE (c.recorded_at AT TIME ZONE $1)::date = $2::date GROUP BY c.process');
  const startupLast = await ofAll('SELECT process, max(recorded_at) AS last FROM formation.startup_checks GROUP BY process');
  const startup = STARTUP.map(([process, name]) => {
    const row = startupToday.find(r => r.process === process);
    if (!row) return item(name, process, 'idle', 'No check sheet today', lastBy(startupLast, 'process', process));
    return row.issues
      ? item(name, process, 'bad', plural(row.issues, 'sheet') + ' with flagged, incomplete or "No" items', row.last)
      : item(name, process, 'ok', plural(row.checks, 'sheet') + ' today, all passed', row.last);
  });
  const resealToday = await ofToday('SELECT inspection_status, cleaning_status, recorded_at FROM formation.resealing_checks WHERE ' + TODAY + ' ORDER BY recorded_at DESC');
  const resealLast = await latest('resealing_checks');
  const resealIssue = resealToday.some(r => r.inspection_status === 'Flagged' || r.cleaning_status === 'Incomplete');
  startup.push(!resealToday.length ? item('Resealing Machine', 'startup_resealing', 'idle', 'No check today', resealLast?.recorded_at)
    : resealIssue ? item('Resealing Machine', 'startup_resealing', 'bad', 'Tool flagged or cleaning incomplete', resealToday[0].recorded_at)
    : item('Resealing Machine', 'startup_resealing', 'ok', 'Inspected and cleaned', resealToday[0].recorded_at));

  const ipToday = (await pool.query(
    'SELECT c.line, max(c.recorded_at) AS last, count(m.id) FILTER (WHERE NOT m.in_range)::int AS out ' +
    'FROM formation.ip_checks c LEFT JOIN formation.ip_measurements m ON m.check_id = c.id ' +
    'WHERE c.check_date = $1::date GROUP BY c.line ORDER BY c.line', [today])).rows;
  const ipLast = await latest('ip_checks');
  const ipOut = ipToday.filter(r => r.out);
  const ip = [!ipToday.length ? item('DSF Daily IP', 'ip_dsf', 'idle', 'No check dated today', ipLast?.recorded_at)
    : ipOut.length ? item('DSF Daily IP', 'ip_dsf', 'bad', ipOut.map(r => r.line + ': ' + plural(r.out, 'point') + ' out of range').join('; '), ipToday[0].last)
    : item('DSF Daily IP', 'ip_dsf', 'ok', ipToday.map(r => r.line).join(', ') + ' checked, all in range', ipToday[0].last)];

  const irToday = await ofToday(
    'SELECT c.pkg_lot_id, c.recorded_at, count(v.id) FILTER (WHERE v.result = \'NG\')::int AS ng ' +
    'FROM formation.ir_checks c LEFT JOIN formation.ir_values v ON v.check_id = c.id ' +
    'WHERE (c.recorded_at AT TIME ZONE $1)::date = $2::date GROUP BY c.id ORDER BY c.recorded_at DESC');
  const irLast = await latest('ir_checks');
  const irNg = irToday.filter(r => r.ng);
  const ir = [!irToday.length ? item('IR', 'ir', 'idle', 'No IR check today', irLast?.recorded_at)
    : irNg.length ? item('IR', 'ir', 'bad', 'NG in ' + irNg.length + ' of ' + plural(irToday.length, 'check') + ' today (' + irNg.slice(0, 3).map(r => r.pkg_lot_id).join(', ') + ')', irToday[0].recorded_at)
    : item('IR', 'ir', 'ok', plural(irToday.length, 'check') + ' today, no NG', irToday[0].recorded_at)];

  // Records from the last 7 days with no confirmation after their latest correction.
  const pending = await ofAll(RECORD_TABLES.map(table =>
    'SELECT r.recorded_at FROM formation.' + table + ' r WHERE r.recorded_at >= now() - interval \'7 days\' ' +
    'AND NOT EXISTS (SELECT 1 FROM formation.record_reviews c WHERE c.record_type = \'' + table + '\' AND c.record_id = r.id ' +
    'AND c.action = \'confirm\' AND c.recorded_at > coalesce((SELECT max(e.recorded_at) FROM formation.record_reviews e ' +
    'WHERE e.record_type = \'' + table + '\' AND e.record_id = r.id AND e.action = \'edit\'), \'-infinity\'))'
  ).join(' UNION ALL '));

  return {
    today, timeZone: zone,
    groups: [
      { name: 'Appearance', items: appearance },
      { name: 'Temperature', items: temperature },
      { name: 'Maintenance', items: maintenance },
      { name: 'Start-up', items: startup },
      { name: 'IP check sheet', items: ip },
      { name: 'IR', items: ir }
    ],
    reviews: {
      pending: pending.length,
      oldest: pending.reduce((oldest, row) => !oldest || row.recorded_at < oldest ? row.recorded_at : oldest, null)
    }
  };
}
