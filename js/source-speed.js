// Measure how well a source would actually play: download a real media segment,
// separate connection latency from transfer throughput, and compare the
// throughput with the stream bitrate.
(() => {
    const PLAYLIST_MAX_BYTES = 2 * 1024 * 1024;
    const SAMPLE_MAX_BYTES = 2 * 1024 * 1024;
    const PROXY_RANGE_BYTES = 2 * 1024 * 1024;
    // Reading stops this long after the first byte arrives, so slow sources
    // still finish quickly while fast ones transfer enough to leave slow start.
    const SAMPLE_BUDGET_MS = 2500;
    const MIN_WINDOW_MS = 150;
    const MIN_WINDOW_BYTES = 96 * 1024;
    const PLAYLIST_TIMEOUT_MS = 10000;
    const SAMPLE_TIMEOUT_MS = 8000;
    // Index of the segment to sample; the very first ones are often short intros or ads.
    const PREFERRED_SEGMENT_INDEX = 2;

    // Segment downloads run one at a time so sources do not compete for bandwidth.
    let mediaQueue = Promise.resolve();
    function withMediaSlot(task) {
        const run = mediaQueue.then(task, task);
        mediaQueue = run.catch(() => {});
        return run;
    }

    function linkSignals(signal, timeoutMs) {
        const controller = new AbortController();
        const abort = () => controller.abort();
        if (signal?.aborted) controller.abort();
        else signal?.addEventListener('abort', abort, { once: true });
        const timer = setTimeout(abort, timeoutMs);
        return {
            signal: controller.signal,
            timedOut: () => controller.signal.aborted && !signal?.aborted,
            dispose() {
                clearTimeout(timer);
                signal?.removeEventListener('abort', abort);
            }
        };
    }

    async function proxyRequestUrl(targetUrl, probe) {
        const proxyPrefix = typeof PROXY_URL === 'string' ? PROXY_URL : '/proxy/';
        const proxyPath = proxyPrefix + encodeURIComponent(targetUrl);
        const authorizedPath = window.ProxyAuth?.addAuthToProxyUrl
            ? await window.ProxyAuth.addAuthToProxyUrl(proxyPath)
            : proxyPath;
        const proxyUrl = new URL(authorizedPath, window.location?.origin || 'https://libretv.local');
        if (probe) proxyUrl.searchParams.set('probe', '1');
        return proxyUrl.pathname + proxyUrl.search;
    }

    function totalSizeFromHeaders(headers) {
        const contentRange = headers.get('Content-Range') || '';
        const total = Number(contentRange.match(/\/(\d+)\s*$/)?.[1]);
        if (total > 0) return total;
        if (headers.get('Content-Encoding')) return 0;
        return Number(headers.get('Content-Length')) || 0;
    }

    // sample: { budgetMs, maxBytes } overrides the per-sample limits (the quick mode used by 一键优选).
    async function readResponse(targetUrl, signal, { throughProxy, playlist, sample = {} }) {
        const options = { cache: 'no-store', signal };
        let requestUrl = targetUrl;
        if (throughProxy) {
            // Playlists go through the regular proxy (full, rewritten text); media
            // segments use the streaming range probe so the proxy never buffers them.
            requestUrl = await proxyRequestUrl(targetUrl, !playlist);
            if (!playlist) options.headers = { Range: `bytes=0-${PROXY_RANGE_BYTES - 1}` };
        }

        const startedAt = performance.now();
        const response = await fetch(requestUrl, options);
        const headersAt = performance.now();
        if (!response.ok || !response.body) {
            await response.body?.cancel().catch(() => {});
            throw new Error(`媒体请求失败 (${response.status})`);
        }

        const contentType = response.headers.get('Content-Type') || '';
        if (/text\/html|application\/json/i.test(contentType)) {
            await response.body.cancel();
            throw new Error('播放地址返回了错误页面');
        }

        // A media-looking URL can still answer with an HLS playlist.
        const isPlaylist = playlist || /mpegurl/i.test(contentType);
        const maxBytes = isPlaylist ? PLAYLIST_MAX_BYTES : (sample.maxBytes || SAMPLE_MAX_BYTES);
        const budgetMs = sample.budgetMs || SAMPLE_BUDGET_MS;
        const reader = response.body.getReader();
        const chunks = [];
        let bytes = 0;
        let firstChunkAt = 0;
        let firstChunkBytes = 0;
        let lastChunkAt = headersAt;
        try {
            while (bytes < maxBytes) {
                const { value, done } = await reader.read();
                if (done) break;
                if (!value?.length) continue;
                const now = performance.now();
                const chunk = value.subarray(0, maxBytes - bytes);
                if (!firstChunkAt) {
                    firstChunkAt = now;
                    firstChunkBytes = chunk.length;
                }
                if (isPlaylist) chunks.push(chunk);
                bytes += chunk.length;
                lastChunkAt = now;
                if (!isPlaylist && now - firstChunkAt >= budgetMs) break;
            }
        } finally {
            await reader.cancel().catch(() => {});
        }

        return {
            bytes,
            chunks,
            contentType,
            totalSize: totalSizeFromHeaders(response.headers),
            latencyMs: Math.max(1, headersAt - startedAt),
            elapsedMs: Math.max(1, lastChunkAt - startedAt),
            firstChunkAt,
            firstChunkBytes,
            lastChunkAt,
            headersAt,
            isPlaylist,
            transport: throughProxy ? 'proxy' : 'direct'
        };
    }

    async function fetchWithFallback(targetUrl, signal, playlist, sample) {
        try {
            // Playback requests media directly from the viewer's browser, so the
            // direct path is the one that matters; the proxy is only a fallback.
            return await readResponse(targetUrl, signal, { throughProxy: false, playlist, sample });
        } catch (error) {
            if (signal.aborted) throw error;
            return readResponse(targetUrl, signal, { throughProxy: true, playlist, sample });
        }
    }

    function playlistText(sample) {
        const data = new Uint8Array(sample.bytes);
        let offset = 0;
        for (const chunk of sample.chunks) {
            data.set(chunk, offset);
            offset += chunk.length;
        }
        return new TextDecoder().decode(data);
    }

    function resolvePlaylistUrl(reference, baseUrl) {
        // The regular proxy rewrites playlist entries to /proxy/<encoded url>.
        const proxied = /^\/proxy\/([^?#]+)/.exec(reference);
        const resolved = proxied
            ? new URL(decodeURIComponent(proxied[1]))
            : new URL(reference, baseUrl);
        if (!['http:', 'https:'].includes(resolved.protocol)) throw new Error('播放链接无效');
        return resolved.toString();
    }

    function parsePlaylist(content, baseUrl) {
        const lines = content.split(/\r?\n/).map(line => line.trim());
        let bestVariant = '';
        let bestBandwidth = -1;
        const segments = [];
        let pendingDuration = 0;
        let pendingByteLength = 0;
        for (let index = 0; index < lines.length; index++) {
            const line = lines[index];
            if (line.startsWith('#EXT-X-STREAM-INF')) {
                const bandwidth = Number(line.match(/[:,]BANDWIDTH=(\d+)/)?.[1] || 0);
                const variant = lines.slice(index + 1).find(next => next && !next.startsWith('#'));
                if (variant && bandwidth >= bestBandwidth) {
                    bestVariant = variant;
                    bestBandwidth = bandwidth;
                }
            } else if (line.startsWith('#EXTINF:')) {
                pendingDuration = Number.parseFloat(line.slice(8)) || 0;
            } else if (line.startsWith('#EXT-X-BYTERANGE:')) {
                // Byte-range segments share one file, so its size says nothing about a segment.
                pendingByteLength = Number.parseInt(line.slice(17), 10) || 0;
            } else if (line && !line.startsWith('#')) {
                segments.push({ uri: line, duration: pendingDuration, byteLength: pendingByteLength });
                pendingDuration = 0;
                pendingByteLength = 0;
            }
        }

        if (bestVariant) {
            return {
                kind: 'master',
                url: resolvePlaylistUrl(bestVariant, baseUrl),
                bandwidth: bestBandwidth > 0 ? bestBandwidth : 0
            };
        }
        if (segments.length === 0) throw new Error('播放列表没有媒体片段');
        const segment = segments[Math.min(PREFERRED_SEGMENT_INDEX, segments.length - 1)];
        return {
            kind: 'media',
            url: resolvePlaylistUrl(segment.uri, baseUrl),
            duration: segment.duration,
            byteLength: segment.byteLength,
            usesByteRanges: segments.some(item => item.byteLength > 0)
        };
    }

    function throughputBytesPerSecond(sample) {
        // Measure from the first byte onward so connection setup and server
        // think time (reported separately as latency) do not drag the rate down.
        const windowMs = sample.lastChunkAt - sample.firstChunkAt;
        const windowBytes = sample.bytes - sample.firstChunkBytes;
        if (windowMs >= MIN_WINDOW_MS && windowBytes >= MIN_WINDOW_BYTES) {
            return windowBytes * 1000 / windowMs;
        }
        // Too little arrived to time the transfer itself (a small file in one burst): count the whole
        // request including latency, which understates rather than reporting an impossible rate.
        return sample.bytes * 1000 / Math.max(1, sample.elapsedMs);
    }

    function smoothnessVerdict(kbps, bitrateKbps) {
        if (bitrateKbps > 0) {
            const headroom = (kbps * 8) / bitrateKbps;
            if (headroom >= 2) return { verdict: 'smooth', headroom };
            if (headroom >= 1.2) return { verdict: 'ok', headroom };
            return { verdict: 'slow', headroom };
        }
        // Without a known bitrate, judge against a typical 1080p stream (~4 Mbps).
        if (kbps >= 1000) return { verdict: 'smooth', headroom: 0 };
        if (kbps >= 500) return { verdict: 'ok', headroom: 0 };
        return { verdict: 'slow', headroom: 0 };
    }

    async function samplePlaylistChain(episodeUrl, signal, forcePlaylist = false) {
        let url = new URL(episodeUrl);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('播放链接无效');
        if (!forcePlaylist && !/\.m3u8$/i.test(url.pathname)) return { segmentUrl: url.toString(), bandwidth: 0, duration: 0, segmentBytes: 0 };
        let bandwidth = 0;
        for (let depth = 0; depth < 4; depth++) {
            const sample = await fetchWithFallback(url.toString(), signal, true);
            const text = playlistText(sample);
            if (!text.includes('#EXTM3U')) throw new Error('播放列表格式无效');
            const parsed = parsePlaylist(text, url);
            if (parsed.kind === 'media') {
                return {
                    segmentUrl: parsed.url,
                    bandwidth,
                    duration: parsed.duration,
                    // -1: the file size must not be used as the segment size.
                    segmentBytes: parsed.byteLength || (parsed.usesByteRanges ? -1 : 0)
                };
            }
            bandwidth = parsed.bandwidth || bandwidth;
            url = new URL(parsed.url);
        }
        throw new Error('播放列表嵌套过深');
    }

    // quick: a shorter sample (about 1 s, at most 1 MiB) for ranking many sources at once.
    async function probeEpisodeUrl(episodeUrl, { signal, quick = false } = {}) {
        const sampleLimits = quick ? { budgetMs: 1000, maxBytes: 1024 * 1024 } : undefined;
        const playlistGuard = linkSignals(signal, PLAYLIST_TIMEOUT_MS);
        let target;
        try {
            target = await samplePlaylistChain(episodeUrl, playlistGuard.signal);
        } catch (error) {
            if (playlistGuard.timedOut()) throw new Error('测速超时');
            throw error;
        } finally {
            playlistGuard.dispose();
        }

        return withMediaSlot(async () => {
            if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
            const sampleGuard = linkSignals(signal, SAMPLE_TIMEOUT_MS);
            try {
                let sample = await fetchWithFallback(target.segmentUrl, sampleGuard.signal, false, sampleLimits);
                if (sample.isPlaylist) {
                    // The URL looked like media but served a playlist: follow it to a real segment.
                    target = await samplePlaylistChain(target.segmentUrl, sampleGuard.signal, true);
                    sample = await fetchWithFallback(target.segmentUrl, sampleGuard.signal, false, sampleLimits);
                    if (sample.isPlaylist) throw new Error('播放列表嵌套过深');
                }
                if (sample.bytes < 1024) throw new Error('媒体样本过小');
                const kbps = Math.max(1, Math.round(throughputBytesPerSecond(sample) / 1024));
                let bitrateKbps = target.bandwidth > 0 ? Math.round(target.bandwidth / 1000) : 0;
                const segmentBytes = target.segmentBytes === 0 ? sample.totalSize : target.segmentBytes;
                if (!bitrateKbps && target.duration > 0 && segmentBytes > 0) {
                    bitrateKbps = Math.round(segmentBytes * 8 / target.duration / 1000);
                }
                const { verdict, headroom } = smoothnessVerdict(kbps, bitrateKbps);
                return {
                    bytes: sample.bytes,
                    elapsedMs: Math.round(sample.elapsedMs),
                    latencyMs: Math.round(sample.latencyMs),
                    kbps,
                    bitrateKbps,
                    headroom: Math.round(headroom * 10) / 10,
                    verdict,
                    transport: sample.transport
                };
            } catch (error) {
                if (sampleGuard.timedOut()) throw new Error('测速超时');
                throw error;
            } finally {
                sampleGuard.dispose();
            }
        });
    }

    const VERDICT_LABELS = { smooth: '流畅', ok: '较流畅', slow: '可能卡顿' };

    function formatRate(kbps) {
        return kbps >= 1024 ? `${(kbps / 1024).toFixed(1)} MB/s` : `${kbps} KB/s`;
    }

    // Short label plus a tooltip with the details behind it.
    function describeResult(result) {
        const label = `${formatRate(result.kbps)} · ${VERDICT_LABELS[result.verdict] || '已测速'}`;
        const details = [`下载 ${formatRate(result.kbps)}`, `延迟 ${result.latencyMs} ms`];
        if (result.bitrateKbps > 0) {
            details.push(`视频码率 ${(result.bitrateKbps / 1000).toFixed(1)} Mbps`);
            details.push(`余量 ${result.headroom}×`);
        }
        if (result.transport === 'proxy') details.push('经代理测得，直连不可用');
        return { label: result.transport === 'proxy' ? `代理 ${label}` : label, title: details.join(' · ') };
    }

    // Higher is better: smoothness first, then raw throughput, then latency.
    function scoreResult(result) {
        if (!result || !(result.kbps > 0)) return -1;
        const rank = { smooth: 3, ok: 2, slow: 1 }[result.verdict] || 0;
        return rank * 1e9 + result.kbps * 1e3 - Math.min(result.latencyMs || 0, 999);
    }

    window.SourceSpeed = { probeEpisodeUrl, describeResult, scoreResult };
})();
