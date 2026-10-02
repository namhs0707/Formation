/**
 * Jig Formation and Degas inspection API.
 *
 * Run setup() once after saving this file.
 * Then deploy a new web-app version.
 */
const CONFIG = Object.freeze({
  SPREADSHEET_ID: '19JnDzOotmIc_c0kWPszNNdWahUgvpf4p0ZGwDm6Ck0I',
  BEFORE_HPCD_SHEET_NAME: 'Before HPCD',
  FORMATION_SHEET_NAME: 'Jig visual inspection',
  DEGAS_SHEET_NAME: 'Degas inspection',
  HTA_SHEET_NAME: 'HTA temp',
  MAINTENANCE_SHEET_NAME: 'EOL Tape Knife',
  CONDUCTIVE_RUBBER_SHEET_NAME: 'Conductive Rubber',
  STARTUP_SHEET_NAMES: Object.freeze({
    startup_hpcd: 'Start-up HPCD Check',
    startup_jig: 'Start-up Jig Check',
    startup_degas: 'Start-up Degas Check',
    startup_cdc: 'Start-up CDC Check',
    startup_eol: 'Start-up EOL Check',
    startup_selector: 'Start-up Selector Check'
  }),
  RESEALING_SHEET_NAME: 'Resealing Machine Check',
  IP_DSF_SHEET_NAME: 'DSF Daily IP Check',
  CHECK_SHEET_READ_ROWS: 3000,
  FORMATION_PHOTO_FOLDER_ID: '1sjdqljzpJOtAuudYBeotwXeUsxJjSdyM',
  DEGAS_PHOTO_FOLDER_ID: '10hybzCCycMsBLscf2qxIADiNgaBsQqbQ',
  MAKE_PHOTOS_PUBLIC: true,
  MAX_PHOTO_BYTES: 8 * 1024 * 1024,
  CACHE_SECONDS: 45
});

const FORMATION_HEADERS = Object.freeze([
  'Date',
  'Team',
  'Operator Name',
  'Tray ID',
  'Cell ID',
  'Channel',
  'Jig line',
  'Hot jig',
  'Defect',
  'Comment',
  'Defect photo',
  'Defect map'
]);

const BEFORE_HPCD_HEADERS = Object.freeze([
  'Date',
  'Team',
  'Operator name',
  'Tray ID',
  'Defect type',
  'Cell ID',
  'Channel',
  'Comment',
  'Photo',
  'Defect map'
]);

const DEGAS_HEADERS = Object.freeze([
  'Date',
  'Team',
  'Operator Name',
  'Tray ID',
  'Cell ID',
  'Channel',
  'Degas line',
  'Defect',
  'Comment',
  'Defect photo',
  'Defect map'
]);

const HTA_HEADERS = Object.freeze([
  'Date',
  'Team',
  'Operator name',
  'HTA 1-1',
  'HTA 1-2',
  'HTA 2-1',
  'HTA 2-2',
  'HTA 3-1',
  'HTA 3-2',
  'HTA 4-1',
  'HTA 4-2',
  'Temp. In spec'
]);

const MAINTENANCE_HEADERS = Object.freeze([
  'Date',
  'Team',
  'Operator name',
  'Line',
  'Tape/Knife',
  'Maintenance',
  'Taping line'
]);

const CONDUCTIVE_RUBBER_HEADERS = Object.freeze([
  'Date',
  'Team',
  'Operator name',
  'Process',
  'Line',
  'Measurement',
  'Unit',
  'Action',
  'Comment'
]);

// One row per check item; Submission ID groups the rows of one submitted sheet.
const STARTUP_HEADERS = Object.freeze([
  'Date',
  'Team',
  'Operator name',
  'Selector',
  'Line',
  'Floor',
  'Check completed',
  'Frequency',
  'Category',
  'Item',
  'Status',
  'Comment',
  'Submission ID'
]);

const RESEALING_HEADERS = Object.freeze([
  'Date',
  'Operator name',
  'Shift',
  'Work today',
  'Inspection',
  'Cleaning',
  'Comment'
]);

// One row per measurement point; Submission ID groups the rows of one IP check.
const IP_DSF_HEADERS = Object.freeze([
  'Date',
  'Check date',
  'Line',
  'Measure ID',
  'Process',
  'Point',
  'Measurement',
  'Target',
  'Lane',
  '(+)',
  '(-)',
  'In range',
  'Submission ID'
]);

const STARTUP_PROCESSES = Object.freeze(Object.keys(CONFIG.STARTUP_SHEET_NAMES));
const SINGLE_LINE_STARTUP_PROCESSES = Object.freeze(['startup_degas', 'startup_eol', 'startup_selector']);
const STARTUP_STATUSES = Object.freeze(['Pass', 'Flagged', 'Incomplete', 'Completed', 'N/A', 'No']);
const SELECTOR_TYPES = Object.freeze(['Jig Selector', 'CDC Selector', 'OCV Selector']);

const CONDUCTIVE_RUBBER_UNITS = Object.freeze([
  '1A', '1B', '1C', '1D',
  '2A', '2B', '2C', '2D'
]);

const DEFECT_TYPES = Object.freeze([
  'All OK',
  'Dent',
  'Contamination',
  'Scratch',
  'Lead bending',
  'Wrinkles',
  'Unsealing pouch',
  'Others'
]);

const HTA_FIELDS = Object.freeze([
  { key: 'hta11', label: 'HTA 1-1' },
  { key: 'hta12', label: 'HTA 1-2' },
  { key: 'hta21', label: 'HTA 2-1' },
  { key: 'hta22', label: 'HTA 2-2' },
  { key: 'hta31', label: 'HTA 3-1' },
  { key: 'hta32', label: 'HTA 3-2' },
  { key: 'hta41', label: 'HTA 4-1' },
  { key: 'hta42', label: 'HTA 4-2' }
]);

const TEAMS = Object.freeze(['1A', '1B', '2A', '2B']);

function temperatureFields_(prefix, labelPrefix, suffixes) {
  return suffixes.map(function(suffix) {
    return { key: prefix + suffix.replace(/[^0-9A-Za-z]/g, ''), label: labelPrefix + suffix };
  });
}

/**
 * Area temperature sheets. HTA keeps its own sheet and process ('hta').
 * A field list marked optional only needs one value per submission (JIG).
 */
const TEMPERATURE_AREAS = Object.freeze({
  temp_cdc: {
    sheet: 'CDC temp', line: { label: 'CDC line', maxLength: 32 },
    fields: temperatureFields_('floor', 'Floor ', ['1-1', '1-2', '2-1', '2-2', '3-1', '3-2']).concat([{ key: 'dcir', label: 'DCIR' }])
  },
  temp_plt: {
    sheet: 'Cell PLT temp',
    fields: [{ key: 'pltEast', label: 'PLT East' }, { key: 'pltWest', label: 'PLT West' }]
  },
  temp_dgs: {
    sheet: 'DGS temp', line: { label: 'Degas line', options: ['4-1', '4-2', '5-1', '5-2'] },
    fields: [{ key: 'dgs', label: 'DGS' }]
  },
  temp_eol: {
    sheet: 'EOL temp', line: { label: 'EOL line', options: ['4-1', '4-2', '5-1', '5-2'] },
    fields: [{ key: 'eol', label: 'EOL' }]
  },
  temp_jig: {
    sheet: 'JIG temp', line: { label: 'Jig Formation line', options: ['3', '4', '5', '6'] }, optionalFields: true,
    fields: temperatureFields_('floor', 'Floor ', ['1', '2', '3'])
      .concat(temperatureFields_('jig', 'JIG ', ['4-1', '4-2', '4-3', '5-1', '5-2', '5-3']))
  },
  temp_pra: {
    sheet: 'PRA temp', line: { label: 'PRA line', maxLength: 32 },
    fields: [{ key: 'praEast', label: 'PRA East' }, { key: 'praWest', label: 'PRA West' }]
  },
  temp_rta: {
    sheet: 'RTA temp',
    fields: [{ key: 'rtaEast', label: 'RTA East Area' }, { key: 'rtaWest', label: 'RTA West Area' }]
  },
  temp_sha: {
    sheet: 'SHA temp',
    fields: temperatureFields_('shaEast', 'SHA East Aisle #', ['1', '2', '3', '4', '5'])
      .concat(temperatureFields_('shaWest', 'SHA West Aisle #', ['1', '2', '3', '4', '5']))
  }
});

function isTemperatureAreaProcess_(process) {
  return Object.prototype.hasOwnProperty.call(TEMPERATURE_AREAS, process);
}

function getTemperatureHeaders_(process) {
  const area = TEMPERATURE_AREAS[process];
  return ['Date', 'Team', 'Operator name']
    .concat(area.line ? [area.line.label] : [])
    .concat(area.fields.map(function(field) { return field.label; }))
    .concat(['Temp. In spec']);
}

/**
 * Run once to verify the existing Formation sheet and create the Degas sheet.
 */
function setup() {
  const beforeHpcdSheet = getSheet_('before_hpcd');
  const formationSheet = getSheet_('formation');
  const degasSheet = getSheet_('degas');
  const htaSheet = getSheet_('hta');
  const maintenanceSheet = getSheet_('maintenance');
  const conductiveRubberSheet = getSheet_('conductive');

  ensureHeaders_(beforeHpcdSheet, BEFORE_HPCD_HEADERS);
  ensureHeaders_(formationSheet, FORMATION_HEADERS);
  ensureHeaders_(degasSheet, DEGAS_HEADERS);
  ensureHeaders_(htaSheet, HTA_HEADERS);
  ensureHeaders_(maintenanceSheet, MAINTENANCE_HEADERS);
  ensureConductiveRubberHeaders_(conductiveRubberSheet);
  STARTUP_PROCESSES.concat(['startup_resealing', 'ip_dsf'], Object.keys(TEMPERATURE_AREAS)).forEach(function(process) {
    ensureHeaders_(getSheet_(process), getHeaders_(process));
  });
  normalizeFormationJigLines_(formationSheet);

  DriveApp.getFolderById(CONFIG.FORMATION_PHOTO_FOLDER_ID).getName();
  DriveApp.getFolderById(CONFIG.DEGAS_PHOTO_FOLDER_ID).getName();
}

function doGet(e) {
  try {
    const parameters = e && e.parameter ? e.parameter : {};
    const process = getProcess_(parameters.process);
    const action = String(parameters.action || 'all').toLowerCase();
    const headers = getHeaders_(process);
    const sheet = getSheet_(process);

    if (isCheckSheetProcess_(process)) {
      return json_({ result: 'success', process: process, data: readCheckSheetRecords_(sheet, process, headers) });
    }
    if (action === 'bootstrap') {
      return json_(getCachedResponse_(sheet, process, action, parameters, function() {
        return getBootstrapResponse_(sheet, process, headers, parameters);
      }));
    }
    if (action === 'summary') {
      return json_(getCachedResponse_(sheet, process, action, parameters, function() {
        return getSummaryResponse_(sheet, process, headers);
      }));
    }
    if (action === 'records') {
      return json_(getCachedResponse_(sheet, process, action, parameters, function() {
        return getRecordsResponse_(sheet, process, headers, parameters);
      }));
    }
    if (action === 'map' || action === 'chart') {
      return json_(getCachedResponse_(sheet, process, action, parameters, function() {
        return getDateRangeResponse_(sheet, process, headers, parameters, action);
      }));
    }
    return json_({ result: 'success', process: process, data: readRecords_(sheet, process, headers, 2, Math.max(0, sheet.getLastRow() - 1)) });
  } catch (error) {
    console.error(error);
    return json_({ result: 'error', message: error.message });
  }
}

function getCachedResponse_(sheet, process, action, parameters, producer) {
  const refresh = String(parameters.refresh || '') === '1';
  const key = [
    'dashboard-v3', process, action, sheet.getLastRow(),
    String(parameters.startDate || ''), String(parameters.endDate || ''),
    String(parameters.limit || ''), String(parameters.offset || '')
  ].join(':');
  const cache = CacheService.getScriptCache();
  if (!refresh) {
    const cached = cache.get(key);
    if (cached) return JSON.parse(cached);
  }

  const response = producer();
  try {
    const serialized = JSON.stringify(response);
    if (serialized.length < 95000) cache.put(key, serialized, CONFIG.CACHE_SECONDS);
  } catch (error) {
    console.warn('Dashboard cache skipped: ' + error.message);
  }
  return response;
}

function getBootstrapResponse_(sheet, process, headers, parameters) {
  const recordsResponse = getRecordsResponse_(sheet, process, headers, parameters);
  let rangeData = [];
  if (isAppearanceProcess_(process)) {
    rangeData = getDateRangeResponse_(sheet, process, headers, parameters, 'map').data;
  } else if (process === 'hta') {
    rangeData = getDateRangeResponse_(sheet, process, headers, parameters, 'chart').data;
  }
  return {
    result: 'success',
    process: process,
    summary: getSummaryResponse_(sheet, process, headers).summary,
    records: recordsResponse.data,
    pagination: recordsResponse.pagination,
    rangeData: rangeData
  };
}

function getSummaryResponse_(sheet, process, headers) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return { result: 'success', process: process, summary: { totalRecords: 0, defectCount: 0, latest: null } };
  }

  const totalRecords = lastRow - 1;
  const latest = readRecords_(sheet, process, headers, lastRow, 1)[0] || null;
  let defectCount = 0;
  if (isAppearanceProcess_(process)) {
    const defectColumn = process === 'before_hpcd' ? 5 : process === 'degas' ? 8 : 9;
    defectCount = sheet.getRange(2, defectColumn, totalRecords, 1).getDisplayValues()
      .reduce(function(total, row) {
        const value = String(row[0] || '').trim();
        return total + (value && value !== 'All OK' ? 1 : 0);
      }, 0);
  }

  return {
    result: 'success',
    process: process,
    summary: { totalRecords: totalRecords, defectCount: defectCount, latest: latest }
  };
}

function getRecordsResponse_(sheet, process, headers, parameters) {
  const totalRecords = Math.max(0, sheet.getLastRow() - 1);
  const limit = Math.min(100, Math.max(1, Number(parameters.limit) || 50));
  const offset = Math.max(0, Number(parameters.offset) || 0);
  const available = Math.max(0, totalRecords - offset);
  const count = Math.min(limit, available);
  const startRow = count ? sheet.getLastRow() - offset - count + 1 : 2;
  const data = readRecords_(sheet, process, headers, startRow, count).reverse();
  return {
    result: 'success',
    process: process,
    data: data,
    pagination: { limit: limit, offset: offset, nextOffset: offset + count, hasMore: offset + count < totalRecords, totalRecords: totalRecords }
  };
}

function getDateRangeResponse_(sheet, process, headers, parameters, action) {
  if (action === 'chart' && process !== 'hta' && !isTemperatureAreaProcess_(process)) {
    throw new Error('Chart data is only available for temperature areas.');
  }
  if (action === 'map' && !isAppearanceProcess_(process)) throw new Error('Map data is only available for Appearance processes.');

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { result: 'success', process: process, data: [] };
  const startDate = String(parameters.startDate || '');
  const endDate = String(parameters.endDate || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error('startDate and endDate must use YYYY-MM-DD.');
  }

  const dateRows = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
  let firstMatch = -1;
  let lastMatch = -1;
  dateRows.forEach(function(row, index) {
    const dateKey = getDateKey_(row[0]);
    if (dateKey >= startDate && dateKey <= endDate) {
      if (firstMatch < 0) firstMatch = index;
      lastMatch = index;
    }
  });
  if (firstMatch < 0) return { result: 'success', process: process, data: [] };

  const rows = sheet.getRange(firstMatch + 2, 1, lastMatch - firstMatch + 1, headers.length).getDisplayValues();
  const data = rows.filter(function(row) {
    const dateKey = getDateKey_(row[0]);
    return dateKey >= startDate && dateKey <= endDate;
  }).map(function(row) {
    return rowToRecord_(row, process);
  });
  return {
    result: 'success',
    process: process,
    data: data
  };
}

function getDateKey_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

function readRecords_(sheet, process, headers, startRow, count) {
  if (!count) return [];
  return sheet.getRange(startRow, 1, count, headers.length).getDisplayValues().map(function(row) {
    return rowToRecord_(row, process);
  });
}

/**
 * Start-up, Resealing and IP sheets: the latest rows in ascending order,
 * matching what the dashboard expects for these check-sheet processes.
 */
function readCheckSheetRecords_(sheet, process, headers) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const count = Math.min(lastRow - 1, CONFIG.CHECK_SHEET_READ_ROWS);
  const rows = sheet.getRange(lastRow - count + 1, 1, count, headers.length).getDisplayValues();
  if (process !== 'ip_dsf') {
    return rows.map(function(row) { return rowToRecord_(row, process); });
  }

  const checks = [];
  const bySubmission = {};
  rows.forEach(function(row) {
    const submissionId = row[12] || row[0] + '|' + row[1] + '|' + row[2];
    let check = bySubmission[submissionId];
    if (!check) {
      check = { date: row[0], checkDate: row[1], line: row[2], measurements: [] };
      bySubmission[submissionId] = check;
      checks.push(check);
    }
    check.measurements.push({
      id: row[3], process: row[4], point: row[5], name: row[6], target: row[7], lane: row[8],
      plus: row[9] === '' ? null : Number(row[9]),
      minus: row[10] === '' ? null : Number(row[10]),
      inRange: String(row[11]).toUpperCase() === 'TRUE'
    });
  });
  return checks;
}

function rowToRecord_(row, process) {
    if (isStartupProcess_(process)) {
      return {
        date: row[0], team: row[1], operatorName: row[2], selectorType: row[3],
        line: row[4], floor: row[5], checkCompleted: row[6], frequency: row[7],
        item: row[9] ? row[8] + ' / ' + row[9] : row[8], status: row[10], comment: row[11]
      };
    }
    if (process === 'startup_resealing') {
      return { date: row[0], operatorName: row[1], shift: row[2], work: row[3], inspectionStatus: row[4], cleaningStatus: row[5], comment: row[6] };
    }
    if (isTemperatureAreaProcess_(process)) {
      const area = TEMPERATURE_AREAS[process];
      const record = { date: row[0], team: row[1], operatorName: row[2] };
      let column = 3;
      if (area.line) record.line = row[column++];
      area.fields.forEach(function(field) { record[field.key] = row[column++]; });
      record.tempInSpec = row[column];
      return record;
    }
    if (process === 'hta') {
      return { date: row[0], team: row[1], operatorName: row[2], hta11: row[3], hta12: row[4], hta21: row[5], hta22: row[6], hta31: row[7], hta32: row[8], hta41: row[9], hta42: row[10], tempInSpec: row[11] };
    }
    if (process === 'maintenance') {
      return { date: row[0], team: row[1], operatorName: row[2], line: row[3], equipment: row[4], maintenance: row[5], tapingLine: row[6] };
    }
    if (process === 'conductive') {
      return { date: row[0], team: row[1], operatorName: row[2], rubberProcess: row[3], line: row[4], measurement: row[5], units: row[6], action: row[7], comment: row[8] };
    }
    const common = { date: row[0], team: row[1], operatorName: row[2], trayId: row[3], cellId: row[4], channel: row[5] };
    if (process === 'before_hpcd') {
      return {
        date: row[0], team: row[1], operatorName: row[2], trayId: row[3],
        defect: row[4], cellId: row[5], channel: row[6], comment: row[7],
        defectPhoto: row[8], defectMap: row[9] || '[]'
      };
    }
    if (process === 'degas') {
      return Object.assign(common, { degasLine: row[6], defect: row[7], comment: row[8], defectPhoto: row[9], defectMap: row[10] || '[]' });
    }
    return Object.assign(common, { jigLine: row[6], hotJig: row[7], defect: row[8], comment: row[9], defectPhoto: row[10], defectMap: row[11] || '[]' });
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error('No inspection data was received.');
    }

    const input = JSON.parse(e.postData.contents);
    const process = getProcess_(input.process);
    if (process === 'temperature') {
      validateTemperatureInput_(input);
      saveTemperatureReadings_(input);
      return json_({ result: 'success', process: process, message: 'Temperature readings submitted successfully.' });
    }
    validateInput_(input, process);

    let photoUrl = '';
    if (isAppearanceProcess_(process) && input.defectPhotoData) {
      photoUrl = savePhoto_(
        input.defectPhotoData,
        input.defectPhotoName,
        input.defectPhotoType,
        input.trayId,
        process
      );
    }

    const lock = LockService.getScriptLock();
    lock.waitLock(30000);

    try {
      const headers = getHeaders_(process);
      const sheet = getSheet_(process);
      ensureHeaders_(sheet, headers);

      let row;
      let rows = null;
      const submittedAt = new Date();
      const submissionId = Utilities.getUuid();
      if (isStartupProcess_(process)) {
        const isCdc = process === 'startup_cdc';
        rows = input.items.map(function(item) {
          const categoryItem = String(item.item || '').split(' / ');
          return [
            submittedAt,
            cleanText_(input.team),
            cleanText_(input.operatorName),
            process === 'startup_selector' ? cleanText_(input.selectorType) : '',
            isCdc ? cleanText_(input.cdcLine) : normalizeLineList_(input.lines).join(', '),
            isCdc ? cleanText_(input.floor) : '',
            cleanText_(input.checkCompleted),
            cleanText_(input.frequency),
            cleanText_(categoryItem[0]),
            cleanText_(categoryItem.slice(1).join(' / ')),
            cleanText_(item.status),
            cleanText_(item.comment),
            submissionId
          ];
        });
      } else if (process === 'startup_resealing') {
        row = [
          submittedAt,
          cleanText_(input.operatorName),
          cleanText_(input.shift),
          cleanText_(input.work),
          cleanText_(input.inspectionStatus),
          cleanText_(input.cleaningStatus),
          cleanText_(input.comment)
        ];
      } else if (process === 'ip_dsf') {
        rows = input.measurements.map(function(item) {
          return [
            submittedAt,
            cleanText_(input.checkDate),
            cleanText_(input.line),
            cleanText_(item.id),
            cleanText_(item.process),
            cleanText_(item.point),
            cleanText_(item.name),
            cleanText_(item.target),
            cleanText_(item.lane),
            Number(item.plus),
            Number(item.minus),
            Boolean(item.inRange),
            submissionId
          ];
        });
      } else if (process === 'hta') {
        const temperatures = HTA_FIELDS.map(function(field) {
          return Number(input[field.key]);
        });
        row = [
          new Date(),
          cleanText_(input.team),
          cleanText_(input.operatorName)
        ].concat(temperatures, [getTempSpecResult_(input)]);
      } else if (process === 'maintenance') {
        row = [
          new Date(),
          cleanText_(input.team),
          cleanText_(input.operatorName),
          cleanText_(input.line),
          cleanText_(input.equipment),
          cleanText_(input.maintenance),
          cleanText_(input.tapingLine)
        ];
      } else if (process === 'conductive') {
        row = [
          new Date(),
          cleanText_(input.team),
          cleanText_(input.operatorName),
          cleanText_(input.rubberProcess),
          cleanText_(input.line),
          cleanText_(input.measurement),
          normalizeConductiveUnits_(input.units).join(', '),
          cleanText_(input.action),
          cleanText_(input.comment)
        ];
      } else {
        const defects = normalizeDefectTypes_(input.defect);
        const defectText = defects.join(', ');
        const isAllOk = defects.length === 1 && defects[0] === 'All OK';
        const common = [
          new Date(),
          cleanText_(input.team),
          cleanText_(input.operatorName),
          cleanText_(input.trayId),
          isAllOk ? '' : cleanText_(input.cellId),
          isAllOk ? '' : Number(input.channel)
        ];

        row = process === 'before_hpcd'
          ? [
              new Date(),
              cleanText_(input.team),
              cleanText_(input.operatorName),
              cleanText_(input.trayId),
              defectText,
              isAllOk ? '' : cleanText_(input.cellId),
              isAllOk ? '' : Number(input.channel),
              cleanText_(input.comment),
              photoUrl,
              normalizeDefectMap_(input.defectMap)
            ]
          : process === 'degas'
            ? common.concat([
              isAllOk ? '' : cleanText_(input.degasLine),
              defectText,
              cleanText_(input.comment),
              photoUrl,
              normalizeDefectMap_(input.defectMap)
            ])
            : common.concat([
              isAllOk ? '' : cleanText_(input.jigLine),
              isAllOk ? '' : Number(input.hotJig),
              defectText,
              cleanText_(input.comment),
              photoUrl,
              normalizeDefectMap_(input.defectMap)
            ]);
      }

      const nextRow = sheet.getLastRow() + 1;
      if (isStartupProcess_(process)) {
        sheet.getRange(nextRow, 2, rows.length, 12).setNumberFormat('@');
      } else if (process === 'startup_resealing') {
        sheet.getRange(nextRow, 2, 1, 6).setNumberFormat('@');
      } else if (process === 'ip_dsf') {
        sheet.getRange(nextRow, 2, rows.length, 8).setNumberFormat('@');
        sheet.getRange(nextRow, 13, rows.length, 1).setNumberFormat('@');
      } else if (isAppearanceProcess_(process)) {
        sheet.getRange(nextRow, 7).setNumberFormat('@');
      } else if (process === 'maintenance') {
        sheet.getRange(nextRow, 4, 1, 4).setNumberFormat('@');
      } else if (process === 'conductive') {
        sheet.getRange(nextRow, 4, 1, 6).setNumberFormat('@');
      }
      sheet.getRange(nextRow, 1, rows ? rows.length : 1, (rows ? rows[0] : row).length).setValues(rows || [row]);
      sheet.getRange(nextRow, 1, rows ? rows.length : 1, 1).setNumberFormat('yyyy-MM-dd HH:mm:ss');
    } finally {
      lock.releaseLock();
    }

    return json_({
      result: 'success',
      process: process,
      message: 'Inspection submitted successfully.',
      defectPhoto: photoUrl
    });
  } catch (error) {
    console.error(error);
    return json_({ result: 'error', message: error.message });
  }
}

function isAppearanceProcess_(process) {
  return process === 'before_hpcd' || process === 'formation' || process === 'degas';
}

function isStartupProcess_(process) {
  return STARTUP_PROCESSES.indexOf(process) !== -1;
}

function isCheckSheetProcess_(process) {
  return isStartupProcess_(process) || process === 'startup_resealing' || process === 'ip_dsf';
}

function getProcess_(value) {
  const process = String(value || 'formation').toLowerCase();
  if (isCheckSheetProcess_(process) || isTemperatureAreaProcess_(process) || process === 'temperature') return process;
  if (process === 'before_hpcd') return 'before_hpcd';
  if (process === 'degas') return 'degas';
  if (process === 'hta') return 'hta';
  if (process === 'maintenance') return 'maintenance';
  if (process === 'conductive') return 'conductive';
  return 'formation';
}

function getHeaders_(process) {
  if (isStartupProcess_(process)) return STARTUP_HEADERS;
  if (isTemperatureAreaProcess_(process)) return getTemperatureHeaders_(process);
  if (process === 'startup_resealing') return RESEALING_HEADERS;
  if (process === 'ip_dsf') return IP_DSF_HEADERS;
  if (process === 'hta') return HTA_HEADERS;
  if (process === 'maintenance') return MAINTENANCE_HEADERS;
  if (process === 'conductive') return CONDUCTIVE_RUBBER_HEADERS;
  if (process === 'before_hpcd') return BEFORE_HPCD_HEADERS;
  return process === 'degas' ? DEGAS_HEADERS : FORMATION_HEADERS;
}

function getSheet_(process) {
  const spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheetName = isStartupProcess_(process)
    ? CONFIG.STARTUP_SHEET_NAMES[process]
    : isTemperatureAreaProcess_(process)
    ? TEMPERATURE_AREAS[process].sheet
    : process === 'startup_resealing'
    ? CONFIG.RESEALING_SHEET_NAME
    : process === 'ip_dsf'
    ? CONFIG.IP_DSF_SHEET_NAME
    : process === 'hta'
    ? CONFIG.HTA_SHEET_NAME
    : process === 'maintenance'
      ? CONFIG.MAINTENANCE_SHEET_NAME
      : process === 'conductive'
        ? CONFIG.CONDUCTIVE_RUBBER_SHEET_NAME
        : process === 'before_hpcd'
          ? CONFIG.BEFORE_HPCD_SHEET_NAME
          : process === 'degas'
            ? CONFIG.DEGAS_SHEET_NAME
            : CONFIG.FORMATION_SHEET_NAME;
  let sheet = spreadsheet.getSheetByName(sheetName);
  const isNewSheet = !sheet;

  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
  }
  if (process === 'conductive') ensureConductiveRubberHeaders_(sheet);
  else if (isNewSheet) ensureHeaders_(sheet, getHeaders_(process));
  return sheet;
}

function ensureConductiveRubberHeaders_(sheet) {
  const legacyHeaders = ['Date', 'Team', 'Operator name', 'Process', 'Measurement', 'Unit', 'Action', 'Comment'];
  const currentHeaders = sheet.getRange(1, 1, 1, legacyHeaders.length).getDisplayValues()[0];
  const isLegacyLayout = legacyHeaders.every(function(header, index) {
    return currentHeaders[index] === header;
  });

  if (isLegacyLayout) sheet.insertColumnAfter(4);
  ensureHeaders_(sheet, CONDUCTIVE_RUBBER_HEADERS);
}

function ensureHeaders_(sheet, headers) {
  const current = sheet
    .getRange(1, 1, 1, headers.length)
    .getDisplayValues()[0];
  const isExact = headers.every(function(header, index) {
    return current[index] === header;
  });
  const isCompatible = headers.every(function(header, index) {
    return current[index] === '' || current[index] === header;
  });

  if (!isCompatible) {
    throw new Error(
      'The headers in "' + sheet.getName() + '" do not match the expected layout.'
    );
  }

  if (!isExact) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }

  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setBackground('#e2e8f0');
  sheet.setFrozenRows(1);
  sheet.getRange('A:A').setNumberFormat('yyyy-MM-dd HH:mm:ss');
  sheet.getRange('G:G').setNumberFormat('@');
}

function normalizeFormationJigLines_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const range = sheet.getRange(2, 7, lastRow - 1, 1);
  const values = range.getValues();
  let changed = false;

  values.forEach(function(row) {
    if (row[0] instanceof Date && !isNaN(row[0].getTime())) {
      row[0] = Utilities.formatDate(
        row[0],
        Session.getScriptTimeZone(),
        'M-d'
      );
      changed = true;
    }
  });

  if (changed) {
    range.setNumberFormat('@');
    range.setValues(values);
  }
}

function validateInput_(input, process) {
  if (isStartupProcess_(process)) {
    validateTextField_(input.team, 'Team', 16);
    if (!TEAMS.includes(String(input.team))) throw new Error('Team must be 1A, 1B, 2A, or 2B.');
    validateTextField_(input.operatorName, 'Name', 120, false);
    if (process === 'startup_cdc') {
      validateTextField_(input.cdcLine, 'CDC line', 32);
      validateTextField_(input.floor, 'Floor', 16);
    } else {
      const lines = normalizeLineList_(input.lines);
      if (SINGLE_LINE_STARTUP_PROCESSES.includes(process) && lines.length !== 1) throw new Error('Select one line.');
    }
    if (process === 'startup_selector' && !SELECTOR_TYPES.includes(String(input.selectorType))) {
      throw new Error('Select a valid Selector.');
    }
    validateTextField_(input.checkCompleted, 'Check completed', 8);
    validateTextField_(input.frequency, 'Frequency', 16);
    if (!['Yes', 'No'].includes(String(input.checkCompleted))) throw new Error('Check completed must be Yes or No.');
    if (!['Shift', 'Weekly', 'Monthly'].includes(String(input.frequency))) throw new Error('Frequency must be Shift, Weekly, or Monthly.');
    if (!Array.isArray(input.items) || !input.items.length) throw new Error('At least one start-up check item is required.');
    if (input.items.length > 100) throw new Error('Too many start-up check items were submitted.');
    if (String(input.checkCompleted) === 'No' && (input.items.length !== 1 || String(input.items[0].status) !== 'No')) {
      throw new Error('An incomplete check needs one overall item.');
    }
    input.items.forEach(function(item) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Every start-up item must be an object.');
      validateTextField_(item.item, 'Start-up item', 500);
      validateTextField_(item.comment, 'Start-up comment', 2000, false);
      if (!STARTUP_STATUSES.includes(String(item.status))) throw new Error('Every start-up item needs a valid status.');
      if (['Flagged', 'Incomplete', 'No'].includes(String(item.status)) && !String(item.comment || '').trim()) {
        throw new Error('Add a comment for flagged or incomplete items.');
      }
    });
    return;
  }

  if (process === 'startup_resealing') {
    validateTextField_(input.operatorName, 'Name', 120);
    validateTextField_(input.shift, 'Shift', 40);
    validateTextField_(input.work, 'Work today', 160);
    validateTextField_(input.comment, 'Comment', 2000, false);
    if (!['Pass', 'Flagged', 'N/A'].includes(String(input.inspectionStatus))) throw new Error('Invalid inspection status.');
    if (!['Completed', 'Incomplete', 'N/A'].includes(String(input.cleaningStatus))) throw new Error('Invalid cleaning status.');
    if ((input.inspectionStatus === 'Flagged' || input.cleaningStatus === 'Incomplete') && !String(input.comment || '').trim()) {
      throw new Error('Add a comment for unfinished work.');
    }
    return;
  }

  if (process === 'ip_dsf') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.checkDate || ''))) throw new Error('Invalid date.');
    validateTextField_(input.line, 'Line', 60);
    if (!Array.isArray(input.measurements) || !input.measurements.length || input.measurements.length > 100) {
      throw new Error('Invalid measurements.');
    }
    const ids = {};
    input.measurements.forEach(function(item) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid measurements.');
      validateTextField_(item.id, 'Measurement ID', 80);
      if (ids[item.id]) throw new Error('Invalid measurements.');
      ids[item.id] = true;
      validateTextField_(item.process, 'Process', 80);
      validateTextField_(item.point, 'Point', 8);
      validateTextField_(item.name, 'Measurement', 500);
      validateTextField_(item.target, 'Target', 100);
      if (!['Common', 'A', 'B'].includes(String(item.lane))) throw new Error('Invalid lane.');
      ['plus', 'minus'].forEach(function(key) {
        if (item[key] === '' || item[key] === null || !Number.isFinite(Number(item[key]))) throw new Error('Invalid ' + key + '.');
      });
    });
    return;
  }
  if (process === 'conductive') {
    ['team', 'operatorName', 'rubberProcess', 'line', 'measurement', 'action'].forEach(function(key) {
      validateTextField_(input[key], key, key === 'operatorName' ? 120 : 64);
    });
    validateTextField_(input.comment, 'comment', 2000, false);
    if (!TEAMS.includes(String(input.team))) throw new Error('Team must be 1A, 1B, 2A, or 2B.');

    const rubberProcess = cleanText_(input.rubberProcess);
    const measurement = cleanText_(input.measurement);
    if (!['Degas', 'EOL'].includes(rubberProcess)) throw new Error('Process must be Degas or EOL.');
    if (!['4-1', '4-2', '5-1', '5-2'].includes(cleanText_(input.line))) {
      throw new Error('Line must be 4-1, 4-2, 5-1, or 5-2.');
    }
    if (rubberProcess === 'Degas' && measurement !== 'IR') throw new Error('Degas measurement must be IR.');
    if (rubberProcess === 'EOL' && !['IR', 'IV'].includes(measurement)) throw new Error('EOL measurement must be IR or IV.');
    normalizeConductiveUnits_(input.units);
    if (!['Flip', 'Change', 'Other'].includes(cleanText_(input.action))) {
      throw new Error('Action must be Flip, Change, or Other.');
    }
    return;
  }

  if (process === 'maintenance') {
    ['team', 'operatorName', 'line', 'equipment', 'maintenance', 'tapingLine'].forEach(function(key) {
      validateTextField_(input[key], key, key === 'operatorName' ? 120 : 64);
    });
    if (!TEAMS.includes(String(input.team))) throw new Error('Team must be 1A, 1B, 2A, or 2B.');
    if (!['EOL 4-1', 'EOL 4-2', 'EOL 5-1', 'EOL 5-2'].includes(String(input.line))) {
      throw new Error('A valid EOL line must be selected.');
    }
    if (!['Tape', 'Knife'].includes(String(input.equipment))) throw new Error('Tape/Knife must be Tape or Knife.');
    if (!['Cleaning', 'Replace'].includes(String(input.maintenance))) throw new Error('Maintenance must be Cleaning or Replace.');
    if (!['Both', 'A', 'B'].includes(String(input.tapingLine))) throw new Error('Taping line must be Both, A, or B.');
    return;
  }

  if (process === 'hta') {
    ['team', 'operatorName'].forEach(function(key) {
      validateTextField_(input[key], key, key === 'operatorName' ? 120 : 16);
    });
    if (!TEAMS.includes(String(input.team))) {
      throw new Error('Team must be 1A, 1B, 2A, or 2B.');
    }
    HTA_FIELDS.forEach(function(field) {
      const value = Number(input[field.key]);
      if (!Number.isFinite(value)) {
        throw new Error(field.label + ' must be a number.');
      }
    });
    return;
  }

  const required = [
    'team',
    'operatorName',
    'trayId',
    'defect'
  ];
  const defects = normalizeDefectTypes_(input.defect);
  const isAllOk = defects.length === 1 && defects[0] === 'All OK';
  if (!isAllOk) {
    required.push('cellId', 'channel');
    if (process === 'degas') required.push('degasLine');
    if (process === 'formation') required.push('jigLine', 'hotJig');
  }

  required.forEach(function(key) {
    if (input[key] === undefined || String(input[key]).trim() === '') {
      throw new Error(key + ' is required.');
    }
  });

  ['team', 'operatorName', 'trayId', 'cellId', 'degasLine', 'jigLine', 'hotJig'].forEach(function(key) {
    if (input[key] !== undefined) validateTextField_(input[key], key, key === 'operatorName' ? 120 : 64);
  });
  validateTextField_(input.comment, 'comment', 2000, false);
  validateTextField_(input.defectPhotoName, 'defectPhotoName', 160, false);
  validateTextField_(input.defectPhotoType, 'defectPhotoType', 64, false);
  if (input.defectPhotoData !== undefined && input.defectPhotoData !== null) {
    validateTextField_(input.defectPhotoData, 'defectPhotoData', Math.ceil(CONFIG.MAX_PHOTO_BYTES * 4 / 3) + 256, false);
  }

  if (!TEAMS.includes(String(input.team))) {
    throw new Error('Team must be 1A, 1B, 2A, or 2B.');
  }

  const trayId = cleanText_(input.trayId);
  if (!/^[A-Z0-9]+$/.test(trayId)) {
    throw new Error('Tray ID may contain only uppercase letters and numbers.');
  }

  if (!isAllOk) {
    const cellId = cleanText_(input.cellId);
    if (!/^[A-Z0-9]+$/.test(cellId)) {
      throw new Error('Cell ID may contain only uppercase letters and numbers.');
    }
    const channel = Number(input.channel);
    if (!Number.isInteger(channel) || channel < 1) {
      throw new Error('Channel must be a positive integer.');
    }

    if (process === 'formation') {
      const hotJig = Number(input.hotJig);
      if (!Number.isInteger(hotJig) || hotJig < 1) {
        throw new Error('Hot jig must be a positive integer.');
      }
    }
  }

  if (input.defectPhotoData) {
    const mimeType = String(input.defectPhotoType || '');
    if (!mimeType.startsWith('image/')) {
      throw new Error('Only image files can be uploaded.');
    }
  }
  if (isAppearanceProcess_(process)) {
    normalizeDefectMap_(input.defectMap);
  }
}

function normalizeLineList_(value) {
  if (!Array.isArray(value) || value.length > 12) throw new Error('Invalid lines.');
  const uniqueLines = [];
  value.forEach(function(line) {
    const text = cleanText_(validateTextField_(line, 'Line', 16));
    if (!uniqueLines.includes(text)) uniqueLines.push(text);
  });
  if (!uniqueLines.length) throw new Error('Select a line.');
  return uniqueLines;
}

function validateTextField_(value, fieldName, maxLength, required) {
  const isRequired = required !== false;
  if (value === undefined || value === null || String(value).trim() === '') {
    if (isRequired) throw new Error(fieldName + ' is required.');
    return '';
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error(fieldName + ' must be text.');
  }
  const text = String(value).trim();
  if (text.length > maxLength) throw new Error(fieldName + ' is too long.');
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text)) {
    throw new Error(fieldName + ' contains invalid control characters.');
  }
  return text;
}

function normalizeDefectTypes_(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  const defects = values.map(function(item) { return cleanText_(item); }).filter(Boolean);
  if (!defects.length) throw new Error('At least one Defect Type must be selected.');

  const uniqueDefects = [];
  defects.forEach(function(defect) {
    if (!DEFECT_TYPES.includes(defect)) throw new Error('Invalid Defect Type: ' + defect);
    if (!uniqueDefects.includes(defect)) uniqueDefects.push(defect);
  });
  if (uniqueDefects.includes('All OK') && uniqueDefects.length > 1) {
    throw new Error('All OK cannot be combined with another Defect Type.');
  }
  return uniqueDefects;
}

function normalizeConductiveUnits_(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  const units = values.map(function(unit) { return cleanText_(unit); }).filter(Boolean);
  if (!units.length) throw new Error('At least one Unit must be selected.');

  const uniqueUnits = [];
  units.forEach(function(unit) {
    if (!CONDUCTIVE_RUBBER_UNITS.includes(unit)) throw new Error('Invalid Unit: ' + unit);
    if (!uniqueUnits.includes(unit)) uniqueUnits.push(unit);
  });
  return uniqueUnits;
}

function normalizeDefectMap_(value) {
  let points;
  try {
    points = Array.isArray(value) ? value : JSON.parse(String(value || '[]'));
  } catch (error) {
    throw new Error('The defect map data is invalid.');
  }
  if (!Array.isArray(points) || points.length > 100) {
    throw new Error('The defect map must contain no more than 100 points.');
  }
  const normalized = points.map(function(point) {
    const x = Number(point && point.x);
    const y = Number(point && point.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
      throw new Error('A defect map point is outside the valid image area.');
    }
    return {
      x: Math.round(x * 10000) / 10000,
      y: Math.round(y * 10000) / 10000
    };
  });
  return JSON.stringify(normalized);
}

function isTemperatureValue_(value) {
  return value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value));
}

function validateTemperatureInput_(input) {
  validateTextField_(input.team, 'Team', 16);
  if (!TEAMS.includes(String(input.team))) throw new Error('Team must be 1A, 1B, 2A, or 2B.');
  validateTextField_(input.operatorName, 'Name', 120);
  if (!Array.isArray(input.areas) || !input.areas.length) throw new Error('Select at least one area.');
  const seen = {};
  input.areas.forEach(function(entry) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Invalid area reading.');
    const process = String(entry.process || '');
    if (process !== 'hta' && !isTemperatureAreaProcess_(process)) throw new Error('Unknown area: ' + process);
    if (seen[process]) throw new Error('Each area can be submitted once.');
    seen[process] = true;
    const values = entry.values && typeof entry.values === 'object' ? entry.values : {};

    if (process === 'hta') {
      HTA_FIELDS.forEach(function(field) {
        if (!isTemperatureValue_(values[field.key])) throw new Error(field.label + ' must be a number.');
      });
      return;
    }

    const area = TEMPERATURE_AREAS[process];
    if (area.line) {
      const line = validateTextField_(entry.line, area.line.label, area.line.maxLength || 16);
      if (area.line.options && !area.line.options.includes(line)) throw new Error('Invalid ' + area.line.label + '.');
    }
    let filled = 0;
    area.fields.forEach(function(field) {
      const value = values[field.key];
      if (isTemperatureValue_(value)) {
        filled += 1;
      } else if (!area.optionalFields || (value !== '' && value !== null && value !== undefined)) {
        throw new Error(field.label + ' must be a number.');
      }
    });
    if (!filled) throw new Error('Enter at least one temperature for each selected area.');
    if (!['Yes', 'No'].includes(String(entry.inSpec))) throw new Error('Answer whether the temperatures are in spec.');
  });
}

function saveTemperatureReadings_(input) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const submittedAt = new Date();
    input.areas.forEach(function(entry) {
      const process = String(entry.process);
      const values = entry.values;
      const sheet = getSheet_(process);
      const headers = getHeaders_(process);
      ensureHeaders_(sheet, headers);
      let row;
      if (process === 'hta') {
        row = [submittedAt, cleanText_(input.team), cleanText_(input.operatorName)]
          .concat(HTA_FIELDS.map(function(field) { return Number(values[field.key]); }), [getTempSpecResult_(values)]);
      } else {
        const area = TEMPERATURE_AREAS[process];
        row = [submittedAt, cleanText_(input.team), cleanText_(input.operatorName)]
          .concat(area.line ? [cleanText_(entry.line)] : [])
          .concat(area.fields.map(function(field) {
            return isTemperatureValue_(values[field.key]) ? Number(values[field.key]) : '';
          }), [String(entry.inSpec)]);
      }
      const nextRow = sheet.getLastRow() + 1;
      sheet.getRange(nextRow, 2, 1, 2).setNumberFormat('@');
      if (process !== 'hta' && TEMPERATURE_AREAS[process].line) sheet.getRange(nextRow, 4).setNumberFormat('@');
      sheet.getRange(nextRow, 1, 1, row.length).setValues([row]);
      sheet.getRange(nextRow, 1).setNumberFormat('yyyy-MM-dd HH:mm:ss');
    });
  } finally {
    lock.releaseLock();
  }
}

function getTempSpecResult_(input) {
  const outOfSpec = HTA_FIELDS.filter(function(field) {
    const value = Number(input[field.key]);
    return value < 57 || value > 63;
  }).map(function(field) {
    return field.label;
  });

  return outOfSpec.length ? outOfSpec.join(', ') : 'Spec in';
}

function savePhoto_(base64Data, originalName, mimeType, trayId, process) {
  const bytes = Utilities.base64Decode(base64Data);
  if (bytes.length > CONFIG.MAX_PHOTO_BYTES) {
    throw new Error('The photo must be 8 MB or smaller.');
  }

  const folderId = process === 'degas' ? CONFIG.DEGAS_PHOTO_FOLDER_ID : CONFIG.FORMATION_PHOTO_FOLDER_ID;
  const rootFolder = DriveApp.getFolderById(folderId);
  const folder = process === 'before_hpcd' ? getOrCreateSubfolder_(rootFolder, 'Before HPCD') : rootFolder;
  const extension = extensionFor_(originalName, mimeType);
  const timestamp = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    'yyyyMMdd_HHmmss'
  );
  const prefix = process === 'before_hpcd' ? 'BEFORE_HPCD' : process === 'degas' ? 'DEGAS' : 'FORMATION';
  const fileName = prefix + '_' + timestamp + '_'
    + cleanFileName_(trayId || 'tray') + extension;
  const blob = Utilities.newBlob(
    bytes,
    mimeType || 'image/jpeg',
    fileName
  );
  const file = folder.createFile(blob);

  if (CONFIG.MAKE_PHOTOS_PUBLIC) {
    try {
      file.setSharing(
        DriveApp.Access.ANYONE_WITH_LINK,
        DriveApp.Permission.VIEW
      );
    } catch (error) {
      console.warn('Unable to apply link sharing: ' + error.message);
    }
  }
  return file.getUrl();
}

function getOrCreateSubfolder_(parentFolder, name) {
  const folders = parentFolder.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : parentFolder.createFolder(name);
}

function extensionFor_(originalName, mimeType) {
  const name = String(originalName || '');
  const match = name.match(/\.[a-zA-Z0-9]{1,5}$/);
  if (match) return match[0].toLowerCase();

  const extensions = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/heic': '.heic',
    'image/heif': '.heif'
  };
  return extensions[mimeType] || '.jpg';
}

function cleanText_(value) {
  const text = String(value == null ? '' : value).trim();
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function cleanFileName_(value) {
  return String(value)
    .trim()
    .replace(/[\\/:*?"<>|#%{}[\]]/g, '_')
    .slice(0, 80) || 'tray';
}

function json_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
