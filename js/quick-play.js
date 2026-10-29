// One-click entry and conservative source selection. Playback stays in player.js.
(() => {
    const norm = value => String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
    const year = value => String(value || '').match(/(?:19|20)\d{2}/)?.[0] || '';
    const kind = value => /片|电影|movie/i.test(value || '') ? 'movie' : /剧|tv|series/i.test(value || '') ? 'tv' : '';
    const identity = item => ({ title: item.vod_name || item.title || '', year: year(item.vod_year || item.year), kind: kind(item.type_name || item.kind) });
    function matches(item, request) {
        const info = identity(item);
        if (norm(info.title) !== norm(request.title)) return false;
        if (/解说|预告|花絮/.test(item.type_name || '') && !/解说|预告|花絮/.test(request.title)) return false;
        if (request.year && info.year && year(request.year) !== info.year) return false;
        if (request.kind && info.kind && request.kind !== info.kind) return false;
        return true;
    }
    function groups(items) {
        const result = new Map();
        for (const item of items) {
            const info = identity(item);
            const key = [norm(info.title), info.year, info.kind].join('|');
            if (!result.has(key)) result.set(key, []);
            result.get(key).push(item);
        }
        return [...result.values()];
    }
    function findHistory(records, request) {
        return [...records].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).find(record => {
            if (norm(record.title) !== norm(request.title) || !(record.playbackPosition > 0)) return false;
            if (request.source && request.id && record.sourceName === request.source && String(record.vod_id) === String(request.id)) return true;
            return request.year && request.kind && record.movieYear === request.year && record.movieKind === request.kind;
        }) || null;
    }
    function episodeKey(label) {
        return norm(label).replace(/第0*(\d+)[集话期]/g, '$1').replace(/^0+(?=\d)/, '');
    }
    function episodeIndex(detail, candidate, history) {
        if (!history) return 0;
        const names = detail.episodeNames || [];
        if (history.episodeName) {
            const found = names.findIndex(name => episodeKey(name) === episodeKey(history.episodeName));
            if (found >= 0) return found;
        }
        if (history.sourceName === candidate.source_code && String(history.vod_id) === String(candidate.vod_id)) {
            const index = Number(history.episodeIndex || 0);
            return index >= 0 && index < detail.episodes.length ? index : -1;
        }
        return -1;
    }
    const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; } };
    const playable = value => /^https?:\/\/.+\.(m3u8|mp4|webm|mov|m4v|ts)(\?.*)?$/i.test(value || '');
    let state = null;
    let startupTimer = null;
    let requestToken = 0;
    let activeVideo = null;
    let modalChoiceResolve = null;

    function open(request) {
        if (window.isPasswordProtected?.() && !window.isPasswordVerified?.()) { window.showPasswordModal?.(); return; }
        const url = new URL('player.html', location.origin);
        url.searchParams.set('quick', '1');
        for (const key of ['title', 'year', 'kind', 'id', 'source']) if (request[key]) url.searchParams.set(key, request[key]);
        url.searchParams.set('returnUrl', location.href);
        localStorage.setItem('lastPageUrl', location.href);
        location.assign(url);
    }
    function setStatus(text) {
        const panel = document.getElementById('quickPlayStatus');
        if (!panel) return;
        panel.hidden = text === '播放中';
        panel.querySelector('[data-quick-status]').textContent = text;
    }
    function name(source) {
        return API_SITES[source]?.name || (source?.startsWith('custom_') ? getCustomApiInfo(source.slice(7))?.name : source) || '资源';
    }
    async function searchSource(source, request) {
        const context = getApiSearchContext(source);
        if (!context) return [];
        const target = context.apiBaseUrl + API_CONFIG.search.path + encodeURIComponent(request.title);
        const url = await window.ProxyAuth.addAuthToProxyUrl(PROXY_URL + encodeURIComponent(target));
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 6500);
        try {
            const response = await fetch(url, { signal: controller.signal });
            if (!response.ok) return [];
            const data = await response.json();
            return (Array.isArray(data.list) ? data.list : []).filter(item => matches(item, request))
                .map(item => ({ ...item, source_code: source }));
        } catch { return []; } finally { clearTimeout(timer); }
    }
    async function discover(session) {
        const selected = read('selectedAPIs', DEFAULT_SELECTED_APIS);
        const protectedContent = localStorage.getItem('yellowFilterEnabled') === 'true';
        const ranked = window.SourceAutopilot ? window.SourceAutopilot.rank(selected) : selected;
        const sources = [...new Set([session.history?.sourceName, session.request.source, ...ranked].filter(Boolean))]
            .filter(source => !protectedContent || !(API_SITES[source]?.adult || (source.startsWith('custom_') && getCustomApiInfo(source.slice(7))?.isAdult)));
        let next = 0;
        await Promise.all(Array.from({ length: Math.min(4, sources.length) }, async () => {
            while (next < sources.length) {
                const found = await searchSource(sources[next++], session.request);
                for (const item of found) if (!session.items.some(entry => entry.source_code === item.source_code && String(entry.vod_id) === String(item.vod_id))) session.items.push(item);
                if (session.manual && session.preparing && !session.choosingEpisode) renderChoices(session);
                if (session.request.year && session.request.kind) {
                    const certain = session.items.find(item => identity(item).year === session.request.year && identity(item).kind === session.request.kind);
                    if (certain) session.firstResolve(certain);
                }
            }
        }));
        session.done = true;
        session.firstResolve(null);
        if (session.manual && session.preparing && !session.choosingEpisode) renderChoices(session);
    }
    function renderChoices(session, versions = false) {
        const list = document.getElementById('quickPlayChoices');
        list.replaceChildren();
        list.hidden = false;
        const items = versions ? groups(session.items).map(group => group[0]) : session.items;
        for (const item of items) {
            const button = document.createElement('button');
            const info = identity(item);
            button.type = 'button';
            const version = versions ? '' : window.LibreExperience?.versionLabel(item) || '';
            button.textContent = `${info.title} · ${info.year || '年份未知'} · ${info.kind === 'tv' ? '剧集' : info.kind === 'movie' ? '电影' : '类型待确认'}${versions ? '' : ' · ' + name(item.source_code)}${version ? ' · ' + version : ''}`;
            button.onclick = () => { session.forced = item; session.choiceResolve?.(item); };
            list.appendChild(button);
        }
        if (!items.length) list.textContent = session.done ? '没有找到匹配资源，可返回首页手动搜索。' : '正在搜索候选资源…';
    }
    function waitForChoice(session, versions = false) {
        renderChoices(session, versions);
        if (session.forced) { const item = session.forced; session.forced = null; return Promise.resolve(item); }
        return new Promise(resolve => { session.choiceResolve = item => { session.choiceResolve = null; session.forced = null; resolve(item); }; });
    }
    async function detailFor(item) {
        const params = getDetailApiParamsForSource(item.source_code);
        const response = await fetch(`/api/detail?id=${encodeURIComponent(item.vod_id)}${params}`);
        if (!response.ok) throw new Error('详情获取失败');
        const detail = await response.json();
        if (!detail.episodes?.some(playable)) throw new Error('未找到播放地址');
        return detail;
    }
    async function select(item, session, resume = session.history) {
        const token = requestToken;
        const detail = await detailFor(item);
        if (token !== requestToken) throw new Error('已改为手动选择');
        let index = resume?.singleMovie && detail.episodes.length === 1 ? 0 : episodeIndex(detail, item, resume);
        if (index < 0 && session.preparing) {
            session.manual = true;
            session.choosingEpisode = true;
            setStatus('无法确认上次观看的集数，请选择要播放的一集');
            const list = document.getElementById('quickPlayChoices');
            list.replaceChildren();
            list.hidden = false;
            index = await new Promise(resolve => {
                session.episodeResolve = resolve;
                detail.episodes.forEach((url, episode) => {
                    if (!playable(url)) return;
                    const button = document.createElement('button');
                    button.textContent = detail.episodeNames?.[episode] || `第 ${episode + 1} 集`;
                    button.onclick = () => resolve(episode);
                    list.appendChild(button);
                });
            });
            if (token !== requestToken) throw new Error('已改为手动选择');
            session.episodeResolve = null;
            session.choosingEpisode = false;
            resume = null;
        }
        if (index < 0 || !playable(detail.episodes[index])) throw new Error('无法确认对应集数，请手动选集');
        const url = new URL(location.href);
        const info = identity(item);
        url.searchParams.delete('quick');
        for (const [key, value] of Object.entries({ title: session.request.title, source: item.source_code, id: item.vod_id, url: detail.episodes[index], index, year: info.year || session.request.year || '', kind: info.kind || session.request.kind || '' })) url.searchParams.set(key, value);
        if (resume?.playbackPosition > 0) url.searchParams.set('position', Math.floor(resume.playbackPosition));
        else url.searchParams.delete('position');
        history.replaceState({}, '', url);
        localStorage.setItem('currentEpisodes', JSON.stringify(detail.episodes));
        localStorage.setItem('currentEpisodeIndex', index);
        localStorage.setItem('currentEpisodeNames', JSON.stringify(detail.episodeNames || []));
        window.EpisodeContext?.write({source:item.source_code, id:item.vod_id, episodes:detail.episodes, episodeNames:detail.episodeNames || []});
        url.searchParams.set('episodeName', detail.episodeNames?.[index] || '');
        history.replaceState({}, '', url);
        session.current = { item, detail, index };
        session.request.year = url.searchParams.get('year');
        session.request.kind = url.searchParams.get('kind');
        session.items = session.items.filter(candidate => matches(candidate, session.request));
        document.getElementById('quickPlayChoices').hidden = true;
        setStatus(resume?.playbackPosition > 0 ? `正在连接，准备从上次进度继续 · ${name(item.source_code)}` : `正在连接 · ${name(item.source_code)}`);
        return session.current;
    }
    async function prepare() {
        const params = new URLSearchParams(location.search);
        if (params.get('quick') !== '1') return true;
        if (state?.preparing) return false;
        const request = Object.fromEntries(['title', 'year', 'kind', 'id', 'source'].map(key => [key, params.get(key) || '']));
        const session = { request, items: [], history: findHistory(read('viewingHistory', []), request), preparing: true, manual: false, played: false, retries: 0, tried: new Set() };
        state = session;
        setStatus('正在寻找播放资源…');
        document.getElementById('videoTitle').textContent = request.title;
        const first = new Promise(resolve => { session.firstResolve = resolve; });
        session.discovery = discover(session);
        let item;
        let confirmed = false;
        const preferred = session.history;
        if (!request.id && preferred?.sourceName && preferred?.vod_id) { request.id = preferred.vod_id; request.source = preferred.sourceName; }
        if (request.id && request.source) item = { vod_id: request.id, source_code: request.source, vod_name: request.title, vod_year: request.year, type_name: request.kind };
        else {
            item = await first;
            if (item && request.year && request.kind) {
                await new Promise(resolve => setTimeout(resolve, 280));
                item = window.LibreExperience?.chooseCandidate(session.items, request, read('viewingHistory', [])) || item;
                // A TC/TS copy answered first: give slower sources a moment to offer a clear one.
                if ((window.LibreExperience?.versionRank(item) ?? 3) < 2) {
                    await Promise.race([session.discovery, new Promise(resolve => setTimeout(resolve, 3000))]);
                    item = window.LibreExperience?.chooseCandidate(session.items, request, read('viewingHistory', [])) || item;
                }
            }
            if (!item) {
                await session.discovery;
                if (groups(session.items).length > 1) {
                    session.manual = true;
                    setStatus('找到不同版本，请确认要观看的作品');
                    item = await waitForChoice(session, true);
                    confirmed = true;
                } else item = window.LibreExperience?.chooseCandidate(session.items, request, read('viewingHistory', [])) || session.items[0];
            }
        }
        if (session.manual && !confirmed) item = null;
        for (;;) {
            if (session.manual && !item) item = await waitForChoice(session);
            if (!item) { session.manual = true; setStatus('暂未找到可自动播放的资源，请手动选择'); item = await waitForChoice(session); }
            session.tried.add(`${item.source_code}:${item.vod_id}`);
            try {
                if (session.manual) {
                    const info = identity(item);
                    session.request = { ...session.request, ...info };
                    session.history = findHistory(read('viewingHistory', []), { ...info, source: item.source_code, id: item.vod_id });
                }
                const selection = await select(item, session);
                session.preparing = false;
                return Boolean(selection);
            } catch (error) {
                await session.discovery;
                const untried = session.items.filter(candidate => !session.tried.has(`${candidate.source_code}:${candidate.vod_id}`));
                item = window.LibreExperience?.chooseCandidate(untried, session.request, read('viewingHistory', [])) || untried[0];
                if (session.retries >= 2 || session.manual) item = null;
                if (item) { session.retries++; setStatus(`正在尝试其他资源（${session.retries}/2）…`); }
                else { session.manual = true; setStatus(error.message + '，请选择资源或返回首页'); }
            }
        }
    }
    function stop() {
        clearTimeout(startupTimer);
        requestToken++;
        if (state) state.manual = true;
    }
    function manual() {
        stop();
        if (state?.episodeResolve) { state.episodeResolve(-1); state.choosingEpisode = false; }
        if (state?.preparing) { setStatus('请选择资源'); renderChoices(state); }
        else window.showSwitchResourceModal?.();
    }
    function onError() {
        if (!state || state.preparing || state.played || state.manual) return false;
        if (state.current && !state.current.failureRecorded) {
            state.current.failureRecorded = true;
            window.LibreExperience?.recordQuality(state.current.item.source_code, {started:false});
        }
        if (state.retries >= 2) return false;
        if (state.retrying) return true;
        state.retrying = true;
        clearTimeout(startupTimer);
        const token = ++requestToken;
        void (async () => {
            await state.discovery;
            if (token !== requestToken || state.manual || state.played) { state.retrying = false; return; }
            const current = state.current;
            const resume = { sourceName: current.item.source_code, vod_id: current.item.vod_id, episodeIndex: current.index, episodeName: current.detail.episodeNames?.[current.index], playbackPosition: Number(new URLSearchParams(location.search).get('position')) || 0 };
            // A single movie needs no cross-source episode mapping.
            const saved = current.detail.episodes.length === 1 && state.request.kind === 'movie' ? { ...resume, singleMovie: true } : resume;
            let succeeded = false;
            const version = item => Math.floor(window.LibreExperience?.versionRank(item) ?? 3);
            const options = [...state.items].sort((a,b) => version(b) - version(a) || (window.LibreExperience?.qualityScore(b.source_code) || 0) - (window.LibreExperience?.qualityScore(a.source_code) || 0));
            for (const item of options) {
                const key = `${item.source_code}:${item.vod_id}`;
                if (state.tried.has(key) || state.retries >= 2) continue;
                if (!matches(item, state.request)) continue;
                const info = identity(item);
                if (state.request.year && info.year !== state.request.year) continue;
                if (state.request.kind && info.kind !== state.request.kind) continue;
                state.tried.add(key);
                state.retries++;
                setStatus(`启动失败，正在尝试 ${name(item.source_code)}（${state.retries}/2）`);
                try {
                    const selection = await select(item, state, saved);
                    if (token !== requestToken || state.manual) break;
                    state.retrying = false;
                    activeVideo = null;
                    window.QuickPlay.useSelection(selection);
                    succeeded = true;
                    break;
                } catch { /* Try the next identity-compatible candidate, within the limit. */ }
            }
            state.retrying = false;
            if (!succeeded && token === requestToken) { state.manual = true; setStatus('自动尝试已停止，请手动换源或选集'); window.showError?.('启动失败，请手动选择资源'); }
        })();
        return true;
    }
    function attach(video) {
        clearTimeout(startupTimer);
        activeVideo = video;
        const source = new URLSearchParams(location.search).get('source');
        const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
        let frameRecorded = false;
        let hasPlayed = false;
        const recordFirstFrame = () => {
            if (activeVideo !== video || frameRecorded) return;
            frameRecorded = true;
            const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt;
            window.LibreExperience?.recordQuality(source, {started:true, firstFrameMs:elapsed});
        };
        video.addEventListener('playing', () => {
            if (activeVideo !== video) return;
            hasPlayed = true;
            if (state) state.played = true;
            clearTimeout(startupTimer);
            setStatus('播放中');
            if (typeof video.requestVideoFrameCallback === 'function') video.requestVideoFrameCallback(recordFirstFrame);
            else recordFirstFrame();
        }, { once: true });
        video.addEventListener('waiting', () => {
            if (activeVideo === video && hasPlayed && !video.paused && !video.seeking) window.LibreExperience?.recordStall(source);
        });
        video.addEventListener('error', () => { if (activeVideo === video) onError(); });
        video.addEventListener('pause', () => { if (activeVideo === video && video.readyState >= 2 && !state?.retrying) stop(); });
        if (!state || state.manual) return;
        startupTimer = setTimeout(() => {
            // Loaded/paused media usually means autoplay was blocked: do not change source.
            if (video.readyState >= 2) { setStatus('已准备好，点击播放器开始观看'); return; }
            if (!onError() && state && !state.played && !state.manual) {
                state.manual = true;
                setStatus('自动尝试已停止，请手动换源或选集');
                window.showError?.('启动超时，请手动选择资源');
            }
        }, 15000);
    }
    function details() {
        stop();
        const modal = document.getElementById('modal');
        window.moveModalToFullscreenHost?.(modal);
        document.getElementById('modalTitle').textContent = '影片详情';
        const content = document.getElementById('modalContent');
        content.replaceChildren();
        const info = state?.current?.detail?.videoInfo;
        const p = document.createElement('p');
        p.textContent = info ? [info.title || state.request.title, info.year, info.type, info.area, info.director, info.actor, String(info.desc || '').replace(/<[^>]*>/g, '')].filter(Boolean).join(' · ') : '正在加载影片详情…';
        content.appendChild(p);
        const copy = document.createElement('button');
        copy.textContent = '复制播放链接'; copy.onclick = () => window.copyLinks?.(); content.appendChild(copy);
        modal.classList.remove('hidden');
        if (!info) {
            const params = new URLSearchParams(location.search);
            detailFor({ source_code: params.get('source'), vod_id: params.get('id') }).then(detail => {
                p.textContent = [detail.videoInfo?.title, detail.videoInfo?.year, detail.videoInfo?.type, String(detail.videoInfo?.desc || '').replace(/<[^>]*>/g, '')].filter(Boolean).join(' · ') || '暂无简介';
            }).catch(() => { p.textContent = '详情暂时无法加载，播放不受影响'; });
        }
    }
    function restart() {
        stop();
        const url = new URL(location.href); url.searchParams.delete('position');
        history.replaceState({}, '', url);
        window.clearVideoProgress?.();
        if (typeof art !== 'undefined' && art?.video) { art.video.currentTime = 0; art.video.play().catch(() => {}); }
    }
    async function resolveSwitchIndex(detail, item) {
        const params = new URLSearchParams(location.search);
        const current = { sourceName: params.get('source'), vod_id: params.get('id'), episodeIndex: Number(params.get('index') || 0), episodeName: historyInfo().episodeName };
        if (params.get('kind') === 'movie' && detail.episodes.length === 1) return 0;
        const index = episodeIndex(detail, item, current);
        if (index >= 0) return index;
        const modal = document.getElementById('modal');
        window.moveModalToFullscreenHost?.(modal);
        document.getElementById('modalTitle').textContent = '请确认要播放的集数';
        const content = document.getElementById('modalContent');
        content.replaceChildren();
        modal.classList.remove('hidden');
        return new Promise(resolve => {
            modalChoiceResolve = resolve;
            detail.episodes.forEach((url, index) => {
                const button = document.createElement('button');
                button.textContent = detail.episodeNames?.[index] || `第 ${index + 1} 集`;
                button.onclick = () => { modalChoiceResolve = null; window.closeModal?.(); resolve(index); };
                content.appendChild(button);
            });
        });
    }
    function cancelChoice() { modalChoiceResolve?.(-1); modalChoiceResolve = null; }
    function historyInfo() {
        const params = new URLSearchParams(location.search);
        const index = Number(params.get('index') || 0);
        return { movieYear: params.get('year') || '', movieKind: params.get('kind') || '', episodeName: params.get('episodeName') || state?.current?.detail?.episodeNames?.[index] || '' };
    }
    window.QuickPlay = { open, prepare, manual, stop, onError, attach, details, restart, historyInfo, cancelChoice, resolveSwitchIndex, currentDetail: () => state?.current?.detail || null, logic: { matches, groups, episodeIndex, findHistory, identity } };
})();
