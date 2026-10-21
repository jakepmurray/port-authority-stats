/**
 * Port Authority Stats: Google Sheet sync (Apps Script web app).
 * https://github.com/jakepmurray/port-authority-stats
 *
 * Paste this whole file into Extensions > Apps Script of your Sheet, run setup()
 * once, then Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone).
 * The app POSTs JSON as text/plain (no CORS preflight). Every request must carry
 * the shared token stored in Script Properties as PA_TOKEN.
 *
 * Never paste your token into this file. It lives only in Script Properties.
 */

var SCRIPT_VERSION = 1;
var TOKEN_PROPERTY = 'PA_TOKEN';

/** Tabs and their header rows. The app sends rows as objects keyed by these names. */
var TABS = {
  'Players': ['id', 'number', 'name', 'gender_match', 'role', 'active', 'deleted', 'updated_at'],
  'Games': ['id', 'date', 'tournament', 'opponent', 'game_to', 'ratio_first', 'start_on', 'timeouts_per_half',
    'cap_half', 'cap_soft', 'cap_hard', 'youtube', 'notes', 'updated_at'],
  'Points': ['id', 'game_id', 'opponent', 'idx', 'score_us', 'score_them', 'start_on', 'ratio', 'outcome', 'line',
    'line_end', 'subs', 'pulled_by', 'missed_on_film', 'manual_result', 'video_start', 'video_end', 'edited', 'updated_at'],
  'Events': ['id', 'game_id', 'opponent', 'point', 'seq', 'type', 'team', 'actor_number', 'actor', 'receiver_number',
    'receiver', 'defender_number', 'defender', 'call_kind', 'call_outcome', 'call_turnover_by', 'call_charged_number',
    'tags', 'note', 'video_time', 'video_link', 'x', 'y', 'x_end', 'y_end', 'source', 'edited', 'updated_at'],
  'Player Stats': ['id', 'game_id', 'date', 'tournament', 'opponent', 'player_id', 'number', 'name', 'gender_match',
    'points', 'o_points', 'd_points', 'partial_points', 'points_missed', 'goals', 'assists', 'hockey_assists', 'catches',
    'completions', 'throw_attempts', 'comp_pct', 'throwaways', 'drops', 'stalls', 'other_turns', 'call_turns', 'turnovers',
    'ds', 'callahans', 'pulls', 'plus_minus', 'throw_yards', 'recv_yards', 'calls_made', 'calls_against',
    'calls_made_by', 'calls_against_by', 'turnover_tags'],
  'Game Stats': ['id', 'game_id', 'date', 'tournament', 'opponent', 'score_us', 'score_them', 'result', 'points',
    'holds', 'breaks', 'broken', 'them_holds', 'o_conversion', 'd_break_pct', 'turnovers', 'turnovers_per_point', 'ds',
    'possessions', 'scoring_efficiency', 'opp_turnovers', 'opp_ds', 'pulls', 'subs', 'injury_subs', 'points_missed_on_film',
    'calls_by_us', 'calls_by_them', 'calls_by_us_detail', 'calls_by_them_detail', 'turnover_tags', 'opp_turnover_tags',
    'youtube'],
  'Meta': ['key', 'value']
};
/** Tabs upserted / deleted by id. */
var UPSERT_TABS = ['Players', 'Games'];
/** Tabs replaced per game (all rows of a pushed game are swapped for the new snapshot). */
var GAME_TABS = ['Points', 'Events', 'Player Stats', 'Game Stats'];
/** Columns kept as plain text (so "07" stays "07" and ids never turn into numbers). */
var TEXT_COLUMNS = ['id', 'game_id', 'player_id', 'number', 'actor_number', 'receiver_number', 'defender_number',
  'call_charged_number', 'line', 'line_end', 'pulled_by', 'date', 'key', 'value'];

// ---------- web app entry points ----------

function doPost(e) {
  var req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '');
  } catch (err) {
    return json_({ ok: false, error: 'bad_request', message: 'Body must be JSON (sent as text/plain).' });
  }
  return json_(handle_(req, SpreadsheetApp.getActiveSpreadsheet(), PropertiesService.getScriptProperties()));
}

/** Opening the /exec URL in a browser shows this (proves the deployment is reachable). */
function doGet() {
  return json_({ ok: true, app: 'port-authority-stats', version: SCRIPT_VERSION, message: 'Sync endpoint is up. The app talks to it with POST.' });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- request handling (no globals touched, so it is testable) ----------

function handle_(req, ss, props) {
  if (!req || typeof req !== 'object') return { ok: false, error: 'bad_request', message: 'Empty request.' };
  var expected = props.getProperty(TOKEN_PROPERTY);
  if (!expected) return { ok: false, error: 'no_token_configured', message: 'Run setup() in the Apps Script editor first.' };
  if (typeof req.token !== 'string' || !safeEqual_(req.token, expected)) {
    return { ok: false, error: 'bad_token', message: 'Token rejected.' };
  }
  if (!ss) return { ok: false, error: 'no_sheet', message: 'The script must be opened from the Sheet (Extensions > Apps Script).' };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { ok: false, error: 'busy', message: 'Another sync is running. Try again.' };
  try {
    if (req.action === 'ping') return { ok: true, version: SCRIPT_VERSION, tabs: ensureTabs_(ss) };
    if (req.action === 'push') return push_(req, ss);
    return { ok: false, error: 'unknown_action', message: 'Unknown action: ' + req.action };
  } catch (err) {
    return { ok: false, error: 'script_error', message: String(err && err.message ? err.message : err) };
  } finally {
    lock.releaseLock();
  }
}

function safeEqual_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Create missing tabs, add missing header columns. Returns a report per tab. */
function ensureTabs_(ss) {
  var report = [];
  for (var name in TABS) {
    var sheet = ss.getSheetByName(name);
    var status = 'ok';
    var missing = [];
    if (!sheet) {
      sheet = ss.insertSheet(name);
      status = 'created';
    }
    var header = readHeader_(sheet);
    var want = TABS[name];
    for (var i = 0; i < want.length; i++) if (header.indexOf(want[i]) < 0) missing.push(want[i]);
    if (missing.length) {
      var start = header.length + 1;
      sheet.getRange(1, start, 1, missing.length).setValues([missing]);
      if (status === 'ok') status = 'headers_added';
      header = header.concat(missing);
    }
    if (status !== 'ok') {
      sheet.setFrozenRows(1);
      for (var c = 0; c < header.length; c++) {
        if (TEXT_COLUMNS.indexOf(header[c]) >= 0) sheet.getRange(1, c + 1, sheet.getMaxRows(), 1).setNumberFormat('@');
      }
    }
    report.push({ name: name, status: status, missing: missing });
  }
  return report;
}

function readHeader_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return [];
  var row = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var out = [];
  for (var i = 0; i < row.length; i++) {
    if (row[i] === '' || row[i] === null) break;
    out.push(String(row[i]));
  }
  return out;
}

function readRows_(sheet, width) {
  var last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, width).getValues();
}

function writeRows_(sheet, rows, width) {
  var last = sheet.getLastRow();
  if (last >= 2) sheet.getRange(2, 1, last - 1, width).clearContent();
  if (rows.length) sheet.getRange(2, 1, rows.length, width).setValues(rows);
}

/** Text that Sheets would treat as a formula is stored as plain text. */
function cell_(v) {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) v = v.join('; ');
  if (typeof v === 'object') v = JSON.stringify(v);
  if (typeof v === 'string' && /^[=+\-@]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v)) return "'" + v;
  return v;
}

function toRow_(header, obj) {
  var row = [];
  for (var i = 0; i < header.length; i++) row.push(cell_(obj[header[i]]));
  return row;
}

/**
 * req.upsert: { Players: {rows: [...], delete: [ids]}, Games: {...} }
 * req.replace: { game_ids: [...], tabs: { Points: [...], Events: [...], 'Player Stats': [...], 'Game Stats': [...] } }
 * Idempotent: sending the same push twice gives the same sheet.
 */
function push_(req, ss) {
  ensureTabs_(ss);
  var counts = {};
  var up = req.upsert || {};
  for (var u = 0; u < UPSERT_TABS.length; u++) {
    var name = UPSERT_TABS[u];
    var part = up[name];
    if (!part) continue;
    var sheet = ss.getSheetByName(name);
    var header = readHeader_(sheet);
    var idCol = header.indexOf('id');
    var rows = readRows_(sheet, header.length);
    var at = {};
    for (var r = 0; r < rows.length; r++) at[String(rows[r][idCol])] = r;
    var dels = {};
    var incoming = part.rows || [];
    for (var i = 0; i < incoming.length; i++) {
      var row = toRow_(header, incoming[i]);
      var key = String(incoming[i].id);
      if (at.hasOwnProperty(key)) rows[at[key]] = row;
      else {
        at[key] = rows.length;
        rows.push(row);
      }
    }
    var ids = part['delete'] || [];
    for (var d = 0; d < ids.length; d++) dels[String(ids[d])] = true;
    rows = rows.filter(function (x) { return !dels[String(x[idCol])]; });
    writeRows_(sheet, rows, header.length);
    counts[name] = { upserted: incoming.length, deleted: ids.length, total: rows.length };
  }
  var rep = req.replace;
  if (rep && rep.game_ids && rep.game_ids.length) {
    var games = {};
    for (var g = 0; g < rep.game_ids.length; g++) games[String(rep.game_ids[g])] = true;
    for (var t = 0; t < GAME_TABS.length; t++) {
      var tab = GAME_TABS[t];
      var sh = ss.getSheetByName(tab);
      var hdr = readHeader_(sh);
      var gCol = hdr.indexOf('game_id');
      var kept = readRows_(sh, hdr.length).filter(function (x) { return !games[String(x[gCol])]; });
      var add = (rep.tabs && rep.tabs[tab]) || [];
      for (var k = 0; k < add.length; k++) kept.push(toRow_(hdr, add[k]));
      writeRows_(sh, kept, hdr.length);
      counts[tab] = { replaced_games: rep.game_ids.length, written: add.length, total: kept.length };
    }
  }
  writeMeta_(ss, { schema_version: req.schema_version || '', script_version: SCRIPT_VERSION, last_push_at: new Date().toISOString() });
  return { ok: true, version: SCRIPT_VERSION, counts: counts };
}

function writeMeta_(ss, kv) {
  var sheet = ss.getSheetByName('Meta');
  var rows = [];
  for (var k in kv) rows.push([k, String(kv[k])]);
  writeRows_(sheet, rows, 2);
}

// ---------- run these from the editor ----------

/**
 * One-time setup: creates the tabs and headers and, if no token exists yet,
 * generates one and prints it ONCE in the Execution log. Copy it into the app's Settings.
 */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var report = ensureTabs_(ss);
  var props = PropertiesService.getScriptProperties();
  var lines = [];
  for (var i = 0; i < report.length; i++) lines.push(report[i].name + ': ' + report[i].status);
  Logger.log('Tabs: ' + lines.join(', '));
  if (props.getProperty(TOKEN_PROPERTY)) {
    Logger.log('A token is already set (not shown again). Run rotateToken() to make a new one.');
    return;
  }
  var token = newToken_();
  props.setProperty(TOKEN_PROPERTY, token);
  Logger.log('Your sync token (copy it into the app: Settings > Token). It is shown only this once:');
  Logger.log(token);
}

/** Replace the token (e.g. if it leaked). Paste the new one into the app. */
function rotateToken() {
  var token = newToken_();
  PropertiesService.getScriptProperties().setProperty(TOKEN_PROPERTY, token);
  Logger.log('New sync token (the old one stops working now):');
  Logger.log(token);
}

function newToken_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}
