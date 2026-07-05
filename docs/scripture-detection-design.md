# Scripture Detection — Deep Design

Project: **Echo Intelligence**
Module: Scripture Detection (part of the Context Engine → Scripture Module pipeline)
Status: Design, pre-implementation

---

## 1. Why this is the hard part

The Electron shell, the DB, the projector window — all well-understood engineering. The thing that decides whether the product feels *magical* or *broken* is: **can we reliably turn a spoken sentence into a correct, validated Bible reference, fast enough that the verse appears before the operator could've typed it themselves?**

Two failure modes, and they are not symmetric in cost:
- **Miss** (pastor says a reference, nothing appears) — annoying, operator falls back to manual. Recoverable.
- **False positive** (wrong verse appears, or triggers on non-reference speech) — embarrassing, visible to the whole congregation/stream, erodes trust in the product immediately.

Design bias: **optimize for precision over recall in autonomous mode**, and give the operator a fast manual-confirm path for anything below a confidence threshold, rather than trying to catch every utterance automatically.

---

## 2. What pastors actually say (the input distribution)

Real spoken references are messier than "John 3:16". Patterns to expect:

- **Full canonical**: "John chapter three, verse sixteen"
- **Compressed**: "John three sixteen"
- **Range**: "Romans eight, verses twenty-eight through thirty" / "Romans 8:28-30"
- **Chapter only**: "turn with me to Psalm 23" (no verse — should still resolve, show whole chapter or verse 1)
- **List/multiple**: "look at verses 16 and 17" (verse continuation from prior chapter context — requires conversational state, not just single-utterance parsing)
- **Numbered books**: "First Corinthians thirteen four", "Second Timothy", "Third John" — ordinal spoken as word, easily mis-transcribed as "1 Corinthians" vs "First Corinthians" vs "For Corinthians" (STT homophone error)
- **Abbreviated/informal**: "Rom 8:28" won't occur in speech, but STT might *output* abbreviations if trained on text-heavy corpora — unlikely but check.
- **Non-reference numbers that look like references**: "in the year 2016", "he was 3 years old", "call me at... " — STT will never say "verse" but pattern matchers naive about context can false-positive on "chapter three page sixteen" type phrasing. Need the anchor words (book name) to be load-bearing, not the numbers.
- **Anaphoric/implicit**: "the next verse says...", "go back to verse 10" — requires session state (last resolved reference), not stateless parsing. **Explicitly out of scope for V1** — flag it, don't build it, it's a context-tracking problem for a later iteration.

---

## 3. STT error modes specific to this domain

Generic STT (Deepgram/OpenAI) is not tuned for Bible book names. Expected error classes:

1. **Homophone/near-homophone substitution**: "Ephesians" → "Ephesian's", "Philippians" → "Philippine's", "Hosea" → "Ho, se, uh", "Habakkuk" → almost never transcribed correctly cold.
2. **Ordinal number confusion**: "First John" → "1 John" (fine) vs "for John" / "4 John" (broken — no such book).
3. **Number-word transcription inconsistency**: some STT engines will emit "3:16", others "three sixteen", others "three, sixteen" — the parser must normalize both digit and word forms, and both punctuated and unpunctuated forms.
4. **Missing punctuation entirely** in streaming partial transcripts — can't rely on the STT to insert the colon between chapter and verse.

**Mitigation**: maintain a **custom vocabulary / keyword boost list** of all 66 (or 73, if supporting deuterocanon) book names + common mispronunciations, and pass it to the STT provider's custom-vocabulary/keyword-boosting feature if available (Deepgram supports `keywords`/`keyterm` boosting; OpenAI's Whisper API supports a `prompt` biasing hint). This is a cheap, high-leverage fix — do this before investing in fancy NLP correction.

---

## 4. Parsing architecture: regex-first, LLM-fallback (hybrid, not either/or)

Reject "LLM does everything" — added latency (network round trip, ~300-800ms+) and cost on every single utterance, for a task that's 90% deterministic pattern matching. Also reject "pure regex, no fallback" — brittle on the genuinely ambiguous ~10-15% of cases.

### Pipeline stages

```
raw transcript chunk
   │
   ▼
[1] Text normalization
   - lowercase, strip filler words ("um", "uh", "let's turn to", "if you would")
   - number-word → digit normalization ("sixteen" → "16", "chapter three" → "3")
   - ordinal normalization ("first" → "1", "for"/"fourth"(when preceding a book name) → "4")
   │
   ▼
[2] Candidate extraction (regex/grammar, deterministic, ~1-5ms)
   - pattern: [ordinal?] [book-alias] [chapter#] [(:|verse)] [verse#[-verse#]]
   - book-alias table: canonical name + all known aliases/misspellings/STT error variants
   │
   ├─ match found, high structural confidence ──────────────┐
   │                                                          │
   └─ no match / ambiguous (e.g. book name STT garbled,       │
      numbers present but no recognizable book) ──┐           │
                                                    ▼           │
                                     [3] LLM fallback           │
                                     - only invoked on ambiguous│
                                       cases, not every utterance
                                     - structured output: does  │
                                       this text contain a      │
                                       scripture reference?     │
                                       if so, extract fields.   │
                                     - model: small/fast one    │
                                       (e.g. Claude Haiku 4.5,  │
                                       GPT-4o-mini) — this is   │
                                       classification, not      │
                                       generation, cheap model  │
                                       is sufficient             │
                                                    │           │
                                                    ▼           ▼
                                          [4] Validation layer
                                          - check against canonical
                                            book/chapter/verse-count
                                            table (e.g. reject "Jude 8:5",
                                            Jude has 1 chapter)
                                          - compute confidence score
                                            │
                                            ▼
                                   [5] Resolution (local DB lookup)
                                          │
                                          ▼
                                   emit `intent.detected` → `content.resolved`
```

### Why validation (stage 4) matters as much as extraction

A regex or LLM can produce a *structurally* valid-looking reference that doesn't *exist* — "Jude chapter 3" (Jude has only 1 chapter), "Psalm 151" (depends on translation/canon), "3 John 20" (3 John has 13 verses total, in 1 chapter). A canonical **book → max chapter → max verse-per-chapter** lookup table is cheap to build once (it's static data) and eliminates a whole class of embarrassing false positives. This table is also the natural place to encode **versification differences** across translations (see §6).

---

## 5. Confidence scoring & the operator-confirm UX

Every candidate reference gets a composite confidence score before it's allowed to auto-display:

| Signal | Weight |
|---|---|
| Regex matched full canonical pattern (book+chapter+verse) | high |
| Book name matched exactly (not via fuzzy/alias correction) | high |
| Passed canonical range validation | required (hard gate, not just a score input) |
| STT word-level confidence for the matched span | medium |
| Came from LLM fallback rather than regex | lower baseline (LLM path implies the deterministic pass already failed) |

Two-tier UX:
- **Above threshold** → auto-display immediately (the magic moment).
- **Below threshold** → show as a *suggestion chip* in the operator UI ("Did the pastor mean John 3:16?") for one click to confirm — never silently discarded, but never auto-projected either.

This turns "ambiguous" from a failure mode into a graceful degradation, and it's honestly a better product than 100%-autonomous display even if accuracy were perfect, because it keeps the human media operator in the loop as a safety net — which matters a lot the first time this runs live in front of a congregation.

---

## 6. Data model implications

- **Book/alias table**: `canonical_book_id, canonical_name, aliases[], max_chapter, verses_per_chapter[]` — static seed data, versioned so we can correct alias lists as we collect real-world STT error data.
- **Translation-aware versification**: chapter/verse boundaries differ slightly across translations (notably Psalms numbering, and some Deuterocanonical differences if ever supported). For V1, pick **one bundled translation** (confirm license — public domain options: KJV, ASV, WEB; ESV/NIV require licensing) and hardcode against its versification; design the table so a `translation_id` column can be added later without a schema rewrite.
- **Session/log table**: every detected candidate (matched or not, displayed or not, confidence score, raw transcript snippet) should be logged. This is your ground-truth dataset for tuning the alias table and confidence thresholds after the first few real church services — treat week 1 field data as the actual test suite, since no offline corpus will fully capture a specific pastor's speech patterns and accent.

---

## 7. What NOT to build in V1

- Anaphoric reference resolution ("that verse", "the next one") — needs conversational state tracking, meaningfully harder, defer.
- Multi-passage lists in one utterance ("look at John 3:16, Romans 8:28, and Psalm 23") — handle single-reference-per-utterance first; extend the regex grammar later once the core loop is proven.
- Cross-translation reconciliation — pick one bundled translation, ship, learn.
- LLM-first "understand any phrasing" approach — too slow and too expensive for the common case; the hybrid above gets 90% of the benefit at 10% of the latency/cost.

---

## 8. Immediate next steps

1. Build the canonical book/alias/versification table (static data, no dependencies — can start today).
2. Source a public-domain Bible text dataset (WEB or KJV) in a structured format (book/chapter/verse/text) for local SQLite storage.
3. Write the regex/grammar extraction stage against a hand-built corpus of ~50-100 realistic spoken sentence variants (including deliberately garbled STT-style inputs) before touching real audio.
4. Only after (3) has a measured precision/recall on the synthetic corpus, wire up live Deepgram/OpenAI streaming and test against real speech.
