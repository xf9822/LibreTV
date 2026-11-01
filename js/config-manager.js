const CONFIG_EXPORT_VERSION = '2.0.0';
const CONFIG_SCHEMA_NAME = 'LibreTV-Settings';
const CONFIG_STORAGE_KEYS = [
    'selectedAPIs',
    'customAPIs',
    'yellowFilterEnabled',
    'adFilteringEnabled',
    'doubanEnabled',
    'hasInitializedDefaults',
    'defaultApiMigrationVersion',
    'viewingHistory',
    'videoSearchHistory',
    'firstRunGuideSeen',
    'sourceHealthReport',
    'sourceHealthCheckedAt',
    'watchLaterV1',
    'userMovieTags',
    'userTvTags',
    'doubanFilterV1',
    'autoplayEnabled',
    'danmakuMode',
    'videoEnhanceMode',
    'libretvPlaybackRate',
    'libretvSkipMarks',
    'sourceAutopilotV1',
    'sourceHealthHistoryV1',
    'sourcePlaybackQualityV1',
    'sourceBenchmarkV1'
];

// 导入时按类型检查：格式不对的项跳过，不写进本地存储（否则页面读取时会出错）
const isText = value => typeof value === 'string';
const CONFIG_SHAPES = {
    selectedAPIs: value => Array.isArray(value) && value.every(isText),
    customAPIs: value => Array.isArray(value) && value.every(api => api && typeof api === 'object' &&
        isText(api.url) && /^https?:\/\//i.test(api.url) && (api.name === undefined || isText(api.name)) &&
        (api.detail === undefined || api.detail === '' || (isText(api.detail) && /^https?:\/\//i.test(api.detail)))),
    viewingHistory: value => Array.isArray(value) && value.every(item => item && typeof item === 'object' &&
        (item.episodeIndex === undefined || Number.isInteger(item.episodeIndex))),
    videoSearchHistory: Array.isArray,
    watchLaterV1: Array.isArray,
    userMovieTags: value => Array.isArray(value) && value.every(isText),
    userTvTags: value => Array.isArray(value) && value.every(isText)
};

function isValidConfigValue(key, text) {
    const check = CONFIG_SHAPES[key];
    if (!check) return true;
    try { return check(JSON.parse(text)); } catch (error) { return false; }
}

const allowedKeys = new Set(CONFIG_STORAGE_KEYS);

function getConfigHash(data) {
    const payload = JSON.stringify(data || {});
    if (typeof sha256 === 'function') {
        return sha256(payload);
    }
    if (typeof window !== 'undefined' && typeof window._jsSha256 === 'function') {
        return window._jsSha256(payload);
    }
    throw new Error('No SHA-256 implementation available.');
}

function collectConfigData(storage = localStorage) {
    const data = {};
    CONFIG_STORAGE_KEYS.forEach(key => {
        const value = storage.getItem(key);
        if (value !== null) {
            data[key] = value;
        }
    });
    return data;
}

async function buildConfigExport(storage = localStorage) {
    const time = Date.now().toString();
    const data = collectConfigData(storage);
    return {
        name: CONFIG_SCHEMA_NAME,
        version: CONFIG_EXPORT_VERSION,
        cfgVer: CONFIG_EXPORT_VERSION,
        appVersion: window.SITE_CONFIG?.version || '',
        exportedAt: new Date(Number(time)).toISOString(),
        time,
        data,
        hash: await getConfigHash(data)
    };
}

async function validateAndMigrateConfig(config) {
    if (!config || config.name !== CONFIG_SCHEMA_NAME || typeof config.data !== 'object' || !config.data) {
        throw new Error('配置文件格式不正确');
    }

    if (config.hash) {
        const dataHash = await getConfigHash(config.data);
        if (dataHash !== config.hash) {
            throw new Error('配置文件哈希值不匹配');
        }
    }

    const fromVersion = config.version || config.cfgVer || '1.0.0';
    const migrationMessages = [];
    const data = {};

    Object.entries(config.data).forEach(([key, value]) => {
        if (!allowedKeys.has(key)) return;
        const text = typeof value === 'string' ? value : JSON.stringify(value);
        if (isValidConfigValue(key, text)) data[key] = text;
        else migrationMessages.push(`已跳过格式不正确的 ${key}`);
    });

    if (!config.version && config.cfgVer === '1.0.0') {
        migrationMessages.push('已从 1.0.0 配置迁移到 2.0.0');
    }

    if (!Object.prototype.hasOwnProperty.call(data, 'defaultApiMigrationVersion') && window.DEFAULT_API_MIGRATION_VERSION) {
        data.defaultApiMigrationVersion = window.DEFAULT_API_MIGRATION_VERSION;
        migrationMessages.push('已补齐默认源迁移标记');
    }

    if (!Object.prototype.hasOwnProperty.call(data, 'hasInitializedDefaults')) {
        data.hasInitializedDefaults = 'true';
        migrationMessages.push('已补齐默认初始化标记');
    }

    return {
        data,
        fromVersion,
        toVersion: CONFIG_EXPORT_VERSION,
        migrationMessages,
        importedKeys: Object.keys(data)
    };
}

function applyConfigData(data, storage = localStorage) {
    Object.entries(data || {}).forEach(([key, value]) => {
        if (allowedKeys.has(key)) {
            storage.setItem(key, String(value));
        }
    });
}

window.CONFIG_EXPORT_VERSION = CONFIG_EXPORT_VERSION;
window.CONFIG_STORAGE_KEYS = CONFIG_STORAGE_KEYS;
window.allowedKeys = allowedKeys;
window.collectConfigData = collectConfigData;
window.buildConfigExport = buildConfigExport;
window.validateAndMigrateConfig = validateAndMigrateConfig;
window.applyConfigData = applyConfigData;
window.isValidConfigValue = isValidConfigValue;
