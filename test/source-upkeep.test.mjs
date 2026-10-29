import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

async function load(path, name) {
  const sandbox = { window: {}, console, URL, document: { addEventListener() {} }, localStorage: { getItem: () => null, setItem() {} } };
  vm.runInNewContext(await read(path), sandbox);
  return sandbox.window[name];
}

const siteMap = {
  ysgc: { name: '影视工厂' }, ffzy: { name: '非凡影视' }, bfzy: { name: '暴风资源' }, wujin: { name: '无尽资源' },
  jszy: { name: '极速资源', family: 'jisu' }, huya: { name: '虎牙资源', family: 'jisu' }, guangsu: { name: '光速资源', family: 'jisu' },
  zuid: { name: '最大资源' }, ckzy: { name: 'CK', adult: true }
};
const days = statuses => statuses.map((status, i) => ({ day: `2026-10-${String(20 + i).padStart(2, '0')}`, status, latencyMs: 500 }));

test('probe results distinguish working, search-disabled and failing sources', async () => {
  const { classify } = (await load('js/source-autopilot.js', 'SourceAutopilot')).logic;
  assert.equal(classify({ list: [{ vod_play_url: '正片$https://cdn.example/a/index.m3u8' }] }).status, 'ok');
  assert.equal(classify({ msg: 'Current API forbids keyword search.', list: [] }).status, 'forbidden');
  assert.equal(classify({ msg: '暂不支持搜索' }).status, 'forbidden');
  // "Server busy" may pass; it counts as a failed day, not a switched-off search.
  assert.equal(classify({ msg: '服务器繁忙，请稍后搜索', list: [] }).status, 'failed');
  assert.equal(classify(null).status, 'failed');
  assert.equal(classify({ list: [{ vod_play_url: '正片$https://vv.example/play/abc' }] }).status, 'failed');
});

test('history keeps one entry per day and the last ten days', async () => {
  const { addEntry } = (await load('js/source-autopilot.js', 'SourceAutopilot')).logic;
  let history = {};
  history = addEntry(history, 'a', { day: '2026-10-01', status: 'failed' });
  history = addEntry(history, 'a', { day: '2026-10-01', status: 'ok' });
  assert.deepEqual(plain(history.a), [{ day: '2026-10-01', status: 'ok' }]);
  for (let i = 2; i <= 15; i++) history = addEntry(history, 'a', { day: `2026-10-${String(i).padStart(2, '0')}`, status: 'ok' });
  assert.equal(history.a.length, 10);
  assert.equal(history.a.at(-1).day, '2026-10-15');
});

test('a selected source is stopped only after repeated failures, and a healthy mirror takes over', async () => {
  const { decide } = (await load('js/source-autopilot.js', 'SourceAutopilot')).logic;
  const healthy = days(['ok', 'ok', 'ok']);
  const base = { ysgc: healthy, ffzy: healthy, bfzy: healthy, wujin: healthy, huya: healthy, guangsu: days(['failed']) };

  // Two bad days are not enough.
  let outcome = decide({ history: { ...base, jszy: days(['ok', 'failed', 'failed']) }, selected: ['ysgc', 'jszy'], siteMap });
  assert.deepEqual(plain(outcome.disable), []);

  outcome = decide({ history: { ...base, jszy: days(['failed', 'failed', 'failed']) }, selected: ['ysgc', 'jszy'], siteMap });
  assert.deepEqual(plain(outcome.disable), [{ id: 'jszy', reason: '连续 3 天无法搜索', replacement: 'huya' }]);
  assert.deepEqual(plain(outcome.enable), ['huya']);

  // A switched-off search is stopped after two days; no mirror family, no replacement.
  outcome = decide({ history: { ...base, wujin: days(['ok', 'forbidden', 'forbidden']) }, selected: ['ysgc', 'wujin'], siteMap });
  assert.deepEqual(plain(outcome.disable), [{ id: 'wujin', reason: '已关闭关键词搜索', replacement: '' }]);

  // Never leave zero searchable sources.
  outcome = decide({ history: { ysgc: days(['failed', 'failed', 'failed']) }, selected: ['ysgc'], siteMap });
  assert.deepEqual(plain(outcome.disable), []);
  outcome = decide({ history: { ysgc: days(['failed', 'failed', 'failed']) }, selected: ['ysgc', 'ckzy'], siteMap });
  assert.deepEqual(plain(outcome.disable), [], 'an adult source does not count as a searchable fallback');
});

test('suggestions are healthy, unselected, not mirrors of a selected source and respect dismissals', async () => {
  const { decide } = (await load('js/source-autopilot.js', 'SourceAutopilot')).logic;
  const now = Date.parse('2026-10-28T12:00:00Z');
  const history = {
    ysgc: days(['ok', 'ok']), jszy: days(['ok', 'ok']),
    ffzy: days(['ok', 'ok']), bfzy: days(['ok']), huya: days(['ok', 'ok']), zuid: days(['failed', 'ok', 'ok']), wujin: days(['ok', 'failed'])
  };
  let outcome = decide({ history, selected: ['ysgc', 'jszy'], siteMap, now });
  // bfzy has one healthy day only; huya mirrors the selected jszy; wujin failed last.
  assert.deepEqual(plain(outcome.suggestions).sort(), ['ffzy', 'zuid']);
  outcome = decide({ history, selected: ['ysgc', 'jszy'], siteMap, now, state: { dismissed: { ffzy: now - 1000 } } });
  assert.deepEqual(plain(outcome.suggestions), ['zuid']);
  outcome = decide({ history, selected: ['ysgc', 'jszy'], siteMap, now, state: { disabled: { zuid: { at: now - 1000 } } } });
  assert.deepEqual(plain(outcome.suggestions), ['ffzy']);
  assert.equal(decide({ history: { ckzy: days(['ok', 'ok']) }, selected: ['ysgc'], siteMap, now }).suggestions.length, 0, 'adult sources are never suggested');
});

test('health score prefers reliable, faster sources', async () => {
  const { healthScore } = (await load('js/source-autopilot.js', 'SourceAutopilot')).logic;
  const fast = [{ status: 'ok', latencyMs: 300 }, { status: 'ok', latencyMs: 300 }];
  const slow = [{ status: 'ok', latencyMs: 3500 }, { status: 'ok', latencyMs: 3500 }];
  const flaky = [{ status: 'failed' }, { status: 'ok', latencyMs: 300 }];
  assert.ok(healthScore({ fast }, 'fast') > healthScore({ slow }, 'slow'));
  assert.ok(healthScore({ slow }, 'slow') > healthScore({ flaky }, 'flaky'));
  assert.equal(healthScore({}, 'unknown'), 0);
});

test('OpenClash rules list API, CDN, image and Douban domains', async () => {
  const hosts = await load('js/source-hosts.js', 'SourceHosts');
  assert.equal(hosts.registrableDomain('v.lzcdn28.com'), 'lzcdn28.com');
  assert.equal(hosts.registrableDomain('img.example.com.cn'), 'example.com.cn');
  assert.equal(hosts.registrableDomain('192.168.1.2'), '');
  const rules = hosts.buildClashRules({
    siteMap: { a: { api: 'https://cj.lziapi.com/api.php/provide/vod' }, b: { api: 'https://jszyapi.com/api.php/provide/vod' }, x: { api: 'https://155api.com/api.php/provide/vod', adult: true } },
    customApis: [{ url: 'https://my.vod.example.com/api.php/provide/vod' }],
    learned: { 'cdn:lzcdn29.com': 1, 'image:lzipic.com': 1, 'cdn:my-site.pages.dev': 1 },
    ownHost: 'my-site.pages.dev'
  });
  const lines = rules.trim().split('\n');
  assert.equal(lines[0], '##LibreTV视频网站');
  assert.ok(lines.includes('- DOMAIN-SUFFIX,lziapi.com,DIRECT'));
  assert.ok(lines.includes('- DOMAIN-SUFFIX,example.com,DIRECT'), 'custom sources are included');
  assert.ok(lines.includes('- DOMAIN-SUFFIX,lzcdn29.com,DIRECT'), 'learned CDN domains are included');
  assert.ok(lines.includes('- DOMAIN-SUFFIX,lzcdn28.com,DIRECT'), 'seeded CDN domains are included');
  assert.ok(lines.includes('- DOMAIN-SUFFIX,doubanio.com,DIRECT'));
  assert.ok(!lines.some(line => line.includes('pages.dev')), 'the site itself is left to the user');
  assert.ok(lines.indexOf('##LibreTV成人资源站（不需要可删除）') > lines.indexOf('##LibreTV豆瓣推荐'));
  assert.equal(new Set(lines).size, lines.length, 'no duplicate rules');
  for (const line of lines) assert.match(line, /^(##.+|- DOMAIN-SUFFIX,[a-z0-9.-]+,DIRECT)$/);
});

test('learned hosts come from play lines, posters and played segments', async () => {
  const values = new Map();
  const sandbox = { window: {}, console, URL, document: { addEventListener() {} },
    localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } };
  vm.runInNewContext(await read('js/source-hosts.js'), sandbox);
  const hosts = sandbox.window.SourceHosts;
  hosts.learnItems([{ vod_play_url: '第1集$https://vv.jisuzyv.com/play/a$$$第1集$https://vv.jisuzyv.com/play/a/index.m3u8', vod_pic: 'https://img.jisuimage.com/a.jpg' }]);
  hosts.learnUrl('https://p.jisuts.com:999/hls/1/plist0.ts');
  assert.deepEqual(Object.keys(JSON.parse(values.get('sourceHostsV1'))).sort(), ['cdn:jisuts.com', 'cdn:jisuzyv.com', 'image:jisuimage.com']);
});

test('existing users lose removed sources and gain the new defaults once', async () => {
  const app = await read('js/app.js');
  assert.match(app, /const stillAvailable = selectedAPIs\.filter\(apiId => apiId\.startsWith\('custom_'\) \|\| API_SITES\[apiId\]\)/);
  const config = await read('js/config.js');
  assert.match(config, /DEFAULT_API_MIGRATION_VERSION = '20261028-sources-v3'/);
  const douban = await read('js/douban.js');
  assert.doesNotMatch(douban, /API_SITES\.dbzy/);
  const index = await read('index.html');
  for (const script of ['source-autopilot', 'source-hosts']) {
    assert.match(index, new RegExp(`<script src="js/${script}\\.js"></script>`));
    assert.match(await read('service-worker.js'), new RegExp(`'/js/${script}\\.js'`));
  }
  assert.match(index, /onclick="showClashRules\(\)"/);
  assert.match(index, /id="sourceAutopilotNotice"/);
});
