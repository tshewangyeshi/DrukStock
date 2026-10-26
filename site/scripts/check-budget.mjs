// Per-part gzipped size budgets (eng re-review ER-D2, ER-D13b), checked on
// the production build in dist/. Exits non-zero when any line is over.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'dist';
const KB = 1024;
const gz = f => gzipSync(readFileSync(join(dir, f)), { level: 9 }).length;
const list = d => existsSync(join(dir, d)) ? readdirSync(join(dir, d)).filter(n => statSync(join(dir, d, n)).isFile()).map(n => `${d}/${n}`) : [];

const fonts = list('fonts').filter(f => f.endsWith('.woff2'));
const app = ['index.html', 'styles.css', 'app.js', 'engine.js', 'log.js', 'labels.js', 'nav.js', 'store.js', 'config.js', 'sw.js', 'vendor/big.mjs'];
const fixtureQr = [...list('fixtures'), ...list('qr')];
const install = ['manifest.webmanifest', ...list('icons')];

const lines = [
  ['fonts', fonts, 60 * KB],
  ['app JS+CSS+HTML+sw', app, 50 * KB],
  ['fixture/QR', fixtureQr, 20 * KB],
  ['install files (outside page budget)', install, 40 * KB],
];

let failed = false;
const sums = {};
for (const [name, files, limit] of lines) {
  const missing = files.filter(f => !existsSync(join(dir, f)));
  if (missing.length) { console.error(`missing in ${dir}: ${missing.join(', ')}`); failed = true; continue; }
  const total = files.reduce((s, f) => s + gz(f), 0);
  sums[name] = total;
  const ok = total <= limit;
  if (!ok) failed = true;
  console.log(`${ok ? 'ok  ' : 'OVER'} ${name.padEnd(36)} ${(total / KB).toFixed(1).padStart(6)} KB / ${(limit / KB).toFixed(0)} KB`);
}
const flat = sums['fonts'] + sums['app JS+CSS+HTML+sw'] + sums['fixture/QR'];
const flatOk = flat <= 150 * KB;
if (!flatOk) failed = true;
console.log(`${flatOk ? 'ok  ' : 'OVER'} ${'flat variant total'.padEnd(36)} ${(flat / KB).toFixed(1).padStart(6)} KB / 150 KB`);

// ER-D6: the production bundle must never carry the test standalone flag.
if (dir === 'dist' && /TEST_STANDALONE\s*=\s*true/.test(readFileSync(join(dir, 'config.js'), 'utf8'))) {
  console.error('production build has TEST_STANDALONE = true'); failed = true;
}
process.exit(failed ? 1 : 0);
