import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Silences a workspace-root inference warning: this frontend lives nested
  // inside the main echo-intelligence repo, which has its own package-lock.json.
  turbopack: {
    root: path.join(__dirname),
  },
  // Packaged builds (backend/scripts/package.js) serve this as plain static
  // files from the same Express server as the API/WebSocket (one process, one
  // port — see lib/server/api-server.js) rather than running a separate Next
  // server. Safe here since neither page uses server actions, middleware, or
  // dynamic routes — both talk to the backend over REST/WS at runtime, same as
  // the dev server does. trailingSlash so /overlay maps to overlay/index.html,
  // matching how express.static resolves directory requests.
  output: "export",
  trailingSlash: true,
};

export default nextConfig;
