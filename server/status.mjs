// Status views for the Start-up and Maintenance pages. Corrections made in review are applied before
// anything is counted, so the views match the record tables.
import { startupRecords, resealingRecords } from './read.mjs';
import { attachReviews } from './reviews.mjs';
import { CONDUCTIVE_UNITS_BY_MODE } from './records.mjs';

const STARTUP_SHEETS = [
  ['startup_hpcd', 'HPCD'], ['startup_jig', 'Jig'], ['startup_degas', 'Degas'], ['startup_cdc', 'CDC'],
  ['startup_eol', 'EOL'], ['startup_selector', 'Selector'], ['startup_resealing', 'Resealing']
];
const EOL_LINES = ['EOL 4-1', 'EOL 4-2', 'EOL 5-1', 'EOL 5-2'];
const RUBBER_LINES = ['4-1', '4-2', '5-1', '5-2'];
const DAY_MS = 24 * 60 * 60 * 1000;

function plantDay(zone) {
  const format = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return date => format.format(new Date(date));
}
// Whole days between two YYYY-MM-DD dates.
const daysBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);

async function startupStatus(pool, today, dayOf) {
  const days = Array.from({ length: 7 }, (_, index) => new Date(Date.parse(today) - (6 - index) * DAY_MS).toISOString().slice(0, 10));
  const sheets = [];
  for (const [process, name] of STARTUP_SHEETS) {
    const byDay = new Map(days.map(day => [day, { sheets: 0, issues: 0 }]));
    let last = null;
    const seen = date => { if (!last || new Date(date) > new Date(last)) last = date; };
    if (process === 'startup_resealing') {
      const rows = await attachReviews(pool, process, await resealingRecords(pool));
      for (const row of rows) {
        seen(row.date);
        const entry = byDay.get(dayOf(row.date));
        if (!entry) continue;
        entry.sheets += 1;
        if (row.inspectionStatus === 'Flagged' || row.cleaningStatus === 'Incomplete') entry.issues += 1;
      }
    } else {
      const items = await attachReviews(pool, process, await startupRecords(pool, process), row => row.checkId);
      const checks = new Map();
      for (const item of items) {
        const check = checks.get(item.checkId) || { date: item.date, issue: item.checkCompleted === 'No' };
        if (['Flagged', 'Incomplete', 'No'].includes(item.status)) check.issue = true;
        checks.set(item.checkId, check);
      }
      for (const check of checks.values()) {
        seen(check.date);
        const entry = byDay.get(dayOf(check.date));
        if (!entry) continue;
        entry.sheets += 1;
        if (check.issue) entry.issues += 1;
      }
    }
    sheets.push({ process, name, last, days: days.map(day => ({ day, ...byDay.get(day) })) });
  }
  return { days, sheets };
}

async function maintenanceStatus(pool, today, dayOf) {
  const rows = await attachReviews(pool, 'maintenance', (await pool.query(
    'SELECT id, recorded_at AS date, line, equipment, maintenance FROM formation.eol_maintenance WHERE recorded_at >= now() - interval \'2 years\' ORDER BY recorded_at'
  )).rows);
  const latest = new Map();
  for (const row of rows) latest.set(row.line + '|' + row.equipment + '|' + row.maintenance, row.date);
  const columns = [['Tape', 'Cleaning'], ['Tape', 'Replace'], ['Knife', 'Cleaning'], ['Knife', 'Replace']];
  return {
    columns: columns.map(([equipment, maintenance]) => ({ equipment, maintenance })),
    lines: EOL_LINES.map(line => ({
      line,
      cells: columns.map(([equipment, maintenance]) => {
        const date = latest.get(line + '|' + equipment + '|' + maintenance);
        return date ? { last: date, days: daysBetween(dayOf(date), today) } : { last: null, days: null };
      })
    }))
  };
}

async function conductiveStatus(pool, today, dayOf) {
  const rows = await attachReviews(pool, 'conductive', (await pool.query(
    'SELECT id, recorded_at AS date, rubber_process AS "rubberProcess", measurement, line, array_to_string(units, \', \') AS units, action ' +
    'FROM formation.conductive_maintenance WHERE recorded_at >= now() - interval \'2 years\' ORDER BY recorded_at'
  )).rows);
  const latest = new Map();
  for (const row of rows) {
    for (const unit of String(row.units || '').split(',').map(value => value.trim()).filter(Boolean)) {
      latest.set(row.rubberProcess + ' ' + row.measurement + '|' + row.line + '|' + unit, { date: row.date, action: row.action });
    }
  }
  return {
    modes: Object.entries(CONDUCTIVE_UNITS_BY_MODE).map(([mode, units]) => ({
      mode, units,
      lines: RUBBER_LINES.map(line => ({
        line,
        cells: units.map(unit => {
          const entry = latest.get(mode + '|' + line + '|' + unit);
          return entry ? { last: entry.date, action: entry.action, days: daysBetween(dayOf(entry.date), today) } : { last: null, days: null };
        })
      }))
    }))
  };
}

export async function readStatus(pool, view) {
  const zone = process.env.FORMATION_TIME_ZONE || 'America/New_York';
  const dayOf = plantDay(zone);
  const today = dayOf(new Date());
  const build = { startup: startupStatus, maintenance: maintenanceStatus, conductive: conductiveStatus }[view];
  if (!build) { const error = new Error('Unknown status view.'); error.status = 400; throw error; }
  return { today, timeZone: zone, ...(await build(pool, today, dayOf)) };
}
