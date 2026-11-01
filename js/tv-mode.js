// 电视模式：LibreTV 电视版 App（或电视浏览器）里用遥控器操作。
// 方向键在可点的元素之间移动焦点（按位置找最近的一个），确认键点击；播放时：
// 确认 = 播放 / 暂停，左右 = 快退 / 快进 10 秒，上 = 选集，下 = 播放设置；返回键逐层关闭面板。
// 返回键的处理（window.LibreTVBack）在手机版 App 里也用：先关面板，再交给 App 后退。
(() => {
    const ua = navigator.userAgent || '';
    function detectTv(agent = ua, search = location.search, stored = null) {
        if (/[?&]tv=0\b/.test(search) || stored === '0') return false;
        if (/[?&]tv=1\b/.test(search) || stored === '1') return true;
        return /LibreTVApp\/[\w.-]+ TV\b/.test(agent) ||
            /\bAndroid TV\b|\bAFT[A-Z0-9]|BRAVIA|SMART-TV|SmartTV|\bMiTV|MIBOX|HiTV|\bTV Bro\b/i.test(agent);
    }

    let stored = null;
    try {
        const match = /[?&]tv=([01])\b/.exec(location.search);
        if (match) localStorage.setItem('tvMode', match[1]);
        stored = localStorage.getItem('tvMode');
    } catch { /* storage blocked */ }
    const active = detectTv(ua, location.search, stored);
    if (active) document.documentElement.classList.add('tv-mode');

    const CLICKABLE = '[onclick], .card-hover, [role="button"], .art-setting-item, .douban-card, .history-item, .search-card';
    const FOCUSABLE = 'a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

    const player = () => (typeof art !== 'undefined' && art) ? art : null;
    const visible = el => {
        if (!el || !el.isConnected) return false;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    };

    // 当前最上面一层：只在这一层里移动焦点
    function activeLayer() {
        const p = player();
        if (p?.setting?.show) return document.querySelector('.art-settings');
        const layers = [
            '.player-episode-drawer:not([hidden])',
            '.cast-panel-backdrop:not([hidden])',
            '#passwordModal:not(.hidden)',
            '#disclaimerModal',
            '#modal:not(.hidden)',
            '.first-run-guide:not(.hidden)',
            '[role="dialog"]',
            '#settingsPanel.show',
            '#historyPanel.show'
        ];
        for (const selector of layers) {
            for (const el of document.querySelectorAll(selector)) if (visible(el)) return el;
        }
        return document.body;
    }

    function ensureFocusable(root) {
        for (const el of root.querySelectorAll(CLICKABLE)) {
            if (!el.matches(FOCUSABLE) && !el.closest('button, a')) el.tabIndex = 0;
        }
    }

    function candidates(root) {
        ensureFocusable(root);
        return [...root.querySelectorAll(FOCUSABLE)].filter(el => visible(el) && !el.closest('[inert], [aria-hidden="true"]'));
    }

    // 按方向找最近的元素：主方向距离 + 2 倍的横向偏移，偏得太远的不选
    function nearest(from, list, direction) {
        const a = from.getBoundingClientRect();
        const ax = a.left + a.width / 2;
        const ay = a.top + a.height / 2;
        let best = null;
        let bestScore = Infinity;
        for (const el of list) {
            if (el === from || el.contains(from) || from.contains(el)) continue;
            const b = el.getBoundingClientRect();
            const bx = b.left + b.width / 2;
            const by = b.top + b.height / 2;
            let main;
            let cross;
            if (direction === 'left') { main = a.left - b.right; cross = Math.abs(ay - by); if (bx >= ax - 1) continue; }
            else if (direction === 'right') { main = b.left - a.right; cross = Math.abs(ay - by); if (bx <= ax + 1) continue; }
            else if (direction === 'up') { main = a.top - b.bottom; cross = Math.abs(ax - bx); if (by >= ay - 1) continue; }
            else { main = b.top - a.bottom; cross = Math.abs(ax - bx); if (by <= ay + 1) continue; }
            const score = Math.max(0, main) + cross * 2;
            if (score < bestScore) { bestScore = score; best = el; }
        }
        return best;
    }

    function focus(el) {
        if (!el) return false;
        el.focus({ preventScroll: true });
        el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        return true;
    }

    function move(direction) {
        const layer = activeLayer();
        const list = candidates(layer);
        const current = document.activeElement;
        if (!current || current === document.body || !layer.contains(current) || !visible(current)) {
            return focus(list.find(el => el.getBoundingClientRect().top >= 0) || list[0]);
        }
        return focus(nearest(current, list, direction));
    }

    // ---- 播放页 ----
    function playerFocused() {
        const p = player();
        if (!p) return false;
        if (!p.fullscreenWeb && !p.fullscreen) return false;
        if (p.setting?.show) return false;
        if (typeof episodeDrawer !== 'undefined' && episodeDrawer?.isOpen) return false;
        return activeLayer() === document.body;
    }

    function hint(text, direction) {
        if (typeof showShortcutHint === 'function') showShortcutHint(text, direction);
    }

    function handlePlayerKey(key) {
        const p = player();
        switch (key) {
            case 'Enter':
            case ' ':
            case 'MediaPlayPause':
                p.toggle();
                p.controls.show = true;
                hint(p.video.paused ? '已暂停' : '继续播放', 'play');
                return true;
            case 'MediaPlay': p.play(); return true;
            case 'MediaPause': p.pause(); return true;
            case 'ArrowLeft':
            case 'MediaRewind':
                p.currentTime = Math.max(0, p.currentTime - 10);
                p.controls.show = true;
                hint('快退 10 秒', 'left');
                return true;
            case 'ArrowRight':
            case 'MediaFastForward':
                p.currentTime = Math.min((p.duration || Infinity) - 1, p.currentTime + 10);
                p.controls.show = true;
                hint('快进 10 秒', 'right');
                return true;
            case 'ArrowUp':
                if (typeof toggleEpisodeDrawer === 'function' && typeof currentEpisodes !== 'undefined' && currentEpisodes.length > 1) {
                    toggleEpisodeDrawer();
                    setTimeout(() => focus(document.querySelector('.player-episode-drawer .is-current, .player-episode-drawer button:not(.player-episode-drawer-close)')), 50);
                } else {
                    p.controls.show = true;
                }
                return true;
            case 'ArrowDown':
            case 'ContextMenu':
                p.setting.show = true;
                setTimeout(() => focus(candidates(document.querySelector('.art-settings') || document.body)[0]), 50);
                return true;
            case 'MediaTrackNext':
                if (typeof playNextEpisode === 'function') playNextEpisode();
                return true;
            case 'MediaTrackPrevious':
                if (typeof playPreviousEpisode === 'function') playPreviousEpisode();
                return true;
            default:
                return false;
        }
    }

    function isTyping(el) {
        return el && (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName)) &&
            !/^(checkbox|radio|button|submit|range)$/i.test(el.type || '');
    }

    function onKeyDown(event) {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const key = event.key;
        if (playerFocused() && handlePlayerKey(key)) {
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
        }
        const direction = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[key];
        const target = document.activeElement;
        if (direction) {
            // 输入框里左右键用来移动光标，到头了才离开
            if (isTyping(target) && (direction === 'left' || direction === 'right')) {
                const atStart = target.selectionStart === 0 && target.selectionEnd === 0;
                const atEnd = target.selectionStart === (target.value || '').length;
                if ((direction === 'left' && !atStart) || (direction === 'right' && !atEnd)) return;
            }
            if (move(direction)) {
                event.preventDefault();
                event.stopImmediatePropagation();
            }
            return;
        }
        if (key === 'Enter' && target && target !== document.body && !isTyping(target) &&
            !target.matches('a[href], button, input, select, textarea, summary')) {
            event.preventDefault();
            event.stopImmediatePropagation();
            target.click();
            return;
        }
        // 播放页没全屏时，在播放器上按确认：全屏播放
        const p = player();
        if (key === 'Enter' && p && target && target.closest?.('#player') && !p.fullscreenWeb) {
            event.preventDefault();
            event.stopImmediatePropagation();
            p.fullscreenWeb = true;
            p.play();
        }
    }

    // ---- 返回键：逐层关闭，返回 true 表示网页已处理 ----
    function back() {
        const p = player();
        if (p?.setting?.show) { p.setting.show = false; return true; }
        if (typeof episodeDrawer !== 'undefined' && episodeDrawer?.isOpen) { episodeDrawer.close(); return true; }
        const cast = document.querySelector('.cast-panel-backdrop:not([hidden])');
        if (cast) { cast.hidden = true; return true; }
        const modal = document.getElementById('modal');
        if (modal && !modal.classList.contains('hidden') && typeof closeModal === 'function') { closeModal(); return true; }
        const settings = document.querySelector('#settingsPanel.show');
        if (settings && typeof toggleSettings === 'function') { toggleSettings(new Event('click')); return true; }
        const history = document.querySelector('#historyPanel.show');
        if (history) { history.classList.remove('show'); return true; }
        if (p?.fullscreenWeb) { p.fullscreenWeb = false; return true; }
        if (p?.fullscreen) { p.fullscreen = false; return true; }
        return false;
    }
    window.LibreTVBack = back;

    if (active) {
        window.addEventListener('keydown', onKeyDown, true);
        // 播放页：开始播放后直接铺满屏幕
        const waitForPlayer = setInterval(() => {
            const p = player();
            if (!p) return;
            clearInterval(waitForPlayer);
            const fill = () => { if (!p.fullscreenWeb && !p.fullscreen) p.fullscreenWeb = true; };
            p.on('video:playing', fill);
            if (!p.video.paused) fill();
            const host = document.getElementById('player');
            host?.setAttribute('tabindex', '0');
            host?.focus({ preventScroll: true });
        }, 500);
        setTimeout(() => clearInterval(waitForPlayer), 30000);
    }

    window.TVMode = { active, detectTv, logic: { nearest } };
})();
