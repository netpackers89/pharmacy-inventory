/**
 * env.js — the single, robust environment loader for the backend.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `require('dotenv').config()` resolves `.env` against the CURRENT WORKING
 * DIRECTORY. That means the server behaved differently depending on where it
 * was started from:
 *
 *     cd server && node src/app.js     -> reads server/.env
 *     node server/src/app.js           -> reads <repo>/.env
 *
 * A key that was visible while starting the app one way appeared "missing" the
 * other way. This module loads BOTH files deterministically (server/.env first,
 * then the repo-root .env as a fallback) and never overrides a value that is
 * already set in the real environment (Render / Docker / shell variables always
 * win, which is what production requires).
 *
 * It also normalizes secrets: quotes pasted into .env, stray spaces, invisible
 * newlines and an accidental "Bearer " prefix are all removed. That single
 * helper is what turned "GEMINI_API_KEY does not look like a valid API key"
 * into a working configuration.
 *
 * SECURITY: this file never logs a secret value — only safe metadata such as a
 * 4-character prefix, which the rest of the app uses for diagnostics.
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

/*
 * Candidate .env files, highest priority first.
 *   - server/.env           (normal local setup)
 *   - <repo>/server/.env    (explicit, same file, resolved from cwd)
 *   - <repo>/.env           (legacy layout / deployment convenience)
 */
const CANDIDATE_FILES = [
  path.resolve(__dirname, '../../.env'),
  path.resolve(process.cwd(), 'server/.env'),
  path.resolve(__dirname, '../../../.env'),
  path.resolve(process.cwd(), '.env'),
];

const loadedEnvFiles = [];
const seen = new Set();

for (const file of CANDIDATE_FILES) {
  if (seen.has(file)) continue;
  seen.add(file);
  try {
    if (!fs.existsSync(file)) continue;
    // dotenv never overwrites variables that are already defined, so the
    // first file that defines a key wins and process.env always has priority.
    dotenv.config({ path: file });
    loadedEnvFiles.push(file);
  } catch (err) {
    console.warn(`[ENV] Could not load ${file}: ${err.message}`);
  }
}

/**
 * Clean a secret read from the environment.
 * Removes the BOM, surrounding whitespace, surrounding quotes (single, double
 * or backtick) and an accidental "Bearer " prefix. Internal whitespace is
 * stripped too, because API keys / bot tokens never contain spaces and pasted
 * values frequently carry a line break in the middle.
 */
function normalizeSecret(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/^['"`]+|['"`]+$/g, '')
    .replace(/^Bearer\s+/i, '')
    .replace(/\s+/g, '')
    .trim();
}

/** First non-empty (normalized) value among the given variable names. */
function readEnv(...names) {
  for (const name of names) {
    const value = normalizeSecret(process.env[name]);
    if (value) return value;
  }
  return '';
}

/** First non-empty RAW value (no normalization) — for flags / paths. */
function readRaw(...names) {
  for (const name of names) {
    const value = String(process.env[name] || '').replace(/^\uFEFF/, '').trim();
    if (value) return value;
  }
  return '';
}

/** Safe diagnostic label: never reveals more than the first 4 characters. */
function secretFingerprint(value) {
  const v = normalizeSecret(value);
  if (!v) return 'missing';
  return `${v.slice(0, 4)}… (${v.length} chars)`;
}

/**
 * Split a comma-separated env var into a clean array.
 *   CRON="a, b ,,c"  ->  ['a', 'b', 'c']
 */
function readList(...names) {
  const raw = readRaw(...names);
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

module.exports = {
  loadedEnvFiles,
  normalizeSecret,
  readEnv,
  readRaw,
  readList,
  secretFingerprint,
};

// Loading is a side effect of requiring this module on purpose: app.js and
// db.js both `require('./config/env')` before they read anything else.
