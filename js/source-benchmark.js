// 一键优选：在你自己的网络下给每个资源站测速（搜一次 + 下载一小段真实视频），选出最快的几个。
// 用在三个地方：设置里的「一键优选」按钮、第一次使用时在后台自动跑一次、之后每周复测一次
// （复测只把明显变慢或失效的已选源换成更快的，不动其他选择）。每次自动改动都可以撤销。
(() => {
    const STORE_KEY = 'sourceBenchmarkV1';
    const PICK = 6;              // 普通资源选几个
    const ADULT_PICK = 4;        // 成人资源选几个（只在用户本来就选了成人资源时才动）
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const SLOW_RATIO = 3;        // 每周复测：比可选的更快源慢 3 倍以上才换
    const MIN_PLAYABLE = 3;      // 测得能播放的源少于这个数时，多半是网络临时出问题：用能搜索的源补足
    const FIRST_RUN_DELAY_MS = 8000;
    const SEARCH_CONCURRENCY = 4;
    const PROBE_QUERIES = ['繁花', '狂飙', '流浪地球'];
    const PLAYABLE = /^https?:\/\/[^#$\s]+?\.(?:m3u8|mp4)(?:[?#].*)?$/i;

    const read = (key, fallback) => {
        try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
    };
    const write = (key, value) => {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
    };
    const sites = () => window.API_SITES || {};

    // ---- 纯逻辑（单元测试覆盖） ----

    // MacCMS 的 vod_play_url："第1集$https://…/index.m3u8#第2集$…"，多个播放器之间用 $$$ 分隔
    function firstEpisodeUrl(playUrl) {
        for (const group of String(playUrl || '').split('$$$')) {
            for (const episode of group.split('#')) {
                const url = episode.split('$').pop().trim();
                if (PLAYABLE.test(url)) return url;
            }
        }
        return '';
    }

    // 越大越好。测到下载速度的按速度排；只测了能否搜索（省流模式）的按搜索耗时排；失败的排最后。
    function speedScore(result) {
        if (!result?.ok) return -1;
        if (result.kbps > 0) return 1e6 + result.kbps;
        return Math.max(0, 1e5 - (result.searchMs || 0));
    }

    // 按测速结果挑源：普通资源取最快的 PICK 个（同一家的镜像只留最快的一个）；
    // 成人资源只在本来就选了的时候重新挑；自定义资源原样保留。
    function choose({ results, siteMap, selected, pick = PICK, adultPick = ADULT_PICK }) {
        const known = Object.keys(results).filter(id => siteMap[id]);
        // 第一档：视频能下载，按速度排；第二档：能搜索但这次视频没测通，按搜索耗时排
        const playable = known.filter(id => results[id]?.ok)
            .sort((a, b) => speedScore(results[b]) - speedScore(results[a]));
        const searchable = known.filter(id => !results[id]?.ok && results[id]?.searchOk)
            .sort((a, b) => (results[a].searchMs || 0) - (results[b].searchMs || 0));
        const take = (ids, limit, families = new Set(), picked = []) => {
            for (const id of ids) {
                if (picked.length >= limit) break;
                const family = siteMap[id].family;
                if (picked.includes(id) || (family && families.has(family))) continue;
                if (family) families.add(family);
                picked.push(id);
            }
            return picked;
        };
        const pickGroup = (adult, limit) => {
            const filter = id => Boolean(siteMap[id].adult) === adult;
            const families = new Set();
            const picked = take(playable.filter(filter), limit, families);
            if (picked.length < MIN_PLAYABLE) take(searchable.filter(filter), limit, families, picked);
            return picked;
        };
        const normal = pickGroup(false, pick);
        const hadAdult = selected.some(id => siteMap[id]?.adult);
        const adult = hadAdult ? pickGroup(true, adultPick) : [];
        const custom = selected.filter(id => id.startsWith('custom_'));
        // 什么都没测通（多半是断网或代理坏了）：不改动
        if (!normal.length) return { selected: [...selected], added: [], removed: [], changed: false };
        const next = [...normal, ...adult, ...custom];
        const added = next.filter(id => !selected.includes(id));
        const removed = selected.filter(id => !next.includes(id));
        return { selected: next, added, removed, changed: Boolean(added.length || removed.length) };
    }

    // 每周复测：已选的源失效，或比没选的同类源慢 SLOW_RATIO 倍以上，才换成更快的那个；其余选择不动。
    function weeklySwaps({ results, siteMap, selected }) {
        const swaps = [];
        const next = [...selected];
        const taken = new Set(next.map(id => siteMap[id]?.family).filter(Boolean));
        for (const id of selected) {
            const site = siteMap[id];
            const own = results[id];
            if (!site || !own) continue;
            const candidates = Object.keys(results)
                .filter(other => siteMap[other] && !next.includes(other) && Boolean(siteMap[other].adult) === Boolean(site.adult))
                .filter(other => results[other]?.ok)
                .filter(other => !siteMap[other].family || siteMap[other].family === site.family || !taken.has(siteMap[other].family))
                .sort((a, b) => speedScore(results[b]) - speedScore(results[a]));
            const best = candidates[0];
            if (!best) continue;
            const failed = !own.ok;
            const slow = own.ok && own.kbps > 0 && results[best].kbps > own.kbps * SLOW_RATIO;
            if (!failed && !slow) continue;
            next.splice(next.indexOf(id), 1, best);
            if (siteMap[best].family) taken.add(siteMap[best].family);
            swaps.push({ from: id, to: best, reason: failed ? '已无法使用' : '明显变慢' });
        }
        return { selected: next, swaps };
    }

    // ---- 测速 ----

    function savingData() {
        const connection = navigator.connection || {};
        return Boolean(connection.saveData) || connection.type === 'cellular';
    }

    async function probeSource(id, { signal, light }) {
        const startedAt = performance.now();
        const context = window.getApiSearchContext?.(id);
        if (!context) return { ok: false, reason: '配置无效', at: Date.now() };
        let episodeUrl = '';
        let searchMs = 0;
        try {
            const queries = sites()[id]?.adult ? [null] : PROBE_QUERIES;
            for (const query of queries) {
                const path = query === null ? '?ac=videolist&pg=1' : API_CONFIG.search.path + encodeURIComponent(query);
                const data = await window.fetchVodApiJson(context.apiBaseUrl + path, API_CONFIG.search.headers, signal);
                searchMs = Math.round(performance.now() - startedAt);
                window.SourceHosts?.learnItems?.(data?.list);
                for (const item of Array.isArray(data?.list) ? data.list : []) {
                    episodeUrl = firstEpisodeUrl(item?.vod_play_url);
                    if (episodeUrl) break;
                }
                if (episodeUrl) break;
            }
        } catch (error) {
            if (signal?.aborted) throw error;
            return { ok: false, reason: '无法访问', at: Date.now() };
        }
        if (!episodeUrl) return { ok: false, reason: '搜不到可播放的视频', searchMs, at: Date.now() };
        if (light || !window.SourceSpeed?.probeEpisodeUrl) return { ok: true, searchOk: true, searchMs, kbps: 0, at: Date.now() };
        try {
            const speed = await window.SourceSpeed.probeEpisodeUrl(episodeUrl, { signal, quick: true });
            return { ok: true, searchOk: true, searchMs, kbps: speed.kbps, latencyMs: speed.latencyMs, transport: speed.transport, at: Date.now() };
        } catch (error) {
            if (signal?.aborted) throw error;
            return { ok: false, searchOk: true, reason: '视频加载失败', searchMs, at: Date.now() };
        }
    }

    function targetIds() {
        const adultAllowed = localStorage.getItem('yellowFilterEnabled') === 'false';
        return Object.keys(sites()).filter(id => !sites()[id].adult || adultAllowed);
    }

    async function benchmark({ ids = targetIds(), onProgress, signal, light = savingData() } = {}) {
        const results = {};
        let next = 0;
        let done = 0;
        await Promise.all(Array.from({ length: Math.min(SEARCH_CONCURRENCY, ids.length) }, async () => {
            while (next < ids.length) {
                const id = ids[next++];
                if (signal?.aborted) return;
                try {
                    results[id] = await probeSource(id, { signal, light });
                } catch {
                    return;
                }
                done++;
                onProgress?.({ done, total: ids.length, id, result: results[id] });
            }
        }));
        return { results, light };
    }

    // ---- 应用与撤销 ----

    function currentSelected() {
        const saved = read('selectedAPIs', null);
        return Array.isArray(saved) ? saved : [...(window.DEFAULT_SELECTED_APIS || [])];
    }

    function applySelection(ids) {
        if (typeof window.setSelectedApiIds === 'function') window.setSelectedApiIds(ids);
        else write('selectedAPIs', ids);
    }

    function nameOf(id) {
        return sites()[id]?.name || id;
    }

    function formatSpeed(result) {
        if (!result?.ok) return result?.reason || '不可用';
        if (result.kbps > 0) return result.kbps >= 1024 ? `${(result.kbps / 1024).toFixed(1)} MB/s` : `${result.kbps} KB/s`;
        return `可用 · 搜索 ${(result.searchMs / 1000).toFixed(1)} 秒`;
    }

    let running = null;

    // mode: manual（设置里的按钮）/ first-run（第一次使用，后台）/ weekly（每周复测，只换明显变慢的）
    async function optimize({ mode = 'manual', onProgress } = {}) {
        if (running) return running;
        running = (async () => {
            const before = currentSelected();
            const { results, light } = await benchmark({ onProgress });
            const store = { at: Date.now(), light, results, mode };
            let outcome;
            if (mode === 'weekly') {
                const { selected, swaps } = weeklySwaps({ results, siteMap: sites(), selected: before });
                outcome = { selected, added: swaps.map(s => s.to), removed: swaps.map(s => s.from), changed: swaps.length > 0, swaps };
            } else {
                outcome = choose({ results, siteMap: sites(), selected: before });
            }
            store.undo = outcome.changed
                ? { selected: before, at: Date.now(), added: outcome.added, removed: outcome.removed }
                : read(STORE_KEY, {})?.undo || null;
            // 先保存测速结果，设置里的列表才会按新结果排序
            write(STORE_KEY, store);
            if (outcome.changed) applySelection(outcome.selected);
            renderNotice(outcome, mode);
            return { ...outcome, results, light };
        })();
        try { return await running; } finally { running = null; }
    }

    function undo() {
        const store = read(STORE_KEY, {});
        if (!store?.undo?.selected) return false;
        applySelection(store.undo.selected);
        store.undo = null;
        write(STORE_KEY, store);
        renderNotice(null);
        return true;
    }

    // 其他模块用：某个源最近一次测得的速度（KB/s，没测过为 0）
    function speedOf(id) {
        const result = read(STORE_KEY, {})?.results?.[id];
        return result?.ok ? Number(result.kbps) || 0 : 0;
    }

    // 设置列表排序与选源用的质量分：测得的速度为主，再加上每日体检的健康分
    function qualityOf(id) {
        const result = read(STORE_KEY, {})?.results?.[id];
        const health = window.SourceAutopilot?.score?.(id) || 0;
        if (result && !result.ok) return -1000 + health;
        return (result?.kbps > 0 ? Math.log2(1 + result.kbps) * 10 : 0) + health;
    }

    // ---- 设置面板 ----

    function summaryText(outcome, mode) {
        if (!outcome) return '';
        if (!outcome.changed) return mode === 'weekly' ? '' : '测速完成，当前选择已经是最快的组合。';
        const added = outcome.added.map(nameOf).join('、');
        const removed = outcome.removed.map(nameOf).join('、');
        if (mode === 'weekly') return `每周测速：${outcome.swaps.map(s => `「${nameOf(s.from)}」${s.reason}，已换成「${nameOf(s.to)}」`).join('；')}。`;
        const lead = mode === 'first-run' ? '已按你的网络选好最快的资源站' : '已选上最快的资源站';
        return `${lead}${added ? `：新增 ${added}` : ''}${removed ? `；取消 ${removed}` : ''}。`;
    }

    function renderNotice(outcome, mode) {
        const box = document.getElementById('sourceBenchmarkResult');
        if (!box) return;
        const store = read(STORE_KEY, {});
        const text = summaryText(outcome, mode);
        const rows = Object.entries(store?.results || {})
            .filter(([id]) => sites()[id])
            .sort(([a, ra], [b, rb]) => speedScore(rb) - speedScore(ra) || nameOf(a).localeCompare(nameOf(b)))
            .map(([id, result]) => {
                const picked = currentSelected().includes(id);
                return `<li class="${result.ok ? '' : 'is-failed'}${picked ? ' is-picked' : ''}"><span>${picked ? '✓ ' : ''}${escapeHtmlAttr(nameOf(id))}</span><span>${escapeHtmlAttr(formatSpeed(result))}</span></li>`;
            }).join('');
        const when = store?.at ? new Date(store.at).toLocaleString() : '';
        box.innerHTML = `
            ${text ? `<p class="source-benchmark-summary">${escapeHtmlAttr(text)}</p>` : ''}
            ${store?.undo?.selected ? '<button type="button" class="lt-btn lt-btn-sm source-benchmark-undo">撤销这次调整</button>' : ''}
            ${rows ? `<details class="source-benchmark-details"><summary>各资源站测速结果${when ? `（${escapeHtmlAttr(when)}${store.light ? '，省流模式未测下载速度' : ''}）` : ''}</summary><ul>${rows}</ul></details>` : ''}`;
        box.hidden = !box.innerHTML.trim();
        box.querySelector('.source-benchmark-undo')?.addEventListener('click', () => {
            if (undo()) window.showToast?.('已恢复到调整前的资源站选择', 'info');
        });
        if (outcome?.changed && mode !== 'manual') window.showToast?.(text, 'success');
    }

    async function runFromButton(button) {
        if (running) return;
        const label = button.textContent;
        button.disabled = true;
        try {
            const outcome = await optimize({
                mode: 'manual',
                onProgress: ({ done, total }) => { button.textContent = `正在测速 ${done}/${total}…`; }
            });
            window.showToast?.(summaryText(outcome, 'manual') || '测速完成', outcome.changed ? 'success' : 'info');
        } catch (error) {
            window.showToast?.(`测速失败：${error.message}`, 'error');
        } finally {
            button.disabled = false;
            button.textContent = label;
        }
    }

    // 第一次使用时在后台跑一次；之后每周复测一次（只换明显变慢的）
    function scheduleAutomatic() {
        if (!document.getElementById('apiCheckboxes')) return;
        setTimeout(() => {
            if (navigator.onLine === false) return;
            if (window.isPasswordProtected?.() && !window.isPasswordVerified?.()) return;
            const store = read(STORE_KEY, null);
            if (!store?.at) void optimize({ mode: 'first-run' }).catch(error => console.warn('自动优选失败:', error));
            else if (Date.now() - store.at > WEEK_MS) void optimize({ mode: 'weekly' }).catch(error => console.warn('每周测速失败:', error));
        }, FIRST_RUN_DELAY_MS);
    }

    function start() {
        const button = document.getElementById('sourceBenchmarkButton');
        button?.addEventListener('click', () => runFromButton(button));
        renderNotice(null);
        scheduleAutomatic();
    }

    if (document.readyState === 'loading' || !document.readyState) document.addEventListener('DOMContentLoaded', start);
    else start();

    window.SourceBenchmark = {
        optimize, undo, speedOf, qualityOf, formatSpeed,
        logic: { firstEpisodeUrl, speedScore, choose, weeklySwaps }
    };
})();
