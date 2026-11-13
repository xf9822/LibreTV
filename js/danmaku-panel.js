// 弹幕设置面板（样式参考视频网站的「弹幕工具箱」）：行数 / 不透明度 / 速度 / 字号四个竖条，
// 密度、彩色弹幕开关，以及「恢复默认设置」。面板放在播放器里面，全屏和横过来的网页全屏里都能用。
// 样式选择记在本机（danmakuStyle）。
(() => {
    const STORE_KEY = 'danmakuStyle';

    const SLIDERS = {
        rows: {
            label: '行数',
            options: [
                { label: '1行', rows: 1 }, { label: '2行', rows: 2 }, { label: '3行', rows: 3 }, { label: '4行', rows: 4 },
                { label: '1/4屏', share: 0.25 }, { label: '半屏', share: 0.5 }, { label: '3/4屏', share: 0.75 }, { label: '满屏', share: 1 }
            ]
        },
        opacity: {
            label: '不透明度',
            options: [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1].map(value => ({ label: `${Math.round(value * 100)}%`, value }))
        },
        speed: {
            label: '速度',
            // 一条弹幕从右走到左用的秒数（弹幕插件最多 10 秒）
            options: [{ label: '极慢', seconds: 10 }, { label: '较慢', seconds: 8.5 }, { label: '适中', seconds: 7 }, { label: '较快', seconds: 5.5 }, { label: '极快', seconds: 4 }]
        },
        size: {
            label: '字号',
            options: [{ label: '极小', scale: 0.75 }, { label: '较小', scale: 0.875 }, { label: '适中', scale: 1 }, { label: '较大', scale: 1.15 }, { label: '极大', scale: 1.3 }]
        }
    };
    const DEFAULTS = { rows: 5, opacity: 7, speed: 2, size: 2, colorful: true };
    const DENSITIES = [['light', '稀疏'], ['normal', '适中'], ['dense', '密集'], ['full', '完整']];

    function clampIndex(key, value) {
        const max = SLIDERS[key].options.length - 1;
        const index = Math.round(Number(value));
        return Number.isFinite(index) ? Math.min(max, Math.max(0, index)) : DEFAULTS[key];
    }

    function normalizeStyle(value) {
        const style = { ...DEFAULTS };
        if (value && typeof value === 'object') {
            for (const key of Object.keys(SLIDERS)) if (key in value) style[key] = clampIndex(key, value[key]);
            if (typeof value.colorful === 'boolean') style.colorful = value.colorful;
        }
        return style;
    }

    function readStyle() {
        try { return normalizeStyle(JSON.parse(localStorage.getItem(STORE_KEY) || 'null')); } catch { return { ...DEFAULTS }; }
    }

    function writeStyle(style) {
        try { localStorage.setItem(STORE_KEY, JSON.stringify(normalizeStyle(style))); } catch { /* storage blocked */ }
    }

    // 换成弹幕插件的参数。height 是播放器当前高度；手机竖屏的小播放器字小一些，全屏时大一些。
    function pluginOptions(style, { height = 0, mobile = false, fullscreen = false } = {}) {
        const s = normalizeStyle(style);
        const base = mobile ? (fullscreen ? 18 : 14) : 24;
        const fontSize = Math.round(base * SLIDERS.size.options[s.size].scale);
        const top = mobile ? 6 : 10;
        const area = SLIDERS.rows.options[s.rows];
        let bottom;
        if (area.rows) {
            const line = Math.ceil(fontSize * 1.3) + 2;
            bottom = height > 0 ? Math.max(0, Math.floor(height - top - area.rows * line)) : `${100 - area.rows * 8}%`;
        } else {
            bottom = `${Math.max(3, Math.round((1 - area.share) * 100))}%`;
        }
        return {
            fontSize,
            margin: [top, bottom],
            opacity: SLIDERS.opacity.options[s.opacity].value,
            speed: SLIDERS.speed.options[s.speed].seconds
        };
    }

    // 竖条上点到的位置（从下往上的比例）。播放器横过来显示时（旋转 90°），屏幕上的「从左到右」才是竖条的「从下到上」。
    function sliderRatio(clientX, clientY, rect, rotated) {
        if (!rect || !(rect.width > 0) || !(rect.height > 0)) return 0;
        const ratio = rotated ? (clientX - rect.left) / rect.width : (rect.bottom - clientY) / rect.height;
        return Math.min(1, Math.max(0, ratio));
    }

    // host: 播放器元素；getState() → { visible, density, autoFix, summary }（autoFix：自动跳过的插播广告秒数）；
    // onStyle(style)、onDensity(mode)、onVisible(on) 由播放器处理；isRotated() 说明播放器是否横过来了
    function create({ host, getState, onStyle, onDensity, onVisible, isRotated = () => false }) {
        let style = readStyle();
        const panel = document.createElement('div');
        panel.className = 'danmaku-panel';
        panel.hidden = true;
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', '弹幕设置');
        const sliders = Object.entries(SLIDERS).map(([key, item]) => `
            <div class="dm-slider-wrap">
                <div class="dm-slider" role="slider" tabindex="0" data-key="${key}" data-tv-keys="vertical"
                     aria-label="${item.label}" aria-valuemin="0" aria-valuemax="${item.options.length - 1}">
                    <div class="dm-slider-fill"></div>
                    <span class="dm-slider-value"></span>
                </div>
                <span class="dm-slider-label">${item.label}</span>
            </div>`).join('');
        panel.innerHTML = `
            <div class="dm-head">
                <strong>弹幕设置</strong>
                <button type="button" class="dm-reset">恢复默认设置</button>
                <button type="button" class="dm-close" aria-label="关闭">✕</button>
            </div>
            <div class="dm-body">
                <div class="dm-row">
                    <span>显示弹幕</span>
                    <button type="button" class="dm-switch" role="switch" data-act="visible" aria-label="显示弹幕"></button>
                </div>
                <p class="dm-status"></p>
                <p class="dm-status dm-autofix"></p>
                <h4>弹幕展示</h4>
                <div class="dm-sliders">${sliders}</div>
                <h4>弹幕密度</h4>
                <div class="dm-segment">${DENSITIES.map(([value, label]) => `<button type="button" data-density="${value}">${label}</button>`).join('')}</div>
                <h4>弹幕类型</h4>
                <div class="dm-row">
                    <span>🎨 彩色弹幕</span>
                    <button type="button" class="dm-switch" role="switch" data-act="colorful" aria-label="彩色弹幕"></button>
                </div>
            </div>`;
        host.appendChild(panel);

        function render() {
            const state = getState() || {};
            for (const slider of panel.querySelectorAll('.dm-slider')) {
                const key = slider.dataset.key;
                const options = SLIDERS[key].options;
                const index = style[key];
                slider.querySelector('.dm-slider-fill').style.height = `${options.length > 1 ? (index / (options.length - 1)) * 100 : 100}%`;
                slider.querySelector('.dm-slider-value').textContent = options[index].label;
                slider.setAttribute('aria-valuenow', String(index));
                slider.setAttribute('aria-valuetext', options[index].label);
            }
            for (const button of panel.querySelectorAll('[data-density]')) {
                button.classList.toggle('is-active', button.dataset.density === state.density);
            }
            panel.querySelector('[data-act="visible"]').setAttribute('aria-checked', String(Boolean(state.visible)));
            panel.querySelector('[data-act="colorful"]').setAttribute('aria-checked', String(style.colorful));
            panel.querySelector('.dm-status').textContent = state.summary || '';
            panel.querySelector('.dm-autofix').textContent = state.autoFix
                ? `视频里有 ${Math.round(state.autoFix)} 秒插播广告，弹幕已自动跳过，和画面对齐。` : '';
        }

        function setStyle(next) {
            style = normalizeStyle(next);
            writeStyle(style);
            render();
            onStyle?.(style);
        }

        function setSlider(key, index) {
            const value = clampIndex(key, index);
            if (value !== style[key]) setStyle({ ...style, [key]: value });
        }

        // ---- 竖条：按住拖动或点一下；方向键调一档（电视上左右键用来换竖条，只有上下键调），确认键往上调一档（到顶回到最低） ----
        let drag = null;
        function pickFromPoint(slider, event) {
            const key = slider.dataset.key;
            const ratio = sliderRatio(event.clientX, event.clientY, slider.getBoundingClientRect(), isRotated());
            setSlider(key, ratio * (SLIDERS[key].options.length - 1));
        }
        panel.addEventListener('pointerdown', event => {
            const slider = event.target.closest('.dm-slider');
            if (!slider) return;
            event.preventDefault();
            drag = { slider, id: event.pointerId };
            try { slider.setPointerCapture(event.pointerId); } catch { /* not supported */ }
            pickFromPoint(slider, event);
        });
        panel.addEventListener('pointermove', event => {
            if (drag && event.pointerId === drag.id) pickFromPoint(drag.slider, event);
        });
        const endDrag = event => { if (drag && event.pointerId === drag.id) drag = null; };
        panel.addEventListener('pointerup', endDrag);
        panel.addEventListener('pointercancel', endDrag);

        function cycle(slider) {
            const key = slider.dataset.key;
            setSlider(key, (style[key] + 1) % SLIDERS[key].options.length);
        }

        panel.addEventListener('keydown', event => {
            // 面板里的按键不再触发播放器快捷键（方向键调音量 / 进度）
            event.stopPropagation();
            if (event.key === 'Escape') { event.preventDefault(); close(); return; }
            const slider = event.target.closest?.('.dm-slider');
            if (!slider) return;
            const step = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[event.key];
            if (step) setSlider(slider.dataset.key, style[slider.dataset.key] + step);
            else if (event.key === 'Enter' || event.key === ' ') cycle(slider);
            else return;
            event.preventDefault();
        });

        panel.addEventListener('click', event => {
            if (event.target.closest('.dm-close')) { close(); return; }
            // 电视遥控器的确认键会变成一次没有坐标的点击：往上调一档
            const slider = event.target.closest('.dm-slider');
            if (slider) { if (event.detail === 0) cycle(slider); return; }
            if (event.target.closest('.dm-reset')) { setStyle(DEFAULTS); return; }
            const density = event.target.closest('[data-density]');
            if (density) { onDensity?.(density.dataset.density); render(); return; }
            const act = event.target.closest('[data-act]')?.dataset.act;
            if (act === 'visible') { onVisible?.(!getState()?.visible); render(); return; }
            if (act === 'colorful') { setStyle({ ...style, colorful: !style.colorful }); return; }
        });
        // 面板上的点按、滑动不传给播放器（不暂停、不触发手势调进度 / 亮度）
        for (const type of ['click', 'dblclick', 'touchstart', 'touchmove', 'touchend', 'mousedown', 'pointerdown', 'wheel']) {
            panel.addEventListener(type, event => event.stopPropagation());
        }

        function open() {
            style = readStyle();
            panel.hidden = false;
            render();
            const first = panel.querySelector('.dm-slider');
            first?.focus({ preventScroll: true });
        }

        function close() {
            panel.hidden = true;
            host.focus?.({ preventScroll: true });
        }

        return {
            open,
            close,
            render,
            get isOpen() { return !panel.hidden; },
            get style() { return style; },
            destroy() { panel.remove(); }
        };
    }

    window.DanmakuPanel = { create, readStyle, pluginOptions, logic: { normalizeStyle, pluginOptions, sliderRatio, SLIDERS, DEFAULTS } };
})();
