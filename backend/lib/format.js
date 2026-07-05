// Shared "Book C:V-V" reference formatting — used wherever a candidate needs
// to become the human-readable string shown to the operator/projector
// (live detection, manual entry, and a nudge re-formatting its new range).
function formatReference({ bookName, chapter, verseStart, verseEnd }) {
  if (verseStart == null) return `${bookName} ${chapter}`;
  return `${bookName} ${chapter}:${verseStart}${verseEnd ? `-${verseEnd}` : ""}`;
}

module.exports = { formatReference };
