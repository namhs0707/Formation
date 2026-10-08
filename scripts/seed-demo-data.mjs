// Fills a test database with dummy records for every page, spread over the last 60 days.
// Rows go through the app's own saveInspection, so they pass the same checks as real submissions,
// then get a backdated recorded_at and a source_key starting with "demo:" so they can be told apart.
// Runs once per database: if demo rows already exist it stops without adding more.
import pg from 'pg';
import { saveInspection, TEMPERATURE_AREAS } from '../server/records.mjs';

const DAYS = 60;
const pool = new pg.Pool({ max: 2 });

let seed = 20261008;
const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = values => values[Math.floor(random() * values.length)];
const chance = rate => random() < rate;
const between = (min, max, digits = 1) => Number((min + random() * (max - min)).toFixed(digits));

const TEAMS = ['1A', '1B', '2A', '2B'];
const NAMES = ['Kim Minsu', 'Lee Jiyoung', 'Park Sungho', 'Choi Yuna', 'John Smith', 'Maria Garcia', 'David Lee', 'Emily Johnson'];
const DEFECTS = ['Dent', 'Contamination', 'Scratch', 'Lead bending', 'Wrinkles', 'Unsealing pouch', 'Others'];
const FORMATION_LINES = ['3-1', '3-2', '3-3', '4-1', '4-2', '4-3', '5-1', '5-2', '5-3', '6-1', '6-2', '6-3'];
const EOL_LINES = ['4-1', '4-2', '5-1', '5-2'];

// Checklist item keys exactly as the page submits them ("group / value").
const STARTUP_ITEMS = {
  startup_hpcd: ['Loader/Unloader P&P / Gripper', 'Cleaning / Paper', 'Cleaning / Conveyor', 'Cleaning / Plexi-Glass'],
  startup_jig: ['Loader/Unloader P&P / Gripper', 'Loader/Unloader P&P / Rail', 'Loader/Unloader P&P / Shuttle', 'Loader/Unloader P&P / Dummy cell',
    'Main P&P / Gripper', 'Main P&P / Rail', 'Cleaning / PP', 'Cleaning / Hot jig'],
  startup_degas: [
    'Loader / Grippers position', 'Loader / Clean Loader Conveyor', 'Loader / Clean Loader Gripper Pads', 'Loader / Clean Loader Pitch Changer',
    'Loader / Clean Loader Flat Surfaces', 'Loader / Clean Cell Loader Shuttle', 'Degas / Clean Degas Gripper Pads', 'Degas / Clean Degas Flat Surfaces',
    'Degas / Clean Degas Chamber Nests', 'Main Sealing / Clean Main Sealing Tool', 'Main Sealing / Clean Main Sealing Suction Cups',
    'Main Sealing / Clean Pouch Cutter', 'Main Sealing / Clean Wing Press', 'Main Sealing / Clean Main Sealing Shuttle',
    'Main Sealing / Clean Main Sealing Flat Surfaces', 'Hot Press / Inspect Conductive Rubber', 'Hot Press / Inspect Copper Pin',
    'Hot Press / Clean Hot Press Plates', 'Hot Press / Clean Hot Press Suction Cups', 'Hot Press / Clean Hot Press Conveyor Belt',
    'Weight Checker / Clean Weight Checker', 'Unloader / Inspect Unloader Gripper Pads', 'Unloader / Clean Unloader Gripper Pads',
    'Unloader / Clean Unloader Flat Surfaces', 'Unloader / Clean Unloader Conveyor'],
  startup_cdc: [
    'Inspection / Inspect Box Doors/ Surrounding Areas', 'Inspection / Inspect Metal Panels (opposite of boxes)',
    'Cleaning / Clean Box Doors/ Surrounding Areas', 'Cleaning / Clean Metal Panels (opposite of boxes)',
    'Inspection / Inspect Grippers', 'Inspection / Inspect Lifting Platforms', 'Cleaning / Clean Grippers', 'Cleaning / Clean Lifting Platforms',
    'Inspection / Inspect Floors', 'Inspection / Inspect Handrails/ Stairs', 'Cleaning / Clean Floors', 'Cleaning / Clean Handrails/ Stairs',
    'Cleaning / Clean OCV Equipment'],
  startup_eol: [
    'Loader / Inspect Loader Gripper Pads', 'Loader / Inspect Loader Suction Cups', 'Loader / Grippers position', 'Loader / Clean Loader Conveyor',
    'Loader / Clean Loader Gripper Pads', 'Loader / Clean Loader Suction Cups', 'Loader / Clean Loader Flat Surfaces',
    'DSF / Inspect DSF P&P Suction Cups', 'DSF / Inspect DSF Aligners', 'DSF / Inspect DSF Wing Press', 'DSF / Inspect DSF Pouch Cutter',
    'DSF / Inspect DSF Corner Cutters', 'DSF / Inspect DSF Shuttle', 'DSF / Inspect DSF Wing Folder Press', 'DSF / Inspect DSF Folding Unit',
    'DSF / Inspect DSF NG Boxes', 'DSF / Inspect DSF BCR Scanner', 'DSF / IP Check every day one side of the EOL line',
    'DSF / Clean DSF P&P Suction Cups', 'DSF / Clean DSF Aligners', 'DSF / Clean DSF Pouch Cutter', 'DSF / Clean DSF Corner Cutters',
    'DSF / Clean DSF Flat Surfaces', 'Taper / Inspect Taper Suction Cups', 'Taper / Clean Taper Suction Cups', 'Taper / Clean Taper Blade',
    'Measurement / Inspect Weight Measurement', 'Measurement / Inspect IR Measurement', 'Measurement / Inspect Measurement Suction Cups',
    'Measurement / Inspect Measurement Shuttle', 'Measurement / Inspect Measurement NG Boxes', 'Measurement / Clean IV Measurement',
    'Measurement / Clean Thickness Measurement', 'Measurement / Clean Printer and Ink', 'Measurement / Clean Weight Measurement',
    'Measurement / Clean Measurement Suction Cups', 'Packer / Inspect Packer Suction Cup', 'Packer / Inspect Packer Aligners',
    'Packer / Inspect Packer BCR Scanner', 'Packer / Clean Packer Suction Cup', 'Packer / Clean Packer Aligners', 'Packer / Clean Packer Conveyor'],
  startup_selector: [
    'Grippers / Inspect Gripper Pads', 'Grippers / Grippers position', 'Grippers / Clean Gripper Pads', 'Plexi-Glass / Inspect all Plexi-Glass',
    'Plexi-Glass / Clean all Plexi-Glass', 'Rollers & Conveyors / Inspect Rollers and Conveyors', 'Rollers & Conveyors / Clean Rollers and Conveyors',
    'Pick and Place (P&P) / Inspect Pick and Place (P&P)', 'Pick and Place (P&P) / Inspect P&P Rail', 'Pick and Place (P&P) / Clean Pick and Place (P&P)',
    'Pick and Place (P&P) / Clean P&P Rail', 'Buffer & Aligning Stages / Inspect Buffer Tray Stage (holder)',
    'Buffer & Aligning Stages / Inspect Aligning Stage (aligners and contact points)', 'Buffer & Aligning Stages / Clean Buffer Tray Stage (holder)',
    'Buffer & Aligning Stages / Clean Aligning Stage (aligners and contact points)']
};
const DETAILED_STARTUP = new Set(['startup_degas', 'startup_cdc', 'startup_eol', 'startup_selector']);

// Mirrors IP_CHECK_GROUPS in formation.html.
const IP_GROUPS = [
  { id: 'second-wing', label: '2nd Wing Press', lanes: ['Common'], metrics: [
    ['a', 'Gap between upper block and lower block', '0.4 < X < 0.5', 0.4, 0.5],
    ['b', 'Datum Block ~ Press Tool', '2 < X < 2.5', 2, 2.5],
    ['c', 'Align Block ~ datum block', '120 < X < 122', 120, 122]] },
  { id: 'ninety-fold', label: '90° Folding', lanes: ['Common'], metrics: [
    ['a', 'Gap between upper knife and lower knife', '0.5 < X', 0.5, null],
    ['b', 'Gap between punch block and upper knife', '0.5 < X', 0.5, null]] },
  { id: 'third-wing', label: '3rd Wing Press', lanes: ['A', 'B'], metrics: [
    ['a', 'Gap between upper block and lower block', '0.8 < X < 1.0', 0.8, 1],
    ['b', 'Datum Block ~ Press Tool', '3.0 < X < 3.5', 3, 3.5],
    ['c', 'Align Block ~ datum block', '120 < X < 122', 120, 122]] },
  { id: 'two-seventy-fold', label: '270° Folding', lanes: ['A', 'B'], metrics: [
    ['a', 'Gap between punch block and lower knife after forward (punch descent)', '3 < X', 3, null],
    ['b', 'Gap between punch block and upper knife after forward (punch ascent)', '1.5 < X', 1.5, null],
    ['c', 'Gap between upper knife and lower knife', '1.5 < X', 1.5, null]] }
];

const PARENT_TABLE = {
  before_hpcd: 'appearance_inspections', formation: 'appearance_inspections', degas: 'appearance_inspections',
  hta: 'hta_readings', maintenance: 'eol_maintenance', conductive: 'conductive_maintenance',
  startup_resealing: 'resealing_checks', ip_dsf: 'ip_checks', ir: 'ir_checks'
};
const tableOf = (process, area) => area === 'hta' ? 'hta_readings'
  : area ? 'temperature_readings'
  : process.startsWith('startup_') && process !== 'startup_resealing' ? 'startup_checks' : PARENT_TABLE[process];

let counter = 0;
const added = {};
async function add(input, when, areaIds) {
  const result = await saveInspection(pool, input);
  const ids = result.ids || [result.id];
  const areas = input.process === 'temperature' ? input.areas.map(entry => entry.process) : [null];
  for (const [index, id] of ids.entries()) {
    const table = tableOf(input.process, areas[index]);
    counter += 1;
    await pool.query(`UPDATE formation.${table} SET recorded_at = $1, source_key = $2 WHERE id = $3`,
      [when, 'demo:' + table + ':' + counter, id]);
    const label = areas[index] || input.process;
    added[label] = (added[label] || 0) + 1;
  }
}

const people = () => ({ team: pick(TEAMS), operatorName: pick(NAMES) });

function appearance(process) {
  const base = { process, ...people(), trayId: 'T' + String(Math.floor(random() * 900000) + 100000) };
  if (!chance(0.35)) return { ...base, defect: ['All OK'] };
  const defects = [pick(DEFECTS)];
  if (chance(0.25)) defects.push(pick(DEFECTS.filter(value => value !== defects[0])));
  const points = Array.from({ length: 1 + Math.floor(random() * 3) }, () => ({ x: between(0.1, 0.9, 3), y: between(0.1, 0.9, 3) }));
  return {
    ...base, defect: defects, cellId: 'C' + Math.floor(random() * 9e8 + 1e8), channel: 1 + Math.floor(random() * 18),
    jigLine: pick(FORMATION_LINES), hotJig: 1 + Math.floor(random() * 15), degasLine: pick(EOL_LINES), hpcdLine: pick(['3', '4', '5', '6']),
    comment: chance(0.5) ? 'Demo: ' + defects.join(', ').toLowerCase() + ' found during check' : '', defectMap: JSON.stringify(points)
  };
}

// Mostly in spec; about 1 in 12 readings drifts out so the charts show a spec breach.
const temp = target => chance(1 / 12) ? between(target + 3.2, target + 5) : between(target - 2.5, target + 2.5);
function temperatureArea(process, target) {
  const area = TEMPERATURE_AREAS[process];
  const values = Object.fromEntries(area.fields.map(key => [key, temp(target)]));
  if (area.optionalFields) {
    for (const key of area.fields) if (chance(0.3)) values[key] = '';
  }
  const inSpec = Object.values(values).every(value => value === '' || Math.abs(value - target) <= 3) ? 'Yes' : 'No';
  const line = area.line ? (area.line.options ? pick(area.line.options) : process === 'temp_cdc' ? 'CDC ' + pick(['1', '2', '3']) : 'PRA ' + pick(['1', '2'])) : undefined;
  return { process, line, values, inSpec };
}
function htaArea() {
  return { process: 'hta', values: Object.fromEntries(['hta11', 'hta12', 'hta21', 'hta22', 'hta31', 'hta32', 'hta41', 'hta42'].map(key => [key, temp(60)])) };
}

function startup(process) {
  const keys = STARTUP_ITEMS[process];
  const input = { process, ...people(), frequency: chance(0.8) ? 'Shift' : pick(['Weekly', 'Monthly']) };
  if (process === 'startup_cdc') Object.assign(input, { cdcLine: 'CDC ' + pick(['1', '2', '3']), floor: pick(['1', '2', '3']) });
  else if (process === 'startup_selector') Object.assign(input, { lines: [pick(['#1', '#2', '#3', '#4', '#5', '#6'])], selectorType: pick(['Jig Selector', 'CDC Selector', 'OCV Selector']) });
  else if (['startup_degas', 'startup_eol'].includes(process)) input.lines = [pick(EOL_LINES)];
  else {
    const lines = process === 'startup_hpcd' ? ['3', '4', '5', '6'] : FORMATION_LINES;
    input.lines = lines.filter(() => chance(0.4));
    if (!input.lines.length) input.lines = [pick(lines)];
  }
  if (chance(0.05)) return { ...input, checkCompleted: 'No', items: [{ item: 'Check completed / Overall', status: 'No', comment: 'Demo: line down, check postponed' }] };
  const items = keys.map(item => {
    const cleaning = DETAILED_STARTUP.has(process) && / \/ Clean /.test(item);
    if (chance(0.04)) return cleaning
      ? { item, status: 'Incomplete', comment: 'Demo: not enough time this shift' }
      : { item, status: 'Flagged', comment: 'Demo: worn part, reported to maintenance' };
    if (chance(0.03)) return { item, status: 'N/A', comment: '' };
    return { item, status: cleaning ? 'Completed' : 'Pass', comment: '' };
  });
  return { ...input, checkCompleted: 'Yes', items };
}

function ip(dateText, line) {
  const measurements = IP_GROUPS.flatMap(group => group.lanes.flatMap(lane => group.metrics.map(([point, name, target, lower, upper]) => {
    const top = upper ?? lower + 1.5;
    const value = () => chance(0.06) ? Number((lower - 0.05).toFixed(3)) : between(lower + (top - lower) * 0.1, top - (top - lower) * 0.1, 3);
    const plus = value();
    const minus = value();
    const inside = number => number > lower && (upper == null || number < upper);
    return { id: group.id + '-' + point + '-' + lane.toLowerCase(), process: group.label, point, name, target, lane, plus, minus, inRange: inside(plus) && inside(minus) };
  })));
  return { process: 'ip_dsf', checkDate: dateText, line, measurements };
}

// PKG Lot ID rule: 4th char year (A = 2021), 5th month (A = January), two-digit day, then the line digit.
function irLot(date, line) {
  return '7' + String(Math.floor(random() * 90) + 10) + String.fromCharCode(65 + date.getFullYear() - 2021) +
    String.fromCharCode(65 + date.getMonth()) + String(date.getDate()).padStart(2, '0') + line + 'A' + Math.floor(random() * 10);
}
function ir(date) {
  const ngTray = chance(0.15) ? 1 + Math.floor(random() * 2) : 0;
  const tray = index => ({
    trayId: 'T' + String(Math.floor(random() * 900000) + 100000),
    values: Array.from({ length: 18 }, () => ngTray === index && chance(0.12) ? String(between(40, 95, 1)) : chance(0.6) ? 'OK' : String(between(150, 900, 1)))
  });
  return { process: 'ir', ...people(), location: pick(['Degas', 'Shipping Aging']), pkgLotId: irLot(date, pick(['4', '5'])), trays: [tray(1), tray(2)] };
}

const pad = number => String(number).padStart(2, '0');
// Local wall-clock time at the site (the PC's own zone), not UTC.
function at(day, hour) {
  const date = new Date(day);
  date.setHours(hour, Math.floor(random() * 60), Math.floor(random() * 60), 0);
  return date;
}

async function main() {
  const existing = await pool.query("SELECT count(*)::int AS n FROM formation.appearance_inspections WHERE source_key LIKE 'demo:%'");
  if (existing.rows[0].n) {
    console.log('Demo data is already in ' + process.env.PGDATABASE + '; nothing added.');
    return;
  }
  const now = new Date();
  for (let offset = DAYS - 1; offset >= 0; offset--) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
    const hours = Array.from({ length: 16 }, (_, index) => index + 6).filter(hour => offset > 0 || hour < now.getHours());
    if (!hours.length) continue;
    const when = () => at(day, pick(hours));
    const dateText = day.getFullYear() + '-' + pad(day.getMonth() + 1) + '-' + pad(day.getDate());

    for (const process of ['before_hpcd', 'formation', 'degas']) {
      for (let count = 2 + Math.floor(random() * 4); count > 0; count--) await add(appearance(process), when());
    }
    // Two temperature rounds a day; each round covers every area.
    for (let round = 0; round < 2; round++) {
      const areas = [htaArea(), temperatureArea('temp_cdc', 29),
        ...['temp_plt', 'temp_dgs', 'temp_eol', 'temp_jig', 'temp_pra', 'temp_rta', 'temp_sha'].map(process => temperatureArea(process, 23))];
      await add({ process: 'temperature', ...people(), areas }, when());
    }
    for (const process of Object.keys(STARTUP_ITEMS)) await add(startup(process), when());
    const shift = pick(['Day', 'Night']);
    const flagged = chance(0.08);
    await add({ process: 'startup_resealing', operatorName: pick(NAMES), shift, work: pick(['Resealing 120 cells', 'Resealing 80 cells', 'Tool change and resealing', 'Resealing NG rework']),
      inspectionStatus: flagged ? 'Flagged' : 'Pass', cleaningStatus: 'Completed', comment: flagged ? 'Demo: sealing tool edge worn' : '' }, when());
    for (const line of ['EOL #4-1', 'EOL #4-2', 'EOL #5-1', 'EOL #5-2']) if (chance(0.5)) await add(ip(dateText, line), when());
    for (let count = 1 + Math.floor(random() * 3); count > 0; count--) await add(ir(day), when());
    if (chance(0.4)) {
      const equipment = pick(['Tape', 'Knife']);
      await add({ process: 'maintenance', ...people(), line: 'EOL ' + pick(EOL_LINES), equipment,
        maintenance: equipment === 'Tape' ? 'Replace' : pick(['Cleaning', 'Replace']), tapingLine: pick(['Both', 'A', 'B']) }, when());
    }
    if (chance(0.35)) {
      const mode = pick(['Degas IR', 'EOL IR', 'EOL IV']);
      const units = { 'Degas IR': ['1A', '1B', '1C', '1D', '2A', '2B', '2C', '2D'], 'EOL IR': ['1A', '1B', '1C', '1D'], 'EOL IV': ['1A', '1B', '2A', '2B'] }[mode];
      const chosen = units.filter(() => chance(0.3));
      await add({ process: 'conductive', ...people(), rubberProcess: mode.split(' ')[0], measurement: mode.split(' ')[1], line: pick(EOL_LINES),
        units: chosen.length ? chosen : [units[0]], action: pick(['Flip', 'Flip', 'Change', 'Other']), comment: chance(0.3) ? 'Demo: low reading on rubber' : '' }, when());
    }
  }
  console.log('Added demo records to ' + process.env.PGDATABASE + ':');
  for (const [label, count] of Object.entries(added)) console.log('  ' + label.padEnd(18) + count);
}

try { await main(); } finally { await pool.end(); }
