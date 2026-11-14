// One-step launcher: installs what's missing, builds the catalog and UI if needed,
// starts Reel and opens it in the browser. Safe to run every time.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(ROOT);
const PORT = process.env.PORT || 4317;
const URL_ = `http://localhost:${PORT}`;
const say = (m) => console.log(`\n▸ ${m}`);
const fail = (m) => { console.error(`\n✖ ${m}\n`); process.exit(1); };

const major = +process.versions.node.split('.')[0];
if (major < 20) fail(`Reel needs Node.js 20 or newer (you have ${process.versions.node}). Install the current LTS from https://nodejs.org and try again.`);

function run(cmd, args, what) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) fail(`${what} failed. Scroll up for the error. Running "npm run reel" again is safe and resumes where it stopped.`);
}
function openBrowser() {
  if (process.env.REEL_NO_OPEN) return;
  const isWsl = process.platform === 'linux' && /microsoft/i.test(fs.existsSync('/proc/version') ? fs.readFileSync('/proc/version', 'utf8') : '');
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', URL_]]
    : process.platform === 'darwin' ? ['open', [URL_]]
      : isWsl ? ['cmd.exe', ['/c', 'start', '', URL_]] : ['xdg-open', [URL_]];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* user can open the link by hand */ }
}

// Already running? Just open it.
try {
  const res = await fetch(`${URL_}/api/status`, { signal: AbortSignal.timeout(1500) });
  if (res.ok) { say(`Reel is already running — opening ${URL_}`); openBrowser(); process.exit(0); }
} catch { /* not running */ }

if (!fs.existsSync(path.join(ROOT, 'node_modules', 'express')) || !fs.existsSync(path.join(ROOT, 'node_modules', 'vite'))) {
  say('First run: installing components (about a minute)…');
  run('npm', ['install', '--no-fund', '--no-audit'], 'Installing components');
}
if (!fs.existsSync(path.join(ROOT, 'data', 'catalog.db'))) {
  say('First run: downloading the movie & TV catalog (about 700 MB) and building it. This takes 3–10 minutes depending on your connection, and only happens once.');
  run(process.execPath, ['server/build-catalog.mjs', '--clean'], 'Building the catalog');
}
const newest = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((m, e) => Math.max(m, e.isDirectory() ? newest(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).mtimeMs), 0);
const built = path.join(ROOT, 'dist', 'index.html');
if (!fs.existsSync(built) || fs.statSync(built).mtimeMs < newest(path.join(ROOT, 'client'))) {
  say('Preparing the app…');
  run('npx', ['vite', 'build', '--logLevel', 'warn'], 'Preparing the app');
}

say(`Starting Reel at ${URL_}  —  leave this terminal open while you use it; press Ctrl+C to stop.`);
await import('../server/index.mjs');
setTimeout(openBrowser, 600);
