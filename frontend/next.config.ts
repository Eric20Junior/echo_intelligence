import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Silences a workspace-root inference warning: this frontend lives nested
  // inside the main echo-intelligence repo, which has its own package-lock.json.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
