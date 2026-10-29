// 全局常量配置
const PROXY_URL = '/proxy/';    // 适用于 Cloudflare, Netlify (带重写), Vercel (带重写)
// const HOPLAYER_URL = 'https://hoplayer.com/index.html';
const SEARCH_HISTORY_KEY = 'videoSearchHistory';
const MAX_HISTORY_ITEMS = 5;

// 密码保护配置
// 注意：PASSWORD 环境变量是必需的，所有部署都必须设置密码以确保安全
const PASSWORD_CONFIG = {
    localStorageKey: 'passwordVerified',  // 存储验证状态的键名
    verificationTTL: 90 * 24 * 60 * 60 * 1000  // 验证有效期（90天，约3个月）
};

// 网站信息配置
const SITE_CONFIG = {
    name: 'LibreTV',
    url: '',
    description: '免费在线视频搜索与观看平台',
    logo: 'image/logo.png',
    version: '1.2.47'
};

const DEFAULT_SELECTED_APIS = ['ysgc', 'ffzy', 'bfzy', 'jszy', 'wujin'];
const DEFAULT_API_MIGRATION_KEY = 'defaultApiMigrationVersion';
const DEFAULT_API_MIGRATION_VERSION = '20261028-sources-v3';

function escapeHtmlAttr(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// 内联事件处理器（onclick="fn(...)"）里的参数必须先转成 JS 字面量再做属性转义，
// 否则片名里的单引号会截断代码，源站返回的恶意片名还能注入脚本。
function inlineJsArg(value) {
    return escapeHtmlAttr(JSON.stringify(String(value ?? '')));
}

function normalizeImageUrl(rawUrl, baseUrl = '') {
    const value = String(rawUrl || '').trim();
    if (!value) return '';

    if (value.startsWith('//')) {
        return `https:${value}`;
    }

    if (/^https?:\/\//i.test(value)) {
        return value;
    }

    if (baseUrl) {
        try {
            return new URL(value, baseUrl).toString();
        } catch (error) {
            console.warn('图片地址规范化失败:', value, error);
        }
    }

    return '';
}

function createImagePlaceholder(text = '无封面') {
    const safeText = String(text || '无封面').slice(0, 12);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450"><rect width="300" height="450" fill="#111827"/><path d="M75 170h150v110H75z" fill="#1f2937" stroke="#4b5563" stroke-width="4"/><path d="m95 252 43-48 32 36 23-26 32 38" fill="none" stroke="#6b7280" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="197" cy="200" r="13" fill="#6b7280"/><text x="150" y="325" fill="#9ca3af" font-size="28" text-anchor="middle" font-family="Arial, sans-serif">${safeText}</text></svg>`;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function setImagePlaceholder(img, text = '无封面') {
    if (!img) return;
    img.onerror = null;
    img.src = createImagePlaceholder(text);
    img.classList.add('object-contain');
}

async function setImageProxyFallback(img, originalUrl, fallbackText = '无封面') {
    if (!img) return;

    const normalizedUrl = normalizeImageUrl(originalUrl);
    if (!normalizedUrl || img.dataset.proxyFallbackTried === 'true') {
        setImagePlaceholder(img, fallbackText);
        return;
    }

    img.dataset.proxyFallbackTried = 'true';

    try {
        const proxyUrl = PROXY_URL + encodeURIComponent(normalizedUrl);
        img.src = window.ProxyAuth?.addAuthToProxyUrl
            ? await window.ProxyAuth.addAuthToProxyUrl(proxyUrl)
            : proxyUrl;
    } catch (error) {
        console.warn('图片代理回退失败:', normalizedUrl, error);
        setImagePlaceholder(img, fallbackText);
    }
}

function getCustomApiInfo(customApiIndex) {
    try {
        const customAPIs = JSON.parse(localStorage.getItem('customAPIs') || '[]');
        return customAPIs[parseInt(customApiIndex, 10)] || null;
    } catch (error) {
        console.error('读取自定义API失败:', error);
        return null;
    }
}

// API站点配置
const API_SITES = {};
//ARCHIVE https://telegra.ph/APIs-08-12

// 定义合并方法
function extendAPISites(newSites) {
    Object.assign(API_SITES, newSites);
}

// 暴露到全局
window.API_SITES = API_SITES;
window.extendAPISites = extendAPISites;
window.PROXY_URL = PROXY_URL;
window.SITE_CONFIG = SITE_CONFIG;
window.DEFAULT_SELECTED_APIS = DEFAULT_SELECTED_APIS;
window.DEFAULT_API_MIGRATION_KEY = DEFAULT_API_MIGRATION_KEY;
window.DEFAULT_API_MIGRATION_VERSION = DEFAULT_API_MIGRATION_VERSION;
window.escapeHtmlAttr = escapeHtmlAttr;
window.inlineJsArg = inlineJsArg;
window.normalizeImageUrl = normalizeImageUrl;
window.setImageProxyFallback = setImageProxyFallback;
window.setImagePlaceholder = setImagePlaceholder;
window.getCustomApiInfo = getCustomApiInfo;


// 添加聚合搜索的配置选项
const AGGREGATED_SEARCH_CONFIG = {
    enabled: true,             // 是否启用聚合搜索
    timeout: 8000,            // 单个源超时时间（毫秒）
    maxResults: 10000,          // 最大结果数量
    parallelRequests: true,   // 是否并行请求所有源
    showSourceBadges: true    // 是否显示来源徽章
};

// 抽象API请求配置
const API_CONFIG = {
    search: {
        // 只拼接参数部分，不再包含 /api.php/provide/vod/
        path: '?ac=videolist&wd=',
        pagePath: '?ac=videolist&wd={query}&pg={page}',
        // 每页都带完整播放地址；宽泛关键词翻满 50 页会对每个源打出几十个并发代理请求，容易被源站限流
        maxPages: 10, // 最大获取页数（约 200 条）
        pageConcurrency: 3, // 单个源同时请求的翻页数
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'application/json'
        }
    },
    detail: {
        // 只拼接参数部分
        path: '?ac=videolist&ids=',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'application/json'
        }
    }
};

// 优化后的正则表达式模式
const M3U8_PATTERN = /\$https?:\/\/[^"'\s]+?\.m3u8/g;

// 添加自定义播放器URL
const CUSTOM_PLAYER_URL = 'player.html'; // 使用相对路径引用本地player.html

// 增加视频播放相关配置
const PLAYER_CONFIG = {
    autoplay: true,
    allowFullscreen: true,
    width: '100%',
    height: '600',
    timeout: 15000,  // 播放器加载超时时间
    filterAds: true,  // 是否启用广告过滤
    autoPlayNext: true,  // 默认启用自动连播功能
    adFilteringEnabled: true, // 默认开启分片广告过滤
    adFilteringStorage: 'adFilteringEnabled' // 存储广告过滤设置的键名
};

// 增加错误信息本地化
const ERROR_MESSAGES = {
    NETWORK_ERROR: '网络连接错误，请检查网络设置',
    TIMEOUT_ERROR: '请求超时，服务器响应时间过长',
    API_ERROR: 'API接口返回错误，请尝试更换数据源',
    PLAYER_ERROR: '播放器加载失败，请尝试其他视频源',
    UNKNOWN_ERROR: '发生未知错误，请刷新页面重试'
};

// 添加进一步安全设置
const SECURITY_CONFIG = {
    enableXSSProtection: true,  // 是否启用XSS保护
    sanitizeUrls: true,         // 是否清理URL
    maxQueryLength: 100,        // 最大搜索长度
    // allowedApiDomains 不再需要，因为所有请求都通过内部代理
};

// 添加多个自定义API源的配置
const CUSTOM_API_CONFIG = {
    separator: ',',           // 分隔符
    maxSources: 5,            // 最大允许的自定义源数量
    testTimeout: 5000,        // 测试超时时间(毫秒)
    namePrefix: 'Custom-',    // 自定义源名称前缀
    validateUrl: true,        // 验证URL格式
    cacheResults: true,       // 缓存测试结果
    cacheExpiry: 5184000000,  // 缓存过期时间(2个月)
    adultPropName: 'isAdult' // 用于标记成人内容的属性名
};

// 隐藏内置黄色采集站API的变量
const HIDE_BUILTIN_ADULT_APIS = false;
