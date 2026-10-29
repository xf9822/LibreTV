import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const read = file => readFile(path.join(root, file), 'utf8');
const PAGES = ['index.html', 'player.html', 'about.html', 'diagnostics.html', 'offline.html'];

test('pages use the prebuilt Tailwind stylesheet instead of the in-browser compiler', async () => {
  for (const page of PAGES) {
    const html = await read(page);
    assert.doesNotMatch(html, /tailwindcss\.min\.js/, page);
    const head = html.slice(0, html.indexOf('</head>'));
    // Last in <head>, where the runtime used to inject its styles, so it keeps winning over theme.css.
    const sheets = [...head.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map(match => match[1]);
    assert.equal(sheets.at(-1), 'css/tailwind.css', page);
    assert.ok(sheets.includes('css/theme.css'), page);
  }
  assert.equal(existsSync(path.join(root, 'libs/tailwindcss.min.js')), false);
  const worker = await read('service-worker.js');
  assert.match(worker, /'\/css\/tailwind\.css'/);
  assert.doesNotMatch(worker, /tailwindcss\.min\.js/);
});

test('css/tailwind.css is rebuilt after Tailwind classes change', { skip: !existsSync(path.join(root, 'node_modules/.bin/tailwindcss')) && 'tailwindcss is not installed' }, () => {
  const output = path.join(mkdtempSync(path.join(tmpdir(), 'libretv-css-')), 'tailwind.css');
  execFileSync(path.join(root, 'node_modules/.bin/tailwindcss'),
    ['-c', 'tailwind.config.cjs', '-i', 'css/tailwind.src.css', '-o', output, '--minify'], { cwd: root, stdio: 'ignore' });
  assert.ok(readFileSync(output, 'utf8') === readFileSync(path.join(root, 'css/tailwind.css'), 'utf8'),
    'css/tailwind.css is out of date: run `npm run build:css`');
});

test('the about page header has brand, title and a way home', async () => {
  const html = await read('about.html');
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
  assert.match(header, /class="lt-subnav lt-subnav-bar"/);
  assert.match(header, /class="lt-brand-mark"/);
  assert.match(header, /<h1 class="lt-subnav-title">关于本站<\/h1>/);
  assert.match(header, /class="lt-subnav-back"/);
  assert.match(html, /href="https:\/\/github\.com\/wxst\/LibreTV"/, 'the repository link stays');
});
