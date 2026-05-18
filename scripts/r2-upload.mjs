#!/usr/bin/env node
/**
 * r2-upload.mjs
 * -------------
 * Upload customer-build artifacts to Cloudflare R2 staging bucket and
 * notify the Caliptic API that the artifact is ready to download.
 *
 * Inputs:
 *   --build-id <id>            Build ID from portal (DB row identifier)
 *   --platform <key>           'win' | 'mac-arm64' | 'mac-x64' | 'linux'
 *   --file <path>              Local file to upload
 *   --callback-url <url>       Caliptic API endpoint to POST when done
 *   --callback-token <token>   Short-lived auth token for the callback
 *
 * Env (R2 credentials — set in GHA secrets):
 *   R2_ACCOUNT_ID         Cloudflare account ID
 *   R2_ACCESS_KEY_ID      R2 API token access key
 *   R2_SECRET_ACCESS_KEY  R2 API token secret
 *   R2_BUCKET             Bucket name (e.g. caliptic-customer-builds-staging)
 *
 * Retention:
 *   The R2 bucket is configured with a lifecycle rule that auto-deletes
 *   objects after 24 hours. We don't manage retention from this script.
 *
 * Once the artifact is uploaded, the Caliptic API generates a signed
 * download URL for the customer; this script doesn't send the URL —
 * just the R2 key + sha256 + size. The API issues the signed URL on
 * download request from the portal.
 */
import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      out[a.slice(2)] = args[++i];
    }
  }
  return out;
}

function die(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

const opts = parseArgs();
const buildId       = opts["build-id"]       || die("--build-id is required");
const platform      = opts.platform          || die("--platform is required");
const filePath      = opts.file && resolve(opts.file);
const callbackUrl   = opts["callback-url"]   || die("--callback-url is required");
const callbackToken = opts["callback-token"] || die("--callback-token is required");

if (!filePath) die("--file is required");

const accountId       = process.env.R2_ACCOUNT_ID       || die("R2_ACCOUNT_ID env not set");
const accessKeyId     = process.env.R2_ACCESS_KEY_ID    || die("R2_ACCESS_KEY_ID env not set");
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY|| die("R2_SECRET_ACCESS_KEY env not set");
const bucket          = process.env.R2_BUCKET           || die("R2_BUCKET env not set");

const stats = statSync(filePath);
const sizeBytes = stats.size;
const fileName = basename(filePath);
const r2Key = `builds/${buildId}/${platform}/${fileName}`;

console.log(`▸ r2-upload`);
console.log(`  build:    ${buildId}`);
console.log(`  platform: ${platform}`);
console.log(`  file:     ${fileName} (${(sizeBytes / 1024 / 1024).toFixed(1)} MB)`);
console.log(`  key:      ${r2Key}`);

// ── Compute sha256 ──────────────────────────────────────────────────
const sha256 = createHash("sha256")
  .update(readFileSync(filePath))
  .digest("hex");
console.log(`  sha256:   ${sha256}`);

// ── Upload to R2 (S3-compatible API) ────────────────────────────────
let S3Client, PutObjectCommand;
try {
  ({ S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3"));
} catch {
  die(
    "@aws-sdk/client-s3 not installed. Add it to the workflow's setup step: " +
    "`npm install @aws-sdk/client-s3`",
  );
}

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

console.log(`  uploading…`);
await s3.send(new PutObjectCommand({
  Bucket: bucket,
  Key: r2Key,
  Body: readFileSync(filePath),
  ContentType:
    fileName.endsWith(".exe") ? "application/x-msdownload"
    : fileName.endsWith(".dmg") ? "application/x-apple-diskimage"
    : fileName.endsWith(".zip") ? "application/zip"
    : "application/octet-stream",
  Metadata: {
    "build-id":  buildId,
    "platform":  platform,
    "sha256":    sha256,
  },
}));
console.log(`  ✓ uploaded`);

// ── Notify Caliptic API ─────────────────────────────────────────────
console.log(`▸ callback → ${callbackUrl}`);
const res = await fetch(callbackUrl, {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${callbackToken}`,
    "Content-Type":  "application/json",
  },
  body: JSON.stringify({
    build_id:    buildId,
    platform,
    r2_key:      r2Key,
    sha256,
    size_bytes:  sizeBytes,
    file_name:   fileName,
  }),
});
if (!res.ok) {
  const text = await res.text();
  die(`callback failed: HTTP ${res.status} — ${text}`);
}
console.log(`  ✓ Caliptic API notified`);
console.log(`✓ artifact registered`);
