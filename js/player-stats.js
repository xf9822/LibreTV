// 播放器「统计信息」：仿 YouTube「详细统计信息」，显示正在播放什么、网络多快、缓冲了多少。
// Opens from the right-click menu or the player settings; refreshed once a second while open.
(() => {
    const HISTORY = 60; // seconds shown in each graph
    const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

    function formatBits(bps) {
        const value = Number(bps);
        if (!(value > 0)) return '—';
        return value >= 1e6 ? `${(value / 1e6).toFixed(value >= 1e7 ? 0 : 1)} Mbps` : `${Math.round(value / 1e3)} Kbps`;
    }

    function formatBytes(bytes) {
        const value = Number(bytes);
        if (!(value > 0)) return '0 KB';
        return value >= 1048576 ? `${(value / 1048576).toFixed(value >= 104857600 ? 0 : 1)} MB` : `${Math.max(1, Math.round(value / 1024))} KB`;
    }

    function formatClock(seconds) {
        const value = Math.max(0, Math.floor(Number(seconds) || 0));
        const h = Math.floor(value / 3600);
        const m = Math.floor(value / 60) % 60;
        const s = String(value % 60).padStart(2, '0');
        return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
    }

    // Seconds buffered ahead of the playhead (0 when the playhead is outside every buffered range).
    function bufferAhead(video) {
        const ranges = video?.buffered;
        const time = Number(video?.currentTime) || 0;
        if (!ranges) return 0;
        for (let i = 0; i < ranges.length; i++) {
            if (ranges.start(i) <= time + 0.1 && ranges.end(i) >= time) return Math.max(0, ranges.end(i) - time);
        }
        return 0;
    }

    // "avc1.64001f" → "avc1.64001f (H.264)": the family name is what most people recognise.
    function codecName(codec) {
        const value = String(codec || '').trim();
        if (!value) return '';
        const family = /^(avc|h264)/i.test(value) ? 'H.264' : /^(hev|hvc|h265)/i.test(value) ? 'H.265' : /^av01/i.test(value) ? 'AV1'
            : /^vp0?9/i.test(value) ? 'VP9' : /^mp4a\.40\.(2|5|29)/i.test(value) ? 'AAC' : /^(ac-3|ec-3)/i.test(value) ? 'Dolby' : /^mp3|mp4a\.6b/i.test(value) ? 'MP3' : /^opus/i.test(value) ? 'Opus' : '';
        return family ? `${value} (${family})` : value;
    }

    // Codec strings from hls.js may be muxed ("opus,vp09.00.31.08"): split them into the video and the audio codec.
    function splitCodecs(values) {
        const result = { video: '', audio: '' };
        for (const codec of values.flatMap(value => String(value || '').split(',')).map(value => value.trim()).filter(Boolean)) {
            const kind = /^(avc|h264|hev|hvc|h265|av01|vp0?[89])/i.test(codec) ? 'video' : 'audio';
            if (!result[kind]) result[kind] = codecName(codec);
        }
        return result;
    }

    // Everything the network side reports for one HLS instance (one episode).
    function createTracker(now = () => Date.now()) {
        const state = { fragments: 0, bytes: 0, mediaSeconds: 0, loadMs: 0, firstByteMs: 0, codecs: {}, recent: [], ads: null, host: '' };
        return {
            fragment({ bytes = 0, duration = 0, loadMs = 0, firstByteMs = 0, url = '' } = {}) {
                state.fragments++;
                state.bytes += bytes;
                state.mediaSeconds += duration;
                state.loadMs += loadMs;
                state.firstByteMs += firstByteMs;
                state.recent.push({ at: now(), bytes });
                if (state.recent.length > 200) state.recent.shift();
                try { if (url) state.host = new URL(url).hostname; } catch { /* relative or invalid URL */ }
            },
            codecs(tracks) { state.codecs = { ...state.codecs, ...tracks }; },
            ads(result) { state.ads = result; },
            // Bytes received during the last second, for the network activity graph.
            bytesLastSecond() {
                const since = now() - 1000;
                return state.recent.filter(entry => entry.at > since).reduce((sum, entry) => sum + entry.bytes, 0);
            },
            summary() {
                const count = state.fragments || 1;
                return {
                    fragments: state.fragments,
                    bytes: state.bytes,
                    // Measured bitrate of the stream itself: what was downloaded per second of video.
                    mediaBitrate: state.mediaSeconds > 0 ? state.bytes * 8 / state.mediaSeconds : 0,
                    averageSegment: state.fragments ? state.mediaSeconds / state.fragments : 0,
                    averageLoadMs: state.fragments ? state.loadMs / count : 0,
                    averageFirstByteMs: state.fragments ? state.firstByteMs / count : 0,
                    codecs: state.codecs,
                    ads: state.ads,
                    host: state.host
                };
            }
        };
    }

    // hls.js FRAG_LOADED stats → tracker fields.
    function fragmentStats(data) {
        const frag = data?.frag || {};
        const stats = frag.stats || data?.stats || {};
        const loading = stats.loading || {};
        return {
            bytes: Number(stats.loaded || stats.total || data?.payload?.byteLength || 0),
            duration: Number(frag.duration) || 0,
            loadMs: loading.end > loading.start ? loading.end - loading.start : 0,
            firstByteMs: loading.first > loading.start ? loading.first - loading.start : 0,
            url: frag.url || ''
        };
    }

    function sparkline(canvas, values, color) {
        const context = canvas.getContext?.('2d');
        if (!context) return;
        const ratio = window.devicePixelRatio || 1;
        const width = canvas.clientWidth || 120;
        const height = canvas.clientHeight || 18;
        if (canvas.width !== Math.round(width * ratio)) { canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); }
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.clearRect(0, 0, width, height);
        const max = Math.max(...values, 1e-9);
        const step = width / HISTORY;
        context.fillStyle = color;
        values.slice(-HISTORY).forEach((value, index, list) => {
            const barHeight = Math.max(value > 0 ? 1 : 0, value / max * height);
            context.fillRect(width - (list.length - index) * step, height - barHeight, Math.max(1, step - 0.5), barHeight);
        });
    }

    function createPanel(host, { getVideo, getHls, getTracker, getInfo }) {
        const panel = document.createElement('div');
        panel.className = 'player-stats-panel';
        panel.hidden = true;
        panel.dataset.videoInteractive = 'true';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', '统计信息');
        panel.innerHTML = `
            <div class="player-stats-head"><strong>统计信息</strong>
                <button type="button" class="player-stats-close" aria-label="关闭统计信息">✕</button></div>
            <dl class="player-stats-rows"></dl>`;
        host.appendChild(panel);
        const rows = panel.querySelector('.player-stats-rows');
        const graphs = { speed: [], network: [], buffer: [] };
        let timer = null;

        const graphRow = (key, label, value, note) => `<dt>${label}</dt><dd><span class="player-stats-graph-value">${escapeHtml(value)}</span>
            <canvas class="player-stats-graph" data-graph="${key}" aria-hidden="true"></canvas>${note ? `<small>${escapeHtml(note)}</small>` : ''}</dd>`;

        function render() {
            const video = getVideo();
            if (!video) return;
            const hls = getHls();
            const tracker = getTracker();
            const info = getInfo() || {};
            const summary = tracker?.summary() || null;
            const levels = Array.isArray(hls?.levels) ? hls.levels : [];
            const level = levels[hls?.currentLevel >= 0 ? hls.currentLevel : hls?.loadLevel] || levels[0] || null;
            const best = levels.reduce((top, item) => (item.height || 0) > (top?.height || 0) ? item : top, null);
            const quality = video.getVideoPlaybackQuality?.() || {};
            const ahead = bufferAhead(video);
            const speed = Number(hls?.bandwidthEstimate) || 0;
            const network = tracker?.bytesLastSecond() || 0;

            graphs.speed.push(speed);
            graphs.network.push(network);
            graphs.buffer.push(ahead);
            Object.values(graphs).forEach(list => { if (list.length > HISTORY) list.shift(); });

            const codecs = summary?.codecs || {};
            const { video: videoCodec, audio: audioCodec } = splitCodecs([codecs.video?.codec, codecs.audio?.codec, codecs.audiovideo?.codec, level?.videoCodec, level?.audioCodec]);
            const viewport = `${Math.round(host.clientWidth)}×${Math.round(host.clientHeight)}${window.devicePixelRatio > 1 ? ` ×${window.devicePixelRatio}` : ''}`;
            const frames = quality.totalVideoFrames ? ` / 丢帧 ${quality.droppedVideoFrames || 0}，共 ${quality.totalVideoFrames}` : '';
            const current = video.videoWidth ? `${video.videoWidth}×${video.videoHeight}` : '—';
            const levelBitrate = Number(level?.bitrate) || 0;
            const bitrate = summary?.mediaBitrate || levelBitrate;
            const ads = summary?.ads;
            const versions = [window.Artplayer?.version && `ArtPlayer ${window.Artplayer.version}`, window.Hls?.version && hls && `hls.js ${window.Hls.version}`].filter(Boolean).join(' · ');

            const list = [
                ['视频', [info.title, info.episode].filter(Boolean).join(' · ') || '—'],
                ['资源站', [info.source, summary?.host].filter(Boolean).join(' · ') || '—'],
                ['视口 / 丢帧', viewport + frames],
                ['当前 / 最高分辨率', best?.height && levels.length > 1 ? `${current} / ${best.width}×${best.height}` : current],
                ['编码', [videoCodec, audioCodec].filter(Boolean).join(' / ') || '—'],
                ['码率', bitrate ? `${formatBits(bitrate)}${summary?.mediaBitrate ? '（实测）' : ''}` : '—'],
                ['音量 / 倍速', `${video.muted ? '静音' : `${Math.round((video.volume || 0) * 100)}%`} / ${video.playbackRate || 1}x`]
            ];
            if (info.enhance) list.push(['画质增强', info.enhance]);
            let html = list.map(([label, value]) => `<dt>${label}</dt><dd>${escapeHtml(value)}</dd>`).join('');
            if (hls) {
                html += graphRow('speed', '连接速度', formatBits(speed), '');
                html += graphRow('network', '网络活动', `${formatBytes(network)}/秒`, '');
                html += graphRow('buffer', '缓冲健康度', `${ahead.toFixed(1)} 秒`, ahead < 3 && !video.paused ? '即将卡顿' : '');
                html += `<dt>分片</dt><dd>${summary?.fragments ? escapeHtml(`已加载 ${summary.fragments} 个，平均 ${summary.averageSegment.toFixed(1)} 秒/个；首字节 ${Math.round(summary.averageFirstByteMs)} ms，下载 ${Math.round(summary.averageLoadMs)} ms`) : '—'}</dd>`;
                html += `<dt>本集已下载</dt><dd>${escapeHtml(formatBytes(summary?.bytes))}</dd>`;
                html += `<dt>广告过滤</dt><dd>${escapeHtml(ads?.removedSegments ? `已去掉 ${ads.removedSegments} 个分片（约 ${Math.round(ads.removedSeconds)} 秒）` : '未发现广告')}</dd>`;
            } else {
                html += graphRow('buffer', '缓冲健康度', `${ahead.toFixed(1)} 秒`, '');
                html += '<dt>网络</dt><dd>系统原生播放，浏览器不提供网络统计</dd>';
            }
            html += `<dt>进度</dt><dd>${escapeHtml(`${formatClock(video.currentTime)} / ${formatClock(video.duration)}`)}</dd>`;
            if (versions) html += `<dt>播放器</dt><dd>${escapeHtml(versions)}</dd>`;
            rows.innerHTML = html;
            rows.querySelectorAll('canvas[data-graph]').forEach(canvas => {
                sparkline(canvas, graphs[canvas.dataset.graph], canvas.dataset.graph === 'buffer' ? '#34d399' : canvas.dataset.graph === 'speed' ? '#a78bfa' : '#60a5fa');
            });
        }

        function loop() {
            render();
            timer = setTimeout(loop, 1000);
        }
        function show() {
            if (!panel.hidden) return;
            panel.hidden = false;
            loop();
        }
        function hide() {
            panel.hidden = true;
            clearTimeout(timer);
            timer = null;
        }
        // Keep clicks and taps inside the panel away from the player (pause, gestures, controls toggling).
        const stop = event => event.stopPropagation();
        const onClick = event => {
            stop(event);
            if (event.target.closest('.player-stats-close')) hide();
        };
        const onKey = event => { if (event.key === 'Escape' && !panel.hidden) { event.stopPropagation(); hide(); } };
        panel.addEventListener('click', onClick);
        panel.addEventListener('dblclick', stop);
        panel.addEventListener('keydown', onKey);
        return {
            show, hide,
            toggle() { if (panel.hidden) show(); else hide(); },
            get isOpen() { return !panel.hidden; },
            destroy() { hide(); panel.removeEventListener('click', onClick); panel.removeEventListener('dblclick', stop); panel.removeEventListener('keydown', onKey); panel.remove(); }
        };
    }

    window.PlayerStats = { createPanel, createTracker, fragmentStats, logic: { formatBits, formatBytes, formatClock, bufferAhead, codecName, splitCodecs } };
})();
