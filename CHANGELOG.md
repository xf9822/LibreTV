# Changelog

All notable changes to this maintained LibreTV fork are documented here.

## 1.2.58 - 2026-10-31

### Added

- Android TV app (`download/LibreTV-TV.apk`, package `io.github.wxst.libretv.tv`): the `tv` Gradle flavor of the same shell.
  - It appears on the TV home screen with a 320×180 banner, always runs landscape and keeps the screen on.
  - It needs only the internet permission (no casting), and it can be installed next to the phone app.
- TV mode on the site (`js/tv-mode.js`). It turns on in the TV app (its User-Agent ends in ` TV`), in known TV browsers (Android TV, Fire TV, BRAVIA, Mi TV/Box and others), or with `?tv=1`; `?tv=0` turns it off.
  - On pages, the direction keys move focus to the nearest button or card in that direction, inside the open panel when there is one. Focus has a large glow that is visible from the sofa, and OK clicks the focused element.
  - Playback fills the screen as soon as it starts:
    - OK: play / pause.
    - Left / right: ±10 s.
    - Up: episodes (focus lands on the current one).
    - Down / menu: playback settings.
    - Media keys: play, pause, rewind, fast-forward, next and previous episode.
  - The player uses the desktop layout (no touch layer, larger danmaku), and the cast and download buttons are hidden.
- Back key (both apps): the page handles it first through `window.LibreTVBack()`. It closes the playback settings, episodes, cast panel, dialogs, settings or history, then exits web fullscreen. Only after that does the app go back or close.
- Download card: the settings show both 下载手机版 and 下载电视版 on Android phones, Android TV and desktop (for sideloading by USB), and highlight the one that fits the current device. iPhone keeps its home-screen hint.
- Both apps are now 1.1.0 (versionCode 4), with the same signing key.

### Fixed

- The 历史 / 设置 buttons in the top bar wrapped their labels into a vertical column at widths around 960 px (for example a TV browser or a narrow window).

## 1.2.57 - 2026-10-31

### Added

- 一键优选 (Settings → 数据源设置): every source is timed on the viewer's own network.
  - Each source gets one search plus a short download of a real video segment (about 1 s, at most 1 MB, using the new quick mode of `SourceSpeed.probeEpisodeUrl`).
  - The fastest 6 normal sources are then selected. Mirrors of one network keep only their fastest member, custom sources are kept, and adult sources are re-picked only when some were selected.
  - The result lists every source's speed. 「撤销这次调整」 restores the previous selection.
- Automatic runs:
  - Once in the background on first visit.
  - A weekly re-test afterwards. It only swaps a selected source that failed or is over 3× slower than an unselected one of the same kind, and says so in Settings, with undo.
- Safeguards:
  - If fewer than 3 sources are playable (most likely a flaky network), sources that at least answer searches fill the selection.
  - On mobile data or Save-Data, only searches are timed.
  - A run that reaches nothing changes nothing.
- The settings source list is sorted by quality (measured speed, then the daily health check) and shows each source's speed. Automatic playback source choice and fallback also prefer faster sources.
- Sources:
  - New libraries: 爱蛋资源, 优质资源.
  - New backup mirrors: 量子资源 (影视工厂), 无尽资源（备用）, 魔都资源（备用）, 新浪资源 (极速 family).
  - Adult: 百万 and 丝袜 were removed (connections reset). Added 奥斯卡, 辣椒, 乐播, 奶香, 鲨鱼, 森林 and 杏吧, plus backup mirrors for 黄色仓库 and 玉兔. Each was checked by downloading a real video segment. souav, 滴滴 and 黑料 answer searches but their videos fail, so they are not added.
  - The defaults migration (`20261031-sources-v4`) drops removed sources from saved selections. It no longer re-adds the defaults for users who have optimised.

### Fixed

- Danmaku:
  - HTML entities such as `&#128014;` are decoded (🐎).
  - Platform emote codes such as `[狗头]`, `[吃瓜]`, `[呆住]`, `[马年大吉]` and two-part `[打卡-打][打卡-卡]` become matching emoji (about 80 known codes plus keyword hints). Unknown codes are dropped, and comments left empty are skipped. Plain brackets like `[0]` stay.
- Speed test: a sample that arrived in a single burst (small file or cache) reported impossible rates such as 333 MB/s. It is now timed from the request.
- The settings button to the diagnostics page is now labelled 诊断页. The new 一键优选 button sits in the source settings.

## 1.2.56 - 2026-10-31

### Fixed

- Android app 1.0.2:
  - On Android 15, apps are drawn edge to edge, so the site's top bar sat under the status-bar icons, and the bottom could hide behind the navigation bar or keyboard. The page now leaves room for the status bar, navigation bar, display cutout and keyboard. Fullscreen video still uses the whole screen.
  - The TV search (SSDP `M-SEARCH`) is sent on every LAN network interface instead of only the system default. Some phones route multicast to mobile data or a VPN, so TVs on the same Wi-Fi never heard the search. Mobile-data and VPN interfaces are skipped.
  - Same signing key, so it installs over 1.0.1.
- When no device is found, the cast panel now says that Apple TV and Mac speak only AirPlay, not DLNA. The README FAQ says the same and suggests an open-source DLNA receiver for testing on a Mac.

## 1.2.55 - 2026-10-31

### Changed

- Android app 1.0.1 asks for two permissions instead of four. It keeps `INTERNET` (the site, playback and cast commands) and `CHANGE_WIFI_MULTICAST_STATE` (finding TVs on Wi-Fi). `ACCESS_NETWORK_STATE` and `ACCESS_WIFI_STATE` were declared but never used, so they are gone. Both remaining permissions are normal install-time permissions with no prompts. Same signing key, so it installs over 1.0.0. The README and `android/README.md` list the permissions and why they are needed.

## 1.2.54 - 2026-10-31

### Added

- Android app (`android/`, published as `download/LibreTV.apk`, about 80 KB). It is a thin shell: a full-screen WebView opens your own LibreTV site, so site updates reach the app without reinstalling. The site address is entered once on first launch and can be changed later from the site's settings. It adds what an Android browser cannot do:
  - **Casting to a TV (DLNA)**. The player shows a 投屏 button. It finds TVs and boxes on the same Wi-Fi that accept DLNA (乐播, built-in TV casting, most Xiaomi / Huawei / Hisense / TCL / Skyworth sets) via SSDP, and tells the chosen one to play the episode over SOAP (`SetAVTransportURI` / `Play` / `Pause` / `Seek` / `Stop`). The TV fetches the stream itself and the phone can lock.
    - A bar under the player offers pause / resume, another device and stop casting.
    - The phone's own playback pauses while casting; switching episodes follows on the TV; the cast starts at the current position.
    - Plain `java.net`, no third-party SDK.
  - Video starts with sound (no tap needed), fullscreen switches to landscape and hides the system bars, and the screen stays on while playing.
  - Links to other sites open in the system browser, and 导入配置 can pick files.
- Site: `js/app-cast.js` (the device picker and cast bar, only active inside the app through `window.LibreTVApp`). The home settings show an App 设置 card inside the app (site address, version, 更换网站地址) and a 下载安卓 App card in Android browsers.
- README: an 安卓 App section, FAQ entries for installing and for troubleshooting casting, and `android/README.md` with build and signing instructions. The signing key is not in the repository.

Checked:
- The DLNA client against a simulated renderer: SSDP discovery finds it, and play with a start position, pause, resume, seek and stop arrive in order with the URL and title escaped correctly.
- 4 JVM unit tests for the description parsing, metadata escaping, seek format and SSDP headers.
- The web flow with a simulated app bridge: search, pick, local pause, the cast bar, pause, episode follow and stop.
- Android lint reports 0 errors, and the release APK's signature verifies.
- It has not yet been tried on a real phone and TV.

## 1.2.53 - 2026-10-31

### Fixed

- The footer's build time did not match the visitor's local time. The `VERSION.txt` stamp was shown as written, and recent stamps were not even the real release time. Stamps now record the release time in UTC, and the footer converts them to the visitor's time zone: this release reads 15:xx in Beijing and 00:xx in Los Angeles.

## 1.2.52 - 2026-10-31

### Added

- iPhone / iPad: how to install the site as an app. iOS has no install button or prompt; web apps are added from the browser's share menu.
  - The home page shows a one-time hint at the bottom ("知道了" hides it for good). The settings panel keeps the same instructions at the top.
  - The wording follows the browser: Safari's share button, Chrome / Edge / Firefox's share button next to the address bar, and in WeChat / QQ / Weibo / DingTalk's built-in browsers, a note to open the page in Safari first.
  - Nothing is shown on other devices or when the site was already opened from the home screen.

### Changed

- Muted autoplay: browsers, iPhone most of all, only allow video with sound after a tap on the current page, and the tap on the home page does not carry over to the player page, so playback starts muted. A 「🔇 点按开启声音」 button now sits on the picture instead of a toast that disappeared. A tap on the button, a tap anywhere on the page or any key restores the sound; the button tap does not also pause the video. Scroll gestures are deliberately not used, since iPhone pauses a video unmuted without a tap.
- README FAQ: installing on iPhone, why iPhone fullscreen cannot force landscape, and why videos may start muted.

## 1.2.51 - 2026-10-31

### Fixed

- iPhone: the fullscreen button only enlarged the player inside the page, with Safari's address bar and toolbars still showing. iPhone Safari cannot put a page element fullscreen (Android and iPad can), only the video itself, so the button now opens the system video player in real fullscreen (`webkitEnterFullscreen`).
  - The system player does not show the site's comments (弹幕) or gesture layer. For those, player settings → 网页全屏 (only shown on such devices) still offers the in-page fullscreen.
  - 画质增强 draws on a canvas over the video, which the system player does not show, so it pauses while in system fullscreen and comes back on exit.
  - Android, iPad and desktop are unchanged.

## 1.2.50 - 2026-10-31

### Security

- Dependency upgrades for GitHub's Dependabot alerts (50 alerts across 10 npm packages; `npm audit` now reports 0):
  - `axios` 1.9.0 → 1.21.0 (high), with its `follow-redirects` 1.16.2 (moderate) and `form-data` 4.0.6 (critical).
  - Through `express` 5.1: `proxy-addr` 2.0.8 (critical), `path-to-regexp` 8.4.2 (high), `body-parser` 2.4.0 (high), `qs` 6.17.1 (moderate).
  - Tailwind build tools: `picomatch`, `brace-expansion` and `minimatch` (high) updated in the lockfile.
  - All are lockfile updates within the declared ranges; `axios` now requires at least 1.21.0.
- `nodemon` is removed: even its latest release depends on a vulnerable `minimatch` 3.x, and npm's only fix was a downgrade to nodemon 1.0.2. `npm run dev` now uses Node's built-in `node --watch server.mjs` (restarts when the server code changes; pages, scripts and styles are read fresh on every request anyway). `nodemon.json` is deleted.

Checked after the upgrade: unit tests pass; `npm ci --omit=dev` (the Docker install) from the new lockfile; the Node proxy end to end (gzip bodies complete, `%2B` / `%26` kept, HTML sent as plain text, `Set-Cookie` dropped, private addresses refused, Range answered with 206); and that axios 1.21 calls the private-address DNS check on every redirect hop.

## 1.2.49 - 2026-10-31

Whole-project audit: bugs found by reading every page's code, each confirmed in the browser or by a test before fixing.

### Fixed

- The adult-content filter (on by default) hid ordinary titles. It matched words such as 成人, 福利 and 情色 anywhere in the title, the synopsis or the genre tags, so 长大成人, 孤儿 (福利院 in the synopsis), 爱情色香味, 摩登家庭 and 铁皮鼓 disappeared from results. Measured on four default sources and eight common words: 147 of 3,733 results were hidden, about 85 of them ordinary titles. Now category words (伦理片, 福利, 理论片…) are matched against the source's category only, and titles only against unambiguous words; synopses and genre tags are not read. Same measurement afterwards: 78 hidden, one of them arguably ordinary. Douban cards are only filtered when the switch is on.
- Home page Douban tags (热门, 最新, 美剧, 动作…) loaded nothing from servers outside mainland China: `movie.douban.com/j/search_subjects` redirects those requests to Douban's bot check, and the third-party fallback (`api.allorigins.win`) no longer answered. Tags now use the same mobile API as the filter panel (`m.douban.com/rexxar`): chart tags via `subject/recent_hot`, genre and custom tags via the recommend tag search. The fallback is removed, 换一批 wraps at the end of short lists, and switching 电影 / 电视剧 starts from the first page.
- Phones: dragging the inline progress bar did nothing, and every tap or drag on it threw `art.seek is not a function` (an old handler called `seek` as a function and stopped the player's own handler). The handler is removed; ArtPlayer's own seeking is used.
- Desktop: double-clicking the picture to go fullscreen also paused the video.
- 继续观看 → 全部历史 opened the history panel and closed it again in the same click.
- Daily source check-up:
  - It stopped adult and custom sources because they returned no result for the probe title. For those, only being unreachable counts now.
  - 恢复 on a stopped source did not stick (the next run stopped it again). A source restored by hand now stays on.
  - A run where most sources are unreachable (offline, proxy down) is no longer recorded.
  - The diagnostics page's 检测源 no longer unselects sources when most checks fail, and never leaves none selected.
- Safari 17+ (iPhone, Mac): right after hls.js attached through its own `<source>` element, the AirPlay helper replaced that element's address with the playlist, so Safari played the stream natively and the ad filter, quality menu and stats were bypassed. AirPlay now gets a separate HLS `<source>` after hls.js's. Not tested on a real Safari here.
- The 「已从 xx 继续播放」 hint was added to a hidden section and never seen; it now shows on the picture, also in fullscreen.
- 画质增强: if the GPU dropped the WebGL context, the picture stayed black with sound. It now falls back to the plain picture and says so.
- 换源 matched other sources' copies by title only, so for remakes (红楼梦 1987 / 2010) it could switch to a different work. The release year must now agree within a year when both sides have one.
- A damaged `selectedAPIs` / `customAPIs` value in local storage stopped the home and player scripts. It now falls back to the defaults.
- Config export now includes 稍后看, custom Douban tags, the Douban filter, danmaku / enhance / speed / skip settings and the check-up state. Imports skip values of the wrong shape instead of storing them, URL import accepts files served as `text/plain` (GitHub raw), and import errors show their real reason.
- 重试 did nothing for MP4 or natively played video; it now reloads and returns to the same position.
- The progress-bar preview lived outside the element that goes fullscreen, so in fullscreen it was invisible yet still downloaded preview segments.

### Security

- Proxy responses (Cloudflare, Node/Docker, Vercel, Netlify) are served from the site's own origin, and upstream pages, scripts, `Set-Cookie` and `Service-Worker-Allowed` were passed through, so a crafted proxy link could run script on the site or install a service worker. HTML / script responses are now sent as plain text, those headers are dropped, and every proxied response carries `X-Content-Type-Options: nosniff` and a sandboxing `Content-Security-Policy`. Vercel and Netlify no longer forward the visitor's Referer upstream.
- The player's 上一页 followed any `returnUrl`, including `javascript:` links and other sites; only same-site addresses are followed now (also for the saved last page).
- Custom source names / addresses and the episode number in viewing history were inserted into the page unescaped, so an imported config could run script.

### Fixed (Node.js / Docker only)

- Setting only `PASSWORD_HASH` (as the README describes) left the pages without a password and showed 「必须设置密码」.
- Compressed upstream responses were cut short: the original `Content-Length` was forwarded after decompression.
- Proxied addresses were URL-decoded twice, breaking links containing `%2B`, `%26` and the like.
- The private-address block missed `127.0.0.2`, `[::1]`, link-local / cloud metadata (`169.254.169.254`, `100.100.100.200`) and redirects. Every connection, redirects included, now checks the resolved address (skipped when an outbound `HTTP(S)_PROXY` resolves names).
- Range requests were not forwarded (MP4 seeking through the proxy) and speed tests (`probe=1`) downloaded whole files; both now behave like the Cloudflare proxy.
- Site pages, scripts and styles were cached for a day, so after an update browsers mixed new pages with old scripts. Only `libs/` and `image/` keep the long cache.

### Changed

- The service worker cached every visited page address, query string included (one copy per video watched); pages are now cached by path, and offline fallbacks no longer hand an HTML page to failed script or data requests.
- Removed unused code (old aggregated search, Douban tag fetch, search helpers, a status widget, a redundant proxy auth check) and two unused upstream images (`image/nomedia.png`, `.psd`, 256 KB).

## 1.2.48 - 2026-10-31

### Added

- 弹幕 (on-screen comments). For the title and episode being played, the player looks the work up on 360 影视 (`api.so.360kan.com`), takes the same episode's page on Tencent Video, iQiyi or Mango TV, and loads that episode's public comments: Tencent and iQiyi straight from the browser (both allow cross-origin reads), Mango TV through the site's proxy. Youku is not used (its comment API needs signed requests) and 360 rarely lists Bilibili. Films on several platforms use the one with the most comments. Rendering uses ArtPlayer's official danmaku plugin (`libs/artplayer-plugin-danmuku.js`, v5.3.0, MIT) without the send box.
  - Player settings → 弹幕: 关闭 / 稀疏 / 适中 / 密集, at most about 1 / 2 / 4 comments a second, keeping the most liked ones and dropping very long or repeated ones; remembered, and `D` toggles it. Phones show smaller text in the top half of the picture.
  - Segments near the playback position load first, so comments usually appear within about 3 seconds while the rest fills in; a new episode loads its own comments. The setting and 统计信息 show the platform and count, or that none were found.
  - Measured: 漫长的季节 episode 1 had 82,896 comments on Tencent Video (8,632 shown at 适中), 狂飙 loaded from iQiyi, 乘风破浪 from Mango TV.

### Fixed

- `js/api.js` treated every URL whose path starts with `/api/` as this site's own API, on any domain, which swallowed other services' requests (such as iQiyi's `pcw-api.iq.com/api/…`). Only same-origin `/api/` requests are handled now; `Request` objects are read correctly too.

## 1.2.47 - 2026-10-28

### Fixed

- Phone fullscreen showed two progress bars after tapping 更多: it switched on the player's own control bar, with its progress bar, while the fullscreen layer's bar stayed visible. 更多 now opens the player settings (speed, 画质增强, 统计信息, skip intro/outro…) above the fullscreen progress bar, on a solid, scrollable panel; tapping the picture closes it, and swipe gestures no longer start inside the panel.
- A phone held sideways (not fullscreen) showed a player taller than the screen, with its control bar below the bottom edge. In short landscape screens the player now fits the screen height.

## 1.2.46 - 2026-10-28

### Changed

- README rewritten around what the project does today: a feature overview (search with merged versions, automatic source choice, ad filtering, 画质增强, MP4 download, stats panel, daily source check-up, PWA, OpenClash rules), screenshots and a before/after comparison made from test streams, step-by-step deployment for Cloudflare Pages, Docker, Docker Compose and Node.js, an environment variable table, post-deployment checks, how to update, and an FAQ. The version badge now reads `package.json`.
- Docker: `docker-compose.yml` builds the image from this repository (`docker compose up -d --build`) instead of pulling the upstream `bestzwei/libretv` image, which has none of this fork's features; it documents `PASSWORD_HASH` and `PROXY_URL`. The Dockerfile installs with `npm ci --omit=dev` (the old `--only=production` flag is deprecated). Verified by building the image and running it: pages and new assets are served, the password is injected as a hash and the proxy answers 401 without it.

## 1.2.45 - 2026-10-28

### Added

- 画质增强 → 低画质修复, for TC copies and low-bitrate sources. Before upscaling it smooths compression blocks and noise with an edge-preserving filter at source resolution (small brightness steps are smoothed, real edges stay), and stretches a washed-out picture with automatic levels: about once a second a 64×36 thumbnail gives the 1st and 99th luma percentile, ignoring letterbox black, bounded (black point at most 0.2, white point at least 0.75, a range of at least 0.5) and blended in gradually so it never flickers; saturation is lifted by 10%. Then FSR upscaling with gentle sharpening. On a degraded test clip it widened the brightness range from 91–194 to 66–228, restored colour, and kept fine noise near the original level even after the contrast stretch, where 标准 doubled it; on a well-exposed clip it changed little (range 37–218 → 29–226, detail unchanged).

## 1.2.44 - 2026-10-28

### Added

- Player 画质增强 (player settings → 画质增强: 关闭 / 标准 / 锐利), independent of the graphics card brand and the same on Windows, macOS, Android and iOS. It runs AMD FidelityFX Super Resolution 1.0 (MIT) in the browser through WebGL2: EASU upscales edge-aware to the displayed size in device pixels, then RCAS sharpens with noise detection. 标准 sharpens moderately, 锐利 fully (old or soft sources, animation). Frames are drawn only when the video presents a new one (`requestVideoFrameCallback`), the choice is remembered, and the stats panel shows the mode and sizes. If frames start dropping, it first draws at 1× device pixels and then turns itself off with a notice; browsers without WebGL2 do not show the option. Off by default. Picture-in-picture and iPhone's system fullscreen show the original picture.

## 1.2.43 - 2026-10-28

### Added

- Desktop player: a 下载 button between 换源 and 更多 (not shown on phones and tablets). 下载本集（MP4） downloads the current episode's segments (four at a time, with retries), removes ad segments as playback does, decrypts AES-128 segments and saves one MP4 named after the title and episode. TS streams are converted with mux.js 7.1.0 (Apache-2.0, `libs/mux-mp4.min.js`, loaded only when needed), restarting the timeline at every discontinuity so the file plays straight through; fMP4 streams are joined directly. Chrome and Edge write to the chosen file while downloading; other browsers save the file when it is complete. A panel at the bottom right shows progress, size, speed and time left, and can cancel; streams mux.js cannot read (such as H.265) can be saved as TS instead. 复制视频地址 copies the m3u8 address for download tools such as IDM or N_m3u8DL-RE.

## 1.2.42 - 2026-10-28

### Added

- Player 统计信息, modelled on YouTube's "Stats for nerds": title and episode, source and video CDN host, viewport and dropped frames, current and highest resolution, video and audio codecs, measured bitrate, volume and speed, connection speed, network activity and buffer health with one-minute graphs, segment count with average time to first byte and download time, data downloaded for this episode, ad segments removed, progress, and player versions. Open it from the right-click menu or, on any device including phones, from the player settings. It refreshes every second while open, stays open across episodes and closes with its ✕ button or Esc.

### Fixed

- ArtPlayer's own video info panel could not be closed: the player's tap-to-pause handler took the click on its [x] and paused the video instead. The menu entry now opens the new panel, and clicks inside either panel no longer reach play/pause, long-press speed-up or fullscreen gestures.

## 1.2.41 - 2026-10-28

### Changed

- Player page: the recommendation section now shows Douban's "people who liked this also liked" titles for the video being played (for example 漫长的季节 → 边水往事, 狂飙, 隐秘的角落), in Douban's order. The Douban ID comes from the source, or from another source's copy of the same title when the current source lacks it, and is kept for the title so a source switch shows the same list. Titles without a Douban entry fall back to Douban's popular titles of the same genre and region (for example 中国大陆 · 犯罪). The heading says which one is shown. Recommendations no longer use a broad popularity list or the current source's latest uploads. Titles no selected source can play are still removed.
- Douban cards for titles Douban has not rated yet (too few ratings) show a muted 暂无评分 label instead of nothing, so a missing score is not mistaken for a loading problem. With 高分优先 these titles come after all rated ones.

### Fixed

- Douban titles without a poster yet showed Douban's generic grey picture. When a selected source has the title, its own cover is shown instead (home page cards and player recommendations). The availability check now remembers that cover.

## 1.2.40 - 2026-10-28

### Changed

- Search results that merge the same title from several sources now show every version on the card, by category and best first (for example `HD · 正片 · TC`), instead of only the first source's note.
- The 来源 list of a merged result tags each source with its version (HD, 正片, 更新TCV2…), clear versions first and camera copies highlighted; the player's 换源 list shows the same tags.
- Quick play prefers clear versions: 4K/蓝光/1080P, then HD, then 正片 and other notes, then TC/TS/抢先 copies; within a version the most reliable source wins. A copy being watched still comes first so playback resumes. When the first answer is a TC/TS copy, quick play waits up to 3 seconds for slower sources to offer a clear one, and automatic retries follow the same order.

## 1.2.39 - 2026-10-28

### Changed

- Pages load much faster: Tailwind classes are now prebuilt into `css/tailwind.css` (about 28 KB) instead of being compiled in the browser by a 407 KB runtime on every visit. On a throttled phone, first paint on the home page drops from about 1.3 s to 0.34 s and on the player page from about 1.16 s to 0.31 s; script time on the home page drops from 418 ms to 48 ms. Rendering is unchanged, verified element by element against the previous version. Run `npm run build:css` after changing Tailwind classes; `npm test` reports a stale file.
- About page: the header now matches the rest of the site (brand mark, centred title, home button) instead of squeezing the logo and title together on phones.

### Fixed

- The offline page (shown when the network is unavailable) had no styles because it never loaded Tailwind; it now renders as designed.

## 1.2.38 - 2026-10-28

### Changed

- Douban filter: shorter region labels, using the short region names that Douban's recommend API also accepts.

## 1.2.37 - 2026-10-28

### Added

- Daily source check-up in the browser, measured from the viewer's own network. Once a day the home page quietly searches each built-in source (and selected custom ones), keeps a short history, and shows a status dot next to each source in Settings. A selected source that has switched off keyword search (two days) or failed three days in a row is stopped automatically. When the stopped source has a healthy mirror of the same network, the mirror takes its place. Built-in sources that stay healthy and are not mirrors of a selected one are suggested. Every action can be undone from a notice in Settings.
- Sources are ranked by recent health and real playback quality (time to first frame, stalls) for quick play and for the source list of a grouped search result.
- Settings → 路由器直连规则 generates OpenClash DIRECT rules (`- DOMAIN-SUFFIX,域名,DIRECT`) for source APIs, video CDNs, poster hosts and Douban, ready to paste into OpenClash custom rules. CDN and image domains are learned from search results and played segments, because they rotate often (for example lzcdn28 → lzcdn29). Adult sources are listed in a separate section.
- `npm run evaluate:sources` (`scripts/evaluate-sources.mjs`) evaluates every built-in source plus optional candidates: search hit rate on six popular titles, latency, library size, last update, playlist and segment reachability, and ad breaks.

### Changed

- Source list review (October 2026): 卧龙, 飘零, 豆瓣资源 and 新浪 are removed. They no longer answer keyword searches (an anti-bot page, a Cloudflare challenge, "forbids keyword search", "server busy"). 非凡影视, 暴风资源 and 360资源 are added.
- Default sources are now 影视工厂, 非凡影视, 暴风资源, 极速资源 and 无尽资源. Existing users keep their choices: removed sources are dropped and the new defaults are added once.
- 极速, 虎牙, 光速, 金鹰, 红牛 and 豪华 are mirrors of one network (same catalogue and IDs, different CDNs). They are marked 同源 in Settings, and only one of them is selected by default.
- Opening a Douban recommendation no longer forces 豆瓣资源 (or any source) into the selection unless no searchable source is selected at all.

## 1.2.36 - 2026-10-28

### Added

- Douban recommendations hide titles that no selected source can play. Each card is checked in the background, source by source: the title must match, the release year may differ by at most one, the kind must fit (a film is not a same-name short drama), and the source must list a direct video URL. Results are cached (found: 3 days, missing: 6 hours). A note shows how many were hidden, with a button to show them dimmed, and the filter view loads another page when too few remain. The same check removes unplayable Douban items from the player page's 同类型推荐.
- Player page synopsis shows the Douban rating with a link to the Douban page, using the Douban ID and score that sources already provide.
- Player page header matches the home page and has a search box (an icon that expands on narrow screens) that opens search results without going back first.

### Changed

- Broken covers fall back to the same title's cover from another source, then to the Douban poster (looked up once by Douban ID and cached), instead of a grey placeholder. This matters for sources whose image host no longer resolves.
- Recommendation cards and Douban cards only show a rating that comes from Douban. Sources' own scores (often 1.0 or 10.0 placeholders) and "暂无" badges are gone.
- Long cast lists are clamped to two lines with an expand button.
- On phones, 同系列作品 and 同类型推荐 scroll horizontally, which roughly halves the page length.
- The 选集 button in the info bar is hidden on wide screens, where the episode column is already beside the player.

### Fixed

- Player errors no longer show the loading spinner on top of the error text, and on phones the error message and buttons fit inside the small player.

## 1.2.35 - 2026-10-28

### Changed

- The home page opens straight onto content. The large logo, tagline and "FREE" badge are replaced by a slim sticky top bar: brand on the left (click to return home), the search box in the middle, and History and Settings on the right. The bar stays visible while scrolling, so you can search from anywhere on the page.
- Recent searches appear in a dropdown under the search box when it is focused, and close when you type, search, press Esc or click elsewhere. On phones the dropdown spans the full width.
- On phones, 继续观看 is a horizontal swipe row instead of a stack of full-width cards, so recommendations start near the top of the screen.

## 1.2.34 - 2026-10-27

### Added

- Home page Douban section has a 筛选 panel that combines genre, region, year or decade, and sort (综合排序 / 近期热度 / 最新上映 / 高分优先), for example 欧美 + 2026 + 高分优先. TV adds 电视剧 / 综艺 as a format with its own genres. Results load 24 at a time with 加载更多, cards show year and region, and the chosen filters are remembered. Picking a quick tag returns to the tag view. It uses the same recommend API as Douban's own explore page, through the site proxy.
- Search results have a filter and sort bar: kind (电影 / 剧集 / 动漫 / 综艺 / 纪录片 / 短剧, with counts), year, region, and sort by relevance, newest year, rating or most recently updated. Kinds and regions are normalised across sources ("国产动漫" and "中国动漫", "大陆" and "中国大陆"), and genre-only type names fall back to the episode count. Cards show the rating when a source provides one.

### Changed

- Search results are ordered by relevance instead of alphabetically: exact titles first, then titles starting with the query, shorter titles before long spin-offs, then newer releases.
- Search card buttons no longer wrap or get cut off in the four-column layout. "查看来源" is now "来源", and long source names are truncated.

## 1.2.33 - 2026-10-27

### Fixed

- Titles containing an apostrophe (for example "Grey's Anatomy") no longer break the episode buttons in the detail dialog or the entries in the viewing history. Values in these inline handlers are now encoded as JavaScript literals, so a title returned by a source can no longer inject script.
- Detail fields from sources (type, year, area, director, actors, remarks, synopsis) are reduced to plain text and escaped before display instead of being inserted as raw HTML.
- Playback that breaks off mid-episode (a segment that keeps failing, a dropped connection, a decoding error) is now recovered: network errors retry with backoff (1, 2, 4, 8 s), media errors are repaired, and after repeated failures a small notice offers retry or switching sources instead of an endless spinner. Reconnecting to the network retries automatically.
- Switching sources no longer stores "未知视频" as the current title.

### Changed

- Ad filtering now removes ad breaks spliced into playlists: short runs of segments between discontinuity markers that come from another host or directory, or have a different file-name pattern. Ambiguous playlists are left untouched, and discontinuity markers are kept, because deleting them (the previous behaviour) left the ads in place and could scramble timestamps.
- Search fetches at most 10 result pages per source, three at a time, instead of up to 50 pages at once, to avoid rate limiting by sources and needless proxy requests. Background lookups in the source picker stop when the dialog closes.

## 1.2.32 - 2026-10-27

### Changed

- The footer shows the release number together with the build time, for example "版本: v1.2.32（2026-10-27 16:30）", including when the update check fails.

## 1.2.31 - 2026-10-27

### Added

- Keyboard shortcuts: Space/K play-pause, J/L ±10 s, M mute, N/P next/previous episode, [ / ] speed, 0–9 jump to 0–90%, W web fullscreen, and holding → plays at 3x until released (a short press still seeks +5 s). Press ? for a shortcut help panel, also reachable from the settings panel on desktop. Volume, speed and mute changes show their new value. Browser shortcuts with Ctrl/Cmd are left alone.
- Touch: double-tap the left or right third of the video to seek ±10 s; the middle plays or pauses. In mobile fullscreen, a horizontal swipe seeks with a time preview (up to two minutes per screen width), and long-press 3x speed now works there too.

### Fixed

- Seeking (dragging the progress bar, swiping or jumping by keyboard) no longer jumps back to the last saved progress point when the video buffers again. Saved progress is now restored only once per load.
- Long-press speed works after Artplayer moves the player into its fullscreen layer, and a swipe cancels a pending long press.
- The player's theme color matches the site theme. The episode counter appears once, in the info bar, including the episode name.

## 1.2.30 - 2026-10-27

### Added

- Skip intro and outro per title: in the player settings panel (also in fullscreen), mark "片头结束" and "片尾开始" while watching. Every episode of that title then skips the intro and moves on at the outro. The outro is stored as time before the end, so it fits episodes of different lengths, and the feature can be switched off.
- The next episode's playlist, init segment and first segment are fetched during the last minute of an episode, so switching starts faster. On data-saver or low-resource devices only the playlists are fetched.
- Desktop playback offers web fullscreen (网页全屏). Touch devices keep a single fullscreen path.
- On screens 1280px and wider, series show an always-visible episode column beside a larger player.

### Fixed

- Skipping, preloading and the next-episode countdown wait for the new episode's metadata, so the previous episode's position can no longer skip an extra episode or flash the countdown during a switch.

## 1.2.29 - 2026-10-27

### Added

- An in-player episode list (选集) opens from the control bar and from mobile fullscreen, so episodes can be picked without leaving fullscreen. Variety-show episodes named by date or title show their names; plain numbered names show just the number.
- A visible speed (倍速) button sits in the control bar, and the chosen speed is remembered across episodes, reloads and titles. The temporary long-press 3x speed is not remembered.
- During the last seconds of an episode a card shows the next episode with a countdown, Play now and Cancel. Cancel stops the automatic next episode for that episode.

### Fixed

- Switching episodes quickly no longer mutes playback or shows the "已静音自动播放" notice. Only a real autoplay-policy block mutes.
- On touch screens a single tap shows or hides the controls and a double tap plays or pauses, instead of a single tap pausing.
- Shortcut hints appear centered over the video, including in fullscreen, and show the actual play state.
- The left arrow key in the first five seconds returns to the start.

## 1.2.28 - 2026-10-12

### Added

- Recommendation posters show a bottom-left star rating, matching home-page cards.
- Touchscreen fullscreen playback uses tap-to-show controls, a dedicated center play/pause button, a seek bar, and swipe gestures for video brightness and media volume. Other player controls remain available through More.

### Fixed

- Fullscreen gestures and controls stay attached to the video when Artplayer moves it into its fullscreen layer.

## 1.2.27 - 2026-10-12

### Added

- The player page shows the current video's synopsis, metadata, and optional cover below playback.
- Related titles place other seasons or film installments first in release order, followed by same-type recommendations.
- Recommendations use source popularity when available, then ratings and newer releases; the popular feed fills sparse source catalogs without delaying playback.

### Fixed

- Matching franchise titles from multiple sources are deduplicated, and the current work, trailers, and commentary are excluded.

## 1.2.26 - 2026-10-12

### Added

- Home page shows unfinished videos with episode and progress, and supports a local Watch Later list.
- Search reveals fast source results immediately and groups matching title, year and type into one card with source choices.
- Playback records local startup and stall performance to prefer reliable sources without delaying first play.

### Changed

- Player actions are grouped into source, episode and more controls; source choices use a compact, live speed list.
- Playback status clears only after video starts. Episode lists are isolated by tab and verified against the current source for shared links.

### Fixed

- Slow search sources no longer block fast results; stale search responses cannot replace a newer query.
- Automatic retries are bounded, and a user-selected source is never replaced automatically.

## 1.2.25 - 2026-10-11

### Added

- One-click playback from homepage and search cards, verified history resume, and conservative version matching.
- Startup recovery tries at most two alternate sources, while manual source, episode and detail controls remain available.
- Mobile fullscreen attempts landscape orientation and releases the lock on exit; unsupported browsers retain native playback.

### Fixed

- Cross-source episodes use labels instead of array positions, with explicit selection when no safe match exists.
- History entry preserves title identity and episode metadata for later resume.

## 1.2.24 - 2026-10-10

### Fixed

- Douban recommendations load once when the home page opens. Previously the list was fetched and rendered twice, or four times after the password check re-ran initialization, so every cover image loaded again.
- `initDouban()` now runs its setup once, and later calls only refresh visibility. In-flight Douban list requests are shared per URL, so switching tags A → B → A reuses the first request. Only the latest selection renders.

## 1.2.23 - 2026-10-10

### Fixed

- Source speed checks are now accurate. They read the complete HLS playlist (long playlists used to be cut at 64 KiB, leaving a broken segment URL), sample an early real media segment for up to 2.5 s or 2 MiB, and report throughput measured from the first byte separately from connection latency.
- Speed samples run one source at a time so sources no longer compete for bandwidth.
- Each source now shows a smoothness verdict (流畅 / 较流畅 / 可能卡顿) that compares throughput with the stream bitrate, taken from the master playlist or estimated from segment size and duration. The best source is marked 推荐, and the player's resource switcher ranks sources the same way.
- The home page no longer reloads itself on the first visit or after a release. The service worker no longer forces a reload when it takes control, and app scripts and styles are now fetched network-first so a new release applies cleanly on the next navigation. The service worker also no longer intercepts third-party requests such as posters.

### Changed

- The Cloudflare Pages proxy speed probe now allows ranges up to 2 MiB.

## 1.2.22 - 2026-10-10

### Changed

- Redesigned the UI with a modern theme: animated aurora background, glassmorphism panels, gradient accents and refined motion across the home, player, about, diagnostics and offline pages.
- Rebuilt the home page hero, search bar, Douban section, side panels and footer; all element IDs and handlers are unchanged.
- Added `css/theme.css`, which also restyles script-generated cards, tags, episode buttons, modals and toasts without changing JavaScript, and respects `prefers-reduced-motion`.

## 1.2.21 - 2026-10-10

### Fixed

- Source speed checks now sample the same direct media path used for playback, with the authenticated proxy as a clearly labeled fallback.
- When neither path can be measured, the source stays selectable and shows an inconclusive speed status rather than claiming playback is unavailable.

## 1.2.20 - 2026-10-10

### Added

- Movie details now show each matching source immediately and update its source speed as a small media sample completes.
- Resource switching in the player now shows actual sampled transfer rates instead of API response times.

### Changed

- Cloudflare Pages proxy streams authenticated, uncached range probes capped at 64 KiB so source comparisons do not buffer full media files.

## 1.2.19 - 2026-09-23

### Fixed

- Fixed version checks to use the maintained repository and GitHub API with a Raw fallback.
- The footer now keeps showing the deployed version when the remote update check is unavailable.

## 1.2.18 - 2026-09-23

### Fixed

- Restored the centered paused-play icon and ArtPlayer's loading-state visibility by removing conflicting mask overrides.

## 1.2.17 - 2026-05-12

### Fixed

- The player cast button now hides when the current browser or device reports no available native cast target.
- Removed inactive aspect ratio and flip player controls that did not affect playback reliably.

## 1.2.16 - 2026-05-12

### Fixed

- Fixed player control menu clicks so playback surface handling no longer pauses through settings submenus.
- Removed duplicate player controls from the bottom bar while keeping the rightmost fullscreen path and mobile landscape lock.
- Fixed the resource switch modal so it remains visible when opened from fullscreen playback.

### Changed

- Kept the top cast button and added a same-origin Presentation API cast receiver fallback before Remote Playback.
- In mobile portrait playback outside fullscreen, the bottom bar now keeps only settings, picture-in-picture, and fullscreen visible.

## 1.2.15 - 2026-05-12

### Changed

- Updated the about and privacy page GitHub repository link to the maintained `wxst/LibreTV` repository.
- Updated the privacy complaint contact email to `9991818@gmail.com`.

## 1.2.14 - 2026-05-12

### Changed

- Fixed the player play/pause hotzone so normal video-surface clicks toggle playback from the correct visual center.
- Added a top in-player native cast button with Remote Playback and AirPlay fallback.
- Added `Alt+Enter` fullscreen, mobile landscape orientation locking for landscape videos, and HLS quality controls.

## 1.2.13 - 2026-05-12

### Fixed

- Fixed player resource switching after search relevance helpers moved out of the player page load path.
- Player resource switching now falls back to the default selected sources when no local source selection exists.
- Added empty-state handling when no switchable resources are found.

## 1.2.12 - 2026-05-12

### Changed

- Upgraded the bundled ArtPlayer and hls.js player libraries for the modernized player stack.
- Increased HLS buffering on capable devices while keeping a conservative fallback for mobile, low-memory, or data-saver clients.
- Refreshed the player surface with progress-preview UI, autoplay fallback, and source switching that resumes from the current playback time.

## 1.2.11 - 2026-05-12

### Fixed

- Search results now require title relevance so sources that ignore keywords cannot flood unrelated adult content into normal searches.
- The `成人视频` home tag now loads latest entries from selected adult sources instead of querying Douban as a normal tag.
- Normal Douban home categories now filter adult-looking cards and keep adult content isolated to the dedicated adult tag.

## 1.2.10 - 2026-05-12

### Changed

- Yellow content filtering now skips adult sources before searching and filters adult-looking results by title, type, remarks, content, and source.
- When yellow content filtering is disabled, adult results use a dedicated `成人视频` badge instead of mixing adult categories into normal result labels.
- The settings panel no longer embeds the source health report; its diagnostics entry is now labeled `检测源`.

## 1.2.9 - 2026-05-12

### Changed

- Source health checks now run up to 10 probes concurrently to reduce waiting time.
- Failed selected sources are automatically unchecked and saved after a health check.

## 1.2.8 - 2026-05-11

### Changed

- Source health checks now cover all built-in and custom sources instead of only the default selected sources.
- Renamed the settings action from `检测默认源` to `检测源`.

### Fixed

- Loaded the shared modal stylesheet on the home page so the first-run guide opens as a centered overlay instead of appearing in page flow.

## 1.2.7 - 2026-05-11

### Added

- Added GitHub search and migration intake documentation for repository-only outreach.
- Added an upstream migration issue template and issue/discussion entry points for users coming from archived LibreSpark/LibreTV.
- Added release notes for the GitHub search and migration intake update.

### Changed

- Strengthened README search positioning for LibreTV Revival as a maintained self-hosted fork of archived LibreSpark/LibreTV.

## 1.2.6 - 2026-05-11

### Changed

- Clarified the GitHub outreach runbook after verifying the archived upstream repository is read-only and cannot accept new issue comments.
- Updated README outreach wording to route migration users through repository metadata, releases, and this repository's Discussions when upstream issue replies are blocked.

## 1.2.5 - 2026-05-11

### Added

- Added an upstream migration and FAQ guide for users coming from the archived LibreTV repository.
- Added GitHub release notes and upstream issue reply guidelines for repository-only outreach without public deployment URLs.

### Changed

- Strengthened README positioning around the maintained self-hosted fork and GitHub-first migration entry.

## 1.2.4 - 2026-05-11

### Added

- Added verified optional adult API sources from upstream PR triage; they are marked `adult: true` and remain disabled by default.

## 1.2.3 - 2026-05-11

### Added

- Imported useful upstream PR learnings: optional Docker outbound proxy support via `PROXY_URL`.
- Added verified optional API sources from post-maintenance upstream PRs while keeping the default selected sources unchanged.

## 1.2.2 - 2026-05-11

### Changed

- Removed local agent notes from repository tracking and ignored `agent.md` so development environment state is not published to GitHub.

## 1.2.1 - 2026-05-11

### Changed

- Removed public site URL metadata from the current codebase and added a guard test to prevent deployment URLs from being reintroduced.
- Documented PR-first maintenance for `main` and Cloudflare preview deployment privacy settings.
- Removed obsolete upstream sync, auto-version, Docker publish, and unconfigured spam workflows that could interfere with protected `main` maintenance.

## 1.2.0 - 2026-05-11

### Added

- Added source health checks with search, detail, and playable m3u8 probes for default sources.
- 新增源健康检查：默认源会检测搜索、详情和 m3u8 可访问性。
- Added a diagnostics page for password, proxy, PWA, and source status without exposing secrets.
- Added first-run guidance for password setup, source selection, PWA install, and config backup.
- Added an optional browser smoke script for manifest, diagnostics, service worker, and basic page checks.

### Changed

- Config import/export is now versioned, validated, and migrates old `1.0.0` exports to `2.0.0`.
- Player failures are classified into source, m3u8 403/404, proxy, timeout, and browser support errors with a one-click source switch action.
- Split source health, playback error classification, and config storage logic into focused modules.

## 1.1.5 - 2026-05-11

### Added

- Added the public maintenance foundation: refreshed README, roadmap, changelog, issue templates, pull request template, and CI.
- 公开维护基础：补齐 README、ROADMAP、CHANGELOG、issue 模板、PR 模板和 CI。
- Added explicit release rules requiring every user-visible change to bump package metadata, `SITE_CONFIG.version`, `VERSION.txt`, and this changelog.

### Changed

- Repositioned this repository as a maintained continuation of the archived upstream project.
- Updated contributor guidance for the current repository, Apache-2.0 license, security boundaries, and self-hosting expectations.

## 1.1.4 - 2026-05-11

### Added

- Added installable PWA metadata, maskable icons, service worker registration, and offline app shell.

### Changed

- Kept API, proxy, m3u8, and media requests network-only while caching only the application shell.

## 1.1.3 - 2026-05-11

### Changed

- Refreshed default video sources after probing search, detail, and playable m3u8 behavior.
- Removed invalid placeholder and unreachable sources from the user-visible list.

## 1.1.2 - 2026-05-11

### Fixed

- Preferred directly playable m3u8 sources over share pages when parsing MacCMS detail responses.
- Repaired stale player URLs by resolving the latest playable episode from detail data.

## 1.1.1 - 2026-05-11

### Added

- Added the 影视工厂 default source.

### Fixed

- Added cover image normalization, no-referrer loading, proxy fallback, and placeholders.

## 1.1.0 and earlier

Historical upstream baseline before this maintained fork started recording a changelog.
