// Hand-built corpus (design doc §8 step 3): realistic spoken variants + deliberately
// garbled STT-style inputs, run before wiring up live audio. Each case's `expect`
// is the field(s) we assert on; anything omitted is not checked.
module.exports = [
  // full canonical
  { input: "John chapter three, verse sixteen", expect: { status: "auto_display", bookId: "JHN", chapter: 3, verseStart: 16 } },
  { input: "Romans chapter eight verse twenty eight", expect: { status: "auto_display", bookId: "ROM", chapter: 8, verseStart: 28 } },

  // compressed
  { input: "John three sixteen", expect: { status: "auto_display", bookId: "JHN", chapter: 3, verseStart: 16 } },
  { input: "Genesis one one", expect: { status: "auto_display", bookId: "GEN", chapter: 1, verseStart: 1 } },

  // digit form (already-punctuated STT output)
  { input: "Romans 8:28", expect: { status: "auto_display", bookId: "ROM", chapter: 8, verseStart: 28 } },
  { input: "John 3:16", expect: { status: "auto_display", bookId: "JHN", chapter: 3, verseStart: 16 } },

  // range
  { input: "Romans eight, verses twenty-eight through thirty", expect: { status: "auto_display", bookId: "ROM", chapter: 8, verseStart: 28, verseEnd: 30 } },
  { input: "Romans 8:28-30", expect: { status: "auto_display", bookId: "ROM", chapter: 8, verseStart: 28, verseEnd: 30 } },

  // chapter only
  { input: "turn with me to Psalm 23", expect: { status: "auto_display", bookId: "PSA", chapter: 23, verseStart: null } },
  { input: "let's turn to Ephesians chapter four", expect: { status: "auto_display", bookId: "EPH", chapter: 4, verseStart: null } },

  // numbered books
  { input: "First Corinthians thirteen four", expect: { status: "auto_display", bookId: "1CO", chapter: 13, verseStart: 4 } },
  { input: "1 Corinthians 13:4", expect: { status: "auto_display", bookId: "1CO", chapter: 13, verseStart: 4 } },
  { input: "Second Timothy chapter two", expect: { status: "auto_display", bookId: "2TI", chapter: 2, verseStart: null } },
  // single-chapter books are spoken without a chapter number ("Jude verse 3", not "Jude chapter 1 verse 3") — chapter defaults to 1
  { input: "Third John verse one", expect: { status: "auto_display", bookId: "3JN", chapter: 1, verseStart: 1 } },
  { input: "Jude verses three and four", expect: { status: "auto_display", bookId: "JUD", chapter: 1, verseStart: 3, verseEnd: 4 } },

  // homophone / STT-garbled book names (design doc §3.1, and our own spike finding)
  // alias-corrected + chapter-only naturally scores below the auto-display threshold — surfaced as a suggestion chip, not silently discarded
  { input: "sam one hundred and twenty eight", expect: { status: "suggest", bookId: "PSA", chapter: 128 } },
  { input: "ephesian's chapter two verse eight", expect: { status: "auto_display", bookId: "EPH", chapter: 2, verseStart: 8 } },
  { input: "philippine's four thirteen", expect: { status: "auto_display", bookId: "PHP", chapter: 4, verseStart: 13 } },
  { input: "revelations chapter twenty one", expect: { status: "suggest", bookId: "REV", chapter: 21, verseStart: null } },

  // structurally-plausible but invalid references (validation gate, design doc §4 stage 4)
  { input: "Jude chapter three", expect: { status: "invalid" } }, // Jude has 1 chapter
  { input: "3 John chapter one verse twenty", expect: { status: "invalid" } }, // 3 John ch1 has 15 verses
  { input: "Psalm 151", expect: { status: "invalid" } }, // Psalms has 150 chapters

  // non-reference numbers that look like references (must not false-positive — no book anchor)
  { input: "in the year twenty sixteen", expect: { status: "no_match" } },
  { input: "he was three years old", expect: { status: "no_match" } },
  { input: "call me at five five five one two three four", expect: { status: "no_match" } },
  { input: "chapter three page sixteen", expect: { status: "no_match" } },

  // real garbled transcripts captured from the Deepgram spike (2026-07-02)
  { input: "20 8. I want 28. Somehow 128.", expect: { status: "no_match" } }, // baseline nova-2, no book anchor survived at all
  { input: "alright education twenty one susan twenty eight i want twenty eight sam one hundred and twenty eight", expect: { status: "suggest", bookId: "PSA", chapter: 128 } }, // nova-3 + keyterm boosting
];
