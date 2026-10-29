// Shared, local-only data for search grouping, resume and source preference.
(() => {
    const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
    const identity = item => window.QuickPlay.logic.identity(item);
    const year = value => String(value || '').match(/(?:19|20)\d{2}/)?.[0] || '';
    function groupResults(items) {
        const groups = new Map();
        for (const item of items) {
            const info = identity(item);
            // Missing identity fields cannot safely merge distinct versions.
            const key = info.title && info.year && info.kind
                ? [normalize(info.title), info.year, info.kind].join('|')
                : `${item.source_code || ''}:${item.vod_id || ''}`;
            if (!groups.has(key)) groups.set(key, []);
            const group = groups.get(key);
            if (!group.some(entry => entry.source_code === item.source_code && String(entry.vod_id) === String(item.vod_id))) group.push(item);
        }
        return [...groups.values()];
    }
    function unfinishedHistory(records) {
        return (Array.isArray(records) ? records : []).filter(item =>
            item?.title && item?.url && Number(item.playbackPosition) > 10 &&
            (!Number(item.duration) || Number(item.playbackPosition) < Number(item.duration) * 0.95)
        ).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    }
    const watchLaterKey = 'watchLaterV1';
    function watchLater() {
        try { const list = JSON.parse(localStorage.getItem(watchLaterKey) || '[]'); return Array.isArray(list) ? list : []; }
        catch { return []; }
    }
    function laterKey(item) { return [normalize(item.title), item.year || '', item.kind || ''].join('|'); }
    function addWatchLater(item) {
        if (!item?.title) return;
        const list = watchLater().filter(entry => laterKey(entry) !== laterKey(item));
        list.unshift({title:String(item.title), year:year(item.year), kind:item.kind || '', source:item.source || '', id:item.id || ''});
        localStorage.setItem(watchLaterKey, JSON.stringify(list.slice(0, 50)));
    }
    function removeWatchLater(item) { localStorage.setItem(watchLaterKey, JSON.stringify(watchLater().filter(entry => laterKey(entry) !== laterKey(item)))); }
    const qualityKey = 'sourcePlaybackQualityV1';
    function qualityData() { try { return JSON.parse(localStorage.getItem(qualityKey) || '{}'); } catch { return {}; } }
    function recordQuality(source, { started = false, firstFrameMs = 0, stalls = 0 } = {}) {
        if (!source) return;
        const data = qualityData();
        const observations = Array.isArray(data[source]) ? data[source] : [];
        observations.push({ at: Date.now(), started: Boolean(started), firstFrameMs: Math.max(0, Number(firstFrameMs) || 0), stalls: Math.max(0, Number(stalls) || 0) });
        data[source] = observations.slice(-12);
        localStorage.setItem(qualityKey, JSON.stringify(data));
    }
    function recordStall(source) {
        const data = qualityData();
        const list = data[source];
        if (!Array.isArray(list) || !list.length) return;
        const last = list[list.length - 1];
        if (!last.started || Date.now() - last.at > 3600000) return;
        last.stalls = (last.stalls || 0) + 1;
        localStorage.setItem(qualityKey, JSON.stringify(data));
    }
    function qualityScore(source, now = Date.now()) {
        const observations = (qualityData()[source] || []).filter(item => now - item.at < 14 * 86400000);
        if (!observations.length) return 0;
        const recent = observations.slice(-6);
        return recent.reduce((sum, item, index) => {
            const weight = (index + 1) / recent.length;
            return sum + weight * (item.started ? 10 - Math.min(item.firstFrameMs / 1000, 8) - Math.min(item.stalls * 2, 6) : -12);
        }, 0);
    }
    function matchingRecord(record, item) {
        const info = identity(item);
        if (normalize(record.title) !== normalize(info.title)) return false;
        if (record.sourceName === item.source_code && String(record.vod_id) === String(item.vod_id)) return true;
        return Boolean(record.movieYear && record.movieKind && record.movieYear === info.year && record.movieKind === info.kind);
    }
    // Version notes from the source (HD中字, TC, 更新至12集…) and how watchable each is:
    // 5 = 4K/蓝光/1080P, 4 = HD, 3 = 正片/unknown/episode progress, 1 = TC/TS/抢先 camera copies, 0 = trailers.
    const TRAILER_VERSION = /预告|花絮/;
    const CAMERA_VERSION = /(?:^|[^a-z])(?:hd)?(?:tc|ts|cam)(?:v\d+)?(?![a-z])|抢先|枪版|尝鲜/i;
    const TOP_VERSION = /4k|2160p|1080p|蓝光|原盘|杜比|(?:^|[^a-z])bd(?![a-z])/i;
    const HD_VERSION = /hd|高清|超清|720p/i;
    function versionLabel(item) {
        return String(item?.vod_remarks || '').replace(/\s+/g, ' ').trim().slice(0, 16);
    }
    function versionRank(item) {
        const label = versionLabel(item);
        if (TRAILER_VERSION.test(label)) return 0;
        if (CAMERA_VERSION.test(label)) return 1;
        if (TOP_VERSION.test(label)) return 5;
        if (HD_VERSION.test(label)) return 4;
        // Among series, a finished copy, then the one with more episodes, wins.
        if (/完结/.test(label)) return 3.9999;
        const episodes = Number(label.match(/(\d{1,4})\s*集/)?.[1] || 0);
        return 3 + Math.min(episodes, 9999) / 10000;
    }
    // Short category for a merged card: 4K / 蓝光 / HD / TC / 抢先版…; other notes as given.
    function versionTag(item) {
        const label = versionLabel(item);
        const rank = versionRank(item);
        if (!label) return '';
        if (rank === 0) return '预告';
        if (rank === 1) return /tc/i.test(label) ? 'TC' : /(?:^|[^a-z])(?:hd-?)?ts/i.test(label) ? 'TS' : '抢先版';
        if (rank === 5) return /4k|2160p/i.test(label) ? '4K' : /1080p/i.test(label) && !/蓝光|原盘|bd/i.test(label) ? '1080P' : '蓝光';
        if (rank === 4) return 'HD';
        return /正片/.test(label) ? '正片' : label;
    }
    // Distinct version categories of a merged result, best first; only the most complete episode note.
    function versionLabels(items) {
        const best = new Map();
        for (const item of items || []) {
            const tag = versionTag(item);
            if (tag && !(best.get(tag) >= versionRank(item))) best.set(tag, versionRank(item));
        }
        const ranked = [...best].sort((a, b) => b[1] - a[1]);
        const progress = ranked.find(([tag, rank]) => rank >= 3 && rank < 4 && tag !== '正片');
        return ranked.filter(entry => !(entry[1] >= 3 && entry[1] < 4 && entry[0] !== '正片') || entry === progress).map(([tag]) => tag);
    }
    function chooseCandidate(items, request, records = []) {
        const valid = items.filter(item => window.QuickPlay.logic.matches(item, request));
        const history = unfinishedHistory(records).find(record => valid.some(item => matchingRecord(record, item)));
        // The copy being watched first, then the best version, then the most reliable source.
        const value = item => (history && matchingRecord(history, item) && history.sourceName === item.source_code && String(history.vod_id) === String(item.vod_id) ? 100000 : 0) +
            Math.floor(versionRank(item)) * 1000 + (window.SourceAutopilot?.score(item.source_code) ?? qualityScore(item.source_code));
        return [...valid].sort((a, b) => value(b) - value(a))[0] || null;
    }
    function seriesStem(title, kind) {
        let stem = String(title || '').normalize('NFKC').trim();
        if (kind === 'tv') stem = stem.replace(/[\s·:：\-]*(?:第\s*)?[一二三四五六七八九十百零两\d]{1,4}季$/u, '').replace(/[\s·:：\-]*(?:season|s)\s*\d{1,3}$/i, '');
        else if (kind === 'movie') stem = stem.replace(/[\s·:：\-]*(?:第\s*)?[一二三四五六七八九十\d]{1,3}(?:部|集)?$/u, '');
        return normalize(stem);
    }
    function releaseValue(item) {
        const date = String(item.vod_pubdate || item.vod_year || item.year || '').match(/((?:19|20)\d{2})(?:[-/.年](\d{1,2}))?(?:[-/.月](\d{1,2}))?/);
        return date ? Number(date[1]) * 10000 + Number(date[2] || 0) * 100 + Number(date[3] || 0) : 99999999;
    }
    function franchiseRecommendations(items, current) {
        const stem = seriesStem(current.title, current.kind);
        if (stem.length < 2 || !['movie', 'tv'].includes(current.kind)) return [];
        const found = new Map();
        for (const item of items || []) {
            const info = identity(item);
            if (info.kind !== current.kind || seriesStem(info.title, info.kind) !== stem) continue;
            if (/解说|预告|花絮|剪辑/.test(`${info.title} ${item.type_name || ''}`)) continue;
            if (normalize(info.title) === normalize(current.title) && (!info.year || info.year === year(current.year))) continue;
            const key = [normalize(info.title), info.year, info.kind].join('|');
            if (!found.has(key)) found.set(key, item);
        }
        return [...found.values()].sort((a, b) => releaseValue(a) - releaseValue(b) ||
            String(a.vod_name).localeCompare(String(b.vod_name), 'zh-Hans-CN'));
    }
    window.LibreExperience = { groupResults, unfinishedHistory, watchLater, addWatchLater, removeWatchLater, recordQuality, recordStall, qualityScore, chooseCandidate, versionLabel, versionRank, versionTag, versionLabels, year, seriesStem, franchiseRecommendations };
})();
