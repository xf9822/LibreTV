<div align="center">

<img src="image/logo.png" width="88" alt="LibreTV">

# LibreTV Revival

**自部署的影视聚合搜索与播放器**

一个搜索框搜遍多个资源站，播放器自带去广告、画质增强、下载和统计信息。
部署在你自己的 Cloudflare Pages 上，免费、无需服务器、无需构建。

[![CI](https://github.com/wxst/LibreTV/actions/workflows/ci.yml/badge.svg)](https://github.com/wxst/LibreTV/actions/workflows/ci.yml)
![Version](https://img.shields.io/github/package-json/v/wxst/LibreTV?color=8b5cf6&label=version)
![License](https://img.shields.io/badge/license-Apache--2.0-blue)
![Cloudflare Pages](https://img.shields.io/badge/deploy-Cloudflare%20Pages-f38020)

[功能特色](#-功能特色) · [部署](#-部署) · [常见问题](#-常见问题) · [更新日志](CHANGELOG.md)

</div>

![播放页与统计信息](docs/images/player-stats.jpg)

> 本仓库是已归档上游 [LibreSpark/LibreTV](https://github.com/LibreSpark/LibreTV) 的维护续作，从上游迁移请看 [MIGRATION.md](MIGRATION.md)。本仓库只提供代码和文档，不提供公开演示站点。
>
> LibreTV Revival is a maintained, self-hosted fork of the archived LibreSpark/LibreTV: multi-source MacCMS VOD API search, an HLS player with ad-segment filtering, FSR-based video enhancement, MP4 download and stats for nerds, deployable on Cloudflare Pages with zero build.

## ✨ 功能特色

| 特色 | 说明 |
|---|---|
| 🔍 **多源聚合搜索** | 内置 18 个资源站同时搜，同名影片合并成一张卡片，标出每个来源的版本（HD · 正片 · TC） |
| 🎯 **自动选最好的源** | 点开即播：优先清晰版本，再按资源站稳定程度挑；断流自动恢复、自动换源 |
| 🚫 **去广告** | 自动识别并跳过插在正片里的广告片段 |
| 🎨 **画质增强** | 基于 AMD FSR 1.0 的实时放大锐化，另有专治 TC 版的「低画质修复」；不挑显卡，手机也能用 |
| ⬇️ **下载为 MP4** | 电脑版一键下载当前集，自动去广告、解密、转成 MP4 |
| 📊 **统计信息** | 仿 YouTube「详细统计信息」：连接速度、缓冲、码率、编码、丢帧一目了然 |
| 🩺 **资源站自动体检** | 每天自动检测各资源站，坏了自动停用并换上同源镜像 |
| 📱 **装成 App** | 支持 PWA，手机和电脑都能「添加到桌面」，全屏手势操作 |

### 🔍 找片

- **聚合搜索**：多个资源站并发搜索，结果边搜边显示；可按类型、年份、地区筛选，按相关度、年份、评分、更新时间排序。
- **同名合并**：同一部片子的多个来源合并成一张卡片，卡片上列出所有版本（如「HD · 正片 · TC」），「来源」列表里每个站都标明版本。
- **豆瓣发现**：首页的豆瓣热门和组合筛选（类型 + 地区 + 年代 + 排序，如「欧美 · 2026 · 高分优先」）；所有已选资源站都播不了的片子自动隐藏，豆瓣没海报时用资源站封面补上。
- **继续观看 / 稍后看 / 观看历史**，全部只保存在你自己的浏览器里。

### ▶️ 播放

- **自动选源**：点卡片直接播放，按 4K/蓝光 > HD > 正片 > TC 的顺序挑版本，同档再挑最稳的站；看到一半的来源优先续播。
- **不中断**：播放中途断流会自动重连，启动失败自动换下一个来源。
- **追剧体验**：跳过片头片尾（按剧记忆）、下一集倒计时和提前预加载、宽屏右侧选集栏、倍速记忆。
- **操作**：键盘快捷键（按 `?` 查看）；手机上双击快进快退、横滑拖进度、左右竖滑调亮度和音量、长按 3 倍速；网页全屏、画中画、投屏。
- **发现更多**：影片简介和豆瓣评分、同系列作品、豆瓣「看过的人也喜欢」相似推荐。

### 🎨 画质增强（全平台通用）

在浏览器里用设备自己的 GPU（WebGL2）实时处理画面，Windows、Mac、Android、iOS 都能用，不需要 N 卡。在播放器设置 → 画质增强里选择：

| 模式 | 做什么 | 适合 |
|---|---|---|
| 标准 | AMD FSR 1.0：边缘自适应放大到屏幕分辨率 + 适度锐化 | 大多数片子 |
| 锐利 | 同上，锐化更强 | 发虚的老片、动漫 |
| 低画质修复 | 先去块降噪、自动拉开对比度和色彩，再 FSR 放大 + 温和锐化 | TC 版、枪版、低码率片源 |

![画质增强对比](docs/images/enhance-compare.jpg)

<img src="docs/images/enhance-menu.jpg" width="560" alt="播放器设置里的画质增强">

设备跑不动时会自动降低精度，还不行就自动关闭并提示，不会卡住播放。默认关闭，选过一次会记住。

### ⬇️ 下载（电脑版）

播放页「换源」和「更多」之间的「下载」按钮：

- **下载本集（MP4）**：4 路并发下载，失败自动重试；和播放时一样去掉广告；自动解密 AES-128 加密的视频；TS 片段在浏览器里转成 MP4。Chrome / Edge 边下边写进你选的位置，大文件也不占内存。
- **复制视频地址**：把 m3u8 地址交给 IDM、N_m3u8DL-RE 等下载工具。

<img src="docs/images/download.jpg" width="560" alt="下载进度">

### 📊 统计信息

在视频上右键（手机在播放器设置里）打开「统计信息」：资源站和视频服务器、分辨率和丢帧、编码和实测码率、连接速度 / 网络活动 / 缓冲健康度（带一分钟小图）、分片耗时、本集流量、去掉了几段广告、画质增强状态。

### 🩺 资源站自动体检

- 每天在你的浏览器里检测各资源站能不能搜索，设置里每个站旁边有健康状态点。
- 连续失败或关闭了搜索的站会自动停用，有同源镜像的自动换上；稳定好用的站会推荐给你。所有自动操作都能一键撤销。
- `/diagnostics.html` 诊断页检查密码保护、代理、PWA 和资源站状态。

### 🌐 其他

- **OpenClash 直连规则**：设置 → 路由器直连规则，一键生成资源站、视频服务器、海报、豆瓣的 `DOMAIN-SUFFIX,域名,DIRECT` 规则，粘贴到 OpenClash 即可。
- **配置导入导出**：换设备时在设置里导出、导入即可迁移资源站选择和偏好。
- **快**：样式预编译，手机首屏约 0.3 秒（4 倍 CPU 降速模拟测得）。

## 🚀 部署

> 部署时**必须设置访问密码**（`PASSWORD`），否则任何人都能使用你的实例。

### 方式一：Cloudflare Pages（推荐，免费）

1. **Fork 本仓库**：点右上角 **Fork**，复制一份到你自己的 GitHub 账号。
2. **创建 Pages 项目**：登录 [Cloudflare 控制台](https://dash.cloudflare.com/) → **Workers 和 Pages** → **创建应用程序** → **Pages** → **连接到 Git**，选择你 fork 的仓库。
3. **构建设置**（这个项目不需要构建）：
   - 框架预设：`None`
   - 构建命令：留空
   - 构建输出目录：留空
   - 根目录：留空
4. **设置密码**：在「环境变量」里添加 `PASSWORD`，值为你的访问密码（不想在 Cloudflare 里存明文，可以改用 `PASSWORD_HASH`，见下方环境变量表）。
5. 点 **保存并部署**，完成后打开 Cloudflare 分配的默认域名，输入密码即可使用。

部署后建议：

- **绑定自己的域名**（项目 → 自定义域），Cloudflare 的默认域名在部分网络下访问不稳定。
- 如果部署后才添加或修改了环境变量，需要到「部署」里对最新一次部署点 **重试部署** 才会生效。
- 不需要预览环境的话，在「设置 → 构建」里把 Preview deployments 设置为 `None`，并关闭 PR comments，避免多出公开入口。

### 方式二：Docker

需要先安装 Docker。镜像从本仓库的代码构建：

```bash
git clone https://github.com/wxst/LibreTV.git
cd LibreTV
docker build -t libretv .
docker run -d --name libretv --restart unless-stopped \
  -p 8899:8080 \
  -e PASSWORD=你的密码 \
  libretv
```

或者用 Docker Compose：先把 `docker-compose.yml` 里的 `PASSWORD` 改成你的密码，然后执行：

```bash
docker compose up -d --build
```

浏览器打开 `http://服务器IP:8899`。如果服务器在海外，部分资源站可能拒绝海外访问，可以设置 `PROXY_URL` 让服务器经代理访问资源站（见下表）。

> 注意：`bestzwei/libretv` 是上游的旧镜像，不包含本仓库的任何新功能，请按上面的方法自己构建。

### 方式三：本地运行（Node.js 20+）

```bash
git clone https://github.com/wxst/LibreTV.git
cd LibreTV
npm install
cp .env.example .env   # 编辑 .env，把 PASSWORD 改成你的密码
npm start              # 开发时用 npm run dev，改代码自动重启
```

打开 `http://localhost:8080`。注意要用 `npm start` / `npm run dev` 启动，普通静态服务器没有代理功能，搜索会失败。

### 其他平台

仓库里还保留了上游的 Vercel（`vercel.json`、`api/`）、Netlify（`netlify.toml`、`netlify/`）和 Render（`render.yaml`）配置，同样通过 `PASSWORD` 环境变量设置密码。这些平台**没有在本维护版上验证过**，推荐优先使用 Cloudflare Pages 或 Docker。

### 环境变量

| 变量 | 适用 | 说明 |
|---|---|---|
| `PASSWORD` | 全部 | **必填**，访问密码 |
| `PASSWORD_HASH` | Cloudflare / Node / Docker | 可代替 `PASSWORD`，填密码的 SHA-256（小写十六进制），不留明文。生成：`printf '%s' '你的密码' \| sha256sum` |
| `PORT` | Node / Docker | 监听端口，默认 `8080` |
| `PROXY_URL` | Docker | 服务器访问资源站时使用的代理，如 `socks5://192.168.1.2:7890`（支持 http / socks4 / socks5） |
| `REQUEST_TIMEOUT` | Node / Docker | 代理请求超时，毫秒，默认 `5000` |
| `BLOCKED_HOSTS`、`BLOCKED_IP_PREFIXES` | Node / Docker | 代理禁止访问的主机和内网网段，默认已屏蔽本机和常见内网 |

### 部署后自检

- 打开网站，页脚能看到版本号；访问 `/VERSION.txt` 返回一串 12 位数字。
- 未登录直接访问 `/proxy/...` 应返回 **401**（说明代理受密码保护）。
- 打开 `/diagnostics.html` 查看密码、代理、PWA 和资源站状态。

### 更新到最新版本

- **Cloudflare Pages**：在你 fork 的 GitHub 仓库页面点 **Sync fork → Update branch**，Cloudflare 会自动重新部署。
- **Docker**：在仓库目录执行 `git pull`，然后重新 `docker build` 并重建容器（Compose 用户执行 `docker compose up -d --build`）。
- **本地运行**：`git pull` 后重启。

打开过的页面会在下次访问时自动换成新版；如果样式看起来不对，刷新一次即可。

## ❓ 常见问题

<details>
<summary><b>搜不到片子，或者某些资源站一直没结果</b></summary>

资源站会不定期关闭搜索或出故障。站点内置每日体检，坏掉的站会被自动停用并换上同源镜像；也可以在设置里手动勾选其他资源站。设置里每个站旁边的状态点显示最近的检测结果。
</details>

<details>
<summary><b>能搜到但播放失败</b></summary>

视频文件是浏览器直接从资源站的视频服务器加载的，这些服务器大多只对中国大陆网络开放。如果你在用代理或海外网络，可能会播放失败：可以让浏览器直连这些域名（OpenClash 用户见下一条），或在播放页点「换源」换一个来源。
</details>

<details>
<summary><b>用 OpenClash 时怎么让视频直连</b></summary>

设置 → 路由器直连规则 → 复制全部，粘贴到 OpenClash →「覆写设置」→「规则设置」→「自定义规则」。视频服务器域名会随使用自动增加，隔段时间重新生成一次即可。
</details>

<details>
<summary><b>NVIDIA「RTX 视频超分辨率」显示非活动</b></summary>

RTX 超分只在把视频放大显示时才工作：1080P 片源在不到 1080P 大小的窗口里不会启动，可以用 720P 片源全屏测试。笔记本需要在 Windows「设置 → 显示 → 显卡」里把浏览器设为「高性能」，并插上电源。不想折腾的话，直接用播放器自带的「画质增强」，不挑显卡。
</details>

<details>
<summary><b>开了画质增强后卡顿或发热</b></summary>

画质增强用设备的 GPU 实时处理，老旧设备或核显可能吃力。掉帧时会自动降低精度，仍不行会自动关闭；也可以在播放器设置里手动选「关闭」。
</details>

<details>
<summary><b>下载按钮在哪？手机能下载吗？</b></summary>

下载只在电脑版提供，位于播放页「换源」和「更多」之间，推荐用 Chrome 或 Edge。手机浏览器内存有限，大文件容易下载失败，所以没有提供；可以用「复制视频地址」交给手机上的下载工具。下载期间请保持页面打开。
</details>

<details>
<summary><b>换手机或电脑后设置都没了</b></summary>

所有设置和观看记录只保存在浏览器本地。在旧设备的设置里「导出配置」，到新设备「导入配置」即可。
</details>

<details>
<summary><b>怎么装成 App</b></summary>

手机浏览器菜单里选「添加到主屏幕」，电脑上的 Chrome / Edge 地址栏右侧有安装按钮。安装后以独立窗口打开；离线时只能打开应用外壳，搜索和播放需要联网。
</details>

## ⚠️ 声明

- 本项目只提供视频搜索与播放工具代码，不存储、上传、分发任何视频内容。
- 本项目仅供学习、研究和个人自部署使用，不建议公开运营实例。
- 所有第三方资源站的可用性、合法性和内容风险由部署者自行判断。
- 视频分片和接口请求不做离线缓存。

## 🛠️ 开发

```bash
npm install
npm test               # 单元测试 + 静态检查
npm run dev            # 本地开发服务器
npm run build:css      # 修改了 HTML / JS 里的 Tailwind 类之后重新生成 css/tailwind.css
npm run evaluate:sources  # 评估内置资源站的搜索命中率、速度和片库
npm run smoke:browser  # 可选：浏览器冒烟检查（需要 Playwright）
```

- 页面样式里的 Tailwind 类预先编译在 `css/tailwind.css`（随仓库提交，部署无需构建）。类名要完整写出，不要拼接成 `bg-${color}`，否则扫描不到；`npm test` 会检查该文件是否过期。
- 每次用户可见变更都要同步更新 `package.json`、`package-lock.json`、`js/config.js` 里的 `SITE_CONFIG.version`、`VERSION.txt` 和 `CHANGELOG.md`。
- CI 在 push 和 pull request 上运行测试、JS 语法检查和空白检查；`main` 只作为通过 CI 后的生产部署分支，变更通过 PR 合并。

更多：[CHANGELOG.md](CHANGELOG.md) · [ROADMAP.md](ROADMAP.md) · [CONTRIBUTING.md](CONTRIBUTING.md) · [MIGRATION.md](MIGRATION.md)

## 🤝 反馈与贡献

- 部署、资源站、代理等使用问题：[GitHub Discussions](https://github.com/wxst/LibreTV/discussions/9)
- 确认是代码缺陷：[GitHub Issues](https://github.com/wxst/LibreTV/issues)
- 提交问题时请不要粘贴密码、令牌、私人资源站或你的实例地址。

提交 PR 前请确认不包含密钥或私人资源站、不引入视频内容缓存，并通过 `npm test`。

## 📄 许可证

本项目继承 [Apache-2.0](LICENSE) 许可证。使用的第三方组件：[ArtPlayer](https://github.com/zhw2590582/ArtPlayer)、[hls.js](https://github.com/video-dev/hls.js)、[mux.js](https://github.com/videojs/mux.js)、[Tailwind CSS](https://tailwindcss.com/)；画质增强算法参考 AMD [FidelityFX Super Resolution 1.0](https://github.com/GPUOpen-Effects/FidelityFX-FSR)（MIT）。
