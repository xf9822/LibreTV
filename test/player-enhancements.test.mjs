import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

async function setup(storageValues = {}) {
  const values = new Map(Object.entries(storageValues));
  const localStorage = {
    getItem: key => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value))
  };
  const sandbox = { window: { localStorage }, console, URL };
  vm.runInNewContext(await read('js/player-enhancements.js'), sandbox);
  return { api: sandbox.window.PlayerEnhancements, values, localStorage };
}

test('episode labels hide redundant numbering but keep meaningful names', async () => {
  const { api } = await setup();
  const plain = (index, name) => ({ ...api.episodeLabel(index, name) });
  assert.deepEqual(plain(0, '第01集'), { number: 1, title: '' });
  assert.deepEqual(plain(4, 'EP05'), { number: 5, title: '' });
  assert.deepEqual(plain(9, '10'), { number: 10, title: '' });
  assert.deepEqual(plain(2, ''), { number: 3, title: '' });
  assert.deepEqual(plain(2, '20241003期：嘉宾特辑'), { number: 3, title: '20241003期：嘉宾特辑' });
  // A number that does not match the position is real information.
  assert.deepEqual(plain(0, '第2集'), { number: 1, title: '第2集' });
  assert.deepEqual(plain(0, 'HD国语'), { number: 1, title: 'HD国语' });
});

test('only an autoplay-policy rejection mutes playback', async () => {
  const { api } = await setup();
  assert.equal(api.shouldMuteAfterPlayRejection({ name: 'NotAllowedError' }), true);
  // Fast episode switching interrupts play() with AbortError; that must not mute.
  assert.equal(api.shouldMuteAfterPlayRejection({ name: 'AbortError' }), false);
  assert.equal(api.shouldMuteAfterPlayRejection(undefined), false);

  const player = await read('js/player.js');
  const start = player.indexOf('function tryStartPlayback');
  const body = player.slice(start, player.indexOf('\n}\n', start));
  assert.ok(body.indexOf('shouldMuteAfterPlayRejection(error)') > 0);
  assert.ok(body.indexOf('shouldMuteAfterPlayRejection(error)') < body.indexOf('art.muted = true'));
});

test('keyboard seeking clamps to the start and end of the video', async () => {
  const { api } = await setup();
  assert.equal(api.clampSeek(3, -5, 60), 0);
  assert.equal(api.clampSeek(30, -5, 60), 25);
  assert.equal(api.clampSeek(58, 5, 60), 59.5);
  assert.equal(api.clampSeek(10, 5, NaN), 15);
});

test('playback speed is remembered and only accepts offered rates', async () => {
  const { api, values, localStorage } = await setup();
  assert.equal(api.readStoredRate(localStorage), 1);
  api.storeRate(1.5, localStorage);
  assert.equal(values.get('libretvPlaybackRate'), '1.5');
  assert.equal(api.readStoredRate(localStorage), 1.5);
  api.storeRate(7, localStorage);
  assert.equal(api.readStoredRate(localStorage), 1.5);
  assert.equal(api.rateLabel(1), '倍速');
  assert.equal(api.rateLabel(1.25), '1.25x');

  const corrupt = await setup({ libretvPlaybackRate: 'fast' });
  assert.equal(corrupt.api.readStoredRate(corrupt.localStorage), 1);
});

test('next-episode countdown appears only in the last seconds of real episodes', async () => {
  const { api } = await setup();
  assert.equal(api.nextCardThreshold(2700), 10);
  assert.equal(api.nextCardThreshold(60), 9);
  assert.equal(api.nextCardThreshold(20), 0);
  assert.equal(api.nextCardThreshold(NaN), 0);
});

test('player wires the drawer, speed control and countdown into the player', async () => {
  const player = await read('js/player.js');
  const playerHtml = await read('player.html');
  const sw = await read('service-worker.js');
  const mobile = await read('js/mobile-fullscreen.js');

  assert.ok(playerHtml.indexOf('js/player-enhancements.js') < playerHtml.indexOf('js/player.js'));
  assert.match(sw, /'\/js\/player-enhancements\.js'/);
  assert.match(player, /name: 'episodes'/);
  assert.match(player, /name: 'playback-rate'/);
  assert.match(player, /createEpisodeDrawer\(/);
  assert.match(player, /createNextEpisodeCard\(/);
  // Cancelling the countdown stops the automatic next episode.
  assert.match(player, /autoplayEnabled && !nextEpisodeCard\?\.dismissed/);
  // The temporary long-press 3x speed and the browser's reset on load are not remembered.
  assert.match(player, /!temporaryRateActive && art\.video\.readyState >= 1/);
  // Touch: single tap toggles controls, double tap plays/pauses.
  assert.match(player, /toggleControlsFromTap/);
  assert.match(mobile, /mobile-fullscreen-episodes/);
});

test('intro and outro marks are remembered per title and skip only once', async () => {
  const { api, localStorage } = await setup();
  assert.deepEqual({ ...api.readSkipMarks('某剧', localStorage) }, { enabled: true, intro: 0, outro: 0 });
  api.writeSkipMarks(' 某 剧 ', { enabled: true, intro: 90, outro: 120 }, localStorage);
  const marks = api.readSkipMarks('某剧', localStorage);
  assert.deepEqual({ ...marks }, { enabled: true, intro: 90, outro: 120 });

  const duration = 2700;
  assert.equal(api.skipAction({ time: 2, duration, marks, introDone: false, outroDone: false }), 'intro');
  assert.equal(api.skipAction({ time: 2, duration, marks, introDone: true, outroDone: false }), null);
  assert.equal(api.skipAction({ time: 1200, duration, marks, introDone: true, outroDone: false }), null);
  // The outro is stored as seconds before the end, so it fits episodes of any length.
  assert.equal(api.effectiveEndTime(duration, marks), 2580);
  assert.equal(api.skipAction({ time: 2581, duration, marks, introDone: true, outroDone: false }), 'outro');
  assert.equal(api.skipAction({ time: 2581, duration, marks, introDone: true, outroDone: true }), null);
  // Too-short videos never lose their content to the marks.
  assert.equal(api.effectiveEndTime(140, marks), 140);
  assert.equal(api.skipAction({ time: 2, duration: 100, marks, introDone: false, outroDone: false }), null);
  // Disabled marks do nothing.
  assert.equal(api.skipAction({ time: 2, duration, marks: { ...marks, enabled: false }, introDone: false, outroDone: false }), null);

  api.writeSkipMarks('某剧', { enabled: true, intro: 0, outro: 0 }, localStorage);
  assert.deepEqual({ ...api.readSkipMarks('某剧', localStorage) }, { enabled: true, intro: 0, outro: 0 });
  assert.equal(api.formatClock(125), '2:05');
});

test('next-episode preload warms the first playlist level, init and first segment', async () => {
  const { api } = await setup();
  const responses = {
    'https://cdn.example/show/ep2.m3u8': '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nlow/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=4000000\nhigh/index.m3u8\n',
    'https://cdn.example/show/low/index.m3u8': '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:6,\nseg0.m4s\n#EXTINF:6,\nseg1.m4s\n'
  };
  const requested = [];
  const fetchImpl = async url => {
    requested.push(url);
    return {
      ok: true,
      text: async () => responses[url] || '',
      arrayBuffer: async () => new ArrayBuffer(8)
    };
  };
  const warmed = await api.preloadEpisode('https://cdn.example/show/ep2.m3u8', { fetchImpl });
  assert.deepEqual(Array.from(warmed), [
    'https://cdn.example/show/ep2.m3u8',
    'https://cdn.example/show/low/index.m3u8',
    'https://cdn.example/show/low/init.mp4',
    'https://cdn.example/show/low/seg0.m4s'
  ]);

  requested.length = 0;
  const light = await api.preloadEpisode('https://cdn.example/show/ep2.m3u8', { fetchImpl, playlistsOnly: true });
  assert.equal(light.length, 2);
  assert.ok(requested.every(url => url.endsWith('.m3u8')));

  assert.equal((await api.preloadEpisode('https://cdn.example/movie.mp4', { fetchImpl })).length, 0);
});

test('skip, preload and countdown ignore the previous episode time until new metadata loads', async () => {
  const player = await read('js/player.js');
  const playerHtml = await read('player.html');
  const styles = await read('css/player.css');
  // Right after a switch, video.currentTime still holds the previous episode's
  // position; acting on it skipped a whole episode at the outro point.
  assert.match(player, /function handlePlaybackProgress\(\) \{\n    if \(!art\?\.video \|\| !skipState\.ready\) return;/);
  assert.match(player, /isEnabled: \(\) => autoplayEnabled && skipState\.ready/);
  assert.match(player, /art\.on\('video:loadedmetadata', function\(\) \{\n        skipState\.ready = true;/);
  assert.match(player, /name: 'skip-intro'/);
  assert.match(player, /name: 'skip-outro'/);
  assert.match(player, /preloadEpisode\(nextUrl/);
  assert.match(playerHtml, /id="sideEpisodes"/);
  assert.match(styles, /\.player-stage\.has-side-episodes/);
});

test('keyboard shortcuts map to player actions and leave browser shortcuts alone', async () => {
  const { api } = await setup();
  const act = (key, extra = {}) => {
    const action = api.shortcutAction({ key, ...extra });
    return action ? { ...action } : null;
  };
  assert.deepEqual(act(' '), { type: 'toggle' });
  assert.deepEqual(act('K'), { type: 'toggle' });
  assert.deepEqual(act('j'), { type: 'seek', delta: -10 });
  assert.deepEqual(act('l'), { type: 'seek', delta: 10 });
  assert.deepEqual(act('ArrowRight'), { type: 'seek-forward-hold' });
  assert.deepEqual(act('m'), { type: 'mute' });
  assert.deepEqual(act('n'), { type: 'episode', delta: 1 });
  assert.deepEqual(act('p'), { type: 'episode', delta: -1 });
  assert.deepEqual(act(']'), { type: 'rate', delta: 1 });
  assert.deepEqual(act('<'), { type: 'rate', delta: -1 });
  assert.deepEqual(act('7'), { type: 'seek-percent', value: 70 });
  assert.deepEqual(act('?'), { type: 'help' });
  assert.deepEqual(act('Enter', { altKey: true }), { type: 'fullscreen' });
  assert.deepEqual(act('ArrowRight', { altKey: true }), { type: 'episode', delta: 1 });
  // Ctrl/Cmd combinations (copy, reload, find…) belong to the browser.
  assert.equal(act('r', { ctrlKey: true }), null);
  assert.equal(act('f', { metaKey: true }), null);
  assert.equal(act('x'), null);

  assert.equal(api.stepRate(1, 1), 1.25);
  assert.equal(api.stepRate(1, -1), 0.75);
  assert.equal(api.stepRate(3, 1), 3);
  assert.equal(api.stepRate(0.5, -1), 0.5);
  assert.equal(api.stepRate(1.1, 1), 1.25);
});

test('touch gestures: double-tap zones and swipe seeking', async () => {
  const { api } = await setup();
  const rect = { left: 0, width: 300 };
  assert.equal(api.doubleTapZone(50, rect), 'back');
  assert.equal(api.doubleTapZone(150, rect), 'center');
  assert.equal(api.doubleTapZone(260, rect), 'forward');
  // A full-width swipe covers up to two minutes and never leaves the video.
  assert.equal(api.swipeSeekTarget(100, 150, 300, 2700), 160);
  assert.equal(api.swipeSeekTarget(10, -300, 300, 2700), 0);
  assert.equal(api.swipeSeekTarget(50, 300, 300, 60), 59.5);
});

test('saved progress is restored once per load so later seeks are not pulled back', async () => {
  const player = await read('js/player.js');
  const mobile = await read('js/mobile-fullscreen.js');
  const start = player.indexOf('function restorePlaybackPosition');
  const body = player.slice(start, player.indexOf('\n}\n', start));
  assert.match(body, /if \(Number\.isFinite\(duration\) && duration > 0\) playbackRestoreApplied = true;/);
  // Long press follows the player node into Artplayer's fullscreen layer.
  assert.match(player, /const playerElement = art\.template\?\.\$player \|\| document\.getElementById\('player'\);/);
  // Fullscreen swipes are not also handled by Artplayer's built-in seek gesture.
  assert.match(mobile, /event\.stopPropagation\(\);\n\s*const touch = event\.touches\[0\];/);
  assert.match(player, /document\.addEventListener\('keyup', handleKeyboardShortcutRelease\)/);
});
