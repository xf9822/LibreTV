import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

async function load() {
  const sandbox = { window: {}, console, URL };
  vm.runInNewContext(await read('js/player-stats.js'), sandbox);
  return sandbox.window.PlayerStats;
}

test('stats formatting reads like YouTube "Stats for nerds"', async () => {
  const { logic } = await load();
  assert.equal(logic.formatBits(62_400_000), '62 Mbps');
  assert.equal(logic.formatBits(1_150_000), '1.1 Mbps');
  assert.equal(logic.formatBits(850_000), '850 Kbps');
  assert.equal(logic.formatBits(0), '—');
  assert.equal(logic.formatBytes(8_074_000), '7.7 MB');
  assert.equal(logic.formatBytes(300), '1 KB');
  assert.equal(logic.formatClock(13994.17), '3:53:14');
  assert.equal(logic.formatClock(65), '1:05');
  const split = logic.splitCodecs(['', '', 'opus,vp09.00.31.08', 'avc1.64001f', 'mp4a.40.2']);
  assert.equal(split.video, 'vp09.00.31.08 (VP9)');
  assert.equal(split.audio, 'opus (Opus)');
  assert.equal(logic.codecName('avc1.64001f'), 'avc1.64001f (H.264)');
  assert.equal(logic.codecName('hvc1.1.6.L120.90'), 'hvc1.1.6.L120.90 (H.265)');
});

test('buffer health is the time buffered ahead of the playhead', async () => {
  const { logic } = await load();
  const ranges = list => ({ length: list.length, start: i => list[i][0], end: i => list[i][1] });
  assert.equal(logic.bufferAhead({ currentTime: 10, buffered: ranges([[0, 4], [9.95, 40]]) }), 30);
  assert.equal(logic.bufferAhead({ currentTime: 5, buffered: ranges([[0, 4], [9, 40]]) }), 0, 'playhead in a gap');
  assert.equal(logic.bufferAhead(null), 0);
});

test('the tracker sums fragment downloads and keeps a one-second activity window', async () => {
  const { createTracker, fragmentStats } = await load();
  let clock = 10_000;
  const tracker = createTracker(() => clock);
  const frag = (bytes, start) => fragmentStats({ frag: { duration: 6, url: 'https://cdn.example.com/a/0.ts', stats: { loaded: bytes, loading: { start, first: start + 40, end: start + 200 } } } });
  assert.deepEqual(JSON.parse(JSON.stringify(frag(750_000, 100))), { bytes: 750_000, duration: 6, loadMs: 200, firstByteMs: 40, url: 'https://cdn.example.com/a/0.ts' });
  tracker.fragment(frag(750_000, 100));
  clock += 500;
  tracker.fragment(frag(750_000, 700));
  assert.equal(tracker.bytesLastSecond(), 1_500_000);
  clock += 900;
  assert.equal(tracker.bytesLastSecond(), 750_000);
  tracker.codecs({ audiovideo: { codec: 'opus,vp09.00.31.08' } });
  tracker.ads({ removedSegments: 4, removedSeconds: 52.8 });
  const summary = tracker.summary();
  assert.equal(summary.fragments, 2);
  assert.equal(summary.bytes, 1_500_000);
  assert.equal(summary.mediaBitrate, 1_000_000, '1.5 MB for 12 seconds of video');
  assert.equal(summary.averageLoadMs, 200);
  assert.equal(summary.averageFirstByteMs, 40);
  assert.equal(summary.host, 'cdn.example.com');
  assert.equal(summary.ads.removedSegments, 4);
});

test('the player opens its own stats panel and keeps its clicks away from play/pause', async () => {
  const player = await read('js/player.js');
  assert.match(player, /art\.contextmenu\?\.update\?\.\(\{ name: 'info', index: 40, html: '统计信息'/);
  assert.match(player, /name: 'player-stats', html: '统计信息'/);
  // The surface click handler must ignore both the panel and ArtPlayer's own info panel.
  const selector = player.slice(player.indexOf('const PLAYER_SURFACE_INTERACTIVE_SELECTOR'), player.indexOf("].join(',')"));
  assert.match(selector, /'\.art-info'/);
  assert.match(selector, /'\.player-stats-panel'/);
  assert.match(player, /tracker\?\.fragment\(window\.PlayerStats\.fragmentStats\(data\)\)/);
  assert.match(player, /hls\.on\(Hls\.Events\.BUFFER_CODECS/);
  assert.match(await read('js/mobile-fullscreen.js'), /\.player-shortcut-help, \.player-stats-panel'\)/);
  const html = await read('player.html');
  assert.ok(html.indexOf('js/player-stats.js') < html.indexOf('js/player.js"'));
  assert.match(await read('service-worker.js'), /'\/js\/player-stats\.js'/);
});
