const SEARCH_RESULT_TITLE_FIELDS = [
    'vod_name',
    'vod_sub',
    'vod_en',
    'title',
    'name'
];

function normalizeSearchResultText(value) {
    return String(value || '').toLowerCase().replace(/\s+/g, '');
}

function getSearchResultTitleTexts(item) {
    return SEARCH_RESULT_TITLE_FIELDS
        .map(field => normalizeSearchResultText(item?.[field]))
        .filter(Boolean);
}

function doesSearchResultMatchQuery(item, query) {
    const compactQuery = normalizeSearchResultText(query);
    if (!compactQuery) return true;

    const titleTexts = getSearchResultTitleTexts(item);
    if (titleTexts.some(text => text.includes(compactQuery))) {
        return true;
    }

    const queryTerms = String(query || '')
        .toLowerCase()
        .split(/\s+/)
        .map(normalizeSearchResultText)
        .filter(Boolean);

    return queryTerms.length > 1 && queryTerms.every(term =>
        titleTexts.some(text => text.includes(term))
    );
}

function filterSearchResultsByQuery(results, query) {
    const list = Array.isArray(results) ? results : [];
    return list.filter(item => doesSearchResultMatchQuery(item, query));
}

window.doesResultMatchQuery = window.doesResultMatchQuery || doesSearchResultMatchQuery;
window.filterResultsByQuery = window.filterResultsByQuery || filterSearchResultsByQuery;

function getApiSearchContext(apiId) {
    if (apiId.startsWith('custom_')) {
        const customIndex = apiId.replace('custom_', '');
        const customApi = getCustomApiInfo(customIndex);
        if (!customApi) return null;

        return {
            apiBaseUrl: customApi.url,
            apiName: customApi.name,
            apiUrl: customApi.url,
            isCustom: true
        };
    }

    if (!API_SITES[apiId]) return null;

    return {
        apiBaseUrl: API_SITES[apiId].api,
        apiName: API_SITES[apiId].name,
        apiUrl: undefined,
        isCustom: false
    };
}

function withSourceInfo(item, apiId, context) {
    return {
        ...item,
        vod_pic: normalizeImageUrl(item.vod_pic, context.apiBaseUrl),
        source_name: context.apiName,
        source_code: apiId,
        api_url: context.apiUrl
    };
}

async function fetchVodApiJson(apiUrl, headers = API_CONFIG.search.headers, outerSignal) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    outerSignal?.addEventListener('abort', abort, {once:true});
    if (outerSignal?.aborted) controller.abort();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
        const proxiedUrl = await window.ProxyAuth?.addAuthToProxyUrl ?
            await window.ProxyAuth.addAuthToProxyUrl(PROXY_URL + encodeURIComponent(apiUrl)) :
            PROXY_URL + encodeURIComponent(apiUrl);

        const response = await fetch(proxiedUrl, {
            headers,
            signal: controller.signal
        });

        if (!response.ok) {
            return null;
        }

        return await response.json();
    } finally {
        clearTimeout(timeoutId);
        outerSignal?.removeEventListener('abort', abort);
    }
}

function normalizeApiList(data, apiId, context) {
    if (!data || !Array.isArray(data.list)) return [];
    window.SourceHosts?.learnItems(data.list);
    return data.list.map(item => withSourceInfo(item, apiId, context));
}

async function searchByAPIAndKeyWord(apiId, query, onBatch, signal) {
    try {
        const context = getApiSearchContext(apiId);
        if (!context) return [];

        const apiUrl = context.apiBaseUrl + API_CONFIG.search.path + encodeURIComponent(query);
        const data = await fetchVodApiJson(apiUrl, API_CONFIG.search.headers, signal);
        
        if (!data || !data.list || !Array.isArray(data.list) || data.list.length === 0) {
            return [];
        }
        
        // 处理第一页结果
        const firstPageResults = normalizeApiList(data, apiId, context);
        const results = filterSearchResultsByQuery(firstPageResults, query);
        if (results.length && !signal?.aborted) onBatch?.([...results]);
        if (firstPageResults.length > 0 && results.length === 0) {
            return [];
        }
        
        // 获取总页数
        const pageCount = data.pagecount || 1;
        // 确定需要获取的额外页数 (最多获取maxPages页)
        const pagesToFetch = Math.min(pageCount - 1, API_CONFIG.search.maxPages - 1);
        
        // 额外页限并发拉取，按页码顺序合并，避免一次对同一源打出大量请求
        if (pagesToFetch > 0) {
            const pageResults = [];
            let nextPage = 2;
            const lastPage = pagesToFetch + 1;
            const worker = async () => {
                while (nextPage <= lastPage && !signal?.aborted) {
                    const page = nextPage++;
                    const pageUrl = context.apiBaseUrl + API_CONFIG.search.pagePath
                        .replace('{query}', encodeURIComponent(query))
                        .replace('{page}', page);
                    try {
                        const pageData = await fetchVodApiJson(pageUrl, API_CONFIG.search.headers, signal);
                        if (!pageData || !Array.isArray(pageData.list)) continue;
                        const batch = filterSearchResultsByQuery(normalizeApiList(pageData, apiId, context), query);
                        pageResults[page] = batch;
                        if (batch.length && !signal?.aborted) onBatch?.(batch);
                    } catch (error) {
                        if (!signal?.aborted) console.warn(`API ${apiId} 第${page}页搜索失败:`, error);
                    }
                }
            };
            const concurrency = Math.max(1, API_CONFIG.search.pageConcurrency || 3);
            await Promise.all(Array.from({ length: Math.min(concurrency, pagesToFetch) }, worker));
            pageResults.forEach(batch => {
                if (batch?.length) results.push(...batch);
            });
        }
        
        return results;
    } catch (error) {
        console.warn(`API ${apiId} 搜索失败:`, error);
        return [];
    }
}

async function fetchLatestByAPI(apiId, page = 1) {
    try {
        const context = getApiSearchContext(apiId);
        if (!context) return [];

        const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
        const pageUrl = `${context.apiBaseUrl}?ac=videolist&pg=${safePage}`;
        const data = await fetchVodApiJson(pageUrl);
        return normalizeApiList(data, apiId, context);
    } catch (error) {
        console.warn(`API ${apiId} 最新列表获取失败:`, error);
        return [];
    }
}

window.fetchLatestByAPI = fetchLatestByAPI;
