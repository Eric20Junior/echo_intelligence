// Text normalization (design doc §4, stage 1): lowercase, strip filler words,
// and collapse spoken number words into digits so the extractor can pattern-match
// numbers regardless of how the STT engine rendered them.

const FILLER_PATTERNS = [
  /\bum+\b/g,
  /\buh+\b/g,
  /\blet'?s turn to\b/g,
  /\bif you would\b/g,
  /\bturn with me to\b/g,
  /\bplease turn to\b/g,
  /\blook at\b/g,
];

const ONES = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
// Grammar for a single spoken number (design doc's compressed forms never stack two
// standalone numbers into one — "three sixteen" is chapter 3 + verse 16, not 316):
//   [ONES(1-9) "hundred" ["and"]] [TENS] [ONES(0-9)]     e.g. "one hundred and twenty eight"
//   | TENS [ONES(0-9)]                                    e.g. "twenty eight"
//   | ONES(0-19)                                          e.g. "three" / "sixteen"  (terminal, doesn't chain)
function parseNumberRun(tokens, i) {
  let current = 0;
  let j = i;

  if (tokens[j] in ONES && ONES[tokens[j]] >= 1 && ONES[tokens[j]] <= 9 && tokens[j + 1] === "hundred") {
    current = ONES[tokens[j]] * 100;
    j += 2;
    if (tokens[j] === "and") j++;
    if (tokens[j] in TENS) {
      current += TENS[tokens[j]];
      j++;
      if (tokens[j] in ONES && ONES[tokens[j]] < 10) {
        current += ONES[tokens[j]];
        j++;
      }
    } else if (tokens[j] in ONES) {
      current += ONES[tokens[j]];
      j++;
    }
    return { value: current, nextIndex: j };
  }

  if (tokens[j] in TENS) {
    current = TENS[tokens[j]];
    j++;
    if (tokens[j] in ONES && ONES[tokens[j]] < 10) {
      current += ONES[tokens[j]];
      j++;
    }
    return { value: current, nextIndex: j };
  }

  if (tokens[j] in ONES) {
    return { value: ONES[tokens[j]], nextIndex: j + 1 };
  }

  return null;
}

function wordsToDigits(text) {
  const tokens = text.split(/\s+/).filter(Boolean);
  const out = [];
  let i = 0;
  while (i < tokens.length) {
    const run = parseNumberRun(tokens, i);
    if (run) {
      out.push(String(run.value));
      i = run.nextIndex;
    } else {
      out.push(tokens[i]);
      i++;
    }
  }
  return out.join(" ");
}

function normalize(rawText) {
  let text = rawText.toLowerCase();
  for (const pattern of FILLER_PATTERNS) {
    text = text.replace(pattern, " ");
  }
  text = text.replace(/[.,;!?]/g, " ");
  text = text.replace(/-/g, " ");
  text = text.replace(/\s+/g, " ").trim();
  text = wordsToDigits(text);
  return text;
}

module.exports = { normalize, wordsToDigits };
