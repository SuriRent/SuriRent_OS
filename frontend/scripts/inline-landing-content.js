#!/usr/bin/env node
/**
 * inline-landing-content.js
 *
 * Postbuild-stap: haalt de gepubliceerde landing content op via
 * `${REACT_APP_BACKEND_URL}/api/landing/content` en injecteert die als
 * `window.__LANDING_CONTENT__` in `build/index.html`. Zo hoeft de
 * MarketingLanding component geen `fetch` te doen bij een eerste bezoek —
 * de eerste render toont direct de juiste teksten/afbeeldingen, wat
 * ~150-500ms scheelt en de "flicker" van fallback → server-content
 * volledig elimineert.
 *
 * Faalt STIL — als de backend niet bereikbaar is bij build, laat het
 * de placeholder marker gewoon staan en gebruikt de frontend gewoon de
 * bestaande fetch + localStorage-cache. Nooit een build blokkeren.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const BUILD_HTML = path.join(ROOT, 'build', 'index.html');
const ENV_FILE = path.join(ROOT, '.env');
const MARKER = '<!--__LANDING_CONTENT__-->';
const TIMEOUT_MS = 8000;

function log(msg) { process.stdout.write(`[inline-landing] ${msg}\n`); }
function warn(msg) { process.stderr.write(`[inline-landing] WARN: ${msg}\n`); }

function readBackendUrl() {
  try {
    const raw = fs.readFileSync(ENV_FILE, 'utf8');
    const line = raw.split('\n').find((l) => l.trim().startsWith('REACT_APP_BACKEND_URL='));
    if (!line) return null;
    return line.split('=').slice(1).join('=').trim();
  } catch { return null; }
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const req = client.get(url, { timeout: TIMEOUT_MS }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
  });
}

// Voorkomt </script> in JSON dat de <script> tag prematuur sluit (XSS-safe).
function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/-->/g, '--\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

async function main() {
  if (!fs.existsSync(BUILD_HTML)) {
    warn(`build/index.html niet gevonden (${BUILD_HTML}) — skip inline`);
    return;
  }
  const html = fs.readFileSync(BUILD_HTML, 'utf8');
  if (!html.includes(MARKER)) {
    warn('placeholder marker niet gevonden in build/index.html — skip inline');
    return;
  }

  const backend = readBackendUrl();
  if (!backend) {
    warn('REACT_APP_BACKEND_URL niet gezet — skip inline');
    return;
  }
  const url = `${backend.replace(/\/$/, '')}/api/landing/content`;
  log(`fetching ${url}`);

  let content;
  try {
    const data = await fetchJson(url);
    content = data && data.content;
    if (!content || typeof content !== 'object') throw new Error('empty content');
  } catch (e) {
    warn(`fetch faalde (${e.message}) — build blijft werkend, frontend faalt terug op runtime fetch`);
    return;
  }

  const scriptTag = `<script>window.__LANDING_CONTENT__=${safeJson(content)};</script>`;
  const patched = html.replace(MARKER, scriptTag);
  fs.writeFileSync(BUILD_HTML, patched, 'utf8');
  const kb = (Buffer.byteLength(scriptTag, 'utf8') / 1024).toFixed(1);
  log(`inlined ${kb} KB landing content in build/index.html`);
}

main().catch((e) => {
  warn(`onverwacht: ${e.message} — build niet blokkeren`);
  process.exit(0);
});
