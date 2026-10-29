// Player conveniences: episode labels, remembered playback speed, an in-player
// episode drawer (usable in fullscreen) and the next-episode countdown card.
(() => {
    const RATE_STORAGE_KEY = 'libretvPlaybackRate';
    const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
    const NEXT_CARD_MAX_SECONDS = 10;
    const NEXT_CARD_MIN_DURATION = 30;

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // Names such as "第01集", "EP1" or "1" add nothing to the number; anything
    // else (dated variety episodes, "上/下", versions) is worth showing.
    function episodeLabel(index, name) {
        const number = index + 1;
        const text = String(name || '').trim();
        if (!text) return { number, title: '' };
        const plain = /^(?:第\s*)?(?:ep|e)?\s*0*(\d+)\s*(?:集|话|話|回|期)?$/i.exec(text);
        if (plain && Number(plain[1]) === number) return { number, title: '' };
        return { number, title: text };
    }

    function shouldMuteAfterPlayRejection(error) {
        // Only an autoplay-policy block justifies muting. AbortError means the
        // play() call was interrupted by a newer load (fast episode switching).
        return error?.name === 'NotAllowedError';
    }

    function clampSeek(current, delta, duration) {
        const target = Number(current || 0) + delta;
        const max = Number.isFinite(duration) && duration > 0 ? Math.max(0, duration - 0.5) : target;
        return Math.max(0, Math.min(max, target));
    }

    function readStoredRate(storage = window.localStorage) {
        try {
            const rate = Number(storage.getItem(RATE_STORAGE_KEY));
            return PLAYBACK_RATES.includes(rate) ? rate : 1;
        } catch {
            return 1;
        }
    }

    function storeRate(rate, storage = window.localStorage) {
        if (!PLAYBACK_RATES.includes(Number(rate))) return;
        try { storage.setItem(RATE_STORAGE_KEY, String(Number(rate))); } catch {}
    }

    function rateLabel(rate) {
        return Number(rate) === 1 ? '倍速' : `${Number(rate)}x`;
    }

    function nextCardThreshold(duration) {
        if (!Number.isFinite(duration) || duration < NEXT_CARD_MIN_DURATION) return 0;
        return Math.min(NEXT_CARD_MAX_SECONDS, duration * 0.15);
    }

    function episodeListMarkup({ episodes, names, current, reversed }) {
        const order = (episodes || []).map((_, index) => index);
        if (reversed) order.reverse();
        const labels = order.map(index => ({ index, ...episodeLabel(index, (names || [])[index]) }));
        const withTitles = labels.some(item => item.title);
        return `
            <div class="player-episode-drawer-list ${withTitles ? 'is-titled' : ''}">
                ${labels.map(item => `
                    <button type="button" class="player-episode-item ${item.index === current ? 'is-current' : ''}"
                            data-episode-index="${item.index}" title="${escapeHtml(item.title || `第 ${item.number} 集`)}"
                            ${item.index === current ? 'aria-current="true"' : ''}>
                        <span class="player-episode-number">${item.number}</span>${item.title ? `<span class="player-episode-title">${escapeHtml(item.title)}</span>` : ''}
                    </button>`).join('')}
            </div>`;
    }

    // Always-visible episode column used beside the player on wide screens.
    function createEpisodeList({ container, getEpisodes, getNames, getIndex, isReversed, onSelect }) {
        function render() {
            const episodes = getEpisodes() || [];
            container.innerHTML = `
                <div class="player-episode-panel">
                    <div class="player-episode-drawer-head"><strong>选集</strong><span>共 ${episodes.length} 集</span></div>
                    ${episodeListMarkup({ episodes, names: getNames(), current: getIndex(), reversed: isReversed?.() })}
                </div>`;
            const currentItem = container.querySelector('.is-current');
            const list = container.querySelector('.player-episode-drawer-list');
            if (currentItem && list) {
                list.scrollTop = Math.max(0, currentItem.offsetTop - list.offsetTop - list.clientHeight / 2 + currentItem.offsetHeight / 2);
            }
        }
        const onClick = event => {
            const item = event.target.closest('[data-episode-index]');
            if (item) onSelect(Number(item.dataset.episodeIndex));
        };
        container.addEventListener('click', onClick);
        return {
            render,
            destroy() {
                container.removeEventListener('click', onClick);
                container.innerHTML = '';
            }
        };
    }

    // Episode list overlay that lives inside the player so it also works in fullscreen.
    function createEpisodeDrawer({ host, getEpisodes, getNames, getIndex, isReversed, onSelect }) {
        const drawer = document.createElement('div');
        drawer.className = 'player-episode-drawer';
        drawer.hidden = true;
        drawer.dataset.videoInteractive = 'true';
        drawer.setAttribute('role', 'dialog');
        drawer.setAttribute('aria-label', '选集');
        host.appendChild(drawer);

        function render() {
            const episodes = getEpisodes() || [];
            drawer.innerHTML = `
                <div class="player-episode-drawer-head">
                    <strong>选集</strong><span>共 ${episodes.length} 集</span>
                    <button type="button" class="player-episode-drawer-close" aria-label="关闭选集">✕</button>
                </div>
                ${episodeListMarkup({ episodes, names: getNames(), current: getIndex(), reversed: isReversed?.() })}`;
        }

        function open() {
            render();
            drawer.hidden = false;
            host.classList.add('player-episode-drawer-open');
            drawer.querySelector('.is-current')?.scrollIntoView({ block: 'center' });
        }

        function close() {
            drawer.hidden = true;
            host.classList.remove('player-episode-drawer-open');
        }

        const onClick = event => {
            event.stopPropagation();
            if (event.target.closest('.player-episode-drawer-close')) {
                close();
                return;
            }
            const item = event.target.closest('[data-episode-index]');
            if (!item) return;
            close();
            onSelect(Number(item.dataset.episodeIndex));
        };
        drawer.addEventListener('click', onClick);

        return {
            element: drawer,
            open,
            close,
            toggle() { if (drawer.hidden) open(); else close(); },
            refresh() { if (!drawer.hidden) render(); },
            get isOpen() { return !drawer.hidden; },
            destroy() {
                drawer.removeEventListener('click', onClick);
                host.classList.remove('player-episode-drawer-open');
                drawer.remove();
            }
        };
    }

    // "Next episode in N s" card shown during the last seconds of an episode.
    function createNextEpisodeCard({ host, video, getNext, isEnabled, onPlayNext, getEndTime }) {
        const card = document.createElement('div');
        card.className = 'player-next-card';
        card.hidden = true;
        card.dataset.videoInteractive = 'true';
        card.setAttribute('role', 'status');
        host.appendChild(card);
        let dismissed = false;

        function hide() {
            card.hidden = true;
        }

        function update() {
            const next = getNext();
            const duration = Number(video.duration);
            const endTime = Number(getEndTime?.() ?? duration);
            const threshold = nextCardThreshold(duration);
            const remaining = endTime - Number(video.currentTime || 0);
            if (!next || !isEnabled() || dismissed || !threshold || remaining > threshold || remaining <= 0 || video.paused) {
                hide();
                return;
            }
            const seconds = Math.max(1, Math.ceil(remaining));
            const label = next.title ? `第 ${next.number} 集 · ${next.title}` : `第 ${next.number} 集`;
            if (card.hidden || card.dataset.label !== label) {
                card.dataset.label = label;
                card.innerHTML = `
                    <div class="player-next-card-text">
                        <span class="player-next-card-count"></span>
                        <strong>${escapeHtml(label)}</strong>
                    </div>
                    <div class="player-next-card-actions">
                        <button type="button" data-next-action="play">立即播放</button>
                        <button type="button" data-next-action="cancel">取消</button>
                    </div>`;
            }
            card.querySelector('.player-next-card-count').textContent = `${seconds} 秒后播放`;
            card.hidden = false;
        }

        const onClick = event => {
            event.stopPropagation();
            const action = event.target.closest('[data-next-action]')?.dataset.nextAction;
            if (action === 'cancel') {
                dismissed = true;
                hide();
            } else if (action === 'play') {
                hide();
                onPlayNext();
            }
        };
        card.addEventListener('click', onClick);
        video.addEventListener('timeupdate', update);
        video.addEventListener('pause', update);
        video.addEventListener('seeking', update);

        return {
            element: card,
            // A new episode starts with the countdown enabled again.
            reset() { dismissed = false; hide(); },
            get dismissed() { return dismissed; },
            destroy() {
                card.removeEventListener('click', onClick);
                video.removeEventListener('timeupdate', update);
                video.removeEventListener('pause', update);
                video.removeEventListener('seeking', update);
                card.remove();
            }
        };
    }

    // ---- Skip intro / outro, remembered per title ----
    const SKIP_STORAGE_KEY = 'libretvSkipMarks';
    const MIN_CONTENT_AFTER_OUTRO = 30;

    function seriesKey(title) {
        return String(title || '').trim().toLowerCase().replace(/\s+/g, '');
    }

    function readSkipMarks(title, storage = window.localStorage) {
        const fallback = { enabled: true, intro: 0, outro: 0 };
        try {
            const all = JSON.parse(storage.getItem(SKIP_STORAGE_KEY) || '{}');
            const marks = all[seriesKey(title)];
            if (!marks) return fallback;
            return {
                enabled: marks.enabled !== false,
                intro: Math.max(0, Number(marks.intro) || 0),
                outro: Math.max(0, Number(marks.outro) || 0)
            };
        } catch {
            return fallback;
        }
    }

    function writeSkipMarks(title, marks, storage = window.localStorage) {
        const key = seriesKey(title);
        if (!key) return;
        try {
            const all = JSON.parse(storage.getItem(SKIP_STORAGE_KEY) || '{}');
            if (!marks || (!marks.intro && !marks.outro && marks.enabled !== false)) delete all[key];
            else all[key] = { enabled: marks.enabled !== false, intro: Math.round(marks.intro || 0), outro: Math.round(marks.outro || 0), savedAt: Date.now() };
            storage.setItem(SKIP_STORAGE_KEY, JSON.stringify(all));
        } catch {}
    }

    // The outro is stored as seconds before the end, because episode lengths differ.
    function effectiveEndTime(duration, marks) {
        if (!Number.isFinite(duration) || duration <= 0) return duration;
        if (!marks?.enabled || !(marks.outro > 0) || duration <= marks.outro + MIN_CONTENT_AFTER_OUTRO) return duration;
        return duration - marks.outro;
    }

    function skipAction({ time, duration, marks, introDone, outroDone }) {
        if (!marks?.enabled || !Number.isFinite(time)) return null;
        if (marks.intro > 0 && !introDone && time < marks.intro - 1 &&
            (!Number.isFinite(duration) || marks.intro < duration - MIN_CONTENT_AFTER_OUTRO)) {
            return 'intro';
        }
        const end = effectiveEndTime(duration, marks);
        if (marks.outro > 0 && !outroDone && Number.isFinite(end) && end < duration && time >= end) {
            return 'outro';
        }
        return null;
    }

    function formatClock(seconds) {
        const total = Math.max(0, Math.round(Number(seconds) || 0));
        const minutes = Math.floor(total / 60);
        return `${minutes}:${String(total % 60).padStart(2, '0')}`;
    }

    // ---- Next-episode preload: warm the HTTP cache with the playlist and first segment ----
    function preloadTargets(text, baseUrl) {
        const lines = String(text || '').split(/\r?\n/).map(line => line.trim());
        const resolve = uri => new URL(uri, baseUrl).toString();
        for (let index = 0; index < lines.length; index++) {
            if (lines[index].startsWith('#EXT-X-STREAM-INF')) {
                // hls.js starts on the first listed level when it has no bandwidth estimate.
                const variant = lines.slice(index + 1).find(line => line && !line.startsWith('#'));
                if (variant) return { playlist: resolve(variant), media: [] };
            }
        }
        const media = [];
        const map = lines.find(line => line.startsWith('#EXT-X-MAP'))?.match(/URI="([^"]+)"/)?.[1];
        if (map) media.push(resolve(map));
        const first = lines.find(line => line && !line.startsWith('#'));
        if (first) media.push(resolve(first));
        return { playlist: null, media };
    }

    async function preloadEpisode(url, { signal, playlistsOnly = false, fetchImpl = fetch } = {}) {
        let playlistUrl = url;
        const warmed = [];
        if (!/\.m3u8(?:$|\?)/i.test(new URL(url).pathname + new URL(url).search)) return warmed;
        for (let depth = 0; depth < 3 && playlistUrl; depth++) {
            const response = await fetchImpl(playlistUrl, { signal, mode: 'cors', credentials: 'omit' });
            if (!response.ok) return warmed;
            warmed.push(playlistUrl);
            const targets = preloadTargets(await response.text(), playlistUrl);
            playlistUrl = targets.playlist;
            if (!playlistUrl) {
                if (playlistsOnly) return warmed;
                for (const mediaUrl of targets.media) {
                    const media = await fetchImpl(mediaUrl, { signal, mode: 'cors', credentials: 'omit' });
                    // Reading the body is what stores it in the HTTP cache.
                    await media.arrayBuffer();
                    warmed.push(mediaUrl);
                }
            }
        }
        return warmed;
    }

    // ---- Keyboard shortcuts ----
    // Returns the action for a keydown, or null to let the browser handle it.
    function shortcutAction(event) {
        if (!event || event.ctrlKey || event.metaKey) return null;
        const key = event.key;
        if (event.altKey) {
            if (key === 'Enter') return { type: 'fullscreen' };
            if (key === 'ArrowLeft') return { type: 'episode', delta: -1 };
            if (key === 'ArrowRight') return { type: 'episode', delta: 1 };
            return null;
        }
        if (/^[0-9]$/.test(key)) return { type: 'seek-percent', value: Number(key) * 10 };
        switch (key.length === 1 ? key.toLowerCase() : key) {
            case ' ':
            case 'k': return { type: 'toggle' };
            case 'ArrowLeft': return { type: 'seek', delta: -5 };
            case 'ArrowRight': return { type: 'seek-forward-hold' };
            case 'j': return { type: 'seek', delta: -10 };
            case 'l': return { type: 'seek', delta: 10 };
            case 'ArrowUp': return { type: 'volume', delta: 0.1 };
            case 'ArrowDown': return { type: 'volume', delta: -0.1 };
            case 'm': return { type: 'mute' };
            case 'n': return { type: 'episode', delta: 1 };
            case 'p': return { type: 'episode', delta: -1 };
            case '[':
            case '<': return { type: 'rate', delta: -1 };
            case ']':
            case '>': return { type: 'rate', delta: 1 };
            case 'f': return { type: 'fullscreen' };
            case 'w': return { type: 'web-fullscreen' };
            case '?': return { type: 'help' };
            case 'Escape': return { type: 'escape' };
            default: return null;
        }
    }

    function stepRate(current, delta) {
        const rates = PLAYBACK_RATES;
        const index = rates.indexOf(Number(current));
        const base = index >= 0 ? index : rates.indexOf(1);
        return rates[Math.max(0, Math.min(rates.length - 1, base + delta))];
    }

    const SHORTCUT_HELP = [
        ['空格 / K', '播放 / 暂停'],
        ['← / →', '快退 / 快进 5 秒'],
        ['按住 →', '3 倍速播放'],
        ['J / L', '快退 / 快进 10 秒'],
        ['↑ / ↓', '音量'],
        ['M', '静音'],
        ['N / P', '下一集 / 上一集'],
        ['[ / ]', '减速 / 加速'],
        ['0 – 9', '跳到 0% – 90%'],
        ['F / W', '全屏 / 网页全屏'],
        ['?', '显示 / 隐藏本帮助']
    ];

    function createShortcutHelp(host) {
        const panel = document.createElement('div');
        panel.className = 'player-shortcut-help';
        panel.hidden = true;
        panel.dataset.videoInteractive = 'true';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', '键盘快捷键');
        panel.innerHTML = `
            <div class="player-shortcut-help-head"><strong>键盘快捷键</strong>
                <button type="button" aria-label="关闭快捷键帮助">✕</button></div>
            <dl>${SHORTCUT_HELP.map(([keys, label]) => `<dt>${escapeHtml(keys)}</dt><dd>${escapeHtml(label)}</dd>`).join('')}</dl>`;
        host.appendChild(panel);
        const onClick = event => {
            event.stopPropagation();
            if (event.target.closest('button')) panel.hidden = true;
        };
        panel.addEventListener('click', onClick);
        return {
            toggle() { panel.hidden = !panel.hidden; },
            close() { panel.hidden = true; },
            get isOpen() { return !panel.hidden; },
            destroy() { panel.removeEventListener('click', onClick); panel.remove(); }
        };
    }

    // Touch double-tap zones: left third rewinds, right third forwards, middle toggles play.
    function doubleTapZone(clientX, rect) {
        if (!rect || !(rect.width > 0)) return 'center';
        const ratio = (clientX - rect.left) / rect.width;
        if (ratio < 1 / 3) return 'back';
        if (ratio > 2 / 3) return 'forward';
        return 'center';
    }

    // Horizontal swipe seeking: a full-width swipe covers up to two minutes.
    function swipeSeekTarget(startTime, dx, width, duration) {
        if (!(width > 0) || !Number.isFinite(duration) || duration <= 0) return startTime;
        const span = Math.min(120, duration);
        return Math.max(0, Math.min(duration - 0.5, startTime + dx / width * span));
    }

    // Recovery plan for fatal hls.js errors after playback has started: retry the
    // network with backoff, recover media errors (swapping the audio codec when
    // one repeats quickly), then give up so the viewer can switch sources.
    function createPlaybackRecovery({ maxNetworkRetries = 4, maxMediaRecoveries = 3, repeatWindowMs = 3000, settleMs = 30000 } = {}) {
        let network = 0;
        let media = 0;
        let lastMediaAt = -Infinity;
        return {
            next(type, now = Date.now()) {
                if (type === 'networkError') {
                    if (network >= maxNetworkRetries) return { action: 'giveUp' };
                    return { action: 'startLoad', delay: 1000 * 2 ** network++ };
                }
                if (type === 'mediaError') {
                    if (media >= maxMediaRecoveries) return { action: 'giveUp' };
                    const quickRepeat = now - lastMediaAt < repeatWindowMs;
                    media++;
                    lastMediaAt = now;
                    return { action: quickRepeat ? 'swapAudioCodec' : 'recoverMedia', delay: 0 };
                }
                return { action: 'giveUp' };
            },
            // A segment loaded: the network is fine again; media errors are forgiven once playback settles.
            progress(now = Date.now()) {
                network = 0;
                if (now - lastMediaAt > settleMs) media = 0;
            },
            reset() {
                network = 0;
                media = 0;
                lastMediaAt = -Infinity;
            }
        };
    }

    // Non-blocking notice shown when playback breaks off mid-episode.
    function createPlaybackNotice(host, { onRetry, onSwitch } = {}) {
        const notice = document.createElement('div');
        notice.className = 'player-interrupted-notice';
        notice.hidden = true;
        notice.dataset.videoInteractive = 'true';
        notice.setAttribute('role', 'status');
        notice.innerHTML = `<span data-notice-text></span>
            <button type="button" data-notice-action="retry">重试</button>
            <button type="button" data-notice-action="switch">切换资源</button>`;
        host.appendChild(notice);
        const onClick = event => {
            event.stopPropagation();
            const action = event.target.closest('[data-notice-action]')?.dataset.noticeAction;
            if (!action) return;
            notice.hidden = true;
            if (action === 'retry') onRetry?.();
            else onSwitch?.();
        };
        notice.addEventListener('click', onClick);
        return {
            show(text) {
                notice.querySelector('[data-notice-text]').textContent = text;
                notice.hidden = false;
            },
            hide() { notice.hidden = true; },
            get visible() { return !notice.hidden; },
            destroy() { notice.removeEventListener('click', onClick); notice.remove(); }
        };
    }

    window.PlayerEnhancements = {
        PLAYBACK_RATES,
        episodeLabel,
        shouldMuteAfterPlayRejection,
        clampSeek,
        readStoredRate,
        storeRate,
        rateLabel,
        nextCardThreshold,
        createEpisodeDrawer,
        createEpisodeList,
        createNextEpisodeCard,
        seriesKey,
        readSkipMarks,
        writeSkipMarks,
        effectiveEndTime,
        skipAction,
        formatClock,
        preloadTargets,
        preloadEpisode,
        shortcutAction,
        stepRate,
        createShortcutHelp,
        doubleTapZone,
        swipeSeekTarget,
        createPlaybackRecovery,
        createPlaybackNotice
    };
})();
