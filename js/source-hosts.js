// Domains a viewer's network actually talks to while using LibreTV, for router rules such as
// OpenClash DIRECT. Source APIs are listed from the source list; video CDN and poster hosts are
// learned from search results and played segments (they rotate, e.g. lzcdn28 → lzcdn29).
(() => {
    const STORAGE_KEY = 'sourceHostsV1';
    const LIMIT = 400;
    const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
    // Seen in October 2026 testing; learning keeps the list current from here on.
    const SEED = {
        cdn: ['lzcdn28.com', 'lzcdn10.com', 'ffzy-online2.com', 'ddbbffcdn.com', 'jisuzyv.com', 'jisuts.com', 'ppqrrs.com',
            'zuidazym3u8.com', 'bfikuncdn.com', 'modujx16.com', 'bdzybf11.com', 'ukubf3.com', 'ryplay13.com', 'maowushi.com',
            'maoyanplay.top', 'huyall.com', 'gsuus.com', 'kuktxu.com', 'bfvvs.com', 'hhuus.com'],
        image: ['lzipic.com', 'jisuimage.com', 'youkupic.com']
    };
    // Second-level public suffixes common for these hosts; anything else keeps its last two labels.
    const MULTI_PART_SUFFIXES = new Set(['com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'com.hk', 'com.tw', 'co.uk', 'co.jp', 'com.au']);
    const memory = new Set();

    function registrableDomain(hostname) {
        const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
        if (!host || /^\d+(?:\.\d+){3}$/.test(host) || host.includes(':') || !host.includes('.')) return '';
        const labels = host.split('.');
        const lastTwo = labels.slice(-2).join('.');
        return MULTI_PART_SUFFIXES.has(lastTwo) && labels.length > 2 ? labels.slice(-3).join('.') : lastTwo;
    }

    function domainOf(url) {
        try { return registrableDomain(new URL(url).hostname); } catch { return ''; }
    }

    function read() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; } catch { return {}; }
    }

    function remember(kind, domains) {
        const fresh = domains.filter(domain => domain && !memory.has(`${kind}:${domain}`));
        if (!fresh.length) return;
        fresh.forEach(domain => memory.add(`${kind}:${domain}`));
        try {
            const store = read();
            const now = Date.now();
            for (const domain of fresh) store[`${kind}:${domain}`] = now;
            const entries = Object.entries(store).filter(([, at]) => now - at < MAX_AGE_MS)
                .sort((a, b) => b[1] - a[1]).slice(0, LIMIT);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
        } catch { /* storage full or blocked */ }
    }

    // Search/detail items: the first URL of every play line, and the poster.
    function learnItems(items) {
        if (!Array.isArray(items)) return;
        const cdn = new Set();
        const image = new Set();
        for (const item of items) {
            for (const line of String(item?.vod_play_url || '').split('$$$')) {
                const match = line.match(/https?:\/\/[^#$\s]+/i);
                if (match && /\.(?:m3u8|mp4)/i.test(match[0])) cdn.add(domainOf(match[0]));
            }
            if (/^https?:\/\//i.test(item?.vod_pic || '')) image.add(domainOf(item.vod_pic));
        }
        remember('cdn', [...cdn]);
        remember('image', [...image]);
    }

    // Segments can live on another host than their playlist (e.g. vv.jisuzyv.com → p.jisuts.com).
    function learnUrl(url, kind = 'cdn') {
        const domain = domainOf(url);
        if (domain && !/^(?:127\.|localhost)/.test(domain)) remember(kind, [domain]);
    }

    function apiDomains(siteMap, customApis) {
        const normal = new Set();
        const adult = new Set();
        for (const site of Object.values(siteMap || {})) {
            const domain = domainOf(site.api);
            if (domain) (site.adult ? adult : normal).add(domain);
        }
        for (const custom of customApis || []) {
            const domain = domainOf(custom?.url);
            if (domain) (custom.isAdult ? adult : normal).add(domain);
        }
        return { normal: [...normal], adult: [...adult] };
    }

    function buildClashRules({ siteMap = window.API_SITES, customApis = [], learned = read(), ownHost = '' } = {}) {
        const own = registrableDomain(ownHost);
        const used = new Set(own ? [own] : []);
        const section = (title, domains) => {
            const list = [...new Set(domains.map(registrableDomain))].filter(domain => domain && !used.has(domain)).sort();
            list.forEach(domain => used.add(domain));
            return list.length ? [`##${title}`, ...list.map(domain => `- DOMAIN-SUFFIX,${domain},DIRECT`)] : [];
        };
        const learnedOf = kind => Object.keys(learned).filter(key => key.startsWith(`${kind}:`)).map(key => key.slice(kind.length + 1));
        const apis = apiDomains(siteMap, customApis);
        return [
            ...section('LibreTV视频网站', apis.normal),
            ...section('LibreTV视频CDN', [...SEED.cdn, ...learnedOf('cdn')]),
            ...section('LibreTV海报图片', [...SEED.image, ...learnedOf('image')]),
            ...section('LibreTV豆瓣推荐', ['douban.com', 'doubanio.com']),
            ...section('LibreTV成人资源站（不需要可删除）', apis.adult)
        ].join('\n') + '\n';
    }

    async function copyText(text, textarea) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            textarea.focus();
            textarea.select();
            try { return document.execCommand('copy'); } catch { return false; }
        }
    }

    // Settings → 路由器直连规则
    function showClashRules() {
        let customApis = [];
        try { customApis = JSON.parse(localStorage.getItem('customAPIs') || '[]'); } catch { customApis = []; }
        const text = buildClashRules({ customApis, ownHost: location.hostname });
        const modal = document.getElementById('modal');
        const content = document.getElementById('modalContent');
        if (!modal || !content) return;
        document.getElementById('modalTitle').textContent = 'OpenClash 直连规则';
        content.replaceChildren();
        const tip = document.createElement('p');
        tip.className = 'clash-rules-tip';
        tip.textContent = `共 ${text.split('\n').filter(line => line.startsWith('- ')).length} 条。粘贴到 OpenClash →「覆写设置」→「规则设置」→「自定义规则」。视频 CDN 域名会随使用自动增加，隔段时间重新生成即可。`;
        const textarea = document.createElement('textarea');
        textarea.className = 'clash-rules-text';
        textarea.readOnly = true;
        textarea.spellcheck = false;
        textarea.value = text;
        textarea.setAttribute('aria-label', 'OpenClash 直连规则');
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'lt-btn lt-btn-primary lt-btn-sm';
        copy.textContent = '复制全部';
        copy.onclick = async () => {
            const ok = await copyText(text, textarea);
            window.showToast?.(ok ? '已复制直连规则' : '复制失败，请手动全选复制', ok ? 'success' : 'error');
        };
        content.append(tip, textarea, copy);
        modal.classList.remove('hidden');
    }

    window.showClashRules = showClashRules;
    window.SourceHosts = { registrableDomain, learnItems, learnUrl, buildClashRules, SEED };
})();
