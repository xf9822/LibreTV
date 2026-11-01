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
