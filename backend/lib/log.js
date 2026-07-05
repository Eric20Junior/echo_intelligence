// Session/log table (design doc §6): every detected candidate — matched or not,
// displayed or not — gets logged. This is the ground-truth dataset for tuning the
// alias table and confidence thresholds after real church services, and (roadmap
// Phase 8 step 2) the backing store for the operator's History tab — no separate
// history storage, this table already has everything except the eventual
// operator decision, added below.
const { resolvePath, requireNative } = require("./paths");
const { BOOKS } = require("../data/books");
const Database = requireNative("better-sqlite3");

const BOOK_NAME_BY_ID = new Map(BOOKS.map((b) => [b.id, b.name]));

let db = null;
function getDb() {
  if (!db) {
    db = new Database(resolvePath("data", "log.db"));
    db.exec(`
      CREATE TABLE IF NOT EXISTS detections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        raw_text TEXT NOT NULL,
        normalized_text TEXT,
        status TEXT NOT NULL,
        source TEXT,
        book_id TEXT,
        chapter INTEGER,
        verse_start INTEGER,
        verse_end INTEGER,
        confidence REAL,
        reason TEXT
      );
    `);
    // Migration for DBs created before Phase 8's History tab: `decision` tracks
    // what the operator actually did with a detection (auto/confirmed/rejected/
    // pending/manual), separate from `status` which only reflects the detector's
    // own confidence-gate output at log time.
    const columns = db.prepare("PRAGMA table_info(detections)").all().map((c) => c.name);
    if (!columns.includes("decision")) db.exec("ALTER TABLE detections ADD COLUMN decision TEXT");
    if (!columns.includes("resolved_at")) db.exec("ALTER TABLE detections ADD COLUMN resolved_at TEXT");
    // lib/detection/alias-miner.js pairs a `manual` row with the nearest preceding
    // `no_match` row logged the same calendar day — this column makes "same day"
    // cheap to query instead of substr-ing created_at every mining run. Safe to
    // backfill for existing rows: it's just a date substring of data already
    // stored, nothing about it is lost or inferred.
    if (!columns.includes("service_date")) {
      db.exec("ALTER TABLE detections ADD COLUMN service_date TEXT");
      db.exec("UPDATE detections SET service_date = substr(created_at, 1, 10) WHERE service_date IS NULL");
    }

    // Audit trail for lib/detection/calibrate.js: every time it lowers the confidence
    // threshold, it records the evidence here — never just silently overwrites the
    // config value with no way to see why later.
    db.exec(`
      CREATE TABLE IF NOT EXISTS threshold_adjustments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        old_threshold REAL NOT NULL,
        new_threshold REAL NOT NULL,
        band_start REAL NOT NULL,
        band_end REAL NOT NULL,
        confirmed_count INTEGER NOT NULL,
        rejected_count INTEGER NOT NULL
      );
    `);

    // lib/detection/alias-miner.js's output: candidate new aliases mined from
    // paired manual-entry/no_match rows, always human-reviewed (never auto-applied
    // — see the module header for why). UNIQUE(book_id, alias_text) means once a
    // pair has been suggested once, it's never suggested again regardless of
    // status — an operator's rejected/ignored decision is permanent, not just
    // until the next mining run re-notices the same pattern.
    db.exec(`
      CREATE TABLE IF NOT EXISTS alias_suggestions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        book_id TEXT NOT NULL,
        alias_text TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected | ignored
        occurrence_count INTEGER NOT NULL,
        distinct_dates_count INTEGER NOT NULL,
        sample_raw_texts TEXT NOT NULL, -- JSON array, up to a few examples for the reviewer
        resolved_at TEXT,
        last_matched_at TEXT, -- set once approved and actually used in a real detection
        UNIQUE(book_id, alias_text)
      );
    `);

    // lib/detection/phrase-miner.js's output: same "improves over time,
    // human-reviewed" shape as alias_suggestions, but for content-search lookup
    // phrases (lib/detection/content-search.js) instead of single mis-heard book
    // words — mined from utterances that passed the lookup trigger gate but
    // whose match was rejected/missing, later resolved by the operator to a
    // specific verse. UNIQUE on the target verse: one phrase-learning entry per
    // verse, samples accumulate onto it rather than creating duplicate rows.
    db.exec(`
      CREATE TABLE IF NOT EXISTS phrase_suggestions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        book_id TEXT NOT NULL,
        chapter INTEGER NOT NULL,
        verse_start INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected | ignored
        occurrence_count INTEGER NOT NULL,
        distinct_dates_count INTEGER NOT NULL,
        sample_raw_texts TEXT NOT NULL, -- JSON array, up to a few examples for the reviewer
        resolved_at TEXT,
        last_matched_at TEXT,
        UNIQUE(book_id, chapter, verse_start)
      );
    `);

    // lib/detection/reading-nav-miner.js's output: same "improves over time,
    // human-reviewed" shape again, this time for reading-mode navigation
    // phrasing (lib/detection/reading-mode.js) that the fixed patterns didn't
    // catch — e.g. an utterance that references a verse without saying
    // "verse"/"chapter" right next to a number at all. Mined from utterances
    // logged while a chapter was locked but no navigation pattern matched,
    // later resolved by the operator to a specific verse in that same
    // book+chapter. UNIQUE on the target verse, same reasoning as phrase_suggestions.
    db.exec(`
      CREATE TABLE IF NOT EXISTS reading_nav_suggestions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        book_id TEXT NOT NULL,
        chapter INTEGER NOT NULL,
        verse_start INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected | ignored
        occurrence_count INTEGER NOT NULL,
        distinct_dates_count INTEGER NOT NULL,
        sample_raw_texts TEXT NOT NULL, -- JSON array, up to a few examples for the reviewer
        resolved_at TEXT,
        last_matched_at TEXT,
        UNIQUE(book_id, chapter, verse_start)
      );
    `);
  }
  return db;
}

// Returns the inserted row's id so callers (lib/detect.js) can thread it through
// to lib/presentation.js, which later calls updateDecision once the operator
// actually acts on a `suggest`-status row (or immediately for auto/manual).
function logDetection(rawText, result) {
  const candidate = result.candidate || {};
  const initialDecision = result.status === "auto_display" ? "auto" : result.status === "suggest" ? "pending" : null;
  const info = getDb()
    .prepare(
      `INSERT INTO detections
        (raw_text, normalized_text, status, source, book_id, chapter, verse_start, verse_end, confidence, reason, decision, service_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%d', 'now'))`
    )
    .run(
      rawText,
      result.normalized ?? null,
      result.status,
      candidate.source ?? "regex",
      candidate.bookId ?? null,
      candidate.chapter ?? null,
      candidate.verseStart ?? null,
      candidate.verseEnd ?? null,
      result.confidence ?? null,
      result.reason ?? null,
      initialDecision
    );
  return info.lastInsertRowid;
}

function updateDecision(id, decision) {
  if (id == null) return;
  getDb()
    .prepare("UPDATE detections SET decision = ?, resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?")
    .run(decision, id);
}

// For lib/detection/calibrate.js: every suggest-tier detection the operator actually
// resolved (confirmed or rejected it — never "pending", which just means no one's
// looked at it yet). Only these two decisions carry real signal about whether the
// confidence score at that point was trustworthy.
function getSuggestOutcomes() {
  return getDb()
    .prepare(`SELECT confidence, decision FROM detections WHERE status = 'suggest' AND decision IN ('confirmed', 'rejected')`)
    .all();
}

function recordThresholdAdjustment({ oldThreshold, newThreshold, bandStart, bandEnd, confirmedCount, rejectedCount }) {
  getDb()
    .prepare(
      `INSERT INTO threshold_adjustments (old_threshold, new_threshold, band_start, band_end, confirmed_count, rejected_count)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(oldThreshold, newThreshold, bandStart, bandEnd, confirmedCount, rejectedCount);
}

// For lib/detection/alias-miner.js: raw material for pairing. `manual` rows carry
// the operator's clean typed reference (not the mis-heard audio, see
// lib/server/presentation.js#manualDisplay), so the miner needs the `no_match`
// rows separately to find what was actually said.
// chapter/verse_start are only consumed by lib/detection/phrase-miner.js (a
// specific-verse target, unlike alias-miner.js which only needs the book) —
// selected here too since both miners share this same raw material.
function getManualEntries() {
  return getDb()
    .prepare(`SELECT id, created_at, service_date, book_id, chapter, verse_start FROM detections WHERE decision = 'manual' ORDER BY id ASC`)
    .all();
}

function getNoMatchEntries() {
  return getDb()
    .prepare(`SELECT id, created_at, service_date, raw_text, normalized_text FROM detections WHERE status = 'no_match' ORDER BY id ASC`)
    .all();
}

// For lib/detection/phrase-miner.js: content-search suggestions the operator
// explicitly rejected (not 'pending' — unresolved yet, no signal; not
// 'confirmed' — that suggestion was already right, nothing to learn). Paired
// with a following `manual` entry the same way alias-miner.js pairs no_match
// rows, to find out which verse the operator actually meant.
function getContentSearchMisses() {
  return getDb()
    .prepare(
      `SELECT id, created_at, service_date, raw_text, normalized_text FROM detections
       WHERE source = 'content-search' AND status = 'suggest' AND decision = 'rejected' ORDER BY id ASC`
    )
    .all();
}

// For lib/detection/reading-nav-miner.js: no_match rows tagged by detect.js
// with the reading-mode lock that was active but didn't match any navigation
// pattern — book_id/chapter here are the LOCKED book/chapter at miss time,
// not a parsed candidate (reading-mode misses never produce one).
function getReadingModeMisses() {
  return getDb()
    .prepare(
      `SELECT id, created_at, service_date, raw_text, normalized_text, book_id, chapter FROM detections
       WHERE status = 'no_match' AND reason = 'reading-mode-miss' ORDER BY id ASC`
    )
    .all();
}

// Upserts evidence for a candidate alias — only ever creates a *new* row (a fresh
// suggestion for the reviewer); once one exists for a (book_id, alias_text) pair,
// re-mining never touches it again regardless of status, so an operator's past
// decision is permanent. Returns true if a new suggestion was actually created.
function upsertAliasSuggestion({ bookId, aliasText, occurrenceCount, distinctDatesCount, sampleRawTexts }) {
  const info = getDb()
    .prepare(
      `INSERT OR IGNORE INTO alias_suggestions (book_id, alias_text, occurrence_count, distinct_dates_count, sample_raw_texts)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(bookId, aliasText, occurrenceCount, distinctDatesCount, JSON.stringify(sampleRawTexts));
  return info.changes > 0;
}

function getPendingAliasSuggestions() {
  const rows = getDb()
    .prepare(`SELECT id, created_at, book_id, alias_text, occurrence_count, distinct_dates_count, sample_raw_texts FROM alias_suggestions WHERE status = 'pending' ORDER BY id DESC`)
    .all();
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    bookId: r.book_id,
    bookName: BOOK_NAME_BY_ID.get(r.book_id) ?? r.book_id,
    aliasText: r.alias_text,
    occurrenceCount: r.occurrence_count,
    distinctDatesCount: r.distinct_dates_count,
    sampleRawTexts: JSON.parse(r.sample_raw_texts),
  }));
}

// approved | rejected | ignored
function resolveAliasSuggestion(id, status) {
  getDb()
    .prepare("UPDATE alias_suggestions SET status = ?, resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND status = 'pending'")
    .run(status, id);
}

function getApprovedAliasSuggestions() {
  return getDb().prepare(`SELECT id, book_id, alias_text, last_matched_at FROM alias_suggestions WHERE status = 'approved'`).all();
}

function markAliasSuggestionMatched(id) {
  getDb().prepare("UPDATE alias_suggestions SET last_matched_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(id);
}

// 90-day expiry (CTO guardrail): an approved alias that hasn't matched anything
// in 90 days gets demoted back to pending for re-confirmation rather than quietly
// staying active forever or being silently deleted.
function expireStaleAliasSuggestions() {
  const info = getDb()
    .prepare(
      `UPDATE alias_suggestions SET status = 'pending'
       WHERE status = 'approved'
         AND (last_matched_at IS NULL OR last_matched_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-90 days'))
         AND resolved_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-90 days')`
    )
    .run();
  return info.changes;
}

// Same shape as the alias_suggestions CRUD above, for lib/detection/phrase-miner.js.
function upsertPhraseSuggestion({ bookId, chapter, verseStart, occurrenceCount, distinctDatesCount, sampleRawTexts }) {
  const info = getDb()
    .prepare(
      `INSERT OR IGNORE INTO phrase_suggestions (book_id, chapter, verse_start, occurrence_count, distinct_dates_count, sample_raw_texts)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(bookId, chapter, verseStart, occurrenceCount, distinctDatesCount, JSON.stringify(sampleRawTexts));
  return info.changes > 0;
}

function getPendingPhraseSuggestions() {
  const rows = getDb()
    .prepare(
      `SELECT id, created_at, book_id, chapter, verse_start, occurrence_count, distinct_dates_count, sample_raw_texts
       FROM phrase_suggestions WHERE status = 'pending' ORDER BY id DESC`
    )
    .all();
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    bookId: r.book_id,
    bookName: BOOK_NAME_BY_ID.get(r.book_id) ?? r.book_id,
    chapter: r.chapter,
    verseStart: r.verse_start,
    occurrenceCount: r.occurrence_count,
    distinctDatesCount: r.distinct_dates_count,
    sampleRawTexts: JSON.parse(r.sample_raw_texts),
  }));
}

// approved | rejected | ignored
function resolvePhraseSuggestion(id, status) {
  getDb()
    .prepare("UPDATE phrase_suggestions SET status = ?, resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND status = 'pending'")
    .run(status, id);
}

function getApprovedPhraseSuggestions() {
  return getDb()
    .prepare(`SELECT id, book_id, chapter, verse_start, sample_raw_texts, last_matched_at FROM phrase_suggestions WHERE status = 'approved'`)
    .all();
}

function markPhraseSuggestionMatched(id) {
  getDb().prepare("UPDATE phrase_suggestions SET last_matched_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(id);
}

function expireStalePhraseSuggestions() {
  const info = getDb()
    .prepare(
      `UPDATE phrase_suggestions SET status = 'pending'
       WHERE status = 'approved'
         AND (last_matched_at IS NULL OR last_matched_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-90 days'))
         AND resolved_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-90 days')`
    )
    .run();
  return info.changes;
}

// Same shape again, for lib/detection/reading-nav-miner.js.
function upsertReadingNavSuggestion({ bookId, chapter, verseStart, occurrenceCount, distinctDatesCount, sampleRawTexts }) {
  const info = getDb()
    .prepare(
      `INSERT OR IGNORE INTO reading_nav_suggestions (book_id, chapter, verse_start, occurrence_count, distinct_dates_count, sample_raw_texts)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(bookId, chapter, verseStart, occurrenceCount, distinctDatesCount, JSON.stringify(sampleRawTexts));
  return info.changes > 0;
}

function getPendingReadingNavSuggestions() {
  const rows = getDb()
    .prepare(
      `SELECT id, created_at, book_id, chapter, verse_start, occurrence_count, distinct_dates_count, sample_raw_texts
       FROM reading_nav_suggestions WHERE status = 'pending' ORDER BY id DESC`
    )
    .all();
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    bookId: r.book_id,
    bookName: BOOK_NAME_BY_ID.get(r.book_id) ?? r.book_id,
    chapter: r.chapter,
    verseStart: r.verse_start,
    occurrenceCount: r.occurrence_count,
    distinctDatesCount: r.distinct_dates_count,
    sampleRawTexts: JSON.parse(r.sample_raw_texts),
  }));
}

// approved | rejected | ignored
function resolveReadingNavSuggestion(id, status) {
  getDb()
    .prepare("UPDATE reading_nav_suggestions SET status = ?, resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND status = 'pending'")
    .run(status, id);
}

function getApprovedReadingNavSuggestions() {
  return getDb()
    .prepare(`SELECT id, book_id, chapter, verse_start, sample_raw_texts, last_matched_at FROM reading_nav_suggestions WHERE status = 'approved'`)
    .all();
}

function markReadingNavSuggestionMatched(id) {
  getDb().prepare("UPDATE reading_nav_suggestions SET last_matched_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(id);
}

function expireStaleReadingNavSuggestions() {
  const info = getDb()
    .prepare(
      `UPDATE reading_nav_suggestions SET status = 'pending'
       WHERE status = 'approved'
         AND (last_matched_at IS NULL OR last_matched_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-90 days'))
         AND resolved_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-90 days')`
    )
    .run();
  return info.changes;
}

// Pagination (roadmap Phase 8): search has to match the human-readable
// reference ("John 3:16"), which only exists after formatting — `book_id` is
// a short code ("JHN"), not searchable text — so this filters in JS after
// mapping rather than in SQL, then paginates the filtered result. Fetches the
// whole table each call; fine for a single service's log (hundreds to low
// thousands of rows), not built to scale past that.
function getHistory({ limit = 20, offset = 0, search = "" } = {}) {
  const rows = getDb()
    .prepare(
      `SELECT id, created_at, raw_text, status, source, book_id, chapter, verse_start, verse_end, confidence, reason, decision
       FROM detections ORDER BY id DESC`
    )
    .all();

  let entries = rows.map((r) => ({
    id: r.id,
    time: r.created_at,
    reference: r.book_id ? formatLogReference(r) : null,
    rawText: r.raw_text,
    status: r.status,
    source: r.source,
    confidence: r.confidence,
    decision: r.decision,
    reason: r.reason,
  }));

  if (search) {
    const needle = search.toLowerCase();
    entries = entries.filter((e) => `${e.reference ?? ""} ${e.rawText}`.toLowerCase().includes(needle));
  }

  const total = entries.length;
  const page = entries.slice(offset, offset + limit);
  return { history: page, total };
}

function formatLogReference(r) {
  const bookName = BOOK_NAME_BY_ID.get(r.book_id) ?? r.book_id;
  if (r.chapter == null) return bookName;
  const base = `${bookName} ${r.chapter}`;
  if (r.verse_start == null) return base;
  return `${base}:${r.verse_start}${r.verse_end ? `-${r.verse_end}` : ""}`;
}

module.exports = {
  logDetection,
  updateDecision,
  getHistory,
  getSuggestOutcomes,
  recordThresholdAdjustment,
  getManualEntries,
  getNoMatchEntries,
  upsertAliasSuggestion,
  getPendingAliasSuggestions,
  resolveAliasSuggestion,
  getApprovedAliasSuggestions,
  markAliasSuggestionMatched,
  expireStaleAliasSuggestions,
  getContentSearchMisses,
  upsertPhraseSuggestion,
  getPendingPhraseSuggestions,
  resolvePhraseSuggestion,
  getApprovedPhraseSuggestions,
  markPhraseSuggestionMatched,
  expireStalePhraseSuggestions,
  getReadingModeMisses,
  upsertReadingNavSuggestion,
  getPendingReadingNavSuggestions,
  resolveReadingNavSuggestion,
  getApprovedReadingNavSuggestions,
  markReadingNavSuggestionMatched,
  expireStaleReadingNavSuggestions,
};
