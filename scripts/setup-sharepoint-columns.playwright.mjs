import { chromium } from '@playwright/test';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const siteUrl = 'https://lgensol365.sharepoint.com/sites/ESHDFormationinspection';
const listName = 'Self Inspection Records';
const listUrl = `${siteUrl}/Lists/${encodeURIComponent(listName)}/AllItems.aspx`;

const processChoices = [
  'Before HPCD', 'Jig Formation', 'Degas', 'HTA',
  'EOL Tape/Knife', 'Conductive Rubber', 'Start-up HPCD', 'Start-up Jig'
];
const teamChoices = ['1A', '1B', '2A', '2B'];
const defectChoices = ['All OK', 'Dent', 'Contamination', 'Scratch', 'Lead bending', 'Wrinkles', 'Others'];
const lineChoices = ['3-1', '3-2', '3-3', '4-1', '4-2', '4-3', '5-1', '5-2', '5-3', '6-1', '6-2', '6-3'];

const fields = [
  { displayName: 'Record Date', internalName: 'RecordDate', type: 'DateTime', format: 'DateTime' },
  { displayName: 'Process', internalName: 'Process', type: 'Choice', choices: processChoices },
  { displayName: 'Team', internalName: 'Team', type: 'Choice', choices: teamChoices },
  { displayName: 'Operator Name', internalName: 'OperatorName', type: 'Text' },
  { displayName: 'Tray ID', internalName: 'TrayID', type: 'Text' },
  { displayName: 'Cell ID', internalName: 'CellID', type: 'Text' },
  { displayName: 'Channel', internalName: 'Channel', type: 'Number', decimals: 0 },
  { displayName: 'Defect Type', internalName: 'DefectType', type: 'Choice', choices: defectChoices, multiple: true },
  { displayName: 'Inspection Line', internalName: 'InspectionLine', type: 'Choice', choices: lineChoices },
  { displayName: 'Hot Jig', internalName: 'HotJig', type: 'Number', decimals: 0 },
  { displayName: 'Comment', internalName: 'Comment', type: 'Note' },
  { displayName: 'Defect Map', internalName: 'DefectMap', type: 'Note' },
  ...['11', '12', '21', '22', '31', '32', '41', '42'].map((key) => ({
    displayName: `HTA ${key[0]}-${key[1]}`,
    internalName: `HTA${key}`,
    type: 'Number',
    decimals: 2
  })),
  { displayName: 'Temperature Result', internalName: 'TemperatureResult', type: 'Choice', choices: ['In Spec', 'Out of Spec'] },
  { displayName: 'Equipment', internalName: 'Equipment', type: 'Choice', choices: ['Tape', 'Knife'] },
  { displayName: 'Maintenance Action', internalName: 'MaintenanceAction', type: 'Choice', choices: ['Cleaning', 'Replace'] },
  { displayName: 'Taping Line', internalName: 'TapingLine', type: 'Choice', choices: ['Both', 'A', 'B'] },
  { displayName: 'Conductive Process', internalName: 'ConductiveProcess', type: 'Choice', choices: ['Degas', 'EOL'] },
  { displayName: 'Measurement', internalName: 'Measurement', type: 'Choice', choices: ['IR', 'IV'] },
  { displayName: 'Units', internalName: 'Units', type: 'Text' },
  { displayName: 'Conductive Action', internalName: 'ConductiveAction', type: 'Choice', choices: ['Flip', 'Change', 'Other'] },
  { displayName: 'Check Type', internalName: 'CheckType', type: 'Choice', choices: ['Start-up HPCD', 'Start-up Jig'] },
  { displayName: 'Startup Lines', internalName: 'StartupLines', type: 'Text' },
  { displayName: 'Check Completed', internalName: 'CheckCompleted', type: 'Choice', choices: ['Yes', 'No'] },
  { displayName: 'Frequency', internalName: 'Frequency', type: 'Choice', choices: ['Shift', 'Weekly', 'Monthly'] },
  { displayName: 'Startup Category', internalName: 'StartupCategory', type: 'Text' },
  { displayName: 'Startup Item', internalName: 'StartupItem', type: 'Text' },
  { displayName: 'Startup Status', internalName: 'StartupStatus', type: 'Choice', choices: ['Pass', 'Flagged', 'Incomplete'] },
  { displayName: 'Startup Comment', internalName: 'StartupComment', type: 'Note' }
];

const browser = await chromium.launch({ headless: false, channel: 'msedge' });
const context = await browser.newContext();
const page = await context.newPage();

try {
  await page.goto(listUrl, { waitUntil: 'domcontentloaded' });
  const rl = readline.createInterface({ input, output });
  await rl.question('\nEdge 창에서 SharePoint 로그인을 완료한 뒤 Enter를 누르세요. ');
  rl.close();

  const result = await page.evaluate(async ({ siteUrl, listName, fields }) => {
    const headers = {
      Accept: 'application/json;odata=verbose',
      'Content-Type': 'application/json;odata=verbose'
    };
    const escapeOData = (value) => String(value).replaceAll("'", "''");
    const escapeXml = (value) => String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&apos;');

    const contextResponse = await fetch(`${siteUrl}/_api/contextinfo`, {
      method: 'POST',
      headers
    });
    if (!contextResponse.ok) throw new Error(`contextinfo failed: ${contextResponse.status}`);
    const contextJson = await contextResponse.json();
    const digest = contextJson.d.GetContextWebInformation.FormDigestValue;

    const listPath = `${siteUrl}/_api/web/lists/getbytitle('${escapeOData(listName)}')`;
    const existingResponse = await fetch(`${listPath}/fields?$select=InternalName,Title`, { headers });
    if (!existingResponse.ok) throw new Error(`list lookup failed: ${existingResponse.status}`);
    const existingJson = await existingResponse.json();
    const existingNames = new Set(existingJson.d.results.map((field) => field.InternalName));
    const created = [];
    const skipped = [];

    for (const field of fields) {
      if (existingNames.has(field.internalName)) {
        skipped.push(field.displayName);
        continue;
      }

      const attrs = [
        `Type='${escapeXml(field.type)}'`,
        `DisplayName='${escapeXml(field.displayName)}'`,
        `Name='${escapeXml(field.internalName)}'`,
        `StaticName='${escapeXml(field.internalName)}'`
      ];
      if (field.type === 'Choice') {
        attrs.push("FillInChoice='FALSE'");
        if (field.multiple) attrs.push("Mult='TRUE'");
      }
      if (field.type === 'Note') {
        attrs.push("NumLines='6'", "RichText='FALSE'");
      }
      if (field.type === 'Number') attrs.push(`Decimals='${field.decimals ?? 0}'`);
      if (field.type === 'DateTime') attrs.push(`Format='${field.format ?? 'DateTime'}'`);

      let schema = `<Field ${attrs.join(' ')}`;
      if (field.type === 'Choice') {
        schema += '><CHOICES>';
        schema += field.choices.map((choice) => `<CHOICE>${escapeXml(choice)}</CHOICE>`).join('');
        schema += '</CHOICES></Field>';
      } else {
        schema += ' />';
      }

      const response = await fetch(`${listPath}/fields/addFieldAsXml`, {
        method: 'POST',
        headers: { ...headers, 'X-RequestDigest': digest },
        body: JSON.stringify({
          parameters: {
            __metadata: { type: 'SP.XmlSchemaFieldCreationInformation' },
            SchemaXml: schema,
            Options: 0
          }
        })
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`${field.displayName} failed: ${response.status} ${body.slice(0, 300)}`);
      }
      created.push(field.displayName);
    }

    return { created, skipped };
  }, { siteUrl, listName, fields });

  console.log(`\n생성된 열: ${result.created.length}개`);
  result.created.forEach((name) => console.log(`  + ${name}`));
  console.log(`이미 있던 열: ${result.skipped.length}개`);
  console.log('\n완료되었습니다. Edge 창을 닫아도 됩니다.');
} catch (error) {
  console.error('\n실패:', error.message);
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}
