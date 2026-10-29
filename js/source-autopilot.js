// Daily, automatic upkeep of the selected sources, measured from the viewer's own network:
// - once a day, quietly searches every built-in source (and selected custom ones) once;
// - keeps a short per-source history and scores sources (health + real playback quality);
// - stops a selected source that refuses keyword search or failed three days in a row,
//   swapping in a healthy mirror of the same network when there is one;
// - suggests built-in sources that have been healthy and are not mirrors of a selected one.
// Nothing here discovers brand-new sites: the candidate pool is the built-in list.
(() => {
    const HISTORY_KEY = 'sourceHealthHistoryV1';
    const STATE_KEY = 'sourceAutopilotV1';
    const RUN_INTERVAL_MS = 20 * 60 * 60 * 1000;
    const HISTORY_LIMIT = 10;
    const FAILED_DAYS_TO_DISABLE = 3;
    const FORBIDDEN_DAYS_TO_DISABLE = 2;
    const HEALTHY_DAYS_TO_SUGGEST = 2;
    const DISMISS_MS = 30 * 24 * 60 * 60 * 1000;
    const NOTICE_MS = 14 * 24 * 60 * 60 * 1000;
    const PROBE_QUERY = '阿凡达';
    const PLAYABLE = /https?:\/\/[^#$\s]+?\.(?:m3u8|mp4)/i;
    // Collection sites that only serve whole-site crawling answer searches like this.
    const FORBIDDEN = /forbid|不支持搜索|禁止搜索|关闭搜索/i;

    const read = (key, fallback) => {
        try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
    };
    const write = (key, value) => {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
    };
    const dayOf = time => {
        const date = new Date(time);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    };

    function sites() { return window.API_SITES || {}; }
    function sourceName(id) {
        if (id.startsWith('custom_')) return window.getCustomApiInfo?.(id.slice(7))?.name || '自定义资源';
        return sites()[id]?.name || id;
    }
    function isAdult(id) {
        return Boolean(sites()[id]?.adult || (id.startsWith('custom_') && window.getCustomApiInfo?.(id.slice(7))?.isAdult));
    }
    function selectedIds() {
        const saved = read('selectedAPIs', null);
        return Array.isArray(saved) ? saved : [...(window.DEFAULT_SELECTED_APIS || [])];
    }

    // ---- pure decision logic (unit tested) ----

    // Probe outcome from one search: ok / forbidden (search switched off) / failed.
    function classify(data) {
        if (!data || typeof data !== 'object') return { status: 'failed', reason: '无法访问' };
        const list = Array.isArray(data.list) ? data.list : [];
        if (list.some(item => PLAYABLE.test(String(item?.vod_play_url || '')))) return { status: 'ok', reason: '' };
        if (FORBIDDEN.test(String(data.msg || ''))) return { status: 'forbidden', reason: '已关闭关键词搜索' };
        return { status: 'failed', reason: list.length ? '搜索结果没有可播放地址' : (String(data.msg || '').slice(0, 40) || '搜索无结果') };
    }

    // One entry per day per source, newest last.
    function addEntry(history, id, entry) {
        const list = (history[id] || []).filter(item => item.day !== entry.day);
        list.push(entry);
        return { ...history, [id]: list.slice(-HISTORY_LIMIT) };
    }

    function trailing(list, predicate) {
        let count = 0;
        for (let i = list.length - 1; i >= 0 && predicate(list[i]); i--) count++;
        return count;
    }

    function healthScore(history, id) {
        const recent = (history[id] || []).slice(-5);
        if (!recent.length) return 0;
        const ok = recent.filter(item => item.status === 'ok');
        const okRatio = ok.length / recent.length;
        const latency = ok.length ? ok.reduce((sum, item) => sum + (item.latencyMs || 0), 0) / ok.length : 0;
        return okRatio * 10 - Math.min(latency / 1000, 3);
    }

    function decide({ history, selected, siteMap, state = {}, now = Date.now() }) {
        const selectedSet = new Set(selected);
        const disable = [];
        const enable = [];
        const searchable = selected.filter(id => !siteMap[id]?.adult);
        let remaining = searchable.length;
        for (const id of selected) {
            const list = history[id] || [];
            const forbiddenDays = trailing(list, item => item.status === 'forbidden');
            const failedDays = trailing(list, item => item.status !== 'ok');
            let reason = '';
            if (forbiddenDays >= FORBIDDEN_DAYS_TO_DISABLE) reason = '已关闭关键词搜索';
            else if (failedDays >= FAILED_DAYS_TO_DISABLE) reason = `连续 ${failedDays} 天无法搜索`;
            if (!reason) continue;
            const counts = !siteMap[id]?.adult;
            // Never leave the viewer without a single searchable source.
            if (counts && remaining <= 1) continue;
            if (counts) remaining--;
            const family = siteMap[id]?.family;
            const replacement = family && Object.keys(siteMap).find(other => other !== id &&
                siteMap[other].family === family && !selectedSet.has(other) && !enable.includes(other) &&
                (history[other] || []).at(-1)?.status === 'ok');
            disable.push({ id, reason, replacement: replacement || '' });
            if (replacement) {
                enable.push(replacement);
                remaining++;
            }
        }
        const disabledIds = new Set(disable.map(item => item.id));
        const finalSelected = [...selected.filter(id => !disabledIds.has(id)), ...enable];
        const takenFamilies = new Set(finalSelected.map(id => siteMap[id]?.family).filter(Boolean));
        const suggestions = Object.keys(siteMap)
            .filter(id => !siteMap[id].adult && !finalSelected.includes(id))
            .filter(id => !siteMap[id].family || !takenFamilies.has(siteMap[id].family))
            .filter(id => !(now - (state.dismissed?.[id] || 0) < DISMISS_MS))
            .filter(id => !(now - (state.disabled?.[id]?.at || 0) < 7 * 24 * 60 * 60 * 1000))
            .filter(id => trailing(history[id] || [], item => item.status === 'ok') >= HEALTHY_DAYS_TO_SUGGEST)
            .sort((a, b) => healthScore(history, b) - healthScore(history, a))
            .slice(0, 2);
        return { disable, enable, suggestions };
    }

    // ---- runtime ----

    function score(id) {
        const quality = window.LibreExperience?.qualityScore?.(id) || 0;
        return healthScore(read(HISTORY_KEY, {}), id) + quality;
    }

    // Stable: equal scores keep the viewer's own order.
    function rank(ids) {
        return [...ids].map((id, index) => ({ id, index, value: score(id) }))
            .sort((a, b) => b.value - a.value || a.index - b.index)
            .map(item => item.id);
    }

    async function probe(id) {
        const context = window.getApiSearchContext?.(id);
        if (!context) return null;
        const started = performance.now();
        let data = null;
        try {
            data = await window.fetchVodApiJson(context.apiBaseUrl + API_CONFIG.search.path + encodeURIComponent(PROBE_QUERY));
            window.SourceHosts?.learnItems(data?.list);
        } catch { data = null; }
        return { ...classify(data), latencyMs: Math.round(performance.now() - started) };
    }

    function probeTargets() {
        const filtered = localStorage.getItem('yellowFilterEnabled') === 'true';
        const selected = selectedIds();
        const builtIn = Object.keys(sites()).filter(id => !sites()[id].adult || (!filtered && selected.includes(id)));
        const custom = selected.filter(id => id.startsWith('custom_'));
        return [...new Set([...builtIn, ...custom])];
    }

    function setSelected(id, on) {
        const checkbox = document.getElementById(id.startsWith('custom_') ? `custom_api_${id.slice(7)}` : `api_${id}`);
        if (checkbox && typeof window.updateSelectedAPIs === 'function') {
            checkbox.checked = on;
            window.updateSelectedAPIs();
            return;
        }
        const next = selectedIds().filter(item => item !== id);
        if (on) next.push(id);
        write('selectedAPIs', next);
        try { if (typeof selectedAPIs !== 'undefined') selectedAPIs = next; } catch { /* app.js not loaded */ }
    }

    function renderHealthDots() {
        const history = read(HISTORY_KEY, {});
        document.querySelectorAll('[data-health-for]').forEach(dot => {
            const last = (history[dot.dataset.healthFor] || []).at(-1);
            if (!last) return;
            dot.dataset.health = last.status === 'ok' ? 'ok' : last.status === 'forbidden' ? 'failed' : 'degraded';
            dot.title = last.status === 'ok'
                ? `体检正常 · ${last.latencyMs} ms · ${last.day}`
                : `${last.reason || '体检失败'} · ${last.day}`;
        });
    }

    function renderNotice() {
        const target = document.getElementById('sourceAutopilotNotice');
        if (!target) return;
        const state = read(STATE_KEY, {});
        const now = Date.now();
        target.replaceChildren();
        const addRow = (text, actions) => {
            const row = document.createElement('div');
            row.className = 'source-autopilot-row';
            const label = document.createElement('span');
            label.textContent = text;
            row.appendChild(label);
            for (const [caption, handler] of actions) {
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = caption;
                // The row is re-rendered on click, which detaches this button; without stopping here the
                // settings panel's "clicked outside" handler would see a detached target and close the panel.
                button.onclick = event => {
                    event.stopPropagation();
                    handler();
                };
                row.appendChild(button);
            }
            target.appendChild(row);
        };
        for (const [id, info] of Object.entries(state.disabled || {})) {
            if (now - info.at > NOTICE_MS || !sites()[id] && !id.startsWith('custom_')) continue;
            if (selectedIds().includes(id)) continue;
            addRow(`已自动停用「${sourceName(id)}」：${info.reason}${info.replacement ? `，已换用同源的「${sourceName(info.replacement)}」` : ''}`, [
                ['恢复', () => { setSelected(id, true); delete state.disabled[id]; write(STATE_KEY, state); renderNotice(); }],
                ['知道了', () => { delete state.disabled[id]; write(STATE_KEY, state); renderNotice(); }]
            ]);
        }
        for (const id of state.suggestions || []) {
            if (!sites()[id] || selectedIds().includes(id)) continue;
            addRow(`推荐启用「${sourceName(id)}」：最近几次体检都正常`, [
                ['启用', () => { setSelected(id, true); state.suggestions = (state.suggestions || []).filter(item => item !== id); write(STATE_KEY, state); renderNotice(); renderHealthDots(); }],
                ['忽略', () => { state.dismissed = { ...(state.dismissed || {}), [id]: Date.now() }; state.suggestions = (state.suggestions || []).filter(item => item !== id); write(STATE_KEY, state); renderNotice(); }]
            ]);
        }
        target.hidden = !target.childElementCount;
    }

    async function run({ force = false } = {}) {
        const state = read(STATE_KEY, {});
        if (!force && Date.now() - (state.lastRunAt || 0) < RUN_INTERVAL_MS) return null;
        if (navigator.onLine === false) return null;
        state.lastRunAt = Date.now();
        write(STATE_KEY, state);

        const targets = probeTargets();
        const day = dayOf(Date.now());
        let history = read(HISTORY_KEY, {});
        let next = 0;
        await Promise.all(Array.from({ length: Math.min(3, targets.length) }, async () => {
            while (next < targets.length) {
                const id = targets[next++];
                const result = await probe(id);
                if (result) history = addEntry(history, id, { day, ...result });
            }
        }));
        // Drop history of sources that left the list.
        for (const id of Object.keys(history)) if (!sites()[id] && !id.startsWith('custom_')) delete history[id];
        write(HISTORY_KEY, history);

        const outcome = decide({ history, selected: selectedIds(), siteMap: sites(), state });
        const fresh = read(STATE_KEY, {});
        fresh.disabled = fresh.disabled || {};
        for (const item of outcome.disable) {
            setSelected(item.id, false);
            fresh.disabled[item.id] = { at: Date.now(), reason: item.reason, replacement: item.replacement };
        }
        for (const id of outcome.enable) setSelected(id, true);
        const newSuggestions = outcome.suggestions.filter(id => !(fresh.suggestions || []).includes(id));
        fresh.suggestions = outcome.suggestions;
        write(STATE_KEY, fresh);

        if (typeof window.showToast === 'function') {
            for (const item of outcome.disable) {
                window.showToast(`已自动停用「${sourceName(item.id)}」：${item.reason}${item.replacement ? `，改用同源的「${sourceName(item.replacement)}」` : ''}`, 'warning');
            }
            if (newSuggestions.length) {
                window.showToast(`发现可用的资源站「${newSuggestions.map(sourceName).join('」「')}」，可在设置中启用`, 'info');
            }
        }
        renderHealthDots();
        renderNotice();
        return { history, ...outcome };
    }

    function start() {
        renderHealthDots();
        renderNotice();
        // Index page only, after the page has settled and the viewer is signed in.
        if (!document.getElementById('apiCheckboxes')) return;
        setTimeout(() => {
            if (window.isPasswordProtected?.() && !window.isPasswordVerified?.()) return;
            void run().catch(error => console.warn('资源站自动体检失败:', error));
        }, 15000);
    }
    document.addEventListener('DOMContentLoaded', start);

    window.SourceAutopilot = {
        run, rank, score, renderHealthDots, renderNotice,
        logic: { classify, addEntry, healthScore, decide, dayOf }
    };
})();
