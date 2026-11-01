// 投屏到电视：只在 LibreTV 安卓 App 里可用（浏览器不能发现局域网里的电视）。
// 网页通过 window.LibreTVApp 调用 App 的原生代码（DLNA 查找 / 遥控），App 把结果回调到 window.LibreTVCast。
(() => {
    const app = window.LibreTVApp;
    const isApp = Boolean(app && typeof app.discover === 'function' && typeof app.control === 'function');

    const state = { devices: [], searching: false, device: null, source: null, paused: false, busy: false, error: '' };
    let panel = null;
    let bar = null;
    let onStarted = null;

    const escapeText = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

    function absoluteUrl(url) {
        try { return new URL(url, window.location.href).href; } catch { return ''; }
    }

    // ---- 选择电视的面板 ----
    function renderPanel() {
        if (!panel) return;
        const list = state.devices.map((device, index) => `
            <button type="button" class="cast-device${state.device?.id === device.id ? ' is-active' : ''}" data-index="${index}">
                <span class="cast-device-name">${escapeText(device.name)}</span>
                ${device.model ? `<span class="cast-device-model">${escapeText(device.model)}</span>` : ''}
            </button>`).join('');
        let status = '';
        if (state.searching) status = '<span class="cast-spinner" aria-hidden="true"></span>正在查找同一 Wi-Fi 下的电视…';
        else if (state.error) status = escapeText(state.error);
        else if (!state.devices.length) status = '没有找到支持 DLNA 的电视或盒子。请确认设备已开机、和手机连着同一个 Wi-Fi、打开了投屏功能，然后点「重新查找」。<br>Apple TV 和 Mac 只支持苹果的 AirPlay，不支持 DLNA，这里搜不到。';
        else status = '选择要投屏的电视：';
        panel.querySelector('.cast-panel-status').innerHTML = status;
        panel.querySelector('.cast-panel-list').innerHTML = list;
        panel.querySelector('.cast-panel-retry').disabled = state.searching;
    }

    function openPanel(source, started) {
        if (!isApp) return;
        state.source = source;
        onStarted = started || null;
        if (!panel) {
            panel = document.createElement('div');
            panel.className = 'cast-panel-backdrop';
            panel.innerHTML = `
                <div class="cast-panel" role="dialog" aria-modal="true" aria-label="投屏到电视">
                    <div class="cast-panel-head">
                        <strong>投屏到电视</strong>
                        <button type="button" class="cast-panel-close" aria-label="关闭">✕</button>
                    </div>
                    <p class="cast-panel-status" aria-live="polite"></p>
                    <div class="cast-panel-list"></div>
                    <div class="cast-panel-foot">
                        <button type="button" class="lt-btn lt-btn-sm cast-panel-retry">重新查找</button>
                        <span>电视直接播放视频，手机可以锁屏；投屏时去广告不生效。</span>
                    </div>
                </div>`;
            panel.addEventListener('click', event => {
                if (event.target === panel || event.target.closest('.cast-panel-close')) closePanel();
                else if (event.target.closest('.cast-panel-retry')) discover();
                else {
                    const item = event.target.closest('.cast-device');
                    if (item) castTo(state.devices[Number(item.dataset.index)]);
                }
            });
            document.body.appendChild(panel);
        }
        panel.hidden = false;
        renderPanel();
        discover();
    }

    function closePanel() {
        if (panel) panel.hidden = true;
    }

    function discover() {
        if (state.searching) return;
        state.searching = true;
        state.error = '';
        renderPanel();
        try { app.discover(); } catch (error) { onDevices({ devices: [], error: `查找失败：${error.message}` }); }
    }

    function onDevices(result) {
        state.searching = false;
        state.devices = Array.isArray(result?.devices) ? result.devices : [];
        state.error = result?.error || '';
        renderPanel();
    }

    // ---- 遥控 ----
    function send(action, extra = {}) {
        if (!state.device) return;
        state.busy = true;
        renderBar();
        const source = state.source || {};
        try {
            app.control(state.device.id, action, extra.url || source.url || '', extra.title || source.title || '', Number(extra.seconds || 0));
        } catch (error) {
            onResult({ action, ok: false, error: error.message });
        }
    }

    function castTo(device, source = state.source) {
        if (!device || !source?.url) return;
        state.device = device;
        state.source = source;
        state.paused = false;
        state.error = '';
        send('play', { url: absoluteUrl(source.url), title: source.title, seconds: source.position || 0 });
        closePanel();
        renderBar(`正在连接「${device.name}」…`);
    }

    function onResult(result) {
        state.busy = false;
        if (!result?.ok) {
            const message = result?.error || '电视没有响应';
            if (result?.action === 'play') {
                const device = state.device;
                state.device = null;
                renderBar();
                window.showToast?.(`投屏到「${device?.name || '电视'}」失败：${message}`, 'error');
            } else {
                window.showToast?.(`电视没有响应：${message}`, 'error');
                renderBar();
            }
            return;
        }
        if (result.action === 'play') {
            state.paused = false;
            onStarted?.(state.device);
        } else if (result.action === 'pause') state.paused = true;
        else if (result.action === 'resume') state.paused = false;
        else if (result.action === 'stop') state.device = null;
        renderBar();
    }

    // ---- 播放器下方的投屏状态条 ----
    function renderBar(message) {
        if (!state.device) {
            bar?.remove();
            bar = null;
            return;
        }
        if (!bar) {
            bar = document.createElement('div');
            bar.className = 'cast-bar player-container';
            bar.addEventListener('click', event => {
                const button = event.target.closest('button[data-cast]');
                if (!button || state.busy) return;
                const action = button.dataset.cast;
                if (action === 'toggle') send(state.paused ? 'resume' : 'pause');
                else if (action === 'stop') send('stop');
                else if (action === 'switch') openPanel(state.source, onStarted);
            });
            const anchor = document.getElementById('playerContainer');
            if (anchor?.parentNode) anchor.parentNode.insertBefore(bar, anchor.nextSibling);
            else document.body.appendChild(bar);
        }
        const title = state.source?.title ? `：${escapeText(state.source.title)}` : '';
        bar.innerHTML = `
            <span class="cast-bar-text">📺 ${message ? escapeText(message) : `正在「${escapeText(state.device.name)}」上播放${title}`}</span>
            <span class="cast-bar-actions">
                <button type="button" data-cast="toggle" ${state.busy ? 'disabled' : ''}>${state.paused ? '继续' : '暂停'}</button>
                <button type="button" data-cast="switch" ${state.busy ? 'disabled' : ''}>换设备</button>
                <button type="button" data-cast="stop" ${state.busy ? 'disabled' : ''}>停止投屏</button>
            </span>`;
    }

    // 投屏期间换集：电视跟着播放新的一集
    function follow(source) {
        if (!state.device || !source?.url) return;
        castTo(state.device, { ...source, position: 0 });
    }

    function keepScreenOn(on) {
        try { app?.keepScreenOn?.(Boolean(on)); } catch { /* older app */ }
    }

    window.LibreTVCast = {
        isApp,
        open: openPanel,
        follow,
        keepScreenOn,
        get active() { return Boolean(state.device); },
        onDevices,
        onResult
    };
})();
