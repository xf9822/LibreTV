// 首页设置里的安卓 App 卡片：在 LibreTV 安卓 App 里显示当前网站地址和「更换网站地址」；
// 在安卓手机的浏览器里显示 App 下载入口（App 支持投屏到电视、有声自动播放）。
(() => {
    const app = window.LibreTVApp;

    function isAndroidBrowser(ua = navigator.userAgent) {
        return /Android/i.test(ua || '') && !/LibreTVApp\//.test(ua || '');
    }

    // phone / tv / ios / desktop
    function deviceKind(ua = navigator.userAgent, platform = navigator.platform, touchPoints = navigator.maxTouchPoints) {
        const agent = ua || '';
        if (/iPhone|iPad|iPod/i.test(agent) || (platform === 'MacIntel' && touchPoints > 1)) return 'ios';
        if (window.TVMode?.detectTv?.(agent, '', null) || /\bAndroid TV\b|\bAFT[A-Z0-9]|BRAVIA|SMART-TV|SmartTV|\bMiTV|MIBOX|HiTV/i.test(agent)) return 'tv';
        if (/Android/i.test(agent)) return 'phone';
        return 'desktop';
    }

    function start() {
        if (app && typeof app.siteUrl === 'function') {
            const card = document.getElementById('androidAppSettingsCard');
            if (!card) return;
            try {
                card.querySelector('.android-app-site').textContent = app.siteUrl();
                card.querySelector('.android-app-version').textContent = app.version();
            } catch { /* older app */ }
            card.querySelector('.android-app-change-site').addEventListener('click', () => {
                if (window.confirm('更换网站地址后会回到地址输入页面，确定吗？')) app.changeSite();
            });
            card.hidden = false;
            return;
        }
        // 安卓手机、安卓电视和电脑上都显示（电脑上可以下载后用 U 盘装到电视）；按当前设备把推荐的那个标成主按钮
        const kind = deviceKind();
        if (kind === 'ios') return;
        const card = document.getElementById('androidAppDownloadCard');
        if (!card) return;
        const recommended = kind === 'tv' ? '.android-app-tv' : kind === 'phone' ? '.android-app-phone' : '';
        if (recommended) {
            card.querySelector(recommended)?.classList.add('lt-btn-primary');
            card.querySelector('.android-app-hint').textContent = `已按当前设备推荐${kind === 'tv' ? '电视版' : '手机版'}。` + card.querySelector('.android-app-hint').textContent;
        } else {
            card.querySelector('.android-app-hint').textContent = '电视上可以用电视浏览器打开本站下载，或在电脑上下载后用 U 盘安装。' + card.querySelector('.android-app-hint').textContent;
        }
        card.hidden = false;
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();

    window.AndroidAppHint = { isAndroidBrowser, deviceKind };
})();
