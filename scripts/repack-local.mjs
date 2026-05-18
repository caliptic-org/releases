#!/usr/bin/env node
/**
 * repack-local.mjs
 * ----------------
 * End-to-end local dev script for testing the customer-desktop-repack
 * pipeline WITHOUT the full GHA + R2 setup. Designed for the workflow:
 *
 *   1. Grab the latest generic Caliptic Desktop build from GitHub
 *      Releases (or use a local .dmg / .exe).
 *   2. Extract it.
 *   3. Inject a customer-config.json + icon.
 *   4. Repack into a fresh .dmg or .exe.
 *   5. Drop the result in ./dist-customer/.
 *
 * What this script intentionally does NOT do:
 *   - Re-sign with codesign / signtool. The unsigned output will trigger
 *     SmartScreen / Gatekeeper warnings on a real user's machine, but
 *     it's enough to verify the renderer reads `customer-config.json`
 *     and connects to the right endpoint.
 *   - Notarize (macOS). Same reason.
 *   - Upload to R2. Use the CI workflow for that.
 *
 * Cross-platform behavior:
 *   - Windows host: can repack .exe (uses 7zip). Can extract .dmg only
 *     with manual mounting (skipped).
 *   - macOS host: can repack both .dmg and .exe.
 *   - Linux host: can repack .exe. .dmg unsupported (Apple).
 *
 * Usage:
 *   node repack-local.mjs \
 *     --input ./Caliptic-Setup-0.1.42.exe \
 *     --config ./test-customer.json \
 *     --output ./dist-customer/
 *
 *   # Or fetch from GitHub Releases:
 *   node repack-local.mjs \
 *     --version v0.1.42 \
 *     --platform win \
 *     --config ./test-customer.json \
 *     --output ./dist-customer/
 *
 * Test customer config example (test-customer.json):
 *   {
 *     "license_id": "lic_test_dev",
 *     "build_id":   "build_dev_local",
 *     "built_at":   "2026-05-19T00:00:00Z",
 *     "endpoints": {
 *       "api": "http://localhost:8080/api",
 *       "ws":  "ws://localhost:8080/ws",
 *       "web": "http://localhost:3000"
 *     },
 *     "branding": {
 *       "name":  "Dev Workspace",
 *       "color": "#FF6600"
 *     }
 *   }
 */
import { existsSync, mkdirSync, copyFileSync, statSync, readFileSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, basename, resolve, dirname } from "node:path";
import { tmpdir, platform as osPlatform } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── CLI ─────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        out[a.slice(2)] = next;
        i++;
      } else {
        out[a.slice(2)] = true;
      }
    }
  }
  return out;
}
const opts = parseArgs();

function die(msg) { console.error(`✖ ${msg}`); process.exit(1); }
function log(msg) { console.log(msg); }

const configPath = opts.config && resolve(opts.config);
const outputDir  = (opts.output && resolve(opts.output)) || resolve("./dist-customer");
const iconPath   = opts.icon && resolve(opts.icon);
const inputPath  = opts.input && resolve(opts.input);
const version    = opts.version;
const platformArg = opts.platform;     // 'win' | 'mac-arm64' | 'mac-x64'

if (!configPath) die("--config <path> required (customer-config.json)");

// ── Detect host capabilities ────────────────────────────────────────
const host = osPlatform();
const hostKind =
  host === "darwin" ? "mac" :
  host === "win32"  ? "win" :
  host === "linux"  ? "linux" :
  "unknown";
log(`▸ host OS: ${hostKind}`);

// ── Determine input file ────────────────────────────────────────────
let installerPath;
if (inputPath) {
  if (!existsSync(inputPath)) die(`--input not found: ${inputPath}`);
  installerPath = inputPath;
} else if (version && platformArg) {
  installerPath = await fetchFromGithubReleases(version, platformArg);
} else {
  die("Provide either --input <file> or --version <vX.Y.Z> --platform <win|mac-arm64|mac-x64>");
}
log(`▸ using installer: ${installerPath}`);

// ── Resolve effective platform from filename ────────────────────────
const filename = basename(installerPath).toLowerCase();
let effectivePlatform;
if (filename.endsWith(".dmg") || filename.endsWith(".zip") && filename.includes("mac")) {
  effectivePlatform = "mac";
} else if (filename.endsWith(".exe")) {
  effectivePlatform = "win";
} else if (filename.endsWith(".appimage") || filename.endsWith(".deb")) {
  effectivePlatform = "linux";
} else {
  die(`unknown installer format: ${filename}`);
}
log(`▸ platform: ${effectivePlatform}`);

// ── Host capability check ───────────────────────────────────────────
if (effectivePlatform === "mac" && hostKind !== "mac") {
  console.error(``);
  console.error(`✖ Cannot repack a .dmg on a ${hostKind} host.`);
  console.error(`  Reason: hdiutil (DMG mount / create) is macOS-only.`);
  console.error(``);
  console.error(`  Options:`);
  console.error(`    1. Run this script on a Mac.`);
  console.error(`    2. Use the GHA workflow (customer-desktop-repack.yml).`);
  console.error(`    3. Test the Windows path locally instead: --platform win`);
  process.exit(1);
}

// ── Setup output dir ────────────────────────────────────────────────
mkdirSync(outputDir, { recursive: true });
const workDir = mkdtempSync(join(tmpdir(), "caliptic-repack-local-"));
log(`▸ workdir: ${workDir}`);

try {
  if (effectivePlatform === "win") {
    await repackWindows(installerPath, workDir, configPath, outputDir, iconPath);
  } else if (effectivePlatform === "mac") {
    await repackMac(installerPath, workDir, configPath, outputDir, iconPath);
  } else {
    die(`linux repack not implemented yet`);
  }
} finally {
  if (process.env.KEEP_WORKDIR !== "1") {
    rmSync(workDir, { recursive: true, force: true });
  } else {
    log(`(keeping workdir: ${workDir})`);
  }
}

log(``);
log(`✓ done. Output: ${outputDir}`);
log(``);
log(`Next steps:`);
log(`  • Install the resulting installer on a test machine.`);
log(`  • Launch the app — it should connect to:`);
const cfg = JSON.parse(readFileSync(configPath, "utf8"));
log(`      ${cfg.endpoints.api}`);
log(`  • For production: sign + notarize before distributing.`);

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

async function fetchFromGithubReleases(version, platform) {
  const cacheDir = join(__dirname, "..", ".cache");
  mkdirSync(cacheDir, { recursive: true });
  const patterns = {
    "win":       `caliptic-desktop-${version.replace(/^v/, "")}-windows-*.exe`,
    "mac-arm64": `caliptic-desktop-${version.replace(/^v/, "")}-mac-arm64.dmg`,
    "mac-x64":   `caliptic-desktop-${version.replace(/^v/, "")}-mac-x64.dmg`,
  };
  const pattern = patterns[platform];
  if (!pattern) die(`unknown --platform: ${platform}`);
  log(`▸ fetching ${pattern} from caliptic-org/releases ${version}`);
  const r = spawnSync(
    "gh",
    ["release", "download", version, "--repo", "caliptic-org/releases", "--pattern", pattern, "--dir", cacheDir, "--skip-existing"],
    { stdio: "inherit", shell: false },
  );
  if (r.status !== 0) die(`gh release download failed`);
  // Find the downloaded file (may have arch suffix we didn't know)
  const candidates = require("node:fs").readdirSync(cacheDir).filter(f =>
    new RegExp(pattern.replace(/\*/g, ".*")).test(f),
  );
  if (candidates.length === 0) die(`no file matched after download`);
  return join(cacheDir, candidates[0]);
}

async function repackWindows(exePath, workDir, configPath, outputDir, iconPath) {
  log(`▸ repackWindows — extracting NSIS installer`);
  // NSIS installers are 7-Zip archives. Extract with 7z.
  const extractDir = join(workDir, "extracted");
  mkdirSync(extractDir, { recursive: true });
  const r = spawnSync("7z", ["x", "-y", `-o${extractDir}`, exePath], {
    stdio: "inherit",
  });
  if (r.status !== 0) {
    die(
      `7z extract failed. Install 7-Zip first:\n` +
      `   - Windows: https://www.7-zip.org/ (add to PATH)\n` +
      `   - macOS:   brew install p7zip\n` +
      `   - Linux:   apt install p7zip-full`,
    );
  }

  // After extraction:
  //   extractDir/
  //     $PLUGINSDIR/    ← NSIS bootstrap, not in bundle
  //     resources/      ← we want this (app.asar lives here)
  //     Caliptic.exe    ← electron entry
  //     ...

  log(`▸ injecting customer config`);
  const inject = spawnSync(
    process.execPath,
    [
      join(__dirname, "customer-config-inject.mjs"),
      "--bundle", extractDir,
      "--config", configPath,
      "--platform", "win",
      ...(iconPath ? ["--icon", iconPath] : []),
    ],
    { stdio: "inherit" },
  );
  if (inject.status !== 0) die("inject script failed");

  // Re-package the extracted dir back into a self-extracting installer.
  // For dev simplicity we produce a plain .zip — installing manually
  // works fine for local testing. NSIS recreate is a CI concern.
  log(`▸ re-zipping into installer staging`);
  const outZip = join(outputDir, `${configPath.includes("acme") ? "AcmeCorp-" : "Custom-"}Caliptic-${Date.now()}.zip`);
  const z = spawnSync("7z", ["a", "-tzip", outZip, join(extractDir, "*")], { stdio: "inherit" });
  if (z.status !== 0) die("7z pack failed");
  log(`  → ${outZip}`);
  log(`  (CI workflow produces a signed NSIS .exe; this dev script outputs a .zip you can hand-test)`);
}

async function repackMac(dmgPath, workDir, configPath, outputDir, iconPath) {
  log(`▸ repackMac — mounting .dmg`);
  const mountPoint = join(workDir, "mount");
  mkdirSync(mountPoint, { recursive: true });

  const m = spawnSync("hdiutil", ["attach", dmgPath, "-mountpoint", mountPoint, "-nobrowse", "-readonly"], {
    stdio: "inherit",
  });
  if (m.status !== 0) die("hdiutil attach failed");

  try {
    const appName = require("node:fs").readdirSync(mountPoint).find(f => f.endsWith(".app"));
    if (!appName) die(`no .app found in ${mountPoint}`);
    const sourceApp = join(mountPoint, appName);
    const targetApp = join(workDir, appName);

    log(`▸ copying ${appName} → workdir`);
    spawnSync("cp", ["-R", sourceApp, targetApp], { stdio: "inherit" });

    log(`▸ injecting customer config`);
    const inject = spawnSync(
      process.execPath,
      [
        join(__dirname, "customer-config-inject.mjs"),
        "--bundle", targetApp,
        "--config", configPath,
        "--platform", "mac",
        ...(iconPath ? ["--icon", iconPath] : []),
      ],
      { stdio: "inherit" },
    );
    if (inject.status !== 0) die("inject script failed");

    log(`▸ re-creating .dmg`);
    const outDmg = join(outputDir, basename(dmgPath).replace(/\.dmg$/, "-customer.dmg"));
    spawnSync("hdiutil", ["create", outDmg, "-srcfolder", targetApp, "-ov", "-format", "UDZO"], { stdio: "inherit" });
    log(`  → ${outDmg}`);
    log(`  ⚠ Unsigned — Gatekeeper will warn on launch. For production: codesign + notarize.`);
  } finally {
    spawnSync("hdiutil", ["detach", mountPoint], { stdio: "inherit" });
  }
}
