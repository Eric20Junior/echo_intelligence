// Aliases per canonical book id (from @biblebites/bible-reference), split by confidence tier:
//   primary  - legitimate spoken alternate names a pastor would actually say; treated the
//              same as the canonical name for confidence scoring (e.g. "Psalm" singular).
//   variant  - genuine STT homophone/misrecognition errors (design doc §3); matching one of
//              these means the extractor caught an error, which is real signal but lower
//              confidence than a clean canonical/primary match.
// Keys not listed here fall back to just the canonical name, lowercased.
module.exports = {
  // numbered books: ordinal/digit-word spoken forms are all normal, not STT errors
  "1SA": { primary: ["first samuel", "1st samuel", "one samuel"] },
  "2SA": { primary: ["second samuel", "2nd samuel", "two samuel"] },
  "1KI": { primary: ["first kings", "1st kings", "one kings"] },
  "2KI": { primary: ["second kings", "2nd kings", "two kings"] },
  "1CH": { primary: ["first chronicles", "1st chronicles", "one chronicles"] },
  "2CH": { primary: ["second chronicles", "2nd chronicles", "two chronicles"] },
  "1CO": { primary: ["first corinthians", "1st corinthians", "one corinthians"] },
  "2CO": { primary: ["second corinthians", "2nd corinthians", "two corinthians"] },
  "1TH": { primary: ["first thessalonians", "1st thessalonians", "one thessalonians"] },
  "2TH": { primary: ["second thessalonians", "2nd thessalonians", "two thessalonians"] },
  "1TI": { primary: ["first timothy", "1st timothy", "one timothy"] },
  "2TI": { primary: ["second timothy", "2nd timothy", "two timothy"] },
  "1PE": { primary: ["first peter", "1st peter", "one peter"] },
  "2PE": { primary: ["second peter", "2nd peter", "two peter"] },
  "1JN": { primary: ["first john", "1st john", "one john"] },
  "2JN": { primary: ["second john", "2nd john", "two john"] },
  "3JN": { primary: ["third john", "3rd john", "three john"] },

  // common singular/alternate spoken forms — normal usage, not errors
  PSA: { primary: ["psalm"], variant: ["sam", "salm", "sams"] },
  SNG: { primary: ["song of solomon", "song of songs", "songs of solomon"] },

  // homophone / near-homophone STT substitutions (design doc §3.1)
  EPH: { variant: ["ephesian's", "ephesian", "efficient's"] },
  PHP: { variant: ["philippine's", "philippine"] },
  HOS: { variant: ["ho se uh"] },
  REV: { variant: ["revelations"] }, // common informal mis-pluralization
};
