// Resolution stage (design doc §4 stage 5): local DB lookup, the last step before
// `content.resolved` — turns a validated candidate into actual displayable verse text.
const { resolvePath, requireNative } = require("../paths");
const Database = requireNative("better-sqlite3");

let db = null;
function getDb() {
  if (!db) {
    db = new Database(resolvePath("data", "verses.db"), { readonly: true, fileMustExist: true });
  }
  return db;
}

// candidate: { bookId, bookName, chapter, verseStart, verseEnd }
function resolveVerseText(candidate) {
  const { bookId, chapter, verseStart, verseEnd } = candidate;

  if (verseStart == null) {
    const rows = getDb()
      .prepare("SELECT verse, text FROM verses WHERE book_id = ? AND chapter = ? ORDER BY verse")
      .all(bookId, chapter);
    return rows.map((r) => `${r.verse} ${r.text}`).join("\n");
  }

  const rows = getDb()
    .prepare("SELECT verse, text FROM verses WHERE book_id = ? AND chapter = ? AND verse BETWEEN ? AND ? ORDER BY verse")
    .all(bookId, chapter, verseStart, verseEnd ?? verseStart);
  return rows.map((r) => (verseEnd != null ? `${r.verse} ${r.text}` : r.text)).join("\n");
}

module.exports = { resolveVerseText };
