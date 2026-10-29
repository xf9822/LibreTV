// Search result filters (kind / year / region) and sorting. Sources name
// things inconsistently ("国产动漫", "欧美剧", "记录片"; "大陆", "中国大陆",
// "美国 / 英国"), so values are normalised before they are compared.
(() => {
    const SORTS = [
        { value: 'relevance', label: '相关度' },
        { value: 'year', label: '年份最新' },
        { value: 'rating', label: '评分最高' },
        { value: 'updated', label: '最近更新' }
    ];
    const KIND_ORDER = ['电影', '剧集', '动漫', '综艺', '纪录片', '短剧', '其他'];
    const REGION_ALIASES = {
        中国大陆: '大陆', 中国内地: '大陆', 内地: '大陆', 国产: '大陆', 中国: '大陆',
        中国香港: '香港', 中国台湾: '台湾', 其它: '其他'
    };

    const normalizeText = value => String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');

    function kindOf(item) {
        const type = String(item?.type_name || '');
        if (/解说|预告|花絮/.test(type)) return '其他';
        if (/短剧/.test(type)) return '短剧';
        if (/动漫|动画|番剧/.test(type)) return '动漫';
        if (/综艺|晚会|真人秀/.test(type)) return '综艺';
        if (/纪录|记录/.test(type)) return '纪录片';
        if (/剧/.test(type)) return '剧集';
        if (/片|电影/.test(type)) return '电影';
        // Short-drama sites use genre names ("古装仙侠", "年代穿越"); fall back to the episode count.
        const episodes = String(item?.vod_play_url || '').split('$$$')[0].split('#').filter(entry => entry.includes('$')).length;
        if (episodes > 1 || /集/.test(String(item?.vod_remarks || ''))) return '剧集';
        if (episodes === 1) return '电影';
        return '其他';
    }

    function yearOf(item) {
        return String(item?.vod_year || '').match(/(?:19|20)\d{2}/)?.[0] || '';
    }

    function regionOf(item) {
        const first = String(item?.vod_area || '').split(/[\/,，、|\s]+/).map(part => part.trim()).find(Boolean) || '';
        return REGION_ALIASES[first] || first;
    }

    function ratingOf(item) {
        const value = Math.max(Number.parseFloat(item?.vod_douban_score) || 0, Number.parseFloat(item?.vod_score) || 0);
        return value > 0 && value <= 10 ? value : 0;
    }

    function updatedOf(item) {
        const time = Date.parse(String(item?.vod_time || '').replace(' ', 'T'));
        return Number.isFinite(time) ? time : 0;
    }

    // Facts about a merged group; the best value across its sources wins.
    function groupInfo(group) {
        const first = group[0] || {};
        return {
            kind: kindOf(first),
            year: yearOf(first),
            region: group.map(regionOf).find(Boolean) || '',
            rating: Math.max(0, ...group.map(ratingOf)),
            updated: Math.max(0, ...group.map(updatedOf)),
            title: first.vod_name || ''
        };
    }

    // 3: exact title, 2: starts with the query, 1: contains it, 0: matched another field.
    function relevanceOf(title, query) {
        const name = normalizeText(title);
        const q = normalizeText(query);
        if (!q) return 0;
        if (name === q) return 3;
        if (name.startsWith(q)) return 2;
        return name.includes(q) ? 1 : 0;
    }

    function defaultFilter() {
        return { kind: '', year: '', region: '', sort: 'relevance' };
    }

    function countValues(infos, key) {
        const counts = new Map();
        for (const info of infos) if (info[key]) counts.set(info[key], (counts.get(info[key]) || 0) + 1);
        return counts;
    }

    // Choices offered for the current results, with counts.
    function options(groups) {
        const infos = groups.map(groupInfo);
        const kinds = countValues(infos, 'kind');
        const years = countValues(infos, 'year');
        const regions = countValues(infos, 'region');
        return {
            kinds: KIND_ORDER.filter(kind => kinds.has(kind)).map(kind => ({ value: kind, count: kinds.get(kind) })),
            years: [...years].sort((a, b) => Number(b[0]) - Number(a[0])).map(([value, count]) => ({ value, count })),
            regions: [...regions].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh')).map(([value, count]) => ({ value, count })),
            hasRatings: infos.some(info => info.rating > 0),
            hasUpdates: infos.some(info => info.updated > 0)
        };
    }

    // Returns [{ group, index }] so callers keep addressing groups by their original index.
    function apply(groups, query, filter = defaultFilter()) {
        const entries = groups.map((group, index) => ({ group, index, info: groupInfo(group) }))
            .filter(({ info }) => (!filter.kind || info.kind === filter.kind) &&
                (!filter.year || info.year === filter.year) &&
                (!filter.region || info.region === filter.region));
        // Same tier: the title closest in length to the query first ("庆余年 第二季" before a
        // 30-character spin-off), then newer, then the one available from more sources.
        const byRelevance = (a, b) =>
            relevanceOf(b.info.title, query) - relevanceOf(a.info.title, query) ||
            normalizeText(a.info.title).length - normalizeText(b.info.title).length ||
            Number(b.info.year || 0) - Number(a.info.year || 0) ||
            b.group.length - a.group.length ||
            a.index - b.index;
        const comparators = {
            relevance: byRelevance,
            year: (a, b) => Number(b.info.year || 0) - Number(a.info.year || 0) || byRelevance(a, b),
            rating: (a, b) => b.info.rating - a.info.rating || byRelevance(a, b),
            updated: (a, b) => b.info.updated - a.info.updated || byRelevance(a, b)
        };
        return entries.sort(comparators[filter.sort] || byRelevance).map(({ group, index, info }) => ({ group, index, rating: info.rating }));
    }

    function isFiltered(filter) {
        return Boolean(filter.kind || filter.year || filter.region);
    }

    window.SearchFilter = { SORTS, kindOf, yearOf, regionOf, ratingOf, relevanceOf, defaultFilter, options, apply, isFiltered };
})();
