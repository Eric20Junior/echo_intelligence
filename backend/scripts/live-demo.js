const { resolvePath } = require("../lib/paths");
require("dotenv").config({ path: resolvePath(".env"), quiet: true });
const config = require("../lib/config");

const PORT = 8787;

config.loadConfig();

if (!config.hasRequiredKeys()) {
  // Deliberately does not require lib/server/api-server.js/session.js here — see
  // lib/server/setup-server.js's header comment for why.
  require("../lib/server/setup-server").start(PORT);
} else {
  main();
}

function main() {
  const apiServer = require("../lib/server/api-server");
  const presentation = require("../lib/server/presentation");
  const session = require("../lib/server/session");
  const { calibrateConfidenceThreshold } = require("../lib/detection/calibrate");
  const { mineAliasSuggestions } = require("../lib/detection/alias-miner");
  const { minePhraseSuggestions } = require("../lib/detection/phrase-miner");
  const { mineReadingNavSuggestions } = require("../lib/detection/reading-nav-miner");
  const {
    expireStaleAliasSuggestions,
    expireStalePhraseSuggestions,
    expireStaleReadingNavSuggestions,
  } = require("../lib/log");

  // Cheap (single SQL query over a single-install's data) — safe to run on every
  // startup. Only ever lowers the threshold, and only with enough evidence; see
  // lib/detection/calibrate.js's header for why it can't raise it back up.
  const newThreshold = calibrateConfidenceThreshold();
  if (newThreshold != null) {
    console.log(`confidence threshold calibrated down to ${newThreshold} based on recent operator confirmations`);
  }

  // Also cheap, same reasoning. Never applies anything automatically — only ever
  // creates reviewable rows for the operator to approve/reject from the operator UI.
  const suggestionsCreated = mineAliasSuggestions();
  if (suggestionsCreated > 0) {
    console.log(`${suggestionsCreated} new alias suggestion(s) ready for review in the operator UI`);
  }
  const expiredCount = expireStaleAliasSuggestions();
  if (expiredCount > 0) {
    console.log(`${expiredCount} approved alias(es) haven't matched anything in 90 days — flagged for re-confirmation`);
  }

  const phraseSuggestionsCreated = minePhraseSuggestions();
  if (phraseSuggestionsCreated > 0) {
    console.log(`${phraseSuggestionsCreated} new content-lookup phrase suggestion(s) ready for review in the operator UI`);
  }
  const expiredPhraseCount = expireStalePhraseSuggestions();
  if (expiredPhraseCount > 0) {
    console.log(`${expiredPhraseCount} approved phrase(s) haven't matched anything in 90 days — flagged for re-confirmation`);
  }

  const readingNavSuggestionsCreated = mineReadingNavSuggestions();
  if (readingNavSuggestionsCreated > 0) {
    console.log(`${readingNavSuggestionsCreated} new reading-navigation suggestion(s) ready for review in the operator UI`);
  }
  const expiredReadingNavCount = expireStaleReadingNavSuggestions();
  if (expiredReadingNavCount > 0) {
    console.log(`${expiredReadingNavCount} approved reading-navigation phrase(s) haven't matched anything in 90 days — flagged for re-confirmation`);
  }

  const { broadcast } = apiServer.start(PORT);
  presentation.init(broadcast);

  console.log("open the operator page and click \"Start Listening\" to begin (Ctrl+C to stop)");

  process.on("SIGINT", () => {
    console.log("\nshutting down...");
    session.stop();
    process.exit(0);
  });
}
