# Formation Inspection → SharePoint Handoff

## Goal

Move the existing Formation Inspection web app from Google Sheets/Google Drive storage to SharePoint, while preserving the existing page behavior and visual design as much as practical.

The target SharePoint site and list are:

- Site: `https://lgensol365.sharepoint.com/sites/ESHDFormationinspection`
- List: `Self Inspection Records`
- User-provided list URL: `https://lgensol365.sharepoint.com/sites/ESHDFormationinspection/Lists/Self%20Inspection%20Records/AllItems.aspx?npsAction=createList`

## Current project

Important files:

- `index.html`: current self-contained web UI, styling, forms, maps, KPI cards, history tables, validation, photo optimization, and browser-side behavior.
- `Code.gs`: current Google Apps Script backend. It receives POST requests, writes records to process-specific Google Sheets, and uploads appearance photos to Google Drive.
- `apps-script/Code.js`: Apps Script deployment copy.
- `app/page.js`, `app/layout.js`: Next.js app files.
- `public/formation.html`: hosted/static copy of the page.
- `public/jig-formation-defect-map.jpg`, `public/degas-defect-map.jpg`: process map assets.
- `scripts/setup-sharepoint-list.ps1`: PnP attempt; do not use unless the environment is intentionally reconfigured.
- `scripts/setup-sharepoint-columns.playwright.mjs`: terminal Playwright attempt; currently unreliable in this company login environment. Do not use as the primary path.

There are pre-existing modified files in the worktree. Preserve unrelated user changes and inspect `git status` before editing.

## Existing app functionality

The current app includes:

- Appearance inspection: Before HPCD, Jig Formation, Degas.
- HTA temperature monitoring with eight temperature inputs and in-spec calculation.
- EOL Tape/Knife maintenance.
- Conductive Rubber maintenance.
- Start-up check sheets for HPCD and Jig.
- Team and operator input.
- Tray ID, Cell ID, Channel, line, hot jig, defect type, comments.
- Defect photo selection, client-side image optimization, preview, and upload.
- Defect map markers and date/line/Hot Jig filters.
- KPI cards, latest update, refresh, process navigation, and history tables.
- Conditional validation, including startup checklist comments and Degas conductive measurement behavior.

## Target data architecture

SharePoint is the database. Google Sheets/Drive should not remain the operational backend.

Preferred first implementation is the existing single list `Self Inspection Records`, with optional process-specific fields. Keep the `Process` choice field so the app can show one unified history while filtering by process.

Required/common fields:

- `RecordDate` — Date and time
- `Process` — Choice: Before HPCD, Jig Formation, Degas, HTA, EOL Tape/Knife, Conductive Rubber, Start-up HPCD, Start-up Jig
- `Team` — Choice: 1A, 1B, 2A, 2B
- `OperatorName` — Single line of text
- `TrayID` — Single line of text
- `CellID` — Single line of text
- `Channel` — Number
- `DefectType` — Choice, allow multiple selections: All OK, Dent, Contamination, Scratch, Lead bending, Wrinkles, Others
- `InspectionLine` — Choice: 3-1, 3-2, 3-3, 4-1, 4-2, 4-3, 5-1, 5-2, 5-3, 6-1, 6-2, 6-3
- `HotJig` — Number
- `Comment` — Multiple lines of text
- `DefectMap` — Multiple lines of text; store the marker array as JSON
- `Defect Photo` — Prefer SharePoint list attachments or a SharePoint document library, not a Google Drive URL

HTA fields:

- `HTA11`, `HTA12`, `HTA21`, `HTA22`, `HTA31`, `HTA32`, `HTA41`, `HTA42` — Number, two decimals
- `TemperatureResult` — Choice: In Spec, Out of Spec

Maintenance fields:

- `Equipment` — Choice: Tape, Knife
- `MaintenanceAction` — Choice: Cleaning, Replace
- `TapingLine` — Choice: Both, A, B

Conductive Rubber fields:

- `ConductiveProcess` — Choice: Degas, EOL
- `Measurement` — Choice: IR, IV
- `Units` — Single line of text
- `ConductiveAction` — Choice: Flip, Change, Other

Startup fields:

- `CheckType` — Choice: Start-up HPCD, Start-up Jig
- `StartupLines` — Single line of text
- `CheckCompleted` — Choice: Yes, No
- `Frequency` — Choice: Shift, Weekly, Monthly
- `StartupCategory` — Single line of text
- `StartupItem` — Single line of text
- `StartupStatus` — Choice: Pass, Flagged, Incomplete
- `StartupComment` — Multiple lines of text

The SharePoint `Title` field is mandatory by default. Either rename it to a harmless record label or use it as an internal record key. Do not remove it without checking the list behavior.

## Recommended implementation route

Use the Codex desktop app with the Codex Chrome extension, connected to the user's already-authenticated Chrome tab. The Chrome extension is appropriate because it can use the existing Chrome profile, signed-in session, and open tabs.

Do not ask for or store the user's password, MFA code, cookies, or access tokens.

### Phase 1 — Configure the SharePoint list

Using the connected, authenticated SharePoint tab:

1. Confirm the site is `ESHDFormationinspection` and the list is `Self Inspection Records`.
2. Check existing columns before creating anything.
3. Create only missing fields from the schema above.
4. Do not delete, rename, or overwrite existing data without explicit confirmation.
5. Keep the operation idempotent: existing columns should be skipped.
6. If the list is not present, stop and ask before creating a replacement list.
7. Confirm the created fields in List settings and/or the list view.

### Phase 2 — Migrate data

Only after the list schema is confirmed:

1. Inspect the Google Sheet headers and existing data through the local project/backend configuration.
2. Produce a mapping from each process-specific Google Sheet to SharePoint fields.
3. Do not migrate historical rows until the user confirms the mapping.
4. Preserve dates, multi-select defects, startup checklist rows, and photo references.

### Phase 3 — Update the app

Preserve the current UI from `index.html` as much as possible.

Replace the Google Apps Script data layer in `Code.gs`/the page's fetch calls with SharePoint-backed operations. The preferred long-term implementation is an SPFx web part if exact HTML/JavaScript behavior is required. If the tenant does not allow SPFx deployment, build a Power Apps/SharePoint-compatible functional version and clearly identify any visual or photo-processing differences.

Required operations:

- Load records from SharePoint.
- Filter by process and date range.
- Create inspection records.
- Create startup checklist item records.
- Store and display comments, defect map JSON, and attachments.
- Refresh records and recompute KPI values.
- Keep the current validation rules.

Do not paste arbitrary JavaScript into a modern SharePoint page. Use SPFx or an approved Power Apps integration for executable custom behavior.

## Browser automation notes

The terminal Playwright flow was attempted but failed after Microsoft login with:

`page.evaluate: Target page, context or browser has been closed`

The PnP PowerShell flow was also abandoned because the machine did not have PowerShell 7 and current PnP authentication requires additional tenant app configuration.

The next Codex session should use the connected Chrome extension rather than launching a separate Playwright Edge process. Before making changes, verify the active account and the SharePoint host. Ask for approval before any destructive or externally visible action.

## Acceptance criteria

- The SharePoint list contains all required missing fields.
- Existing SharePoint data is unchanged.
- The app can create and retrieve at least one test record from SharePoint.
- Process navigation, forms, KPI cards, history, filters, maps, and validation continue to work.
- Appearance photos are stored in SharePoint and remain viewable by authorized users.
- No user credentials, cookies, or access tokens are committed to the repository.
- The final solution has a documented deployment path approved by the tenant administrator.
