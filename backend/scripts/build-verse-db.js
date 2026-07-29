// Loads the public-domain KJV text (design doc §6/§8 step 2) into a local SQLite
// table, keyed by our canonical book id so lookups match validate.js's output directly.
const path = require("path");
const Database = require("better-sqlite3");
const { BOOKS } = require("../data/books");
const verses = require("kjv/json/verses-1769.json");

const DB_PATH = path.join(__dirname, "..", "data", "verses.db");
const db = new Database(DB_PATH);

db.exec(`
  DROP TABLE IF EXISTS verses;
  CREATE TABLE verses (
    book_id TEXT NOT NULL,
    chapter INTEGER NOT NULL,
    verse INTEGER NOT NULL,
    text TEXT NOT NULL,
    PRIMARY KEY (book_id, chapter, verse)
  );
`);

// kjv's keys are "<kjv book name> chapter:verse" — the kjv dataset and @biblebites/bible-reference
// both list books in standard 66-book canonical order, so we map by that shared ordering rather
// than by name (the two sources spell "Song of Songs" differently: "Solomon's Song" vs "Song of Songs").
const kjvBookNames = [...new Set(Object.keys(verses).map((k) => k.replace(/\s\d+:\d+$/, "")))];

const insert = db.prepare("INSERT INTO verses (book_id, chapter, verse, text) VALUES (?, ?, ?, ?)");
const insertMany = db.transaction((rows) => {
  for (const row of rows) insert.run(...row);
});

const bookIdByKjvName = new Map(BOOKS.map((book, i) => [kjvBookNames[i], book.id]));

const rows = [];
for (const [key, text] of Object.entries(verses)) {
  const refMatch = key.match(/^(.+) (\d+):(\d+)$/);
  const bookId = bookIdByKjvName.get(refMatch[1]);
  // `kjv`'s source text has a stray leading "# " (paragraph-marker artifact) on
  // some verses — e.g. John 3:16 — that would otherwise show up literally on
  // the projector/operator preview. Strip it; it's not part of the verse text.
  rows.push([bookId, Number(refMatch[2]), Number(refMatch[3]), text.replace(/^#\s*/, "")]);
}
insertMany(rows);

// Full-text index for lib/detection/content-search.js ("what's the verse that
// talks about..."). Built here, at build time, because the shipped verses.db has
// to be complete before it's installed: a native installer puts it in a
// read-only app folder, so content-search can't create this on first use the way
// it used to. External-content FTS5 — indexes the rows above rather than
// duplicating the verse text, so this costs index size only.
db.exec(`
  DROP TABLE IF EXISTS verses_fts;
  CREATE VIRTUAL TABLE verses_fts USING fts5(text, content='verses', content_rowid='rowid');
  INSERT INTO verses_fts(verses_fts) VALUES('rebuild');
`);

console.log(`Loaded ${rows.length} verses into ${DB_PATH}`);
db.close();
