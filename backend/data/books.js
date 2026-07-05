const { GetAllBooks, Language } = require("@biblebites/bible-reference");
const extraAliases = require("./book-aliases");

// canonical book/chapter/verse-count validation table (design doc §6),
// each entry also carries the alias name-forms the extractor matches against.
const BOOKS = GetAllBooks(Language.English).map((b) => {
  const extra = extraAliases[b.id] || {};
  const primary = new Set([b.name.toLowerCase(), ...(extra.primary || [])]);
  const variant = new Set(extra.variant || []);
  return {
    id: b.id,
    name: b.name,
    primaryAliases: [...primary],
    variantAliases: [...variant],
    maxChapter: b.chapters.length,
    versesPerChapter: b.chapters, // versesPerChapter[chapterNum - 1]
  };
});

// longest alias first, so multi-word aliases (e.g. "song of solomon") match before shorter substrings
const ALIAS_TO_BOOK = new Map(); // alias -> { book, tier: 'primary' | 'variant' }
for (const book of BOOKS) {
  for (const alias of book.primaryAliases) ALIAS_TO_BOOK.set(alias, { book, tier: "primary" });
  for (const alias of book.variantAliases) ALIAS_TO_BOOK.set(alias, { book, tier: "variant" });
}
const ALIASES_BY_LENGTH_DESC = [...ALIAS_TO_BOOK.keys()].sort((a, b) => b.length - a.length);

function findBookByAlias(alias) {
  return ALIAS_TO_BOOK.get(alias);
}

module.exports = { BOOKS, ALIASES_BY_LENGTH_DESC, findBookByAlias };
