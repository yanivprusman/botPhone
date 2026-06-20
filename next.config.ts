import type { NextConfig } from "next";
import path from "node:path";
import fs from "node:fs";

// feedback-lib + launcher live as workspace packages at /opt/automateLinux/.
// Turbopack's `root` must contain the project AND the workspace symlink
// targets, so we pick /opt/ as the common ancestor. Fail loud if the
// workspace is missing — no silent fallback.
const turbopackRoot = path.resolve(process.cwd(), "../../");
const workspaceRoot = path.resolve(turbopackRoot, "automateLinux");
if (!fs.existsSync(path.join(workspaceRoot, "packages/feedback-lib/package.json"))) {
  throw new Error(
    `feedback-lib workspace guard: expected workspace at ${workspaceRoot} ` +
      `(derived from Turbopack root ${turbopackRoot}). ` +
      `Update the relative path or check the checkout layout.`,
  );
}

const nextConfig: NextConfig = {
  allowedDevOrigins: process.env.ALLOWED_DEV_ORIGINS?.split(',') ?? [],
  turbopack: { root: turbopackRoot },
  transpilePackages: ['@claudecontrol/feedback-lib', '@addnewfeature/feedback-lib-launcher'],
};

export default nextConfig;
