// Local n8n community-node verification scan.
//
// Runs the official @n8n/scan-community-package analysis against the CURRENT
// working tree (not a published npm version) so verification problems can be
// caught before publishing or submitting for verification.
//
// Why not the bundled CLI: its `scan-community-package <name>` entry point only
// downloads ALREADY-PUBLISHED packages from npm, and its tar-based extraction
// breaks on Windows (drive-letter colon mistaken for a remote host). Instead we
// ask npm which files WOULD be published (`npm pack --dry-run --json`), mirror
// exactly that file set into a temp dir, and invoke the scanner's analysis on
// it — faithful to the real tarball, cross-platform, no tar required.

import { execSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { analyzePackage } from "@n8n/scan-community-package/scanner/scanner.mjs";

const root = process.cwd();

// Faithful file selection: let npm decide what ships (honours "files", .npmignore…).
// Fixed command string, no interpolation — no injection surface. execSync goes through
// the shell, which also resolves npm's .cmd shim on Windows (execFile can't, post-Node 20).
const packJson = execSync("npm pack --dry-run --json", { cwd: root, encoding: "utf8" });
const files = JSON.parse(packJson)[0].files.map((f) => f.path);

const dir = mkdtempSync(join(tmpdir(), "n8n-scan-"));
try {
  for (const rel of files) {
    const dest = join(dir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(root, rel), dest);
  }

  const result = await analyzePackage(dir);

  if (result.passed) {
    console.log("✅ Community-node scan passed — no verification blockers found.");
    process.exit(0);
  }

  console.error(`❌ ${result.message ?? "Community-node scan failed."}`);
  if (result.details) console.error(`\n${result.details}`);
  process.exit(1);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
