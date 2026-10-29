// 添加动画样式
(function() {
    const style = document.createElement('style');
    style.textContent = `
        @keyframes pulse {
            0%, 100% {
                opacity: 1;
            }
            50% {
                opacity: 0.6;
            }
        }
        .animate-pulse {
            animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
    `;
    document.head.appendChild(style);
})();

const VERSION_FETCH_TIMEOUT_MS = 7000;
const VERSION_URL = {
    API: 'https://api.github.com/repos/wxst/LibreTV/contents/VERSION.txt?ref=main',
    RAW: 'https://raw.githubusercontent.com/wxst/LibreTV/main/VERSION.txt'
};

// 获取版本信息
async function fetchVersion(url, errorMessage, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), VERSION_FETCH_TIMEOUT_MS);
    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        if (!response.ok) {
            throw new Error(errorMessage);
        }
        return await response.text();
    } catch (error) {
        if (controller.signal.aborted) {
            throw new Error(`${errorMessage}（请求超时）`);
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}

function normalizeVersion(version) {
    const normalizedVersion = version.trim();
    if (!/^\d{12}$/.test(normalizedVersion)) {
        throw new Error('版本号格式无效');
    }
    return normalizedVersion;
}

async function fetchLatestVersion() {
    try {
        const version = await fetchVersion(VERSION_URL.API, 'GitHub API 请求失败', {
            cache: 'no-store',
            headers: { Accept: 'application/vnd.github.raw+json' }
        });
        return normalizeVersion(version);
    } catch (apiError) {
        console.warn('GitHub API 版本请求失败，尝试 Raw 回退');
        try {
            const version = await fetchVersion(VERSION_URL.RAW, 'GitHub Raw 请求失败', {
                cache: 'no-store'
            });
            return normalizeVersion(version);
        } catch (rawError) {
            throw new Error('无法获取最新版本信息');
        }
    }
}

// 版本检查函数
async function checkForUpdates() {
    try {
        // 获取当前版本
        const currentVersion = await fetchVersion('/VERSION.txt', '获取当前版本失败', {
            cache: 'no-store'
        });
        
        const cleanCurrentVersion = normalizeVersion(currentVersion);
        let cleanLatestVersion = null;
        try {
            cleanLatestVersion = await fetchLatestVersion();
        } catch (error) {
            console.warn('暂时无法检查最新版本');
        }

        // 返回版本信息
        return {
            current: cleanCurrentVersion,
            latest: cleanLatestVersion,
            hasUpdate: cleanLatestVersion === null
                ? null
                : parseInt(cleanLatestVersion) > parseInt(cleanCurrentVersion),
            currentFormatted: formatVersion(cleanCurrentVersion),
            latestFormatted: cleanLatestVersion === null
                ? null
                : formatVersion(cleanLatestVersion)
        };
    } catch (error) {
        console.error('版本检测出错:', error);
        throw error;
    }
}

// 格式化版本号为可读形式 (yyyyMMddhhmm -> yyyy-MM-dd hh:mm)
function formatVersion(versionString) {
    // 检测版本字符串是否有效
    if (!versionString) {
        return '未知版本';
    }
    
    // 清理版本字符串（移除可能的空格或换行符）
    const cleanedString = versionString.trim();
    
    // 格式化标准12位版本号
    if (cleanedString.length === 12) {
        const year = cleanedString.substring(0, 4);
        const month = cleanedString.substring(4, 6);
        const day = cleanedString.substring(6, 8);
        const hour = cleanedString.substring(8, 10);
        const minute = cleanedString.substring(10, 12);
        
        return `${year}-${month}-${day} ${hour}:${minute}`;
    }
    
    return cleanedString;
}

// 当前发布版本号（来自 js/config.js 的 SITE_CONFIG.version）
function currentReleaseVersion() {
    try {
        const version = typeof SITE_CONFIG !== 'undefined' ? String(SITE_CONFIG.version || '').trim() : '';
        return /^[0-9A-Za-z.\-]+$/.test(version) ? version : '';
    } catch (e) {
        return '';
    }
}

// 页脚版本文字：版本号 + 构建时间，例如 “v1.2.31（2026-10-27 14:00）”
function formatVersionLabel(formattedBuildTime) {
    const version = currentReleaseVersion();
    if (!version) return formattedBuildTime;
    return formattedBuildTime ? `v${version}（${formattedBuildTime}）` : `v${version}`;
}

// 创建错误版本信息元素
function createErrorVersionElement(errorMessage) {
    const errorElement = document.createElement('p');
    errorElement.className = 'text-gray-500 text-sm mt-1 text-center md:text-left';
    const version = currentReleaseVersion();
    errorElement.innerHTML = version
        ? `版本: v${version} <span class="text-amber-500">(版本检测失败)</span>`
        : `版本: <span class="text-amber-500">检测失败</span>`;
    errorElement.title = errorMessage;
    return errorElement;
}

// 添加版本信息到页脚
function addVersionInfoToFooter() {
    checkForUpdates().then(result => {
        if (!result) {
            // 如果版本检测失败，显示错误信息
            const versionElement = createErrorVersionElement();
            // 在页脚显示错误元素
            displayVersionElement(versionElement);
            return;
        }
        
        // 创建版本信息元素
        const versionElement = document.createElement('p');
        versionElement.className = 'text-gray-500 text-sm mt-1 text-center md:text-left';
        
        // 添加当前版本信息
        versionElement.innerHTML = `版本: ${formatVersionLabel(result.currentFormatted)}`;
        
        // 如果有更新，添加更新提示
        if (result.hasUpdate === true) {
            versionElement.innerHTML += ` <span class="inline-flex items-center bg-red-600 text-white text-xs px-2 py-0.5 rounded-md ml-1 cursor-pointer animate-pulse font-medium">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                发现新版
            </span>`;
            
            setTimeout(() => {
                const updateBtn = versionElement.querySelector('span');
                if (updateBtn) {
                    updateBtn.addEventListener('click', () => {
                        window.open('https://github.com/wxst/LibreTV/releases', '_blank');
                    });
                }
            }, 100);
        } else if (result.hasUpdate === false) {
            // 如果没有更新，显示当前版本为最新版本
            versionElement.innerHTML = `版本: ${formatVersionLabel(result.currentFormatted)} <span class="text-green-500">(最新版本)</span>`;
        } else {
            versionElement.innerHTML += ' <span class="text-amber-500" title="暂时无法连接版本源">(更新检查不可用)</span>';
        }
        
        // 显示版本元素
        displayVersionElement(versionElement);
    }).catch(error => {
        console.error('版本检测出错:', error);
        // 创建错误版本信息元素并显示
        const errorElement = createErrorVersionElement(`错误信息: ${error.message}`);
        displayVersionElement(errorElement);
    });
}

// 在页脚显示版本元素的辅助函数
function displayVersionElement(element) {
    // 获取页脚元素
    const footerElement = document.querySelector('.footer p.text-gray-500.text-sm');
    if (footerElement) {
        // 在原版权信息后插入版本信息
        footerElement.insertAdjacentElement('afterend', element);
    } else {
        // 如果找不到页脚元素，尝试在页脚区域最后添加
        const footer = document.querySelector('.footer .container');
        if (footer) {
            footer.querySelector('div').appendChild(element);
        }
    }
}

// 页面加载完成后添加版本信息
document.addEventListener('DOMContentLoaded', addVersionInfoToFooter);
