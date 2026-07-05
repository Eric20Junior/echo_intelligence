// CI/packaging prerequisite: scripts/package.js refuses to run without a .gguf
// already present in models/ (see its header comment — the model isn't fetched
// during packaging on purpose, so a dev machine's cached copy isn't silently
// re-downloaded). CI runners start with an empty models/ dir every time, so this
// script exists purely to fetch it first. Mirrors lib/detection/fallback/local-llm.js's
// MODEL_URI/MODELS_DIR exactly — kept as a separate small script rather than importing
// local-llm.js itself, since that module also loads/compiles the model into a full
// llama context (slow, and pointless for a download-only step).
import { resolveModelFile } from "node-llama-cpp";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MODEL_URI = "hf:Qwen/Qwen2.5-0.5B-Instruct-GGUF:Q4_K_M";
const MODELS_DIR = path.join(ROOT, "models");

await resolveModelFile(MODEL_URI, MODELS_DIR);
console.log("model ready in", MODELS_DIR);
