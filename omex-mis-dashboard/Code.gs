/**
 * OMEX MIS Dashboard — Apps Script backend.
 *
 * Bind this script to the MAIN MIS SYSTEM spreadsheet (Extensions → Apps Script).
 * It reads every "MIS SUMMARY <name>" file linked from that sheet, copies each
 * person's weekly task scores into a MIS_DATA tab, and serves a web-app dashboard
 * where admins see the whole team and everyone else sees only their own page.
 */

const CFG = {
  MAIN_ID: '1FnVo3iagvlRIduzvA3k_oXtgmij7V778sU3cgzijH6U', // MAIN MIS SYSTEM
  LINKS_TAB: 'Sheet1',            // tab in MAIN MIS SYSTEM that holds the links
  COL_PERSON: 5,                  // column E: person name (merged cells are fine)
  COL_LINK: 7,                    // column G: "MIS SUMMARY <name>" link
  SUMMARY_TAB: 'MIS Summary Sheet',
  DATA_TAB: 'MIS_DATA',
  USERS_TAB: 'USERS',
  LOG_TAB: 'MIS_LOG',
  TZ: 'Asia/Kolkata',
  CAPTURE_DAY: ScriptApp.WeekDay.SATURDAY, // weekly snapshot day
  CAPTURE_HOUR: 19,                        // 7 pm IST
  GOOD: 90,                                // % for "On track"
  WATCH: 75,                               // % for "Watch"; below this is "Behind"
};

const DATA_HEADERS = ['Week Start', 'Person', 'System', 'Task', 'Planned', 'Done',
  'On Time Planned', 'On Time', 'Next Week Planned', 'Sheet From', 'Sheet To',
  'Sheet URL', 'Captured At'];
const USER_HEADERS = ['Email', 'Person', 'Role'];
const LOG_HEADERS = ['Time', 'Person', 'Status', 'Message'];

/* ---------------------------------------------------------------- menu */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('MIS Dashboard')
    .addItem('1. Setup tabs', 'setup')
    .addItem('2. Capture this week now', 'captureWeek')
    .addItem('3. Turn on weekly capture', 'installTrigger')
    .addToUi();
}

function setup() {
  const ss = main_();
  const data = ensureTab_(ss, CFG.DATA_TAB, DATA_HEADERS);
  data.setFrozenRows(1);
  ensureTab_(ss, CFG.LOG_TAB, LOG_HEADERS).setFrozenRows(1);
  const users = ensureTab_(ss, CFG.USERS_TAB, USER_HEADERS);
  users.setFrozenRows(1);

  // Pre-fill USERS with every person from the links, so the admin only types emails.
  if (users.getLastRow() < 2) {
    const me = Session.getActiveUser().getEmail();
    const rows = [[me, '', 'ADMIN']];
    const seen = {};
    readLinks_().forEach((l) => {
      if (!seen[l.person]) { seen[l.person] = true; rows.push(['', l.person, 'USER']); }
    });
    users.getRange(2, 1, rows.length, USER_HEADERS.length).setValues(rows);
  }
  toast_('Tabs ready. Fill emails in USERS, then run "Capture this week now".');
}

function installTrigger() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'captureWeek')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('captureWeek').timeBased()
    .onWeekDay(CFG.CAPTURE_DAY).atHour(CFG.CAPTURE_HOUR).inTimezone(CFG.TZ).create();
  toast_('Weekly capture is on (Saturday 7 pm).');
}

/* ------------------------------------------------------------- capture */

/** Reads every linked MIS summary and replaces this week's rows in MIS_DATA. */
function captureWeek() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another capture is already running.');
  try {
    const ss = main_();
    const data = ensureTab_(ss, CFG.DATA_TAB, DATA_HEADERS);
    const now = new Date();
    const weekStart = mondayOf_(now);
    const captured = [];
    const people = {};
    const log = [];

    readLinks_().forEach((link) => {
      try {
        const rows = parseSummary_(SpreadsheetApp.openById(link.id), link);
        rows.forEach((r) => captured.push([weekStart, link.person, r.system, r.task, r.planned,
          r.done, r.otPlanned, r.onTime, r.next, r.from, r.to, link.url, now]));
        people[link.person] = true;
        log.push([now, link.person, rows.length ? 'OK' : 'EMPTY',
          rows.length ? rows.length + ' tasks' : 'No tasks found (template not set up?)']);
      } catch (e) {
        log.push([now, link.person, 'ERROR', String(e.message || e)]);
      }
    });

    // Drop rows already stored for this week and these people, then append fresh ones.
    const wk = fmtDate_(weekStart);
    const old = data.getLastRow() > 1
      ? data.getRange(2, 1, data.getLastRow() - 1, DATA_HEADERS.length).getValues() : [];
    const keep = old.filter((r) => !(fmtDate_(r[0]) === wk && people[r[1]]));
    const all = keep.concat(captured);
    if (data.getLastRow() > 1) data.getRange(2, 1, data.getLastRow() - 1, DATA_HEADERS.length).clearContent();
    if (all.length) data.getRange(2, 1, all.length, DATA_HEADERS.length).setValues(all);
    data.getRange(2, 1, Math.max(all.length, 1), 1).setNumberFormat('yyyy-mm-dd');

    const logTab = ensureTab_(ss, CFG.LOG_TAB, LOG_HEADERS);
    if (log.length) logTab.getRange(logTab.getLastRow() + 1, 1, log.length, LOG_HEADERS.length).setValues(log);
    toast_('Captured ' + captured.length + ' task rows for week of ' + wk + '.');
  } finally {
    lock.releaseLock();
  }
}

/** Person + summary-file link for every row of MAIN MIS SYSTEM, one per file. */
function readLinks_() {
  const sh = main_().getSheetByName(CFG.LINKS_TAB);
  if (!sh) throw new Error('Tab "' + CFG.LINKS_TAB + '" not found in MAIN MIS SYSTEM.');
  const range = sh.getDataRange();
  const vals = range.getDisplayValues();
  const rich = range.getRichTextValues();
  const formulas = range.getFormulas();
  const pc = CFG.COL_PERSON - 1, lc = CFG.COL_LINK - 1;
  const out = [];
  const seen = {};
  let person = '';

  for (let r = 0; r < vals.length; r++) {
    const name = clean_(vals[r][pc]);
    if (name) person = name; // merged cells: only the top cell holds the name
    let url = linkFromRich_(rich[r][lc]);
    if (!url) url = firstSheetUrl_(formulas[r][lc]) || firstSheetUrl_(vals[r][lc]);
    const id = url && idFromUrl_(url);
    if (!person || !id || seen[id]) continue;
    seen[id] = true;
    out.push({ person: person, id: id, url: 'https://docs.google.com/spreadsheets/d/' + id + '/edit' });
  }
  return out;
}

/**
 * Parses one "MIS Summary Sheet". Each block is:
 *   [optional section label row, e.g. CHECKLIST / FMS O2D / FUTURE ORDER]
 *   Task/System | KRA | KPI | Benchmark | Last Week % | Planned | Actual | Actual % | Next Week
 *   <task>      | All work should be done          | ... | planned | done    | ...
 *   <task>      | All work should be done on time  | ... | done    | on time | ...
 * TOTAL blocks and the "System Name" template placeholder are skipped.
 */
function parseSummary_(ss, link) {
  const sh = ss.getSheetByName(CFG.SUMMARY_TAB);
  if (!sh) throw new Error('No "' + CFG.SUMMARY_TAB + '" tab');
  const v = sh.getDataRange().getValues();
  const from = asDate_(v[0] && v[0][7]) || asDate_(v[0] && v[0][4]);
  const to = asDate_(v[0] && v[0][8]) || asDate_(v[0] && v[0][5]);
  let system = clean_(v[1] && v[1][0]);
  const rows = [];

  for (let r = 2; r < v.length; r++) {
    const a = clean_(v[r][0]);
    if (!a) continue;
    if (a.toUpperCase() === 'TASK/SYSTEM') {
      const doneRow = v[r + 1];
      if (!doneRow) break;
      const task = clean_(doneRow[0]);
      const otRow = v[r + 2];
      const hasOnTime = otRow && /on time/i.test(String(otRow[1]));
      r += hasOnTime ? 2 : 1;
      if (!task || /^total$/i.test(task) || /^system name$/i.test(task)) continue;
      rows.push({
        system: system || task,
        task: task,
        planned: num_(doneRow[5]),
        done: num_(doneRow[6]),
        otPlanned: hasOnTime ? num_(otRow[5]) : num_(doneRow[6]),
        onTime: hasOnTime ? num_(otRow[6]) : '',
        next: num_(doneRow[8]),
        from: from || '',
        to: to || '',
      });
    } else if (!clean_(v[r][1])) {
      system = a; // a lone label in column A starts a new section
    }
  }
  return rows;
}

/* ------------------------------------------------------------- web app */

function doGet() {
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('OMEX MIS Scorecard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Everything the page needs, limited to what the signed-in user may see. */
function getDashboardData() {
  const email = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  const user = findUser_(email);
  if (!user) {
    return { error: 'Your account (' + (email || 'unknown') + ') is not in the USERS tab of MAIN MIS SYSTEM. Ask the admin to add you.' };
  }
  const sh = main_().getSheetByName(CFG.DATA_TAB);
  const raw = sh && sh.getLastRow() > 1
    ? sh.getRange(2, 1, sh.getLastRow() - 1, DATA_HEADERS.length).getValues() : [];
  const rows = raw
    .filter((r) => r[1] && (user.role === 'ADMIN' || r[1] === user.person))
    .map((r) => ({
      week: fmtDate_(r[0]), person: r[1], system: r[2], task: r[3],
      planned: num_(r[4]), done: num_(r[5]), otPlanned: num_(r[6]),
      onTime: r[7] === '' ? null : num_(r[7]), next: num_(r[8]),
      from: r[9] ? fmtDate_(r[9]) : '', to: r[10] ? fmtDate_(r[10]) : '', url: r[11],
    }));
  const weeks = Array.from(new Set(rows.map((r) => r.week))).sort().reverse();
  return { me: user, rows: rows, weeks: weeks, good: CFG.GOOD, watch: CFG.WATCH };
}

function findUser_(email) {
  if (!email) return null;
  const sh = main_().getSheetByName(CFG.USERS_TAB);
  if (!sh || sh.getLastRow() < 2) return null;
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, USER_HEADERS.length).getDisplayValues();
  const hit = rows.find((r) => clean_(r[0]).toLowerCase() === email);
  if (!hit) return null;
  return { email: email, person: clean_(hit[1]), role: clean_(hit[2]).toUpperCase() === 'ADMIN' ? 'ADMIN' : 'USER' };
}

/* ------------------------------------------------------------- helpers */

function main_() { return SpreadsheetApp.openById(CFG.MAIN_ID); }

function ensureTab_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  }
  return sh;
}

function clean_(x) { return String(x === null || x === undefined ? '' : x).replace(/\s+/g, ' ').trim(); }

function num_(x) {
  if (typeof x === 'number' && isFinite(x)) return x;
  const n = parseFloat(String(x).replace(/,/g, ''));
  return isFinite(n) ? n : 0; // #DIV/0!, blanks, "." all count as 0
}

function asDate_(x) {
  if (x instanceof Date && !isNaN(x)) return x;
  const s = clean_(x);
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  return null;
}

function mondayOf_(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

function fmtDate_(d) {
  const x = d instanceof Date ? d : asDate_(d);
  return x ? Utilities.formatDate(x, CFG.TZ, 'yyyy-MM-dd') : clean_(d);
}

function linkFromRich_(rt) {
  if (!rt) return null;
  if (rt.getLinkUrl()) return rt.getLinkUrl();
  const run = rt.getRuns().find((x) => x.getLinkUrl());
  return run ? run.getLinkUrl() : null;
}

function firstSheetUrl_(s) {
  const m = String(s || '').match(/https:\/\/docs\.google\.com\/spreadsheets\/d\/[\w-]+/);
  return m ? m[0] : null;
}

function idFromUrl_(url) {
  const m = String(url).match(/\/spreadsheets\/d\/([\w-]+)/);
  return m ? m[1] : null;
}

function toast_(msg) {
  try { SpreadsheetApp.getActive().toast(msg, 'MIS Dashboard', 8); } catch (e) { Logger.log(msg); }
}
