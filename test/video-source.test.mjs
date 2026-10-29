import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

async function loadAdFilter() {
  const sandbox = { window: {}, console: { warn() {} }, URL };
  vm.runInNewContext(await read('js/hls-ad-filter.js'), sandbox);
  return sandbox.window.HlsAdFilter;
}

const BASE = 'https://v.cdn.example/20240101/abc123/2000k/hls/index.m3u8';
const header = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:6', '#EXT-X-PLAYLIST-TYPE:VOD', '#EXT-X-MEDIA-SEQUENCE:0'];
const hashName = i => `a1b2c3d4e5f6a7b8${String(i).padStart(6, '0')}.ts`;
const segs = (count, name, duration = 6) =>
  Array.from({ length: count }, (_, i) => [`#EXTINF:${duration.toFixed(6)},`, name(i)]).flat();
const playlist = (...parts) => [...header, ...parts.flat(), '#EXT-X-ENDLIST', ''].join('\n');
const uris = text => text.split('\n').filter(line => line && !line.startsWith('#'));

test('mid-roll ads from another host are removed and one discontinuity remains', async () => {
  const filter = await loadAdFilter();
  const ad = i => `https://ads.example.net/creative/spot${i}.ts`;
  const text = playlist(
    '#EXT-X-KEY:METHOD=AES-128,URI="key.key"',
    segs(50, hashName),
    '#EXT-X-DISCONTINUITY', segs(5, ad, 3),
    '#EXT-X-DISCONTINUITY', segs(50, i => hashName(50 + i))
  );
  const result = filter.filterPlaylist(text, BASE);
  assert.equal(result.removedSegments, 5);
  assert.equal(result.removedSeconds, 15);
  assert.equal(uris(result.content).length, 100);
  assert.ok(!result.content.includes('ads.example.net'));
  assert.equal(result.content.match(/#EXT-X-DISCONTINUITY/g).length, 1);
  assert.match(result.content, /#EXT-X-KEY:METHOD=AES-128,URI="key\.key"/);
  assert.match(result.content, /#EXT-X-ENDLIST\n$/);
  // Every remaining segment keeps its own #EXTINF directly above it.
  const lines = result.content.split('\n');
  lines.forEach((line, i) => { if (line && !line.startsWith('#')) assert.match(lines[i - 1], /^#EXTINF:6/); });
});

test('pre-roll ads in another directory are removed without a leading discontinuity', async () => {
  const filter = await loadAdFilter();
  const text = playlist(
    segs(3, i => `/ad/2024/preroll${i}.ts`, 5),
    '#EXT-X-DISCONTINUITY', segs(80, hashName)
  );
  const result = filter.filterPlaylist(text, BASE);
  assert.equal(result.removedSegments, 3);
  assert.ok(!result.content.includes('#EXT-X-DISCONTINUITY'));
  assert.equal(uris(result.content)[0], hashName(0));
});

test('same-directory ads are recognised by a different file-name length', async () => {
  const filter = await loadAdFilter();
  const text = playlist(
    segs(60, hashName),
    '#EXT-X-DISCONTINUITY', segs(4, i => `ad${i}.ts`, 4),
    '#EXT-X-DISCONTINUITY', segs(60, i => hashName(60 + i))
  );
  const result = filter.filterPlaylist(text, BASE);
  assert.equal(result.removedSegments, 4);
  assert.ok(!/\nad\d\.ts/.test(result.content));
});

test('playlists without a clear ad break are returned byte-for-byte', async () => {
  const filter = await loadAdFilter();
  const cases = {
    'no discontinuity': playlist(segs(40, hashName)),
    // Counter names grow in length; a split episode must not lose its tail.
    'growing counter names': playlist(segs(95, i => `${i + 5}.ts`), '#EXT-X-DISCONTINUITY', segs(10, i => `${i + 100}.ts`)),
    'foreign block longer than an ad break': playlist(segs(60, hashName), '#EXT-X-DISCONTINUITY', segs(30, i => `https://other.example/x/${i}.ts`)),
    'too large a share of the runtime': playlist(segs(10, hashName), '#EXT-X-DISCONTINUITY', segs(8, i => `https://ads.example.net/a/${i}.ts`)),
    'load-balanced hosts': playlist(...Array.from({ length: 20 }, (_, i) => [
      i ? '#EXT-X-DISCONTINUITY' : [], segs(1, () => `https://cdn${i % 3 ? 1 : 2}.example/v/${hashName(i)}`)
    ])),
    'only foreign segments': playlist(segs(3, i => `https://a.example/x/${i}.ts`), '#EXT-X-DISCONTINUITY', segs(3, i => `https://b.example/y/${i}.ts`)),
    'master playlist': '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2000000\n2000k/index.m3u8\n'
  };
  for (const [name, text] of Object.entries(cases)) {
    const result = filter.filterPlaylist(text, BASE);
    assert.equal(result.content, text, name);
    assert.equal(result.removedSegments, 0, name);
  }
});

test('discontinuity sequence headers are not mistaken for ad breaks', async () => {
  const filter = await loadAdFilter();
  const text = playlist('#EXT-X-DISCONTINUITY-SEQUENCE:3', segs(40, hashName));
  assert.equal(filter.filterPlaylist(text, BASE).content, text);
  const player = await read('js/player.js');
  // The old filter deleted every discontinuity tag, which scrambles ad/content timestamps.
  assert.doesNotMatch(player, /line\.includes\('#EXT-X-DISCONTINUITY'\)/);
  assert.match(player, /filterAdsFromM3U8\(response\.data, response\.url \|\| context\.url\)/);
  const html = await read('player.html');
  assert.ok(html.indexOf('js/hls-ad-filter.js') < html.indexOf('js/player.js'));
  assert.match(await read('service-worker.js'), /'\/js\/hls-ad-filter\.js'/);
});

test('mid-playback recovery retries with backoff, then gives up', async () => {
  const sandbox = { window: { localStorage: { getItem: () => null, setItem() {} } }, console, URL };
  vm.runInNewContext(await read('js/player-enhancements.js'), sandbox);
  const recovery = sandbox.window.PlayerEnhancements.createPlaybackRecovery();
  const steps = Array.from({ length: 5 }, () => ({ ...recovery.next('networkError', 0) }));
  assert.deepEqual(steps.map(step => step.action), ['startLoad', 'startLoad', 'startLoad', 'startLoad', 'giveUp']);
  assert.deepEqual(steps.slice(0, 4).map(step => step.delay), [1000, 2000, 4000, 8000]);
  recovery.progress(0);
  assert.equal(recovery.next('networkError', 0).action, 'startLoad');

  assert.equal(recovery.next('mediaError', 10000).action, 'recoverMedia');
  assert.equal(recovery.next('mediaError', 11000).action, 'swapAudioCodec');
  assert.equal(recovery.next('mediaError', 20000).action, 'recoverMedia');
  assert.equal(recovery.next('mediaError', 21000).action, 'giveUp');
  recovery.progress(60000);
  assert.equal(recovery.next('mediaError', 60000).action, 'recoverMedia');
  assert.equal(recovery.next('otherError').action, 'giveUp');

  const player = await read('js/player.js');
  assert.match(player, /if \(data\.fatal && playbackStarted\) \{\s*recoverMidPlayback\(hls, recovery, data\);/);
});

test('inline handlers survive quotes in titles and cannot be injected', async () => {
  const sandbox = { console, URL, window: {} };
  vm.createContext(sandbox);
  vm.runInContext(await read('js/config.js'), sandbox);
  const attr = sandbox.window.inlineJsArg(`Grey's Anatomy"); alert(1);//`);
  assert.ok(!/["'<>]/.test(attr));
  // What the browser hands to the handler after decoding the attribute.
  const decoded = attr.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  assert.equal(JSON.parse(decoded), `Grey's Anatomy"); alert(1);//`);

  const app = await read('js/app.js');
  assert.match(app, /playVideo\(\$\{inlineJsArg\(episode\)\}, \$\{inlineJsArg\(vodName\)\}/);
  assert.match(app, /detail-value">\$\{escapeHtmlAttr\(htmlToPlainText\(data\.videoInfo\.actor\)\)\}/);
  assert.doesNotMatch(app, /detail-value">\$\{data\.videoInfo\./);
  const ui = await read('js/ui.js');
  assert.match(ui, /playFromHistory\(\$\{inlineJsArg\(item\.url\)\}, \$\{inlineJsArg\(item\.title\)\}/);
});

test('search fetches at most 10 pages per source, 3 at a time, in page order', async () => {
  let active = 0;
  let peak = 0;
  const requested = [];
  const fetchStub = async url => {
    const target = decodeURIComponent(String(url).replace('/proxy/', ''));
    const page = Number(new URL(target).searchParams.get('pg') || 1);
    requested.push(page);
    active++;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
    return {
      ok: true,
      json: async () => ({ pagecount: 40, list: [{ vod_id: page, vod_name: `测试剧 ${page}` }] })
    };
  };
  const sandbox = { console, URL, window: {}, fetch: fetchStub, AbortController, setTimeout, clearTimeout };
  vm.createContext(sandbox);
  vm.runInContext(await read('js/config.js'), sandbox);
  vm.runInContext(await read('js/customer_site.js'), sandbox);
  vm.runInContext(await read('js/search.js'), sandbox);
  const results = await vm.runInContext('searchByAPIAndKeyWord("ysgc", "测试剧")', sandbox);
  assert.equal(requested.length, 10);
  assert.ok(peak <= 3, `peak concurrency ${peak}`);
  assert.deepEqual(results.map(item => item.vod_id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});
