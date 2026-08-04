/**
 * Jig Formation and Degas inspection API.
 *
 * Run setup() once after saving this file.
 * Then deploy a new web-app version.
 */
const CONFIG = Object.freeze({
  SPREADSHEET_ID: '19JnDzOotmIc_c0kWPszNNdWahUgvpf4p0ZGwDm6Ck0I',
  FORMATION_SHEET_NAME: 'Jig visual inspection',
  DEGAS_SHEET_NAME: 'Degas inspection',
  HTA_SHEET_NAME: 'HTA temp',
  MAINTENANCE_SHEET_NAME: 'EOL Tape Knife',
  FORMATION_PHOTO_FOLDER_ID: '1sjdqljzpJOtAuudYBeotwXeUsxJjSdyM',
  DEGAS_PHOTO_FOLDER_ID: '10hybzCCycMsBLscf2qxIADiNgaBsQqbQ',
  MAKE_PHOTOS_PUBLIC: true,
  MAX_PHOTO_BYTES: 8 * 1024 * 1024
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

/**
 * Run once to verify the existing Formation sheet and create the Degas sheet.
 */
function setup() {
  const formationSheet = getSheet_('formation');
  const degasSheet = getSheet_('degas');
  const htaSheet = getSheet_('hta');
  const maintenanceSheet = getSheet_('maintenance');

  ensureHeaders_(formationSheet, FORMATION_HEADERS);
  ensureHeaders_(degasSheet, DEGAS_HEADERS);
  ensureHeaders_(htaSheet, HTA_HEADERS);
  ensureHeaders_(maintenanceSheet, MAINTENANCE_HEADERS);
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

    if (action === 'summary') return json_(getSummaryResponse_(sheet, process, headers));
    if (action === 'records') return json_(getRecordsResponse_(sheet, process, headers, parameters));
    if (action === 'map' || action === 'chart') {
      return json_(getDateRangeResponse_(sheet, process, headers, parameters, action));
    }
    return json_({ result: 'success', process: process, data: readRecords_(sheet, process, headers, 2, Math.max(0, sheet.getLastRow() - 1)) });
  } catch (error) {
    console.error(error);
    return json_({ result: 'error', message: error.message });
  }
}

function getSummaryResponse_(sheet, process, headers) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return { result: 'success', process: process, summary: { totalRecords: 0, defectCount: 0, latest: null } };
  }

  const totalRecords = lastRow - 1;
  const latest = readRecords_(sheet, process, headers, lastRow, 1)[0] || null;
  let defectCount = 0;
  if (process === 'formation' || process === 'degas') {
    const defectColumn = process === 'degas' ? 8 : 9;
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
  if (action === 'chart' && process !== 'hta') throw new Error('Chart data is only available for HTA.');
  if (action === 'map' && process !== 'formation' && process !== 'degas') throw new Error('Map data is only available for Appearance processes.');

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { result: 'success', process: process, data: [] };
  const startDate = String(parameters.startDate || '');
  const endDate = String(parameters.endDate || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error('startDate and endDate must use YYYY-MM-DD.');
  }

  const rows = sheet.getRange(2, 1, lastRow - 1, headers.length).getDisplayValues();
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

function rowToRecord_(row, process) {
    if (process === 'hta') {
      return { date: row[0], team: row[1], operatorName: row[2], hta11: row[3], hta12: row[4], hta21: row[5], hta22: row[6], hta31: row[7], hta32: row[8], hta41: row[9], hta42: row[10], tempInSpec: row[11] };
    }
    if (process === 'maintenance') {
      return { date: row[0], team: row[1], operatorName: row[2], line: row[3], equipment: row[4], maintenance: row[5], tapingLine: row[6] };
    }
    const common = { date: row[0], team: row[1], operatorName: row[2], trayId: row[3], cellId: row[4], channel: row[5] };
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
    validateInput_(input, process);

    let photoUrl = '';
    if ((process === 'formation' || process === 'degas') && input.defectPhotoData) {
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
      if (process === 'hta') {
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
      } else {
        const isAllOk = cleanText_(input.defect) === 'All OK';
        const common = [
          new Date(),
          cleanText_(input.team),
          cleanText_(input.operatorName),
          cleanText_(input.trayId),
          isAllOk ? '' : cleanText_(input.cellId),
          isAllOk ? '' : Number(input.channel)
        ];

        row = process === 'degas'
          ? common.concat([
              isAllOk ? '' : cleanText_(input.degasLine),
              cleanText_(input.defect),
              cleanText_(input.comment),
              photoUrl,
              normalizeDefectMap_(input.defectMap)
            ])
          : common.concat([
              isAllOk ? '' : cleanText_(input.jigLine),
              isAllOk ? '' : Number(input.hotJig),
              cleanText_(input.defect),
              cleanText_(input.comment),
              photoUrl,
              normalizeDefectMap_(input.defectMap)
            ]);
      }

      const nextRow = sheet.getLastRow() + 1;
      if (process === 'formation' || process === 'degas') {
        sheet.getRange(nextRow, 7).setNumberFormat('@');
      } else if (process === 'maintenance') {
        sheet.getRange(nextRow, 4, 1, 4).setNumberFormat('@');
      }
      sheet.getRange(nextRow, 1, 1, row.length).setValues([row]);
      sheet.getRange(nextRow, 1).setNumberFormat('yyyy-MM-dd HH:mm:ss');
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

function getProcess_(value) {
  const process = String(value || 'formation').toLowerCase();
  if (process === 'degas') return 'degas';
  if (process === 'hta') return 'hta';
  if (process === 'maintenance') return 'maintenance';
  return 'formation';
}

function getHeaders_(process) {
  if (process === 'hta') return HTA_HEADERS;
  if (process === 'maintenance') return MAINTENANCE_HEADERS;
  return process === 'degas' ? DEGAS_HEADERS : FORMATION_HEADERS;
}

function getSheet_(process) {
  const spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const sheetName = process === 'hta'
    ? CONFIG.HTA_SHEET_NAME
    : process === 'maintenance'
      ? CONFIG.MAINTENANCE_SHEET_NAME
      : process === 'degas'
        ? CONFIG.DEGAS_SHEET_NAME
        : CONFIG.FORMATION_SHEET_NAME;
  let sheet = spreadsheet.getSheetByName(sheetName);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
    ensureHeaders_(sheet, getHeaders_(process));
  }
  return sheet;
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
  if (process === 'maintenance') {
    ['team', 'operatorName', 'line', 'equipment', 'maintenance', 'tapingLine'].forEach(function(key) {
      if (input[key] === undefined || String(input[key]).trim() === '') {
        throw new Error(key + ' is required.');
      }
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
      if (input[key] === undefined || String(input[key]).trim() === '') {
        throw new Error(key + ' is required.');
      }
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
  const isAllOk = cleanText_(input.defect) === 'All OK';
  if (!isAllOk) {
    required.push('cellId', 'channel', process === 'degas' ? 'degasLine' : 'jigLine');
    if (process === 'formation') required.push('hotJig');
  }

  required.forEach(function(key) {
    if (input[key] === undefined || String(input[key]).trim() === '') {
      throw new Error(key + ' is required.');
    }
  });

  if (!TEAMS.includes(String(input.team))) {
    throw new Error('Team must be 1A, 1B, 2A, or 2B.');
  }

  if (!isAllOk) {
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
  if (process === 'formation' || process === 'degas') {
    normalizeDefectMap_(input.defectMap);
  }
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

  const folderId = process === 'degas'
    ? CONFIG.DEGAS_PHOTO_FOLDER_ID
    : CONFIG.FORMATION_PHOTO_FOLDER_ID;
  const folder = DriveApp.getFolderById(folderId);
  const extension = extensionFor_(originalName, mimeType);
  const timestamp = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    'yyyyMMdd_HHmmss'
  );
  const prefix = process === 'degas' ? 'DEGAS' : 'FORMATION';
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
