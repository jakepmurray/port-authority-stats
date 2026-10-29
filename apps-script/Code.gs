/**
 * Port Authority Stats: Google Sheet sync (Apps Script web app).
 * https://github.com/jakepmurray/port-authority-stats
 *
 * Paste this whole file into Extensions > Apps Script of your Sheet, run setup()
 * once, then Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone).
 * The app POSTs JSON as text/plain (no CORS preflight). Every write carries a key.
 *
 * Keys (version 4):
 * - The admin key (Jacob's; the old "sync token" becomes it automatically).
 * - One key per stat-taker: in the Sheet, use the menu Port Authority Stats > Add
 *   stat-taker (the key is shown ONCE), List stat-takers, Revoke stat-taker. The same
 *   functions exist for the editor: addStatTaker('Name'), listStatTakers(), revokeStatTaker('id').
 * Only SHA-256 hashes of keys are stored, in Script Properties. Never paste a key
 * into this file.
 *
 * Each game has one owner (whoever first pushed it). Only the owner can change it;
 * anyone can claim a released game; only the admin can take a game from someone.
 * Every accepted push raises the game's rev; a push based on an older rev is
 * rejected as stale. Who/what is logged in the hidden _Audit tab.
 *
 * Team view: every push also keeps a read-only copy of the data in the hidden
 * _Snapshot tab; GET /exec?action=snapshot returns it with no key.
 */

var SCRIPT_VERSION = 4;
/** Version 1-3 stored the admin token in plain text here; it is moved to a hash on first use. */
var TOKEN_PROPERTY = 'PA_TOKEN';
var ADMIN_HASH_PROPERTY = 'PA_ADMIN_HASH';
var ADMIN_NAME_PROPERTY = 'PA_ADMIN_NAME';
var KEY_PREFIX = 'PA_KEY_';
var ADMIN_ID = 'admin';

/** Tabs and their header rows. The app sends rows as objects keyed by these names. */
var TABS = {
  'Players': ['id', 'number', 'name', 'gender_match', 'role', 'active', 'deleted', 'updated_at', 'edited_by'],
  'Games': ['id', 'date', 'tournament', 'opponent', 'game_to', 'ratio_first', 'start_on', 'timeouts_per_half',
    'cap_half', 'cap_soft', 'cap_hard', 'youtube', 'notes', 'updated_at', 'game_clock', 'ended_at', 'edited_by'],
  'Points': ['id', 'game_id', 'opponent', 'idx', 'score_us', 'score_them', 'start_on', 'ratio', 'outcome', 'line',
    'line_end', 'subs', 'pulled_by', 'missed_on_film', 'manual_result', 'video_start', 'video_end', 'edited', 'updated_at', 'edited_by'],
  'Events': ['id', 'game_id', 'opponent', 'point', 'seq', 'type', 'team', 'actor_number', 'actor', 'receiver_number',
    'receiver', 'defender_number', 'defender', 'call_kind', 'call_outcome', 'call_turnover_by', 'call_charged_number',
    'tags', 'note', 'video_time', 'video_link', 'x', 'y', 'x_end', 'y_end', 'source', 'edited', 'updated_at', 'edited_by'],
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
  'call_charged_number', 'line', 'line_end', 'pulled_by', 'date', 'key', 'value', 'game_id', 'owner_id', 'who_id', 'games'];

/** Hidden tabs. */
var SNAPSHOT_TAB = '_Snapshot';
var SNAPSHOT_HEADER = ['key', 'part', 'chunk'];
var SNAPSHOT_CHUNK = 45000;
/** Every chunk starts with this so Sheets never reads JSON as a number, date or formula. */
var CHUNK_PREFIX = 'j:';
var REGISTRY_TAB = '_Games';
var REGISTRY_HEADER = ['game_id', 'owner_id', 'owner_name', 'rev', 'updated_by', 'updated_at', 'deleted'];
var AUDIT_TAB = '_Audit';
var AUDIT_HEADER = ['at', 'who_id', 'who', 'action', 'games', 'detail'];
var AUDIT_MAX = 5000;
var HIDDEN_TABS = [SNAPSHOT_TAB, REGISTRY_TAB, AUDIT_TAB];

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

/**
 * GET /exec shows that the deployment is reachable. GET /exec?action=snapshot returns the
 * read-only team-view snapshot (no key: it only ever reads, and holds no secrets).
 */
function doGet(e) {
  var action = e && e.parameter && e.parameter.action;
  if (action === 'snapshot') return json_(snapshotResponse_(SpreadsheetApp.getActiveSpreadsheet()));
  return json_({ ok: true, app: 'port-authority-stats', version: SCRIPT_VERSION, message: 'Sync endpoint is up. The app talks to it with POST.' });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- request handling (no globals touched, so it is testable) ----------

function handle_(req, ss, props) {
  if (!req || typeof req !== 'object') return { ok: false, error: 'bad_request', message: 'Empty request.' };
  var who = identify_(req.token, props);
  if (who.error) return { ok: false, error: who.error, message: who.message };
  if (!ss) return { ok: false, error: 'no_sheet', message: 'The script must be opened from the Sheet (Extensions > Apps Script).' };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { ok: false, error: 'busy', message: 'Another sync is running. Try again.' };
  try {
    if (req.action === 'ping') return { ok: true, version: SCRIPT_VERSION, tabs: ensureTabs_(ss), who: who };
    if (req.action === 'push') return push_(req, ss, who, props);
    if (req.action === 'pull') return pull_(ss, who, props);
    if (req.action === 'claim' || req.action === 'release' || req.action === 'reassign') return ownership_(req, ss, who, props);
    return { ok: false, error: 'unknown_action', message: 'Unknown action: ' + req.action };
  } catch (err) {
    return { ok: false, error: 'script_error', message: String(err && err.message ? err.message : err) };
  } finally {
    lock.releaseLock();
  }
}

// ---------- keys ----------

function sha256_(s) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  var hex = '';
  for (var i = 0; i < bytes.length; i++) hex += ('0' + ((bytes[i] + 256) % 256).toString(16)).slice(-2);
  return hex;
}

function adminWho_(all) {
  return { role: 'admin', id: ADMIN_ID, name: all[ADMIN_NAME_PROPERTY] || 'Admin' };
}

function parseKey_(raw) {
  try { return JSON.parse(raw); } catch (err) { return null; }
}

/** Who is this key? { role: 'admin'|'taker', id, name } or { error, message }. */
function identify_(token, props) {
  var all = props.getProperties();
  var hasKeys = false;
  for (var k0 in all) if (k0.indexOf(KEY_PREFIX) === 0) { hasKeys = true; break; }
  if (!all[ADMIN_HASH_PROPERTY] && !all[TOKEN_PROPERTY] && !hasKeys) {
    return { error: 'no_token_configured', message: 'Run setup() in the Apps Script editor first.' };
  }
  if (typeof token !== 'string' || !token) return { error: 'bad_token', message: 'Key rejected.' };
  if (all[TOKEN_PROPERTY] && safeEqual_(token, all[TOKEN_PROPERTY])) {
    // Version 1-3 kept the admin token in plain text: keep only its hash from now on.
    props.setProperty(ADMIN_HASH_PROPERTY, sha256_(token));
    props.deleteProperty(TOKEN_PROPERTY);
    return adminWho_(all);
  }
  var h = sha256_(token);
  if (all[ADMIN_HASH_PROPERTY] && safeEqual_(h, all[ADMIN_HASH_PROPERTY])) return adminWho_(all);
  for (var k in all) {
    if (k.indexOf(KEY_PREFIX) !== 0) continue;
    var rec = parseKey_(all[k]);
    if (!rec || typeof rec.hash !== 'string' || !safeEqual_(h, rec.hash)) continue;
    if (rec.revoked) return { error: 'revoked_key', message: 'This key was revoked.' };
    var today = new Date().toISOString().slice(0, 10);
    if (String(rec.last_used || '').slice(0, 10) !== today) {
      rec.last_used = new Date().toISOString();
      props.setProperty(k, JSON.stringify(rec));
    }
    return { role: 'taker', id: k.substring(KEY_PREFIX.length), name: rec.name };
  }
  return { error: 'bad_token', message: 'Key rejected.' };
}

/** Everyone who can own a game (names only). */
function people_(props) {
  var all = props.getProperties();
  var out = [{ id: ADMIN_ID, name: adminWho_(all).name, role: 'admin' }];
  for (var k in all) {
    if (k.indexOf(KEY_PREFIX) !== 0) continue;
    var rec = parseKey_(all[k]);
    if (rec && !rec.revoked) out.push({ id: k.substring(KEY_PREFIX.length), name: rec.name, role: 'taker' });
  }
  return out;
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
  if (!rows.length) return;
  ensureRows_(sheet, rows.length + 1);
  sheet.getRange(2, 1, rows.length, width).setValues(rows);
}

/** A range past the sheet's last row throws, so grow the sheet first (keeping text columns as text). */
function ensureRows_(sheet, needed) {
  var max = sheet.getMaxRows();
  if (needed <= max) return;
  sheet.insertRowsAfter(max, needed - max + 100);
  var header = readHeader_(sheet);
  var rows = sheet.getMaxRows() - max;
  for (var c = 0; c < header.length; c++) {
    if (TEXT_COLUMNS.indexOf(header[c]) >= 0 || HIDDEN_TABS.indexOf(sheet.getName()) >= 0) sheet.getRange(max + 1, c + 1, rows, 1).setNumberFormat('@');
  }
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


/** A hidden helper tab with a header row, created on first use; text format so ids stay text. */
function hiddenSheet_(ss, name, header) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, header.length).setValues([header]);
    sheet.getRange(1, 1, sheet.getMaxRows(), header.length).setNumberFormat('@');
    sheet.setFrozenRows(1);
    if (sheet.hideSheet) sheet.hideSheet();
  }
  return sheet;
}

// ---------- game registry: owner and rev per game ----------

function readRegistry_(ss) {
  var sheet = hiddenSheet_(ss, REGISTRY_TAB, REGISTRY_HEADER);
  var rows = readRows_(sheet, REGISTRY_HEADER.length);
  var reg = {};
  for (var r = 0; r < rows.length; r++) {
    var id = String(rows[r][0]);
    if (!id) continue;
    reg[id] = {
      game_id: id, owner_id: String(rows[r][1] || ''), owner_name: String(rows[r][2] || ''), rev: Number(rows[r][3]) || 0,
      updated_by: String(rows[r][4] || ''), updated_at: String(rows[r][5] || ''), deleted: String(rows[r][6]) === 'true'
    };
  }
  return reg;
}

function saveRegistry_(ss, reg) {
  var rows = [];
  var ids = Object.keys(reg).sort();
  for (var i = 0; i < ids.length; i++) {
    var x = reg[ids[i]];
    rows.push([x.game_id, x.owner_id, x.owner_name, String(x.rev), x.updated_by, x.updated_at, String(!!x.deleted)]);
  }
  writeRows_(hiddenSheet_(ss, REGISTRY_TAB, REGISTRY_HEADER), rows, REGISTRY_HEADER.length);
}

/** Games pushed before version 4 (in the Games tab or the snapshot) become the admin's, rev 1. */
function migrate_(ss, reg, admin) {
  var n = 0;
  var add = function (id) {
    id = String(id);
    if (!id || reg[id]) return;
    reg[id] = { game_id: id, owner_id: admin.id, owner_name: admin.name, rev: 1, updated_by: admin.name, updated_at: new Date().toISOString(), deleted: false };
    n++;
  };
  var games = ss.getSheetByName('Games');
  if (games) {
    var header = readHeader_(games);
    var idCol = header.indexOf('id');
    if (idCol >= 0) {
      var rows = readRows_(games, header.length);
      for (var r = 0; r < rows.length; r++) add(rows[r][idCol]);
    }
  }
  var snap = ss.getSheetByName(SNAPSHOT_TAB);
  if (snap) {
    var srows = readRows_(snap, 3);
    for (var s = 0; s < srows.length; s++) {
      var key = String(srows[s][0]);
      if (key.indexOf('game:') === 0) add(key.substring(5));
    }
  }
  return n;
}

/** May `who` write game `id`, given the rev their copy is based on? Returns null or a rejection. */
function gameCheck_(r, who, base) {
  if (!r) return null; // a new game: the pusher will own it
  if (!r.owner_id) return { reason: 'unowned', owner_id: '', owner_name: '', rev: r.rev };
  if (r.owner_id !== who.id) return { reason: 'not_owner', owner_id: r.owner_id, owner_name: r.owner_name, rev: r.rev };
  if (typeof base === 'number' && r.rev > base) return { reason: 'stale', owner_id: r.owner_id, owner_name: r.owner_name, rev: r.rev };
  return null;
}

function regView_(r) {
  return { game_id: r.game_id, owner_id: r.owner_id, owner_name: r.owner_name, rev: r.rev, updated_by: r.updated_by, updated_at: r.updated_at, deleted: !!r.deleted };
}

// ---------- audit ----------

function audit_(ss, who, action, games, detail) {
  var sheet = hiddenSheet_(ss, AUDIT_TAB, AUDIT_HEADER);
  var rows = readRows_(sheet, AUDIT_HEADER.length);
  rows.push([new Date().toISOString(), who.id, who.name, action, (games || []).join(' '), detail || '']);
  if (rows.length > AUDIT_MAX) rows = rows.slice(rows.length - AUDIT_MAX);
  writeRows_(sheet, rows, AUDIT_HEADER.length);
}

// ---------- push ----------

function normName_(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function stamp_(rows, name) {
  var out = [];
  for (var i = 0; i < (rows || []).length; i++) {
    var o = {};
    for (var k in rows[i]) o[k] = rows[i][k];
    o.edited_by = name;
    out.push(o);
  }
  return out;
}

/**
 * req.upsert: { Players: {rows, delete}, Games: {rows, delete} }
 * req.replace: { game_ids, tabs: { Points, Events, 'Player Stats', 'Game Stats' } }
 * req.snapshot: { full, base: {teams, players}, games: [{id, game, points, events}], delete }
 * req.games_base: { game_id: rev the app's copy is based on } (version 4 apps)
 * Games the pusher may not write are left out and listed in `rejected`; the rest is
 * written. Players are merged by id: the newer updated_at wins.
 */
function push_(req, ss, who, props) {
  ensureTabs_(ss);
  var all = props.getProperties();
  var reg = readRegistry_(ss);
  var migrated = migrate_(ss, reg, adminWho_(all));
  var bases = req.games_base && typeof req.games_base === 'object' ? req.games_base : null;
  var up = req.upsert || {};
  var rep = req.replace || {};
  var snap = req.snapshot || null;

  // Which games does this push touch, and may this person write each one?
  var touched = {};
  var deleting = {};
  var note = function (id) { if (id !== undefined && id !== null && id !== '') touched[String(id)] = true; };
  var gUp = up.Games || {};
  (gUp.rows || []).forEach(function (r) { note(r.id); });
  (gUp['delete'] || []).forEach(function (id) { note(id); deleting[String(id)] = true; });
  (rep.game_ids || []).forEach(note);
  if (snap) {
    (snap.games || []).forEach(function (g) { note(g.id); });
    (snap['delete'] || []).forEach(function (id) { note(id); deleting[String(id)] = true; });
  }
  var ok = {};
  var rejected = [];
  Object.keys(touched).sort().forEach(function (id) {
    var no = gameCheck_(reg[id], who, bases ? bases[id] : undefined);
    if (no) { no.game_id = id; rejected.push(no); } else ok[id] = true;
  });
  var mine = function (id) { return ok[String(id)] === true; };

  var counts = {};
  var notes = [];
  // Players: shared, merged by id (newer updated_at wins).
  if (up.Players) counts.Players = upsertPlayers_(ss, up.Players, who, notes);
  // Games: only the ones this person may write.
  if (up.Games) {
    counts.Games = upsertRows_(ss.getSheetByName('Games'),
      stamp_((gUp.rows || []).filter(function (r) { return mine(r.id); }), who.name),
      (gUp['delete'] || []).filter(mine));
  }
  var gameIds = (rep.game_ids || []).filter(mine);
  if (gameIds.length) {
    var games = {};
    for (var g = 0; g < gameIds.length; g++) games[String(gameIds[g])] = true;
    for (var t = 0; t < GAME_TABS.length; t++) {
      var tab = GAME_TABS[t];
      var sh = ss.getSheetByName(tab);
      var hdr = readHeader_(sh);
      var gCol = hdr.indexOf('game_id');
      var kept = readRows_(sh, hdr.length).filter(function (x) { return !games[String(x[gCol])]; });
      var add = ((rep.tabs && rep.tabs[tab]) || []).filter(function (r) { return games[String(r.game_id)]; });
      if (tab === 'Points' || tab === 'Events') add = stamp_(add, who.name);
      for (var k = 0; k < add.length; k++) kept.push(toRow_(hdr, add[k]));
      writeRows_(sh, kept, hdr.length);
      counts[tab] = { replaced_games: gameIds.length, written: add.length, total: kept.length };
    }
  }
  if (snap) {
    counts.snapshot = writeSnapshot_(ss, {
      full: !!snap.full && who.role === 'admin',
      base: snap.base,
      games: (snap.games || []).filter(function (x) { return mine(x.id); }),
      'delete': (snap['delete'] || []).filter(mine)
    }, req.schema_version, who);
  }

  // Registry: accepted games get a new rev; new games belong to the pusher.
  var now = new Date().toISOString();
  var out = {};
  Object.keys(ok).forEach(function (id) {
    var r = reg[id] || { game_id: id, owner_id: who.id, owner_name: who.name, rev: 0 };
    r.rev = (Number(r.rev) || 0) + 1;
    r.updated_by = who.name;
    r.updated_at = now;
    r.deleted = !!deleting[id];
    reg[id] = r;
    out[id] = regView_(r);
  });
  saveRegistry_(ss, reg);
  var detail = [];
  if (counts.Players) detail.push('players ' + counts.Players.upserted + (counts.Players.skipped ? ' (' + counts.Players.skipped + ' older skipped)' : ''));
  if (rejected.length) detail.push('rejected ' + rejected.map(function (x) { return x.game_id + ':' + x.reason; }).join(' '));
  if (migrated) detail.push('migrated ' + migrated + ' games to admin');
  if (notes.length) detail.push(notes.join('; '));
  audit_(ss, who, snap && snap.full ? 'push_all' : 'push', Object.keys(ok).sort(), detail.join(' | '));
  writeMeta_(ss, { schema_version: req.schema_version || '', script_version: SCRIPT_VERSION, last_push_at: now, last_push_by: who.name });
  return { ok: true, version: SCRIPT_VERSION, who: who, counts: counts, games: out, rejected: rejected, migrated: migrated };
}

/** Upsert rows by id and drop deleted ids. */
function upsertRows_(sheet, incoming, dels) {
  var header = readHeader_(sheet);
  var idCol = header.indexOf('id');
  var rows = readRows_(sheet, header.length);
  var at = {};
  for (var r = 0; r < rows.length; r++) at[String(rows[r][idCol])] = r;
  for (var i = 0; i < incoming.length; i++) {
    var row = toRow_(header, incoming[i]);
    var key = String(incoming[i].id);
    if (at.hasOwnProperty(key)) rows[at[key]] = row;
    else {
      at[key] = rows.length;
      rows.push(row);
    }
  }
  var drop = {};
  for (var d = 0; d < (dels || []).length; d++) drop[String(dels[d])] = true;
  rows = rows.filter(function (x) { return !drop[String(x[idCol])]; });
  writeRows_(sheet, rows, header.length);
  return { upserted: incoming.length, deleted: (dels || []).length, total: rows.length };
}

/** Players are shared: an older copy never overwrites a newer one. Flags likely duplicates. */
function upsertPlayers_(ss, part, who, notes) {
  var sheet = ss.getSheetByName('Players');
  var header = readHeader_(sheet);
  var col = function (n) { return header.indexOf(n); };
  var rows = readRows_(sheet, header.length);
  var at = {};
  for (var r = 0; r < rows.length; r++) at[String(rows[r][col('id')])] = r;
  var time = function (v) { var t = v instanceof Date ? v.getTime() : Date.parse(String(v)); return isNaN(t) ? 0 : t; };
  var keep = [];
  var skipped = 0;
  for (var i = 0; i < (part.rows || []).length; i++) {
    var p = part.rows[i];
    var key = String(p.id);
    if (at.hasOwnProperty(key)) {
      if (time(rows[at[key]][col('updated_at')]) > time(p.updated_at)) { skipped++; continue; }
    } else {
      for (var e = 0; e < rows.length; e++) {
        var x = rows[e];
        if (String(x[col('deleted')]) === 'true' || x[col('deleted')] === true) continue;
        if ((normName_(x[col('name')]) && normName_(x[col('name')]) === normName_(p.name)) || (String(x[col('number')]) === String(p.number) && !p.deleted)) {
          notes.push('possible duplicate player ' + p.name + ' #' + p.number + ' (like ' + x[col('name')] + ' #' + x[col('number')] + ')');
          break;
        }
      }
    }
    keep.push(p);
  }
  var res = upsertRows_(sheet, stamp_(keep, who.name), part['delete'] || []);
  res.skipped = skipped;
  return res;
}

// ---------- pull, claim, release, reassign ----------

function pull_(ss, who, props) {
  var all = props.getProperties();
  var reg = readRegistry_(ss);
  if (migrate_(ss, reg, adminWho_(all))) saveRegistry_(ss, reg);
  var s = readSnapshot_(ss) || { teams: [], players: [], games: [], points: [], events: [], info: {} };
  var list = [];
  Object.keys(reg).sort().forEach(function (id) { list.push(regView_(reg[id])); });
  return {
    ok: true, app: 'port-authority-stats', version: SCRIPT_VERSION, kind: 'snapshot', who: who,
    updated_at: s.info.updated_at || null, full_at: s.info.full_at || null, schema_version: s.info.schema_version || null,
    teams: s.teams, players: s.players, games: s.games, points: s.points, events: s.events,
    registry: list, people: people_(props)
  };
}

function ownership_(req, ss, who, props) {
  var all = props.getProperties();
  var reg = readRegistry_(ss);
  if (migrate_(ss, reg, adminWho_(all))) saveRegistry_(ss, reg);
  var id = String(req.game_id || '');
  var r = reg[id];
  if (!r) return { ok: false, error: 'unknown_game', message: 'That game has not been pushed yet.' };
  var admin = who.role === 'admin';
  if (req.action === 'claim') {
    if (r.owner_id && r.owner_id !== who.id && !admin) return { ok: false, error: 'not_owner', message: r.owner_name + ' has this game. Only the admin can reassign it.', owner_name: r.owner_name };
    r.owner_id = who.id;
    r.owner_name = who.name;
  } else if (req.action === 'release') {
    if (r.owner_id !== who.id && !admin) return { ok: false, error: 'not_owner', message: 'Only ' + (r.owner_name || 'the owner') + ' or the admin can release this game.', owner_name: r.owner_name };
    r.owner_id = '';
    r.owner_name = '';
  } else {
    if (!admin) return { ok: false, error: 'admin_only', message: 'Only the admin can reassign games.' };
    var to = null;
    var ppl = people_(props);
    for (var i = 0; i < ppl.length; i++) if (ppl[i].id === String(req.to_id)) to = ppl[i];
    if (!to) return { ok: false, error: 'unknown_person', message: 'No active stat-taker with that id.' };
    r.owner_id = to.id;
    r.owner_name = to.name;
  }
  saveRegistry_(ss, reg);
  audit_(ss, who, req.action + (req.action === 'reassign' ? ' to ' + r.owner_name : ''), [id], '');
  return { ok: true, version: SCRIPT_VERSION, who: who, game: regView_(r) };
}

// ---------- team-view snapshot ----------

function snapshotSheet_(ss) {
  return hiddenSheet_(ss, SNAPSHOT_TAB, SNAPSHOT_HEADER);
}

function chunkRows_(key, value) {
  var text = JSON.stringify(value);
  var rows = [];
  for (var i = 0, part = 0; i < text.length || part === 0; i += SNAPSHOT_CHUNK, part++) {
    rows.push([key, part, CHUNK_PREFIX + text.substring(i, i + SNAPSHOT_CHUNK)]);
  }
  return rows;
}

/** The stored snapshot entries: { key: value } (chunks joined and parsed), in order. */
function readEntries_(sheet) {
  var rows = readRows_(sheet, 3);
  var parts = {};
  var order = [];
  for (var r = 0; r < rows.length; r++) {
    var key = String(rows[r][0]);
    if (!key) continue;
    if (!parts[key]) { parts[key] = []; order.push(key); }
    parts[key][Number(rows[r][1]) || 0] = String(rows[r][2]).substring(CHUNK_PREFIX.length);
  }
  var out = { order: order, values: {} };
  for (var i = 0; i < order.length; i++) {
    try { out.values[order[i]] = JSON.parse(parts[order[i]].join('')); } catch (err) { out.values[order[i]] = null; }
  }
  return out;
}

/** Players merged by id: the newer updated_at wins. Teams: only the admin changes them. */
function mergeBase_(old, incoming, who) {
  old = old || { teams: [], players: [] };
  if (!incoming) return old;
  var byId = {};
  var order = [];
  (old.players || []).forEach(function (p) { byId[p.id] = p; order.push(p.id); });
  (incoming.players || []).forEach(function (p) {
    if (!byId[p.id]) order.push(p.id);
    if (!byId[p.id] || (Number(p.updated_at) || 0) >= (Number(byId[p.id].updated_at) || 0)) byId[p.id] = p;
  });
  var teams = who.role === 'admin' || !(old.teams || []).length ? (incoming.teams || old.teams || []) : old.teams;
  return { teams: teams, players: order.map(function (id) { return byId[id]; }) };
}

/**
 * snap: { full, base: {teams, players}, games: [{id, game, points, events}], delete: [game ids] }
 * Stored as rows (key, part, chunk): "base", "game:<id>" and "info". Only the listed games
 * change; other people's games stay. `full` (admin's Push everything) marks it complete.
 */
function writeSnapshot_(ss, snap, schemaVersion, who) {
  var sheet = snapshotSheet_(ss);
  var cur = readEntries_(sheet);
  var info = cur.values.info || {};
  var drop = {};
  var games = snap.games || [];
  for (var g = 0; g < games.length; g++) drop['game:' + games[g].id] = true;
  var dels = snap['delete'] || [];
  for (var d = 0; d < dels.length; d++) drop['game:' + dels[d]] = true;
  var rows = chunkRows_('base', mergeBase_(cur.values.base, snap.base, who || { role: 'admin' }));
  for (var i = 0; i < cur.order.length; i++) {
    var key = cur.order[i];
    if (key === 'info' || key === 'base' || drop[key] || cur.values[key] === null) continue;
    rows = rows.concat(chunkRows_(key, cur.values[key]));
  }
  for (var k = 0; k < games.length; k++) rows = rows.concat(chunkRows_('game:' + games[k].id, games[k]));
  var now = new Date().toISOString();
  info = { updated_at: now, full_at: snap.full ? now : (info.full_at || null), schema_version: schemaVersion || info.schema_version || null };
  rows.push(['info', 0, CHUNK_PREFIX + JSON.stringify(info)]);
  writeRows_(sheet, rows, 3);
  return { games: games.length, deleted: dels.length, full: !!snap.full, rows: rows.length };
}

/** Rebuild the snapshot from its chunks. */
function readSnapshot_(ss) {
  var sheet = ss.getSheetByName(SNAPSHOT_TAB);
  if (!sheet) return null;
  var cur = readEntries_(sheet);
  var out = { teams: [], players: [], games: [], points: [], events: [], info: cur.values.info || {} };
  for (var i = 0; i < cur.order.length; i++) {
    var key = cur.order[i];
    var v = cur.values[key];
    if (!v || key === 'info') continue;
    if (key === 'base') { out.teams = v.teams || []; out.players = v.players || []; }
    else if (key.indexOf('game:') === 0) {
      out.games.push(v.game);
      out.points = out.points.concat(v.points || []);
      out.events = out.events.concat(v.events || []);
    }
  }
  return out;
}

function snapshotResponse_(ss) {
  if (!ss) return { ok: false, error: 'no_sheet', message: 'The script must be opened from the Sheet (Extensions > Apps Script).' };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'busy', message: 'A sync is running. Try again in a moment.' };
  try {
    var s = readSnapshot_(ss);
    if (!s || !s.games.length && !s.players.length) return { ok: false, error: 'no_snapshot', message: 'No team view data yet. In the app, open Settings and click Push everything.' };
    return {
      ok: true, app: 'port-authority-stats', version: SCRIPT_VERSION, kind: 'snapshot',
      updated_at: s.info.updated_at || null, full_at: s.info.full_at || null, schema_version: s.info.schema_version || null,
      teams: s.teams, players: s.players, games: s.games, points: s.points, events: s.events
    };
  } catch (err) {
    return { ok: false, error: 'script_error', message: String(err && err.message ? err.message : err) };
  } finally {
    lock.releaseLock();
  }
}

function writeMeta_(ss, kv) {
  var sheet = ss.getSheetByName('Meta');
  var rows = [];
  for (var k in kv) rows.push([k, String(kv[k])]);
  writeRows_(sheet, rows, 2);
}

// ---------- run these from the editor ----------

/**
 * One-time setup: creates the tabs and headers and, if no admin key exists yet,
 * generates one and prints it ONCE in the Execution log. Copy it into the app's Settings.
 */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var report = ensureTabs_(ss);
  var props = PropertiesService.getScriptProperties();
  var lines = [];
  for (var i = 0; i < report.length; i++) lines.push(report[i].name + ': ' + report[i].status);
  Logger.log('Tabs: ' + lines.join(', '));
  if (props.getProperty(ADMIN_HASH_PROPERTY) || props.getProperty(TOKEN_PROPERTY)) {
    Logger.log('An admin key is already set (not shown again). Run rotateToken() to make a new one.');
    return;
  }
  var token = newToken_();
  props.setProperty(ADMIN_HASH_PROPERTY, sha256_(token));
  Logger.log('Your admin key (copy it into the app: Settings > Your key). It is shown only this once:');
  Logger.log(token);
}

/** Replace the admin key (e.g. if it leaked). Paste the new one into the app on your own device. */
function rotateToken() {
  var token = newToken_();
  var props = PropertiesService.getScriptProperties();
  props.setProperty(ADMIN_HASH_PROPERTY, sha256_(token));
  props.deleteProperty(TOKEN_PROPERTY);
  Logger.log('New admin key (the old one stops working now):');
  Logger.log(token);
}
function rotateAdminKey() { rotateToken(); }

/** The name stat-takers see for the admin, e.g. setAdminName('Jacob') (or use the Sheet menu). */
function setAdminName(name) {
  PropertiesService.getScriptProperties().setProperty(ADMIN_NAME_PROPERTY, String(name || 'Admin').trim() || 'Admin');
  Logger.log('Admin name set.');
}

function createTaker_(name) {
  var props = PropertiesService.getScriptProperties();
  var id = 'st_' + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
  var key = newToken_();
  props.setProperty(KEY_PREFIX + id, JSON.stringify({ name: name, hash: sha256_(key), created_at: new Date().toISOString(), revoked: false }));
  return { id: id, key: key };
}

/** Make a key for a stat-taker. It is printed ONCE; send it to them privately yourself. */
function addStatTaker(name) {
  name = String(name || '').trim();
  if (!name) throw new Error('Give a name. Easiest: reload the Sheet and use the menu Port Authority Stats > Add stat-taker.');
  var r = createTaker_(name);
  Logger.log('Stat-taker ' + name + ' (id ' + r.id + '). Their key, shown only this once:');
  Logger.log(r.key);
}

function takerLines_() {
  var all = PropertiesService.getScriptProperties().getProperties();
  var lines = [];
  for (var k in all) {
    if (k.indexOf(KEY_PREFIX) !== 0) continue;
    var rec = parseKey_(all[k]) || {};
    lines.push(k.substring(KEY_PREFIX.length) + '  ' + rec.name + '  created ' + (rec.created_at || '?') + '  last used ' + (rec.last_used || 'never') + (rec.revoked ? '  REVOKED ' + (rec.revoked_at || '') : ''));
  }
  return lines;
}

/** Names, ids and status of every stat-taker (never their keys). */
function listStatTakers() {
  var lines = takerLines_();
  Logger.log(lines.length ? lines.join('\n') : 'No stat-takers yet. Use Port Authority Stats > Add stat-taker in the Sheet.');
}

// ---------- the Sheet menu (Extensions-free way to run the above with a name) ----------

/** Adds the "Port Authority Stats" menu when the Sheet opens. */
function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('Port Authority Stats')
      .addItem('Add stat-taker…', 'menuAddStatTaker')
      .addItem('List stat-takers', 'menuListStatTakers')
      .addItem('Revoke stat-taker…', 'menuRevokeStatTaker')
      .addItem('Set admin name…', 'menuSetAdminName')
      .addToUi();
  } catch (err) {
    // not opened from the Sheet
  }
}

function ask_(title, text) {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt(title, text, ui.ButtonSet.OK_CANCEL);
  return r.getSelectedButton() === ui.Button.OK ? String(r.getResponseText() || '').trim() : '';
}
function menuAddStatTaker() {
  var name = ask_('Add stat-taker', 'Their name, as teammates will see it:');
  if (!name) return;
  var r = createTaker_(name);
  var ui = SpreadsheetApp.getUi();
  ui.alert('Key for ' + name, 'Copy this key now and send it to ' + name + ' privately (not in a group chat). It is shown only once.\n\n' + r.key + '\n\nid: ' + r.id, ui.ButtonSet.OK);
}
function menuListStatTakers() {
  var ui = SpreadsheetApp.getUi();
  var lines = takerLines_();
  ui.alert('Stat-takers', lines.length ? lines.join('\n') : 'None yet.', ui.ButtonSet.OK);
}
function menuRevokeStatTaker() {
  var lines = takerLines_();
  var id = ask_('Revoke stat-taker', (lines.length ? lines.join('\n') : 'None yet.') + '\n\nType the id to revoke (st_…):');
  if (!id) return;
  revokeStatTaker(id);
  SpreadsheetApp.getUi().alert('Revoked ' + id + '. Their games were released.');
}
function menuSetAdminName() {
  var name = ask_('Admin name', 'Your name, as stat-takers will see it (e.g. Jacob):');
  if (name) setAdminName(name);
}

/** Stop a stat-taker's key working. Their games are released so someone else can claim them. */
function revokeStatTaker(id) {
  var props = PropertiesService.getScriptProperties();
  var rec = parseKey_(props.getProperty(KEY_PREFIX + id) || '');
  if (!rec) throw new Error('No stat-taker with id ' + id + '. Run listStatTakers() to see ids.');
  rec.revoked = true;
  rec.revoked_at = new Date().toISOString();
  props.setProperty(KEY_PREFIX + id, JSON.stringify(rec));
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var released = [];
  if (ss) {
    var reg = readRegistry_(ss);
    for (var g in reg) if (reg[g].owner_id === id) { reg[g].owner_id = ''; reg[g].owner_name = ''; released.push(g); }
    saveRegistry_(ss, reg);
    audit_(ss, adminWho_(props.getProperties()), 'revoke ' + rec.name, released, '');
  }
  Logger.log('Revoked ' + rec.name + '. Released ' + released.length + ' game(s).');
}

function newToken_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}
