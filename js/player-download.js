// 下载本集（电脑版）：把 m3u8 的分片下载回来拼成一个文件，广告分片照样去掉。
// TS 分片用 mux.js 转成 MP4，fMP4 分片直接拼接，AES-128 加密的分片先解密。
// Chrome / Edge 边下边写进用户选的文件；其他浏览器先在内存里攒齐再保存。
(() => {
    const CONCURRENCY = 4;
    const RETRIES = 3;
    const AHEAD = 24; // segments downloaded ahead of the writer at most, to bound memory
    const MUX_SCRIPT = 'libs/mux-mp4.min.js';

    function resolveUrl(uri, base) {
        try { return new URL(uri, base).href; } catch { return uri; }
    }

    // KEY="value",OTHER=1 → { KEY: 'value', OTHER: '1' }
    function parseAttributes(text) {
        const result = {};
        for (const match of String(text || '').matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g)) result[match[1]] = match[2].replace(/^"|"$/g, '');
        return result;
    }

    function parseByteRange(value, previousEnd = 0) {
        const match = String(value || '').match(/^(\d+)(?:@(\d+))?$/);
        if (!match) return null;
        const length = Number(match[1]);
        const start = match[2] !== undefined ? Number(match[2]) : previousEnd;
        return { start, end: start + length - 1 };
    }

    function parsePlaylist(text, baseUrl) {
        const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        const variants = [];
        const segments = [];
        let mediaSequence = 0;
        let key = null;
        let map = null;
        let duration = 0;
        let discontinuity = false;
        let byterange = null;
        let rangeEnd = 0;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.startsWith('#EXT-X-STREAM-INF:')) {
                const attributes = parseAttributes(line.slice(18));
                const uri = lines.slice(i + 1).find(next => !next.startsWith('#'));
                if (uri) variants.push({ url: resolveUrl(uri, baseUrl), bandwidth: Number(attributes.BANDWIDTH) || 0, resolution: attributes.RESOLUTION || '' });
            } else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
                mediaSequence = Number(line.slice(22)) || 0;
            } else if (line.startsWith('#EXT-X-KEY:')) {
                const attributes = parseAttributes(line.slice(11));
                key = attributes.METHOD && attributes.METHOD !== 'NONE'
                    ? { method: attributes.METHOD, uri: resolveUrl(attributes.URI, baseUrl), iv: attributes.IV || '' }
                    : null;
            } else if (line.startsWith('#EXT-X-MAP:')) {
                const attributes = parseAttributes(line.slice(11));
                map = { url: resolveUrl(attributes.URI, baseUrl), byterange: parseByteRange(attributes.BYTERANGE) };
            } else if (line.startsWith('#EXTINF:')) {
                duration = Number.parseFloat(line.slice(8)) || 0;
            } else if (line.startsWith('#EXT-X-BYTERANGE:')) {
                byterange = parseByteRange(line.slice(17), rangeEnd);
            } else if (line === '#EXT-X-DISCONTINUITY') {
                discontinuity = true;
            } else if (!line.startsWith('#')) {
                if (variants.length) continue;
                segments.push({ url: resolveUrl(line, baseUrl), duration, key, map, discontinuity, byterange, sequence: mediaSequence + segments.length });
                if (byterange) rangeEnd = byterange.end + 1;
                duration = 0;
                discontinuity = false;
                byterange = null;
            }
        }
        return { variants, segments };
    }

    function pickVariant(variants) {
        return [...variants].sort((a, b) => b.bandwidth - a.bandwidth)[0] || null;
    }

    // AES-128 IV: the playlist's IV, or the media sequence number as a 128-bit big-endian integer.
    function ivFor(key, sequence) {
        const iv = new Uint8Array(16);
        const hex = String(key?.iv || '').replace(/^0x/i, '');
        if (hex) {
            const padded = hex.padStart(32, '0').slice(-32);
            for (let i = 0; i < 16; i++) iv[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16);
        } else {
            new DataView(iv.buffer).setUint32(12, sequence >>> 0);
        }
        return iv;
    }

    function safeFileName(name) {
        return String(name || '视频').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || '视频';
    }

    function formatBytes(bytes) {
        const value = Number(bytes) || 0;
        if (value >= 1073741824) return `${(value / 1073741824).toFixed(2)} GB`;
        if (value >= 1048576) return `${(value / 1048576).toFixed(1)} MB`;
        return `${Math.max(0, Math.round(value / 1024))} KB`;
    }

    function formatDuration(seconds) {
        const value = Math.max(0, Math.round(Number(seconds) || 0));
        if (value >= 3600) return `${Math.floor(value / 3600)} 小时 ${Math.round(value % 3600 / 60)} 分`;
        if (value >= 60) return `${Math.round(value / 60)} 分钟`;
        return `${value} 秒`;
    }

    function loadScript(src) {
        if (window.muxjs?.Transmuxer) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('转换组件加载失败'));
            document.head.appendChild(script);
        });
    }

    const sleep = (ms, signal) => new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason || new DOMException('已取消', 'AbortError')); }, { once: true });
    });

    async function fetchBytes(url, signal, range = null) {
        let lastError;
        for (let attempt = 0; attempt <= RETRIES; attempt++) {
            try {
                const response = await fetch(url, { signal, headers: range ? { Range: `bytes=${range.start}-${range.end}` } : undefined });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return new Uint8Array(await response.arrayBuffer());
            } catch (error) {
                if (signal?.aborted) throw error;
                lastError = error;
                if (attempt < RETRIES) await sleep(800 * 2 ** attempt, signal);
            }
        }
        throw lastError;
    }

    async function fetchText(url, signal) {
        return new TextDecoder().decode(await fetchBytes(url, signal));
    }

    // Media playlist for a URL: a master playlist resolves to its best variant; ads are removed like during playback.
    async function loadMediaPlaylist(url, { signal, filterAds }) {
        let playlistUrl = url;
        let text = await fetchText(url, signal);
        const master = parsePlaylist(text, url);
        if (master.variants.length) {
            playlistUrl = pickVariant(master.variants).url;
            text = await fetchText(playlistUrl, signal);
        }
        if (filterAds) text = window.HlsAdFilter?.filterPlaylist(text, playlistUrl)?.content || text;
        const { segments } = parsePlaylist(text, playlistUrl);
        if (!segments.length) throw new Error('没有找到可下载的分片');
        return segments;
    }

    async function openWriter(fileName, mime, extension) {
        if (typeof window.showSaveFilePicker === 'function') {
            const handle = await window.showSaveFilePicker({ suggestedName: fileName, types: [{ description: '视频文件', accept: { [mime]: [extension] } }] });
            const stream = await handle.createWritable();
            return { streamed: true, write: chunk => stream.write(chunk), close: () => stream.close(), abort: () => stream.abort().catch(() => {}) };
        }
        const parts = [];
        return {
            streamed: false,
            write: chunk => { parts.push(chunk); },
            close: () => {
                const link = document.createElement('a');
                link.href = URL.createObjectURL(new Blob(parts, { type: mime }));
                link.download = fileName;
                document.body.appendChild(link);
                link.click();
                parts.length = 0;
                setTimeout(() => { link.remove(); URL.revokeObjectURL(link.href); }, 60000);
            },
            abort: () => { parts.length = 0; }
        };
    }

    // TS → fragmented MP4. Timestamps restart at discontinuities (ad boundaries, joined parts); mux.js only
    // takes a start time when it first sees a track, so each run after a discontinuity gets a fresh
    // transmuxer started at its playlist time. The first init segment describes the whole file.
    function createRemuxer() {
        let transmuxer = null;
        let output = [];
        let initWritten = false;
        let produced = false;
        const open = startSeconds => {
            transmuxer = new window.muxjs.Transmuxer({ keepOriginalTimestamps: false, baseMediaDecodeTime: Math.round(startSeconds * 90000) });
            transmuxer.on('data', segment => {
                produced = true;
                if (!initWritten) { output.push(new Uint8Array(segment.initSegment)); initWritten = true; }
                output.push(new Uint8Array(segment.data));
            });
        };
        return {
            convert(bytes, { restartAt = null } = {}) {
                if (!transmuxer || restartAt !== null) open(restartAt || 0);
                transmuxer.push(bytes);
                transmuxer.flush();
                const chunks = output;
                output = [];
                return chunks;
            },
            get started() { return produced; }
        };
    }

    // One download of one episode. Calls onProgress({ done, total, bytes, speed, eta }) while running.
    function createJob({ url, fileName, filterAds = true, format = 'mp4', onProgress = () => {} }) {
        const controller = new AbortController();
        const signal = controller.signal;
        const keys = new Map();
        let writer = null;

        async function decrypt(bytes, segment) {
            if (!segment.key) return bytes;
            if (segment.key.method !== 'AES-128') throw new Error(`不支持的加密方式：${segment.key.method}`);
            if (!keys.has(segment.key.uri)) {
                keys.set(segment.key.uri, fetchBytes(segment.key.uri, signal)
                    .then(raw => crypto.subtle.importKey('raw', raw, 'AES-CBC', false, ['decrypt'])));
            }
            const key = await keys.get(segment.key.uri);
            return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv: ivFor(segment.key, segment.sequence) }, key, bytes));
        }

        async function run() {
            const isPlaylist = /\.m3u8(?:$|[?#])/i.test(url);
            const extension = format === 'ts' ? '.ts' : '.mp4';
            const name = `${safeFileName(fileName)}${extension}`;
            // The save dialog must open while the click still counts as a user action.
            writer = await openWriter(name, format === 'ts' ? 'video/mp2t' : 'video/mp4', extension);
            const started = Date.now();
            let bytes = 0;
            const report = (done, total, fraction) => {
                const elapsed = Math.max(0.5, (Date.now() - started) / 1000);
                const speed = bytes / elapsed;
                onProgress({ done, total, bytes, speed, eta: fraction > 0 ? elapsed * (1 - fraction) / fraction : 0, fraction });
            };

            if (!isPlaylist) {
                // A plain video file: stream it straight through.
                const response = await fetch(url, { signal });
                if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
                const total = Number(response.headers.get('content-length')) || 0;
                const reader = response.body.getReader();
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    await writer.write(value);
                    bytes += value.byteLength;
                    report(0, 0, total ? bytes / total : 0);
                }
                await writer.close();
                return { name, bytes, streamed: writer.streamed };
            }

            const segments = await loadMediaPlaylist(url, { signal, filterAds });
            if (segments.some(segment => segment.key && segment.key.method !== 'AES-128')) throw new Error('这个视频使用了不支持的加密方式');
            const fmp4 = Boolean(segments[0].map);
            const remux = !fmp4 && format === 'mp4';
            if (remux) await loadScript(MUX_SCRIPT);
            const remuxer = remux ? createRemuxer() : null;
            const totalSeconds = segments.reduce((sum, segment) => sum + segment.duration, 0) || segments.length;
            const startTimes = [];
            segments.reduce((time, segment, index) => { startTimes[index] = time; return time + segment.duration; }, 0);

            if (fmp4) {
                const init = await fetchBytes(segments[0].map.url, signal, segments[0].map.byterange);
                await writer.write(await decrypt(init, { ...segments[0], key: null }));
            }

            const ready = new Map();
            let nextFetch = 0;
            let nextWrite = 0;
            let doneSeconds = 0;
            let writing = Promise.resolve();
            const waiting = [];
            const wakeFetchers = () => waiting.splice(0).forEach(resolve => resolve());

            const writeReady = () => {
                writing = writing.then(async () => {
                    while (ready.has(nextWrite)) {
                        const data = ready.get(nextWrite);
                        ready.delete(nextWrite);
                        const segment = segments[nextWrite];
                        if (remuxer) {
                            const restartAt = nextWrite === 0 || segment.discontinuity ? startTimes[nextWrite] : null;
                            const chunks = remuxer.convert(data, { restartAt });
                            // Nothing came out of the first segment: mux.js cannot read this stream (e.g. H.265).
                            if (nextWrite === 0 && !remuxer.started) throw Object.assign(new Error('这个视频的编码无法转成 MP4'), { canSaveAsTs: true });
                            for (const chunk of chunks) await writer.write(chunk);
                        } else {
                            await writer.write(data);
                        }
                        doneSeconds += segment.duration || 1;
                        nextWrite++;
                        report(nextWrite, segments.length, doneSeconds / totalSeconds);
                    }
                    wakeFetchers();
                });
                return writing;
            };

            const fetcher = async () => {
                while (nextFetch < segments.length) {
                    if (signal.aborted) throw signal.reason || new DOMException('已取消', 'AbortError');
                    if (nextFetch - nextWrite > AHEAD) {
                        await new Promise(resolve => waiting.push(resolve));
                        continue;
                    }
                    const index = nextFetch++;
                    const segment = segments[index];
                    const data = await decrypt(await fetchBytes(segment.url, signal, segment.byterange), segment);
                    bytes += data.byteLength;
                    ready.set(index, data);
                    await writeReady();
                }
            };
            await Promise.all(Array.from({ length: CONCURRENCY }, fetcher));
            await writing;
            await writer.close();
            return { name, bytes, streamed: writer.streamed, segments: segments.length };
        }

        const promise = run().catch(error => {
            controller.abort();
            writer?.abort();
            throw error;
        });
        return { promise, cancel: () => controller.abort(new DOMException('已取消', 'AbortError')) };
    }

    // ---- 下载面板（页面右下角）----
    let panel = null;
    let job = null;

    function ensurePanel() {
        if (panel) return panel;
        panel = document.createElement('section');
        panel.className = 'download-panel';
        panel.hidden = true;
        panel.setAttribute('role', 'status');
        panel.innerHTML = `
            <div class="download-panel-head"><strong class="download-panel-title"></strong>
                <button type="button" class="download-panel-close" aria-label="关闭">✕</button></div>
            <div class="download-panel-bar"><span></span></div>
            <p class="download-panel-text"></p>
            <div class="download-panel-actions"></div>`;
        document.body.appendChild(panel);
        panel.querySelector('.download-panel-close').onclick = () => {
            if (job) {
                if (!confirm('取消正在进行的下载？')) return;
                job.cancel();
            }
            panel.hidden = true;
        };
        return panel;
    }

    function setPanel({ title, fraction = null, text = '', actions = [] }) {
        const root = ensurePanel();
        root.hidden = false;
        if (title !== undefined) root.querySelector('.download-panel-title').textContent = title;
        const bar = root.querySelector('.download-panel-bar');
        bar.hidden = fraction === null;
        bar.firstElementChild.style.width = `${Math.round(Math.min(1, Math.max(0, fraction || 0)) * 1000) / 10}%`;
        root.querySelector('.download-panel-text').textContent = text;
        const actionBox = root.querySelector('.download-panel-actions');
        actionBox.replaceChildren(...actions.map(([label, onClick, primary]) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = primary ? 'download-panel-primary' : '';
            button.textContent = label;
            button.onclick = onClick;
            return button;
        }));
    }

    const warnBeforeLeaving = event => { event.preventDefault(); event.returnValue = ''; };

    function start({ url, fileName, filterAds = true, format = 'mp4' }) {
        if (job) { ensurePanel().hidden = false; return; }
        if (!url) { window.showToast?.('没有可下载的视频地址', 'error'); return; }
        const label = `下载：${fileName}`;
        setPanel({ title: label, fraction: 0, text: '正在准备…', actions: [['取消', () => job?.cancel()]] });
        job = createJob({
            url, fileName, filterAds, format,
            onProgress: ({ done, total, bytes, speed, eta, fraction }) => setPanel({
                fraction,
                text: [`${Math.floor(fraction * 100)}%`, total ? `${done}/${total} 段` : '', formatBytes(bytes), `${formatBytes(speed)}/秒`, eta > 1 ? `剩余约 ${formatDuration(eta)}` : ''].filter(Boolean).join(' · '),
                actions: [['取消', () => job?.cancel()]]
            })
        });
        window.addEventListener('beforeunload', warnBeforeLeaving);
        job.promise.then(result => {
            setPanel({
                title: '下载完成', fraction: 1,
                text: `${result.name}（${formatBytes(result.bytes)}）${result.streamed ? '已保存到你选择的位置' : '已交给浏览器保存，请在下载列表中查看'}`,
                actions: [['关闭', () => { panel.hidden = true; }, true]]
            });
        }).catch(error => {
            if (error?.name === 'AbortError') {
                // Closing the save dialog also lands here: nothing to report.
                if (panel) panel.hidden = true;
                return;
            }
            const actions = [['重试', () => start({ url, fileName, filterAds, format }), true], ['关闭', () => { panel.hidden = true; }]];
            if (error?.canSaveAsTs) actions.unshift(['改存为 TS', () => start({ url, fileName, filterAds, format: 'ts' }), true]);
            setPanel({ title: '下载失败', fraction: null, text: `${error?.message || error}`, actions });
        }).finally(() => {
            job = null;
            window.removeEventListener('beforeunload', warnBeforeLeaving);
        });
    }

    window.PlayerDownload = {
        start,
        get running() { return Boolean(job); },
        logic: { parsePlaylist, pickVariant, ivFor, safeFileName, parseAttributes, formatBytes, formatDuration, createJob, createRemuxer }
    };
})();
