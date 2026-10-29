// Does any selected source actually have a playable copy of a Douban title?
// Used to hide recommendations that would end in "没有找到匹配资源". Results are
// cached (found: 3 days, not found: 6 hours) so a title is not searched again soon.
(() => {
    const CACHE_KEY = 'sourceAvailabilityV1';
    const CACHE_LIMIT = 600;
    const FOUND_TTL = 3 * 24 * 60 * 60 * 1000;
    const MISSING_TTL = 6 * 60 * 60 * 1000;
    const CONCURRENCY = 4;
    const PLAYABLE = /https?:\/\/[^#$\s]+?\.(?:m3u8|mp4|webm|mov|m4v)(?:\?[^#$\s]*)?(?=$|[#$\s])/i;

    const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[\s·・:：,，.。!！?？'"“”‘’\-—_]+/g, '');
    const yearOf = value => Number(String(value || '').match(/(?:19|20)\d{2}/)?.[0] || 0);
    const pending = new Map();
    const queue = [];
    let running = 0;

    function cacheKey({ title, year, kind }) {
        return [normalize(title), yearOf(year) || '', kind || ''].join('|');
    }

    function readCache() {
        try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') || {}; } catch { return {}; }
    }

    function cached(key, now = Date.now()) {
        const entry = readCache()[key];
        if (!entry) return undefined;
        return now - entry.at < (entry.ok ? FOUND_TTL : MISSING_TTL) ? entry.ok : undefined;
    }

    function remember(key, ok, cover = '') {
        try {
            const cache = readCache();
            delete cache[key];
            cache[key] = cover ? { ok, at: Date.now(), cover } : { ok, at: Date.now() };
            const keys = Object.keys(cache);
            for (const old of keys.slice(0, Math.max(0, keys.length - CACHE_LIMIT))) delete cache[old];
            localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
        } catch { /* storage full or blocked */ }
    }

    // Playable episodes in the best line: some sources put web-page links in the first line and m3u8 in another.
    function episodeCount(item) {
        return Math.max(0, ...String(item?.vod_play_url || '').split('$$$')
            .map(group => group.split('#').filter(entry => PLAYABLE.test(entry)).length));
    }

    // Same title (ignoring spacing and punctuation), release year within one year when both are known,
    // a compatible kind (a film is not a 60-episode short drama of the same name), and at least one
    // direct video URL.
    function isPlayableMatch(item, request) {
        if (normalize(item?.vod_name) !== normalize(request.title)) return false;
        const wanted = yearOf(request.year);
        const found = yearOf(item?.vod_year);
        if (wanted && found && Math.abs(wanted - found) > 1) return false;
        const type = String(item?.type_name || '');
        if (/解说|预告|花絮/.test(type) && !/解说|预告|花絮/.test(request.title)) return false;
        const episodes = episodeCount(item);
        if (!episodes) return false;
        // "剧情片"/"喜剧片" are films; "国产剧"/"短剧" are series.
        const seriesType = /剧/.test(type) && !/片/.test(type);
        const filmType = /片|电影/.test(type) && !/动画|动漫|纪录|记录/.test(type);
        if (request.kind === 'movie' && (seriesType || episodes > 3)) return false;
        if (request.kind === 'tv' && filmType) return false;
        return true;
    }

    function selectedSources() {
        let chosen;
        try { chosen = JSON.parse(localStorage.getItem('selectedAPIs') || 'null'); } catch { chosen = null; }
        const ids = Array.isArray(chosen) && chosen.length ? chosen : (window.DEFAULT_SELECTED_APIS || []);
        const filtered = localStorage.getItem('yellowFilterEnabled') === 'true';
        return ids.filter(id => {
            const context = window.getApiSearchContext?.(id);
            const adult = window.API_SITES?.[id]?.adult || (id.startsWith('custom_') && window.getCustomApiInfo?.(id.slice(7))?.isAdult);
            return context && !(filtered && adult);
        });
    }

    // { ok: true|false|null, cover }: the cover of the playable copy stands in when Douban has no poster yet.
    async function searchSources(request) {
        let reached = 0;
        for (const id of selectedSources()) {
            const context = window.getApiSearchContext(id);
            try {
                const data = await window.fetchVodApiJson(context.apiBaseUrl + API_CONFIG.search.path + encodeURIComponent(request.title));
                if (data) reached++;
                const match = (Array.isArray(data?.list) ? data.list : []).find(item => isPlayableMatch(item, request));
                if (match) return { ok: true, cover: (window.normalizeImageUrl ? window.normalizeImageUrl(match.vod_pic, context.apiBaseUrl) : match.vod_pic) || '' };
            } catch { /* this source is down; try the next one */ }
        }
        // No source answered at all: unknown, keep the title visible.
        return { ok: reached ? false : null, cover: '' };
    }

    function pump() {
        while (running < CONCURRENCY && queue.length) {
            const job = queue.shift();
            running++;
            job().finally(() => { running--; pump(); });
        }
    }

    // Resolves true (playable somewhere), false (no selected source has it) or null (could not tell).
    // request: { title, year, kind, isWanted?: () => boolean }
    function check(request) {
        if (!request?.title) return Promise.resolve(null);
        const key = cacheKey(request);
        const known = cached(key);
        if (known !== undefined) return Promise.resolve(known);
        if (!pending.has(key)) {
            pending.set(key, new Promise(resolve => {
                queue.push(async () => {
                    // The card asking may be gone already (tag switched): skip without searching.
                    if (request.isWanted && !request.isWanted()) {
                        pending.delete(key);
                        resolve(null);
                        return;
                    }
                    const { ok, cover } = await searchSources(request).catch(() => ({ ok: null, cover: '' }));
                    if (ok !== null) remember(key, ok, cover);
                    pending.delete(key);
                    resolve(ok);
                });
                // Start on the next tick: callers often ask before attaching the card to the page.
                setTimeout(pump, 0);
            }));
        }
        return pending.get(key);
    }

    // Cover of the playable copy found by check(), if any.
    function coverOf(request) {
        return readCache()[cacheKey(request)]?.cover || '';
    }

    window.SourceAvailability = { check, coverOf, isPlayableMatch, cacheKey };
})();
