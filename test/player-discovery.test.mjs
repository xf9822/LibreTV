import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: key => (values.has(key) ? values.get(key) : null), setItem: (key, value) => values.set(key, String(value)), values };
}

async function loadAvailability({ responses = {}, storage = memoryStorage({ selectedAPIs: JSON.stringify(['a', 'b']) }) } = {}) {
  const calls = [];
  const sandbox = {
    console, URL, setTimeout, localStorage: storage,
    API_CONFIG: { search: { path: '?wd=' } },
    window: {
      DEFAULT_SELECTED_APIS: ['a', 'b'],
      API_SITES: { a: { api: 'https://a.example' }, b: { api: 'https://b.example' } },
      getApiSearchContext: id => ({ apiBaseUrl: `https://${id}.example` }),
      fetchVodApiJson: async url => {
        calls.push(url);
        const host = new URL(url).hostname.split('.')[0];
        const answer = responses[host];
        if (answer instanceof Error) throw answer;
        return answer ?? { list: [] };
      }
    }
  };
  sandbox.window.localStorage = storage;
  vm.runInNewContext(await read('js/source-availability.js'), sandbox);
  return { api: sandbox.window.SourceAvailability, calls, storage };
}

const m3u8 = n => Array.from({ length: n }, (_, i) => `第${i + 1}集$https://cdn.example/${i}/index.m3u8`).join('#');

test('a Douban title counts as available only for a matching playable copy', async () => {
  const { api } = await loadAvailability();
  const film = { title: '隔山有眼3：起源', year: '2026', kind: 'movie' };
  assert.equal(api.isPlayableMatch({ vod_name: '隔山有眼3:起源', vod_year: '2026', type_name: '恐怖片', vod_play_url: m3u8(1) }, film), true);
  // A neighbouring release year is the same film (festival vs. theatrical release).
  assert.equal(api.isPlayableMatch({ vod_name: '旷野', vod_year: '2025', type_name: '剧情片', vod_play_url: m3u8(1) }, { title: '旷野', year: '2026', kind: 'movie' }), true);
  assert.equal(api.isPlayableMatch({ vod_name: '一九八四', vod_year: '1956', type_name: '科幻片', vod_play_url: m3u8(1) }, { title: '一九八四', year: '2026', kind: 'movie' }), false);
  // A 60-episode short drama with the same name is not the film.
  assert.equal(api.isPlayableMatch({ vod_name: '旷野', vod_year: '2026', type_name: '现代都市', vod_play_url: m3u8(60) }, { title: '旷野', year: '2026', kind: 'movie' }), false);
  assert.equal(api.isPlayableMatch({ vod_name: '旷野', vod_year: '2026', type_name: '短剧', vod_play_url: m3u8(1) }, { title: '旷野', year: '2026', kind: 'movie' }), false);
  assert.equal(api.isPlayableMatch({ vod_name: '某剧', vod_year: '2026', type_name: '剧情片', vod_play_url: m3u8(1) }, { title: '某剧', kind: 'tv' }), false);
  assert.equal(api.isPlayableMatch({ vod_name: '某剧', vod_year: '2026', type_name: '国产剧', vod_play_url: m3u8(30) }, { title: '某剧', kind: 'tv' }), true);
  // Web-page links in the first line, m3u8 in the second.
  const twoLines = '正片$https://vv.example/play/abc$$$正片$https://vv.example/play/abc/index.m3u8';
  assert.equal(api.isPlayableMatch({ vod_name: '它渴求梦魇', vod_year: '2026', type_name: '恐怖片', vod_play_url: twoLines }, { title: '它渴求梦魇', year: '2026', kind: 'movie' }), true);
  assert.equal(api.isPlayableMatch({ vod_name: '它渴求梦魇', vod_year: '2026', type_name: '恐怖片', vod_play_url: '正片$https://vv.example/play/abc' }, { title: '它渴求梦魇', kind: 'movie' }), false);
  assert.equal(api.isPlayableMatch({ vod_name: '三体', type_name: '电影解说', vod_play_url: m3u8(1) }, { title: '三体', kind: 'movie' }), false);
});

test('availability checks stop at the first source that has it and are cached', async () => {
  const found = { list: [{ vod_name: '复仇深潜', vod_year: '2026', type_name: '动作片', vod_play_url: m3u8(1) }] };
  const { api, calls } = await loadAvailability({ responses: { a: found } });
  assert.equal(await api.check({ title: '复仇深潜', year: '2026', kind: 'movie' }), true);
  assert.equal(calls.length, 1);
  assert.equal(await api.check({ title: '复仇深潜', year: '2026', kind: 'movie' }), true);
  assert.equal(calls.length, 1, 'second check is served from the cache');

  assert.equal(await api.check({ title: '一九八四', year: '2026', kind: 'movie' }), false);
  assert.equal(calls.length, 3, 'a missing title asks every selected source');

  const down = await loadAvailability({ responses: { a: new Error('down'), b: new Error('down') } });
  assert.equal(await down.api.check({ title: '某片', kind: 'movie' }), null, 'unknown when no source answered');
  assert.equal(down.storage.values.has('sourceAvailabilityV1'), false, 'unknown results are not cached');

  // The playable copy's cover is kept for titles Douban has no poster for yet.
  const withCover = await loadAvailability({ responses: { a: { list: [{ ...found.list[0], vod_name: '新片', vod_pic: 'https://img.example/new.jpg' }] } } });
  assert.equal(await withCover.api.check({ title: '新片', year: '2026', kind: 'movie' }), true);
  assert.equal(withCover.api.coverOf({ title: '新片', year: '2026', kind: 'movie' }), 'https://img.example/new.jpg');
  assert.equal(withCover.api.coverOf({ title: '别的片', kind: 'movie' }), '');

  const skipped = await loadAvailability();
  assert.equal(await skipped.api.check({ title: '某片', kind: 'movie', isWanted: () => false }), null);
  assert.equal(skipped.calls.length, 0, 'cards that are gone are not searched');
});

test('player discovery shows Douban data and hides unverified ratings', async () => {
  const sandbox = { window: {}, console, URL };
  vm.runInNewContext(await read('js/player-recommendations.js'), sandbox);
  const { doubanId, doubanScore } = sandbox.window.PlayerRecommendations.logic;
  assert.equal(doubanId({ vod_douban_id: 25853071 }), 25853071);
  assert.equal(doubanId({ vod_douban_id: 0 }), 0);
  assert.equal(doubanScore({ vod_douban_id: 25853071, vod_douban_score: '7.9' }), 7.9);
  // A source's own score without a Douban entry is not shown.
  assert.equal(doubanScore({ vod_douban_id: 0, vod_douban_score: '0.0', vod_score: '10.0' }), 0);
  assert.equal(doubanScore({ doubanId: 1, doubanScore: '8.1' }), 8.1);

  const api = await read('js/api.js');
  assert.match(api, /doubanId: Number\(videoDetail\.vod_douban_id\) > 0/);
  const recommendations = await read('js/player-recommendations.js');
  assert.match(recommendations, /rexxar\/api\/v2\/\$\{type\}\/\$\{id\}/);
  assert.match(recommendations, /SourceAvailability\.check/);
});

test('player page header, layout and error overlay', async () => {
  const html = await read('player.html');
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
  assert.match(header, /class="lt-brand-mark"/);
  assert.match(header, /onsubmit="return submitPlayerSearch\(event\)"/);
  assert.match(header, /id="goBack"/);
  assert.ok(html.indexOf('js/source-availability.js') < html.indexOf('js/player-recommendations.js'));
  const css = await read('css/player.css');
  assert.match(css, /#playerContainer:has\(#error\[style\*="display: flex"\]\) \.art-loading/);
  assert.match(css, /\.player-stage\.has-side-episodes ~ #resourceInfoBarContainer #quickEpisodesButton \{ display: none; \}/);
  // The compact mobile error rules must come after the base rules to take effect.
  assert.ok(css.indexOf('.error-icon { font-size: 26px') > css.indexOf('.error-icon {\n    font-size: 48px'));
  const player = await read('js/player.js');
  assert.match(player, /window\.location\.href = `\/\?s=\$\{encodeURIComponent\(query\)\}`/);
  const index = await read('index.html');
  assert.match(index, /<script src="js\/source-availability\.js"><\/script>/);
  assert.match(await read('service-worker.js'), /'\/js\/source-availability\.js'/);
});

async function loadRecommendations() {
  const sandbox = { window: {}, console, URL };
  for (const file of ['js/experience.js', 'js/douban-filter.js', 'js/player-recommendations.js']) vm.runInNewContext(await read(file), sandbox);
  return sandbox.window.PlayerRecommendations.logic;
}

test('similar titles come from Douban "people who liked this also liked", in Douban order', async () => {
  const { relatedList } = await loadRecommendations();
  const subject = (id, title, type = 'tv', year = '2024') => ({ id: String(id), title, type, year, card_subtitle: `${year} / 中国大陆 / 剧情`, rating: { value: 8.5 }, pic: { large: `https://img.doubanio.com/${id}.jpg` } });
  const list = relatedList([
    subject(1, '漫长的季节', 'tv', '2023'), subject(2, '繁花'), subject(3, '繁花第二季'), subject(1, '漫长的季节', 'tv', '2023'),
    subject(4, '我的阿勒泰'), { id: '5', title: '某书', type: 'book' }, subject(6, '封神第一部：朝歌风云', 'movie', '2023'), subject(7, '凡人歌')
  ], { title: '繁花', kind: 'tv', doubanId: 2 });
  assert.deepEqual(list.map(item => item.vod_name), ['漫长的季节', '我的阿勒泰', '封神第一部：朝歌风云', '凡人歌']);
  assert.equal(list[0].vod_douban_id, '1');
  assert.equal(list[0].vod_douban_score, 8.5);
  assert.equal(list[0].vod_year, '2023');
  // A recommended film keeps its own kind, so playing it searches for a film.
  assert.equal(list[2].kind, 'movie');
  assert.ok(list.length <= 16);
});

test('without a Douban ID, the fallback uses the same genre and region', async () => {
  const { fallbackFilter } = await loadRecommendations();
  assert.deepEqual(JSON.parse(JSON.stringify(fallbackFilter({ className: '剧情,犯罪', type: '国产剧', area: '大陆' }, 'tv'))), { genre: '剧情', region: '中国大陆' });
  assert.deepEqual(JSON.parse(JSON.stringify(fallbackFilter({ className: '', type: '动作片', area: '中国香港' }, 'movie'))), { genre: '动作', region: '香港' });
  assert.deepEqual(JSON.parse(JSON.stringify(fallbackFilter({ className: '科幻', type: '欧美剧', area: '' }, 'tv'))), { genre: '科幻', region: '欧美' });
  assert.deepEqual(JSON.parse(JSON.stringify(fallbackFilter({ type: '韩剧' }, 'tv'))), { genre: '', region: '韩国' });
  assert.deepEqual(JSON.parse(JSON.stringify(fallbackFilter({ type: '电影', area: '火星' }, 'movie'))), { genre: '', region: '' });

  const code = await read('js/player-recommendations.js');
  assert.match(code, /rexxar\/api\/v2\/\$\{type\}\/\$\{id\}\/recommendations/);
  assert.doesNotMatch(code, /search_subjects/, 'the broad popularity list is gone');
  const html = await read('player.html');
  assert.ok(html.indexOf('js/douban-filter.js') < html.indexOf('js/player-recommendations.js'));
  assert.match(html, /<b id="relatedTitle">相似推荐<\/b> <span id="relatedNote">看过的人也喜欢<\/span>/);
});

test('Douban cards replace the generic no-poster picture and say when a title has no rating yet', async () => {
  const douban = await read('js/douban.js');
  const isDefault = new Function(`${douban.match(/function isDoubanDefaultPoster[\s\S]*?\n}/)[0]}; return isDoubanDefaultPoster;`)();
  assert.equal(isDefault('https://img3.doubanio.com/f/frodo/18c01f9a/pics/subject/movie_normal.png'), true);
  assert.equal(isDefault('https://img9.doubanio.com/view/photo/s_ratio_poster/public/p2934585536.jpg'), false);
  assert.match(douban, /SourceAvailability\.coverOf\(request\)/);
  assert.match(douban, /douban-unrated-badge[^>]*>暂无评分</);
  assert.match(await read('js/player-recommendations.js'), /SourceAvailability\.coverOf\(request\)/);
});

test('phone fullscreen has one progress bar: 更多 opens the settings instead of a second control bar', async () => {
  const layer = await read('js/mobile-fullscreen.js');
  assert.doesNotMatch(layer, /mobile-fullscreen-native-controls/);
  assert.match(layer, /setTimeout\(\(\) => \{ art\.setting\.show = open; \}, 0\)/);
  assert.match(layer, /\.art-setting, \.art-settings, \.player-top-actions/, 'gestures stay off the settings panel');
  const css = await read('css/player.css');
  assert.doesNotMatch(css, /native-controls/);
  assert.match(css, /\.art-video-player\.mobile-fullscreen-interaction \.art-controls,\n\.art-video-player\.mobile-fullscreen-interaction \.art-bottom,/);
  assert.match(css, /\.art-video-player\.mobile-fullscreen-interaction \.art-settings \{/);
  // A phone held sideways keeps the whole player, controls included, on screen.
  assert.match(css, /@media \(orientation: landscape\) and \(max-height: 520px\) \{[\s\S]*?max-width: calc\(\(100dvh - 104px\) \* 16 \/ 9\)/);
  const player = await read('js/player.js');
  assert.match(player, /if \(art\.setting\?\.show\) \{ art\.setting\.show = false; return; \}/);
});
