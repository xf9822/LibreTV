// iPhone / iPad 没有「安装」按钮或弹窗：网页应用要从浏览器的分享菜单里「添加到主屏幕」。
// 首页底部提示一次（点「知道了」后不再出现），设置面板里一直保留这条说明；已从主屏幕打开时都不显示。
(() => {
    const DISMISS_KEY = 'iosInstallHintDismissed';
    const SHOW_DELAY_MS = 4000;

    function isAppleTouchDevice(ua = navigator.userAgent, platform = navigator.platform, touchPoints = navigator.maxTouchPoints) {
        return /iPhone|iPad|iPod/i.test(ua || '') || (platform === 'MacIntel' && touchPoints > 1);
    }

    function isStandalone() {
        return navigator.standalone === true || Boolean(window.matchMedia?.('(display-mode: standalone)').matches);
    }

    // 不同浏览器里「分享」按钮的位置不同；微信、QQ 等内置浏览器不能添加，要先换到 Safari
    function steps(ua = navigator.userAgent) {
        if (/MicroMessenger|QQ\/|Weibo|DingTalk/i.test(ua || '')) {
            return '当前是 App 内置浏览器，无法添加。请点右上角「…」，选「在 Safari 中打开」，再按 Safari 的方法添加。';
        }
        if (/CriOS|EdgiOS|FxiOS/i.test(ua || '')) {
            return '点地址栏旁的「分享」按钮（方框加向上箭头），选「添加到主屏幕」。';
        }
        return '点浏览器的「分享」按钮（方框加向上箭头），往下滑选「添加到主屏幕」。';
    }

    function readDismissed() {
        try { return localStorage.getItem(DISMISS_KEY) === 'true'; } catch { return false; }
    }

    function dismiss() {
        try { localStorage.setItem(DISMISS_KEY, 'true'); } catch { /* storage blocked */ }
    }

    function fillSettingsCard() {
        const card = document.getElementById('iosInstallCard');
        if (!card) return;
        card.querySelector('.ios-install-steps').textContent = steps();
        card.hidden = false;
    }

    function showBanner() {
        if (readDismissed() || document.querySelector('.ios-install-hint')) return;
        const banner = document.createElement('div');
        banner.className = 'ios-install-hint';
        banner.setAttribute('role', 'note');
        banner.innerHTML = `
            <div class="ios-install-hint-text">
                <strong>添加到主屏幕</strong>
                <span></span>
                <small>从主屏幕打开没有浏览器地址栏，用起来像独立 App。设置里也能找到这条说明。</small>
            </div>
            <button type="button" class="lt-btn lt-btn-sm ios-install-hint-close">知道了</button>`;
        banner.querySelector('.ios-install-hint-text span').textContent = steps();
        banner.querySelector('.ios-install-hint-close').addEventListener('click', () => {
            dismiss();
            banner.remove();
        });
        document.body.appendChild(banner);
    }

    function start() {
        if (!isAppleTouchDevice() || isStandalone()) return;
        fillSettingsCard();
        if (document.getElementById('searchInput')) setTimeout(showBanner, SHOW_DELAY_MS);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();

    window.IosInstallHint = { isAppleTouchDevice, steps };
})();
