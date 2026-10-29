// Touch-only fullscreen controls. Browsers cannot change device screen brightness;
// brightness here is a filter on the video image.
window.createMobileFullscreenControls = function createMobileFullscreenControls(player, art, options) {
    const video = art.video;
    const chrome = document.createElement('div');
    chrome.className = 'mobile-fullscreen-chrome';
    chrome.innerHTML = `
        <div class="mobile-fullscreen-header">
            <span class="mobile-fullscreen-title"></span>
            <button type="button" class="mobile-fullscreen-episodes" aria-label="选集" hidden>选集</button>
            <button type="button" class="mobile-fullscreen-more" aria-label="更多播放控制">更多</button>
            <button type="button" class="mobile-fullscreen-exit" aria-label="退出全屏">✕</button>
        </div>
        <button type="button" class="mobile-fullscreen-play" aria-label="暂停播放"></button>
        <div class="mobile-fullscreen-footer">
            <input class="mobile-fullscreen-seek" type="range" min="0" max="100" step="0.1" value="0" aria-label="播放进度">
            <span class="mobile-fullscreen-time"></span>
        </div>`;
    const level = document.createElement('div');
    level.className = 'mobile-fullscreen-level';
    level.setAttribute('role', 'status');
    level.innerHTML = '<span class="mobile-fullscreen-level-label"></span><span class="mobile-fullscreen-level-track"><span class="mobile-fullscreen-level-fill"></span></span>';
    player.append(chrome, level);

    const titleEl = chrome.querySelector('.mobile-fullscreen-title');
    const episodesButton = chrome.querySelector('.mobile-fullscreen-episodes');
    const play = chrome.querySelector('.mobile-fullscreen-play');
    const seek = chrome.querySelector('.mobile-fullscreen-seek');
    const time = chrome.querySelector('.mobile-fullscreen-time');
    const levelLabel = level.querySelector('.mobile-fullscreen-level-label');
    const levelFill = level.querySelector('.mobile-fullscreen-level-fill');
    let active = false;
    let brightness = 100;
    let gesture = null;
    let suppressClickUntil = 0;
    let chromeTimer = null;
    let levelTimer = null;
    let seeking = false;

    function formatTime(seconds) {
        if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
        const total = Math.floor(seconds);
        const hours = Math.floor(total / 3600);
        const minutes = Math.floor(total / 60) % 60;
        const remainder = String(total % 60).padStart(2, '0');
        return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${remainder}` : `${minutes}:${remainder}`;
    }

    function update() {
        titleEl.textContent = options.title() || document.title;
        episodesButton.hidden = !(options.hasEpisodes?.() && options.onEpisodes);
        play.textContent = video.paused ? '▶' : 'Ⅱ';
        play.setAttribute('aria-label', video.paused ? '继续播放' : '暂停播放');
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        if (!seeking) seek.value = duration ? String(video.currentTime / duration * 100) : '0';
        seek.disabled = !duration;
        time.textContent = `${formatTime(video.currentTime)} / ${formatTime(duration)}`;
    }

    function hideChrome() {
        clearTimeout(chromeTimer);
        player.classList.remove('mobile-fullscreen-chrome-visible');
        art.controls.show = false;
    }

    function showChrome() {
        update();
        player.classList.add('mobile-fullscreen-chrome-visible');
        clearTimeout(chromeTimer);
        chromeTimer = setTimeout(hideChrome, 6500);
    }

    function toggleChrome() {
        if (!active) return;
        if (player.classList.contains('mobile-fullscreen-chrome-visible')) hideChrome();
        else showChrome();
    }

    function showLevel(label, amount) {
        levelLabel.textContent = `${label} ${Math.round(amount)}%`;
        levelFill.style.width = `${amount}%`;
        level.classList.add('visible');
        clearTimeout(levelTimer);
        levelTimer = setTimeout(() => level.classList.remove('visible'), 1400);
    }

    function sync() {
        const wanted = options.isFullscreen() && options.isTouchDevice();
        if (wanted === active) return;
        active = wanted;
        player.classList.toggle('mobile-fullscreen-interaction', active);
        if (active) {
            video.style.filter = `brightness(${brightness}%)`;
            player.dataset.brightness = String(brightness);
            showChrome();
        } else {
            hideChrome();
            level.classList.remove('visible');
            video.style.filter = '';
            gesture = null;
        }
    }

    function onStart(event) {
        if (!active || event.touches.length !== 1 || event.target.closest('button, input, .art-controls, .art-setting, .art-settings, .player-top-actions, .player-episode-drawer, .player-next-card, .player-shortcut-help, .player-stats-panel')) return;
        const touch = event.touches[0];
        const bounds = player.getBoundingClientRect();
        gesture = {
            x: touch.clientX, y: touch.clientY, side: touch.clientX < bounds.left + bounds.width / 2 ? 'brightness' : 'volume',
            initial: touch.clientX < bounds.left + bounds.width / 2 ? brightness : Math.round(video.volume * 100),
            height: Math.max(bounds.height, 1), width: Math.max(bounds.width, 1), moved: false,
            mode: null, startTime: video.currentTime || 0, seekTarget: null
        };
    }

    function onMove(event) {
        if (!active || !gesture || event.touches.length !== 1) return;
        // 全屏手势由这里统一处理；不让 Artplayer 自带的滑动调进度再收到移动事件，否则松手时会把进度改回去
        event.stopPropagation();
        const touch = event.touches[0];
        const dx = touch.clientX - gesture.x;
        const dy = touch.clientY - gesture.y;
        if (!gesture.moved) {
            // 横向滑动拖动进度，纵向滑动左侧调亮度、右侧调音量
            if (Math.abs(dx) >= 12 && Math.abs(dx) > Math.abs(dy) * 1.15) {
                gesture.mode = 'seek';
            } else if (Math.abs(dy) >= 12 && Math.abs(dy) >= Math.abs(dx) * 1.15) {
                gesture.mode = 'level';
            } else {
                return;
            }
            gesture.moved = true;
        }
        event.preventDefault();
        event.stopPropagation();
        if (gesture.mode === 'seek') {
            const duration = Number.isFinite(video.duration) ? video.duration : 0;
            if (!duration) return;
            const target = window.PlayerEnhancements
                ? window.PlayerEnhancements.swipeSeekTarget(gesture.startTime, dx, gesture.width, duration)
                : Math.max(0, Math.min(duration, gesture.startTime + dx / gesture.width * Math.min(120, duration)));
            gesture.seekTarget = target;
            const offset = Math.round(target - gesture.startTime);
            levelLabel.textContent = `${formatTime(target)} / ${formatTime(duration)}（${offset >= 0 ? '+' : '-'}${Math.abs(offset)} 秒）`;
            levelFill.style.width = `${target / duration * 100}%`;
            level.classList.add('visible');
            clearTimeout(levelTimer);
            return;
        }
        const amount = Math.max(0, Math.min(100, gesture.initial - dy / gesture.height * 100));
        if (gesture.side === 'brightness') {
            brightness = amount;
            video.style.filter = `brightness(${amount}%)`;
            player.dataset.brightness = String(amount);
            showLevel('亮度', amount);
        } else {
            const previousVolume = video.volume;
            art.volume = amount / 100;
            if (amount > 0 && video.muted) art.muted = false;
            if (Math.abs(video.volume - amount / 100) > 0.02 && Math.abs(previousVolume - amount / 100) > 0.02) {
                showLevel('请用侧边键调音量', video.volume * 100);
            } else {
                showLevel('音量', video.volume * 100);
            }
        }
    }

    function onEnd(event) {
        if (gesture?.mode === 'seek' && gesture.seekTarget !== null) {
            video.currentTime = gesture.seekTarget;
            levelTimer = setTimeout(() => level.classList.remove('visible'), 600);
            update();
        }
        if (gesture?.moved) {
            event.preventDefault();
            event.stopPropagation();
            suppressClickUntil = performance.now() + 500;
        }
        gesture = null;
    }

    function onSeek() {
        seeking = true;
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        if (duration) video.currentTime = duration * Number(seek.value) / 100;
        seeking = false;
        update();
        showChrome();
    }

    function onFullscreenControl(event) {
        if (!options.isTouchDevice() || document.fullscreenEnabled || !event.target.closest('.art-control-fullscreen')) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        art.fullscreenWeb = !art.fullscreenWeb;
        sync();
    }

    play.addEventListener('click', () => { art.toggle(); update(); showChrome(); });
    chrome.querySelector('.mobile-fullscreen-exit').addEventListener('click', () => {
        if (art.fullscreenWeb) art.fullscreenWeb = false;
        else art.fullscreen = false;
    });
    episodesButton.addEventListener('click', () => {
        options.onEpisodes?.();
        showChrome();
    });
    // 更多 opens the player settings (speed, 画质增强, 统计信息…) instead of a second control bar,
    // which would bring its own progress bar next to the fullscreen one.
    chrome.querySelector('.mobile-fullscreen-more').addEventListener('click', () => {
        // ArtPlayer closes its settings on any click outside them, this one included: open after it.
        const open = !art.setting.show;
        setTimeout(() => { art.setting.show = open; }, 0);
        showChrome();
    });
    seek.addEventListener('input', onSeek);
    player.addEventListener('click', onFullscreenControl, true);
    player.addEventListener('touchstart', onStart, {passive: true, capture: true});
    player.addEventListener('touchmove', onMove, {passive: false, capture: true});
    player.addEventListener('touchend', onEnd, {passive: false, capture: true});
    player.addEventListener('touchcancel', onEnd, {passive: false, capture: true});
    video.addEventListener('timeupdate', update);
    video.addEventListener('durationchange', update);
    video.addEventListener('play', update);
    video.addEventListener('pause', update);
    update();

    return {
        get active() { return active; },
        sync,
        toggleChrome,
        shouldSuppressClick() { return performance.now() < suppressClickUntil; },
        destroy() {
            clearTimeout(chromeTimer);
            clearTimeout(levelTimer);
            video.style.filter = '';
            player.classList.remove('mobile-fullscreen-interaction', 'mobile-fullscreen-chrome-visible');
            player.removeEventListener('touchstart', onStart, true);
            player.removeEventListener('click', onFullscreenControl, true);
            player.removeEventListener('touchmove', onMove, true);
            player.removeEventListener('touchend', onEnd, true);
            player.removeEventListener('touchcancel', onEnd, true);
            video.removeEventListener('timeupdate', update);
            video.removeEventListener('durationchange', update);
            video.removeEventListener('play', update);
            video.removeEventListener('pause', update);
            chrome.remove();
            level.remove();
        }
    };
};
