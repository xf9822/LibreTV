// 全局变量
let selectedAPIs = JSON.parse(localStorage.getItem('selectedAPIs') || JSON.stringify(DEFAULT_SELECTED_APIS)); // 默认选中资源
let customAPIs = JSON.parse(localStorage.getItem('customAPIs') || '[]'); // 存储自定义API列表

// 添加当前播放的集数索引
let currentEpisodeIndex = 0;
// 添加当前视频的所有集数
let currentEpisodes = [];
// 添加当前视频的标题
let currentVideoTitle = '';
let currentSearchResults = [];
let currentSearchGroups = [];
let activeSearchRequest = 0;
let activeSearchController = null;
let searchFilter = window.SearchFilter ? window.SearchFilter.defaultFilter() : null; // 搜索结果的类型/年份/地区筛选与排序
let lastSearchRender = { query: '', completed: 0, total: 0 };
let searchFilterBarSignature = '';
let activeMovieSourceSession = null;
let movieDetailRequestId = 0;
// 全局变量用于倒序状态
let episodesReversed = false;

const YELLOW_CONTENT_KEYWORDS = [
    '伦理片', '福利', '里番动漫', '门事件', '萝莉少女', '制服诱惑', '国产传媒',
    'cosplay', '黑丝诱惑', '无码', '日本无码', '有码', '日本有码', 'swag',
    '网红主播', '美女主播', '国产自拍', '色情片', '同性片', '福利视频', '福利片',
    '成人', '情色', '女优', '人妻', '巨乳', '私拍', '大尺度', '麻豆', '抖阴',
    '热舞', '裸聊', '自慰', '做爱', '性交', '口交', '约炮', '无码流出',
    '番号', '爆乳', '翘臀', '嫩模', '嫩妹', '美乳', '白丝', '丝袜', '写真'
];

const SEARCH_TITLE_FIELDS = [
    'vod_name',
    'vod_sub',
    'vod_en',
    'title',
    'name'
];

function isYellowContentFilterEnabled() {
    return localStorage.getItem('yellowFilterEnabled') === 'true';
}

function isAdultSourceId(apiId) {
    if (!apiId) return false;
    if (apiId.startsWith('custom_')) {
        const customApi = getCustomApiInfo(apiId.replace('custom_', ''));
        return Boolean(customApi?.isAdult);
    }
    return Boolean(API_SITES[apiId]?.adult);
}

function getSearchableApiIds(apiIds = selectedAPIs) {
    const ids = Array.from(apiIds || []);
    if (!isYellowContentFilterEnabled()) return ids;
    return ids.filter(apiId => !isAdultSourceId(apiId));
}

function getSelectedAdultApiIds(apiIds = selectedAPIs) {
    return Array.from(apiIds || []).filter(apiId => isAdultSourceId(apiId));
}

function shouldShowAdultRecommendTag() {
    return !isYellowContentFilterEnabled() && getSelectedAdultApiIds().length > 0;
}

function normalizeFilterText(value) {
    return String(value || '').toLowerCase();
}

function normalizeSearchText(value) {
    return String(value || '').toLowerCase().replace(/\s+/g, '');
}

function getSearchTitleTexts(item) {
    return SEARCH_TITLE_FIELDS
        .map(field => normalizeSearchText(item?.[field]))
        .filter(Boolean);
}

function doesResultMatchQuery(item, query) {
    const compactQuery = normalizeSearchText(query);
    if (!compactQuery) return true;

    const titleTexts = getSearchTitleTexts(item);
    if (titleTexts.some(text => text.includes(compactQuery))) {
        return true;
    }

    const queryTerms = String(query || '')
        .toLowerCase()
        .split(/\s+/)
        .map(normalizeSearchText)
        .filter(Boolean);

    return queryTerms.length > 1 && queryTerms.every(term =>
        titleTexts.some(text => text.includes(term))
    );
}

function filterResultsByQuery(results, query) {
    const list = Array.isArray(results) ? results : [];
    return list.filter(item => doesResultMatchQuery(item, query));
}

function matchesYellowContent(item) {
    if (isAdultSourceId(item?.source_code)) return true;

    const haystack = [
        item?.vod_name,
        item?.vod_sub,
        item?.vod_en,
        item?.title,
        item?.name,
        item?.type_name,
        item?.vod_class,
        item?.vod_remarks,
        item?.vod_content,
        item?.desc,
        item?.description,
        item?.source_name
    ].map(normalizeFilterText).join(' ');

    return YELLOW_CONTENT_KEYWORDS.some(keyword => haystack.includes(keyword.toLowerCase()));
}

function filterYellowContentResults(results) {
    const list = Array.isArray(results) ? results : [];
    if (!isYellowContentFilterEnabled()) return list;
    return list.filter(item => !matchesYellowContent(item));
}

function getResultTypeLabel(item) {
    if (matchesYellowContent(item)) return '成人视频';
    return String(item?.type_name || '').trim();
}

function getResultTypeLabelClass(item) {
    if (matchesYellowContent(item)) {
        return 'bg-opacity-20 bg-pink-500 text-pink-300';
    }
    return 'bg-opacity-20 bg-blue-500 text-blue-300';
}

function getAvailableDefaultApiIds() {
    return DEFAULT_SELECTED_APIS.filter(apiId => API_SITES[apiId]);
}

function initializeDefaultSettings() {
    const defaultApiIds = getAvailableDefaultApiIds();

    if (!localStorage.getItem('hasInitializedDefaults')) {
        selectedAPIs = [...defaultApiIds];
        localStorage.setItem('selectedAPIs', JSON.stringify(selectedAPIs));

        localStorage.setItem('yellowFilterEnabled', 'true');
        localStorage.setItem(PLAYER_CONFIG.adFilteringStorage, 'true');
        localStorage.setItem('doubanEnabled', 'true');
        localStorage.setItem('hasInitializedDefaults', 'true');
        localStorage.setItem(DEFAULT_API_MIGRATION_KEY, DEFAULT_API_MIGRATION_VERSION);
        return;
    }

    if (localStorage.getItem(DEFAULT_API_MIGRATION_KEY) === DEFAULT_API_MIGRATION_VERSION) {
        return;
    }

    let changed = false;
    // 已下线的内置源（例如关闭了关键词搜索的站）从选择里去掉；自定义源保留
    const stillAvailable = selectedAPIs.filter(apiId => apiId.startsWith('custom_') || API_SITES[apiId]);
    if (stillAvailable.length !== selectedAPIs.length) {
        selectedAPIs = stillAvailable;
        changed = true;
    }
    defaultApiIds.forEach(apiId => {
        if (!selectedAPIs.includes(apiId)) {
            selectedAPIs.push(apiId);
            changed = true;
        }
    });

    if (changed) {
        localStorage.setItem('selectedAPIs', JSON.stringify(selectedAPIs));
    }
    localStorage.setItem(DEFAULT_API_MIGRATION_KEY, DEFAULT_API_MIGRATION_VERSION);
}

// 页面初始化
document.addEventListener('DOMContentLoaded', function () {
    initializeDefaultSettings();

    // 初始化API复选框
    initAPICheckboxes();

    // 初始化自定义API列表
    renderCustomAPIsList();

    // 初始化显示选中的API数量
    updateSelectedApiCount();

    // 渲染搜索历史
    renderSearchHistory();

    // 设置黄色内容过滤器开关初始状态
    const yellowFilterToggle = document.getElementById('yellowFilterToggle');
    if (yellowFilterToggle) {
        yellowFilterToggle.checked = localStorage.getItem('yellowFilterEnabled') === 'true';
    }

    // 设置广告过滤开关初始状态
    const adFilterToggle = document.getElementById('adFilterToggle');
    if (adFilterToggle) {
        adFilterToggle.checked = localStorage.getItem(PLAYER_CONFIG.adFilteringStorage) !== 'false'; // 默认为true
    }

    // 设置事件监听器
    setupEventListeners();

    // 初始检查成人API选中状态
    setTimeout(checkAdultAPIsSelected, 100);
});

// 初始化API复选框
function initAPICheckboxes() {
    const container = document.getElementById('apiCheckboxes');
    container.innerHTML = '';

    // 添加普通API组标题
    const normaldiv = document.createElement('div');
    normaldiv.id = 'normaldiv';
    normaldiv.className = 'grid grid-cols-2 gap-2';
    const normalTitle = document.createElement('div');
    normalTitle.className = 'api-group-title';
    normalTitle.textContent = '普通资源';
    normaldiv.appendChild(normalTitle);

    // 创建普通API源的复选框
    Object.keys(API_SITES).forEach(apiKey => {
        const api = API_SITES[apiKey];
        if (api.adult) return; // 跳过成人内容API，稍后添加

        const checked = selectedAPIs.includes(apiKey);

        const checkbox = document.createElement('div');
        checkbox.className = 'flex items-center min-w-0';
        // 同一家的镜像站标“同源”：内容相同，选一个即可
        const mirrors = api.family
            ? Object.keys(API_SITES).filter(key => key !== apiKey && API_SITES[key].family === api.family).map(key => API_SITES[key].name)
            : [];
        checkbox.innerHTML = `
            <input type="checkbox" id="api_${apiKey}" 
                   class="form-checkbox h-3 w-3 text-blue-600 bg-[#222] border border-[#333]" 
                   ${checked ? 'checked' : ''} 
                   data-api="${apiKey}">
            <label for="api_${apiKey}" class="ml-1 text-xs text-gray-400 truncate">${escapeHtmlAttr(api.name)}</label>
            ${mirrors.length ? `<span class="api-mirror-tag" title="${escapeHtmlAttr(`与${mirrors.join('、')}内容相同（同一家的镜像站），选一个即可，其余可作备用`)}">同源</span>` : ''}
            <span class="api-health-dot" data-health-for="${apiKey}" aria-hidden="true"></span>
        `;
        normaldiv.appendChild(checkbox);

        // 添加事件监听器
        checkbox.querySelector('input').addEventListener('change', function () {
            updateSelectedAPIs();
            checkAdultAPIsSelected();
        });
    });
    container.appendChild(normaldiv);

    // 添加成人API列表
    addAdultAPI();

    // 初始检查成人内容状态
    checkAdultAPIsSelected();
    window.SourceAutopilot?.renderHealthDots();
}

// 添加成人API列表
function addAdultAPI() {
    // 仅在隐藏设置为false时添加成人API组
    if (!HIDE_BUILTIN_ADULT_APIS && (localStorage.getItem('yellowFilterEnabled') === 'false')) {
        const container = document.getElementById('apiCheckboxes');

        // 添加成人API组标题
        const adultdiv = document.createElement('div');
        adultdiv.id = 'adultdiv';
        adultdiv.className = 'grid grid-cols-2 gap-2';
        const adultTitle = document.createElement('div');
        adultTitle.className = 'api-group-title adult';
        adultTitle.innerHTML = `黄色资源采集站 <span class="adult-warning">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
        </span>`;
        adultdiv.appendChild(adultTitle);

        // 创建成人API源的复选框
        Object.keys(API_SITES).forEach(apiKey => {
            const api = API_SITES[apiKey];
            if (!api.adult) return; // 仅添加成人内容API

            const checked = selectedAPIs.includes(apiKey);

            const checkbox = document.createElement('div');
            checkbox.className = 'flex items-center';
            checkbox.innerHTML = `
                <input type="checkbox" id="api_${apiKey}" 
                       class="form-checkbox h-3 w-3 text-blue-600 bg-[#222] border border-[#333] api-adult" 
                       ${checked ? 'checked' : ''} 
                       data-api="${apiKey}">
                <label for="api_${apiKey}" class="ml-1 text-xs text-pink-400 truncate">${api.name}</label>
            `;
            adultdiv.appendChild(checkbox);

            // 添加事件监听器
            checkbox.querySelector('input').addEventListener('change', function () {
                updateSelectedAPIs();
                checkAdultAPIsSelected();
            });
        });
        container.appendChild(adultdiv);
    }
}

// 检查是否有成人API被选中
function checkAdultAPIsSelected() {
    // 查找所有内置成人API复选框
    const adultBuiltinCheckboxes = document.querySelectorAll('#apiCheckboxes .api-adult:checked');

    // 查找所有自定义成人API复选框
    const customApiCheckboxes = document.querySelectorAll('#customApisList .api-adult:checked');

    const hasAdultSelected = adultBuiltinCheckboxes.length > 0 || customApiCheckboxes.length > 0;

    const yellowFilterToggle = document.getElementById('yellowFilterToggle');
    if (!yellowFilterToggle) return;
    const yellowFilterContainer = yellowFilterToggle.closest('div').parentNode;
    const filterDescription = yellowFilterContainer.querySelector('p.filter-description');
    const existingTooltip = yellowFilterContainer.querySelector('.filter-tooltip');
    if (existingTooltip) {
        existingTooltip.remove();
    }

    yellowFilterToggle.disabled = false;
    yellowFilterContainer.classList.remove('filter-disabled');

    if (hasAdultSelected && yellowFilterToggle.checked) {
        if (filterDescription) {
            filterDescription.innerHTML = '<strong class="text-pink-300">已启用过滤，搜索时会跳过黄色资源站</strong>';
        }
    } else if (hasAdultSelected) {
        if (filterDescription) {
            filterDescription.innerHTML = '<strong class="text-pink-300">关闭过滤后会搜索已选黄色资源站</strong>';
        }
    } else {
        if (filterDescription) {
            filterDescription.innerHTML = '过滤"伦理片"等黄色内容';
        }
    }
}

// 渲染自定义API列表
function renderCustomAPIsList() {
    const container = document.getElementById('customApisList');
    if (!container) return;

    if (customAPIs.length === 0) {
        container.innerHTML = '<p class="text-xs text-gray-500 text-center my-2">未添加自定义API</p>';
        return;
    }

    container.innerHTML = '';
    customAPIs.forEach((api, index) => {
        const apiItem = document.createElement('div');
        apiItem.className = 'flex items-center justify-between p-1 mb-1 bg-[#222] rounded';
        const textColorClass = api.isAdult ? 'text-pink-400' : 'text-white';
        const adultTag = api.isAdult ? '<span class="text-xs text-pink-400 mr-1">(18+)</span>' : '';
        // 新增 detail 地址显示
        const detailLine = api.detail ? `<div class="text-xs text-gray-400 truncate">detail: ${api.detail}</div>` : '';
        apiItem.innerHTML = `
            <div class="flex items-center flex-1 min-w-0">
                <input type="checkbox" id="custom_api_${index}" 
                       class="form-checkbox h-3 w-3 text-blue-600 mr-1 ${api.isAdult ? 'api-adult' : ''}" 
                       ${selectedAPIs.includes('custom_' + index) ? 'checked' : ''} 
                       data-custom-index="${index}">
                <div class="flex-1 min-w-0">
                    <div class="text-xs font-medium ${textColorClass} truncate">
                        ${adultTag}${api.name}
                    </div>
                    <div class="text-xs text-gray-500 truncate">${api.url}</div>
                    ${detailLine}
                </div>
            </div>
            <div class="flex items-center">
                <button class="text-blue-500 hover:text-blue-700 text-xs px-1" onclick="editCustomApi(${index})">✎</button>
                <button class="text-red-500 hover:text-red-700 text-xs px-1" onclick="removeCustomApi(${index})">✕</button>
            </div>
        `;
        container.appendChild(apiItem);
        apiItem.querySelector('input').addEventListener('change', function () {
            updateSelectedAPIs();
            checkAdultAPIsSelected();
        });
    });
}

// 编辑自定义API
function editCustomApi(index) {
    if (index < 0 || index >= customAPIs.length) return;
    const api = customAPIs[index];
    document.getElementById('customApiName').value = api.name;
    document.getElementById('customApiUrl').value = api.url;
    document.getElementById('customApiDetail').value = api.detail || '';
    const isAdultInput = document.getElementById('customApiIsAdult');
    if (isAdultInput) isAdultInput.checked = api.isAdult || false;
    const form = document.getElementById('addCustomApiForm');
    if (form) {
        form.classList.remove('hidden');
        const buttonContainer = form.querySelector('div:last-child');
        buttonContainer.innerHTML = `
            <button onclick="updateCustomApi(${index})" class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-xs">更新</button>
            <button onclick="cancelEditCustomApi()" class="bg-[#444] hover:bg-[#555] text-white px-3 py-1 rounded text-xs">取消</button>
        `;
    }
}

// 更新自定义API
function updateCustomApi(index) {
    if (index < 0 || index >= customAPIs.length) return;
    const nameInput = document.getElementById('customApiName');
    const urlInput = document.getElementById('customApiUrl');
    const detailInput = document.getElementById('customApiDetail');
    const isAdultInput = document.getElementById('customApiIsAdult');
    const name = nameInput.value.trim();
    let url = urlInput.value.trim();
    const detail = detailInput ? detailInput.value.trim() : '';
    const isAdult = isAdultInput ? isAdultInput.checked : false;
    if (!name || !url) {
        showToast('请输入API名称和链接', 'warning');
        return;
    }
    if (!/^https?:\/\/.+/.test(url)) {
        showToast('API链接格式不正确，需以http://或https://开头', 'warning');
        return;
    }
    if (url.endsWith('/')) url = url.slice(0, -1);
    // 保存 detail 字段
    customAPIs[index] = { name, url, detail, isAdult };
    localStorage.setItem('customAPIs', JSON.stringify(customAPIs));
    renderCustomAPIsList();
    checkAdultAPIsSelected();
    restoreAddCustomApiButtons();
    nameInput.value = '';
    urlInput.value = '';
    if (detailInput) detailInput.value = '';
    if (isAdultInput) isAdultInput.checked = false;
    document.getElementById('addCustomApiForm').classList.add('hidden');
    showToast('已更新自定义API: ' + name, 'success');
}

// 取消编辑自定义API
function cancelEditCustomApi() {
    // 清空表单
    document.getElementById('customApiName').value = '';
    document.getElementById('customApiUrl').value = '';
    document.getElementById('customApiDetail').value = '';
    const isAdultInput = document.getElementById('customApiIsAdult');
    if (isAdultInput) isAdultInput.checked = false;

    // 隐藏表单
    document.getElementById('addCustomApiForm').classList.add('hidden');

    // 恢复添加按钮
    restoreAddCustomApiButtons();
}

// 恢复自定义API添加按钮
function restoreAddCustomApiButtons() {
    const form = document.getElementById('addCustomApiForm');
    const buttonContainer = form.querySelector('div:last-child');
    buttonContainer.innerHTML = `
        <button onclick="addCustomApi()" class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-xs">添加</button>
        <button onclick="cancelAddCustomApi()" class="bg-[#444] hover:bg-[#555] text-white px-3 py-1 rounded text-xs">取消</button>
    `;
}

// 更新选中的API列表
function updateSelectedAPIs() {
    // 获取所有内置API复选框
    const builtInApiCheckboxes = document.querySelectorAll('#apiCheckboxes input:checked');

    // 获取选中的内置API
    const builtInApis = Array.from(builtInApiCheckboxes).map(input => input.dataset.api);

    // 获取选中的自定义API
    const customApiCheckboxes = document.querySelectorAll('#customApisList input:checked');
    const customApiIndices = Array.from(customApiCheckboxes).map(input => 'custom_' + input.dataset.customIndex);

    // 合并内置和自定义API
    selectedAPIs = [...builtInApis, ...customApiIndices];

    // 保存到localStorage
    localStorage.setItem('selectedAPIs', JSON.stringify(selectedAPIs));

    // 更新显示选中的API数量
    updateSelectedApiCount();

    if (typeof window.refreshDoubanAdultTagState === 'function') {
        window.refreshDoubanAdultTagState();
    }
}

// 更新选中的API数量显示
function updateSelectedApiCount() {
    const countEl = document.getElementById('selectedApiCount');
    if (countEl) {
        countEl.textContent = selectedAPIs.length;
    }
}

// 全选或取消全选API
function selectAllAPIs(selectAll = true, excludeAdult = false) {
    const checkboxes = document.querySelectorAll('#apiCheckboxes input[type="checkbox"]');

    checkboxes.forEach(checkbox => {
        if (excludeAdult && checkbox.classList.contains('api-adult')) {
            checkbox.checked = false;
        } else {
            checkbox.checked = selectAll;
        }
    });

    updateSelectedAPIs();
    checkAdultAPIsSelected();
}

// 显示添加自定义API表单
function showAddCustomApiForm() {
    const form = document.getElementById('addCustomApiForm');
    if (form) {
        form.classList.remove('hidden');
    }
}

// 取消添加自定义API - 修改函数来重用恢复按钮逻辑
function cancelAddCustomApi() {
    const form = document.getElementById('addCustomApiForm');
    if (form) {
        form.classList.add('hidden');
        document.getElementById('customApiName').value = '';
        document.getElementById('customApiUrl').value = '';
        document.getElementById('customApiDetail').value = '';
        const isAdultInput = document.getElementById('customApiIsAdult');
        if (isAdultInput) isAdultInput.checked = false;

        // 确保按钮是添加按钮
        restoreAddCustomApiButtons();
    }
}

// 添加自定义API
function addCustomApi() {
    const nameInput = document.getElementById('customApiName');
    const urlInput = document.getElementById('customApiUrl');
    const detailInput = document.getElementById('customApiDetail');
    const isAdultInput = document.getElementById('customApiIsAdult');
    const name = nameInput.value.trim();
    let url = urlInput.value.trim();
    const detail = detailInput ? detailInput.value.trim() : '';
    const isAdult = isAdultInput ? isAdultInput.checked : false;
    if (!name || !url) {
        showToast('请输入API名称和链接', 'warning');
        return;
    }
    if (!/^https?:\/\/.+/.test(url)) {
        showToast('API链接格式不正确，需以http://或https://开头', 'warning');
        return;
    }
    if (url.endsWith('/')) {
        url = url.slice(0, -1);
    }
    // 保存 detail 字段
    customAPIs.push({ name, url, detail, isAdult });
    localStorage.setItem('customAPIs', JSON.stringify(customAPIs));
    const newApiIndex = customAPIs.length - 1;
    selectedAPIs.push('custom_' + newApiIndex);
    localStorage.setItem('selectedAPIs', JSON.stringify(selectedAPIs));

    // 重新渲染自定义API列表
    renderCustomAPIsList();
    updateSelectedApiCount();
    checkAdultAPIsSelected();
    nameInput.value = '';
    urlInput.value = '';
    if (detailInput) detailInput.value = '';
    if (isAdultInput) isAdultInput.checked = false;
    document.getElementById('addCustomApiForm').classList.add('hidden');
    showToast('已添加自定义API: ' + name, 'success');
}

// 移除自定义API
function removeCustomApi(index) {
    if (index < 0 || index >= customAPIs.length) return;

    const apiName = customAPIs[index].name;

    // 从列表中移除API
    customAPIs.splice(index, 1);
    localStorage.setItem('customAPIs', JSON.stringify(customAPIs));

    // 从选中列表中移除此API
    const customApiId = 'custom_' + index;
    selectedAPIs = selectedAPIs.filter(id => id !== customApiId);

    // 更新大于此索引的自定义API索引
    selectedAPIs = selectedAPIs.map(id => {
        if (id.startsWith('custom_')) {
            const currentIndex = parseInt(id.replace('custom_', ''));
            if (currentIndex > index) {
                return 'custom_' + (currentIndex - 1);
            }
        }
        return id;
    });

    localStorage.setItem('selectedAPIs', JSON.stringify(selectedAPIs));

    // 重新渲染自定义API列表
    renderCustomAPIsList();

    // 更新选中的API数量
    updateSelectedApiCount();

    // 重新检查成人API选中状态
    checkAdultAPIsSelected();

    showToast('已移除自定义API: ' + apiName, 'info');
}

function toggleSettings(e) {
    const settingsPanel = document.getElementById('settingsPanel');
    if (!settingsPanel) return;

    if (settingsPanel.classList.contains('show')) {
        settingsPanel.classList.remove('show');
    } else {
        settingsPanel.classList.add('show');
    }

    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }
}

// 设置事件监听器
function setupEventListeners() {
    // 回车搜索
    document.getElementById('searchInput').addEventListener('keypress', function (e) {
        if (e.key === 'Enter') {
            search();
        }
    });

    // 点击外部关闭设置面板和历史记录面板
    document.addEventListener('click', function (e) {
        // 关闭设置面板
        const settingsPanel = document.querySelector('#settingsPanel.show');
        const settingsButton = document.querySelector('#settingsPanel .close-btn');

        if (settingsPanel && settingsButton &&
            !settingsPanel.contains(e.target) &&
            !settingsButton.contains(e.target)) {
            settingsPanel.classList.remove('show');
        }

        // 关闭历史记录面板
        const historyPanel = document.querySelector('#historyPanel.show');
        const historyButton = document.querySelector('#historyPanel .close-btn');

        if (historyPanel && historyButton &&
            !historyPanel.contains(e.target) &&
            !historyButton.contains(e.target)) {
            historyPanel.classList.remove('show');
        }
    });

    // 黄色内容过滤开关事件绑定
    const yellowFilterToggle = document.getElementById('yellowFilterToggle');
    if (yellowFilterToggle) {
        yellowFilterToggle.addEventListener('change', function (e) {
            localStorage.setItem('yellowFilterEnabled', e.target.checked);

            // 控制黄色内容接口的显示状态
            const adultdiv = document.getElementById('adultdiv');
            if (adultdiv) {
                if (e.target.checked === true) {
                    adultdiv.style.display = 'none';
                } else if (e.target.checked === false) {
                    adultdiv.style.display = ''
                }
            } else {
                // 添加成人API列表
                addAdultAPI();
            }

            checkAdultAPIsSelected();
            if (typeof window.refreshDoubanAdultTagState === 'function') {
                window.refreshDoubanAdultTagState();
            }
        });
    }

    // 广告过滤开关事件绑定
    const adFilterToggle = document.getElementById('adFilterToggle');
    if (adFilterToggle) {
        adFilterToggle.addEventListener('change', function (e) {
            localStorage.setItem(PLAYER_CONFIG.adFilteringStorage, e.target.checked);
        });
    }
}

// 重置搜索区域
function resetSearchArea() {
    // 清理搜索结果
    document.getElementById('results').innerHTML = '';
    document.getElementById('searchInput').value = '';
    const filterBar = document.getElementById('searchFilterBar');
    if (filterBar) {
        filterBar.hidden = true;
        filterBar.innerHTML = '';
    }
    searchFilterBarSignature = '';

    // 恢复搜索区域的样式
    document.getElementById('resultsArea').classList.add('hidden');
    window.renderContinueWatching?.();
    window.renderWatchLater?.();

    // 确保页脚正确显示，移除相对定位
    const footer = document.querySelector('.footer');
    if (footer) {
        footer.style.position = '';
    }

    // 如果有豆瓣功能，检查是否需要显示豆瓣推荐区域
    if (typeof updateDoubanVisibility === 'function') {
        updateDoubanVisibility();
    }

    // 重置URL为主页
    try {
        window.history.pushState(
            {},
            `LibreTV - 免费在线视频搜索与观看平台`,
            `/`
        );
        // 更新页面标题
        document.title = `LibreTV - 免费在线视频搜索与观看平台`;
    } catch (e) {
        console.error('更新浏览器历史失败:', e);
    }
}

// 获取自定义API信息
function getCustomApiInfo(customApiIndex) {
    const index = parseInt(customApiIndex);
    if (isNaN(index) || index < 0 || index >= customAPIs.length) {
        return null;
    }
    return customAPIs[index];
}

// 搜索功能 - 修改为支持多选API和多页结果
async function search() {
    // 强化的密码保护校验 - 防止绕过
    try {
        if (window.ensurePasswordProtection) {
            window.ensurePasswordProtection();
        } else {
            // 兼容性检查
            if (window.isPasswordProtected && window.isPasswordVerified) {
                if (window.isPasswordProtected() && !window.isPasswordVerified()) {
                    showPasswordModal && showPasswordModal();
                    return;
                }
            }
        }
    } catch (error) {
        console.warn('Password protection check failed:', error.message);
        return;
    }
    const query = document.getElementById('searchInput').value.trim();

    if (!query) {
        showToast('请输入搜索内容', 'info');
        return;
    }

    if (selectedAPIs.length === 0) {
        showToast('请至少选择一个API源', 'warning');
        return;
    }

    const searchableApiIds = getSearchableApiIds(selectedAPIs);
    if (searchableApiIds.length === 0) {
        showToast('黄色内容过滤已开启，当前选中的黄色资源站已被跳过', 'warning');
        return;
    }

    const request = ++activeSearchRequest;
    activeSearchController?.abort();
    if (window.SearchFilter) searchFilter = window.SearchFilter.defaultFilter();
    searchFilterBarSignature = '';
    const controller = new AbortController();
    activeSearchController = controller;
    showLoading();
    saveSearchHistory(query);
    let allResults = [];
    let completed = 0;
    let loadingVisible = true;
    const resultsArea = document.getElementById('resultsArea');
    resultsArea.classList.remove('hidden');
    document.getElementById('doubanArea')?.classList.add('hidden');
    document.getElementById('continueWatching')?.classList.add('hidden');
    document.getElementById('watchLater')?.classList.add('hidden');
    const releaseLoading = () => { if (loadingVisible) { hideLoading(); loadingVisible = false; } };
    try {
        window.history.pushState({search: query}, `搜索: ${query} - LibreTV`, `/s=${encodeURIComponent(query)}`);
        document.title = `搜索: ${query} - LibreTV`;
    } catch (error) { console.warn('更新浏览器历史失败:', error); }
    const update = () => {
        if (request !== activeSearchRequest) return;
        allResults = filterYellowContentResults(allResults);
        // 先按片名、来源排好，保证分组和组内来源顺序稳定；展示顺序由 SearchFilter 的排序决定
        allResults.sort((a,b) => (a.vod_name || '').localeCompare(b.vod_name || '') || (a.source_name || '').localeCompare(b.source_name || ''));
        currentSearchResults = allResults;
        currentSearchGroups = LibreExperience.groupResults(allResults);
        renderSearchResults(query, currentSearchGroups, completed, searchableApiIds.length);
        releaseLoading();
    };
    await Promise.all(searchableApiIds.map(async apiId => {
        try {
            await searchByAPIAndKeyWord(apiId, query, batch => {
                if (request !== activeSearchRequest || controller.signal.aborted) return;
                allResults.push(...batch);
                update();
            }, controller.signal);
        } finally {
            if (request !== activeSearchRequest) return;
            completed++;
            update();
        }
    }));
    if (request === activeSearchRequest) releaseLoading();
}

function cancelActiveSearch() {
    activeSearchRequest++;
    activeSearchController?.abort();
    activeSearchController = null;
    hideLoading();
}
window.cancelActiveSearch = cancelActiveSearch;

// 搜索结果上方的筛选排序栏：选项从当前结果里统计，选项不变时不重建（避免结果陆续到达时打断正在操作的下拉框）
function renderSearchFilterBar(groups) {
    const bar = document.getElementById('searchFilterBar');
    if (!bar || !window.SearchFilter || !searchFilter) return;
    if (!groups.length) {
        bar.hidden = true;
        bar.innerHTML = '';
        searchFilterBarSignature = '';
        return;
    }
    const options = window.SearchFilter.options(groups);
    const signature = JSON.stringify([options, searchFilter]);
    bar.hidden = false;
    if (signature === searchFilterBarSignature) return;
    searchFilterBarSignature = signature;

    const chip = (value, label, count) => `<button type="button" class="search-filter-chip ${searchFilter.kind === value ? 'is-active' : ''}"
            data-filter-kind="${escapeHtmlAttr(value)}" aria-pressed="${searchFilter.kind === value}">${escapeHtmlAttr(label)}${count ? `<small>${count}</small>` : ''}</button>`;
    const select = (key, label, allLabel, list) => {
        const values = list.map(option => option.value);
        // 已选值暂时不在结果里时仍保留在下拉框中
        if (searchFilter[key] && !values.includes(searchFilter[key])) list = [{ value: searchFilter[key], count: 0 }, ...list];
        return `<label class="search-filter-select"><span class="sr-only">${label}</span>
            <select data-filter-key="${key}" aria-label="${label}">
                <option value="">${allLabel}</option>
                ${list.map(option => `<option value="${escapeHtmlAttr(option.value)}" ${searchFilter[key] === option.value ? 'selected' : ''}>${escapeHtmlAttr(option.value)}${option.count ? `（${option.count}）` : ''}</option>`).join('')}
            </select></label>`;
    };
    const sorts = window.SearchFilter.SORTS.filter(sort =>
        (sort.value !== 'rating' || options.hasRatings || searchFilter.sort === 'rating') &&
        (sort.value !== 'updated' || options.hasUpdates || searchFilter.sort === 'updated'));

    bar.innerHTML = `
        <div class="search-filter-kinds" role="group" aria-label="类型">
            ${chip('', '全部', groups.length)}
            ${options.kinds.map(kind => chip(kind.value, kind.value, kind.count)).join('')}
        </div>
        <div class="search-filter-selects">
            ${select('year', '年份', '全部年份', options.years)}
            ${select('region', '地区', '全部地区', options.regions)}
            <label class="search-filter-select"><span class="sr-only">排序</span>
                <select data-filter-key="sort" aria-label="排序">
                    ${sorts.map(sort => `<option value="${sort.value}" ${searchFilter.sort === sort.value ? 'selected' : ''}>${sort.label}</option>`).join('')}
                </select></label>
            ${window.SearchFilter.isFiltered(searchFilter) ? '<button type="button" class="search-filter-clear" data-filter-clear>清除筛选</button>' : ''}
        </div>`;
}

function updateSearchFilter(changes) {
    if (!searchFilter) return;
    searchFilter = { ...searchFilter, ...changes };
    renderSearchResults(lastSearchRender.query, currentSearchGroups, lastSearchRender.completed, lastSearchRender.total);
}

function setupSearchFilterBar() {
    const bar = document.getElementById('searchFilterBar');
    if (!bar || bar.dataset.ready) return;
    bar.dataset.ready = 'true';
    bar.addEventListener('click', event => {
        const kindButton = event.target.closest('[data-filter-kind]');
        if (kindButton) return updateSearchFilter({ kind: kindButton.dataset.filterKind });
        if (event.target.closest('[data-filter-clear]')) updateSearchFilter({ kind: '', year: '', region: '' });
    });
    bar.addEventListener('change', event => {
        const key = event.target.dataset?.filterKey;
        if (key) updateSearchFilter({ [key]: event.target.value });
    });
}
document.addEventListener('DOMContentLoaded', setupSearchFilterBar);

function renderSearchResults(query, groups, completed, total) {
    lastSearchRender = { query, completed, total };
    const resultsDiv = document.getElementById('results');
    renderSearchFilterBar(groups);
    const entries = window.SearchFilter && searchFilter
        ? window.SearchFilter.apply(groups, query, searchFilter)
        : groups.map((group, index) => ({ group, index, rating: 0 }));
    const filtered = Boolean(window.SearchFilter?.isFiltered(searchFilter || {}));
    const count = document.getElementById('searchResultsCount');
    if (count) count.textContent = filtered ? `${entries.length} / ${groups.length}` : String(groups.length);
    const status = document.getElementById('searchProgress');
    if (status) status.textContent = completed < total ? `已搜索 ${completed}/${total} 个来源，结果持续更新` : `已完成 ${total} 个来源`;
    if (!groups.length) {
        resultsDiv.innerHTML = `<div class="col-span-full text-center py-16 text-gray-400">${completed < total ? '正在查找影片…' : '没有找到匹配的结果，请尝试其他关键词或数据源'}</div>`;
        return;
    }
    if (!entries.length) {
        resultsDiv.innerHTML = `<div class="col-span-full text-center py-16 text-gray-400">没有符合筛选条件的结果
            <button type="button" class="search-filter-clear ml-2" onclick="updateSearchFilter({ kind: '', year: '', region: '' })">清除筛选</button></div>`;
        return;
    }
    try {
        // 添加XSS保护，使用textContent和属性转义
        const safeResults = entries.map(({ group, index: resultIndex, rating }) => {
            const item = group[0];
            const safeId = item.vod_id ? item.vod_id.toString().replace(/[^\w-]/g, '') : '';
            const safeName = (item.vod_name || '').toString()
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
            const resultTypeLabel = getResultTypeLabel(item);
            const safeTypeLabel = escapeHtmlAttr(resultTypeLabel);
            const resultTypeClass = getResultTypeLabelClass(item);
            const sourceInfo = group.length > 1 ? `<span class="bg-[#222] text-xs px-1.5 py-0.5 rounded-full">${group.length} 个来源</span>` : item.source_name ?
                `<span class="bg-[#222] text-xs px-1.5 py-0.5 rounded-full">${escapeHtmlAttr(item.source_name)}</span>` : '';
            const sourceCode = item.source_code || '';
            const apiBaseUrl = item.api_url || (sourceCode && API_SITES[sourceCode]?.api) || '';
            const coverUrl = normalizeImageUrl(item.vod_pic, apiBaseUrl);
            const safeCoverUrl = escapeHtmlAttr(coverUrl);

            // 添加API URL属性，用于详情获取
            const apiUrlAttr = item.api_url ?
                `data-api-url="${item.api_url.replace(/"/g, '&quot;')}"` : '';

            // 修改为水平卡片布局，图片在左侧，文本在右侧，并优化样式
            const hasCover = Boolean(coverUrl);

            return `
                <div class="card-hover bg-[#111] rounded-lg overflow-hidden cursor-pointer transition-all hover:scale-[1.02] h-full shadow-sm hover:shadow-md" 
                     onclick="quickPlaySearchResult(${resultIndex})" onkeydown="if(event.target === this && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); quickPlaySearchResult(${resultIndex}); }" role="button" tabindex="0" ${apiUrlAttr}>
                    <div class="flex h-full">
                        ${hasCover ? `
                        <div class="relative flex-shrink-0 search-card-img-container">
                            <img src="${safeCoverUrl}" data-original-src="${safeCoverUrl}" alt="${safeName}"
                                 class="h-full w-full object-cover transition-transform hover:scale-110" 
                                 onerror="window.setImageProxyFallback(this, this.dataset.originalSrc, '无封面')"
                                 loading="lazy" referrerpolicy="no-referrer">
                            <div class="absolute inset-0 bg-gradient-to-r from-black/30 to-transparent"></div>
                        </div>` : ''}
                        
                        <div class="p-2 flex flex-col flex-grow">
                            <div class="flex-grow">
                                <h3 class="font-semibold mb-2 break-words line-clamp-2 ${hasCover ? '' : 'text-center'}" title="${safeName}">${safeName}</h3>
                                
                                <div class="flex flex-wrap ${hasCover ? '' : 'justify-center'} gap-1 mb-2">
                                    ${safeTypeLabel ?
                    `<span class="text-xs py-0.5 px-1.5 rounded ${resultTypeClass}">
                                          ${safeTypeLabel}
                                      </span>` : ''}
                                    ${(item.vod_year || '') ?
                    `<span class="text-xs py-0.5 px-1.5 rounded bg-opacity-20 bg-purple-500 text-purple-300">
                                          ${escapeHtmlAttr(item.vod_year)}
                                      </span>` : ''}
                                    ${rating > 0 ? `<span class="search-card-rating text-xs py-0.5 px-1.5 rounded">★ ${rating.toFixed(1)}</span>` : ''}
                                </div>
                                <p class="text-gray-400 line-clamp-2 overflow-hidden ${hasCover ? '' : 'text-center'} mb-2">
                                    ${escapeHtmlAttr(searchCardVersionText(group) || '暂无介绍')}
                                </p>
                            </div>
                            
                            <div class="flex justify-between items-center mt-1 pt-1 border-t border-gray-800">
                                ${sourceInfo ? `<div>${sourceInfo}</div>` : '<div></div>'}
                                <button type="button" class="quick-card-details" onclick="event.stopPropagation(); quickPlaySearchResult(${resultIndex}, true)">${group.length > 1 ? '来源' : '详情'}</button>
                                <button type="button" class="quick-card-details" onclick="event.stopPropagation(); saveSearchResultForLater(${resultIndex})">稍后看</button>
                                <!-- 接口名称过长会被挤变形
                                <div>
                                    <span class="text-gray-500 flex items-center hover:text-blue-400 transition-colors">
                                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                        </svg>
                                        播放
                                    </span>
                                </div>
                                -->
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        resultsDiv.innerHTML = safeResults;
    } catch (error) {
        console.error('搜索结果渲染失败:', error);
    }
}

// 切换清空按钮的显示状态
function toggleClearButton() {
    const searchInput = document.getElementById('searchInput');
    const clearButton = document.getElementById('clearSearchInput');
    if (searchInput.value !== '') {
        clearButton.classList.remove('hidden');
    } else {
        clearButton.classList.add('hidden');
    }
}

// 清空搜索框内容
function clearSearchInput() {
    const searchInput = document.getElementById('searchInput');
    searchInput.value = '';
    const clearButton = document.getElementById('clearSearchInput');
    clearButton.classList.add('hidden');
}

// 劫持搜索框的value属性以检测外部修改
function hookInput() {
    const input = document.getElementById('searchInput');
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

    // 重写 value 属性的 getter 和 setter
    Object.defineProperty(input, 'value', {
        get: function () {
            // 确保读取时返回字符串（即使原始值为 undefined/null）
            const originalValue = descriptor.get.call(this);
            return originalValue != null ? String(originalValue) : '';
        },
        set: function (value) {
            // 显式将值转换为字符串后写入
            const strValue = String(value);
            descriptor.set.call(this, strValue);
            this.dispatchEvent(new Event('input', { bubbles: true }));
        }
    });

    // 初始化输入框值为空字符串（避免初始值为 undefined）
    input.value = '';
}
document.addEventListener('DOMContentLoaded', hookInput);

function normalizeMovieSourceTitle(title) {
    return String(title || '').toLowerCase().replace(/\s+/g, '');
}

function movieSourceName(sourceCode) {
    if (API_SITES[sourceCode]) return API_SITES[sourceCode].name;
    if (sourceCode.startsWith('custom_')) {
        return getCustomApiInfo(sourceCode.slice(7))?.name || '自定义资源';
    }
    return sourceCode;
}

function renderMovieSourcePanel(session) {
    let bestIndex = -1;
    let bestScore = 0;
    session.entries.forEach((entry, index) => {
        const score = entry.status === 'ok' ? window.SourceSpeed.scoreResult(entry.speed) : -1;
        if (score > bestScore) {
            bestScore = score;
            bestIndex = index;
        }
    });
    const options = session.entries.map((entry, index) => {
        let status = '测速中…';
        let statusClass = 'pending';
        let title = '';
        if (entry.status === 'ok') {
            const described = window.SourceSpeed.describeResult(entry.speed);
            status = described.label;
            title = described.title;
            statusClass = { smooth: 'good', ok: 'medium', slow: 'poor' }[entry.speed.verdict] || 'good';
        } else if (entry.status === 'missing') {
            status = '无同名影片';
            statusClass = 'unavailable';
        } else if (entry.status === 'error') {
            status = entry.error || '测速失败';
            statusClass = 'unmeasured';
        }
        const isBest = index === bestIndex;
        return `<button type="button" class="source-probe-option ${index === session.selectedIndex ? 'is-active' : ''} ${isBest ? 'is-best' : ''}"
                    onclick="selectMovieSource(${index})" ${entry.vodId ? '' : 'disabled'} ${title ? `title="${escapeHtmlAttr(title)}"` : ''}>
                    <span class="source-probe-name">${escapeHtmlAttr(entry.name)}${isBest ? '<span class="source-probe-best">推荐</span>' : ''}</span>
                    <span class="source-probe-status ${statusClass}">${escapeHtmlAttr(status)}</span>
                </button>`;
    }).join('');
    return `<section id="movieSourcePanel" class="source-probe-panel" aria-label="可选资源测速">
                <div class="source-probe-heading">
                    <strong>选择资源</strong><span>逐个下载真实视频分片，按下载带宽与视频码率评估流畅度；悬停查看延迟与码率</span>
                </div>
                <div class="source-probe-options">${options}</div>
            </section>`;
}

function refreshMovieSourcePanel(session) {
    if (activeMovieSourceSession !== session) return;
    const panel = document.getElementById('movieSourcePanel');
    if (panel) panel.outerHTML = renderMovieSourcePanel(session);
}

function movieDetailParams(sourceCode) {
    if (!sourceCode.startsWith('custom_')) return `&source=${encodeURIComponent(sourceCode)}`;
    const customApi = getCustomApiInfo(sourceCode.slice(7));
    if (!customApi) throw new Error('自定义API配置无效');
    let params = `&customApi=${encodeURIComponent(customApi.url)}&source=custom`;
    if (customApi.detail) params += `&customDetail=${encodeURIComponent(customApi.detail)}`;
    return params;
}

function loadMovieSourceDetail(session, entry) {
    if (!entry.detailPromise) {
        const params = movieDetailParams(entry.sourceCode);
        entry.detailPromise = fetch(`/api/detail?id=${encodeURIComponent(entry.vodId)}${params}&_t=${Date.now()}`, {
            signal: session.controller.signal
        }).then(async response => {
            if (!response.ok) throw new Error(`详情请求失败 (${response.status})`);
            return response.json();
        });
    }
    return entry.detailPromise;
}

function createMovieSourceSession(id, title, sourceCode) {
    const normalizedTitle = normalizeMovieSourceTitle(title);
    const existing = activeMovieSourceSession;
    if (existing?.titleKey === normalizedTitle &&
        existing.entries.some(entry => entry.sourceCode === sourceCode && String(entry.vodId) === String(id))) {
        return { session: existing, isNew: false };
    }
    existing?.controller.abort();

    const fromSearchResults = currentSearchResults.some(item =>
        item.source_code === sourceCode && String(item.vod_id) === String(id));
    const sourceIds = [...new Set([sourceCode, ...getSearchableApiIds(selectedAPIs)])];
    const entries = sourceIds.map(key => {
        const match = fromSearchResults && currentSearchResults.find(item =>
            item.source_code === key && normalizeMovieSourceTitle(item.vod_name) === normalizedTitle);
        const vodId = key === sourceCode ? id : (match?.vod_id || '');
        return {
            sourceCode: key,
            name: movieSourceName(key),
            vodId,
            vodName: key === sourceCode ? title : (match?.vod_name || title),
            status: vodId ? 'pending' : (fromSearchResults ? 'missing' : 'searching'),
            detailPromise: null,
            speed: null,
            error: ''
        };
    });
    const session = {
        title,
        titleKey: normalizedTitle,
        entries,
        selectedIndex: entries.findIndex(entry => entry.sourceCode === sourceCode),
        controller: new AbortController()
    };
    activeMovieSourceSession = session;
    return { session, isNew: true };
}

async function checkMovieSource(session, entry) {
    try {
        if (!entry.vodId) {
            const results = await searchByAPIAndKeyWord(entry.sourceCode, session.title, null, session.controller.signal);
            const match = results.find(item => normalizeMovieSourceTitle(item.vod_name) === session.titleKey);
            if (session.controller.signal.aborted) return;
            if (!match) {
                entry.status = 'missing';
                return;
            }
            entry.vodId = match.vod_id;
            entry.vodName = match.vod_name;
        }
        entry.status = 'testing';
        refreshMovieSourcePanel(session);
        const detail = await loadMovieSourceDetail(session, entry);
        const episodes = Array.isArray(detail.episodes) ? detail.episodes : [];
        const playableUrl = episodes.find(url => /^https?:\/\/.+\.(m3u8|mp4|webm|mov|m4v|ts)(\?.*)?$/i.test(url));
        if (!playableUrl) throw new Error('无可播放地址');
        const result = await window.SourceSpeed.probeEpisodeUrl(playableUrl, {
            signal: session.controller.signal
        });
        entry.speed = result;
        entry.status = 'ok';
    } catch (error) {
        if (session.controller.signal.aborted) return;
        entry.error = error?.message === '测速超时' ? '测速超时，可试播' : '未能测速，可试播';
        entry.status = 'error';
    } finally {
        refreshMovieSourcePanel(session);
    }
}

function startMovieSourceChecks(session) {
    let nextIndex = 0;
    const worker = async () => {
        while (nextIndex < session.entries.length && !session.controller.signal.aborted) {
            const entry = session.entries[nextIndex++];
            if (entry.status !== 'missing') await checkMovieSource(session, entry);
        }
    };
    void Promise.all(Array.from({ length: Math.min(3, session.entries.length) }, worker));
}

function selectMovieSource(index) {
    const session = activeMovieSourceSession;
    const entry = session?.entries[index];
    if (!entry?.vodId) return;
    session.selectedIndex = index;
    showDetails(entry.vodId, entry.vodName, entry.sourceCode);
}

window.cancelMovieSourceSpeedChecks = () => {
    activeMovieSourceSession?.controller.abort();
    activeMovieSourceSession = null;
    movieDetailRequestId += 1;
};

// 源站简介常带 HTML 标签和实体；用惰性的 DOMParser 取纯文本（不执行脚本、不加载图片），再由调用方转义
function htmlToPlainText(html) {
    const value = String(html || '');
    if (!value) return '';
    try {
        return (new DOMParser().parseFromString(value, 'text/html').body.textContent || '').replace(/\s+/g, ' ').trim();
    } catch (error) {
        return value.replace(/<[^>]*>?/g, ' ').replace(/\s+/g, ' ').trim();
    }
}

// 显示详情 - 修改为支持自定义API
async function showDetails(id, vod_name, sourceCode) {
    // 密码保护校验
    if (window.isPasswordProtected && window.isPasswordVerified) {
        if (window.isPasswordProtected() && !window.isPasswordVerified()) {
            showPasswordModal && showPasswordModal();
            return;
        }
    }
    if (!id) {
        showToast('视频ID无效', 'error');
        return;
    }

    const { session, isNew } = createMovieSourceSession(id, vod_name, sourceCode);
    const entry = session.entries[session.selectedIndex];
    const requestId = ++movieDetailRequestId;
    const modal = document.getElementById('modal');
    const modalTitle = document.getElementById('modalTitle');
    const modalContent = document.getElementById('modalContent');
    modalTitle.textContent = `${vod_name || '未知视频'} (${entry.name})`;
    modalContent.innerHTML = `${renderMovieSourcePanel(session)}
        <div id="movieDetailBody" class="text-center py-8 text-gray-400">正在获取影片详情...</div>`;
    modal.classList.remove('hidden');
    currentVideoTitle = vod_name || '未知视频';
    if (isNew) startMovieSourceChecks(session);

    try {
        const data = await loadMovieSourceDetail(session, entry);
        if (activeMovieSourceSession !== session || requestId !== movieDetailRequestId) return;
        const detailBody = document.getElementById('movieDetailBody');

        if (data.episodes && data.episodes.length > 0) {
            // 构建详情信息HTML
            let detailInfoHtml = '';
            if (data.videoInfo) {
                // Prepare description text, strip HTML and trim whitespace
                const descriptionText = escapeHtmlAttr(htmlToPlainText(data.videoInfo.desc));

                // Check if there's any actual grid content
                const hasGridContent = data.videoInfo.type || data.videoInfo.year || data.videoInfo.area || data.videoInfo.director || data.videoInfo.actor || data.videoInfo.remarks;

                if (hasGridContent || descriptionText) { // Only build if there's something to show
                    detailInfoHtml = `
                <div class="modal-detail-info">
                    ${hasGridContent ? `
                    <div class="detail-grid">
                        ${data.videoInfo.type ? `<div class="detail-item"><span class="detail-label">类型:</span> <span class="detail-value">${escapeHtmlAttr(htmlToPlainText(data.videoInfo.type))}</span></div>` : ''}
                        ${data.videoInfo.year ? `<div class="detail-item"><span class="detail-label">年份:</span> <span class="detail-value">${escapeHtmlAttr(htmlToPlainText(data.videoInfo.year))}</span></div>` : ''}
                        ${data.videoInfo.area ? `<div class="detail-item"><span class="detail-label">地区:</span> <span class="detail-value">${escapeHtmlAttr(htmlToPlainText(data.videoInfo.area))}</span></div>` : ''}
                        ${data.videoInfo.director ? `<div class="detail-item"><span class="detail-label">导演:</span> <span class="detail-value">${escapeHtmlAttr(htmlToPlainText(data.videoInfo.director))}</span></div>` : ''}
                        ${data.videoInfo.actor ? `<div class="detail-item"><span class="detail-label">主演:</span> <span class="detail-value">${escapeHtmlAttr(htmlToPlainText(data.videoInfo.actor))}</span></div>` : ''}
                        ${data.videoInfo.remarks ? `<div class="detail-item"><span class="detail-label">备注:</span> <span class="detail-value">${escapeHtmlAttr(htmlToPlainText(data.videoInfo.remarks))}</span></div>` : ''}
                    </div>` : ''}
                    ${descriptionText ? `
                    <div class="detail-desc">
                        <p class="detail-label">简介:</p>
                        <p class="detail-desc-content">${descriptionText}</p>
                    </div>` : ''}
                </div>
                `;
                }
            }

            currentEpisodes = data.episodes;
            localStorage.setItem('currentEpisodeNames', JSON.stringify(data.episodeNames || []));
            window.EpisodeContext?.write({source:sourceCode, id, episodes:data.episodes, episodeNames:data.episodeNames || []});
            currentEpisodeIndex = 0;

            detailBody.innerHTML = `
                ${detailInfoHtml}
                <div class="flex flex-wrap items-center justify-between mb-4 gap-2">
                    <div class="flex items-center gap-2">
                        <button id="episodeOrderToggle" onclick="toggleEpisodeOrder(${inlineJsArg(sourceCode)}, ${inlineJsArg(id)})" 
                                class="px-3 py-1.5 bg-[#333] hover:bg-[#444] border border-[#444] rounded text-sm transition-colors flex items-center gap-1">
                            <svg class="w-4 h-4 transform ${episodesReversed ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3"></path>
                            </svg>
                            <span>${episodesReversed ? '正序排列' : '倒序排列'}</span>
                        </button>
                        <span class="text-gray-400 text-sm">共 ${data.episodes.length} 集</span>
                    </div>
                    <button onclick="copyLinks()" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm transition-colors">
                        复制链接
                    </button>
                </div>
                <div id="episodesGrid" class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
                    ${renderEpisodes(vod_name, sourceCode, id)}
                </div>
            `;
        } else {
            detailBody.innerHTML = `
                <div class="text-center py-8">
                    <div class="text-red-400 mb-2">❌ 未找到播放资源</div>
                    <div class="text-gray-500 text-sm">该视频可能暂时无法播放，请尝试其他视频</div>
                </div>
            `;
        }

    } catch (error) {
        if (activeMovieSourceSession !== session || requestId !== movieDetailRequestId) return;
        console.error('获取详情错误:', error);
        document.getElementById('movieDetailBody').innerHTML =
            '<div class="text-center py-8 text-red-400">获取详情失败，请选择其他资源或稍后重试</div>';
    }
}

// 更新播放视频函数，修改为使用/watch路径而不是直接打开player.html
function playVideo(url, vod_name, sourceCode, episodeIndex = 0, vodId = '') {
    // 密码保护校验
    if (window.isPasswordProtected && window.isPasswordVerified) {
        if (window.isPasswordProtected() && !window.isPasswordVerified()) {
            showPasswordModal && showPasswordModal();
            return;
        }
    }

    // 获取当前路径作为返回页面
    let currentPath = window.location.href;

    // 构建播放页面URL，使用watch.html作为中间跳转页
    let watchUrl = `watch.html?id=${vodId || ''}&source=${sourceCode || ''}&url=${encodeURIComponent(url)}&index=${episodeIndex}&title=${encodeURIComponent(vod_name || '')}`;

    // 添加返回URL参数
    if (currentPath.includes('index.html') || currentPath.endsWith('/')) {
        watchUrl += `&back=${encodeURIComponent(currentPath)}`;
    }

    // 保存当前状态到localStorage
    try {
        localStorage.setItem('currentVideoTitle', vod_name || '未知视频');
        localStorage.setItem('currentEpisodes', JSON.stringify(currentEpisodes));
        localStorage.setItem('currentEpisodeIndex', episodeIndex);
        localStorage.setItem('currentSourceCode', sourceCode || '');
        localStorage.setItem('lastPlayTime', Date.now());
        localStorage.setItem('lastSearchPage', currentPath);
        localStorage.setItem('lastPageUrl', currentPath);  // 确保保存返回页面URL
    } catch (e) {
        console.error('保存播放状态失败:', e);
    }

    // 在当前标签页中打开播放页面
    window.location.href = watchUrl;
}

// 弹出播放器页面
function showVideoPlayer(url) {
    // 在打开播放器前，隐藏详情弹窗
    const detailModal = document.getElementById('modal');
    if (detailModal) {
        detailModal.classList.add('hidden');
    }
    // 临时隐藏搜索结果和豆瓣区域，防止高度超出播放器而出现滚动条
    document.getElementById('resultsArea').classList.add('hidden');
    document.getElementById('doubanArea').classList.add('hidden');
    // 在框架中打开播放页面
    videoPlayerFrame = document.createElement('iframe');
    videoPlayerFrame.id = 'VideoPlayerFrame';
    videoPlayerFrame.className = 'fixed w-full h-screen z-40';
    videoPlayerFrame.src = url;
    document.body.appendChild(videoPlayerFrame);
    // 将焦点移入iframe
    videoPlayerFrame.focus();
}

// 关闭播放器页面
function closeVideoPlayer(home = false) {
    videoPlayerFrame = document.getElementById('VideoPlayerFrame');
    if (videoPlayerFrame) {
        videoPlayerFrame.remove();
        // 恢复搜索结果显示
        document.getElementById('resultsArea').classList.remove('hidden');
        // 关闭播放器时也隐藏详情弹窗
        const detailModal = document.getElementById('modal');
        if (detailModal) {
            detailModal.classList.add('hidden');
        }
        // 如果启用豆瓣区域则显示豆瓣区域
        if (localStorage.getItem('doubanEnabled') === 'true') {
            document.getElementById('doubanArea').classList.remove('hidden');
        }
    }
    if (home) {
        // 刷新主页
        window.location.href = '/'
    }
}

// 播放上一集
function playPreviousEpisode(sourceCode) {
    if (currentEpisodeIndex > 0) {
        const prevIndex = currentEpisodeIndex - 1;
        const prevUrl = currentEpisodes[prevIndex];
        playVideo(prevUrl, currentVideoTitle, sourceCode, prevIndex);
    }
}

// 播放下一集
function playNextEpisode(sourceCode) {
    if (currentEpisodeIndex < currentEpisodes.length - 1) {
        const nextIndex = currentEpisodeIndex + 1;
        const nextUrl = currentEpisodes[nextIndex];
        playVideo(nextUrl, currentVideoTitle, sourceCode, nextIndex);
    }
}

// 处理播放器加载错误
function handlePlayerError() {
    hideLoading();
    showToast('视频播放加载失败，请尝试其他视频源', 'error');
}

// 辅助函数用于渲染剧集按钮（使用当前的排序状态）
function renderEpisodes(vodName, sourceCode, vodId) {
    const episodes = episodesReversed ? [...currentEpisodes].reverse() : currentEpisodes;
    return episodes.map((episode, index) => {
        // 根据倒序状态计算真实的剧集索引
        const realIndex = episodesReversed ? currentEpisodes.length - 1 - index : index;
        return `
            <button id="episode-${realIndex}" onclick="playVideo(${inlineJsArg(episode)}, ${inlineJsArg(vodName)}, ${inlineJsArg(sourceCode)}, ${realIndex}, ${inlineJsArg(vodId)})" 
                    class="px-4 py-2 bg-[#222] hover:bg-[#333] border border-[#333] rounded-lg transition-colors text-center episode-btn">
                ${realIndex + 1}
            </button>
        `;
    }).join('');
}

// 复制视频链接到剪贴板
function copyLinks() {
    const episodes = episodesReversed ? [...currentEpisodes].reverse() : currentEpisodes;
    const linkList = episodes.join('\r\n');
    navigator.clipboard.writeText(linkList).then(() => {
        showToast('播放链接已复制', 'success');
    }).catch(err => {
        showToast('复制失败，请检查浏览器权限', 'error');
    });
}

// 切换排序状态的函数
function toggleEpisodeOrder(sourceCode, vodId) {
    episodesReversed = !episodesReversed;
    // 重新渲染剧集区域，使用 currentVideoTitle 作为视频标题
    const episodesGrid = document.getElementById('episodesGrid');
    if (episodesGrid) {
        episodesGrid.innerHTML = renderEpisodes(currentVideoTitle, sourceCode, vodId);
    }

    // 更新按钮文本和箭头方向
    const toggleBtn = document.getElementById('episodeOrderToggle');
    if (toggleBtn) {
        toggleBtn.querySelector('span').textContent = episodesReversed ? '正序排列' : '倒序排列';
        const arrowIcon = toggleBtn.querySelector('svg');
        if (arrowIcon) {
            arrowIcon.style.transform = episodesReversed ? 'rotate(180deg)' : 'rotate(0deg)';
        }
    }
}

// 从URL导入配置
async function importConfigFromUrl() {
    // 创建模态框元素
    let modal = document.getElementById('importUrlModal');
    if (modal) {
        document.body.removeChild(modal);
    }

    modal = document.createElement('div');
    modal.id = 'importUrlModal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-40';

    modal.innerHTML = `
        <div class="bg-[#191919] rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto relative">
            <button id="closeUrlModal" class="absolute top-4 right-4 text-gray-400 hover:text-white text-xl">&times;</button>
            
            <h3 class="text-xl font-bold mb-4">从URL导入配置</h3>
            
            <div class="mb-4">
                <input type="text" id="configUrl" placeholder="输入配置文件URL" 
                       class="w-full px-3 py-2 bg-[#222] border border-[#333] rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-blue-500">
            </div>
            
            <div class="flex justify-end space-x-2">
                <button id="confirmUrlImport" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded">导入</button>
                <button id="cancelUrlImport" class="bg-[#444] hover:bg-[#555] text-white px-4 py-2 rounded">取消</button>
            </div>
        </div>`;

    document.body.appendChild(modal);

    // 关闭按钮事件
    document.getElementById('closeUrlModal').addEventListener('click', () => {
        document.body.removeChild(modal);
    });

    // 取消按钮事件
    document.getElementById('cancelUrlImport').addEventListener('click', () => {
        document.body.removeChild(modal);
    });

    // 确认导入按钮事件
    document.getElementById('confirmUrlImport').addEventListener('click', async () => {
        const url = document.getElementById('configUrl').value.trim();
        if (!url) {
            showToast('请输入配置文件URL', 'warning');
            return;
        }

        // 验证URL格式
        try {
            const urlObj = new URL(url);
            if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
                showToast('URL必须以http://或https://开头', 'warning');
                return;
            }
        } catch (e) {
            showToast('URL格式不正确', 'warning');
            return;
        }

        showLoading('正在从URL导入配置...');

        try {
            // 获取配置文件 - 直接请求URL
            const response = await fetch(url, {
                mode: 'cors',
                headers: {
                    'Accept': 'application/json'
                }
            });
            if (!response.ok) throw '获取配置文件失败';

            // 验证响应内容类型
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                throw '响应不是有效的JSON格式';
            }

            const config = await response.json();
            await importConfigPayload(config);
        } catch (error) {
            const message = typeof error === 'string' ? error : '导入配置失败';
            showToast(`从URL导入配置出错 (${message})`, 'error');
        } finally {
            hideLoading();
            document.body.removeChild(modal);
        }
    });

    // 点击模态框外部关闭
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    });
}

async function importConfigPayload(config) {
    const result = await validateAndMigrateConfig(config);
    applyConfigData(result.data);
    const migrationText = result.migrationMessages.length > 0
        ? `（${result.migrationMessages.join('；')}）`
        : '';
    showToast(`配置文件导入成功${migrationText}，3 秒后自动刷新本页面。`, 'success');
    setTimeout(() => {
        window.location.reload();
    }, 3000);
}

// 配置文件导入功能
async function importConfig() {
    showImportBox(async (file) => {
        try {
            // 检查文件类型
            if (!(file.type === 'application/json' || file.name.endsWith('.json'))) throw '文件类型不正确';

            // 检查文件大小
            if (file.size > 1024 * 1024 * 10) throw new Error('文件大小超过 10MB');

            // 读取文件内容
            const content = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject('文件读取失败');
                reader.readAsText(file);
            });

            const config = JSON.parse(content);
            await importConfigPayload(config);
        } catch (error) {
            const message = typeof error === 'string' ? error : '配置文件格式错误';
            showToast(`配置文件读取出错 (${message})`, 'error');
        }
    });
}

// 配置文件导出功能
async function exportConfig() {
    const config = await buildConfigExport();
    saveStringAsFile(JSON.stringify(config), 'LibreTV-Settings_' + config.time + '.json');
}

// 将字符串保存为文件
function saveStringAsFile(content, fileName) {
    // 创建Blob对象并指定类型
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    // 生成临时URL
    const url = window.URL.createObjectURL(blob);
    // 创建<a>标签并触发下载
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    // 清理临时对象
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
}

window.getSearchableApiIds = getSearchableApiIds;
window.getSelectedAdultApiIds = getSelectedAdultApiIds;
window.shouldShowAdultRecommendTag = shouldShowAdultRecommendTag;
window.doesResultMatchQuery = doesResultMatchQuery;
window.filterResultsByQuery = filterResultsByQuery;
window.filterYellowContentResults = filterYellowContentResults;
window.matchesYellowContent = matchesYellowContent;
window.getResultTypeLabel = getResultTypeLabel;

// 移除Node.js的require语句，因为这是在浏览器环境中运行的

// A merged card lists every version its sources offer (HD · TC), best first.
function searchCardVersionText(group) {
    if (group.length === 1 || !window.LibreExperience?.versionLabels) return group[0]?.vod_remarks || '';
    const labels = LibreExperience.versionLabels(group);
    return labels.length > 3 ? `${labels.slice(0, 3).join(' · ')} 等` : labels.join(' · ');
}

function quickPlaySearchResult(index, details = false) {
    const group = currentSearchGroups[index];
    if (!group?.length) return;
    const item = group[0];
    if (details && group.length === 1) return showDetails(item.vod_id, item.vod_name, item.source_code);
    if (details) return showGroupedSearchSources(index);
    const request = QuickPlay.logic.identity(item);
    QuickPlay.open(group.length > 1 ? request : {...request, id: String(item.vod_id), source: item.source_code});
}

function showGroupedSearchSources(index) {
    const group = currentSearchGroups[index];
    if (!group) return;
    const modal = document.getElementById('modal');
    document.getElementById('modalTitle').textContent = group[0].vod_name || '选择资源';
    const content = document.getElementById('modalContent');
    content.replaceChildren();
    const heading = document.createElement('p');
    heading.textContent = `找到 ${group.length} 个来源，点击查看该来源详情或直接点影片卡片播放`;
    content.appendChild(heading);
    // 清晰的版本排前面；同一版本再按资源站体检和实际播放表现排序
    const order = window.SourceAutopilot ? window.SourceAutopilot.rank(group.map(item => item.source_code)) : [];
    const rank = item => Math.floor(window.LibreExperience?.versionRank?.(item) ?? 3);
    const ranked = [...group].sort((a, b) => rank(b) - rank(a) || order.indexOf(a.source_code) - order.indexOf(b.source_code));
    ranked.forEach(item => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'grouped-source-button';
        const name = document.createElement('span');
        name.textContent = item.source_name || item.source_code || '资源';
        button.appendChild(name);
        const version = window.LibreExperience?.versionLabel?.(item) || '';
        if (version) {
            const tag = document.createElement('span');
            tag.className = `grouped-source-version${rank(item) <= 1 ? ' is-low' : ''}`;
            tag.textContent = version;
            button.appendChild(tag);
        }
        button.onclick = () => showDetails(item.vod_id, item.vod_name, item.source_code);
        content.appendChild(button);
    });
    modal.classList.remove('hidden');
}

function saveSearchResultForLater(index) {
    const group = currentSearchGroups[index];
    if (!group?.length) return;
    const item = group[0];
    LibreExperience.addWatchLater({...QuickPlay.logic.identity(item), ...(group.length === 1 ? {source:item.source_code, id:item.vod_id} : {})});
    showToast('已加入稍后看', 'success');
}
