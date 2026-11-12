const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BUILD_DIR = path.join(ROOT, 'build');
const MANIFEST_PATH = path.join(BUILD_DIR, 'asset-manifest.json');
const HTML_PATH = path.join(BUILD_DIR, 'index.html');
const SW_PATH = path.join(BUILD_DIR, 'sw.js');

function main() {
  for (const file of [MANIFEST_PATH, HTML_PATH, SW_PATH]) {
    if (!fs.existsSync(file)) throw new Error(`Buildbestand niet gevonden: ${file}`);
  }

  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(MANIFEST_PATH));
  hash.update(fs.readFileSync(HTML_PATH));
  const buildId = hash.digest('hex').slice(0, 12);

  const sw = fs.readFileSync(SW_PATH, 'utf8');
  const match = sw.match(/const CACHE_VERSION = '([^']+)';/);
  if (!match) throw new Error('CACHE_VERSION niet gevonden in build/sw.js');

  const baseVersion = match[1].replace(/-[a-f0-9]{12}$/, '');
  const versionedSw = sw.replace(match[0], `const CACHE_VERSION = '${baseVersion}-${buildId}';`);
  fs.writeFileSync(SW_PATH, versionedSw, 'utf8');
  process.stdout.write(`[pwa] Service worker buildversie: ${baseVersion}-${buildId}\n`);
}

main();
