import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

async function load() {
  const sandbox = { window: {}, console, URL, setTimeout };
  vm.runInNewContext(await read('js/danmaku.js'), sandbox);
  return sandbox.window.Danmaku;
}

const row = (titleTxt, year, cat_id, extra = {}) => ({ titleTxt, year, cat_id, ...extra });

test('the 360 row must be the same work: title, category and year', async () => {
  const { pickRow } = (await load()).logic;
  const qq = { playlinks: { qq: 'https://v.qq.com/x/cover/abc/x0001.html' } };
  const rows = [
    row('《封神第二部：战火西岐》“路演日志”西安站', '2025', '1', qq),
    row('封神第二部：战火西岐', '2025', '1', qq),
    row('狂飙古惑仔', '2000', '1', qq)
  ];
  assert.equal(pickRow(rows, { title: '封神第二部：战火西岐', year: '2025', kind: 'movie' }).titleTxt, '封神第二部：战火西岐');
  assert.equal(pickRow([row('狂飙', '2023', '2', qq), row('狂飙古惑仔', '2000', '1', qq)], { title: '狂飙', year: '2023', kind: 'movie' }), null, 'a series is not a film of the same name');
  assert.equal(pickRow([row('甄嬛传', '2011', '2', qq)], { title: '甄嬛传', year: '2023', kind: 'tv' }), null, 'a remake years apart is another work');
  // Sources often name a title slightly differently; containment needs the same year.
  assert.equal(pickRow([row('后宫甄嬛传', '2011', '2', qq)], { title: '甄嬛传', year: '2011', kind: 'tv' }).titleTxt, '后宫甄嬛传');
  assert.equal(pickRow([row('后宫甄嬛传', '2011', '2', qq)], { title: '甄嬛传', year: '', kind: 'tv' }), null);
});

test('episodes map to the platform page of the same episode; films try platforms in order', async () => {
  const { sourceFor, sourcesFor, parseSourceUrl } = (await load()).logic;
  const series = row('漫长的季节', '2023', '2', { seriesPlaylinks: [
    { url: 'https://v.qq.com/x/cover/mzc00200fhhxx8d/v0046des2cr.html?traceid=1' },
    { url: 'https://v.qq.com/x/cover/mzc00200fhhxx8d/h0046hdkvvt.html' }
  ] });
  assert.deepEqual(plain(sourceFor(series, 1)), { site: 'qq', vid: 'h0046hdkvvt' });
  assert.equal(sourceFor(series, 5), null, 'no page for an episode the platform does not list');
  const film = row('乘风破浪', '2017', '1', { playlinks: {
    youku: 'https://v.youku.com/video?vid=XMjY3', imgo: 'http://www.mgtv.com/b/309903/3882817.html?cxid=1',
    qiyi: 'http://www.iqiyi.com/v_19rrkq5so0.html?vfm=1', qq: 'https://v.qq.com/x/cover/pt7vl0gqxlnqaev/b0030bvoail.html'
  } });
  assert.deepEqual(plain(sourcesFor(film, 0)), [
    { site: 'qq', vid: 'b0030bvoail' }, { site: 'qiyi', id: '19rrkq5so0' }, { site: 'imgo', cid: '309903', vid: '3882817' }
  ], 'Youku is not used');
  assert.equal(parseSourceUrl('https://v.qq.com/x/page/k3341ab12cd.html').vid, 'k3341ab12cd');
  assert.equal(parseSourceUrl('https://www.bilibili.com/bangumi/play/ep1'), null);
});

test('busy seconds keep the most liked comments, without long or repeated ones', async () => {
  const { thin } = await load();
  const many = Array.from({ length: 30 }, (_, i) => ({ text: `第${i}条`, time: 10.2, likes: i }));
  const out = plain(thin([...many, { text: '长'.repeat(41), time: 11, likes: 999 }, { text: '哈哈', time: 12 }, { text: '哈 哈', time: 15 }, { text: '哈哈', time: 30 }], 2));
  assert.deepEqual(out.map(x => x.text), ['第29条', '第28条', '哈哈', '哈哈']);
  assert.ok(out.every(x => x.mode === 0));
  assert.equal(thin([{ text: 'x', time: -1 }, { text: '', time: 2 }, { text: 'y', time: NaN }], 4).length, 0);
});

test('platform comment formats are read correctly', async () => {
  const { parseIqiyiXml, color, nearestFirst } = (await load()).logic;
  const xml = '<danmu><data><entry><list><bulletInfo><contentId>1</contentId><content>徐忠：我是&lt;京州&gt;市委书记</content><showTime>301</showTime><color>ff0000</color><likeCount>5</likeCount></bulletInfo><bulletInfo><content>好剧</content><showTime>302</showTime><color>ffffff</color></bulletInfo></list></entry></data></danmu>';
  assert.deepEqual(plain(parseIqiyiXml(xml)), [
    { text: '徐忠：我是<京州>市委书记', time: 301, color: '#ff0000', likes: 5 },
    { text: '好剧', time: 302, likes: 0 }
  ]);
  assert.equal(color('FFFFFF'), undefined, 'white uses the default colour');
  assert.equal(color('zz'), undefined);
  // Segments near the playback position are fetched first.
  assert.deepEqual(Array.from(nearestFirst([0, 30, 60, 90, 120], 70)), [2, 3, 1, 4, 0]);
});

test('the player offers 弹幕 in its settings, toggles with D and loads per episode', async () => {
  const player = await read('js/player.js');
  assert.match(player, /name: 'danmaku',\s+html: '弹幕'/);
  assert.match(player, /art\.on\('video:loadedmetadata', function\(\) \{\s+skipState\.ready = true;\s+loadDanmakuForCurrentEpisode\(\);/);
  assert.match(player, /emitter: false/);
  // load(list) appends in the plugin: updates must add only what is not queued yet.
  assert.match(player, /danmakuState\.queued\.has\(id\)/);
  const enhancements = await read('js/player-enhancements.js');
  assert.match(enhancements, /case 'd': return \{ type: 'danmaku' \};/);
  assert.match(enhancements, /\['D', '弹幕开 \/ 关'\]/);
  const html = await read('player.html');
  assert.ok(html.indexOf('libs/artplayer-plugin-danmuku.js') < html.indexOf('js/player.js"'));
  assert.ok(html.indexOf('js/danmaku.js') < html.indexOf('js/player.js"'));
  const sw = await read('service-worker.js');
  assert.match(sw, /'\/js\/danmaku\.js'/);
  assert.match(sw, /'\/libs\/artplayer-plugin-danmuku\.js'/);
  assert.match(await read('libs/artplayer-plugin-danmuku.js'), /artplayer-plugin-danmuku\.js v5\.3\.0[\s\S]*MIT License/);
  // Other sites' /api/ paths (iQiyi's id decoder) are not taken for this site's API.
  assert.match(await read('js/api.js'), /requestUrl\.origin === window\.location\.origin && requestUrl\.pathname\.startsWith\('\/api\/'\)/);
});

test('danmaku text decodes HTML entities and turns platform emote codes into emoji', async () => {
  const { readFile } = await import('node:fs/promises');
  const vm = await import('node:vm');
  const sandbox = { window: {}, document: {} };
  vm.runInNewContext(await readFile(new URL('../js/danmaku.js', import.meta.url), 'utf8'), sandbox);
  const { cleanText, thin } = sandbox.window.Danmaku.logic;
  assert.equal(cleanText('我的&#128014;哦'), '我的🐎哦');
  assert.equal(cleanText('&#x1F600; A &amp; B'), '😀 A & B');
  assert.equal(cleanText('灵魂战士？[呆住]变身'), '灵魂战士？😳变身');
  assert.equal(cleanText('来了[马年大吉]'), '来了🐴🧧');
  assert.equal(cleanText('牡丹江[打卡-打][打卡-卡]'), '牡丹江✅', 'a two-part emote shows once');
  assert.equal(cleanText('[未知表情]好'), '好', 'unknown emote codes are dropped');
  assert.equal(cleanText('数组[0]和[ok]'), '数组[0]和[ok]', 'plain brackets stay');
  // A comment that was only an unknown emote is not shown at all.
  assert.equal(thin([{ text: '[未知表情]', time: 1 }, { text: '好看[狗头]', time: 2 }], 4).map(item => item.text).join('|'), '好看🐶');
});

test('variety episodes are matched by air date, issue, part and edition, not by position', async () => {
  const { readFile } = await import('node:fs/promises');
  const vm = await import('node:vm');
  const sandbox = { window: {}, document: {} };
  vm.runInNewContext(await readFile(new URL('../js/danmaku.js', import.meta.url), 'utf8'), sandbox);
  const { episodeFeatures, matchEpisode } = sandbox.window.Danmaku.logic;
  assert.equal(JSON.stringify(episodeFeatures('20261029 第3期（上）')), JSON.stringify({ date: '20261029', issue: 3, part: '上', seq: 0, kind: 'main' }));
  assert.equal(episodeFeatures('第20261023期抢鲜').kind, 'preview');
  assert.equal(episodeFeatures('20261030加更版第2期').kind, 'plus');
  assert.equal(episodeFeatures('20261022-02').seq, 2);

  const ep = (name, date, order, seconds = 0) => ({ name, order, seconds, features: { ...episodeFeatures(name), date } });
  const list = [
    ep('第1期', '20261022', 0, 6835), ep('第2期', '20261022', 1, 7446), ep('加更版第1期', '20261023', 2), ep('抢鲜版第1期', '20261023', 3),
    ep('第3期上', '20261029', 4, 4468), ep('第3期下', '20261029', 5, 5372), ep('加更版第2期', '20261030', 6)
  ];
  const pick = (name, duration) => matchEpisode(name, list, duration)?.name || null;
  assert.equal(pick('20261029上'), '第3期上');
  assert.equal(pick('第3期下'), '第3期下');
  assert.equal(pick('20261022-02'), '第2期');
  assert.equal(pick('第20261022期下'), '第2期', '上 / 下 on a day with two plain episodes');
  assert.equal(pick('第20261023期加更'), '加更版第1期');
  assert.equal(pick('第20261023期抢鲜'), '抢鲜版第1期');
  assert.equal(pick('20261030加更版'), '加更版第2期');
  assert.equal(pick('第20261029期', 89 * 60), '第3期下', 'ambiguous day: closest duration');
  assert.equal(pick('抢鲜版'), null, 'no date or number: no guess');
  assert.equal(pick('20261112上'), null, 'a day the platform does not have');
});

test('ad breaks a collection site spliced into the video are found from the platform runtime', async () => {
  const { adBreaks, videoTime } = (await load()).logic;
  // 后会友期 第5期上 on one site: three ~20 s ads named like the episode's own files; 芒果's runtime is 68:16.
  const blocks = [
    { start: 0, duration: 357.2 }, { start: 357.2, duration: 19.6 }, { start: 376.9, duration: 1319.8 },
    { start: 1696.7, duration: 17.4 }, { start: 1714.0, duration: 1920.7 }, { start: 3634.7, duration: 19.6 },
    { start: 3654.4, duration: 497.0 }
  ];
  const breaks = plain(adBreaks(blocks, 68 * 60 + 16));
  assert.deepEqual(breaks.map(ad => ad.start), [357.2, 1696.7, 3634.7]);
  assert.equal(videoTime(100, breaks), 100, 'before the first ad nothing moves');
  assert.ok(Math.abs(videoTime(400, breaks) - 419.6) < 0.01, 'after one ad a comment moves by its length');
  assert.ok(Math.abs(videoTime(3000, breaks) - 3037) < 0.01, 'after two ads by both');
  // Ads already removed by the filter, or a video as long as the platform's: nothing to skip.
  assert.deepEqual(plain(adBreaks([{ start: 0, duration: 300.8 }, { start: 300.8, duration: 2100.2 }, { start: 2401, duration: 1695 }], 4096)), []);
  // No short blocks that add up to the difference (another cut of the show): no guess.
  assert.deepEqual(plain(adBreaks([{ start: 0, duration: 2000 }, { start: 2000, duration: 2300 }], 4096)), []);
  assert.deepEqual(plain(adBreaks(blocks, 0)), [], 'unknown platform runtime');
});

async function loadPanel() {
  const sandbox = { window: {}, console, localStorage: { getItem: () => null, setItem() {} } };
  vm.runInNewContext(await read('js/danmaku-panel.js'), sandbox);
  return sandbox.window.DanmakuPanel;
}

test('danmaku style choices become plugin options sized to the player', async () => {
  const { pluginOptions, normalizeStyle, sliderRatio, DEFAULTS } = (await loadPanel()).logic;
  const defaults = plain(pluginOptions(DEFAULTS, { height: 600 }));
  assert.deepEqual(defaults, { fontSize: 24, margin: [10, '50%'], opacity: 0.9, speed: 7 }, 'half the screen by default');
  const oneRow = pluginOptions({ ...DEFAULTS, rows: 0 }, { height: 600 });
  assert.equal(oneRow.margin[1], 600 - 10 - (Math.ceil(24 * 1.3) + 2), 'one row leaves room for a single line');
  assert.equal(pluginOptions({ ...DEFAULTS, rows: 7 }, { height: 600 }).margin[1], '3%', 'full screen keeps a sliver above the controls');
  assert.equal(pluginOptions({ ...DEFAULTS, size: 4 }, { mobile: true, fullscreen: true }).fontSize, Math.round(18 * 1.3));
  assert.equal(pluginOptions(DEFAULTS, { mobile: true }).fontSize, 14, 'the small phone player keeps small text');
  assert.deepEqual(plain(normalizeStyle({ rows: 99, opacity: -3, speed: 'x', colorful: false })), { ...DEFAULTS, rows: 7, opacity: 0, colorful: false });
  const rect = { left: 100, right: 140, top: 200, bottom: 340, width: 40, height: 140 };
  assert.equal(sliderRatio(120, 340, rect, false), 0, 'bottom of the bar');
  assert.equal(sliderRatio(120, 200, rect, false), 1, 'top of the bar');
  // Rotated player: the bar's bottom is on the screen's left.
  const turned = { left: 100, right: 240, top: 200, bottom: 240, width: 140, height: 40 };
  assert.equal(sliderRatio(100, 220, turned, true), 0);
  assert.equal(sliderRatio(240, 220, turned, true), 1);
});
