const selectedAPIs = JSON.parse(localStorage.getItem('selectedAPIs') || JSON.stringify(DEFAULT_SELECTED_APIS));
const customAPIs = JSON.parse(localStorage.getItem('customAPIs') || '[]'); // 存储自定义API列表

// 顶栏搜索：跳到首页的搜索结果（首页会把 ?s= 规范成 /s=）
function submitPlayerSearch(event) {
    event?.preventDefault();
    const input = document.getElementById('playerSearchInput');
    const query = (input?.value || '').trim();
    if (!query) {
        input?.focus();
        return false;
    }
    window.location.href = `/?s=${encodeURIComponent(query)}`;
    return false;
}

// 窄屏上搜索框默认收起，点放大镜展开（覆盖标题），失焦且没输入内容时收回
function togglePlayerSearch(open) {
    const header = document.querySelector('.lt-player-topbar');
    const input = document.getElementById('playerSearchInput');
    if (!header || !input) return;
    header.classList.toggle('is-searching', open);
    if (open) {
        input.focus();
        input.addEventListener('blur', () => {
            if (!input.value.trim()) header.classList.remove('is-searching');
        }, { once: true });
    }
}

// 改进返回功能
function goBack(event) {
    // 防止默认链接行为
    if (event) event.preventDefault();
    
    // 1. 优先检查URL参数中的returnUrl
    const urlParams = new URLSearchParams(window.location.search);
    const returnUrl = urlParams.get('returnUrl');
    
    if (returnUrl) {
        // 如果URL中有returnUrl参数，优先使用
        window.location.href = decodeURIComponent(returnUrl);
        return;
    }
    
    // 2. 检查localStorage中保存的lastPageUrl
    const lastPageUrl = localStorage.getItem('lastPageUrl');
    if (lastPageUrl && lastPageUrl !== window.location.href) {
        window.location.href = lastPageUrl;
        return;
    }
    
    // 3. 检查是否是从搜索页面进入的播放器
    const referrer = document.referrer;
    
    // 检查 referrer 是否包含搜索参数
    if (referrer && (referrer.includes('/s=') || referrer.includes('?s='))) {
        // 如果是从搜索页面来的，返回到搜索页面
        window.location.href = referrer;
        return;
    }
    
    // 4. 如果是在iframe中打开的，尝试关闭iframe
    if (window.self !== window.top) {
        try {
            // 尝试调用父窗口的关闭播放器函数
            window.parent.closeVideoPlayer && window.parent.closeVideoPlayer();
            return;
        } catch (e) {
            console.error('调用父窗口closeVideoPlayer失败:', e);
        }
    }
    
    // 5. 无法确定上一页，则返回首页
    if (!referrer || referrer === '') {
        window.location.href = '/';
        return;
    }
    
    // 6. 以上都不满足，使用默认行为：返回上一页
    window.history.back();
}

// 页面加载时保存当前URL到localStorage，作为返回目标
window.addEventListener('load', function () {
    // 保存前一页面URL
    if (document.referrer && document.referrer !== window.location.href) {
        localStorage.setItem('lastPageUrl', document.referrer);
    }

    // 提取当前URL中的重要参数，以便在需要时能够恢复当前页面
    const urlParams = new URLSearchParams(window.location.search);
    const videoId = urlParams.get('id');
    const sourceCode = urlParams.get('source');

    if (videoId && sourceCode) {
        // 保存当前播放状态，以便其他页面可以返回
        localStorage.setItem('currentPlayingId', videoId);
        localStorage.setItem('currentPlayingSource', sourceCode);
    }
});


// =================================
// ============== PLAYER ==========
// =================================
// 全局变量
let currentVideoTitle = '';
let currentEpisodeIndex = 0;
let art = null; // 用于 ArtPlayer 实例
let currentHls = null; // 跟踪当前HLS实例
let currentEpisodes = [];
let currentEpisodeNames = [];
let episodesReversed = false;
let autoplayEnabled = true; // 默认开启自动连播
let videoHasEnded = false; // 跟踪视频是否已经自然结束
let userClickedPosition = null; // 记录用户点击的位置
let shortcutHintTimeout = null; // 用于控制快捷键提示显示时间
let adFilteringEnabled = true; // 默认开启广告过滤
let progressSaveInterval = null; // 定期保存进度的计时器
let currentVideoUrl = ''; // 记录当前实际的视频URL
let playbackRestoreApplied = false; // 防止同一视频重复恢复进度
let autoplayMutedNoticeShown = false; // 防止自动播放静音提示刷屏
let previewVideo = null; // 进度条预览使用的独立视频元素
let previewHls = null; // 进度条预览使用的独立 HLS 实例
let progressPreviewEl = null; // 进度条预览浮层
let progressPreviewCleanup = null; // 进度条预览事件清理器
let progressPreviewSeekTimer = null; // 进度条预览 seek 节流
let progressPreviewDestroyTimer = null; // 延迟销毁预览资源
let playerSurfaceCleanup = null; // 播放器画面点击事件清理器
let mobileFullscreenInteraction = null;
let playerTopActionsEl = null; // 播放器顶部浮动按钮容器
let playerControlDensityCleanup = null; // 播放器控制栏密度事件清理器
let castAvailabilityCleanup = null; // 投屏可用性监听清理器
let episodeDrawer = null; // 播放器内选集面板（全屏可用）
let nextEpisodeCard = null; // 片尾“下一集”倒计时卡片
let temporaryRateActive = false; // 长按倍速期间不记忆倍速
let preferredRateApplied = false; // 每次加载只恢复一次记忆的倍速
let skipMarks = { enabled: true, intro: 0, outro: 0 }; // 当前剧集的片头片尾标记
let playerStats = null; // 「统计信息」面板（网络、缓冲、分片）
let statsTracker = null; // 当前 HLS 实例的下载统计
let videoEnhancer = null; // 画质增强（WebGL FSR 放大 + 锐化）
// ready：新一集的元数据加载完成前，video.currentTime 仍是上一集的进度，不能据此跳过或预加载
let skipState = { introDone: false, outroDone: false, preloaded: false, ready: false };
let nextEpisodePreloadController = null;
let sideEpisodeList = null; // 宽屏时播放器右侧的选集栏
let playbackNotice = null; // 播放中途断流时的提示（重试 / 切换资源）
let playbackRecovery = null; // 当前 HLS 实例的中途错误恢复计划
let playbackRecoveryTimer = null;
const modalHome = { parent: null, nextSibling: null };
const isWebkit = (typeof window.webkitConvertPointFromNodeToPage === 'function')
const LONG_PRESS_EXCLUDED_SELECTOR = 'button, input, a, .art-controls, .art-setting, .art-settings, .player-top-actions, .player-episode-drawer, .player-next-card, .player-shortcut-help, .player-stats-panel, .art-info, .player-interrupted-notice, .mobile-fullscreen-header, .mobile-fullscreen-footer';
const PLAYER_SURFACE_INTERACTIVE_SELECTOR = [
    '.art-controls',
    '.art-control',
    '.art-bottom',
    '.art-progress',
    '.art-setting',
    '.art-settings',
    '.art-setting-item',
    '.art-selector',
    '.art-selector-item',
    '.art-contextmenus',
    '.art-contextmenu',
    '[class*="art-setting"]',
    '[class*="art-selector"]',
    '[class*="art-contextmenu"]',
    '.art-info',
    '.player-stats-panel',
    '.progress-preview',
    '.player-top-actions',
    '[data-video-interactive="true"]',
    'button',
    'a',
    'input',
    'select',
    'textarea',
    'label',
    '[role="button"]'
].join(',');
Artplayer.FULLSCREEN_WEB_IN_BODY = true;

// 页面加载
document.addEventListener('DOMContentLoaded', function () {
    // 先检查用户是否已通过密码验证
    if (!isPasswordVerified()) {
        // 隐藏加载提示
        document.getElementById('player-loading').style.display = 'none';
        return;
    }

    initializePageContent();
});

// 监听密码验证成功事件
document.addEventListener('passwordVerified', () => {
    document.getElementById('player-loading').style.display = 'block';

    initializePageContent();
});

function isDirectPlayableVideoUrl(url) {
    return /^https?:\/\/.+\.(m3u8|mp4|webm|mov|m4v|ts)(\?.*)?$/i.test(String(url || '').trim());
}

function getDetailApiParamsForSource(sourceCode) {
    if (!sourceCode) return '';

    if (sourceCode.startsWith('custom_')) {
        const customIndex = sourceCode.replace('custom_', '');
        const customApi = getCustomApiInfo(customIndex);
        if (!customApi) return '';

        let params = '&customApi=' + encodeURIComponent(customApi.url) + '&source=custom';
        if (customApi.detail) {
            params += '&customDetail=' + encodeURIComponent(customApi.detail);
        }
        return params;
    }

    return '&source=' + encodeURIComponent(sourceCode);
}

async function resolvePlayableEpisodeFromDetail(videoId, sourceCode, episodeIndex) {
    const apiParams = getDetailApiParamsForSource(sourceCode);
    if (!videoId || !apiParams) return null;

    const response = await fetch(`/api/detail?id=${encodeURIComponent(videoId)}${apiParams}&_t=${Date.now()}`, {
        method: 'GET',
        cache: 'no-cache'
    });
    if (!response.ok) return null;

    const data = await response.json();
    if (!data.episodes || data.episodes.length === 0) return null;

    const targetIndex = episodeIndex < data.episodes.length ? episodeIndex : 0;
    const targetUrl = data.episodes[targetIndex];
    if (!isDirectPlayableVideoUrl(targetUrl)) return null;

    return {
        url: targetUrl,
        episodes: data.episodes,
        index: targetIndex
    };
}

function isLowResourcePlaybackDevice() {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const saveData = Boolean(connection && connection.saveData);
    const deviceMemory = Number(navigator.deviceMemory || 0);
    const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent || '');

    return saveData || isMobileDevice || (deviceMemory > 0 && deviceMemory <= 4);
}

function buildHlsConfig() {
    const lowResource = isLowResourcePlaybackDevice();
    const defaultLoader = typeof Hls !== 'undefined' && Hls.DefaultConfig ? Hls.DefaultConfig.loader : undefined;
    const loader = adFilteringEnabled && typeof CustomHlsJsLoader !== 'undefined'
        ? CustomHlsJsLoader
        : defaultLoader;

    return {
        debug: false,
        loader,
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: lowResource ? 60 : 120,
        maxBufferLength: lowResource ? 30 : 60,
        maxMaxBufferLength: lowResource ? 60 : 120,
        maxBufferSize: lowResource ? 30 * 1000 * 1000 : 64 * 1000 * 1000,
        maxBufferHole: 0.5,
        fragLoadingMaxRetry: 6,
        fragLoadingMaxRetryTimeout: 64000,
        fragLoadingRetryDelay: 1000,
        manifestLoadingMaxRetry: 3,
        manifestLoadingRetryDelay: 1000,
        levelLoadingMaxRetry: 4,
        levelLoadingRetryDelay: 1000,
        startLevel: -1,
        abrEwmaDefaultEstimate: 500000,
        abrBandWidthFactor: 0.95,
        abrBandWidthUpFactor: 0.7,
        abrMaxWithRealBitrate: true,
        stretchShortVideoTrack: true,
        appendErrorMaxRetry: 5,
        liveSyncDurationCount: 3,
        liveDurationInfinity: false
    };
}

function getCurrentPlaybackPosition() {
    if (!art || !art.video) return 0;
    const currentTime = Number(art.video.currentTime || 0);
    return Number.isFinite(currentTime) && currentTime > 0 ? currentTime : 0;
}

function clampPlaybackPosition(position, duration) {
    const numericPosition = Number(position || 0);
    if (!Number.isFinite(numericPosition) || numericPosition <= 10) return 0;

    const numericDuration = Number(duration || 0);
    if (!Number.isFinite(numericDuration) || numericDuration <= 0) {
        return numericPosition;
    }

    return Math.min(numericPosition, Math.max(0, numericDuration - 2));
}

function getStoredPlaybackPosition() {
    try {
        const progressKey = 'videoProgress_' + getVideoId();
        const progressStr = localStorage.getItem(progressKey);
        if (!progressStr) return 0;

        const progress = JSON.parse(progressStr);
        return typeof progress?.position === 'number' ? progress.position : 0;
    } catch (e) {
        return 0;
    }
}

function restorePlaybackPosition() {
    if (!art || !art.video || playbackRestoreApplied) return;

    const urlParams = new URLSearchParams(window.location.search);
    const requestedPosition = Number(urlParams.get('position') || 0);
    const candidatePosition = requestedPosition > 0 ? requestedPosition : getStoredPlaybackPosition();
    const restoredPosition = clampPlaybackPosition(candidatePosition, art.duration || art.video.duration);

    if (restoredPosition > 10) {
        art.currentTime = restoredPosition;
        playbackRestoreApplied = true;
        showPositionRestoreHint(restoredPosition);
        return;
    }

    // 每次加载只尝试恢复一次：时长已知后即使没有可恢复的进度也要标记，
    // 否则之后每次拖动进度触发 canplay 时都会跳回上次保存的进度
    const duration = Number(art.duration || art.video.duration);
    if (Number.isFinite(duration) && duration > 0) playbackRestoreApplied = true;
}

function showAutoplayMutedNotice() {
    if (autoplayMutedNoticeShown) return;
    autoplayMutedNoticeShown = true;

    if (typeof showToast === 'function') {
        showToast('已静音自动播放，点击播放器恢复声音', 'success');
    } else if (art && art.notice) {
        art.notice.show = '已静音自动播放，点击播放器恢复声音';
    }

    const restoreSoundOnClick = () => {
        if (art && art.video) {
            art.muted = false;
            art.video.muted = false;
        }
        document.removeEventListener('click', restoreSoundOnClick, true);
    };
    document.addEventListener('click', restoreSoundOnClick, true);
}

function tryStartPlayback() {
    if (!art || !art.video) return Promise.resolve(false);

    const playbackPromise = art.video.play();
    if (!playbackPromise || typeof playbackPromise.catch !== 'function') {
        return Promise.resolve(true);
    }

    return playbackPromise.catch(error => {
        // 快速切集会让上一次 play() 以 AbortError 结束，这不是自动播放限制，不能静音
        if (!window.PlayerEnhancements?.shouldMuteAfterPlayRejection(error)) return false;
        art.muted = true;
        art.video.muted = true;
        showAutoplayMutedNotice();

        const mutedPlaybackPromise = art.video.play();
        if (!mutedPlaybackPromise || typeof mutedPlaybackPromise.catch !== 'function') {
            return true;
        }

        return mutedPlaybackPromise
            .then(() => true)
            .catch(() => false);
    })
        .then(result => result !== false);
}

function isMobilePlaybackDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isLandscapeVideo() {
    const video = art?.video;
    const width = Number(video?.videoWidth || 0);
    const height = Number(video?.videoHeight || 0);
    return width > 0 && height > 0 && width >= height;
}

function isPlayerFullscreenActive() {
    const playerEl = document.getElementById('player');
    const fullscreenElement = document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement;

    return Boolean(
        art?.fullscreen ||
        art?.fullscreenWeb ||
        (playerEl && fullscreenElement && (fullscreenElement === playerEl || fullscreenElement.contains(playerEl) || playerEl.contains(fullscreenElement)))
    );
}

function getPlayerFullscreenHost() {
    const playerEl = document.getElementById('player');
    const fullscreenElement = document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement;

    if (playerEl && fullscreenElement && (fullscreenElement === playerEl || fullscreenElement.contains(playerEl) || playerEl.contains(fullscreenElement))) {
        return fullscreenElement;
    }

    if (art?.fullscreen || art?.fullscreenWeb) {
        return art?.template?.$player || playerEl?.closest('.art-video-player') || playerEl;
    }

    return null;
}

function isMobilePortraitViewport() {
    return window.matchMedia('(max-width: 640px) and (orientation: portrait)').matches;
}

function updatePlayerControlDensity() {
    const playerEl = document.getElementById('player');
    if (!playerEl) return;

    const fullscreenActive = isPlayerFullscreenActive();
    playerEl.classList.toggle('player-fullscreen-controls', fullscreenActive);
    playerEl.classList.toggle('mobile-portrait-compact-controls', isMobilePortraitViewport() && !fullscreenActive);
    mobileFullscreenInteraction?.sync();
}

function setupPlayerControlDensity() {
    if (playerControlDensityCleanup) {
        playerControlDensityCleanup();
        playerControlDensityCleanup = null;
    }

    const update = () => updatePlayerControlDensity();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    document.addEventListener('fullscreenchange', update);
    document.addEventListener('webkitfullscreenchange', update);
    update();

    playerControlDensityCleanup = () => {
        window.removeEventListener('resize', update);
        window.removeEventListener('orientationchange', update);
        document.removeEventListener('fullscreenchange', update);
        document.removeEventListener('webkitfullscreenchange', update);
    };
}

function maybeLockLandscapeOrientation() {
    if (!isMobilePlaybackDevice() || (!isPlayerFullscreenActive() && !art?.video?.webkitDisplayingFullscreen)) return Promise.resolve(false);
    if (!screen.orientation || typeof screen.orientation.lock !== 'function') return Promise.resolve(false);

    return screen.orientation.lock('landscape')
        .then(() => {
            if (!isPlayerFullscreenActive() && !art?.video?.webkitDisplayingFullscreen) { unlockLandscapeOrientation(); return false; }
            return true;
        })
        .catch(() => false);
}

function unlockLandscapeOrientation() {
    if (!screen.orientation || typeof screen.orientation.unlock !== 'function') return;
    try {
        screen.orientation.unlock();
    } catch (e) {
    }
}

function toggleFullscreenMode() {
    if (!art) return;
    if (!document.fullscreenEnabled && isMobilePlaybackDevice()) {
        art.fullscreenWeb = !art.fullscreenWeb;
        return;
    }
    if (!document.fullscreenEnabled && typeof art.video?.webkitEnterFullscreen === 'function') {
        try { art.video.webkitEnterFullscreen(); } catch {}
        return;
    }
    art.fullscreen = !art.fullscreen;
    showShortcutHint('切换全屏', 'fullscreen');
}

function shouldIgnorePlayerSurfaceToggle(event) {
    const target = event?.target;
    const playerEl = art?.template?.$player || document.getElementById('player');
    if (!target || !playerEl || !playerEl.contains(target)) return true;
    if (target.closest(PLAYER_SURFACE_INTERACTIVE_SELECTOR)) return true;
    return false;
}

function togglePlaybackFromSurface() {
    if (!art || !art.video) return;
    art.toggle();
    showShortcutHint(art.video.paused ? '已暂停' : '继续播放', 'play');
}

function setupPlayerSurfaceToggle() {
    const playerEl = art?.template?.$player || document.getElementById('player');
    if (!playerEl) return;

    if (playerSurfaceCleanup) {
        playerSurfaceCleanup();
        playerSurfaceCleanup = null;
    }

    let clickTimer = null;
    let lastPointerType = '';
    let controlsHideTimer = null;
    const clearClickTimer = () => {
        if (clickTimer) {
            clearTimeout(clickTimer);
            clickTimer = null;
        }
    };
    const isTouchTap = event => (event.pointerType || lastPointerType) === 'touch' ||
        (!event.pointerType && !lastPointerType && isMobilePlaybackDevice());
    const rememberPointerType = event => { lastPointerType = event.pointerType || ''; };

    // 触屏：单击显示/隐藏控制栏，双击播放/暂停（与主流视频网站一致）
    const toggleControlsFromTap = () => {
        if (!art?.controls) return;
        const show = !art.controls.show;
        art.controls.show = show;
        clearTimeout(controlsHideTimer);
        if (show && !art.video.paused) {
            controlsHideTimer = setTimeout(() => { if (art && !art.video.paused) art.controls.show = false; }, 3500);
        }
    };

    const consumeSurfaceEvent = (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') {
            event.stopImmediatePropagation();
        }
    };

    // 双击：左侧三分之一快退 10 秒，右侧三分之一快进 10 秒，中间播放/暂停
    const handleDoubleTap = (event) => {
        const zone = window.PlayerEnhancements.doubleTapZone(event.clientX, playerEl.getBoundingClientRect());
        if (zone === 'center') {
            togglePlaybackFromSurface();
            return;
        }
        const delta = zone === 'back' ? -10 : 10;
        art.currentTime = window.PlayerEnhancements.clampSeek(art.currentTime, delta, art.duration);
        showShortcutHint(`${delta < 0 ? '快退' : '快进'} 10 秒`, delta < 0 ? 'left' : 'right');
    };

    const handleTouchTap = (event, singleTapAction) => {
        if (clickTimer) {
            clearClickTimer();
            handleDoubleTap(event);
            return;
        }
        clickTimer = setTimeout(() => {
            clickTimer = null;
            singleTapAction();
        }, 260);
    };

    const handleSurfaceClick = (event) => {
        if (shouldIgnorePlayerSurfaceToggle(event)) return;
        if (mobileFullscreenInteraction?.active) {
            consumeSurfaceEvent(event);
            if (mobileFullscreenInteraction.shouldSuppressClick()) return;
            // A tap on the picture closes the settings opened from 更多.
            if (art.setting?.show) { art.setting.show = false; return; }
            handleTouchTap(event, () => mobileFullscreenInteraction?.toggleChrome());
            return;
        }
        if (isTouchTap(event)) {
            consumeSurfaceEvent(event);
            handleTouchTap(event, toggleControlsFromTap);
            return;
        }
        if (event.detail > 1) return;

        consumeSurfaceEvent(event);
        clearClickTimer();
        clickTimer = setTimeout(() => {
            clickTimer = null;
            togglePlaybackFromSurface();
        }, 180);
    };

    const handleSurfaceDoubleClick = (event) => {
        if (shouldIgnorePlayerSurfaceToggle(event)) return;
        if (mobileFullscreenInteraction?.active || isTouchTap(event)) {
            // 触屏双击已在单击处理中识别为播放/暂停
            consumeSurfaceEvent(event);
            return;
        }

        consumeSurfaceEvent(event);
        clearClickTimer();
        toggleFullscreenMode();
    };

    playerEl.addEventListener('pointerdown', rememberPointerType, true);
    playerEl.addEventListener('click', handleSurfaceClick, true);
    playerEl.addEventListener('dblclick', handleSurfaceDoubleClick, true);

    playerSurfaceCleanup = () => {
        clearClickTimer();
        clearTimeout(controlsHideTimer);
        playerEl.removeEventListener('pointerdown', rememberPointerType, true);
        playerEl.removeEventListener('click', handleSurfaceClick, true);
        playerEl.removeEventListener('dblclick', handleSurfaceDoubleClick, true);
    };
}

function getNativeCastVideoUrl(video = art?.video) {
    const sourceElement = video?.querySelector?.('source');
    return currentVideoUrl || video?.currentSrc || video?.src || sourceElement?.src || '';
}

function prepareVideoForNativeCast(video = art?.video, url = getNativeCastVideoUrl(video)) {
    if (!video) return '';

    try {
        video.disableRemotePlayback = false;
        video.removeAttribute('disableRemotePlayback');
        video.setAttribute('x-webkit-airplay', 'allow');
        video.setAttribute('webkit-playsinline', 'true');
        video.setAttribute('playsinline', 'true');

        if (url) {
            let sourceElement = video.querySelector('source');
            if (!sourceElement) {
                sourceElement = document.createElement('source');
                video.appendChild(sourceElement);
            }
            sourceElement.src = url;
        }
    } catch (e) {
    }

    return url || '';
}

function buildPresentationCastUrl(video = art?.video) {
    const url = prepareVideoForNativeCast(video);
    if (!url) return '';

    const castUrl = new URL('cast.html', window.location.href);
    castUrl.searchParams.set('url', url);
    castUrl.searchParams.set('title', currentVideoTitle || document.title || 'LibreTV');

    const position = Math.floor(Number(video?.currentTime || 0));
    if (position > 1) {
        castUrl.searchParams.set('position', String(position));
    }

    return castUrl.href;
}

async function startPresentationCast(video = art?.video) {
    if (typeof PresentationRequest !== 'function') return false;

    const castUrl = buildPresentationCastUrl(video);
    if (!castUrl) return false;

    const request = new PresentationRequest([castUrl]);
    const connection = await request.start();
    if (connection && typeof connection.addEventListener === 'function') {
        connection.addEventListener('connect', () => showToast('投屏已连接', 'success'), { once: true });
    }
    showToast('投屏已启动', 'success');
    return true;
}

function normalizeCastAvailability(availability) {
    if (availability && typeof availability === 'object' && 'value' in availability) {
        return Boolean(availability.value);
    }

    return Boolean(availability);
}

async function detectPresentationCastAvailability(video = art?.video) {
    const castUrl = buildPresentationCastUrl(video);
    if (!castUrl || typeof PresentationRequest !== 'function') return false;

    try {
        if (typeof PresentationRequest.getAvailability === 'function') {
            const availability = await PresentationRequest.getAvailability([castUrl]);
            if (normalizeCastAvailability(availability)) return true;
        }
    } catch (e) {
    }

    try {
        const request = new PresentationRequest([castUrl]);
        if (typeof request.getAvailability !== 'function') return false;

        const availability = await request.getAvailability();
        return normalizeCastAvailability(availability);
    } catch (e) {
        return false;
    }
}

function detectRemotePlaybackAvailability(video = art?.video, callbacks = {}) {
    if (!video?.remote || typeof video.remote.watchAvailability !== 'function') {
        return Promise.resolve(false);
    }

    return new Promise((resolve) => {
        let settled = false;
        const settle = (available) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            resolve(Boolean(available));
        };
        const timeout = setTimeout(() => settle(false), 1200);

        try {
            const watchPromise = video.remote.watchAvailability((available) => {
                const normalized = Boolean(available);
                if (typeof callbacks.onAvailabilityChange === 'function') {
                    callbacks.onAvailabilityChange(normalized);
                }
                settle(normalized);
            });

            if (watchPromise && typeof watchPromise.then === 'function') {
                watchPromise
                    .then((watchId) => {
                        if (typeof callbacks.onRemoteWatchId === 'function') {
                            callbacks.onRemoteWatchId(watchId);
                        }
                    })
                    .catch(() => settle(false));
            }
        } catch (e) {
            settle(false);
        }
    });
}

async function detectCastAvailability(video = art?.video, callbacks = {}) {
    if (!video) return false;
    if (typeof video.webkitShowPlaybackTargetPicker === 'function') return true;
    if (await detectPresentationCastAvailability(video)) return true;

    return detectRemotePlaybackAvailability(video, callbacks);
}

function cleanupCastAvailability() {
    if (castAvailabilityCleanup) {
        castAvailabilityCleanup();
        castAvailabilityCleanup = null;
    }
}

function setCastButtonAvailable(available) {
    if (playerTopActionsEl) {
        playerTopActionsEl.hidden = !available;
    }
}

function setupCastAvailability() {
    cleanupCastAvailability();
    setCastButtonAvailable(false);

    const video = art?.video;
    if (!video || !playerTopActionsEl) return;

    let disposed = false;
    let remoteWatchId = null;
    const applyAvailability = (available) => {
        if (disposed) return;
        setCastButtonAvailable(available);
    };

    castAvailabilityCleanup = () => {
        disposed = true;
        if (remoteWatchId && typeof video.remote?.cancelWatchAvailability === 'function') {
            try {
                const cancelResult = video.remote.cancelWatchAvailability(remoteWatchId);
                if (cancelResult && typeof cancelResult.catch === 'function') {
                    cancelResult.catch(() => {});
                }
            } catch (e) {
            }
        }
    };

    detectCastAvailability(video, {
        onAvailabilityChange: applyAvailability,
        onRemoteWatchId(watchId) {
            remoteWatchId = watchId;
        }
    })
        .then(applyAvailability)
        .catch(() => applyAvailability(false));
}

function isCastCancelError(error) {
    return ['AbortError', 'NotFoundError', 'NotAllowedError'].includes(error?.name);
}

function showNativeCastError(error) {
    if (error?.name === 'NotFoundError') {
        showToast('未发现可用投屏设备，请确认电视和本机在同一网络', 'warning');
        return;
    }

    if (error?.name === 'NotAllowedError') {
        showToast('请直接点击投屏按钮启动，浏览器拦截了本次请求', 'warning');
        return;
    }

    if (error?.name === 'AbortError') return;

    showToast('当前浏览器无法直接投屏，请尝试浏览器菜单投屏或 Safari AirPlay', 'warning');
}

async function requestNativeCast(event) {
    event?.preventDefault();
    event?.stopPropagation();
    if (typeof event?.stopImmediatePropagation === 'function') {
        event.stopImmediatePropagation();
    }

    const video = art?.video;
    if (!video) {
        showToast('播放器尚未准备好，请稍后重试', 'warning');
        return;
    }

    prepareVideoForNativeCast(video);

    if (typeof video.webkitShowPlaybackTargetPicker === 'function') {
        try {
            video.webkitShowPlaybackTargetPicker();
            return;
        } catch (error) {
            if (!isCastCancelError(error)) {
                showNativeCastError(error);
            }
        }
    }

    try {
        if (await startPresentationCast(video)) return;
    } catch (error) {
        if (!isCastCancelError(error)) {
            showNativeCastError(error);
            return;
        }
    }

    try {
        if (video.remote && typeof video.remote.prompt === 'function') {
            await video.remote.prompt();
            return;
        }

        showToast('当前浏览器不支持网页内投屏，请使用浏览器菜单投屏或 Safari AirPlay', 'warning');
    } catch (error) {
        showNativeCastError(error);
    }
}

function setupPlayerTopActions() {
    const playerEl = document.getElementById('player');
    if (!playerEl) return;

    playerTopActionsEl = playerEl.querySelector('.player-top-actions');
    if (!playerTopActionsEl) {
        playerTopActionsEl = document.createElement('div');
        playerTopActionsEl.className = 'player-top-actions';
        playerTopActionsEl.dataset.videoInteractive = 'true';
        playerEl.appendChild(playerTopActionsEl);
    }

    playerTopActionsEl.innerHTML = `
        <button type="button" class="player-top-action-btn" data-video-interactive="true" aria-label="投屏" title="投屏">
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7A2.5 2.5 0 0 1 17.5 16H16a1 1 0 1 1 0-2h1.5a.5.5 0 0 0 .5-.5v-7a.5.5 0 0 0-.5-.5h-11a.5.5 0 0 0-.5.5V8a1 1 0 0 1-2 0V6.5Z" fill="currentColor"/>
                <path d="M4 18.5a1.5 1.5 0 0 1 1.5 1.5H4v-1.5Zm0-4A5.5 5.5 0 0 1 9.5 20h-2A3.5 3.5 0 0 0 4 16.5v-2Zm0-4A9.5 9.5 0 0 1 13.5 20h-2A7.5 7.5 0 0 0 4 12.5v-2Z" fill="currentColor"/>
            </svg>
        </button>
    `;

    const castButton = playerTopActionsEl.querySelector('button');
    castButton?.addEventListener('click', requestNativeCast);
    setupCastAvailability();
}

function playerControlIcon(name) {
    const icons = {
        prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 6a1 1 0 0 1 2 0v4.1l7.4-4.8A1 1 0 0 1 18 6.1v11.8a1 1 0 0 1-1.6.8L9 13.9V18a1 1 0 1 1-2 0V6Z" fill="currentColor"/></svg>',
        next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 6a1 1 0 1 0-2 0v4.1L7.6 5.3A1 1 0 0 0 6 6.1v11.8a1 1 0 0 0 1.6.8l7.4-4.8V18a1 1 0 1 0 2 0V6Z" fill="currentColor"/></svg>',
        resource: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10l-2.2-2.2a1 1 0 1 1 1.4-1.4l4 4a1 1 0 0 1 0 1.4l-4 4a1 1 0 1 1-1.4-1.4L17 9H7a1 1 0 0 1 0-2Zm10 10H7l2.2 2.2a1 1 0 0 1-1.4 1.4l-4-4a1 1 0 0 1 0-1.4l4-4a1 1 0 1 1 1.4 1.4L7 15h10a1 1 0 1 1 0 2Z" fill="currentColor"/></svg>',
        quality: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm0 2v10h14V7H5Zm2 3h2v4H7v-4Zm4-1h2v5h-2V9Zm4-1h2v6h-2V8Z" fill="currentColor"/></svg>',
        fullscreen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9V5h4a1 1 0 0 0 0-2H4a1 1 0 0 0-1 1v5a1 1 0 0 0 2 0Zm10-6a1 1 0 1 0 0 2h4v4a1 1 0 1 0 2 0V4a1 1 0 0 0-1-1h-5ZM5 15a1 1 0 1 0-2 0v5a1 1 0 0 0 1 1h5a1 1 0 1 0 0-2H5v-4Zm16 0a1 1 0 1 0-2 0v4h-4a1 1 0 1 0 0 2h5a1 1 0 0 0 1-1v-5Z" fill="currentColor"/></svg>'
    };
    return icons[name] || '';
}

function buildHlsQualityOptions() {
    const levels = Array.isArray(currentHls?.levels) ? currentHls.levels : [];
    const currentLevel = typeof currentHls?.currentLevel === 'number' ? currentHls.currentLevel : -1;
    const seen = new Set();
    const options = [{
        html: '自动',
        level: -1,
        default: currentLevel === -1
    }];

    levels.forEach((level, index) => {
        const height = Number(level?.height || 0);
        const bitrate = Number(level?.bitrate || 0);
        const label = height > 0
            ? `${height}p`
            : bitrate > 0
                ? `${Math.round(bitrate / 1000)}kbps`
                : `线路 ${index + 1}`;
        const key = `${label}-${height || bitrate || index}`;
        if (seen.has(key)) return;
        seen.add(key);
        options.push({
            html: label,
            level: index,
            default: currentLevel === index
        });
    });

    if (!options.some(item => item.default)) {
        options[0].default = true;
    }

    return options;
}

function applyHlsQuality(item) {
    if (!currentHls || typeof item?.level !== 'number') return '自动';

    const resumePosition = getCurrentPlaybackPosition();
    currentHls.currentLevel = item.level;
    currentHls.nextLevel = item.level;

    if (resumePosition > 0 && art?.video) {
        try {
            art.video.currentTime = resumePosition;
        } catch (e) {
        }
    }

    const label = item.html || '自动';
    showShortcutHint(`清晰度 ${label}`, 'up');
    return label;
}

function updateHlsQualityControl() {
    if (!art || !art.controls || typeof art.controls.update !== 'function') return;

    const selector = buildHlsQualityOptions();
    const active = selector.find(item => item.default) || selector[0];
    art.controls.update({
        name: 'quality',
        index: 12,
        position: 'right',
        html: playerControlIcon('quality'),
        tooltip: `清晰度：${active.html}`,
        selector,
        onSelect(item) {
            return applyHlsQuality(item);
        }
    });
}

function buildRateOptions(activeRate = art?.playbackRate || window.PlayerEnhancements.readStoredRate()) {
    return window.PlayerEnhancements.PLAYBACK_RATES.map(rate => ({
        html: rate === 1 ? '正常' : `${rate}x`,
        rate,
        default: Number(activeRate) === rate
    }));
}

function updateRateControl() {
    if (!art || !art.controls || typeof art.controls.update !== 'function') return;
    const rate = art.playbackRate || 1;
    art.controls.update({
        name: 'playback-rate',
        index: 10,
        position: 'right',
        html: window.PlayerEnhancements.rateLabel(rate),
        tooltip: '播放速度',
        selector: buildRateOptions(rate),
        onSelect(item) {
            art.playbackRate = item.rate;
            window.PlayerEnhancements.storeRate(item.rate);
            showShortcutHint(`${item.rate === 1 ? '正常' : item.rate + ' 倍'}速度`, 'right');
            return window.PlayerEnhancements.rateLabel(item.rate);
        }
    });
}

// 每次加载视频只恢复一次全局记忆的倍速
function applyPreferredPlaybackRate() {
    if (!art || preferredRateApplied) return;
    preferredRateApplied = true;
    const rate = window.PlayerEnhancements.readStoredRate();
    if (art.playbackRate !== rate) art.playbackRate = rate;
}

function updateEpisodeControlVisibility() {
    const playerEl = art?.template?.$player;
    if (!playerEl) return;
    playerEl.classList.toggle('player-single-episode', !(currentEpisodes.length > 1));
}

function getNextEpisodeInfo() {
    const nextIndex = currentEpisodeIndex + 1;
    if (nextIndex >= currentEpisodes.length) return null;
    return window.PlayerEnhancements.episodeLabel(nextIndex, currentEpisodeNames[nextIndex]);
}

// 选集面板和下一集卡片挂在播放器内部，全屏时同样可用
function setupPlayerOverlays() {
    const statsWereOpen = Boolean(playerStats?.isOpen);
    episodeDrawer?.destroy();
    nextEpisodeCard?.destroy();
    shortcutHelp?.destroy();
    playbackNotice?.destroy();
    playerStats?.destroy();
    playerStats = null;
    videoEnhancer?.destroy();
    videoEnhancer = null;
    episodeDrawer = null;
    nextEpisodeCard = null;
    shortcutHelp = null;
    playbackNotice = null;
    const host = art?.template?.$player;
    if (!host || !window.PlayerEnhancements) return;

    episodeDrawer = window.PlayerEnhancements.createEpisodeDrawer({
        host,
        getEpisodes: () => currentEpisodes,
        getNames: () => currentEpisodeNames,
        getIndex: () => currentEpisodeIndex,
        isReversed: () => episodesReversed,
        onSelect: index => { if (index !== currentEpisodeIndex) playEpisode(index); }
    });
    nextEpisodeCard = window.PlayerEnhancements.createNextEpisodeCard({
        host,
        video: art.video,
        getNext: getNextEpisodeInfo,
        isEnabled: () => autoplayEnabled && skipState.ready,
        onPlayNext: playNextEpisode,
        getEndTime: getEffectiveEndTime
    });
    shortcutHelp = window.PlayerEnhancements.createShortcutHelp(host);
    playbackNotice = window.PlayerEnhancements.createPlaybackNotice(host, {
        onRetry: retryInterruptedPlayback,
        onSwitch: showSwitchResourceModal
    });
    skipMarks = window.PlayerEnhancements.readSkipMarks(currentVideoTitle);
    updateSkipSettings();
    setupVideoEnhance(host);
    setupPlayerStats(host, statsWereOpen);
    if (!isMobilePlaybackDevice() && typeof art.setting?.update === 'function') {
        art.setting.update({
            name: 'shortcut-help',
            html: '键盘快捷键',
            tooltip: '按 ? 键',
            onClick() {
                shortcutHelp?.toggle();
                return '按 ? 键';
            }
        });
    }
    host.classList.toggle('player-touch-device', isMobilePlaybackDevice());

    // 快捷键提示放进播放器，居中显示在画面上（全屏时也可见）
    const hint = document.getElementById('shortcutHint');
    if (hint && hint.parentElement !== host) host.appendChild(hint);
    updateEpisodeControlVisibility();
}

// 画质增强：设置里选「标准 / 锐利」后由 GPU 实时放大锐化，选择会记住；浏览器不支持 WebGL2 时不显示
function setupVideoEnhance(host) {
    if (!window.VideoEnhance?.isSupported() || !art?.video || typeof art.setting?.update !== 'function') return;
    const { MODES } = window.VideoEnhance;
    videoEnhancer = window.VideoEnhance.create({ host, video: art.video, notify: message => showToast(message, 'info') });
    const saved = window.VideoEnhance.readMode();
    const mode = saved === 'off' ? 'off' : videoEnhancer.setMode(saved, { remember: false });
    try {
        art.setting.update({
            name: 'video-enhance',
            html: '画质增强',
            tooltip: MODES[mode].label,
            selector: Object.entries(MODES).map(([value, item]) => ({ html: item.label, value, default: value === mode })),
            onSelect(item) {
                const applied = videoEnhancer?.setMode(item.value) || 'off';
                showShortcutHint(applied === 'off' ? '画质增强：关闭' : `画质增强：${MODES[applied].label}`, 'right');
                return MODES[applied].label;
            }
        });
    } catch (error) { console.warn('更新播放设置失败:', error); }
}

// 「统计信息」：替换 ArtPlayer 自带的英文信息面板（它的关闭按钮会被画面点击抢走），右键菜单和播放设置里都能打开
function setupPlayerStats(host, reopen) {
    if (!window.PlayerStats) return;
    playerStats = window.PlayerStats.createPanel(host, {
        getVideo: () => art?.video,
        getHls: () => (currentHls?.media === art?.video ? currentHls : null),
        getTracker: () => statsTracker,
        getInfo: () => ({
            title: currentVideoTitle,
            episode: currentEpisodeCounterText(),
            source: API_SITES?.[new URLSearchParams(location.search).get('source') || '']?.name || '',
            enhance: videoEnhancer?.describe() || ''
        })
    });
    const toggle = () => playerStats?.toggle();
    try {
        art.contextmenu?.update?.({ name: 'info', index: 40, html: '统计信息', click(contextmenu) { toggle(); contextmenu.show = false; } });
    } catch (error) { console.warn('更新右键菜单失败:', error); }
    if (typeof art.setting?.update === 'function') {
        try {
            art.setting.update({ name: 'player-stats', html: '统计信息', tooltip: '网络 / 缓冲', onClick() { art.setting.show = false; toggle(); return '网络 / 缓冲'; } });
        } catch (error) { console.warn('更新播放设置失败:', error); }
    }
    if (reopen) playerStats.show();
}

// ---- 跳过片头片尾（按剧名记忆），在播放器设置面板中设置，全屏可用 ----
function resetEpisodePlaybackState() {
    skipState = { introDone: false, outroDone: false, preloaded: false, ready: false };
    nextEpisodePreloadController?.abort();
    nextEpisodePreloadController = null;
}

function getEffectiveEndTime() {
    const duration = Number(art?.video?.duration);
    return window.PlayerEnhancements.effectiveEndTime(duration, skipMarks);
}

function saveSkipMarks() {
    window.PlayerEnhancements.writeSkipMarks(currentVideoTitle, skipMarks);
    updateSkipSettings();
}

function updateSkipSettings() {
    if (!art?.setting || typeof art.setting.update !== 'function') return;
    const { formatClock } = window.PlayerEnhancements;
    const items = [
        {
            name: 'skip-enabled',
            html: '跳过片头片尾',
            switch: skipMarks.enabled,
            onSwitch(item) {
                skipMarks.enabled = !item.switch;
                window.PlayerEnhancements.writeSkipMarks(currentVideoTitle, skipMarks);
                showShortcutHint(skipMarks.enabled ? '已开启跳过片头片尾' : '已关闭跳过片头片尾', 'right');
                return skipMarks.enabled;
            }
        },
        {
            name: 'skip-intro',
            html: '设当前为片头结束',
            tooltip: skipMarks.intro ? formatClock(skipMarks.intro) : '未设置',
            onClick() {
                const time = Number(art.video.currentTime || 0);
                if (time < 5) {
                    showShortcutHint('请播放到片头结束处再设置', 'right');
                    return skipMarks.intro ? formatClock(skipMarks.intro) : '未设置';
                }
                skipMarks.intro = Math.round(time);
                skipMarks.enabled = true;
                skipState.introDone = true;
                saveSkipMarks();
                showShortcutHint(`片头结束：${formatClock(skipMarks.intro)}`, 'right');
                return formatClock(skipMarks.intro);
            }
        },
        {
            name: 'skip-outro',
            html: '设当前为片尾开始',
            tooltip: skipMarks.outro ? `最后 ${formatClock(skipMarks.outro)}` : '未设置',
            onClick() {
                const duration = Number(art.video.duration);
                const remaining = duration - Number(art.video.currentTime || 0);
                if (!Number.isFinite(remaining) || remaining < 5 || remaining > duration / 2) {
                    showShortcutHint('请播放到片尾开始处再设置', 'right');
                    return skipMarks.outro ? `最后 ${formatClock(skipMarks.outro)}` : '未设置';
                }
                skipMarks.outro = Math.round(remaining);
                skipMarks.enabled = true;
                saveSkipMarks();
                showShortcutHint(`片尾：最后 ${formatClock(skipMarks.outro)}`, 'right');
                return `最后 ${formatClock(skipMarks.outro)}`;
            }
        },
        {
            name: 'skip-clear',
            html: '清除片头片尾标记',
            tooltip: '',
            onClick() {
                skipMarks = { enabled: true, intro: 0, outro: 0 };
                saveSkipMarks();
                showShortcutHint('已清除片头片尾标记', 'right');
                return '';
            }
        }
    ];
    items.forEach(item => {
        try { art.setting.update(item); } catch (error) { console.warn('更新播放设置失败:', error); }
    });
}

// 每次播放进度更新：跳过片头/片尾，并在临近结尾时预加载下一集
function handlePlaybackProgress() {
    if (!art?.video || !skipState.ready) return;
    const time = Number(art.video.currentTime || 0);
    const duration = Number(art.video.duration);
    if (skipMarks.intro && time >= skipMarks.intro - 1) skipState.introDone = true;

    const action = window.PlayerEnhancements.skipAction({ time, duration, marks: skipMarks, ...skipState });
    if (action === 'intro') {
        skipState.introDone = true;
        art.currentTime = skipMarks.intro;
        showShortcutHint('已跳过片头', 'right');
    } else if (action === 'outro') {
        skipState.outroDone = true;
        if (autoplayEnabled && !nextEpisodeCard?.dismissed && currentEpisodeIndex < currentEpisodes.length - 1) {
            showShortcutHint('已跳过片尾', 'right');
            playNextEpisode();
            return;
        }
    }

    const endTime = getEffectiveEndTime();
    const nextUrl = currentEpisodes[currentEpisodeIndex + 1];
    if (!skipState.preloaded && nextUrl && time > 5 && Number.isFinite(endTime) && endTime - time <= 60) {
        skipState.preloaded = true;
        nextEpisodePreloadController = new AbortController();
        window.PlayerEnhancements.preloadEpisode(nextUrl, {
            signal: nextEpisodePreloadController.signal,
            playlistsOnly: isLowResourcePlaybackDevice()
        }).catch(() => {});
    }
}

// ---- 宽屏双栏：播放器右侧常驻选集栏 ----
function updateSideEpisodes() {
    const stage = document.getElementById('playerStage');
    const aside = document.getElementById('sideEpisodes');
    if (!stage || !aside || !window.PlayerEnhancements) return;
    const hasEpisodes = currentEpisodes.length > 1;
    stage.classList.toggle('has-side-episodes', hasEpisodes);
    document.querySelector('main')?.classList.toggle('player-layout-wide', hasEpisodes);
    if (!hasEpisodes) return;
    if (!sideEpisodeList) {
        sideEpisodeList = window.PlayerEnhancements.createEpisodeList({
            container: aside,
            getEpisodes: () => currentEpisodes,
            getNames: () => currentEpisodeNames,
            getIndex: () => currentEpisodeIndex,
            isReversed: () => episodesReversed,
            onSelect: index => { if (index !== currentEpisodeIndex) playEpisode(index); }
        });
    }
    sideEpisodeList.render();
}

function toggleEpisodeDrawer() {
    if (!episodeDrawer) return;
    episodeDrawer.toggle();
    if (episodeDrawer.isOpen) art.controls.show = true;
}

function buildVideoControls() {
    return [
        {
            name: 'prev-episode',
            index: 8,
            position: 'left',
            html: playerControlIcon('prev'),
            tooltip: '上一集',
            click: playPreviousEpisode
        },
        {
            name: 'next-episode',
            index: 9,
            position: 'left',
            html: playerControlIcon('next'),
            tooltip: '下一集',
            click: playNextEpisode
        },
        {
            name: 'episodes',
            index: 9,
            position: 'right',
            html: '选集',
            tooltip: '选集',
            click: toggleEpisodeDrawer
        },
        {
            name: 'playback-rate',
            index: 10,
            position: 'right',
            html: window.PlayerEnhancements.rateLabel(window.PlayerEnhancements.readStoredRate()),
            tooltip: '播放速度',
            selector: buildRateOptions(window.PlayerEnhancements.readStoredRate()),
            onSelect(item) {
                art.playbackRate = item.rate;
                window.PlayerEnhancements.storeRate(item.rate);
                return window.PlayerEnhancements.rateLabel(item.rate);
            }
        },
        {
            name: 'switch-resource',
            index: 11,
            position: 'right',
            html: playerControlIcon('resource'),
            tooltip: '切换资源',
            click: showSwitchResourceModal
        },
        {
            name: 'quality',
            index: 12,
            position: 'right',
            html: playerControlIcon('quality'),
            tooltip: '清晰度',
            selector: buildHlsQualityOptions(),
            onSelect(item) {
                return applyHlsQuality(item);
            }
        },
    ];
}

function getProgressPreviewTime(clientX, rect, duration) {
    if (!rect || !Number.isFinite(rect.width) || rect.width <= 0 || !Number.isFinite(duration) || duration <= 0) {
        return 0;
    }

    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.min(duration, Math.max(0, ratio * duration));
}

function destroyProgressPreview() {
    if (progressPreviewCleanup) {
        progressPreviewCleanup();
        progressPreviewCleanup = null;
    }

    if (progressPreviewSeekTimer) {
        clearTimeout(progressPreviewSeekTimer);
        progressPreviewSeekTimer = null;
    }

    if (progressPreviewDestroyTimer) {
        clearTimeout(progressPreviewDestroyTimer);
        progressPreviewDestroyTimer = null;
    }

    if (previewHls && previewHls.destroy) {
        try {
            previewHls.destroy();
        } catch (e) {
        }
    }
    previewHls = null;

    if (previewVideo) {
        try {
            previewVideo.removeAttribute('src');
            previewVideo.load();
        } catch (e) {
        }
        previewVideo = null;
    }

    if (progressPreviewEl) {
        progressPreviewEl.remove();
        progressPreviewEl = null;
    }
}

function ensureProgressPreviewMedia() {
    if (!progressPreviewEl || previewVideo || !currentVideoUrl) return;

    previewVideo = document.createElement('video');
    previewVideo.className = 'progress-preview-video';
    previewVideo.muted = true;
    previewVideo.playsInline = true;
    previewVideo.preload = 'metadata';
    previewVideo.crossOrigin = 'anonymous';
    const timeEl = progressPreviewEl.querySelector('.progress-preview-time');
    progressPreviewEl.insertBefore(previewVideo, timeEl);
    progressPreviewEl.classList.add('has-video');

    if (/\.m3u8(\?.*)?$/i.test(currentVideoUrl) && typeof Hls !== 'undefined' && Hls.isSupported && Hls.isSupported()) {
        previewHls = new Hls({
            loader: adFilteringEnabled && typeof CustomHlsJsLoader !== 'undefined'
                ? CustomHlsJsLoader
                : Hls.DefaultConfig.loader,
            enableWorker: true,
            lowLatencyMode: false,
            maxBufferLength: 8,
            maxMaxBufferLength: 15,
            maxBufferSize: 12 * 1000 * 1000,
            backBufferLength: 0
        });
        previewHls.loadSource(currentVideoUrl);
        previewHls.attachMedia(previewVideo);
    } else {
        previewVideo.src = currentVideoUrl;
    }
}

function scheduleProgressPreviewSeek(time) {
    if (!previewVideo) return;

    if (progressPreviewSeekTimer) {
        clearTimeout(progressPreviewSeekTimer);
    }

    progressPreviewSeekTimer = setTimeout(() => {
        try {
            if (Number.isFinite(time) && Math.abs((previewVideo.currentTime || 0) - time) > 1) {
                previewVideo.currentTime = Math.max(0, time);
            }
        } catch (e) {
        }
    }, 180);
}

function setupProgressPreview() {
    destroyProgressPreview();

    if (!art || !art.video) return;

    const progressBar = document.querySelector('#player .art-control-progress') ||
        document.querySelector('#player .art-progress');
    const playerEl = document.getElementById('player');
    if (!progressBar || !playerEl) return;

    progressPreviewEl = document.createElement('div');
    progressPreviewEl.className = 'progress-preview';
    progressPreviewEl.innerHTML = '<div class="progress-preview-fallback">预览加载中</div><div class="progress-preview-time">00:00</div>';
    playerEl.appendChild(progressPreviewEl);

    const timeEl = progressPreviewEl.querySelector('.progress-preview-time');
    const fallbackEl = progressPreviewEl.querySelector('.progress-preview-fallback');

    function updatePreview(clientX) {
        const rect = progressBar.getBoundingClientRect();
        const duration = Number(art.duration || art.video.duration || 0);
        const previewTime = getProgressPreviewTime(clientX, rect, duration);
        const playerRect = playerEl.getBoundingClientRect();
        const offsetX = Math.min(playerRect.width - 80, Math.max(80, clientX - playerRect.left));

        ensureProgressPreviewMedia();
        scheduleProgressPreviewSeek(previewTime);

        if (timeEl) timeEl.textContent = formatTime(previewTime);
        if (fallbackEl && previewVideo) fallbackEl.textContent = '预览加载中';
        progressPreviewEl.style.left = `${offsetX}px`;
        progressPreviewEl.classList.add('show');
    }

    function handlePointerMove(event) {
        updatePreview(event.clientX);
    }

    function handleTouchMove(event) {
        if (event.touches && event.touches[0]) {
            updatePreview(event.touches[0].clientX);
        }
    }

    function hidePreview() {
        if (progressPreviewEl) {
            progressPreviewEl.classList.remove('show');
        }
        if (progressPreviewDestroyTimer) {
            clearTimeout(progressPreviewDestroyTimer);
        }
        progressPreviewDestroyTimer = setTimeout(() => {
            if (previewHls && previewHls.destroy) {
                try {
                    previewHls.destroy();
                } catch (e) {
                }
            }
            previewHls = null;
            if (previewVideo) {
                try {
                    previewVideo.removeAttribute('src');
                    previewVideo.load();
                    previewVideo.remove();
                } catch (e) {
                }
                previewVideo = null;
                if (progressPreviewEl) progressPreviewEl.classList.remove('has-video');
            }
        }, 3000);
    }

    progressBar.addEventListener('pointermove', handlePointerMove);
    progressBar.addEventListener('mousemove', handlePointerMove);
    progressBar.addEventListener('touchmove', handleTouchMove, { passive: true });
    progressBar.addEventListener('pointerleave', hidePreview);
    progressBar.addEventListener('mouseleave', hidePreview);
    progressBar.addEventListener('touchend', hidePreview);
    progressBar.addEventListener('touchcancel', hidePreview);

    progressPreviewCleanup = () => {
        progressBar.removeEventListener('pointermove', handlePointerMove);
        progressBar.removeEventListener('mousemove', handlePointerMove);
        progressBar.removeEventListener('touchmove', handleTouchMove);
        progressBar.removeEventListener('pointerleave', hidePreview);
        progressBar.removeEventListener('mouseleave', hidePreview);
        progressBar.removeEventListener('touchend', hidePreview);
        progressBar.removeEventListener('touchcancel', hidePreview);
    };
}

// 初始化页面内容
async function initializePageContent() {
    if (window.QuickPlay && !await QuickPlay.prepare()) return;

    // 解析URL参数
    const urlParams = new URLSearchParams(window.location.search);
    let videoUrl = urlParams.get('url');
    const videoId = urlParams.get('id');
    const title = urlParams.get('title');
    const sourceCode = urlParams.get('source');
    let index = parseInt(urlParams.get('index') || '0');
    const episodesList = urlParams.get('episodes'); // 从URL获取集数信息
    const savedPosition = parseInt(urlParams.get('position') || '0'); // 获取保存的播放位置
    // 解决历史记录问题：检查URL是否是player.html开头的链接
    // 如果是，说明这是历史记录重定向，需要解析真实的视频URL
    if (videoUrl && videoUrl.includes('player.html')) {
        try {
            // 尝试从嵌套URL中提取真实的视频链接
            const nestedUrlParams = new URLSearchParams(videoUrl.split('?')[1]);
            // 从嵌套参数中获取真实视频URL
            const nestedVideoUrl = nestedUrlParams.get('url');
            // 检查嵌套URL是否包含播放位置信息
            const nestedPosition = nestedUrlParams.get('position');
            const nestedIndex = nestedUrlParams.get('index');
            const nestedTitle = nestedUrlParams.get('title');

            if (nestedVideoUrl) {
                videoUrl = nestedVideoUrl;

                // 更新当前URL参数
                const url = new URL(window.location.href);
                if (!urlParams.has('position') && nestedPosition) {
                    url.searchParams.set('position', nestedPosition);
                }
                if (!urlParams.has('index') && nestedIndex) {
                    url.searchParams.set('index', nestedIndex);
                }
                if (!urlParams.has('title') && nestedTitle) {
                    url.searchParams.set('title', nestedTitle);
                }
                // 替换当前URL
                window.history.replaceState({}, '', url);
            } else {
                showError('历史记录链接无效，请返回首页重新访问');
            }
        } catch (e) {
        }
    }

    // 保存当前视频URL
    currentVideoUrl = videoUrl || '';

    // 从localStorage获取数据
    currentVideoTitle = title || localStorage.getItem('currentVideoTitle') || '未知视频';
    currentEpisodeIndex = index;

    // 设置自动连播开关状态
    autoplayEnabled = localStorage.getItem('autoplayEnabled') !== 'false'; // 默认为true
    document.getElementById('autoplayToggle').checked = autoplayEnabled;

    // 获取广告过滤设置
    adFilteringEnabled = localStorage.getItem(PLAYER_CONFIG.adFilteringStorage) !== 'false'; // 默认为true

    // 监听自动连播开关变化
    document.getElementById('autoplayToggle').addEventListener('change', function (e) {
        autoplayEnabled = e.target.checked;
        localStorage.setItem('autoplayEnabled', autoplayEnabled);
    });

    // A shared localStorage episode list can belong to another browser tab.
    // Accept only the list for this tab and exact source/video/URL.
    try {
        const context = window.EpisodeContext?.read({source:sourceCode, id:videoId, url:videoUrl});
        if (context) {
            currentEpisodes = context.episodes;
            currentEpisodeNames = context.episodeNames || [];
        } else if (episodesList) {
            const fromUrl = JSON.parse(decodeURIComponent(episodesList));
            currentEpisodes = Array.isArray(fromUrl) && fromUrl.includes(videoUrl) ? fromUrl : [];
        } else if (!sourceCode && !videoId) {
            const legacy = JSON.parse(localStorage.getItem('currentEpisodes') || '[]');
            currentEpisodes = Array.isArray(legacy) && legacy.includes(videoUrl) ? legacy : [];
        }
        if (!currentEpisodes.length && videoId && sourceCode && isDirectPlayableVideoUrl(videoUrl)) {
            // Shared links/new tabs have no session cache: verify episodes against the source detail.
            try {
                const params = getDetailApiParamsForSource(sourceCode);
                const response = await fetch(`/api/detail?id=${encodeURIComponent(videoId)}${params}`, {signal:AbortSignal.timeout(6500)});
                if (response.ok) {
                    const detail = await response.json();
                    if (detail.episodes?.includes(videoUrl)) {
                        currentEpisodes = detail.episodes;
                        currentEpisodeNames = detail.episodeNames || [];
                        window.EpisodeContext?.write({source:sourceCode, id:videoId, episodes:currentEpisodes, episodeNames:currentEpisodeNames});
                    }
                }
            } catch (error) { console.warn('无法同步集数，仍可播放当前视频:', error); }
        }
        if (!currentEpisodes.length && videoUrl) currentEpisodes = [videoUrl];
        index = currentEpisodes.indexOf(videoUrl) >= 0 ? currentEpisodes.indexOf(videoUrl) : 0;
        currentEpisodeIndex = index;
        episodesReversed = localStorage.getItem('episodesReversed') === 'true';
    } catch (error) {
        currentEpisodes = videoUrl ? [videoUrl] : [];
        currentEpisodeNames = [];
        currentEpisodeIndex = 0;
        episodesReversed = false;
    }

    if (!isDirectPlayableVideoUrl(videoUrl) && videoId && sourceCode) {
        try {
            const resolved = await resolvePlayableEpisodeFromDetail(videoId, sourceCode, currentEpisodeIndex);
            if (resolved) {
                videoUrl = resolved.url;
                currentVideoUrl = resolved.url;
                currentEpisodes = resolved.episodes;
                currentEpisodeIndex = resolved.index;
                localStorage.setItem('currentEpisodes', JSON.stringify(currentEpisodes));
                window.EpisodeContext?.write({source:sourceCode, id:videoId, episodes:currentEpisodes});
                localStorage.setItem('currentEpisodeIndex', currentEpisodeIndex);

                const newUrl = new URL(window.location.href);
                newUrl.searchParams.set('url', resolved.url);
                newUrl.searchParams.set('index', resolved.index);
                window.history.replaceState({}, '', newUrl);
            } else {
                showError('当前播放地址不是可直接播放的视频链接，请切换资源或重新进入播放页');
                return;
            }
        } catch (error) {
            console.error('自动修正播放地址失败:', error);
            showError('播放地址解析失败，请切换资源或重新进入播放页');
            return;
        }
    }

    // 设置页面标题
    document.title = currentVideoTitle + ' - LibreTV播放器';
    document.getElementById('videoTitle').textContent = currentVideoTitle;

    // 初始化播放器
    if (videoUrl) {
        initPlayer(videoUrl);
    } else {
        showError('无效的视频链接');
    }

    // 渲染源信息
    renderResourceInfoBar();

    // 更新集数信息
    updateEpisodeInfo();

    // 渲染集数列表
    renderEpisodes();

    // 更新按钮状态
    updateButtonStates();

    // Metadata and recommendations load independently of video startup.
    void window.PlayerRecommendations?.load();

    // 更新排序按钮状态
    updateOrderButton();

    // 添加对进度条的监听，确保点击准确跳转
    setTimeout(() => {
        setupProgressBarPreciseClicks();
    }, 1000);

    // 添加键盘快捷键事件监听
    document.addEventListener('keydown', handleKeyboardShortcuts);
    document.addEventListener('keyup', handleKeyboardShortcutRelease);
    // 窗口失焦时收不到 keyup，按住 → 的 3 倍速需要恢复
    window.addEventListener('blur', () => { if (arrowBoostRate !== null || arrowHoldTimer) stopArrowBoost(); });

    // 添加页面离开事件监听，保存播放位置
    window.addEventListener('beforeunload', saveCurrentProgress);

    // 新增：页面隐藏（切后台/切标签）时也保存
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') {
            saveCurrentProgress();
        }
    });

    // 视频暂停时也保存
    const waitForVideo = setInterval(() => {
        if (art && art.video) {
            art.video.addEventListener('pause', saveCurrentProgress);

            // 新增：播放进度变化时节流保存
            let lastSave = 0;
            art.video.addEventListener('timeupdate', function() {
                const now = Date.now();
                if (now - lastSave > 5000) { // 每5秒最多保存一次
                    saveCurrentProgress();
                    lastSave = now;
                }
            });

            clearInterval(waitForVideo);
        }
    }, 200);
}

// 处理键盘快捷键
let arrowHoldTimer = null; // 按住 → 键超过 350ms 进入 3 倍速
let arrowBoostRate = null; // 按住 → 键期间的原始倍速
let shortcutHelp = null;

function isTypingTarget(target) {
    return Boolean(target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable));
}

function stopArrowBoost() {
    clearTimeout(arrowHoldTimer);
    arrowHoldTimer = null;
    if (arrowBoostRate !== null && art) {
        art.playbackRate = arrowBoostRate;
        showShortcutHint(`${arrowBoostRate === 1 ? '正常' : arrowBoostRate + ' 倍'}速度`, 'right');
    }
    arrowBoostRate = null;
    setTimeout(() => { temporaryRateActive = false; }, 50);
}

function handleKeyboardShortcuts(e) {
    // 忽略输入框中的按键事件
    if (isTypingTarget(e.target)) return;

    // Alt + Enter = 切换全屏（由快捷键映射处理）
    const action = window.PlayerEnhancements.shortcutAction(e);
    if (!action || !art) return;

    // 按住时浏览器会重复触发 keydown，只处理第一次
    if (e.repeat && action.type !== 'volume' && action.type !== 'seek') {
        e.preventDefault();
        return;
    }

    const { clampSeek, stepRate, storeRate } = window.PlayerEnhancements;
    switch (action.type) {
        case 'toggle':
            art.toggle();
            showShortcutHint(art.video.paused ? '已暂停' : '继续播放', 'play');
            break;
        case 'seek':
            art.currentTime = clampSeek(art.currentTime, action.delta, art.duration);
            showShortcutHint(`${action.delta < 0 ? '快退' : '快进'} ${Math.abs(action.delta)} 秒`, action.delta < 0 ? 'left' : 'right');
            break;
        case 'seek-forward-hold':
            // 短按 → 快进 5 秒（在松开时执行），按住超过 350ms 则 3 倍速播放直到松开
            clearTimeout(arrowHoldTimer);
            arrowHoldTimer = setTimeout(() => {
                arrowHoldTimer = null;
                if (!art || art.video.paused) return;
                temporaryRateActive = true;
                arrowBoostRate = art.playbackRate || 1;
                art.playbackRate = 3;
                showShortcutHint('3 倍速播放中', 'right');
            }, 350);
            break;
        case 'volume': {
            const volume = Math.max(0, Math.min(1, Math.round(((art.volume || 0) + action.delta) * 10) / 10));
            art.volume = volume;
            if (volume > 0 && art.muted) art.muted = false;
            showShortcutHint(`音量 ${Math.round(volume * 100)}%`, action.delta > 0 ? 'up' : 'down');
            break;
        }
        case 'mute':
            art.muted = !art.muted;
            showShortcutHint(art.muted ? '已静音' : '已取消静音', 'down');
            break;
        case 'episode':
            if (action.delta > 0 && currentEpisodeIndex < currentEpisodes.length - 1) {
                playNextEpisode();
                showShortcutHint('下一集', 'right');
            } else if (action.delta < 0 && currentEpisodeIndex > 0) {
                playPreviousEpisode();
                showShortcutHint('上一集', 'left');
            } else {
                showShortcutHint(action.delta > 0 ? '已是最后一集' : '已是第一集', action.delta > 0 ? 'right' : 'left');
            }
            break;
        case 'rate': {
            const rate = stepRate(art.playbackRate || 1, action.delta);
            art.playbackRate = rate;
            storeRate(rate);
            showShortcutHint(`${rate === 1 ? '正常' : rate + ' 倍'}速度`, action.delta > 0 ? 'up' : 'down');
            break;
        }
        case 'seek-percent':
            if (Number.isFinite(art.duration) && art.duration > 0) {
                art.currentTime = art.duration * action.value / 100;
                showShortcutHint(`跳到 ${action.value}%`, 'right');
            }
            break;
        case 'fullscreen':
            toggleFullscreenMode();
            break;
        case 'web-fullscreen':
            if (isMobilePlaybackDevice()) return;
            art.fullscreenWeb = !art.fullscreenWeb;
            break;
        case 'help':
            shortcutHelp?.toggle();
            break;
        case 'escape':
            if (shortcutHelp?.isOpen) shortcutHelp.close();
            else if (episodeDrawer?.isOpen) episodeDrawer.close();
            else return;
            break;
        default:
            return;
    }
    e.preventDefault();
}

function handleKeyboardShortcutRelease(e) {
    if (e.key !== 'ArrowRight' || e.altKey || isTypingTarget(e.target) || !art) return;
    if (arrowBoostRate !== null) {
        stopArrowBoost();
    } else if (arrowHoldTimer) {
        clearTimeout(arrowHoldTimer);
        arrowHoldTimer = null;
        art.currentTime = window.PlayerEnhancements.clampSeek(art.currentTime, 5, art.duration);
        showShortcutHint('快进 5 秒', 'right');
    }
    e.preventDefault();
}

// 显示快捷键提示
function showShortcutHint(text, direction) {
    const hintElement = document.getElementById('shortcutHint');
    const textElement = document.getElementById('shortcutText');
    const iconElement = document.getElementById('shortcutIcon');

    // 清除之前的超时
    if (shortcutHintTimeout) {
        clearTimeout(shortcutHintTimeout);
    }

    // 设置文本和图标方向
    textElement.textContent = text;

    if (direction === 'left') {
        iconElement.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path>';
    } else if (direction === 'right') {
        iconElement.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>';
    }  else if (direction === 'up') {
        iconElement.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"></path>';
    } else if (direction === 'down') {
        iconElement.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>';
    } else if (direction === 'fullscreen') {
        iconElement.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5"></path>';
    } else if (direction === 'play') {
        iconElement.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3l14 9-14 9V3z"></path>';
    }

    // 显示提示
    hintElement.classList.add('show');

    // 两秒后隐藏
    shortcutHintTimeout = setTimeout(() => {
        hintElement.classList.remove('show');
    }, 2000);
}

// 初始化播放器
function initPlayer(videoUrl) {
    if (!videoUrl) {
        return
    }

    destroyProgressPreview();
    playbackRestoreApplied = false;
    autoplayMutedNoticeShown = false;
    preferredRateApplied = false;
    resetEpisodePlaybackState();
    clearTimeout(playbackRecoveryTimer);
    playbackRecovery = null;

    // 销毁旧实例
    if (art) {
        episodeDrawer?.destroy();
        nextEpisodeCard?.destroy();
        shortcutHelp?.destroy();
        playbackNotice?.destroy();
        episodeDrawer = null;
        nextEpisodeCard = null;
        shortcutHelp = null;
        playbackNotice = null;
        // 快捷键提示挂在播放器内，销毁前移回页面，避免随旧实例一起被删除
        const hint = document.getElementById('shortcutHint');
        if (hint) document.body.appendChild(hint);
        mobileFullscreenInteraction?.destroy();
        mobileFullscreenInteraction = null;
        if (playerSurfaceCleanup) {
            playerSurfaceCleanup();
            playerSurfaceCleanup = null;
        }
        if (playerControlDensityCleanup) {
            playerControlDensityCleanup();
            playerControlDensityCleanup = null;
        }
        cleanupCastAvailability();
        restoreModalHome();
        art.destroy();
        art = null;
    }

    const hlsConfig = buildHlsConfig();

    // Create new ArtPlayer instance
    art = new Artplayer({
        container: '#player',
        url: videoUrl,
        type: /\.m3u8(?:\?|$)/i.test(videoUrl) ? 'm3u8' : 'auto',
        title: videoTitle,
        volume: 0.8,
        isLive: false,
        muted: false,
        autoplay: true,
        pip: true,
        autoSize: false,
        autoMini: true,
        screenshot: true,
        setting: true,
        loop: false,
        flip: false,
        playbackRate: true,
        aspectRatio: false,
        fullscreen: true,
        // 桌面端提供“网页全屏”；触屏设备由移动端全屏层接管
        fullscreenWeb: !isMobilePlaybackDevice(),
        subtitleOffset: false,
        miniProgressBar: true,
        mutex: true,
        backdrop: true,
        playsInline: true,
        autoPlayback: false,
        airplay: false,
        hotkey: false,
        theme: '#8b5cf6',
        lang: navigator.language.toLowerCase(),
        icons: {
            state: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="32" fill="#fff" fill-opacity="0.9"/><path d="M36 28.5 54 40 36 51.5z" fill="#0f1622"/></svg>'
        },
        controls: buildVideoControls(),
        moreVideoAttr: {
            crossOrigin: 'anonymous',
            'x-webkit-airplay': 'allow',
        },
        customType: {
            m3u8: function (video, url) {
                if (typeof Hls === 'undefined' || (typeof Hls.isSupported === 'function' && !Hls.isSupported())) {
                    if (typeof video.canPlayType === 'function' && video.canPlayType('application/vnd.apple.mpegurl')) {
                        prepareVideoForNativeCast(video, url);
                        video.src = url;
                        video.load();
                        tryStartPlayback();
                        return;
                    }

                    showError(classifyPlaybackError(null, { browserUnsupported: true, url }));
                    return;
                }

                // 清理之前的HLS实例
                if (currentHls && currentHls.destroy) {
                    try {
                        currentHls.destroy();
                    } catch (e) {
                    }
                }

                // 创建新的HLS实例
                const hls = new Hls(hlsConfig);
                currentHls = hls;
                const tracker = window.PlayerStats?.createTracker() || null;
                statsTracker = tracker;
                updateHlsQualityControl();

                // 跟踪是否已经显示错误
                let errorDisplayed = false;
                // 跟踪是否有错误发生
                let errorCount = 0;
                const recovery = window.PlayerEnhancements.createPlaybackRecovery();
                playbackRecovery = recovery;
                playbackNotice?.hide();
                // 跟踪视频是否开始播放
                let playbackStarted = false;
                // 跟踪视频是否出现bufferAppendError
                let bufferAppendErrorCount = 0;

                // 监听视频播放事件
                video.addEventListener('playing', function () {
                    playbackStarted = true;
                    playbackNotice?.hide();
                    document.getElementById('player-loading').style.display = 'none';
                    document.getElementById('error').style.display = 'none';
                });

                // 监听视频进度事件
                video.addEventListener('timeupdate', function () {
                    if (video.currentTime > 1) {
                        // 视频进度超过1秒，隐藏错误（如果存在）
                        document.getElementById('error').style.display = 'none';
                    }
                });

                hls.loadSource(url);
                hls.attachMedia(video);

                prepareVideoForNativeCast(video, url);

                hls.on(Hls.Events.MANIFEST_PARSED, function () {
                    updateHlsQualityControl();
                    tryStartPlayback();
                });

                hls.on(Hls.Events.ERROR, function (event, data) {
                    // 增加错误计数
                    errorCount++;

                    // 开播后的致命错误：hls.js 已停止加载，必须主动恢复，否则会一直转圈
                    if (data.fatal && playbackStarted) {
                        recoverMidPlayback(hls, recovery, data);
                        return;
                    }

                    // 处理bufferAppendError
                    if (data.details === 'bufferAppendError') {
                        bufferAppendErrorCount++;
                        // 如果视频已经开始播放，则忽略这个错误
                        if (playbackStarted) {
                            return;
                        }

                        // 如果出现多次bufferAppendError但视频未播放，尝试恢复
                        if (bufferAppendErrorCount >= 3) {
                            hls.recoverMediaError();
                        }
                    }

                    // 如果是致命错误，且视频未播放
                    if (data.fatal && !playbackStarted) {
                        const classifiedError = classifyPlaybackError(data, { url });
                        // 尝试恢复错误
                        switch (data.type) {
                            case Hls.ErrorTypes.NETWORK_ERROR:
                                if (errorCount > 3 && !errorDisplayed) {
                                    errorDisplayed = true;
                                    showError(classifiedError);
                                } else {
                                    hls.startLoad();
                                }
                                break;
                            case Hls.ErrorTypes.MEDIA_ERROR:
                                if (errorCount > 3 && !errorDisplayed) {
                                    errorDisplayed = true;
                                    showError(classifiedError);
                                } else {
                                    hls.recoverMediaError();
                                }
                                break;
                            default:
                                // 仅在多次恢复尝试后显示错误
                                if (errorCount > 3 && !errorDisplayed) {
                                    errorDisplayed = true;
                                    showError(classifiedError);
                                }
                                break;
                        }
                    }
                });

                // 监听分段加载事件
                hls.on(Hls.Events.FRAG_LOADED, function (event, data) {
                    recovery.progress();
                    tracker?.fragment(window.PlayerStats.fragmentStats(data));
                    // 分片可能在另一个域名上，记下来供“路由器直连规则”使用
                    window.SourceHosts?.learnUrl(data?.frag?.url);
                    document.getElementById('player-loading').style.display = 'none';
                });

                // 监听级别加载事件
                hls.on(Hls.Events.LEVEL_LOADED, function () {
                    updateHlsQualityControl();
                    document.getElementById('player-loading').style.display = 'none';
                });

                hls.on(Hls.Events.LEVEL_SWITCHED, function () {
                    updateHlsQualityControl();
                });

                hls.on(Hls.Events.BUFFER_CODECS, function (event, data) {
                    tracker?.codecs(data);
                });
            }
        }
    });

    window.QuickPlay?.attach(art.video);
    mobileFullscreenInteraction = window.createMobileFullscreenControls(
        art.template.$player, art,
        { title: () => currentVideoTitle, isFullscreen: isPlayerFullscreenActive,
          isTouchDevice: isMobilePlaybackDevice,
          hasEpisodes: () => currentEpisodes.length > 1,
          onEpisodes: toggleEpisodeDrawer }
    );
    setupPlayerOverlays();
    // 记住用户选择的倍速；新视频加载时浏览器会把倍速重置为 1（此时 readyState 为 0），不能记下来
    art.video.addEventListener('ratechange', () => {
        if (!art) return;
        if (!temporaryRateActive && art.video.readyState >= 1) {
            window.PlayerEnhancements.storeRate(art.video.playbackRate);
        }
        updateRateControl();
    });
    art.video.addEventListener('timeupdate', handlePlaybackProgress);
    art.video.addEventListener('webkitbeginfullscreen', () => maybeLockLandscapeOrientation());
    art.video.addEventListener('webkitendfullscreen', () => unlockLandscapeOrientation());

    setTimeout(() => {
        setupPlayerTopActions();
        setupPlayerSurfaceToggle();
        setupPlayerControlDensity();
        updateHlsQualityControl();
    }, 0);

    // artplayer 没有 'fullscreenWeb:enter', 'fullscreenWeb:exit' 等事件
    // 所以原控制栏隐藏代码并没有起作用
    // 实际起作用的是 artplayer 默认行为，它支持自动隐藏工具栏
    // 但有一个 bug： 在副屏全屏时，鼠标移出副屏后不会自动隐藏工具栏
    // 下面进一并重构和修复：
    let hideTimer;

    // 隐藏控制栏
    function hideControls() {
        if (art && art.controls) {
            art.controls.show = false;
        }
    }

    // 重置计时器，计时器超时时间与 artplayer 保持一致
    function resetHideTimer() {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
            hideControls();
        }, Artplayer.CONTROL_HIDE_TIME);
    }

    // 处理鼠标离开浏览器窗口
    function handleMouseOut(e) {
        if (e && !e.relatedTarget) {
            resetHideTimer();
        }
    }

    // 全屏状态切换时注册/移除 mouseout 事件，监听鼠标移出屏幕事件
    // 从而对播放器状态栏进行隐藏倒计时
    function handleFullScreen(isFullScreen, isWeb) {
        if (isFullScreen) {
            document.addEventListener('mouseout', handleMouseOut);
            maybeLockLandscapeOrientation();
        } else {
            document.removeEventListener('mouseout', handleMouseOut);
            // 退出全屏时清理计时器
            clearTimeout(hideTimer);
            unlockLandscapeOrientation();
            restoreModalHome();
        }
        setTimeout(updatePlayerControlDensity, 0);
    }

    // 播放器加载完成后初始隐藏工具栏
    art.on('ready', () => {
        hideControls();
        setupPlayerTopActions();
        setupPlayerSurfaceToggle();
        setupPlayerControlDensity();
        updateHlsQualityControl();
        setupProgressPreview();
    });

    // 全屏 Web 模式处理
    art.on('fullscreenWeb', function (isFullScreen) {
        handleFullScreen(isFullScreen, true);
    });

    // 全屏模式处理
    art.on('fullscreen', function (isFullScreen) {
        handleFullScreen(isFullScreen, false);
    });

    art.on('video:loadedmetadata', function() {
        skipState.ready = true;
        applyPreferredPlaybackRate();
        if (isPlayerFullscreenActive()) maybeLockLandscapeOrientation();
        document.getElementById('player-loading').style.display = 'none';
        videoHasEnded = false; // 视频加载时重置结束标志
        restorePlaybackPosition();

        // 设置进度条点击监听
        setupPlayerTopActions();
        setupPlayerSurfaceToggle();
        setupPlayerControlDensity();
        setupProgressBarPreciseClicks();
        setupProgressPreview();
        tryStartPlayback();

        // 视频加载成功后，在稍微延迟后将其添加到观看历史
        setTimeout(saveToHistory, 3000);

        // 启动定期保存播放进度
        startProgressSaveInterval();
    })

    art.on('video:canplay', function() {
        restorePlaybackPosition();
        tryStartPlayback();
    });

    // 错误处理
    art.on('video:error', function (error) {
        // 如果正在切换视频，忽略错误
        if (window.isSwitchingVideo) {
            return;
        }

        // 隐藏所有加载指示器
        const loadingElements = document.querySelectorAll('#player-loading, .player-loading-container');
        loadingElements.forEach(el => {
            if (el) el.style.display = 'none';
        });

        // 已经播放了一段才出错（多见于原生 HLS / MP4）：不遮挡画面，提示重试或换源
        if (art?.video?.currentTime > 1) {
            showPlaybackInterrupted();
            return;
        }
        showError(classifyPlaybackError(error, { url: currentVideoUrl }));
    });

    // 添加移动端长按三倍速播放功能
    setupLongPressSpeedControl();

    // 视频播放结束事件
    art.on('video:ended', function () {
        videoHasEnded = true;

        clearVideoProgress();

        // 如果自动播放下一集开启，且确实有下一集（用户在倒计时卡片上点了“取消”则不自动连播）
        if (autoplayEnabled && !nextEpisodeCard?.dismissed && currentEpisodeIndex < currentEpisodes.length - 1) {
            // 短暂延迟以确保所有事件处理完成
            setTimeout(() => {
                playNextEpisode();
                videoHasEnded = false; // 重置标志
            }, 300);
        } else {
            art.fullscreen = false;
        }
    });

    // 10秒后如果仍在加载，但不立即显示错误
    setTimeout(function () {
        // 如果视频已经播放开始，则不显示错误
        if (art && art.video && art.video.currentTime > 0) {
            return;
        }

        const loadingElement = document.getElementById('player-loading');
        if (loadingElement && loadingElement.style.display !== 'none') {
            loadingElement.innerHTML = `
                <div class="loading-spinner"></div>
                <div>视频加载时间较长，请耐心等待...</div>
                <div style="font-size: 12px; color: #aaa; margin-top: 10px;">如长时间无响应，请尝试其他视频源</div>
            `;
        }
    }, 10000);
}

// 自定义M3U8 Loader用于过滤广告
class CustomHlsJsLoader extends Hls.DefaultConfig.loader {
    constructor(config) {
        super(config);
        const load = this.load.bind(this);
        this.load = function (context, config, callbacks) {
            // 拦截manifest和level请求
            if (context.type === 'manifest' || context.type === 'level') {
                const onSuccess = callbacks.onSuccess;
                callbacks.onSuccess = function (response, stats, context) {
                    if (response.data && typeof response.data === 'string') {
                        response.data = filterAdsFromM3U8(response.data, response.url || context.url);
                    }
                    return onSuccess(response, stats, context);
                };
            }
            // 执行原始load方法
            load(context, config, callbacks);
        };
    }
}

// 去掉插在正片里的广告分片；识别不出广告时原样返回（保留分段标记，避免时间轴错乱）
function filterAdsFromM3U8(m3u8Content, playlistUrl = '') {
    if (!m3u8Content) return '';
    const result = window.HlsAdFilter?.filterPlaylist(m3u8Content, playlistUrl);
    if (!result) return m3u8Content;
    if (result.removedSegments > 0) {
        console.info(`已过滤 ${result.removedSegments} 个广告分片（约 ${Math.round(result.removedSeconds)} 秒）`);
    }
    // 只记媒体播放列表的结果（主列表没有分片，不能覆盖掉真实的过滤数）
    if (/#EXTINF/.test(m3u8Content)) statsTracker?.ads(result);
    return result.content;
}


// 播放中途的致命错误：网络错误按退避重试加载，媒体错误尝试修复，多次失败后提示用户
function recoverMidPlayback(hls, recovery, data) {
    if (hls !== currentHls) return;
    const step = recovery.next(data.type);
    console.warn('播放中途出错，尝试恢复:', data.type, data.details, step.action);
    clearTimeout(playbackRecoveryTimer);
    if (step.action === 'startLoad') {
        playbackRecoveryTimer = setTimeout(() => {
            if (currentHls === hls) hls.startLoad();
        }, step.delay);
    } else if (step.action === 'recoverMedia') {
        hls.recoverMediaError();
    } else if (step.action === 'swapAudioCodec') {
        hls.swapAudioCodec();
        hls.recoverMediaError();
    } else {
        showPlaybackInterrupted();
    }
}

function showPlaybackInterrupted() {
    if (window.isSwitchingVideo) return;
    const loadingEl = document.getElementById('player-loading');
    if (loadingEl) loadingEl.style.display = 'none';
    playbackNotice?.show(navigator.onLine === false
        ? '网络已断开，恢复后会自动重试'
        : '当前来源加载中断，可重试或切换资源');
}

function retryInterruptedPlayback() {
    playbackNotice?.hide();
    if (!art) return;
    clearTimeout(playbackRecoveryTimer);
    if (currentHls) {
        playbackRecovery?.reset();
        currentHls.startLoad();
    } else if (currentVideoUrl && typeof art.switchQuality === 'function') {
        art.switchQuality(currentVideoUrl);
    }
    if (art.video?.paused) tryStartPlayback();
}

window.addEventListener('online', () => {
    if (playbackNotice?.visible) retryInterruptedPlayback();
});

// 显示错误
function showError(message) {
    if (window.QuickPlay?.onError()) return;
    // 在视频已经播放的情况下不显示错误
    if (art && art.video && art.video.currentTime > 1) {
        return;
    }
    const normalized = typeof message === 'object'
        ? message
        : classifyPlaybackError({ message: String(message || '') }, { url: currentVideoUrl });
    const loadingEl = document.getElementById('player-loading');
    if (loadingEl) loadingEl.style.display = 'none';
    const errorEl = document.getElementById('error');
    if (errorEl) errorEl.style.display = 'flex';
    const errorMsgEl = document.getElementById('error-message');
    if (errorMsgEl) errorMsgEl.textContent = normalized.title || '视频播放失败';
    const errorSubEl = document.getElementById('error-message-sub');
    if (errorSubEl) errorSubEl.textContent = normalized.message || '请尝试其他视频源或稍后重试';
    const errorActionsEl = document.getElementById('error-actions');
    if (errorActionsEl) {
        errorActionsEl.innerHTML = `
            <button type="button" class="error-action-primary" onclick="showResourceSwitchModal()">${normalized.actionLabel || '一键切换资源'}</button>
            <button type="button" class="error-action-secondary" onclick="window.location.reload()">重试</button>
        `;
    }
}

function showResourceSwitchModal() {
    return showSwitchResourceModal();
}

function rememberModalHome(modal) {
    if (!modal || modalHome.parent) return;
    modalHome.parent = modal.parentNode;
    modalHome.nextSibling = modal.nextSibling;
}

function moveModalToFullscreenHost(modal = document.getElementById('modal')) {
    if (!modal) return;
    rememberModalHome(modal);

    const fullscreenHost = getPlayerFullscreenHost();
    if (fullscreenHost && modal.parentNode !== fullscreenHost) {
        fullscreenHost.appendChild(modal);
        modal.classList.add('player-fullscreen-modal');
        return;
    }

    if (!fullscreenHost) {
        restoreModalHome(modal);
    }
}

function restoreModalHome(modal = document.getElementById('modal')) {
    if (!modal || !modalHome.parent) return;

    if (modal.parentNode !== modalHome.parent) {
        modalHome.parent.insertBefore(modal, modalHome.nextSibling);
    }

    modal.classList.remove('player-fullscreen-modal');
    modalHome.parent = null;
    modalHome.nextSibling = null;
}

function closeModal() {
    window.QuickPlay?.cancelChoice();
    window.cancelResourceSwitchSpeedChecks?.();
    const modal = document.getElementById('modal');
    if (modal) {
        modal.classList.add('hidden');
    }
    const modalContent = document.getElementById('modalContent');
    if (modalContent) {
        modalContent.innerHTML = '';
    }
    restoreModalHome(modal);
}

// 更新集数信息
// 集数信息只在信息栏显示一次（带集名）；上一集/下一集之间只显示有意义的集名，避免重复
function currentEpisodeCounterText() {
    if (currentEpisodes.length <= 1) return '正片';
    const label = window.PlayerEnhancements.episodeLabel(currentEpisodeIndex, currentEpisodeNames[currentEpisodeIndex]);
    return `第 ${currentEpisodeIndex + 1} / ${currentEpisodes.length} 集${label.title ? ' · ' + label.title : ''}`;
}

function updateEpisodeInfo() {
    const counter = document.querySelector('.resource-info-bar-videos');
    if (counter) counter.textContent = currentEpisodeCounterText();
    const label = window.PlayerEnhancements.episodeLabel(currentEpisodeIndex, currentEpisodeNames[currentEpisodeIndex]);
    const navInfo = document.getElementById('episodeInfo');
    if (navInfo) navInfo.textContent = currentEpisodes.length > 0 ? label.title : '无集数信息';
}

// 更新按钮状态
function updateButtonStates() {
    const prevButton = document.getElementById('prevButton');
    const nextButton = document.getElementById('nextButton');

    // 处理上一集按钮
    if (currentEpisodeIndex > 0) {
        prevButton.classList.remove('bg-gray-700', 'cursor-not-allowed');
        prevButton.classList.add('bg-[#222]', 'hover:bg-[#333]');
        prevButton.removeAttribute('disabled');
    } else {
        prevButton.classList.add('bg-gray-700', 'cursor-not-allowed');
        prevButton.classList.remove('bg-[#222]', 'hover:bg-[#333]');
        prevButton.setAttribute('disabled', '');
    }

    // 处理下一集按钮
    if (currentEpisodeIndex < currentEpisodes.length - 1) {
        nextButton.classList.remove('bg-gray-700', 'cursor-not-allowed');
        nextButton.classList.add('bg-[#222]', 'hover:bg-[#333]');
        nextButton.removeAttribute('disabled');
    } else {
        nextButton.classList.add('bg-gray-700', 'cursor-not-allowed');
        nextButton.classList.remove('bg-[#222]', 'hover:bg-[#333]');
        nextButton.setAttribute('disabled', '');
    }
}

// 渲染集数按钮
function renderEpisodes() {
    const episodesList = document.getElementById('episodesList');
    if (!episodesList) return;

    if (!currentEpisodes || currentEpisodes.length === 0) {
        episodesList.innerHTML = '<div class="col-span-full text-center text-gray-400 py-8">没有可用的集数</div>';
        return;
    }

    const episodes = episodesReversed ? [...currentEpisodes].reverse() : currentEpisodes;
    let html = '';

    episodes.forEach((episode, index) => {
        // 根据倒序状态计算真实的剧集索引
        const realIndex = episodesReversed ? currentEpisodes.length - 1 - index : index;
        const isActive = realIndex === currentEpisodeIndex;
        // 综艺等按日期/标题命名的集数显示名称，纯数字集名只显示序号
        const label = window.PlayerEnhancements.episodeLabel(realIndex, currentEpisodeNames[realIndex]);
        const titleText = escapeHtmlAttr(label.title || `第 ${label.number} 集`);

        html += `
            <button id="episode-${realIndex}" 
                    onclick="playEpisode(${realIndex})" title="${titleText}"
                    class="px-4 py-2 ${isActive ? 'episode-active' : '!bg-[#222] hover:!bg-[#333] hover:!shadow-none'} !border ${isActive ? '!border-blue-500' : '!border-[#333]'} rounded-lg transition-colors text-center episode-btn ${label.title ? 'episode-btn-titled' : ''}">
                ${label.title ? `<span class="episode-btn-number">${label.number}</span><span class="episode-btn-title">${escapeHtmlAttr(label.title)}</span>` : label.number}
            </button>
        `;
    });

    episodesList.innerHTML = html;
    episodesList.classList.toggle('episode-list-titled', html.includes('episode-btn-titled'));
    episodeDrawer?.refresh();
    updateEpisodeControlVisibility();
    updateSideEpisodes();
}

// 播放指定集数
function playEpisode(index) {
    window.QuickPlay?.stop();
    // 确保index在有效范围内
    if (index < 0 || index >= currentEpisodes.length) {
        return;
    }

    // 保存当前播放进度（如果正在播放）
    if (art && art.video && !art.video.paused && !videoHasEnded) {
        saveCurrentProgress();
    }

    // 清除进度保存计时器
    if (progressSaveInterval) {
        clearInterval(progressSaveInterval);
        progressSaveInterval = null;
    }

    // 首先隐藏之前可能显示的错误
    document.getElementById('error').style.display = 'none';
    // 显示加载指示器
    document.getElementById('player-loading').style.display = 'flex';
    document.getElementById('player-loading').innerHTML = `
        <div class="loading-spinner"></div>
        <div>正在加载视频...</div>
    `;

    // 获取 sourceCode
    const urlParams2 = new URLSearchParams(window.location.search);
    const sourceCode = urlParams2.get('source_code');

    // 准备切换剧集的URL
    const url = currentEpisodes[index];

    // 更新当前剧集索引
    currentEpisodeIndex = index;
    currentVideoUrl = url;
    videoHasEnded = false; // 重置视频结束标志
    playbackRestoreApplied = false;
    preferredRateApplied = false;
    nextEpisodeCard?.reset();
    resetEpisodePlaybackState();
    destroyProgressPreview();

    clearVideoProgress();

    // 更新URL参数（不刷新页面）
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.set('index', index);
    currentUrl.searchParams.set('url', url);
    currentUrl.searchParams.delete('position');
    currentUrl.searchParams.set('episodeName', currentEpisodeNames[index] || '');
    window.history.replaceState({}, '', currentUrl.toString());

    if (isWebkit) {
        initPlayer(url);
    } else {
        art.switch = url;
        tryStartPlayback();
    }

    // 更新UI
    updateEpisodeInfo();
    updateButtonStates();
    renderEpisodes();

    // 重置用户点击位置记录
    userClickedPosition = null;

    // 三秒后保存到历史记录
    setTimeout(() => saveToHistory(), 3000);
}

// 播放上一集
function playPreviousEpisode() {
    if (currentEpisodeIndex > 0) {
        playEpisode(currentEpisodeIndex - 1);
    }
}

// 播放下一集
function playNextEpisode() {
    if (currentEpisodeIndex < currentEpisodes.length - 1) {
        playEpisode(currentEpisodeIndex + 1);
    }
}

// 复制播放链接
function copyLinks() {
    // 尝试从URL中获取参数
    const urlParams = new URLSearchParams(window.location.search);
    const linkUrl = urlParams.get('url') || '';
    if (linkUrl !== '') {
        navigator.clipboard.writeText(linkUrl).then(() => {
            showToast('播放链接已复制', 'success');
        }).catch(err => {
            showToast('复制失败，请检查浏览器权限', 'error');
        });
    }
}

// 切换集数排序
function toggleEpisodeOrder() {
    episodesReversed = !episodesReversed;

    // 保存到localStorage
    localStorage.setItem('episodesReversed', episodesReversed);

    // 重新渲染集数列表
    renderEpisodes();

    // 更新排序按钮
    updateOrderButton();
}

// 更新排序按钮状态
function updateOrderButton() {
    const orderText = document.getElementById('orderText');
    const orderIcon = document.getElementById('orderIcon');

    if (orderText && orderIcon) {
        orderText.textContent = episodesReversed ? '正序排列' : '倒序排列';
        orderIcon.style.transform = episodesReversed ? 'rotate(180deg)' : '';
    }
}

// 设置 ArtPlayer 进度条准确点击处理
function setupProgressBarPreciseClicks() {
    const progressBar = document.querySelector('#player .art-control-progress') ||
        document.querySelector('#player .art-progress');
    if (!progressBar || !art || !art.video) return;

    // 移除可能存在的旧事件监听器
    progressBar.removeEventListener('mousedown', handleProgressBarClick);

    // 添加新的事件监听器
    progressBar.addEventListener('mousedown', handleProgressBarClick);

    // 在移动端也添加触摸事件支持
    progressBar.removeEventListener('touchstart', handleProgressBarTouch);
    progressBar.addEventListener('touchstart', handleProgressBarTouch);

    // 处理进度条点击
    function handleProgressBarClick(e) {
        if (!art || !art.video) return;

        // 计算点击位置相对于进度条的比例
        const rect = e.currentTarget.getBoundingClientRect();
        const percentage = (e.clientX - rect.left) / rect.width;

        // 计算点击位置对应的视频时间
        const duration = art.video.duration;
        let clickTime = percentage * duration;

        // 处理视频接近结尾的情况
        if (duration - clickTime < 1) {
            // 如果点击位置非常接近结尾，稍微往前移一点
            clickTime = Math.min(clickTime, duration - 1.5);

        }

        // 记录用户点击的位置
        userClickedPosition = clickTime;

        // 阻止事件冒泡后直接使用 ArtPlayer seek，避免接近片尾时误跳到结束状态
        e.stopPropagation();

        // 直接设置视频时间
        art.seek(clickTime);
    }

    // 处理移动端触摸事件
    function handleProgressBarTouch(e) {
        if (!art || !art.video || !e.touches[0]) return;

        const touch = e.touches[0];
        const rect = e.currentTarget.getBoundingClientRect();
        const percentage = (touch.clientX - rect.left) / rect.width;

        const duration = art.video.duration;
        let clickTime = percentage * duration;

        // 处理视频接近结尾的情况
        if (duration - clickTime < 1) {
            clickTime = Math.min(clickTime, duration - 1.5);
        }

        // 记录用户点击的位置
        userClickedPosition = clickTime;

        e.stopPropagation();
        art.seek(clickTime);
    }
}

// 在播放器初始化后添加视频到历史记录
function saveToHistory() {
    // 确保 currentEpisodes 非空且有当前视频URL
    if (!currentEpisodes || currentEpisodes.length === 0 || !currentVideoUrl || !art?.video || art.video.currentTime <= 0) {
        return;
    }

    // 尝试从URL中获取参数
    const urlParams = new URLSearchParams(window.location.search);
    const sourceName = urlParams.get('source') || '';
    const sourceCode = urlParams.get('source') || '';
    const id_from_params = urlParams.get('id'); // Get video ID from player URL (passed as 'id')

    // 获取当前播放进度
    let currentPosition = 0;
    let videoDuration = 0;

    if (art && art.video) {
        currentPosition = art.video.currentTime;
        videoDuration = art.video.duration;
    }

    // Define a show identifier: Prioritize sourceName_id, fallback to first episode URL or current video URL
    let show_identifier_for_video_info;
    if (sourceName && id_from_params) {
        show_identifier_for_video_info = `${sourceName}_${id_from_params}`;
    } else {
        show_identifier_for_video_info = (currentEpisodes && currentEpisodes.length > 0) ? currentEpisodes[0] : currentVideoUrl;
    }

    // 构建要保存的视频信息对象
    const videoInfo = {
        title: currentVideoTitle,
        ...window.QuickPlay?.historyInfo(),
        directVideoUrl: currentVideoUrl, // Current episode's direct URL
        url: `player.html?url=${encodeURIComponent(currentVideoUrl)}&title=${encodeURIComponent(currentVideoTitle)}&source=${encodeURIComponent(sourceName)}&source_code=${encodeURIComponent(sourceCode)}&id=${encodeURIComponent(id_from_params || '')}&index=${currentEpisodeIndex}&position=${Math.floor(currentPosition || 0)}`,
        episodeIndex: currentEpisodeIndex,
        sourceName: sourceName,
        vod_id: id_from_params || '', // Store the ID from params as vod_id in history item
        sourceCode: sourceCode,
        showIdentifier: show_identifier_for_video_info, // Identifier for the show/series
        timestamp: Date.now(),
        playbackPosition: currentPosition,
        duration: videoDuration,
        episodeNames: [...currentEpisodeNames],
        episodes: currentEpisodes && currentEpisodes.length > 0 ? [...currentEpisodes] : []
    };
    
    try {
        const history = JSON.parse(localStorage.getItem('viewingHistory') || '[]');

        // 检查是否已经存在相同的系列记录 (基于标题、来源和 showIdentifier)
        const existingIndex = history.findIndex(item => 
            item.title === videoInfo.title && 
            item.sourceName === videoInfo.sourceName && 
            item.showIdentifier === videoInfo.showIdentifier
        );

        if (existingIndex !== -1) {
            // 存在则更新现有记录的当前集数、时间戳、播放进度和URL等
            const existingItem = history[existingIndex];
            Object.assign(existingItem, Object.fromEntries(Object.entries(window.QuickPlay?.historyInfo() || {}).filter(([, value]) => value)));
            existingItem.episodeIndex = videoInfo.episodeIndex;
            existingItem.timestamp = videoInfo.timestamp;
            existingItem.sourceName = videoInfo.sourceName; // Should be consistent, but update just in case
            existingItem.sourceCode = videoInfo.sourceCode;
            existingItem.vod_id = videoInfo.vod_id;
            
            // Update URLs to reflect the current episode being watched
            existingItem.episodeNames = videoInfo.episodeNames;
            existingItem.directVideoUrl = videoInfo.directVideoUrl; // Current episode's direct URL
            existingItem.url = videoInfo.url; // Player link for the current episode

            // 更新播放进度信息
            existingItem.playbackPosition = videoInfo.playbackPosition;
            existingItem.duration = videoInfo.duration || existingItem.duration;
            
            // 更新集数列表（如果新的集数列表与存储的不同，例如集数增加了）
            if (videoInfo.episodes && videoInfo.episodes.length > 0) {
                if (!existingItem.episodes || 
                    !Array.isArray(existingItem.episodes) || 
                    existingItem.episodes.length !== videoInfo.episodes.length || 
                    !videoInfo.episodes.every((ep, i) => ep === existingItem.episodes[i])) { // Basic check for content change
                    existingItem.episodes = [...videoInfo.episodes]; // Deep copy
                }
            }
            
            // 移到最前面
            const updatedItem = history.splice(existingIndex, 1)[0];
            history.unshift(updatedItem);
        } else {
            // 添加新记录到最前面
            history.unshift(videoInfo);
        }

        // 限制历史记录数量为50条
        if (history.length > 50) history.splice(50);

        localStorage.setItem('viewingHistory', JSON.stringify(history));
    } catch (e) {
    }
}

// 显示恢复位置提示
function showPositionRestoreHint(position) {
    if (!position || position < 10) return;

    // 创建提示元素
    const hint = document.createElement('div');
    hint.className = 'position-restore-hint';
    hint.innerHTML = `
        <div class="hint-content">
            已从 ${formatTime(position)} 继续播放
        </div>
    `;

    // 添加到播放器容器
    const playerContainer = document.querySelector('.player-container'); // Ensure this selector is correct
    if (playerContainer) { // Check if playerContainer exists
        playerContainer.appendChild(hint);
    } else {
        return; // Exit if container not found
    }

    // 显示提示
    setTimeout(() => {
        hint.classList.add('show');

        // 3秒后隐藏
        setTimeout(() => {
            hint.classList.remove('show');
            setTimeout(() => hint.remove(), 300);
        }, 3000);
    }, 100);
}

// 格式化时间为 mm:ss 格式
function formatTime(seconds) {
    if (isNaN(seconds)) return '00:00';

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);

    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}

// 开始定期保存播放进度
function startProgressSaveInterval() {
    // 清除可能存在的旧计时器
    if (progressSaveInterval) {
        clearInterval(progressSaveInterval);
    }

    // 每30秒保存一次播放进度
    progressSaveInterval = setInterval(saveCurrentProgress, 30000);
}

// 保存当前播放进度
function saveCurrentProgress() {
    if (!art || !art.video) return;
    const currentTime = art.video.currentTime;
    const duration = art.video.duration;
    if (!duration || currentTime < 1) return;

    // 在localStorage中保存进度
    const progressKey = `videoProgress_${getVideoId()}`;
    const progressData = {
        position: currentTime,
        duration: duration,
        timestamp: Date.now()
    };
    try {
        localStorage.setItem(progressKey, JSON.stringify(progressData));
        // --- 新增：同步更新 viewingHistory 中的进度 ---
        try {
            const historyRaw = localStorage.getItem('viewingHistory');
            if (historyRaw) {
                const history = JSON.parse(historyRaw);
                // 进度属于当前来源中的作品与集数，不能更新同名影片。
                const params = new URLSearchParams(location.search);
                const idx = history.findIndex(item =>
                    item.title === currentVideoTitle &&
                    item.sourceName === (params.get('source') || '') &&
                    String(item.vod_id || '') === (params.get('id') || '') &&
                    (item.episodeIndex === undefined || item.episodeIndex === currentEpisodeIndex)
                );
                if (idx !== -1) {
                    // 只在进度有明显变化时才更新，减少写入
                    if (
                        Math.abs((history[idx].playbackPosition || 0) - currentTime) > 2 ||
                        Math.abs((history[idx].duration || 0) - duration) > 2
                    ) {
                        history[idx].playbackPosition = currentTime;
                        history[idx].duration = duration;
                        history[idx].timestamp = Date.now();
                        localStorage.setItem('viewingHistory', JSON.stringify(history));
                    }
                }
            }
        } catch (e) {
        }
    } catch (e) {
    }
}

// 设置移动端长按三倍速播放功能
function setupLongPressSpeedControl() {
    if (!art || !art.video) return;

    // 挂在 Artplayer 的播放器节点上：全屏时它会被移到全屏图层，#player 容器收不到触摸事件
    const playerElement = art.template?.$player || document.getElementById('player');
    let longPressTimer = null;
    let originalPlaybackRate = 1.0;
    let isLongPress = false;
    let pressStart = null;

    // 显示快速提示
    function showSpeedHint(speed) {
        showShortcutHint(speed === 3 ? '3 倍速播放中' : `${speed}倍速`, 'right');
    }

    // 禁用右键
    playerElement.oncontextmenu = () => {
        // 检测是否为移动设备
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

        // 只在移动设备上禁用右键
        if (isMobile) {
            return false;
        }
        return true; // 在桌面设备上允许右键菜单
    };

    // 触摸开始事件
    playerElement.addEventListener('touchstart', function (e) {
        // 全屏下同样支持长按 3 倍速；按在按钮、面板上或多指触摸时不触发
        if (e.touches.length !== 1 || e.target.closest(LONG_PRESS_EXCLUDED_SELECTOR)) return;
        pressStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        // 检查视频是否正在播放，如果没有播放则不触发长按功能
        if (art.video.paused) {
            return; // 视频暂停时不触发长按功能
        }

        // 保存原始播放速度
        originalPlaybackRate = art.video.playbackRate;

        // 设置长按计时器
        longPressTimer = setTimeout(() => {
            // 再次检查视频是否仍在播放
            if (art.video.paused) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
                return;
            }

            // 长按超过500ms，设置为3倍速（临时倍速，不写入记忆）
            temporaryRateActive = true;
            art.video.playbackRate = 3.0;
            isLongPress = true;
            showSpeedHint(3.0);

            // 只在确认为长按时阻止默认行为
            e.preventDefault();
        }, 500);
    }, { passive: false });

    // 触摸结束事件
    playerElement.addEventListener('touchend', function (e) {
        // 清除长按计时器
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }

        // 如果是长按状态，恢复原始播放速度
        if (isLongPress) {
            art.video.playbackRate = originalPlaybackRate;
            isLongPress = false;
            setTimeout(() => { temporaryRateActive = false; }, 50);
            showSpeedHint(originalPlaybackRate);

            // 阻止长按后的点击事件
            e.preventDefault();
        }
        // 如果不是长按，则允许正常的点击事件（暂停/播放）
    });

    // 触摸取消事件
    playerElement.addEventListener('touchcancel', function () {
        // 清除长按计时器
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }

        // 如果是长按状态，恢复原始播放速度
        if (isLongPress) {
            art.video.playbackRate = originalPlaybackRate;
            isLongPress = false;
            setTimeout(() => { temporaryRateActive = false; }, 50);
        }
    });

    // 触摸移动事件 - 防止在长按时触发页面滚动；手指移动则是滑动手势，取消长按
    playerElement.addEventListener('touchmove', function (e) {
        if (isLongPress) {
            e.preventDefault();
            return;
        }
        if (longPressTimer && pressStart && e.touches[0] &&
            Math.hypot(e.touches[0].clientX - pressStart.x, e.touches[0].clientY - pressStart.y) > 10) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    }, { passive: false, capture: true });

    // 视频暂停时取消长按状态
    art.video.addEventListener('pause', function () {
        if (isLongPress) {
            art.video.playbackRate = originalPlaybackRate;
            isLongPress = false;
            setTimeout(() => { temporaryRateActive = false; }, 50);
        }

        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    });
}

// 清除视频进度记录
function clearVideoProgress() {
    const progressKey = `videoProgress_${getVideoId()}`;
    try {
        localStorage.removeItem(progressKey);
    } catch (e) {
    }
}

// 获取视频唯一标识
function getVideoId() {
    // 使用视频标题和集数索引作为唯一标识
    // If currentVideoUrl is available and more unique, prefer it. Otherwise, fallback.
    if (currentVideoUrl) {
        return `${encodeURIComponent(currentVideoUrl)}`;
    }
    return `${encodeURIComponent(currentVideoTitle)}_${currentEpisodeIndex}`;
}

let controlsLocked = false;
function toggleControlsLock() {
    const container = document.getElementById('playerContainer');
    controlsLocked = !controlsLocked;
    container.classList.toggle('controls-locked', controlsLocked);
    const icon = document.getElementById('lockIcon');
    // 切换图标：锁 / 解锁
    icon.innerHTML = controlsLocked
        ? '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d=\"M12 15v2m0-8V7a4 4 0 00-8 0v2m8 0H4v8h16v-8H6v-6z\"/>'
        : '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d=\"M15 11V7a3 3 0 00-6 0v4m-3 4h12v6H6v-6z\"/>';
}

// 支持在iframe中关闭播放器
function closeEmbeddedPlayback() {
    try {
        if (window.self !== window.top) {
            // 如果在iframe中，尝试调用父窗口的关闭方法
            if (window.parent && typeof window.parent.closeVideoPlayer === 'function') {
                window.parent.closeVideoPlayer();
                return true;
            }
        }
    } catch (e) {
        console.error('尝试关闭嵌入式播放器失败:', e);
    }
    return false;
}

function renderResourceInfoBar() {
    // 获取容器元素
    const container = document.getElementById('resourceInfoBarContainer');
    if (!container) {
        console.error('找不到资源信息卡片容器');
        return;
    }
    
    // 获取当前视频 source_code
    const urlParams = new URLSearchParams(window.location.search);
    const currentSource = urlParams.get('source') || '';
    
    // 显示临时加载状态
    container.innerHTML = `
      <div class="resource-info-bar-left flex">
        <span>加载中...</span>
        <span class="resource-info-bar-videos">-</span>
      </div>
      <button class="resource-switch-btn flex" id="switchResourceBtn" onclick="showSwitchResourceModal()">
        <span class="resource-switch-icon">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 4v16m0 0l-6-6m6 6l6-6" stroke="#a67c2d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
        切换资源
      </button>
    `;

    // 查找当前源名称，从 API_SITES 和 custom_api 中查找即可
    let resourceName = currentSource
    if (currentSource && API_SITES[currentSource]) {
        resourceName = API_SITES[currentSource].name;
    }
    if (resourceName === currentSource) {
        const customAPIs = JSON.parse(localStorage.getItem('customAPIs') || '[]');
        const customIndex = parseInt(currentSource.replace('custom_', ''), 10);
        if (customAPIs[customIndex]) {
            resourceName = customAPIs[customIndex].name || '自定义资源';
        }
    }

    container.innerHTML = `
      <div class="resource-info-bar-left flex">
        <span>${escapeHtmlAttr(resourceName)}</span>
        <span class="resource-info-bar-videos">${escapeHtmlAttr(currentEpisodeCounterText())}</span>
      </div>
      <div class="quick-player-actions">
        <button type="button" class="resource-switch-btn" id="switchResourceBtn" onclick="showSwitchResourceModal()">换源</button>
        ${isMobilePlaybackDevice() || !window.PlayerDownload ? '' : '<button type="button" id="downloadVideoButton" aria-haspopup="menu" aria-expanded="false" onclick="toggleDownloadMenu(this)">下载</button>'}
        ${currentEpisodes.length > 1 ? '<button type="button" id="quickEpisodesButton" aria-expanded="false" onclick="toggleQuickEpisodes()">选集</button>' : ''}
        <button type="button" id="quickSettingsButton" aria-expanded="false" onclick="toggleQuickSettings()">更多</button>
      </div>
    `;
    document.querySelectorAll('.quick-episode-section').forEach(section => { section.hidden = true; });
    document.getElementById('quickMoreActions')?.replaceChildren();
    renderQuickMoreActions();
}

// ---- 下载（仅电脑版）：下载本集为 MP4，或复制视频地址交给下载工具 ----
function downloadFileName() {
    const title = currentVideoTitle || '视频';
    if (currentEpisodes.length <= 1) return title;
    const name = String(currentEpisodeNames[currentEpisodeIndex] || '').trim();
    const number = `第${String(currentEpisodeIndex + 1).padStart(2, '0')}集`;
    return name && !/^第?\s*\d+\s*集?$/.test(name) ? `${title} ${number} ${name}` : `${title} ${number}`;
}

function closeDownloadMenu() {
    document.getElementById('downloadMenu')?.remove();
    document.getElementById('downloadVideoButton')?.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', closeDownloadMenuOnOutsideClick, true);
}

function closeDownloadMenuOnOutsideClick(event) {
    if (!event.target.closest('#downloadMenu, #downloadVideoButton')) closeDownloadMenu();
}

function toggleDownloadMenu(button) {
    if (document.getElementById('downloadMenu')) { closeDownloadMenu(); return; }
    const menu = document.createElement('div');
    menu.id = 'downloadMenu';
    menu.className = 'download-menu';
    menu.setAttribute('role', 'menu');
    const items = [
        [window.PlayerDownload?.running ? '查看下载进度' : '下载本集（MP4）', () => {
            window.PlayerDownload?.start({ url: currentVideoUrl, fileName: downloadFileName(), filterAds: adFilteringEnabled });
        }],
        ['复制视频地址', async () => {
            try {
                await navigator.clipboard.writeText(currentVideoUrl);
                showToast('已复制视频地址，可粘贴到 IDM、N_m3u8DL-RE 等下载工具', 'success');
            } catch {
                window.prompt('复制下面的视频地址：', currentVideoUrl);
            }
        }]
    ];
    for (const [label, action] of items) {
        const item = document.createElement('button');
        item.type = 'button';
        item.setAttribute('role', 'menuitem');
        item.textContent = label;
        item.onclick = () => { closeDownloadMenu(); action(); };
        menu.appendChild(item);
    }
    const note = document.createElement('p');
    note.textContent = '下载期间请保持本页打开，可以继续观看。';
    menu.appendChild(note);
    button.parentElement.style.position = 'relative';
    button.after(menu);
    // Right-aligned under the button, so it never runs past the card's edge.
    menu.style.left = `${Math.max(0, button.offsetLeft + button.offsetWidth - menu.offsetWidth)}px`;
    button.setAttribute('aria-expanded', 'true');
    setTimeout(() => document.addEventListener('click', closeDownloadMenuOnOutsideClick, true), 0);
}

function renderQuickMoreActions() {
    const container = document.getElementById('quickMoreActions');
    if (!container) return;
    for (const [label, action] of [['影片详情', () => QuickPlay.details()], ['播放设置', () => {
        document.getElementById('playbackOptions').hidden = false;
    }], ['从头播放', button => confirmQuickRestart(button)]]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.onclick = () => action(button);
        container.appendChild(button);
    }
}

let pendingRestartTimer = null;
function confirmQuickRestart(button) {
    if (!art?.video || art.video.currentTime < 30 || button.dataset.confirmRestart === 'true') {
        clearTimeout(pendingRestartTimer);
        button.dataset.confirmRestart = '';
        button.textContent = '从头播放';
        QuickPlay.restart();
        return;
    }
    button.dataset.confirmRestart = 'true';
    button.textContent = '再点一次从头播放';
    clearTimeout(pendingRestartTimer);
    pendingRestartTimer = setTimeout(() => { button.dataset.confirmRestart = ''; button.textContent = '从头播放'; }, 4000);
}

function toggleQuickSettings() {
    const section = document.getElementById('quickMoreActions');
    section.hidden = !section.hidden;
    document.getElementById('quickSettingsButton')?.setAttribute('aria-expanded', String(!section.hidden));
}

function toggleQuickEpisodes() {
    QuickPlay.stop();
    const button = document.getElementById('quickEpisodesButton');
    const expanded = button?.getAttribute('aria-expanded') !== 'true';
    button?.setAttribute('aria-expanded', String(expanded));
    document.querySelectorAll('.quick-episode-section').forEach(section => { section.hidden = !expanded; });
    document.getElementById('quickSettingsButton')?.setAttribute('aria-expanded', String(!document.getElementById('quickMoreActions').hidden));
}

window.QuickPlay.useSelection = ({ item, detail, index }) => {
    currentVideoTitle = item.vod_name;
    currentEpisodes = detail.episodes;
    currentEpisodeNames = detail.episodeNames || [];
    currentEpisodeIndex = index;
    currentVideoUrl = detail.episodes[index];
    document.getElementById('error').style.display = 'none';
    initPlayer(currentVideoUrl);
    renderResourceInfoBar();
    updateEpisodeInfo(); renderEpisodes(); updateButtonStates();
};

let resourceSwitchProbeController = null;

window.cancelResourceSwitchSpeedChecks = () => {
    resourceSwitchProbeController?.abort();
    resourceSwitchProbeController = null;
};

// 测量一个来源首个可播放媒体片段的实际传输速率。
async function testVideoSourceSpeed(sourceKey, vodId, signal) {
    try {
        // 构建API参数
        let apiParams = '';
        if (sourceKey.startsWith('custom_')) {
            const customIndex = sourceKey.replace('custom_', '');
            const customApi = getCustomApiInfo(customIndex);
            if (!customApi) {
                return { kbps: -1, error: 'API配置无效' };
            }
            if (customApi.detail) {
                apiParams = '&customApi=' + encodeURIComponent(customApi.url) + '&customDetail=' + encodeURIComponent(customApi.detail) + '&source=custom';
            } else {
                apiParams = '&customApi=' + encodeURIComponent(customApi.url) + '&source=custom';
            }
        } else {
            apiParams = '&source=' + sourceKey;
        }
        
        // 添加时间戳防止缓存
        const timestamp = new Date().getTime();
        const cacheBuster = `&_t=${timestamp}`;
        
        // 获取视频详情
        const response = await fetch(`/api/detail?id=${encodeURIComponent(vodId)}${apiParams}${cacheBuster}`, {
            method: 'GET',
            cache: 'no-cache',
            signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000)
        });
        
        if (!response.ok) {
            return { kbps: -1, error: '获取失败' };
        }
        
        const data = await response.json();
        
        if (!data.episodes || data.episodes.length === 0) {
            return { kbps: -1, error: '无播放源' };
        }
        
        const firstEpisodeUrl = data.episodes.find(isDirectPlayableVideoUrl);
        if (!firstEpisodeUrl) {
            return { kbps: -1, error: '链接无效' };
        }
        const sample = await window.SourceSpeed.probeEpisodeUrl(firstEpisodeUrl, { signal });
        return { ...sample, episodes: data.episodes.length, error: null };
    } catch (error) {
        return { kbps: -1, error: error.name === 'AbortError' || error.message === '测速超时' ? '测速超时，可试播' : '未能测速，可试播' };
    }
}

// 格式化速度显示
function formatSpeedDisplay(speedResult) {
    if (!speedResult) {
        return '<span class="speed-indicator pending">测速中…</span>';
    }
    if (speedResult.kbps === -1) {
        return `<span class="speed-indicator pending">${speedResult.error}</span>`;
    }
    const { label, title } = window.SourceSpeed.describeResult(speedResult);
    const tone = { smooth: 'good', ok: 'medium', slow: 'poor' }[speedResult.verdict] || 'good';
    const latency = Number.isFinite(speedResult.latencyMs) ? ` · 延迟 ${Math.round(speedResult.latencyMs)} ms` : '';
    return `<span class="speed-indicator ${tone}" title="${escapeHtmlAttr(title)}">${escapeHtmlAttr(label + latency)}</span>`;
}

async function showSwitchResourceModal() {
    window.QuickPlay?.stop();
    window.cancelResourceSwitchSpeedChecks();
    const probeController = new AbortController();
    resourceSwitchProbeController = probeController;
    const urlParams = new URLSearchParams(window.location.search);
    const currentSourceCode = urlParams.get('source');
    const currentVideoId = urlParams.get('id');

    const modal = document.getElementById('modal');
    const modalTitle = document.getElementById('modalTitle');
    const modalContent = document.getElementById('modalContent');

    moveModalToFullscreenHost(modal);
    modalTitle.textContent = currentVideoTitle;
    modalContent.innerHTML = '<div style="text-align:center;padding:20px;color:#aaa;grid-column:1/-1;">正在加载资源列表...</div>';
    modal.classList.remove('hidden');

    // 搜索
    const resourceOptions = selectedAPIs.map((curr) => {
        if (API_SITES[curr]) {
            return { key: curr, name: API_SITES[curr].name };
        }
        const customIndex = parseInt(curr.replace('custom_', ''), 10);
        if (customAPIs[customIndex]) {
            return { key: curr, name: customAPIs[customIndex].name || '自定义资源' };
        }
        return { key: curr, name: '未知资源' };
    });

    if (resourceOptions.length === 0) {
        modalContent.innerHTML = '<div style="text-align:center;padding:20px;color:#aaa;grid-column:1/-1;">暂无可切换的数据源，请先到设置中选择数据源。</div>';
        return;
    }

    // Show each matching source as soon as its search returns; sampling is independent.
    modalContent.innerHTML = '<div class="resource-switch-grid" role="list" aria-label="可选播放来源"></div><p class="resource-switch-progress" role="status">正在查找其他来源…</p>';
    const list = modalContent.querySelector('.resource-switch-grid');
    const progress = modalContent.querySelector('.resource-switch-progress');
    const request = {title:currentVideoTitle, year:urlParams.get('year') || '', kind:urlParams.get('kind') || ''};
    const seen = new Set();
    const probeQueue = [];
    let running = 0;
    const pump = () => {
        while (running < 3 && probeQueue.length && !probeController.signal.aborted) {
            const {source, result, row} = probeQueue.shift();
            running++;
            void testVideoSourceSpeed(source, result.vod_id, probeController.signal).then(measured => {
                if (probeController.signal.aborted || resourceSwitchProbeController !== probeController) return;
                row.querySelector('[data-speed-badge]').innerHTML = formatSpeedDisplay(measured);
                if (measured.episodes) row.querySelector('[data-episode-count]').textContent = `${measured.episodes}集`;
            }).finally(() => { running--; pump(); });
        }
    };
    const addResult = (source, result) => {
        if (seen.has(source) || probeController.signal.aborted) return;
        const isCurrent = source === currentSourceCode && String(result.vod_id) === String(currentVideoId);
        seen.add(source);
        const row = document.createElement('div');
        row.className = 'resource-switch-row';
        row.dataset.current = String(isCurrent);
        row.setAttribute('role', 'listitem');
        const sourceName = resourceOptions.find(opt => opt.key === source)?.name || API_SITES[source]?.name || '未知资源';
        const version = window.LibreExperience?.versionLabel(result) || '';
        const versionClass = (window.LibreExperience?.versionRank(result) ?? 3) < 2 ? ' is-low' : '';
        row.innerHTML = `<div class="resource-switch-row-main"><strong>${escapeHtmlAttr(sourceName)}</strong>
            ${isCurrent ? '<span class="resource-current-label">当前播放</span>' : ''}${version ? `<span class="resource-version-tag${versionClass}">${escapeHtmlAttr(version)}</span>` : ''}<small data-episode-count>集数待确认</small></div>
            <div class="resource-switch-row-meta"><span data-speed-badge>${formatSpeedDisplay(null)}</span></div>`;
        if (!isCurrent) {
            const button = document.createElement('button');
            button.type = 'button'; button.className = 'resource-switch-choose'; button.textContent = '切换';
            button.onclick = () => switchToResource(source, result.vod_id);
            row.querySelector('.resource-switch-row-meta').appendChild(button);
        }
        if (isCurrent) list.prepend(row); else list.appendChild(row);
        probeQueue.push({source, result, row});
        pump();
    };
    if (currentSourceCode && currentVideoId) addResult(currentSourceCode, {vod_id:currentVideoId});
    await Promise.allSettled(resourceOptions.map(async opt => {
        await searchByAPIAndKeyWord(opt.key, currentVideoTitle, batch => {
            if (probeController.signal.aborted || seen.has(opt.key)) return;
            const result = batch.find(item => {
                const info = QuickPlay.logic.identity(item);
                return QuickPlay.logic.matches(item, request) && (!request.year || info.year === request.year) && (!request.kind || info.kind === request.kind);
            });
            if (result) addResult(opt.key, result);
        }, probeController.signal);
    }));
    if (probeController.signal.aborted) return;
    progress.textContent = seen.size ? `已找到 ${seen.size} 个来源；测速仅供参考` : '未找到可切换资源，请稍后重试或更换片名搜索。';
}

// 切换资源的函数
async function switchToResource(sourceKey, vodId) {
    // 关闭模态框
    closeModal();
    const resumePosition = getCurrentPlaybackPosition();
    if (resumePosition > 1) {
        saveCurrentProgress();
    }
    
    showLoading();
    try {
        // 构建API参数
        let apiParams = '';
        
        // 处理自定义API源
        if (sourceKey.startsWith('custom_')) {
            const customIndex = sourceKey.replace('custom_', '');
            const customApi = getCustomApiInfo(customIndex);
            if (!customApi) {
                showToast('自定义API配置无效', 'error');
                hideLoading();
                return;
            }
            // 传递 detail 字段
            if (customApi.detail) {
                apiParams = '&customApi=' + encodeURIComponent(customApi.url) + '&customDetail=' + encodeURIComponent(customApi.detail) + '&source=custom';
            } else {
                apiParams = '&customApi=' + encodeURIComponent(customApi.url) + '&source=custom';
            }
        } else {
            // 内置API
            apiParams = '&source=' + sourceKey;
        }
        
        // Add a timestamp to prevent caching
        const timestamp = new Date().getTime();
        const cacheBuster = `&_t=${timestamp}`;
        const response = await fetch(`/api/detail?id=${encodeURIComponent(vodId)}${apiParams}${cacheBuster}`);
        
        const data = await response.json();
        
        if (!data.episodes || data.episodes.length === 0) {
            showToast('未找到播放资源', 'error');
            hideLoading();
            return;
        }

        hideLoading();
        const targetIndex = await QuickPlay.resolveSwitchIndex(data, { source_code: sourceKey, vod_id: vodId });
        if (targetIndex < 0) return;
        const sameEpisode = data.episodeNames?.[targetIndex] && QuickPlay.historyInfo().episodeName &&
            data.episodeNames[targetIndex] === QuickPlay.historyInfo().episodeName;
        localStorage.setItem('currentEpisodeNames', JSON.stringify(data.episodeNames || []));
        window.EpisodeContext?.write({source:sourceKey, id:vodId, episodes:data.episodes, episodeNames:data.episodeNames || []});

        // 获取目标集数的URL
        const targetUrl = data.episodes[targetIndex];
        const resumePositionParam = resumePosition > 1
            ? `&position=${encodeURIComponent(String(Math.floor(resumePosition)))}`
            : '';
        
        // 构建播放页面URL
        const watchUrl = `player.html?id=${vodId}&source=${sourceKey}&url=${encodeURIComponent(targetUrl)}&index=${targetIndex}&title=${encodeURIComponent(currentVideoTitle)}${resumePositionParam}`;
        
        // 保存当前状态到localStorage
        try {
            localStorage.setItem('currentVideoTitle', currentVideoTitle || data.videoInfo?.title || '未知视频');
            localStorage.setItem('currentEpisodes', JSON.stringify(data.episodes));
            localStorage.setItem('currentEpisodeIndex', targetIndex);
            localStorage.setItem('currentSourceCode', sourceKey);
            localStorage.setItem('lastPlayTime', Date.now());
        } catch (e) {
            console.error('保存播放状态失败:', e);
        }

        // 跳转到播放页面
        const destination = new URL(watchUrl, location.origin);
        const currentParams = new URLSearchParams(location.search);
        for (const key of ['year', 'kind']) if (currentParams.get(key)) destination.searchParams.set(key, currentParams.get(key));
        destination.searchParams.set('episodeName', data.episodeNames?.[targetIndex] || '');
        if (!sameEpisode && currentParams.get('kind') !== 'movie') destination.searchParams.delete('position');
        destination.pathname = '/player.html';
        window.location.href = destination.toString();
        
    } catch (error) {
        console.error('切换资源失败:', error);
        showToast('切换资源失败，请稍后重试', 'error');
    } finally {
        hideLoading();
    }
}

function syncFullscreenOrientation() {
    if (isPlayerFullscreenActive()) maybeLockLandscapeOrientation();
    else unlockLandscapeOrientation();
}
document.addEventListener('fullscreenchange', syncFullscreenOrientation);
document.addEventListener('webkitfullscreenchange', syncFullscreenOrientation);
