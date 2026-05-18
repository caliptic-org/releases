#!/usr/bin/env node
/**
 * customer-config-inject.mjs
 * --------------------------
 * Inject customer-specific config (endpoint, branding, license metadata)
 * into an already-extracted Electron app bundle. Used by both the GHA
 * `customer-desktop-repack` workflow and the local dev script.
 *
 * Inputs:
 *   --bundle <path>    Path to the extracted Electron app bundle:
 *                       - macOS:   /path/to/Caliptic.app
 *                       - Windows: /path/to/win-unpacked
 *                       - Linux:   /path/to/linux-unpacked
 *   --config <path>    Path to customer-config.json
 *   --platform <os>    'mac' | 'win' | 'linux'
 *   --icon   <path>    (optional) Replacement icon
 *                       - mac:   .icns file → Resources/icon.icns
 *                       - win:   .ico  file → resources/icon.ico
 *   --app-name <name>  (optional) Override CFBundleName (macOS) /
 *                                 product name in resources.
 *
 * Behavior:
 *   1. Read app.asar from the bundle.
 *   2. Extract to a temp dir.
 *   3. Drop customer-config.json into the extracted resources path
 *      where the main process looks for it (Electron's
 *      `app.getAppPath()` → repacked asar root).
 *   4. Repack the asar.
 *   5. Replace icon if provided.
 *   6. Update Info.plist (macOS) with customer name.
 *
 * After this script runs, the bundle still needs to be RE-SIGNED
 * (codesign / signtool) by the caller — modifying anything inside the
 * bundle invalidates the original signature. That's a feature, not a
 * bug: it means tampered bundles fail Gatekeeper / SmartScreen
 * automatically.
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname, basename, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

// ── CLI parsing (no deps — keep this script standalone) ─────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

function die(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

function log(msg) {
  console.log(`  ${msg}`);
}

const opts = parseArgs();
const bundlePath = opts.bundle && resolve(opts.bundle);
const configPath = opts.config && resolve(opts.config);
const platform   = opts.platform;
const iconPath   = opts.icon && resolve(opts.icon);
const appNameOverride = opts["app-name"];

if (!bundlePath) die("--bundle <path> is required");
if (!configPath) die("--config <path> is required");
if (!platform)   die("--platform <mac|win|linux> is required");
if (!["mac", "win", "linux"].includes(platform)) die(`unknown platform: ${platform}`);
if (!existsSync(bundlePath)) die(`bundle not found: ${bundlePath}`);
if (!existsSync(configPath)) die(`config not found: ${configPath}`);

// ── Validate customer config shape ──────────────────────────────────
let customerConfig;
try {
  customerConfig = JSON.parse(readFileSync(configPath, "utf8"));
} catch (err) {
  die(`config is not valid JSON: ${err.message}`);
}
if (!customerConfig.endpoints?.api) {
  die("config.endpoints.api is required");
}
const appName =
  appNameOverride ?? customerConfig.branding?.name ?? "Caliptic";

console.log(`▸ customer-config-inject`);
console.log(`  bundle:     ${bundlePath}`);
console.log(`  platform:   ${platform}`);
console.log(`  app name:   ${appName}`);
console.log(`  endpoint:   ${customerConfig.endpoints.api}`);
console.log(`  license:    ${customerConfig.license_id ?? "(none)"}`);

// ── Locate app.asar inside the bundle ───────────────────────────────
const ASAR_PATHS = {
  mac:   "Contents/Resources/app.asar",
  win:   "resources/app.asar",
  linux: "resources/app.asar",
};
const RESOURCES_DIR = {
  mac:   "Contents/Resources",
  win:   "resources",
  linux: "resources",
};

const asarRelativePath = ASAR_PATHS[platform];
const resourcesDir = join(bundlePath, RESOURCES_DIR[platform]);
const asarAbs = join(bundlePath, asarRelativePath);
if (!existsSync(asarAbs)) {
  die(`app.asar not found at expected path: ${asarAbs}`);
}

// ── Resolve @electron/asar at runtime ───────────────────────────────
// We don't want this script to require an npm install — but @electron/asar
// must be available somewhere. Try common locations: caller's node_modules,
// global, or via npx fallback.
let asar;
try {
  asar = await import("@electron/asar");
} catch {
  die(
    "@electron/asar not installed — run `pnpm install` in the repo root " +
    "or invoke this script via `npx @electron/asar`.",
  );
}

// ── Extract → inject → repack ───────────────────────────────────────
const tmpRoot = mkdtempSync(join(tmpdir(), "caliptic-repack-"));
const extractedDir = join(tmpRoot, "asar-extracted");

try {
  log(`extracting app.asar → ${extractedDir}`);
  asar.extractAll(asarAbs, extractedDir);

  // The renderer reads customer-config.json from the resources dir at
  // runtime (see apps/desktop/src/main/index.ts `loadCustomerConfig`).
  // Two candidate paths the main process tries:
  //   1. process.resourcesPath/customer-config.json   ← outside asar
  //   2. app.getAppPath()/resources/customer-config.json  ← inside asar
  //
  // We write to BOTH: inside the asar so it ships with the bundle, and
  // outside (next to the asar) for runtimes where resourcesPath doesn't
  // resolve to the asar mount.
  log("injecting customer-config.json (inside asar)");
  const injectedInside = join(extractedDir, "resources", "customer-config.json");
  // Make sure the dir exists inside the asar tree.
  spawnSync("mkdir", ["-p", dirname(injectedInside)], { shell: process.platform === "win32" });
  writeFileSync(injectedInside, JSON.stringify(customerConfig, null, 2), "utf8");

  log(`repacking → ${asarAbs}`);
  await asar.createPackage(extractedDir, asarAbs);

  log("dropping customer-config.json next to the asar (outside)");
  const injectedOutside = join(resourcesDir, "customer-config.json");
  writeFileSync(injectedOutside, JSON.stringify(customerConfig, null, 2), "utf8");

  // ── Icon swap ─────────────────────────────────────────────────────
  if (iconPath) {
    if (!existsSync(iconPath)) die(`icon not found: ${iconPath}`);
    const ICON_TARGETS = {
      mac:   "Contents/Resources/icon.icns",
      win:   "resources/icon.ico",
      linux: "resources/icon.png",
    };
    const target = join(bundlePath, ICON_TARGETS[platform]);
    log(`replacing icon → ${target}`);
    copyFileSync(iconPath, target);
  }

  // ── Info.plist tweaks (macOS only) ────────────────────────────────
  if (platform === "mac") {
    const plistPath = join(bundlePath, "Contents/Info.plist");
    if (!existsSync(plistPath)) {
      die(`Info.plist not found: ${plistPath}`);
    }
    if (process.platform !== "darwin") {
      log("⚠ Info.plist edit skipped (not running on macOS — plutil unavailable)");
      log("  GHA macOS runner will apply these on the canonical build.");
    } else {
      log(`updating Info.plist (CFBundleName, CFBundleDisplayName)`);
      for (const key of ["CFBundleName", "CFBundleDisplayName"]) {
        spawnSync("plutil", ["-replace", key, "-string", appName, plistPath], {
          stdio: "inherit",
        });
      }
    }
  }

  console.log(`✓ injected customer config into ${platform} bundle`);
  console.log(`  Caller must now RE-SIGN the bundle:`);
  if (platform === "mac") {
    console.log(`    codesign --force --deep --options runtime \\`);
    console.log(`      --sign "Developer ID Application: ..." \\`);
    console.log(`      "${bundlePath}"`);
    console.log(`    xcrun notarytool submit "${bundlePath}" --wait ...`);
  } else if (platform === "win") {
    console.log(`    signtool sign /sha1 <thumbprint> /td sha256 /fd sha256 \\`);
    console.log(`      /tr http://timestamp.digicert.com \\`);
    console.log(`      "${bundlePath}/<your-installer>.exe"`);
  }
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}
