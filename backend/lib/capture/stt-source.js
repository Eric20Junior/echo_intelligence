// Live STT stage (roadmap Phase 3), extracted from scripts/live-demo.js.
//
// @deepgram/sdk's `listen.v1.connect()` wrapper hangs silently in this environment
// (no open/error/close event ever fires — confirmed against a valid key that works
// fine over plain REST). Talking to the same wss:// endpoint directly with `ws`
// connects immediately, so we bypass the SDK's socket layer entirely here.
const WebSocket = require("ws");
const { BOOK_KEYTERMS } = require("./keyterms");
const { SAMPLE_RATE } = require("./mic-source");

function buildDeepgramUrl() {
  const params = new URLSearchParams({
    model: "nova-3",
    encoding: "linear16",
    sample_rate: String(SAMPLE_RATE),
    channels: "1",
    interim_results: "true",
    smart_format: "true",
    punctuate: "true",
  });
  for (const term of BOOK_KEYTERMS) params.append("keyterm", term);
  return `wss://api.deepgram.com/v1/listen?${params.toString()}`;
}

// Resolves only once the socket is actually open — callers must not start
// pushing mic audio before this resolves, or leading audio gets dropped.
function connect({ onTranscript, onError, onClose }) {
  const socket = new WebSocket(buildDeepgramUrl(), {
    headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}` },
  });

  socket.on("error", (err) => onError?.(err));
  socket.on("unexpected-response", (_req, res) => {
    onError?.(new Error(`deepgram rejected the connection: HTTP ${res.statusCode}`));
  });
  socket.on("close", () => onClose?.());

  socket.on("message", (raw) => {
    const data = JSON.parse(raw.toString());
    if (data.type !== "Results" || !data.is_final) return;
    const transcript = data.channel.alternatives[0]?.transcript?.trim();
    if (!transcript) return;
    onTranscript(transcript);
  });

  return new Promise((resolve, reject) => {
    socket.once("open", () => {
      resolve({
        sendAudio: (chunk) => {
          if (socket.readyState === WebSocket.OPEN) socket.send(chunk);
        },
        stop: () => socket.close(),
      });
    });
    socket.once("error", reject);
  });
}

module.exports = { connect };
