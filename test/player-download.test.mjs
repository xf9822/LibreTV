import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

async function load() {
  const sandbox = { window: {}, console, URL, TextDecoder };
  vm.runInNewContext(await read('js/player-download.js'), sandbox);
  return sandbox.window.PlayerDownload.logic;
}

test('master playlists resolve to the best variant', async () => {
  const { parsePlaylist, pickVariant } = await load();
  const master = parsePlaylist(`#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
360/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720
720/index.m3u8`, 'https://cdn.example.com/v/master.m3u8');
  assert.equal(master.segments.length, 0);
  assert.deepEqual(plain(pickVariant(master.variants)), { url: 'https://cdn.example.com/v/720/index.m3u8', bandwidth: 2500000, resolution: '1280x720' });
});

test('media playlists keep keys, init segments, discontinuities and byte ranges per segment', async () => {
  const { parsePlaylist } = await load();
  const { segments } = parsePlaylist(`#EXTM3U
#EXT-X-MEDIA-SEQUENCE:7
#EXT-X-KEY:METHOD=AES-128,URI="/keys/k1.key",IV=0x000102030405060708090a0b0c0d0e0f
#EXTINF:4.0,
a.ts
#EXT-X-KEY:METHOD=NONE
#EXT-X-DISCONTINUITY
#EXTINF:6.5,
https://other.example.com/b.ts
#EXT-X-MAP:URI="init.mp4",BYTERANGE="720@0"
#EXT-X-BYTERANGE:1000@720
#EXTINF:2,
media.m4s
#EXT-X-BYTERANGE:500
#EXTINF:2,
media.m4s
#EXT-X-ENDLIST`, 'https://cdn.example.com/v/index.m3u8');
  assert.equal(segments.length, 4);
  assert.equal(segments[0].url, 'https://cdn.example.com/v/a.ts');
  assert.deepEqual(plain(segments[0].key), { method: 'AES-128', uri: 'https://cdn.example.com/keys/k1.key', iv: '0x000102030405060708090a0b0c0d0e0f' });
  assert.equal(segments[0].sequence, 7);
  assert.equal(segments[1].key, null);
  assert.equal(segments[1].discontinuity, true);
  assert.equal(segments[1].duration, 6.5);
  assert.deepEqual(plain(segments[2].map), { url: 'https://cdn.example.com/v/init.mp4', byterange: { start: 0, end: 719 } });
  assert.deepEqual(plain(segments[2].byterange), { start: 720, end: 1719 });
  assert.deepEqual(plain(segments[3].byterange), { start: 1720, end: 2219 }, 'a byte range without an offset continues the previous one');
});

test('AES-128 IVs come from the playlist or the media sequence number', async () => {
  const { ivFor } = await load();
  assert.deepEqual(Array.from(ivFor({ iv: '0x000102030405060708090a0b0c0d0e0f' }, 0)), [...Array(16).keys()]);
  assert.deepEqual(Array.from(ivFor({ iv: '' }, 258)), [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2]);
});

test('file names are safe on every system and sizes read naturally', async () => {
  const { safeFileName, formatBytes, formatDuration } = await load();
  assert.equal(safeFileName('繁花 第01集: 上/下?'), '繁花 第01集 上 下');
  assert.equal(safeFileName(''), '视频');
  assert.equal(formatBytes(1610612736), '1.50 GB');
  assert.equal(formatBytes(3_250_000), '3.1 MB');
  assert.equal(formatDuration(5400), '1 小时 30 分');
  assert.equal(formatDuration(150), '3 分钟');
});

test('the download button is desktop-only and sits between 换源 and 更多', async () => {
  const player = await read('js/player.js');
  const bar = player.slice(player.indexOf('<div class="quick-player-actions">'), player.indexOf('id="quickSettingsButton"'));
  assert.ok(bar.indexOf('switchResourceBtn') < bar.indexOf('downloadVideoButton'));
  assert.match(bar, /isMobilePlaybackDevice\(\) \|\| !window\.PlayerDownload \? '' : '<button type="button" id="downloadVideoButton"/);
  assert.match(player, /PlayerDownload\?\.start\(\{ url: currentVideoUrl, fileName: downloadFileName\(\), filterAds: adFilteringEnabled \}\)/);
  assert.match(player, /navigator\.clipboard\.writeText\(currentVideoUrl\)/);
  const download = await read('js/player-download.js');
  assert.match(download, /const MUX_SCRIPT = 'libs\/mux-mp4\.min\.js'/);
  assert.match(await read('libs/mux-mp4.min.js'), /^\/\*! @name mux\.js @version 7\.1\.0 @license Apache-2\.0 \*\//);
  const html = await read('player.html');
  assert.ok(html.indexOf('js/player-download.js') < html.indexOf('js/player.js"'));
  assert.match(await read('service-worker.js'), /'\/js\/player-download\.js'/);
});
