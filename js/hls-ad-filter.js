// Removes ad breaks that collection sites splice into VOD playlists.
//
// An inserted ad is a short run of segments wrapped in #EXT-X-DISCONTINUITY
// whose files come from somewhere other than the episode itself: another
// directory/host, or (same directory) a different file-name length. Anything
// that does not clearly look like that is left untouched, and when nothing is
// removed the playlist is returned byte-for-byte.
(() => {
    const MAX_BREAK_SECONDS = 120; // a single ad break longer than this is treated as content
    const MAX_AD_SHARE = 0.3; // never drop more than this share of the runtime
    const MAX_BREAKS = 6; // more "breaks" than this means mixed content, not ads
    const MIN_DIR_SHARE = 0.6; // the episode's own directory must clearly dominate
    const MIN_NAME_SHARE = 0.8; // and its file names must share one length

    // Tags that describe only the following segment and go away with it.
    const SEGMENT_TAG = /^#(?:EXTINF|EXT-X-BYTERANGE|EXT-X-PROGRAM-DATE-TIME|EXT-X-GAP)\b/;
    const DISCONTINUITY = /^#EXT-X-DISCONTINUITY\s*$/;

    function parse(text) {
        const items = [];
        let pending = [];
        let duration = 0;
        let block = 0;
        for (const raw of String(text).split(/\r?\n/)) {
            const line = raw.trim();
            if (!line) continue;
            if (DISCONTINUITY.test(line)) {
                if (pending.length) return null; // a tag split from its segment: leave it alone
                items.push({ kind: 'disc' });
                block++;
                continue;
            }
            if (line.startsWith('#')) {
                if (line.startsWith('#EXTINF')) {
                    duration = parseFloat(line.slice(line.indexOf(':') + 1)) || 0;
                }
                if (pending.length || SEGMENT_TAG.test(line)) pending.push(line);
                else items.push({ kind: 'tag', line });
                continue;
            }
            items.push({ kind: 'seg', lines: [...pending, line], uri: line, duration, block });
            pending = [];
            duration = 0;
        }
        if (pending.length) return null;
        return items;
    }

    function locate(uri, baseUrl) {
        const url = new URL(uri, baseUrl || undefined);
        const slash = url.pathname.lastIndexOf('/');
        const name = url.pathname.slice(slash + 1);
        return {
            dir: url.origin + url.pathname.slice(0, slash + 1),
            nameLength: name.length,
            numericName: /^\d+(?:\.[a-z0-9]+)?$/i.test(name)
        };
    }

    function dominant(entries) {
        const totals = new Map();
        let sum = 0;
        for (const [key, weight] of entries) {
            totals.set(key, (totals.get(key) || 0) + weight);
            sum += weight;
        }
        let best = null;
        let bestWeight = 0;
        for (const [key, weight] of totals) {
            if (weight > bestWeight) {
                best = key;
                bestWeight = weight;
            }
        }
        return { key: best, share: sum > 0 ? bestWeight / sum : 0 };
    }

    function findAdBlocks(segments, total) {
        const weight = seg => seg.duration > 0 ? seg.duration : 1;
        const dir = dominant(segments.map(seg => [seg.where.dir, weight(seg)]));
        if (dir.share < MIN_DIR_SHARE) return null;
        const own = segments.filter(seg => seg.where.dir === dir.key);
        const name = dominant(own.map(seg => [seg.where.nameLength, weight(seg)]));
        // Counter names ("9.ts", "10.ts") change length as they grow, so length says nothing there.
        const lengthIsSignature = name.share >= MIN_NAME_SHARE && !own.some(seg => seg.where.numericName);
        const foreign = seg => seg.where.dir !== dir.key ||
            (lengthIsSignature && seg.where.nameLength !== name.key);

        const blocks = new Map();
        for (const seg of segments) {
            if (!blocks.has(seg.block)) blocks.set(seg.block, []);
            blocks.get(seg.block).push(seg);
        }
        const order = [...blocks.keys()].sort((a, b) => a - b);
        const adBlocks = new Set();
        let breaks = 0;
        let breakSeconds = 0;
        let removedSeconds = 0;
        let previousWasAd = false;
        for (const id of order) {
            const list = blocks.get(id);
            const isAd = list.every(foreign);
            if (!isAd) {
                previousWasAd = false;
                continue;
            }
            const seconds = list.reduce((sum, seg) => sum + seg.duration, 0);
            if (!previousWasAd) {
                breaks++;
                breakSeconds = 0;
            }
            breakSeconds += seconds;
            removedSeconds += seconds;
            if (breakSeconds > MAX_BREAK_SECONDS || breaks > MAX_BREAKS) return null;
            adBlocks.add(id);
            previousWasAd = true;
        }
        if (!adBlocks.size || adBlocks.size === order.length || removedSeconds > total * MAX_AD_SHARE) return null;
        return { adBlocks, removedSeconds };
    }

    function filterPlaylist(text, baseUrl) {
        const unchanged = { content: text, removedSegments: 0, removedSeconds: 0 };
        if (typeof text !== 'string' || !text.includes('#EXT-X-DISCONTINUITY')) return unchanged;
        try {
            const items = parse(text);
            if (!items) return unchanged;
            const segments = items.filter(item => item.kind === 'seg');
            if (new Set(segments.map(seg => seg.block)).size < 2) return unchanged;
            const total = segments.reduce((sum, seg) => sum + seg.duration, 0);
            if (!(total > 0)) return unchanged;
            for (const seg of segments) seg.where = locate(seg.uri, baseUrl);

            const found = findAdBlocks(segments, total);
            if (!found) return unchanged;

            const output = [];
            let emittedSegment = false;
            let pendingDiscontinuity = false;
            let removedSegments = 0;
            for (const item of items) {
                if (item.kind === 'tag') {
                    output.push(item.line);
                } else if (item.kind === 'disc') {
                    pendingDiscontinuity = true;
                } else if (found.adBlocks.has(item.block)) {
                    // Keep state-changing tags such as #EXT-X-KEY so later segments decode as before.
                    output.push(...item.lines.slice(0, -1).filter(line => !SEGMENT_TAG.test(line)));
                    removedSegments++;
                } else {
                    if (pendingDiscontinuity && emittedSegment) output.push('#EXT-X-DISCONTINUITY');
                    pendingDiscontinuity = false;
                    output.push(...item.lines);
                    emittedSegment = true;
                }
            }
            return {
                content: output.join('\n') + '\n',
                removedSegments,
                removedSeconds: found.removedSeconds
            };
        } catch (error) {
            console.warn('广告分片识别失败，保留原始播放列表:', error);
            return unchanged;
        }
    }

    window.HlsAdFilter = { filterPlaylist };
})();
