import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

async function load(stored = null) {
  const values = new Map(stored ? [['videoEnhanceMode', stored]] : []);
  const sandbox = { window: {}, console, localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } };
  vm.runInNewContext(await read('js/video-enhance.js'), sandbox);
  return { api: sandbox.window.VideoEnhance, values };
}

test('the canvas covers exactly the letterboxed picture', async () => {
  const { logic } = (await load()).api;
  assert.deepEqual(plain(logic.contentRect(1000, 500, 1920, 1080)), { left: 55.55555555555554, top: 0, width: 888.8888888888889, height: 500 });
  assert.deepEqual(plain(logic.contentRect(400, 400, 1280, 720)), { left: 0, top: 87.5, width: 400, height: 225 });
  assert.equal(logic.contentRect(400, 400, 0, 0), null, 'nothing to draw before metadata');
});

test('the drawing buffer follows device pixels, capped for phones and huge screens', async () => {
  const { logic } = (await load()).api;
  assert.deepEqual(plain(logic.outputSize({ width: 892, height: 502 }, 1)), { width: 892, height: 502 });
  assert.deepEqual(plain(logic.outputSize({ width: 390, height: 219 }, 3)), { width: 780, height: 438 }, 'at most 2× device pixels');
  assert.deepEqual(plain(logic.outputSize({ width: 892, height: 502 }, 2, 1)), { width: 892, height: 502 }, 'the slow-device step-down draws at 1×');
  const big = logic.outputSize({ width: 3840, height: 2160 }, 2);
  assert.ok(big.width * big.height <= 3840 * 2160);
});

test('the chosen mode is remembered and unknown values fall back to off', async () => {
  assert.equal((await load()).api.readMode(), 'off', 'off by default');
  assert.equal((await load('sharp')).api.readMode(), 'sharp');
  assert.equal((await load('dlss')).api.readMode(), 'off');
  const { api, values } = await load();
  api.writeMode('standard');
  assert.equal(values.get('videoEnhanceMode'), 'standard');
  assert.deepEqual(Object.keys(api.MODES), ['off', 'standard', 'sharp', 'restore']);
  assert.equal(api.MODES.restore.label, '低画质修复');
});

test('the shaders are FSR 1.0 EASU + RCAS and the player offers the setting', async () => {
  const code = await read('js/video-enhance.js');
  assert.match(code, /const EASU = `#version 300 es/);
  assert.match(code, /const RCAS = `#version 300 es/);
  assert.match(code, /requestVideoFrameCallback/);
  // Image rows run top to bottom while gl_FragCoord runs bottom to top.
  assert.match(code, /vec2 outPos = vec2\(gl_FragCoord\.x, outputSize\.y - gl_FragCoord\.y\)/);
  const player = await read('js/player.js');
  assert.match(player, /name: 'video-enhance',\s+html: '画质增强'/);
  assert.match(player, /enhance: videoEnhancer\?\.describe\(\) \|\| ''/);
  const css = await read('css/player.css');
  assert.match(css, /\.art-video-player\.video-enhance-on \.art-video \{ opacity: 0 !important; \}/);
  const html = await read('player.html');
  assert.ok(html.indexOf('js/video-enhance.js') < html.indexOf('js/player.js"'));
  assert.match(await read('service-worker.js'), /'\/js\/video-enhance\.js'/);
});

test('low-quality restore stretches washed-out pictures but leaves good ones and letterbox black alone', async () => {
  const { computeLevels, blendLevels } = (await load()).api.logic;
  const frame = lumas => Uint8Array.from(lumas.flatMap(y => [y, y, y, 255]));
  const spread = (from, to, count) => Array.from({ length: count }, (_, i) => Math.round(from + (to - from) * i / (count - 1)));
  // A grey TC picture (luma 60–180) inside black bars: the bars are ignored, the picture is stretched.
  const tc = plain(computeLevels(frame([...Array(400).fill(0), ...spread(60, 180, 1000)])));
  assert.equal(tc.lo, 0.2, 'grey blacks are lifted out, up to 0.2');
  assert.equal(tc.hi, 0.75, 'the white point is never pulled below 0.75');
  // A well-exposed picture keeps (almost) its full range.
  const good = plain(computeLevels(frame(spread(3, 252, 1000))));
  assert.ok(good.lo < 0.04 && good.hi > 0.97, JSON.stringify(good));
  // Dark scenes are not brightened to grey: the stretch is limited.
  const dark = plain(computeLevels(frame(spread(10, 70, 1000))));
  assert.ok(dark.hi - dark.lo >= 0.5);
  // Mostly black frames (fades) change nothing.
  assert.deepEqual(plain(computeLevels(frame([...Array(900).fill(0), ...spread(20, 200, 100)]))), { lo: 0, hi: 1 });
  // Levels move gradually.
  const blended = blendLevels({ lo: 0, hi: 1 }, { lo: 0.2, hi: 0.8 });
  assert.ok(Math.abs(blended.lo - 0.06) < 1e-9 && Math.abs(blended.hi - 0.94) < 1e-9);
  assert.deepEqual(plain(blendLevels(null, { lo: 0.2, hi: 0.8 })), { lo: 0.2, hi: 0.8 });
  const code = await read('js/video-enhance.js');
  assert.match(code, /const RESTORE = `#version 300 es/);
});
