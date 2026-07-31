/**
 * Formation 검사 등록용 Google Apps Script
 *
 * 1. 아래 3개 설정값을 본인의 환경에 맞게 변경합니다.
 * 2. setup()을 편집기에서 한 번 직접 실행해 권한을 승인합니다.
 * 3. 웹 앱으로 새 배포한 뒤 /exec URL을 index.html의 SCRIPT_URL에 넣습니다.
 */
const CONFIG = Object.freeze({
  SPREADSHEET_ID: '19JnDzOotmIc_c0kWPszNNdWahUgvpf4p0ZGwDm6Ck0I',
  SHEET_NAME: 'Jig visual inspection',
  DRIVE_FOLDER_ID: '1sjdqljzpJOtAuudYBeotwXeUsxJjSdyM',
  MAKE_PHOTOS_PUBLIC: true,
  MAX_PHOTO_BYTES: 8 * 1024 * 1024
});

const HEADERS = Object.freeze([
  'Date',
  'Tray ID',
  'Jig line',
  'Hot jig',
  'Cell ID',
  'Defect',
  'Defect photo'
]);

/**
 * 최초 1회 직접 실행합니다.
 * 시트 헤더를 만들고 Sheets/Drive 권한 승인을 요청합니다.
 */
function setup() {
  const sheet = getSheet_();
  ensureHeaders_(sheet);
  DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID).getName();
}

/**
 * 홈페이지의 최근 등록 내역 조회 요청을 처리합니다.
 */
function doGet() {
  try {
    const sheet = getSheet_();
    ensureHeaders_(sheet);

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return json_({ result: 'success', data: [] });
    }

    const values = sheet
      .getRange(2, 1, lastRow - 1, HEADERS.length)
      .getDisplayValues();

    const data = values.map(function(row) {
      return {
        date: row[0],
        trayId: row[1],
        jigLine: row[2],
        hotJig: row[3],
        cellId: row[4],
        defect: row[5],
        defectPhoto: row[6]
      };
    });

    return json_({ result: 'success', data: data });
  } catch (error) {
    console.error(error);
    return json_({ result: 'error', message: error.message });
  }
}

/**
 * 홈페이지의 신규 등록 요청을 처리합니다.
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error('전송된 데이터가 없습니다.');
    }

    const input = JSON.parse(e.postData.contents);
    validateInput_(input);

    let photoUrl = '';
    if (input.defectPhotoData) {
      photoUrl = savePhoto_(
        input.defectPhotoData,
        input.defectPhotoName,
        input.defectPhotoType,
        input.trayId
      );
    }

    const lock = LockService.getScriptLock();
    lock.waitLock(30000);

    try {
      const sheet = getSheet_();
      ensureHeaders_(sheet);
      sheet.appendRow([
        new Date(),
        cleanText_(input.trayId),
        cleanText_(input.jigLine),
        Number(input.hotJig),
        cleanText_(input.cellId),
        cleanText_(input.defect),
        photoUrl
      ]);
    } finally {
      lock.releaseLock();
    }

    return json_({
      result: 'success',
      message: '등록이 완료되었습니다.',
      defectPhoto: photoUrl
    });
  } catch (error) {
    console.error(error);
    return json_({ result: 'error', message: error.message });
  }
}

function getSheet_() {
  const spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  let sheet = spreadsheet.getSheetByName(CONFIG.SHEET_NAME);

  if (!sheet) {
    sheet = spreadsheet.insertSheet(CONFIG.SHEET_NAME);
  }

  return sheet;
}

function ensureHeaders_(sheet) {
  const currentHeaders = sheet
    .getRange(1, 1, 1, HEADERS.length)
    .getDisplayValues()[0];

  if (HEADERS.some(function(header, index) {
    return currentHeaders[index] !== header;
  })) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.getRange(1, 1, 1, HEADERS.length)
      .setFontWeight('bold')
      .setBackground('#e2e8f0');
    sheet.setFrozenRows(1);
  }

  sheet.getRange('A:A').setNumberFormat('yyyy-MM-dd HH:mm:ss');
}

function validateInput_(input) {
  const required = ['trayId', 'jigLine', 'hotJig', 'cellId', 'defect'];

  required.forEach(function(key) {
    if (input[key] === undefined || String(input[key]).trim() === '') {
      throw new Error(key + ' 값이 필요합니다.');
    }
  });

  const hotJig = Number(input.hotJig);
  if (!Number.isInteger(hotJig) || hotJig < 1) {
    throw new Error('Hot jig 번호는 1 이상의 정수여야 합니다.');
  }

  if (input.defectPhotoData) {
    const mimeType = String(input.defectPhotoType || '');
    if (!mimeType.startsWith('image/')) {
      throw new Error('이미지 파일만 업로드할 수 있습니다.');
    }
  }
}

function savePhoto_(base64Data, originalName, mimeType, trayId) {
  const bytes = Utilities.base64Decode(base64Data);

  if (bytes.length > CONFIG.MAX_PHOTO_BYTES) {
    throw new Error('사진 크기는 8MB 이하여야 합니다.');
  }

  const folder = DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID);
  const extension = extensionFor_(originalName, mimeType);
  const timestamp = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    'yyyyMMdd_HHmmss'
  );
  const safeTrayId = cleanFileName_(trayId || 'tray');
  const fileName = timestamp + '_' + safeTrayId + extension;
  const blob = Utilities.newBlob(bytes, mimeType || 'image/jpeg', fileName);
  const file = folder.createFile(blob);

  if (CONFIG.MAKE_PHOTOS_PUBLIC) {
    try {
      file.setSharing(
        DriveApp.Access.ANYONE_WITH_LINK,
        DriveApp.Permission.VIEW
      );
    } catch (error) {
      console.warn(
        '조직 정책 때문에 링크 공개를 적용하지 못했습니다: ' + error.message
      );
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

  // 스프레드시트 수식 삽입을 방지합니다.
  if (/^[=+\-@]/.test(text)) {
    return "'" + text;
  }
  return text;
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
