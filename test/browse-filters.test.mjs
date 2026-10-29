import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

async function load(path, name, extra = {}) {
  const sandbox = { window: {}, console, URL, URLSearchParams, ...extra };
  vm.runInNewContext(await read(path), sandbox);
  return sandbox.window[name];
}

const plain = value => JSON.parse(JSON.stringify(value));
const query = url => Object.fromEntries(new URL(url).searchParams);

test('douban filter builds combined recommend requests', async () => {
  const filter = await load('js/douban-filter.js', 'DoubanFilter');
  const movie = filter.normalizeFilter('movie', { region: '欧美', year: '2026', sort: 'S' }, new Date('2026-10-27'));
  const url = filter.buildRecommendUrl('movie', movie, 24);
  assert.match(url, /^https:\/\/m\.douban\.com\/rexxar\/api\/v2\/movie\/recommend\?/);
  const params = query(url);
  assert.deepEqual(JSON.parse(params.selected_categories), { 地区: '欧美' });
  assert.equal(params.tags, '欧美,2026');
  assert.equal(params.sort, 'S');
  assert.equal(params.start, '24');

  const tv = filter.normalizeFilter('tv', {}, new Date('2026-10-27'));
  assert.deepEqual(JSON.parse(query(filter.buildRecommendUrl('tv', tv)).selected_categories), { 形式: '电视剧' });
  assert.equal(query(filter.buildRecommendUrl('tv', tv)).tags, '电视剧');
  const scifi = filter.updateFilter('tv', tv, 'genre', '科幻');
  assert.deepEqual(JSON.parse(query(filter.buildRecommendUrl('tv', scifi)).selected_categories), { 类型: '科幻', 形式: '电视剧' });
  assert.equal(query(filter.buildRecommendUrl('tv', scifi)).tags, '科幻');
  // Variety shows have their own genres; switching the format drops the drama genre.
  assert.equal(filter.updateFilter('tv', scifi, 'format', '综艺').genre, '');
  assert.equal(filter.updateFilter('tv', { ...tv, genre: '真人秀', format: '综艺' }, 'region', '华语').genre, '真人秀');
});

test('douban filter options, validation and stored state', async () => {
  const filter = await load('js/douban-filter.js', 'DoubanFilter');
  const years = filter.yearOptions(new Date('2026-03-01'));
  assert.deepEqual(plain(years.slice(0, 8)), ['2026', '2025', '2024', '2023', '2022', '2021', '2020', '2020年代']);
  assert.equal(years.at(-1), '更早');
  assert.deepEqual(plain(filter.normalizeFilter('movie', { genre: '不存在', year: '1999', sort: 'X', region: '韩国' })),
    { genre: '', region: '韩国', year: '', sort: 'T' });
  const rows = filter.rows('tv', filter.defaultFilter('tv')).map(row => row.key);
  assert.deepEqual(plain(rows), ['format', 'genre', 'region', 'year', 'sort']);

  const store = new Map([['doubanFilterV1', '{broken']]);
  const storage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  const state = filter.readState(storage);
  assert.equal(state.open, false);
  assert.deepEqual(plain(state.movie), plain(filter.defaultFilter('movie')));
  filter.writeState({ ...state, open: true, movie: { ...state.movie, region: '欧美' } }, storage);
  assert.equal(filter.readState(storage).movie.region, '欧美');
  assert.equal(filter.readState(storage).open, true);
});

test('douban recommend items map to cards', async () => {
  const filter = await load('js/douban-filter.js', 'DoubanFilter');
  const page = filter.mapRecommend({
    total: 500,
    items: [
      { type: 'movie', id: '36', title: '狂乱：安魂曲', year: '2026', rating: { value: 9.25 }, pic: { normal: 'https://img9.doubanio.com/a.jpg' }, card_subtitle: '2026 / 美国 英国 / 纪录片 音乐 / 导演' },
      { type: 'tv', id: '37', title: '新剧', year: '2026', rating: { value: 0 }, pic: { large: 'https://img3.doubanio.com/b.jpg' }, card_subtitle: '2026 / 中国大陆 / 剧情' },
      { type: 'chart', id: '1', title: '榜单' }
    ]
  });
  assert.equal(page.total, 500);
  assert.equal(page.received, 3);
  assert.deepEqual(plain(page.subjects), [
    { id: '36', title: '狂乱：安魂曲', rate: '9.3', cover: 'https://img9.doubanio.com/a.jpg', url: 'https://movie.douban.com/subject/36/', year: '2026', meta: '2026 · 美国' },
    { id: '37', title: '新剧', rate: '', cover: 'https://img3.doubanio.com/b.jpg', url: 'https://movie.douban.com/subject/37/', year: '2026', meta: '2026 · 中国大陆' }
  ]);
  assert.equal(filter.describe('movie', { genre: '', region: '欧美', year: '2026', sort: 'S' }), '欧美 · 2026 · 高分优先');

  const html = await read('index.html');
  assert.ok(html.indexOf('js/douban-filter.js') < html.indexOf('js/douban.js'));
  assert.match(await read('service-worker.js'), /'\/js\/douban-filter\.js'/);
  const douban = await read('js/douban.js');
  assert.match(douban, /if \(isDoubanFilterMode\(\)\) \{\s*return loadDoubanFilterResults\(true\);/);
});

test('search results normalise kind, region and rating', async () => {
  const filter = await load('js/search-filter.js', 'SearchFilter');
  const kind = (type_name, extra = {}) => filter.kindOf({ type_name, ...extra });
  assert.equal(kind('国产动漫'), '动漫');
  assert.equal(kind('欧美剧'), '剧集');
  assert.equal(kind('科幻片'), '电影');
  assert.equal(kind('记录片'), '纪录片');
  assert.equal(kind('大陆综艺'), '综艺');
  assert.equal(kind('电影解说'), '其他');
  assert.equal(kind('预告片'), '其他');
  assert.equal(kind('爽文短剧'), '短剧');
  // Genre-only names fall back to the episode count.
  assert.equal(kind('古装仙侠', { vod_play_url: '第1集$https://a/1.m3u8#第2集$https://a/2.m3u8' }), '剧集');
  assert.equal(kind('冒险', { vod_play_url: '正片$https://a/1.m3u8' }), '电影');
  assert.equal(filter.regionOf({ vod_area: '美国 / 中国大陆 / 英国' }), '美国');
  assert.equal(filter.regionOf({ vod_area: '中国大陆' }), '大陆');
  assert.equal(filter.regionOf({ vod_area: '内地' }), '大陆');
  assert.equal(filter.regionOf({ vod_area: '其它' }), '其他');
  assert.equal(filter.ratingOf({ vod_score: '0.0', vod_douban_score: '8.9' }), 8.9);
  assert.equal(filter.ratingOf({ vod_score: '0.0', vod_douban_score: '0.0' }), 0);
});

test('search results filter and sort without losing their original index', async () => {
  const filter = await load('js/search-filter.js', 'SearchFilter');
  const item = (vod_name, type_name, vod_year, extra = {}) => ({ vod_name, type_name, vod_year, vod_area: '大陆', ...extra });
  const groups = [
    [item('三体·周年纪念版', '国产剧', '2024')],
    [item('我的三体第一季', '国产动漫', '2014', { vod_score: '9.4' })],
    [item('三体', '国产剧', '2023', { vod_douban_score: '6.8', vod_time: '2023-05-10 02:28:01' })],
    [item('三体 第一季', '欧美剧', '2024', { vod_area: '美国' }), item('三体 第一季', '欧美剧', '2024', { vod_area: '美国' })],
    [item('三体', '国产动漫', '2022', { vod_douban_score: '8.9', vod_time: '2025-01-01 00:00:00' })]
  ];
  const names = entries => entries.map(entry => `${entry.group[0].vod_name}@${entry.index}`);

  // Exact titles first, then shorter titles, then newer.
  assert.deepEqual(plain(names(filter.apply(groups, '三体'))),
    ['三体@2', '三体@4', '三体 第一季@3', '三体·周年纪念版@0', '我的三体第一季@1']);
  assert.deepEqual(plain(names(filter.apply(groups, '三体', { ...filter.defaultFilter(), kind: '剧集' }))),
    ['三体@2', '三体 第一季@3', '三体·周年纪念版@0']);
  assert.deepEqual(plain(names(filter.apply(groups, '三体', { ...filter.defaultFilter(), region: '美国' }))), ['三体 第一季@3']);
  assert.deepEqual(plain(names(filter.apply(groups, '三体', { ...filter.defaultFilter(), sort: 'rating' }))).slice(0, 3),
    ['我的三体第一季@1', '三体@4', '三体@2']);
  assert.deepEqual(plain(names(filter.apply(groups, '三体', { ...filter.defaultFilter(), sort: 'year' }))).slice(0, 2),
    ['三体 第一季@3', '三体·周年纪念版@0']);
  assert.equal(filter.apply(groups, '三体', { ...filter.defaultFilter(), sort: 'updated' })[0].index, 4);

  const options = plain(filter.options(groups));
  assert.deepEqual(options.kinds, [{ value: '剧集', count: 3 }, { value: '动漫', count: 2 }]);
  assert.deepEqual(options.years.map(year => year.value), ['2024', '2023', '2022', '2014']);
  assert.deepEqual(options.regions, [{ value: '大陆', count: 4 }, { value: '美国', count: 1 }]);
  assert.equal(options.hasRatings, true);

  const app = await read('js/app.js');
  // Cards keep pointing at currentSearchGroups by their original index.
  assert.match(app, /entries\.map\(\(\{ group, index: resultIndex, rating \}\)/);
  const html = await read('index.html');
  assert.ok(html.indexOf('js/search-filter.js') < html.indexOf('js/app.js'));
  assert.match(html, /id="searchFilterBar"/);
});

test('home page uses a compact sticky top bar with a recent-search dropdown', async () => {
  const html = await read('index.html');
  const topbar = html.slice(html.indexOf('<header class="lt-topbar">'), html.indexOf('</header>'));
  assert.match(topbar, /id="searchInput"/);
  assert.match(topbar, /id="recentSearches"/);
  assert.match(topbar, /onclick="toggleHistory\(event\)"/);
  assert.match(topbar, /onclick="toggleSettings\(event\)"/);
  assert.doesNotMatch(html, /lt-hero|lt-badge|lt-fab/);
  const css = await read('css/theme.css');
  assert.match(css, /\.lt-topbar \{\s*position: sticky;/);
  assert.match(css, /\.lt-search-wrap\.is-recent-open \.lt-recent:not\(:empty\)/);
  const ui = await read('js/ui.js');
  assert.match(ui, /function setupRecentSearchesDropdown\(\)/);
});
