const { BOOKS } = require("../../data/books");

// design doc §3: cheap, high-leverage fix — boost the STT engine toward book names
// before it ever reaches our regex/alias layer. Shared by file-based and live STT paths.
const BOOK_KEYTERMS = BOOKS.map((b) => b.name);

module.exports = { BOOK_KEYTERMS };
