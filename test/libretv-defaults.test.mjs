import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const rootDir = path.resolve(import.meta.dirname, '..');

async function readProjectFile(relativePath) {
  return readFile(path.join(rootDir, relativePath), 'utf8');
}

async function loadBrowserConfig() {
  const sandbox = {
    console,
    URL,
    window: {}
  };
  vm.createContext(sandbox);
  vm.runInContext(await readProjectFile('js/config.js'), sandbox);
  vm.runInContext(await readProjectFile('js/customer_site.js'), sandbox);
  return sandbox.window;
}

async function loadVersionChecker(fetchImpl) {
  const sandbox = {
    AbortController,
    clearTimeout,
    console: { log() {}, warn() {}, error() {} },
    document: {
      createElement: () => ({}),
      head: { appendChild() {} },
      addEventListener() {}
    },
    fetch: fetchImpl,
    setTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(await readProjectFile('js/version-check.js'), sandbox);
  return sandbox;
}

function createElementStub(tagName = 'div') {
  return {
    tagName,
    children: [],
    className: '',
    innerHTML: '',
    textContent: '',
    onclick: null,
    dataset: {},
    style: {},
    classList: {
      add() {},
      remove() {},
      contains() {
        return false;
      }
    },
    appendChild(child) {
      if (child?.isFragment) {
        this.children.push(...child.children);
      } else {
        this.children.push(child);
      }
      return child;
    },
    insertAdjacentHTML(_position, html) {
      this.innerHTML += html;
    },
    querySelector() {
      return null;
    },
    addEventListener() {},
    querySelectorAll() { return []; },
    remove() {}
  };
}

test('verified customer API sources are available and invalid placeholders are removed', async () => {
  const window = await loadBrowserConfig();

  assert.equal(window.API_SITES.ysgc.name, '影视工厂');
  assert.equal(window.API_SITES.ysgc.api, 'https://cj.lziapi.com/api.php/provide/vod');
  assert.equal(window.API_SITES.jszy.api, 'https://jszyapi.com/api.php/provide/vod');
  assert.equal(window.API_SITES.wujin.api, 'https://api.wujinapi.com/api.php/provide/vod');
  assert.equal(window.API_SITES.maoyan.api, 'https://api.maoyanapi.top/api.php/provide/vod');
  assert.equal(window.API_SITES.rycj.api, 'https://cj.rycjapi.com/api.php/provide/vod');
  assert.equal(window.API_SITES.huya.api, 'https://www.huyaapi.com/api.php/provide/vod');
  assert.equal(window.API_SITES.mdzy.api, 'https://www.mdzyapi.com/api.php/provide/vod');
  assert.equal(window.API_SITES.zuid.api, 'https://api.zuidapi.com/api.php/provide/vod');
  assert.equal(window.API_SITES.baidu.api, 'https://api.apibdzy.com/api.php/provide/vod');
  assert.equal(window.API_SITES.ikun.api, 'https://ikunzyapi.com/api.php/provide/vod');
  assert.equal(window.API_SITES.guangsu.api, 'https://api.guangsuapi.com/api.php/provide/vod');
  assert.equal(window.API_SITES.jinying.api, 'https://jinyingzy.com/api.php/provide/vod');
  assert.equal(window.API_SITES.hongniu.api, 'https://www.hongniuzy2.com/api.php/provide/vod');
  assert.equal(window.API_SITES.hhzy.api, 'https://hhzyapi.com/api.php/provide/vod');
  assert.equal(window.API_SITES.uku.api, 'https://api.ukuapi88.com/api.php/provide/vod');
  assert.equal(window.API_SITES.ckzy.adult, true);
  assert.equal(window.API_SITES.ckzy.api, 'https://www.ckzy1.com/api.php/provide/vod');
  assert.equal(window.API_SITES.jkun.adult, true);
  assert.equal(window.API_SITES.jkun.api, 'https://jkunzyapi.com/api.php/provide/vod');
  assert.equal(window.API_SITES.bwzy.adult, true);
  assert.equal(window.API_SITES.bwzy.api, 'https://api.bwzyz.com/api.php/provide/vod');
  assert.equal(window.API_SITES.r155.adult, true);
  assert.equal(window.API_SITES.r155.api, 'https://155api.com/api.php/provide/vod');
  assert.equal(window.API_SITES.huangcang.adult, true);
  assert.equal(window.API_SITES.huangcang.api, 'https://hsckzy.vip/api.php/provide/vod');
  assert.equal(window.API_SITES.yutu.adult, true);
  assert.equal(window.API_SITES.yutu.api, 'https://yutuzy10.com/api.php/provide/vod');
  assert.equal(window.API_SITES.siwa.adult, true);
  assert.equal(window.API_SITES.siwa.api, 'https://siwazyw.tv/api.php/provide/vod');
  assert.equal(window.API_SITES.qiqi, undefined);
  assert.equal(window.API_SITES.testSource, undefined);
  // 2026-10: these no longer answer keyword searches (anti-bot page, Cloudflare challenge, "forbids keyword search", "server busy").
  for (const removed of ['wolong', 'p2100', 'dbzy', 'xinlang']) assert.equal(window.API_SITES[removed], undefined, removed);
  assert.equal(window.API_SITES.ffzy.api, 'https://api.ffzyapi.com/api.php/provide/vod');
  assert.equal(window.API_SITES.bfzy.api, 'https://bfzyapi.com/api.php/provide/vod');
  assert.equal(window.API_SITES.zy360.api, 'https://360zy.com/api.php/provide/vod');
  // Mirrors of one network share a family so the settings can say "pick one".
  const jisu = Object.keys(window.API_SITES).filter(key => window.API_SITES[key].family === 'jisu');
  assert.deepEqual(jisu, ['jszy', 'huya', 'guangsu', 'jinying', 'hongniu', 'hhzy']);
  assert.deepEqual(Array.from(window.DEFAULT_SELECTED_APIS), ['ysgc', 'ffzy', 'bfzy', 'jszy', 'wujin']);
  assert.equal(window.DEFAULT_SELECTED_APIS.filter(key => window.API_SITES[key].family === 'jisu').length, 1);
});

test('Docker image supports optional outbound proxy without changing default startup', async () => {
  const dockerfile = await readProjectFile('Dockerfile');
  const entrypoint = await readProjectFile('docker-entrypoint.sh');

  assert.match(dockerfile, /ENV PROXY_URL=/);
  assert.match(dockerfile, /apk add --no-cache proxychains-ng/);
  assert.match(dockerfile, /CMD \["sh", "docker-entrypoint\.sh"\]/);
  assert.match(entrypoint, /PROXY_URL/);
  assert.match(entrypoint, /proxychains4 -q -f "\$conf" node server\.mjs/);
  assert.match(entrypoint, /exec node server\.mjs/);
});

test('image helpers normalize common cover URL formats', async () => {
  const window = await loadBrowserConfig();

  assert.equal(typeof window.normalizeImageUrl, 'function');
  assert.equal(typeof window.getCustomApiInfo, 'function');
  assert.equal(
    window.normalizeImageUrl('//img.example.test/poster.jpg'),
    'https://img.example.test/poster.jpg'
  );
  assert.equal(
    window.normalizeImageUrl('/upload/poster.webp', 'https://cj.lziapi.com/api.php/provide/vod'),
    'https://cj.lziapi.com/upload/poster.webp'
  );
});

test('movie card images avoid hotlink referrers while the player switcher uses poster-free rows', async () => {
  const app = await readProjectFile('js/app.js');
  const douban = await readProjectFile('js/douban.js');
  const player = await readProjectFile('js/player.js');

  assert.match(app, /referrerpolicy="no-referrer"/);
  assert.match(app, /setImageProxyFallback/);
  assert.match(douban, /setImageProxyFallback/);
  assert.match(player, /resource-switch-row/);
  assert.doesNotMatch(player.slice(player.indexOf('let html ='), player.indexOf('let nextIndex = 0', player.indexOf('resource-switch-grid'))), /<img/);
});

test('detail parsing prefers directly playable m3u8 sources over share pages', async () => {
  const sandbox = {
    console,
    URL,
    window: {}
  };
  vm.createContext(sandbox);
  vm.runInContext(await readProjectFile('js/config.js'), sandbox);
  vm.runInContext(await readProjectFile('js/api.js'), sandbox);

  assert.equal(typeof sandbox.extractPlayableEpisodes, 'function');
  const episodes = Array.from(sandbox.extractPlayableEpisodes({
      vod_play_from: 'liangzi$$$lzm3u8',
      vod_play_url: 'HD中字$https://v.lzcdn31.com/share/93da579a65ce84cd1d4c85c2cbb84fc5$$$HD中字$https://v.lzcdn31.com/20260329/4136_c7f1876c/index.m3u8'
  }));
  assert.deepEqual(
    episodes,
    ['https://v.lzcdn31.com/20260329/4136_c7f1876c/index.m3u8']
  );
});

test('player can repair stale share-page URLs from detail data', async () => {
  const player = await readProjectFile('js/player.js');

  assert.match(player, /resolvePlayableEpisodeFromDetail/);
  assert.match(player, /isDirectPlayableVideoUrl/);
  assert.match(player, /const videoId = urlParams\.get\('id'\)/);
  assert.match(player, /当前播放地址不是可直接播放的视频链接/);
});

test('Cloudflare Pages proxy preserves binary image/media responses', async () => {
  const proxy = await readProjectFile('functions/proxy/[[path]].js');
  const server = await readProjectFile('server.mjs');
  const middleware = await readProjectFile('functions/_middleware.js');

  assert.match(proxy, /arrayBuffer\(\)/);
  assert.match(proxy, /isBinary/);
  assert.match(proxy, /!isBinary && kvNamespace/);
  assert.match(proxy, /acceptedHashes/);
  assert.match(proxy, /PASSWORD_HASH/);
  assert.match(proxy, /movie\.douban\.com/);
  assert.match(server, /movie\.douban\.com/);
  assert.match(server, /acceptedHashes/);
  assert.match(server, /PASSWORD_HASH/);
  assert.match(server, /getTargetReferer\(targetUrl\)/);
  assert.match(middleware, /PASSWORD_HASH/);
});

test('manifest exposes installable PWA metadata', async () => {
  const manifest = JSON.parse(await readProjectFile('manifest.json'));

  assert.equal(manifest.id, '/');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.orientation, 'any');
  assert.equal(manifest.lang, 'zh-CN');
  assert.ok(manifest.categories.includes('entertainment'));

  const icon192 = manifest.icons.find(icon => icon.sizes === '192x192');
  const icon512 = manifest.icons.find(icon => icon.sizes === '512x512');
  assert.equal(icon192.src, 'image/icon-192.png');
  assert.match(icon192.purpose, /maskable/);
  assert.equal(icon512.src, 'image/icon-512-maskable.png');
  assert.match(icon512.purpose, /maskable/);
});

test('service worker provides an offline app shell without caching APIs or media', async () => {
  const sw = await readProjectFile('service-worker.js');

  assert.match(sw, /APP_SHELL_CACHE/);
  assert.match(sw, /OFFLINE_URL\s*=\s*'\/offline\.html'/);
  assert.match(sw, /isNetworkOnlyRequest/);
  assert.match(sw, /\/api\//);
  assert.match(sw, /\/proxy\//);
  assert.match(sw, /\.m3u8/);
  assert.match(sw, /event\.request\.mode === 'navigate'/);
  assert.match(sw, /caches\.open\(APP_SHELL_CACHE\)/);
});

test('pages expose PWA metadata and register the service worker', async () => {
  const pages = ['index.html', 'player.html', 'watch.html', 'about.html', 'offline.html', 'diagnostics.html'];

  for (const pagePath of pages) {
    const html = await readProjectFile(pagePath);
    assert.match(html, /<link rel="manifest" href="manifest\.json">/);
    assert.match(html, /<meta name="theme-color" content="#0f1622">/);
    assert.match(html, /<meta name="mobile-web-app-capable" content="yes">/);
    assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes">/);
    assert.match(html, /<script src="js\/pwa-register\.js"><\/script>/);
  }
});

test('PWA registration handles failures and app updates safely', async () => {
  const registration = await readProjectFile('js/pwa-register.js');

  assert.match(registration, /navigator\.serviceWorker\.register\('\/service-worker\.js'\)/);
  assert.match(registration, /catch/);
  assert.match(registration, /console\.warn/);
  assert.match(registration, /controllerchange/);
});

test('service worker updates never force the open page to reload', async () => {
  const registration = await readProjectFile('js/pwa-register.js');
  const sw = await readProjectFile('service-worker.js');

  assert.doesNotMatch(registration, /location\.reload/);
  assert.match(sw, /function isLongLivedAsset/);
  assert.match(sw, /event\.request\.mode === 'navigate' \|\| !isLongLivedAsset\(event\.request\)/);
});

test('public deployment URLs are not exposed in current tracked files', async () => {
  const checkedFiles = [
    'README.md',
    'CHANGELOG.md',
    'ROADMAP.md',
    'MIGRATION.md',
    'docs/UPSTREAM_OUTREACH.md',
    'docs/SEO_AND_INTAKE.md',
    '.github/release-notes/v1.2.5.md',
    '.github/release-notes/v1.2.6.md',
    '.github/release-notes/v1.2.7.md',
    'index.html',
    'js/config.js',
    'manifest.json',
    'service-worker.js'
  ];
  const forbidden = /libretv-4vs\.pages\.dev|pages\.dev|libretv\.is-an\.org/i;

  for (const filePath of checkedFiles) {
    assert.doesNotMatch(await readProjectFile(filePath), forbidden, `${filePath} exposes a public URL`);
  }
});

test('GitHub outreach keeps migration repository-only and self-hosted', async () => {
  const readme = await readProjectFile('README.md');
  const migration = await readProjectFile('MIGRATION.md');
  const outreach = await readProjectFile('docs/UPSTREAM_OUTREACH.md');
  const seo = await readProjectFile('docs/SEO_AND_INTAKE.md');
  const migrationTemplate = await readProjectFile('.github/ISSUE_TEMPLATE/migration_support.yml');
  const issueConfig = await readProjectFile('.github/ISSUE_TEMPLATE/config.yml');
  const releaseNotes = await readProjectFile('.github/release-notes/v1.2.5.md');
  const archiveReleaseNotes = await readProjectFile('.github/release-notes/v1.2.6.md');
  const intakeReleaseNotes = await readProjectFile('.github/release-notes/v1.2.7.md');

  assert.match(readme, /MIGRATION\.md/);
  assert.match(readme, /LibreSpark\/LibreTV/);
  assert.match(readme, /MacCMS VOD API/);
  assert.match(readme, /GitHub Discussions/);
  assert.match(readme, /GitHub Issues/);
  assert.match(readme, /不提供公开演示站点/);
  assert.match(migration, /上游 LibreTV/);
  assert.match(migration, /wxst\/LibreTV\/issues/);
  assert.match(migration, /不运营公开影视服务/);
  assert.match(outreach, /只链接 GitHub 仓库/);
  assert.match(outreach, /每个 issue 最多回复一次/);
  assert.match(outreach, /不链接任何公开部署站点/);
  assert.match(outreach, /archived\/read-only/);
  assert.match(outreach, /本仓库 Discussions/);
  assert.match(seo, /LibreSpark\/LibreTV archived fork/);
  assert.match(seo, /Issues：只承接可复现 bug/);
  assert.match(migrationTemplate, /Upstream migration support/);
  assert.match(migrationTemplate, /Do not include passwords/);
  assert.match(issueConfig, /Upstream migration discussion/);
  assert.match(releaseNotes, /LibreTV Revival baseline/);
  assert.match(releaseNotes, /不提供公开演示站点/);
  assert.match(releaseNotes, /PASSWORD/);
  assert.match(archiveReleaseNotes, /archived upstream repository is read-only/);
  assert.match(archiveReleaseNotes, /Discussions/);
  assert.match(intakeReleaseNotes, /GitHub search and migration intake/);
  assert.match(intakeReleaseNotes, /Issues/);
});

test('about and privacy page use maintained repository and complaint contact', async () => {
  const about = await readProjectFile('about.html');

  assert.match(about, /https:\/\/github\.com\/wxst\/LibreTV/);
  assert.match(about, /mailto:9991818@gmail\.com/);
  assert.match(about, />9991818@gmail\.com</);
  assert.doesNotMatch(about, /https:\/\/github\.com\/LibreSpark\/LibreTV/);
  assert.doesNotMatch(about, /troll@pissmail\.com/);
});

test('public maintenance governance docs and CI are present', async () => {
  const readme = await readProjectFile('README.md');
  const changelog = await readProjectFile('CHANGELOG.md');
  const roadmap = await readProjectFile('ROADMAP.md');
  const contributing = await readProjectFile('CONTRIBUTING.md');
  const prTemplate = await readProjectFile('.github/pull_request_template.md');
  const bugTemplate = await readProjectFile('.github/ISSUE_TEMPLATE/bug_report.yml');
  const featureTemplate = await readProjectFile('.github/ISSUE_TEMPLATE/feature_request.yml');
  const migrationTemplate = await readProjectFile('.github/ISSUE_TEMPLATE/migration_support.yml');
  const ci = await readProjectFile('.github/workflows/ci.yml');
  const gitignore = await readProjectFile('.gitignore');

  assert.match(readme, /维护续作/);
  assert.match(readme, /Cloudflare Pages/);
  assert.match(readme, /PWA/);
  assert.match(readme, /每次用户可见变更/);
  assert.match(changelog, /1\.1\.5/);
  assert.match(changelog, /公开维护基础/);
  assert.match(roadmap, /源健康检查/);
  assert.match(roadmap, /诊断页/);
  assert.match(contributing, /Apache-2\.0/);
  assert.match(prTemplate, /版本号/);
  assert.match(bugTemplate, /部署平台/);
  assert.match(featureTemplate, /维护路线图/);
  assert.match(migrationTemplate, /LibreSpark\/LibreTV/);
  assert.match(ci, /npm test/);
  assert.match(ci, /node --check/);
  assert.match(gitignore, /^agent\.md$/m);
});

test('maintenance automation avoids direct main pushes and public preview workflows', async () => {
  const readme = await readProjectFile('README.md');
  const contributing = await readProjectFile('CONTRIBUTING.md');
  const workflowDir = path.join(rootDir, '.github/workflows');
  const workflowFiles = await readdir(workflowDir);
  const workflowText = (await Promise.all(
    workflowFiles.map(fileName => readProjectFile(path.join('.github/workflows', fileName)))
  )).join('\n');

  assert.deepEqual(workflowFiles.sort(), ['ci.yml']);
  assert.match(readme, /Preview deployments 设置为 `None`/);
  assert.match(readme, /`main` 只作为通过 CI 后的生产部署分支/);
  assert.match(contributing, /Do not push directly to `main`/);
  assert.doesNotMatch(workflowText, /git push origin main|target_sync_branch:\s*main|pull_request_target/);
});

test('source health checks probe sources and expose a UI report', async () => {
  const sourceHealth = await readProjectFile('js/source-health.js');
  const index = await readProjectFile('index.html');
  const diagnosticsHtml = await readProjectFile('diagnostics.html');
  const sw = await readProjectFile('service-worker.js');

  assert.match(sourceHealth, /SOURCE_HEALTH_STORAGE_KEY/);
  assert.match(sourceHealth, /runSourceHealthCheck/);
  assert.match(sourceHealth, /getHealthSourceIds/);
  assert.match(sourceHealth, /probeSourceHealth/);
  assert.match(sourceHealth, /handleApiRequest/);
  assert.match(sourceHealth, /searchOk/);
  assert.match(sourceHealth, /detailOk/);
  assert.match(sourceHealth, /playableOk/);
  assert.match(sourceHealth, /\.m3u8/);
  assert.match(sourceHealth, /successRate/);
  assert.match(sourceHealth, /checkedAt/);
  assert.match(sourceHealth, /sourceHealthReport/);
  assert.match(diagnosticsHtml, /sourceHealthSummary/);
  assert.match(diagnosticsHtml, /sourceHealthList/);
  assert.match(diagnosticsHtml, /runDiagnosticsSourceHealth/);
  assert.match(diagnosticsHtml, />检测源</);
  assert.doesNotMatch(index, /source-health-panel|sourceHealthSummary|sourceHealthList|runSourceHealthCheck/);
  assert.doesNotMatch(index, /检测默认源/);
  assert.match(index, /js\/source-health\.js/);
  assert.match(sw, /js\/source-health\.js/);
});

test('source health selection includes all built-in and custom sources', async () => {
  const sandbox = {
    console,
    URL,
    window: {},
    localStorage: {
      getItem(key) {
        if (key === 'customAPIs') {
          return JSON.stringify([
            { name: '自定义一', url: 'https://custom-one.example/api.php/provide/vod' },
            { name: '自定义二', url: 'https://custom-two.example/api.php/provide/vod' }
          ]);
        }
        return null;
      },
      setItem() {}
    },
    document: {
      addEventListener() {},
      getElementById() {
        return null;
      }
    },
    performance: {
      now() {
        return 0;
      }
    },
    setTimeout,
    clearTimeout,
    AbortController
  };
  vm.createContext(sandbox);
  vm.runInContext(await readProjectFile('js/config.js'), sandbox);
  vm.runInContext(await readProjectFile('js/customer_site.js'), sandbox);
  vm.runInContext(await readProjectFile('js/source-health.js'), sandbox);

  const builtInSourceIds = Object.keys(sandbox.window.API_SITES);
  const sourceIds = Array.from(sandbox.window.getHealthSourceIds());

  assert.deepEqual(sourceIds, [...builtInSourceIds, 'custom_0', 'custom_1']);
  assert.ok(sourceIds.some(sourceId => sandbox.window.API_SITES[sourceId]?.adult));
});

test('source health checks run with a ten source concurrency limit', async () => {
  let activeSearches = 0;
  let maxActiveSearches = 0;
  const sandbox = {
    console,
    URL,
    window: {
      API_SITES: {},
      SITE_CONFIG: { version: 'test' },
      PROXY_URL: '/proxy/',
      location: { origin: 'https://libretv.example' }
    },
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {}
    },
    document: {
      addEventListener() {},
      getElementById() {
        return null;
      }
    },
    performance: {
      now() {
        return 0;
      }
    },
    searchByAPIAndKeyWord: async sourceId => {
      activeSearches += 1;
      maxActiveSearches = Math.max(maxActiveSearches, activeSearches);
      await new Promise(resolve => setTimeout(resolve, 10));
      activeSearches -= 1;
      return [{ vod_id: `${sourceId}-1`, vod_name: sourceId }];
    },
    handleApiRequest: async () => JSON.stringify({
      code: 200,
      episodes: ['https://media.example/video.m3u8']
    }),
    fetch: async () => ({ ok: true }),
    setTimeout,
    clearTimeout,
    AbortController
  };
  vm.createContext(sandbox);
  vm.runInContext(await readProjectFile('js/source-health.js'), sandbox);

  const sourceIds = Array.from({ length: 12 }, (_, index) => `source_${index}`);
  const report = await sandbox.window.runSourceHealthCheck(sourceIds);

  assert.equal(report.sources.length, 12);
  assert.equal(maxActiveSearches, 10);
});

test('source health checks unselect failed sources for the current user', async () => {
  const storage = new Map([
    ['selectedAPIs', JSON.stringify(['ok_source', 'failed_source', 'custom_0'])]
  ]);
  const checkboxState = new Map([
    ['api_ok_source', { checked: true }],
    ['api_failed_source', { checked: true }],
    ['custom_api_0', { checked: true }]
  ]);
  const sandbox = {
    console,
    URL,
    window: {
      API_SITES: {},
      SITE_CONFIG: { version: 'test' },
      PROXY_URL: '/proxy/',
      location: { origin: 'https://libretv.example' }
    },
    localStorage: {
      getItem(key) {
        return storage.get(key) || null;
      },
      setItem(key, value) {
        storage.set(key, value);
      }
    },
    document: {
      addEventListener() {},
      getElementById(id) {
        return checkboxState.get(id) || null;
      }
    },
    performance: {
      now() {
        return 0;
      }
    },
    searchByAPIAndKeyWord: async sourceId => {
      if (sourceId === 'failed_source') return [];
      return [{ vod_id: `${sourceId}-1`, vod_name: sourceId }];
    },
    handleApiRequest: async () => JSON.stringify({
      code: 200,
      episodes: ['https://media.example/video.m3u8']
    }),
    fetch: async () => ({ ok: true }),
    updateSelectedApiCount() {},
    checkAdultAPIsSelected() {},
    setTimeout,
    clearTimeout,
    AbortController
  };
  vm.createContext(sandbox);
  vm.runInContext(await readProjectFile('js/source-health.js'), sandbox);

  const report = await sandbox.window.runSourceHealthCheck(['ok_source', 'failed_source', 'custom_0']);

  assert.deepEqual(JSON.parse(storage.get('selectedAPIs')), ['ok_source', 'custom_0']);
  assert.equal(checkboxState.get('api_failed_source').checked, false);
  assert.equal(report.disabledSourceIds.includes('failed_source'), true);
});

test('yellow content filter skips adult sources and adult-looking search results', async () => {
  const storage = new Map([
    ['yellowFilterEnabled', 'true'],
    ['selectedAPIs', JSON.stringify(['ysgc', 'siwa', 'custom_0', 'custom_1'])],
    ['customAPIs', JSON.stringify([
      { name: '自定义黄色源', url: 'https://adult.example/api.php/provide/vod', isAdult: true },
      { name: '自定义普通源', url: 'https://safe.example/api.php/provide/vod' }
    ])]
  ]);
  const sandbox = {
    console,
    URL,
    window: {},
    localStorage: {
      getItem(key) {
        return storage.get(key) || null;
      },
      setItem(key, value) {
        storage.set(key, value);
      }
    },
    document: {
      addEventListener() {},
      getElementById() {
        return null;
      },
      querySelectorAll() {
        return [];
      }
    },
    setTimeout,
    clearTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(await readProjectFile('js/config.js'), sandbox);
  vm.runInContext(await readProjectFile('js/customer_site.js'), sandbox);
  vm.runInContext(await readProjectFile('js/app.js'), sandbox);

  assert.deepEqual(
    Array.from(sandbox.window.getSearchableApiIds(['ysgc', 'siwa', 'custom_0', 'custom_1'])),
    ['ysgc', 'custom_1']
  );

  const filtered = sandbox.window.filterYellowContentResults([
    { vod_name: '世界的主人', type_name: '剧情', source_code: 'ysgc' },
    { vod_name: '普通标题', type_name: '剧情', source_code: 'siwa', source_name: '丝袜资源' },
    { vod_name: '美女主播私拍', type_name: '国产自拍', source_code: 'ysgc' },
    { vod_name: '普通标题', type_name: '剧情', source_code: 'custom_0' }
  ]);

  assert.deepEqual(Array.from(filtered).map(item => item.vod_name), ['世界的主人']);

  storage.set('yellowFilterEnabled', 'false');
  assert.equal(
    sandbox.window.getResultTypeLabel({ vod_name: '美女主播私拍', type_name: '国产自拍', source_code: 'ysgc' }),
    '成人视频'
  );
  assert.equal(
    sandbox.window.getResultTypeLabel({ vod_name: '普通电影', type_name: '剧情', source_code: 'ysgc' }),
    '剧情'
  );
});

test('search results require title relevance and ignored sources do not paginate', async () => {
  const storage = new Map([
    ['yellowFilterEnabled', 'false'],
    ['selectedAPIs', JSON.stringify(['siwa'])]
  ]);
  const requestedUrls = [];
  const sandbox = {
    console,
    URL,
    window: {},
    localStorage: {
      getItem(key) {
        return storage.get(key) || null;
      },
      setItem(key, value) {
        storage.set(key, value);
      }
    },
    document: {
      addEventListener() {},
      getElementById() {
        return null;
      },
      querySelectorAll() {
        return [];
      }
    },
    fetch: async url => {
      requestedUrls.push(decodeURIComponent(String(url)));
      return {
        ok: true,
        async json() {
          return {
            pagecount: 50,
            list: [
              { vod_id: 'adult-1', vod_name: '美女主播私拍', type_name: '国产自拍' },
              { vod_id: 'adult-2', vod_name: '热舞屁股', type_name: '美女主播' }
            ]
          };
        }
      };
    },
    setTimeout,
    clearTimeout,
    AbortController
  };
  vm.createContext(sandbox);
  vm.runInContext(await readProjectFile('js/config.js'), sandbox);
  vm.runInContext(await readProjectFile('js/customer_site.js'), sandbox);
  vm.runInContext(await readProjectFile('js/app.js'), sandbox);
  vm.runInContext(await readProjectFile('js/search.js'), sandbox);

  assert.equal(typeof sandbox.window.filterResultsByQuery, 'function');
  assert.deepEqual(
    Array.from(sandbox.window.filterResultsByQuery([
      { vod_name: '世界的主人', source_code: 'ysgc' },
      { vod_name: '美女主播私拍', source_code: 'siwa' },
      { vod_name: '别名', vod_sub: '世界的主人', source_code: 'ysgc' }
    ], '世界的主人')).map(item => item.vod_id || item.vod_name),
    ['世界的主人', '别名']
  );

  const results = await sandbox.searchByAPIAndKeyWord('siwa', '世界的主人');

  assert.deepEqual(Array.from(results), []);
  assert.equal(requestedUrls.filter(url => url.includes('siwazyw.tv')).length, 1);
  assert.equal(requestedUrls.some(url => url.includes('pg=2')), false);
});

test('player resource switch can search without loading homepage app script', async () => {
  const requestedUrls = [];
  const warnings = [];
  const sandbox = {
    console: {
      ...console,
      warn(...args) {
        warnings.push(args.map(String).join(' '));
      }
    },
    URL,
    window: {},
    fetch: async url => {
      requestedUrls.push(decodeURIComponent(String(url)));
      return {
        ok: true,
        async json() {
          return {
            pagecount: 1,
            list: [
              { vod_id: 'match-1', vod_name: '世界的主人', vod_pic: '/poster.jpg' },
              { vod_id: 'noise-1', vod_name: '美女主播私拍' }
            ]
          };
        }
      };
    },
    setTimeout,
    clearTimeout,
    AbortController
  };
  vm.createContext(sandbox);
  vm.runInContext(await readProjectFile('js/config.js'), sandbox);
  vm.runInContext(await readProjectFile('js/customer_site.js'), sandbox);
  vm.runInContext(await readProjectFile('js/search.js'), sandbox);
  const player = await readProjectFile('js/player.js');

  assert.equal(typeof sandbox.searchByAPIAndKeyWord, 'function');
  assert.equal(typeof sandbox.window.filterResultsByQuery, 'function');
  assert.match(player, /JSON\.stringify\(DEFAULT_SELECTED_APIS\)/);
  assert.match(player, /Promise\.allSettled\(resourceOptions\.map/);
  assert.match(player, /未找到可切换资源/);

  const results = await sandbox.searchByAPIAndKeyWord('ysgc', '世界的主人');

  assert.deepEqual(Array.from(results).map(item => item.vod_id), ['match-1']);
  assert.equal(requestedUrls.some(url => url.includes('cj.lziapi.com')), true);
  assert.equal(warnings.some(message => message.includes('filterResultsByQuery')), false);
});

test('adult recommendation tag uses selected adult sources instead of Douban', async () => {
  const storage = new Map([
    ['yellowFilterEnabled', 'false'],
    ['selectedAPIs', JSON.stringify(['ysgc', 'siwa'])],
    ['userMovieTags', JSON.stringify(['热门', '成人视频', '动作'])]
  ]);
  const elements = new Map([
    ['douban-results', createElementStub('div')],
    ['douban-tags', createElementStub('div')]
  ]);
  const requestedUrls = [];
  const sandbox = {
    console,
    URL,
    window: {},
    localStorage: {
      getItem(key) {
        return storage.get(key) || null;
      },
      setItem(key, value) {
        storage.set(key, value);
      }
    },
    document: {
      addEventListener() {},
      getElementById(id) {
        return elements.get(id) || null;
      },
      createElement: createElementStub,
      createDocumentFragment() {
        return {
          isFragment: true,
          children: [],
          appendChild(child) {
            this.children.push(child);
            return child;
          }
        };
      },
      querySelectorAll() {
        return [];
      }
    },
    fetch: async url => {
      const decodedUrl = decodeURIComponent(String(url));
      requestedUrls.push(decodedUrl);
      return {
        ok: true,
        async json() {
          return {
            pagecount: 1,
            list: [
              { vod_id: 'adult-latest-1', vod_name: '国产自拍最新', type_name: '国产自拍' }
            ],
            subjects: []
          };
        }
      };
    },
    showDetails() {},
    setTimeout,
    clearTimeout,
    AbortController
  };
  vm.createContext(sandbox);
  vm.runInContext(await readProjectFile('js/config.js'), sandbox);
  vm.runInContext(await readProjectFile('js/customer_site.js'), sandbox);
  vm.runInContext(await readProjectFile('js/app.js'), sandbox);
  vm.runInContext(await readProjectFile('js/search.js'), sandbox);
  vm.runInContext(await readProjectFile('js/source-health.js'), sandbox);
  vm.runInContext(await readProjectFile('js/douban.js'), sandbox);

  assert.equal(typeof sandbox.fetchLatestByAPI, 'function');
  const latest = await sandbox.fetchLatestByAPI('siwa', 2);
  assert.deepEqual(Array.from(latest).map(item => item.source_code), ['siwa']);

  const renderPromise = sandbox.renderRecommend('成人视频', 16, 0);
  if (renderPromise && typeof renderPromise.then === 'function') {
    await renderPromise;
  }
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(requestedUrls.some(url => url.includes('movie.douban.com')), false);
  assert.equal(requestedUrls.some(url => url.includes('siwazyw.tv') && url.includes('ac=videolist') && url.includes('pg=')), true);
  assert.equal(requestedUrls.some(url => url.includes('wd=')), false);
});

test('home page loads Douban recommendations once even when initialized twice', async () => {
  const storage = new Map([['doubanEnabled', 'true']]);
  const toggleDot = createElementStub('div');
  const toggleBg = { ...createElementStub('div'), nextElementSibling: toggleDot };
  const doubanToggle = { ...createElementStub('input'), checked: false, nextElementSibling: toggleBg };
  const elements = new Map([
    ['doubanToggle', doubanToggle],
    ['doubanArea', createElementStub('div')],
    ['resultsArea', { ...createElementStub('div'), classList: { add() {}, remove() {}, contains: name => name === 'hidden' } }],
    ['douban-results', createElementStub('div')],
    ['douban-tags', createElementStub('div')]
  ]);
  let doubanListRequests = 0;
  const sandbox = {
    console,
    URL,
    window: { scrollTo() {} },
    localStorage: {
      getItem(key) {
        return storage.get(key) || null;
      },
      setItem(key, value) {
        storage.set(key, String(value));
      }
    },
    document: {
      addEventListener() {},
      getElementById(id) {
        return elements.get(id) || null;
      },
      createElement: createElementStub,
      createDocumentFragment() {
        return {
          isFragment: true,
          children: [],
          appendChild(child) {
            this.children.push(child);
            return child;
          }
        };
      },
      querySelectorAll() {
        return [];
      }
    },
    fetch: async url => {
      if (decodeURIComponent(String(url)).includes('search_subjects')) doubanListRequests += 1;
      await new Promise(resolve => setTimeout(resolve, 5));
      return {
        ok: true,
        async json() {
          return { subjects: [{ title: '世界的主人', rate: '7.5', cover: '', url: '' }] };
        }
      };
    },
    setTimeout,
    clearTimeout,
    AbortController
  };
  sandbox.window.scrollTo = () => {};
  sandbox.scrollTo = () => {};
  vm.createContext(sandbox);
  vm.runInContext(await readProjectFile('js/config.js'), sandbox);
  vm.runInContext(await readProjectFile('js/douban.js'), sandbox);

  // DOMContentLoaded, then again after the password check passes.
  sandbox.initDouban();
  sandbox.initDouban();
  await new Promise(resolve => setTimeout(resolve, 30));

  assert.equal(doubanListRequests, 1);
  assert.equal(elements.get('douban-results').children.length, 1);

  // Switching tags A -> B -> A quickly reuses the still-running request for A
  // and renders only the latest choice.
  doubanListRequests = 0;
  elements.get('douban-results').children.length = 0;
  sandbox.renderRecommend('热门', 16, 0);
  sandbox.renderRecommend('最新', 16, 0);
  sandbox.renderRecommend('热门', 16, 0);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(doubanListRequests, 2);
  assert.equal(elements.get('douban-results').children.length, 1);
});

test('normal douban cards filter adult-looking subjects from regular tags', async () => {
  const container = createElementStub('div');
  const sandbox = {
    console,
    URL,
    window: {},
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {}
    },
    document: {
      addEventListener() {},
      getElementById() {
        return null;
      },
      createElement: createElementStub,
      createDocumentFragment() {
        return {
          isFragment: true,
          children: [],
          appendChild(child) {
            this.children.push(child);
            return child;
          }
        };
      },
      querySelectorAll() {
        return [];
      }
    },
    setTimeout,
    clearTimeout,
    AbortController
  };
  vm.createContext(sandbox);
  vm.runInContext(await readProjectFile('js/config.js'), sandbox);
  vm.runInContext(await readProjectFile('js/customer_site.js'), sandbox);
  vm.runInContext(await readProjectFile('js/app.js'), sandbox);
  vm.runInContext(await readProjectFile('js/douban.js'), sandbox);

  sandbox.renderDoubanCards({
    subjects: [
      { title: '美女主播私拍', rate: '7.0', cover: '', url: 'https://movie.douban.com/subject/adult' },
      { title: '世界的主人', rate: '7.5', cover: '', url: 'https://movie.douban.com/subject/normal' }
    ]
  }, container);

  assert.equal(container.children.length, 1);
  assert.match(container.children[0].innerHTML, /世界的主人/);
  assert.doesNotMatch(container.children[0].innerHTML, /美女主播/);
});

test('playback errors are classified and offer one-click source switching', async () => {
  const playerErrors = await readProjectFile('js/player-errors.js');
  const player = await readProjectFile('js/player.js');
  const playerHtml = await readProjectFile('player.html');

  assert.match(playerErrors, /function classifyPlaybackError/);
  assert.match(playerErrors, /403/);
  assert.match(playerErrors, /404/);
  assert.match(playerErrors, /timeout/);
  assert.match(playerErrors, /proxy/);
  assert.match(playerErrors, /browser/);
  assert.match(player, /classifyPlaybackError/);
  assert.match(player, /showResourceSwitchModal/);
  assert.match(player, /一键切换资源/);
  assert.match(playerHtml, /error-actions/);
  assert.match(playerHtml, /js\/player-errors\.js/);
});

test('player modernization upgrades libraries and removes legacy DPlayer hooks', async () => {
  const player = await readProjectFile('js/player.js');
  const styles = await readProjectFile('css/styles.css');
  const playerStyles = await readProjectFile('css/player.css');
  const artplayer = await readProjectFile('libs/artplayer.min.js');
  const hls = await readProjectFile('libs/hls.min.js');

  assert.match(artplayer, /artplayer\.js v5\.4\.0/);
  assert.match(hls, /hls\.js version 1\.6\.16|version:"1\.6\.16"|version='1\.6\.16'/);
  assert.doesNotMatch(player, /dplayer/i);
  assert.doesNotMatch(styles, /dplayer/i);
  assert.doesNotMatch(playerStyles, /dplayer/i);
});

test('paused player state icon remains centered and loading mask behavior is native', async () => {
  const player = await readProjectFile('js/player.js');
  const playerStyles = await readProjectFile('css/player.css');

  assert.match(player, /icons:\s*\{\s*state:\s*'<svg[^']+width="80" height="80"/);
  assert.doesNotMatch(playerStyles, /#player \.art-mask\s*\{[^}]*display:\s*flex\s*!important/s);
  assert.doesNotMatch(playerStyles, /#player \.art-state\s*\{[^}]*transform:\s*none\s*!important/s);
});

test('player HLS config increases buffering with a low resource fallback', async () => {
  const player = await readProjectFile('js/player.js');

  assert.match(player, /function buildHlsConfig/);
  assert.match(player, /function isLowResourcePlaybackDevice/);
  assert.match(player, /saveData/);
  assert.match(player, /maxBufferLength:\s*lowResource\s*\?\s*30\s*:\s*60/);
  assert.match(player, /maxMaxBufferLength:\s*lowResource\s*\?\s*60\s*:\s*120/);
  assert.match(player, /maxBufferSize:\s*lowResource\s*\?\s*30\s*\*\s*1000\s*\*\s*1000\s*:\s*64\s*\*\s*1000\s*\*\s*1000/);
  assert.match(player, /backBufferLength:\s*lowResource\s*\?\s*60\s*:\s*120/);
});

test('player progress preview uses a separate preview video and safe time mapping', async () => {
  const player = await readProjectFile('js/player.js');
  const playerStyles = await readProjectFile('css/player.css');

  assert.match(player, /function setupProgressPreview/);
  assert.match(player, /function getProgressPreviewTime/);
  assert.match(player, /function destroyProgressPreview/);
  assert.match(player, /previewVideo\s*=\s*document\.createElement\('video'\)/);
  assert.match(player, /previewHls\s*=\s*new Hls/);
  assert.match(player, /Math\.min\(duration,\s*Math\.max\(0,\s*ratio \* duration\)\)/);
  assert.match(playerStyles, /progress-preview/);
  assert.match(playerStyles, /progress-preview-video/);
});

test('player autoplay fallback retries muted playback and source switching resumes position', async () => {
  const player = await readProjectFile('js/player.js');

  assert.match(player, /function tryStartPlayback/);
  assert.match(player, /playbackPromise\.catch/);
  assert.match(player, /art\.muted\s*=\s*true/);
  assert.match(player, /已静音自动播放/);
  assert.match(player, /function getCurrentPlaybackPosition/);
  assert.match(player, /function restorePlaybackPosition/);
  assert.match(player, /function clampPlaybackPosition/);
  assert.match(player, /const resumePosition\s*=\s*getCurrentPlaybackPosition\(\)/);
  assert.match(player, /position=\$\{encodeURIComponent\(String\(Math\.floor\(resumePosition\)\)\)\}/);
});

test('player cast, menu hotzone, fullscreen, and duplicate controls are wired', async () => {
  const player = await readProjectFile('js/player.js');
  const playerStyles = await readProjectFile('css/player.css');
  const castHtml = await readProjectFile('cast.html');
  const castReceiver = await readProjectFile('js/cast-receiver.js');
  const sw = await readProjectFile('service-worker.js');

  assert.match(player, /function setupPlayerSurfaceToggle/);
  assert.match(player, /function shouldIgnorePlayerSurfaceToggle/);
  assert.match(player, /PLAYER_SURFACE_INTERACTIVE_SELECTOR/);
  assert.match(player, /clickTimer/);
  assert.match(player, /togglePlaybackFromSurface/);
  assert.match(player, /\[class\*="art-setting"\]/);
  assert.match(player, /\[class\*="art-selector"\]/);
  assert.match(player, /\[class\*="art-contextmenu"\]/);
  assert.doesNotMatch(player, /art\.video\.addEventListener\('dblclick'/);

  assert.match(player, /function toggleFullscreenMode/);
  const enhancements = await readProjectFile('js/player-enhancements.js');
  assert.match(enhancements, /if \(event\.altKey\) \{\n\s*if \(key === 'Enter'\) return \{ type: 'fullscreen' \}/);
  assert.match(player, /window\.PlayerEnhancements\.shortcutAction\(e\)/);
  assert.match(player, /function maybeLockLandscapeOrientation/);
  assert.match(player, /function unlockLandscapeOrientation/);
  assert.match(player, /screen\.orientation\.lock\('landscape'\)/);
  assert.match(player, /screen\.orientation\.unlock\(\)/);

  assert.match(player, /function prepareVideoForNativeCast/);
  assert.match(player, /video\.disableRemotePlayback\s*=\s*false/);
  assert.match(player, /removeAttribute\('disableRemotePlayback'\)/);
  assert.doesNotMatch(player, /disableRemotePlayback:\s*false/);
  assert.match(player, /function detectCastAvailability/);
  assert.match(player, /function setupCastAvailability/);
  assert.match(player, /PresentationRequest\.getAvailability/);
  assert.match(player, /watchAvailability/);
  assert.match(player, /webkitShowPlaybackTargetPicker/);
  assert.match(player, /playerTopActionsEl\.hidden\s*=\s*!available/);
  assert.match(player, /setCastButtonAvailable\(false\)/);
  assert.match(player, /cancelWatchAvailability/);
  assert.match(player, /\.catch\(\(\) => applyAvailability\(false\)\)/);
  assert.match(player, /function startPresentationCast/);
  assert.match(player, /new PresentationRequest/);
  assert.match(player, /function requestNativeCast/);
  assert.match(player, /video\.remote\.prompt\(\)/);
  assert.match(player, /function setupPlayerTopActions/);
  assert.match(player, /player-top-actions/);
  assert.match(playerStyles, /\.player-top-actions/);
  assert.match(player, /function updatePlayerControlDensity/);
  assert.match(player, /mobile-portrait-compact-controls/);
  assert.match(playerStyles, /mobile-portrait-compact-controls[\s\S]*art-controls-right \.art-control\.art-control-setting/);
  assert.match(playerStyles, /mobile-portrait-compact-controls[\s\S]*art-controls-right \.art-control\.art-control-pip/);
  assert.match(playerStyles, /mobile-portrait-compact-controls[\s\S]*art-controls-right \.art-control\.art-control-fullscreen/);
  assert.match(player, /function moveModalToFullscreenHost/);
  assert.match(player, /function restoreModalHome/);
  assert.match(player, /player-fullscreen-modal/);
  assert.match(playerStyles, /\.player-fullscreen-modal/);
  assert.match(castHtml, /js\/cast-receiver\.js/);
  assert.match(castReceiver, /function initCastReceiver/);
  assert.match(castReceiver, /new Hls/);
  assert.match(sw, /cast\.html/);
  assert.match(sw, /js\/cast-receiver\.js/);

  assert.match(player, /function buildHlsQualityOptions/);
  assert.match(player, /function applyHlsQuality/);
  assert.match(player, /function updateHlsQualityControl/);
  assert.match(player, /currentHls\.levels/);
  assert.match(player, /currentHls\.currentLevel/);
  assert.match(player, /name:\s*'quality'/);
  assert.doesNotMatch(player, /name:\s*'aspect-ratio'/);
  assert.match(player, /name:\s*'switch-resource'/);
  assert.match(player, /name:\s*'prev-episode'/);
  assert.match(player, /name:\s*'next-episode'/);
  assert.doesNotMatch(player, /name:\s*'fullscreen-toggle'/);
  assert.doesNotMatch(player, /function applyVideoFitMode/);
  assert.doesNotMatch(player, /ratio:/);
  assert.match(player, /pip:\s*true/);
  assert.match(player, /airplay:\s*false/);
  assert.match(player, /aspectRatio:\s*false/);
  assert.match(player, /flip:\s*false/);
  assert.match(player, /playbackRate:\s*true/);
  assert.match(player, /fullscreen:\s*true/);
  // Web fullscreen is offered on desktop only; touch devices keep a single fullscreen path.
  assert.match(player, /fullscreenWeb:\s*!isMobilePlaybackDevice\(\)/);
  assert.match(playerStyles, /\.player-touch-device \.art-control-fullscreenWeb/);
});

test('first-run guidance and diagnostics page support public self-hosting', async () => {
  const onboarding = await readProjectFile('js/onboarding.js');
  const password = await readProjectFile('js/password.js');
  const diagnostics = await readProjectFile('js/diagnostics.js');
  const diagnosticsHtml = await readProjectFile('diagnostics.html');
  const index = await readProjectFile('index.html');
  const sw = await readProjectFile('service-worker.js');
  const server = await readProjectFile('server.mjs');

  assert.match(onboarding, /firstRunGuideSeen/);
  assert.match(onboarding, /showFirstRunGuide/);
  assert.match(onboarding, /PASSWORD/);
  assert.match(onboarding, /PWA/);
  assert.match(onboarding, /导出配置/);
  assert.match(password, /const doubanArea = document\.getElementById\('doubanArea'\)/);
  assert.match(password, /if \(doubanArea\) doubanArea\.classList\.add\('hidden'\)/);
  assert.match(password, /if \(localStorage\.getItem\('doubanEnabled'\) === 'true' && doubanArea\)[\s\S]*doubanArea\.classList\.remove\('hidden'\)/);
  assert.match(index, /js\/onboarding\.js/);
  assert.match(index, /css\/modals\.css/);
  assert.ok(index.indexOf('css/modals.css') < index.indexOf('css/styles.css'));
  assert.match(index, /showFirstRunGuide\(true\)/);

  assert.match(diagnosticsHtml, /diagnostics-root/);
  assert.match(diagnosticsHtml, /<title>LibreTV 检测源<\/title>/);
  assert.match(diagnosticsHtml, /<h1>LibreTV 检测源<\/h1>/);
  assert.match(diagnosticsHtml, /js\/diagnostics\.js/);
  assert.match(diagnosticsHtml, /源健康/);
  assert.match(diagnosticsHtml, />检测源</);
  assert.doesNotMatch(diagnosticsHtml, /默认源健康|检测默认源/);
  assert.match(index, /window\.location\.href='diagnostics\.html'[\s\S]*>检测源<\/button>/);
  assert.doesNotMatch(index, />诊断页<\/button>/);
  assert.match(diagnostics, /password-status/);
  assert.match(diagnostics, /proxy-status/);
  assert.match(diagnostics, /pwa-status/);
  assert.match(diagnostics, /source-status/);
  assert.doesNotMatch(diagnosticsHtml, /cfat_|CLOUDFLARE_API_TOKEN|Authorization: Bearer/);
  assert.match(sw, /diagnostics\.html/);
  assert.match(sw, /js\/diagnostics\.js/);
  assert.match(server, /diagnostics\.html/);
});

test('config import and export are versioned, validated, and migratable', async () => {
  const configManager = await readProjectFile('js/config-manager.js');
  const app = await readProjectFile('js/app.js');
  const index = await readProjectFile('index.html');
  const sw = await readProjectFile('service-worker.js');

  assert.match(configManager, /CONFIG_EXPORT_VERSION\s*=\s*'2\.0\.0'/);
  assert.match(configManager, /buildConfigExport/);
  assert.match(configManager, /validateAndMigrateConfig/);
  assert.match(configManager, /applyConfigData/);
  assert.match(configManager, /migrationMessages/);
  assert.match(configManager, /allowedKeys/);
  assert.match(configManager, /sourceHealthReport/);
  assert.match(app, /buildConfigExport/);
  assert.match(app, /validateAndMigrateConfig/);
  assert.match(app, /applyConfigData/);
  assert.match(index, /js\/config-manager\.js/);
  assert.match(sw, /js\/config-manager\.js/);
});

test('maintenance roadmap completion adds smoke checks and incremental modules', async () => {
  const roadmap = await readProjectFile('ROADMAP.md');
  const readme = await readProjectFile('README.md');
  const packageJson = JSON.parse(await readProjectFile('package.json'));
  const smoke = await readProjectFile('scripts/smoke-browser.mjs');

  assert.match(roadmap, /Phase 2: Source Reliability[\s\S]*Status: completed/);
  assert.match(roadmap, /Phase 3: Playback Reliability[\s\S]*Status: completed/);
  assert.match(roadmap, /Phase 4: Public Self-hosting Experience[\s\S]*Status: completed/);
  assert.match(roadmap, /Phase 5: Incremental Architecture Cleanup[\s\S]*Status: completed/);
  assert.match(readme, /npm run smoke:browser/);
  assert.equal(packageJson.scripts['smoke:browser'], 'node scripts/smoke-browser.mjs');
  assert.match(smoke, /playwright/);
  assert.match(smoke, /diagnostics\.html/);
  assert.match(smoke, /manifest\.json/);
});

test('release metadata is bumped for this update', async () => {
  const packageJson = JSON.parse(await readProjectFile('package.json'));
  const lockJson = JSON.parse(await readProjectFile('package-lock.json'));
  const config = await readProjectFile('js/config.js');
  const serviceWorker = await readProjectFile('service-worker.js');
  const versionTxt = (await readProjectFile('VERSION.txt')).trim();

  const changelog = await readProjectFile('CHANGELOG.md');

  assert.equal(packageJson.version, '1.2.47');
  assert.equal(lockJson.version, '1.2.47');
  assert.equal(lockJson.packages[''].version, '1.2.47');
  assert.match(config, /version:\s*'1\.2\.47'/);
  assert.match(serviceWorker, /const APP_VERSION = '202610281330'/);
  assert.match(serviceWorker, /'\/js\/player-recommendations\.js'/);
  assert.match(serviceWorker, /'\/js\/mobile-fullscreen\.js'/);
  assert.match(serviceWorker, /'\/css\/theme\.css'/);
  assert.match(serviceWorker, /'\/js\/source-speed\.js'/);
  assert.match(changelog, /## 1\.2\.47 - 2026-10-28[\s\S]*?two progress bars/);
  assert.match(changelog, /## 1\.2\.46 - 2026-10-28[\s\S]*?README rewritten/);
  assert.match(changelog, /## 1\.2\.45 - 2026-10-28[\s\S]*?低画质修复/);
  assert.match(changelog, /## 1\.2\.44 - 2026-10-28[\s\S]*?FidelityFX Super Resolution/);
  assert.match(changelog, /## 1\.2\.43 - 2026-10-28[\s\S]*?下载本集/);
  assert.match(changelog, /## 1\.2\.42 - 2026-10-28[\s\S]*?Stats for nerds/);
  assert.match(changelog, /## 1\.2\.41 - 2026-10-28[\s\S]*?people who liked this also liked/);
  assert.match(changelog, /## 1\.2\.40 - 2026-10-28[\s\S]*?every version/);
  assert.match(changelog, /## 1\.2\.39 - 2026-10-28[\s\S]*?prebuilt/);
  assert.match(changelog, /## 1\.2\.38 - 2026-10-28[\s\S]*?shorter region labels/);
  assert.match(changelog, /## 1\.2\.37 - 2026-10-28[\s\S]*?Daily source check-up in the browser/);
  assert.match(changelog, /## 1\.2\.36 - 2026-10-28[\s\S]*?hide titles that no selected source can play/);
  assert.match(changelog, /## 1\.2\.35 - 2026-10-28[\s\S]*?slim sticky top bar/);
  assert.match(changelog, /## 1\.2\.34 - 2026-10-27[\s\S]*?combines genre, region, year or decade/);
  assert.match(changelog, /## 1\.2\.33 - 2026-10-27[\s\S]*?removes ad breaks spliced into playlists/);
  assert.match(changelog, /## 1\.2\.32 - 2026-10-27[\s\S]*?release number together with the build time/);
  assert.match(changelog, /## 1\.2\.31 - 2026-10-27[\s\S]*?Keyboard shortcuts/);
  assert.match(changelog, /## 1\.2\.30 - 2026-10-27[\s\S]*?Skip intro and outro/);
  assert.match(changelog, /## 1\.2\.29 - 2026-10-27[\s\S]*?in-player episode list/);
  assert.match(changelog, /## 1\.2\.24 - 2026-10-10[\s\S]*?Douban recommendations load once/);
  assert.match(changelog, /## 1\.2\.23 - 2026-10-10[\s\S]*?real media segment/);
  assert.match(changelog, /## 1\.2\.22 - 2026-10-10[\s\S]*?modern theme/);
  assert.match(changelog, /## 1\.2\.21 - 2026-10-10[\s\S]*?direct media/);
  assert.match(changelog, /## 1\.2\.20 - 2026-10-10[\s\S]*?source speed/);
  assert.match(changelog, /## 1\.2\.19 - 2026-09-23[\s\S]*?maintained repository/);
  assert.match(changelog, /## 1\.2\.18 - 2026-09-23[\s\S]*?conflicting mask overrides/);
  assert.match(changelog, /## 1\.2\.17[\s\S]*?cast button now hides/);
  assert.match(changelog, /## 1\.2\.17[\s\S]*?inactive aspect ratio and flip/);
  assert.match(versionTxt, /^\d{12}$/);
  assert.ok(Number(versionTxt) > 202508060117);
});

test('version checker reads the maintained repository through the GitHub API first', async () => {
  const requests = [];
  const versionChecker = await loadVersionChecker(async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      text: async () => url === '/VERSION.txt' ? '202609230002\n' : '202609230003\n'
    };
  });

  const result = await versionChecker.checkForUpdates();

  assert.equal(result.current, '202609230002');
  assert.equal(result.latest, '202609230003');
  assert.equal(result.hasUpdate, true);
  assert.equal(requests[0].url, '/VERSION.txt');
  assert.equal(requests[1].url, 'https://api.github.com/repos/wxst/LibreTV/contents/VERSION.txt?ref=main');
  assert.equal(requests[1].options.headers.Accept, 'application/vnd.github.raw+json');
});

test('version checker falls back to maintained Raw and keeps local version during remote outage', async () => {
  const requests = [];
  const versionChecker = await loadVersionChecker(async (url) => {
    requests.push(url);
    if (url === '/VERSION.txt') {
      return { ok: true, text: async () => '202609230002\n' };
    }
    if (url.endsWith('/contents/VERSION.txt?ref=main')) {
      return { ok: false, text: async () => '' };
    }
    if (url === 'https://raw.githubusercontent.com/wxst/LibreTV/main/VERSION.txt') {
      return { ok: true, text: async () => '202609230003\n' };
    }
    throw new Error('unexpected request');
  });

  const result = await versionChecker.checkForUpdates();

  assert.equal(requests[2], 'https://raw.githubusercontent.com/wxst/LibreTV/main/VERSION.txt');
  assert.equal(result.current, '202609230002');
  assert.equal(result.latest, '202609230003');
  assert.equal(result.hasUpdate, true);

  const offlineChecker = await loadVersionChecker(async (url) => {
    if (url === '/VERSION.txt') {
      return { ok: true, text: async () => '202609230002\n' };
    }
    throw new Error('offline');
  });
  const offlineResult = await offlineChecker.checkForUpdates();

  assert.equal(offlineResult.current, '202609230002');
  assert.equal(offlineResult.latest, null);
  assert.equal(offlineResult.hasUpdate, null);
});

test('footer version shows the release number with the build time', async () => {
  const checker = await loadVersionChecker(async () => ({ ok: false }));
  // Without SITE_CONFIG the build time is shown alone.
  assert.equal(checker.formatVersionLabel('2026-10-27 14:00'), '2026-10-27 14:00');
  checker.SITE_CONFIG = { version: '9.9.9' };
  assert.equal(checker.formatVersionLabel('2026-10-27 14:00'), 'v9.9.9（2026-10-27 14:00）');
  assert.equal(checker.formatVersionLabel(''), 'v9.9.9');
  checker.SITE_CONFIG = { version: '<img onerror=x>' };
  assert.equal(checker.formatVersionLabel('2026-10-27 14:00'), '2026-10-27 14:00');
});
