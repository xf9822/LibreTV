#!/usr/bin/env node
// Evaluate collection APIs before adding or removing built-in sources.
//
//   node scripts/evaluate-sources.mjs                         # every source in js/customer_site.js
//   node scripts/evaluate-sources.mjs --candidates more.json  # plus candidates: {"id": ["名称", "https://…/api.php/provide/vod"]}
//   node scripts/evaluate-sources.mjs --json report.json      # also write the raw results
//
// Behind a proxy, run with NODE_USE_ENV_PROXY=1 (Node 22.21+). Video CDNs often only serve mainland
// China, so the m3u8/segment columns are only meaningful when run from there; search results are not.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : ''; };

// Popular titles across kinds; a good source finds most of them.
const QUERIES = [['庆余年第二季', 2024], ['流浪地球2', 2023], ['繁花', 2023], ['哪吒之魔童闹海', 2025], ['凡人修仙传', 2020], ['奔跑吧', 0]];
const PLAYABLE = /https?:\/\/[^#$\s]+?\.m3u8[^#$\s]*/i;
const FORBIDDEN = /forbid|不支持搜索|禁止搜索|关闭搜索/i;
const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[\s·・:：,，.。!！?？'"“”‘’\-—_]+/g, '');

function builtInSources() {
    const sandbox = { window: { extendAPISites(sites) { Object.assign(sandbox.sites, sites); } }, console, sites: {} };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'js/customer_site.js'), 'utf8'), sandbox);
    return Object.fromEntries(Object.entries(sandbox.sites).map(([id, site]) => [id, { name: site.name, api: site.api, adult: Boolean(site.adult), family: site.family || '', group: 'built-in' }]));
}

function candidateSources(file) {
    if (!file) return {};
    const list = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Object.fromEntries(Object.entries(list).map(([id, [name, api]]) => [id, { name, api, adult: false, family: '', group: 'candidate' }]));
}

async function get(url, ms = 10000, headers = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    const started = Date.now();
    try {
        const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0 Safari/537.36', ...headers } });
        return { status: response.status, body: await response.text(), ms: Date.now() - started };
    } catch (error) {
        return { status: 0, error: error.cause?.code || error.name, ms: Date.now() - started };
    } finally {
        clearTimeout(timer);
    }
}

async function evaluate(id, source) {
    const result = { id, ...source, hits: 0, answered: 0, latencyMs: 0, library: null, updated: '', playlist: '', segment: '', adBreaks: null, note: '' };
    const latencies = [];
    let sample = '';
    for (const [title, year] of source.adult ? [['test', 0]] : QUERIES) {
        const response = await get(`${source.api}?ac=videolist&wd=${encodeURIComponent(title)}`);
        latencies.push(response.ms);
        let data;
        try { data = JSON.parse(response.body); } catch {
            result.note ||= response.status ? `不是 JSON（HTTP ${response.status}）` : `连不上（${response.error}）`;
            continue;
        }
        result.answered++;
        if (FORBIDDEN.test(String(data.msg || ''))) result.note ||= `关闭了搜索：${data.msg}`;
        if (source.adult) { if (Array.isArray(data.list)) result.hits++; continue; }
        const hit = (data.list || []).find(item => normalize(item.vod_name).startsWith(normalize(title)) &&
            (!year || Math.abs(Number(String(item.vod_year).slice(0, 4)) - year) <= 1) && PLAYABLE.test(item.vod_play_url || ''));
        if (hit) {
            result.hits++;
            sample ||= hit.vod_play_url.match(PLAYABLE)[0];
        }
    }
    result.latencyMs = latencies.sort((a, b) => a - b)[Math.floor(latencies.length / 2)] || 0;
    const page = await get(`${source.api}?ac=videolist&pg=1`);
    try {
        const data = JSON.parse(page.body);
        result.library = Number(data.total) || null;
        result.updated = (data.list || []).map(item => item.vod_time || '').sort().pop()?.slice(0, 10) || '';
    } catch { /* listing unavailable */ }
    if (sample) {
        let url = sample;
        let playlist = await get(url, 8000);
        if (playlist.body?.includes('#EXT-X-STREAM-INF')) {
            url = new URL(playlist.body.split('\n').find(line => line && !line.startsWith('#')).trim(), url).href;
            playlist = await get(url, 8000);
        }
        result.playlist = playlist.body?.startsWith('#EXTM3U') ? 'ok' : String(playlist.status || playlist.error);
        if (result.playlist === 'ok') {
            result.adBreaks = (playlist.body.match(/#EXT-X-DISCONTINUITY\s*\n/g) || []).length;
            const segment = playlist.body.split('\n').find(line => line && !line.startsWith('#'));
            if (segment) {
                const response = await get(new URL(segment.trim(), url).href, 8000, { Range: 'bytes=0-4095' });
                result.segment = String(response.status || response.error);
            }
        }
    }
    return result;
}

const sources = { ...builtInSources(), ...candidateSources(option('--candidates')) };
const entries = Object.entries(sources);
const results = [];
let next = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
    while (next < entries.length) {
        const [id, source] = entries[next++];
        results.push(await evaluate(id, source));
        process.stderr.write('.');
    }
}));
process.stderr.write('\n');

const total = QUERIES.length;
results.sort((a, b) => a.group.localeCompare(b.group) || Number(a.adult) - Number(b.adult) || b.hits - a.hits || a.latencyMs - b.latencyMs);
for (const r of results) {
    console.log([
        r.group === 'built-in' ? '内置' : '候选', r.id, r.name + (r.adult ? '（成人）' : '') + (r.family ? `［${r.family}］` : ''),
        r.adult ? `接口${r.hits ? '正常' : '异常'}` : `命中 ${r.hits}/${total}`, `${r.latencyMs}ms`, `片库 ${r.library ?? '-'}`, `更新 ${r.updated || '-'}`,
        `m3u8 ${r.playlist || '-'}`, `分片 ${r.segment || '-'}`, `广告段 ${r.adBreaks ?? '-'}`, r.note
    ].join(' | '));
}
if (option('--json')) fs.writeFileSync(option('--json'), JSON.stringify(results, null, 2));
