import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to the project dir so Next never mis-infers it from
  // a stray package-lock.json in a parent directory (e.g. Documents\). The app
  // is always started from this folder (npm scripts / server.cmd cd here).
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
