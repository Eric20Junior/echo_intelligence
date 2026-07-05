// Reading mode sequences (roadmap Phase 4.5): each `seed` is a full reference run
// through the existing regex pipeline (must auto_display and lock state), followed
// by bare navigation `steps` resolved relative to that lock.
module.exports = [
  {
    // the exact real-world case from the 2026-07-02 field test: Deepgram's
    // endpointing split "Proverbs 22 verse five" into two separate utterances.
    name: "split utterance: chapter then verse, no book restated",
    seed: "Proverbs chapter twenty two verse five",
    steps: [
      { input: "chapter 22", expect: { status: "suggest", bookId: "PRO", chapter: 22, verseStart: null } },
      { input: "verse five", expect: { status: "suggest", bookId: "PRO", chapter: 22, verseStart: 5 } },
    ],
  },
  {
    name: "next chapter / next verse / previous verse",
    seed: "John chapter three verse sixteen",
    steps: [
      { input: "next chapter", expect: { status: "suggest", bookId: "JHN", chapter: 4, verseStart: null } },
    ],
  },
  {
    name: "next verse continues from a locked verse",
    seed: "Romans chapter eight verse twenty eight",
    steps: [
      { input: "next verse", expect: { status: "suggest", bookId: "ROM", chapter: 8, verseStart: 29 } },
      { input: "previous verse", expect: { status: "suggest", bookId: "ROM", chapter: 8, verseStart: 28 } },
    ],
  },
  {
    name: "verse range",
    seed: "Romans chapter eight verse twenty eight",
    steps: [
      { input: "verses 28 through 30", expect: { status: "suggest", bookId: "ROM", chapter: 8, verseStart: 28, verseEnd: 30 } },
    ],
  },
  {
    name: "chapter overflow is caught by the existing bound check, not silently wrong",
    seed: "3 John chapter one verse one", // 3 John has exactly 1 chapter
    steps: [
      { input: "next chapter", expect: { status: "invalid" } },
    ],
  },
  {
    name: "next verse with no verse anchor (chapter-only lock) falls through, not a false match",
    seed: "Psalm 23",
    steps: [
      { input: "next verse", expect: { status: "no_match" } },
    ],
  },
  {
    // real 2026-07-02 field case: Deepgram fragmented "next verse" down to a bare
    // "Next," / "Next." across several is_final utterances, never the full phrase.
    name: "bare next/previous fall back to the most granular locked unit",
    seed: "John chapter three verse sixteen",
    steps: [
      { input: "next", expect: { status: "suggest", bookId: "JHN", chapter: 3, verseStart: 17 } },
      { input: "previous", expect: { status: "suggest", bookId: "JHN", chapter: 3, verseStart: 16 } },
    ],
  },
  {
    name: "bare next falls back to chapter advance when no verse is locked",
    seed: "Psalm 23",
    steps: [
      { input: "next", expect: { status: "suggest", bookId: "PSA", chapter: 24, verseStart: null } },
    ],
  },
  {
    // real 2026-07-02 field case: "chapter three, verse 16." (restating both without
    // the book name) previously fell through to no_match entirely.
    name: "combined chapter+verse without book name",
    seed: "Proverbs chapter twenty two verse five",
    steps: [
      { input: "chapter 22 verse 6", expect: { status: "suggest", bookId: "PRO", chapter: 22, verseStart: 6 } },
    ],
  },
];
