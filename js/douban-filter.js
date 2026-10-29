// Douban "选影视" filters for the home page: genre, region, decade/year and
// sort can be combined (e.g. 欧美 + 2026 + 高分优先). Uses the same rexxar
// recommend API as movie.douban.com/explore; requests go through /proxy/.
(() => {
    const STORAGE_KEY = 'doubanFilterV1';
    const PAGE_SIZE = 24;

    const SORTS = [
        { value: 'T', label: '综合排序' },
        { value: 'U', label: '近期热度' },
        { value: 'R', label: '最新上映' },
        { value: 'S', label: '高分优先' }
    ];
    const MOVIE_GENRES = ['喜剧', '爱情', '动作', '科幻', '动画', '悬疑', '犯罪', '惊悚', '冒险', '音乐', '历史', '奇幻', '恐怖', '战争', '传记', '歌舞', '武侠', '灾难', '西部', '纪录片', '短片'];
    const TV_GENRES = {
        电视剧: ['喜剧', '爱情', '悬疑', '动画', '武侠', '古装', '家庭', '犯罪', '科幻', '恐怖', '历史', '战争', '动作', '冒险', '传记', '剧情', '奇幻', '惊悚', '灾难', '歌舞', '音乐'],
        综艺: ['真人秀', '脱口秀', '音乐', '歌舞']
    };
    const MOVIE_REGIONS = ['华语', '欧美', '韩国', '日本', '中国大陆', '美国', '香港', '台湾', '英国', '法国', '德国', '意大利', '西班牙', '印度', '泰国', '俄罗斯', '加拿大', '澳大利亚', '爱尔兰', '瑞典', '巴西', '丹麦'];
    const TV_REGIONS = ['华语', '欧美', '国外', '韩国', '日本', '中国大陆', '香港', '美国', '英国', '泰国', '台湾', '意大利', '法国', '德国', '西班牙', '俄罗斯', '瑞典', '巴西', '丹麦', '印度', '加拿大', '爱尔兰', '澳大利亚'];
    const DECADES = ['2020年代', '2010年代', '2000年代', '90年代', '80年代', '70年代', '60年代', '更早'];

    function yearOptions(now = new Date()) {
        const current = now.getFullYear();
        return [...Array.from({ length: 7 }, (_, i) => String(current - i)), ...DECADES];
    }

    function defaultFilter(kind) {
        return kind === 'tv'
            ? { format: '电视剧', genre: '', region: '', year: '', sort: 'T' }
            : { genre: '', region: '', year: '', sort: 'T' };
    }

    // Rows shown in the panel; each row edits one key of the filter.
    function rows(kind, filter, now) {
        const all = [{ value: '', label: '全部' }];
        const list = values => values.map(value => ({ value, label: value }));
        const result = [];
        if (kind === 'tv') {
            result.push({ key: 'format', label: '形式', options: list(Object.keys(TV_GENRES)) });
            result.push({ key: 'genre', label: '类型', options: [...all, ...list(TV_GENRES[filter.format] || TV_GENRES.电视剧)] });
            result.push({ key: 'region', label: '地区', options: [...all, ...list(TV_REGIONS)] });
        } else {
            result.push({ key: 'genre', label: '类型', options: [...all, ...list(MOVIE_GENRES)] });
            result.push({ key: 'region', label: '地区', options: [...all, ...list(MOVIE_REGIONS)] });
        }
        result.push({ key: 'year', label: '年代', options: [...all, ...list(yearOptions(now))] });
        result.push({ key: 'sort', label: '排序', options: SORTS });
        return result;
    }

    function normalizeFilter(kind, value, now) {
        const filter = { ...defaultFilter(kind), ...(value && typeof value === 'object' ? value : {}) };
        for (const row of rows(kind, filter, now)) {
            if (!row.options.some(option => option.value === filter[row.key])) filter[row.key] = defaultFilter(kind)[row.key];
        }
        return filter;
    }

    function updateFilter(kind, filter, key, value, now) {
        const next = { ...filter, [key]: value };
        // Variety shows have their own genres; a drama genre does not carry over.
        if (key === 'format') next.genre = '';
        return normalizeFilter(kind, next, now);
    }

    function readState(storage = window.localStorage) {
        let saved = {};
        try { saved = JSON.parse(storage.getItem(STORAGE_KEY) || '{}') || {}; } catch (error) { saved = {}; }
        return {
            open: saved.open === true,
            movie: normalizeFilter('movie', saved.movie),
            tv: normalizeFilter('tv', saved.tv)
        };
    }

    function writeState(state, storage = window.localStorage) {
        try { storage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (error) { /* storage full or blocked */ }
    }

    function buildRecommendUrl(kind, filter, start = 0, count = PAGE_SIZE) {
        const categories = {};
        if (filter.genre) categories['类型'] = filter.genre;
        if (kind === 'tv') categories['形式'] = filter.format || '电视剧';
        if (filter.region) categories['地区'] = filter.region;
        const tags = [filter.genre || (kind === 'tv' ? filter.format || '电视剧' : ''), filter.region, filter.year].filter(Boolean);
        const params = new URLSearchParams({
            refresh: '0',
            start: String(start),
            count: String(count),
            selected_categories: JSON.stringify(categories),
            uncollect: 'false',
            score_range: '0,10',
            tags: tags.join(','),
            sort: filter.sort || 'T'
        });
        return `https://m.douban.com/rexxar/api/v2/${kind === 'tv' ? 'tv' : 'movie'}/recommend?${params}`;
    }

    // "2026 / 美国 英国 / 剧情 科幻 / 导演 / 演员" -> "2026 · 美国"
    function shortMeta(item) {
        const parts = String(item.card_subtitle || '').split(' / ').map(part => part.trim()).filter(Boolean);
        const year = item.year || (/^\d{4}$/.test(parts[0] || '') ? parts[0] : '');
        const region = (parts[1] || '').split(/\s+/)[0] || '';
        return [year, region].filter(Boolean).join(' · ');
    }

    function mapRecommend(data) {
        const items = Array.isArray(data?.items) ? data.items : [];
        const subjects = items
            .filter(item => (item.type === 'movie' || item.type === 'tv') && item.title && item.id)
            .map(item => {
                const rating = Number(item.rating?.value);
                return {
                    id: String(item.id),
                    title: String(item.title),
                    rate: rating > 0 ? rating.toFixed(1) : '',
                    cover: item.pic?.normal || item.pic?.large || '',
                    url: `https://movie.douban.com/subject/${encodeURIComponent(item.id)}/`,
                    year: item.year ? String(item.year) : '',
                    meta: shortMeta(item)
                };
            });
        const total = Number(data?.total);
        return { subjects, total: Number.isFinite(total) ? total : 0, received: items.length };
    }

    function describe(kind, filter) {
        const parts = [];
        if (kind === 'tv') parts.push(filter.format || '电视剧');
        for (const key of ['genre', 'region', 'year']) if (filter[key]) parts.push(filter[key]);
        const sort = SORTS.find(item => item.value === filter.sort);
        if (sort && sort.value !== 'T') parts.push(sort.label);
        return parts.join(' · ');
    }

    function renderPanel(container, kind, filter, onChange, now) {
        container.replaceChildren();
        for (const row of rows(kind, filter, now)) {
            const line = document.createElement('div');
            line.className = 'douban-filter-row';
            line.setAttribute('role', 'group');
            line.setAttribute('aria-label', row.label);
            const label = document.createElement('span');
            label.className = 'douban-filter-label';
            label.textContent = row.label;
            const options = document.createElement('div');
            options.className = 'douban-filter-options';
            for (const option of row.options) {
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = option.label;
                const active = filter[row.key] === option.value;
                button.className = active ? 'is-active' : '';
                button.setAttribute('aria-pressed', String(active));
                button.addEventListener('click', () => {
                    if (!active) onChange(updateFilter(kind, filter, row.key, option.value, now));
                });
                options.appendChild(button);
            }
            line.append(label, options);
            container.appendChild(line);
            // 手机上每行横向滚动：让已选项露出来
            const active = options.querySelector('.is-active');
            if (active && options.scrollWidth > options.clientWidth) {
                options.scrollLeft = Math.max(0, active.offsetLeft - options.offsetLeft - 12);
            }
        }
    }

    window.DoubanFilter = {
        PAGE_SIZE,
        SORTS,
        GENRES: { movie: MOVIE_GENRES, tv: TV_GENRES.电视剧 },
        REGIONS: { movie: MOVIE_REGIONS, tv: TV_REGIONS },
        yearOptions,
        defaultFilter,
        rows,
        normalizeFilter,
        updateFilter,
        readState,
        writeState,
        buildRecommendUrl,
        mapRecommend,
        describe,
        renderPanel
    };
})();
