// 弹幕：按片名在 360 影视找到同一部作品在腾讯视频 / 爱奇艺 / 芒果 TV 的对应集，取那一集的公开弹幕。
// Comments are fetched from the platforms' public, unauthenticated endpoints: Tencent and iQiyi
// directly (they allow cross-origin reads), Mango TV through the site's proxy. Youku and
// Bilibili are not used: Youku needs signed requests and 360 rarely lists Bilibili.
(() => {
    const SEARCH_URL = 'https://api.so.360kan.com/index?force_v=1&from=&pageno=1&v_ap=1&tab=all&kw=';
    const SITE_NAMES = { qq: '腾讯视频', qiyi: '爱奇艺', imgo: '芒果TV' };
    const SITE_ORDER = ['qq', 'qiyi', 'imgo'];
    const CATEGORY = { 1: 'movie', 2: 'tv', 3: 'variety', 4: 'anime' };
    const CONCURRENCY = 8;
    const MAX_TEXT = 40;
    const ENOUGH = 100; // comments that make a platform worth stopping at

    const normalize = value => String(value || '').normalize('NFKC').toLowerCase()
        .replace(/<[^>]+>/g, '').replace(/[\s·・:：,，.。!！?？'"“”‘’《》「」【】()（）\-—_]+/g, '');
    const yearOf = value => Number(String(value || '').match(/(?:19|20)\d{2}/)?.[0] || 0);

    // The 360 row for this title: same normalized title (or one containing the other with the same
    // year), a compatible category, and the release year within one year when both are known.
    function pickRow(rows, { title, year, kind }) {
        const want = normalize(title);
        const wantYear = yearOf(year);
        let best = null;
        for (const row of Array.isArray(rows) ? rows : []) {
            const name = normalize(row?.titleTxt || row?.title);
            if (!name || !want) continue;
            const category = CATEGORY[row.cat_id] || '';
            if (kind === 'movie' && !['movie', 'anime'].includes(category)) continue;
            if (kind === 'tv' && category === 'movie') continue;
            const rowYear = yearOf(row.year);
            const yearOk = !wantYear || !rowYear || Math.abs(wantYear - rowYear) <= 1;
            let score = 0;
            if (name === want && yearOk) score = 3;
            else if ((name.includes(want) || want.includes(name)) && wantYear && rowYear && Math.abs(wantYear - rowYear) <= 1 && Math.min(name.length, want.length) >= 2) score = 2;
            if (!score) continue;
            if (sourceFor(row, 0)) score += 0.5;
            if (!best || score > best.score) best = { row, score };
        }
        return best?.row || null;
    }

    // Play pages on supported platforms for the given episode (0-based), best first. Series list one
    // platform per episode; films may be on several, tried in turn until one has comments.
    function sourcesFor(row, index) {
        const series = Array.isArray(row?.seriesPlaylinks) ? row.seriesPlaylinks : [];
        if (series.length) {
            const item = series[index];
            const parsed = parseSourceUrl(typeof item === 'string' ? item : item?.url);
            return parsed ? [parsed] : [];
        }
        if (index > 0) return [];
        const links = row?.playlinks || {};
        return SITE_ORDER.map(site => links[site] && parseSourceUrl(links[site])).filter(Boolean);
    }

    const sourceFor = (row, index) => sourcesFor(row, index)[0] || null;

    function parseSourceUrl(url) {
        const text = String(url || '');
        let match = text.match(/v\.qq\.com\/x\/(?:cover\/[^/?#]+|page)\/([a-z0-9]+)\.html/i);
        if (match) return { site: 'qq', vid: match[1] };
        match = text.match(/iqiyi\.com\/v_([a-z0-9]+)\.html/i);
        if (match) return { site: 'qiyi', id: match[1] };
        match = text.match(/mgtv\.com\/b\/(\d+)\/(\d+)\.html/i);
        if (match) return { site: 'imgo', cid: match[1], vid: match[2] };
        return null;
    }

    // ---- 综艺：按集名对应到平台上的那一期 ----
    // 360 给综艺的是每期的列表（第 3 期上、加更版、抢鲜版……），资源站的集名又各写各的：
    // 「第20261029期上」「20261029第3期上」「20261029上」「第3期上」「20261022-01」。
    // 从集名里认出播出日期、第几期、上 / 下、版本（正片 / 加更 / 抢鲜 / 沉浸 / 花絮），再找最符合的一期。
    const EPISODE_KINDS = [['immersive', /沉浸/], ['plus', /加更|plus/i], ['preview', /抢鲜|抢先|先导/], ['extra', /纯享|彩蛋|花絮|特辑|看点|直拍|精华|预告/]];

    function episodeFeatures(text) {
        const raw = String(text || '').normalize('NFKC');
        const date = raw.match(/(20\d{2})[-./年]?([01]\d)[-./月]?([0-3]\d)/);
        const issue = raw.replace(/20\d{2}[-./年]?[01]\d[-./月]?[0-3]\d/g, ' ').match(/第\s*(\d{1,3})\s*[期集]|EP\s*0*(\d{1,3})/i);
        const part = raw.match(/(?:期|版|\d|[)）])\s*[（(]?([上中下])(?=[)）]|\s|[:：]|$)/);
        const seq = raw.match(/20\d{6}\s*[-_]\s*0*(\d{1,2})(?!\d)/);
        const kind = (EPISODE_KINDS.find(([, pattern]) => pattern.test(raw)) || ['main'])[0];
        return {
            date: date ? date[1] + date[2] + date[3] : '',
            issue: issue ? Number(issue[1] || issue[2]) : 0,
            part: part ? part[1] : '',
            seq: seq ? Number(seq[1]) : 0,
            kind
        };
    }

    const dayNumber = date => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8))) / 86400000;

    // candidates: [{ features, order, seconds?, ... }]；返回最符合的一项，信息不够或对不上时返回 null。
    // duration（秒）用来在同一天的几期里挑时长最接近的。
    function matchEpisode(name, candidates, duration = 0) {
        const want = episodeFeatures(name);
        if (!want.date && !want.issue && !want.part) return null;
        let best = [];
        let bestScore = 0;
        for (const candidate of candidates) {
            const got = candidate.features;
            if (got.kind !== want.kind) continue;
            let score = 1;
            if (want.issue && got.issue) {
                if (want.issue !== got.issue) continue;
                score += 4;
            }
            if (want.date && got.date) {
                const gap = Math.abs(dayNumber(want.date) - dayNumber(got.date));
                if (gap > 1) continue;
                score += gap === 0 ? 3 : 1;
            }
            if (want.part && got.part) {
                if (want.part !== got.part) continue;
                score += 2;
            } else if (want.part !== got.part) {
                score -= 1;
            }
            if (score > bestScore) { bestScore = score; best = [candidate]; }
            else if (score === bestScore) best.push(candidate);
        }
        if (!best.length) return null;
        best.sort((a, b) => a.order - b.order);
        if (best.length === 1) return best[0];
        // 同一天有几期（「20261022-01」「20261022-02」）：按播出顺序取第几个
        if (want.seq) return best[want.seq - 1] || null;
        // 资源站标了上 / 下、平台上是第 1 期 / 第 2 期：上取第一个，下取最后一个
        if (want.part && best.every(candidate => !candidate.features.part)) {
            return want.part === '上' ? best[0] : want.part === '下' ? best[best.length - 1] : best[1] || null;
        }
        // 还分不出来：挑时长最接近的
        if (duration > 0 && best.every(candidate => candidate.seconds > 0)) {
            return best.reduce((a, b) => (Math.abs(b.seconds - duration) < Math.abs(a.seconds - duration) ? b : a));
        }
        return want.issue || want.part ? best[0] : null;
    }

    // 芒果：从任意一期的视频 ID 拿到整档节目的分期（标题里有第几期）和每月节目单（有播出日期）
    const mgtvLists = new Map();
    async function mgtvEpisodes(cid, vid, signal) {
        const key = `${cid}`;
        if (mgtvLists.has(key)) return mgtvLists.get(key);
        const headers = API_CONFIG.search.headers;
        const list = await window.fetchVodApiJson(`https://pcweb.api.mgtv.com/episode/list?video_id=${vid}&page=1&size=50`, headers, signal);
        const items = Array.isArray(list?.data?.list) ? list.data.list : [];
        const dates = new Map();
        const months = (await window.fetchVodApiJson(`https://pcweb.api.mgtv.com/variety/showlist?collection_id=${cid}&month=&page=1`, headers, signal).catch(() => null))?.data;
        const monthIds = (months?.tab_m || []).map(item => item.m).filter(Boolean).slice(0, 12);
        const pages = [months, ...await Promise.all(monthIds.map(month => window.fetchVodApiJson(
            `https://pcweb.api.mgtv.com/variety/showlist?collection_id=${cid}&month=${month}&page=1`, headers, signal).then(r => r?.data).catch(() => null)))];
        for (const page of pages) for (const item of page?.list || []) {
            if (/^\d{4}-\d{2}-\d{2}$/.test(item.t2 || '')) dates.set(String(item.video_id), item.t2.replace(/-/g, ''));
        }
        const showTitle = (text, title) => String(text || '').replace(title || '', '').split(/[:：]/)[0];
        const episodes = items.map((item, order) => {
            const short = String(item.t2 || item.t1 || '').split(/[:：]/)[0];
            const long = showTitle(item.t3, item.clipName || '').replace(/^\s*\S*?\s/, '');
            const features = episodeFeatures(`${short} ${long}`);
            const date = dates.get(String(item.video_id));
            if (date) features.date = date;
            const [minutes, secs] = String(item.time || '').split(':').map(Number);
            return { features, order, vid: String(item.video_id), name: short, seconds: minutes * 60 + (secs || 0) || 0, intact: String(item.isIntact) === '1' };
        });
        mgtvLists.set(key, episodes);
        return episodes;
    }

    // 综艺的来源：每个平台按集名找到那一期
    async function varietySources(row, episodeName, signal, duration = 0) {
        const sources = [];
        for (const site of SITE_ORDER) {
            const entries = row?.playlinks?.[site];
            if (!Array.isArray(entries) || !entries.length) continue;
            if (site === 'imgo') {
                const first = parseSourceUrl(entries[0]?.url);
                if (!first) continue;
                const episodes = (await mgtvEpisodes(first.cid, first.vid, signal).catch(() => [])).filter(item => item.intact);
                const found = matchEpisode(episodeName, episodes, duration);
                if (found) sources.push({ site, cid: first.cid, vid: found.vid, seconds: found.seconds });
                continue;
            }
            const candidates = entries.map((entry, order) => {
                const features = episodeFeatures(`${entry.name || ''} ${entry.title || ''}`);
                if (!features.date && /^20\d{6}$/.test(String(entry.period_alias || ''))) features.date = String(entry.period_alias);
                return { features, order: -Number(entry.playlink_num || order), entry };
            });
            const found = matchEpisode(episodeName, candidates);
            const parsed = found && parseSourceUrl(found.entry.url);
            if (parsed) sources.push(parsed);
        }
        return sources;
    }

    // 平台表情代码（腾讯 [狗头]、[打卡-打][打卡-卡]，爱奇艺、芒果类似）在网页里没有对应图片，
    // 换成意思相近的 Unicode 表情；认不出的代码去掉，不再以方括号文字显示。
    const EMOTES = {
        '狗头': '🐶', '吃瓜': '🍉', '彩': '🎉', '撒花': '🌸', '叉手礼': '🙏', '一起冲': '🚀', '打call了': '📣', '打call': '📣',
        '666啊': '👍', '666': '👍', '赞': '👍', '点赞': '👍', '鼓掌': '👏', '加油': '💪', '奋斗': '💪', '打卡': '✅', '签到': '✅',
        '准时': '⏰', '上头': '🤯', '加更': '➕', '富翁': '💰', '金币': '🪙', '红包': '🧧', '皇冠': '👑', '放大镜': '🔍',
        '亲': '😘', '亲亲': '😘', '爱心': '❤️', '比心': '🫶', '心': '❤️', '心碎': '💔', '破防': '💔', '意难平': '😣',
        '泪奔': '😭', '大哭': '😭', '哭': '😭', '流泪': '😢', '委屈': '🥺', '可怜': '🥺', '憨笑': '😄', '微笑': '🙂',
        '偷笑': '🤭', '大笑': '😆', '笑哭': '😂', '笑死我了': '🤣', '哈哈': '😆', '坏笑': '😏', '害羞': '😊', '色': '😍',
        '发呆': '😶', '呆住': '😳', '惊讶': '😲', '吃惊': '😲', '握草': '😱', '震惊': '😱', '我裂开了': '💥', '裂开': '💥',
        '擦汗': '😅', '汗': '😅', '尴尬': '😅', '没眼看': '🙈', '捂脸': '🤦', '你有事吗': '🤨', '我不理解': '🤔', '疑问': '❓',
        '思考': '🤔', '无语': '😑', '白眼': '🙄', '生气': '😠', '发怒': '😡', '怒': '😡', '酷': '😎', '墨镜': '😎', '睡': '😴',
        '晕': '😵', '吐': '🤮', '啊啊啊': '😫', '蹲': '👀', '围观': '👀', '喏': '👉', '准奏': '📜', '某': '🤫', '嘘': '🤫',
        '好的': '👌', 'OK': '👌', '胜利': '✌️', '握手': '🤝', '抱抱': '🤗', '火': '🔥', '牛': '🐮', '强': '💪', '玫瑰': '🌹',
        '6周年': '🎂', '生日快乐': '🎂', '马年大吉': '🐴🧧', '新年快乐': '🧧', '过年好': '🧧', '福': '🧧', '哟哟哟': '😜'
    };
    const EMOTE_HINTS = [
        [/笑/, '😂'], [/哭|泪/, '😭'], [/赞|棒|666/, '👍'], [/爱|心/, '❤️'], [/怒|气/, '😠'], [/惊|吓/, '😲'], [/晕/, '😵'],
        [/汗/, '😅'], [/酷/, '😎'], [/吃|饿/, '😋'], [/睡|困/, '😴'], [/花/, '🌸'], [/火|燃/, '🔥'], [/钱|金|币|富/, '💰'],
        [/狗/, '🐶'], [/猫/, '🐱'], [/马/, '🐴'], [/牛/, '🐮'], [/年|春|福/, '🧧'], [/冲|飞/, '🚀'], [/打卡|签到/, '✅']
    ];
    const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

    function decodeEntities(text) {
        return String(text || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
            if (code[0] === '#') {
                const point = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
                try { return Number.isFinite(point) && point > 0 ? String.fromCodePoint(point) : match; } catch { return match; }
            }
            return NAMED_ENTITIES[code.toLowerCase()] ?? match;
        });
    }

    function emoteFor(code) {
        let name = code.trim().replace(/N$/, '');
        // [打卡-打][打卡-卡]：一个表情拆成两个代码，只在第一个出现时显示
        const dash = name.indexOf('-');
        if (dash > 0) {
            const base = name.slice(0, dash);
            const part = name.slice(dash + 1);
            if (part && base.indexOf(part) > 0) return '';
            name = base;
        }
        if (EMOTES[name]) return EMOTES[name];
        for (const [pattern, emoji] of EMOTE_HINTS) if (pattern.test(name)) return emoji;
        return '';
    }

    function cleanText(text) {
        return decodeEntities(text)
            .replace(/\[\/?em\]/gi, '')
            // 只处理平台表情（含中文或在表里的代码）；[0]、[ok] 这类普通方括号原样保留
            .replace(/\[([^\[\]\s]{1,12})\]/g, (match, code) => (/[\u4e00-\u9fff]/.test(code) || EMOTES[code] ? emoteFor(code) : match))
            .replace(/\s+/g, ' ')
            .trim();
    }

    // Busy scenes carry dozens of comments a second: keep the most liked ones, at most `perSecond`
    // in each second, drop very long ones and repeats of the same text close together.
    function thin(comments, perSecond) {
        const buckets = new Map();
        for (const item of comments) {
            const text = cleanText(item.text);
            if (!text || text.length > MAX_TEXT || !Number.isFinite(item.time) || item.time < 0) continue;
            const second = Math.floor(item.time);
            if (!buckets.has(second)) buckets.set(second, []);
            buckets.get(second).push({ ...item, text });
        }
        const recent = new Map();
        const result = [];
        for (const second of [...buckets.keys()].sort((a, b) => a - b)) {
            const picked = buckets.get(second).sort((a, b) => (b.likes || 0) - (a.likes || 0));
            let kept = 0;
            for (const item of picked) {
                if (kept >= perSecond) break;
                const key = normalize(item.text);
                if (recent.has(key) && second - recent.get(key) < 10) continue;
                recent.set(key, second);
                result.push({ text: item.text, time: item.time, color: item.color, mode: 0 });
                kept++;
            }
        }
        return result;
    }

    function color(value) {
        const hex = String(value || '').replace(/^#/, '').toLowerCase();
        return /^[0-9a-f]{6}$/.test(hex) && hex !== 'ffffff' ? `#${hex}` : undefined;
    }

    function parseIqiyiXml(text) {
        const items = [];
        for (const block of String(text).split('<bulletInfo>').slice(1)) {
            const field = name => block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1] ?? '';
            const content = field('content').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
            items.push({ text: content, time: Number(field('showTime')), color: color(field('color')), likes: Number(field('likeCount')) || 0 });
        }
        return items;
    }

    // Runs tasks a few at a time; onEach receives every result as it arrives.
    async function pool(tasks, limit, signal, onEach) {
        const results = new Array(tasks.length);
        let next = 0;
        await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, async () => {
            while (next < tasks.length) {
                if (signal?.aborted) return;
                const index = next++;
                try { results[index] = await tasks[index](); } catch { results[index] = null; }
                if (results[index]) onEach?.(results[index]);
            }
        }));
        return results;
    }

    // Segment start times in the order to fetch them: nearest to where playback is first.
    function nearestFirst(starts, from) {
        return starts.map((start, index) => ({ start, index }))
            .sort((a, b) => Math.abs(a.start - from) - Math.abs(b.start - from) || a.start - b.start)
            .map(item => item.index);
    }

    async function getJson(url, signal) {
        const response = await fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
    }

    const qqItems = page => (page?.barrage_list || []).map(item => {
        let style = {};
        try { style = JSON.parse(item.content_style || '{}') || {}; } catch { style = {}; }
        return { text: item.content, time: Number(item.time_offset) / 1000, color: color(style.color), likes: Number(item.up_count) || 0 };
    });

    async function loadQq({ vid }, { signal, from, onItems }) {
        const base = await getJson(`https://dm.video.qq.com/barrage/base/${vid}`, signal);
        const segments = Object.values(base?.segment_index || {}).sort((a, b) => Number(a.segment_start) - Number(b.segment_start));
        const order = nearestFirst(segments.map(segment => Number(segment.segment_start) / 1000), from);
        const pages = await pool(order.map(i => () => getJson(`https://dm.video.qq.com/barrage/segment/${vid}/${segments[i].segment_name}`, signal).then(qqItems)), CONCURRENCY, signal, onItems);
        return pages.flat().filter(Boolean);
    }

    async function loadQiyi({ id }, { signal, duration, from, onItems }) {
        const response = await fetch(`https://pcw-api.iq.com/api/decode/${id}?platformId=3&modeCode=intl&langCode=sg`, { signal, credentials: 'omit' });
        // Keep the id as text: some exceed the safe integer range of JSON numbers.
        const tvid = (await response.text()).match(/"data"\s*:\s*"?(\d{5,})/)?.[1];
        if (!tvid) return [];
        const files = Math.max(1, Math.ceil((duration || 7200) / 300));
        const path = `https://cmts.iqiyi.com/bullet/${tvid.slice(-4, -2)}/${tvid.slice(-2)}/${tvid}_300_`;
        const order = nearestFirst(Array.from({ length: files }, (_, i) => i * 300), from);
        const pages = await pool(order.map(i => async () => {
            const file = await fetch(`${path}${i + 1}.z`, { signal, credentials: 'omit' });
            if (!file.ok) return [];
            const stream = file.body.pipeThrough(new DecompressionStream('deflate'));
            return parseIqiyiXml(await new Response(stream).text());
        }), CONCURRENCY, signal, onItems);
        return pages.flat().filter(Boolean);
    }

    async function loadMgtv({ cid, vid }, { signal, duration, from, onItems }) {
        const minutes = Math.max(1, Math.ceil((duration || 7200) / 60));
        const order = nearestFirst(Array.from({ length: minutes }, (_, i) => i * 60), from);
        const pages = await pool(order.map(i => () => window.fetchVodApiJson(
            `https://galaxy.bz.mgtv.com/rdbarrage?version=3.0.0&vid=${vid}&abroad=0&pid=0&os&uuid&deviceid&cid=${cid}&ticket&time=${i * 60000}&mac&platform=0`,
            API_CONFIG.search.headers, signal).then(page => (page?.data?.items || []).map(item => ({
            text: item.content, time: Number(item.time) / 1000, likes: Number(item.up) || 0
        })))), CONCURRENCY, signal, onItems);
        return pages.flat().filter(Boolean);
    }

    const LOADERS = { qq: loadQq, qiyi: loadQiyi, imgo: loadMgtv };

    // ---- 资源站插播的广告：弹幕时间按平台正片走，视频里多出来的广告段要跳过 ----
    // blocks 是播放列表里被 #EXT-X-DISCONTINUITY 隔开的各段 { start, duration }（秒）。
    // 视频比平台正片长出 extra 秒时，找出长度加起来正好是 extra 的几个短段（单段不超过 90 秒），就是广告。
    // 凑不准（误差超过 3 秒）就不猜，返回空数组，交给手动校准。
    const MAX_AD_BLOCK = 90;
    const AD_TOLERANCE = 3;
    function adBreaks(blocks, contentSeconds) {
        const list = (Array.isArray(blocks) ? blocks : []).filter(block => block.duration > 0);
        const total = list.reduce((sum, block) => sum + block.duration, 0);
        const extra = total - contentSeconds;
        if (!(contentSeconds > 0) || list.length < 2 || extra < AD_TOLERANCE || extra > total * 0.3) return [];
        const candidates = list.filter(block => block.duration <= MAX_AD_BLOCK)
            .sort((a, b) => a.duration - b.duration).slice(0, 14);
        let best = null;
        for (let mask = 1; mask < (1 << candidates.length); mask++) {
            let sum = 0;
            let count = 0;
            for (let i = 0; i < candidates.length; i++) if (mask & (1 << i)) { sum += candidates[i].duration; count++; }
            const error = Math.abs(sum - extra);
            if (!best || error < best.error - 0.01 || (Math.abs(error - best.error) <= 0.01 && count < best.count)) best = { mask, error, count };
        }
        if (!best || best.error > AD_TOLERANCE) return [];
        return candidates.filter((_, i) => best.mask & (1 << i))
            .map(block => ({ start: block.start, duration: block.duration }))
            .sort((a, b) => a.start - b.start);
    }

    // 平台正片里的第 t 秒在视频里是第几秒：每遇到一段排在它前面的广告就往后推
    function videoTime(t, breaks) {
        let shifted = t;
        for (const ad of breaks || []) {
            if (ad.start <= shifted) shifted += ad.duration;
            else break;
        }
        return shifted;
    }

    // 360 search results per title, kept for the session: every episode of a series needs the same
    // rows, and the search sometimes answers with no rows at all, so empty answers are retried.
    const searches = new Map();
    async function searchRows(title, signal) {
        const key = normalize(title);
        if (searches.has(key)) return searches.get(key);
        let rows = [];
        for (let attempt = 0; attempt < 3 && !rows.length; attempt++) {
            if (attempt) await new Promise(resolve => setTimeout(resolve, 1500 * attempt));
            if (signal?.aborted) return [];
            const found = (await getJson(SEARCH_URL + encodeURIComponent(title), signal).catch(() => null))?.data?.longData?.rows;
            rows = Array.isArray(found) ? found : [];
        }
        if (rows.length) searches.set(key, rows);
        return rows;
    }

    // Find and load the comments of one episode. Resolves { raw, site, siteName, matched, seconds } or null
    // (seconds: the platform's runtime of the episode when known, 0 otherwise);
    // `thin` picks what is shown, so a density change needs no new download. onPartial gets the same
    // shape while segments are still arriving (those near `from`, the playback position, come first).
    async function load({ title, year, kind, index = 0, episodeName = '', duration = 0, from = 0, signal, onPartial }) {
        if (!title || typeof DecompressionStream === 'undefined') return null;
        const rows = await searchRows(title, signal);
        let row = pickRow(rows, { title, year, kind });
        // 综艺的「沉浸版」在平台上是另一档节目
        if (row && /沉浸/.test(episodeName)) {
            const immersive = rows.find(other => other !== row && /沉浸/.test(other?.titleTxt || '') && normalize(other.titleTxt).startsWith(normalize(title)));
            if (immersive) row = immersive;
            episodeName = episodeName.replace(/沉浸版?/g, '');
        }
        if (!row) return null;
        const isVariety = SITE_ORDER.some(site => Array.isArray(row.playlinks?.[site]));
        const sources = isVariety ? await varietySources(row, episodeName, signal, duration) : sourcesFor(row, index);
        // A platform with only a handful of comments is not enough: try the next and keep the fullest.
        let best = null;
        for (const source of sources) {
            const meta = { site: source.site, siteName: SITE_NAMES[source.site], matched: row.titleTxt };
            const partial = [];
            const onItems = items => {
                partial.push(...items);
                if (partial.length && !best) onPartial?.({ ...meta, raw: partial.slice() });
            };
            const raw = await LOADERS[source.site](source, { signal, duration, from, onItems }).catch(() => []);
            if (signal?.aborted) return null;
            if (raw.length > (best?.raw.length || 0)) best = { ...meta, raw, source };
            if (raw.length >= ENOUGH) break;
        }
        if (!best) return null;
        // 平台正片多长（芒果有），用来认出资源站插播的广告
        let seconds = best.source.seconds || 0;
        if (!seconds && best.site === 'imgo') {
            const list = await mgtvEpisodes(best.source.cid, best.source.vid, signal).catch(() => []);
            seconds = list.find(item => item.vid === String(best.source.vid))?.seconds || 0;
        }
        const result = { ...best, seconds };
        delete result.source;
        return result;
    }

    window.Danmaku = { load, thin, SITE_NAMES, logic: { adBreaks, videoTime, episodeFeatures, matchEpisode, varietySources, cleanText, normalize, pickRow, sourceFor, sourcesFor, parseSourceUrl, thin, parseIqiyiXml, color, nearestFirst } };
})();
