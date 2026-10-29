// 豆瓣热门电影电视剧推荐功能

// 豆瓣标签列表 - 修改为默认标签
const ADULT_RECOMMEND_TAG = '成人视频';
let defaultMovieTags = ['热门', '最新', '经典', '豆瓣高分', '冷门佳片', '华语', '欧美', '韩国', '日本', '动作', '喜剧', '日综', '爱情', '科幻', '悬疑', '恐怖', '治愈'];
let defaultTvTags = ['热门', '美剧', '英剧', '韩剧', '日剧', '国产剧', '港剧', '日本动画', '综艺', '纪录片'];

// 用户标签列表 - 存储用户实际使用的标签（包含保留的系统标签和用户添加的自定义标签）
let movieTags = [];
let tvTags = [];

function sanitizeDoubanTags(tags, fallbackTags = []) {
    const sourceTags = Array.isArray(tags) ? tags : fallbackTags;
    const seen = new Set();

    return sourceTags
        .map(tag => String(tag || '').trim())
        .filter(tag => tag && tag !== ADULT_RECOMMEND_TAG)
        .filter(tag => {
            const key = tag.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

// 加载用户标签
function loadUserTags() {
    try {
        let shouldResaveTags = false;
        // 尝试从本地存储加载用户保存的标签
        const savedMovieTags = localStorage.getItem('userMovieTags');
        const savedTvTags = localStorage.getItem('userTvTags');
        
        // 如果本地存储中有标签数据，则使用它
        if (savedMovieTags) {
            const parsedMovieTags = JSON.parse(savedMovieTags);
            movieTags = sanitizeDoubanTags(parsedMovieTags, defaultMovieTags);
            shouldResaveTags = shouldResaveTags || !Array.isArray(parsedMovieTags) || movieTags.length !== parsedMovieTags.length;
        } else {
            // 否则使用默认标签
            movieTags = sanitizeDoubanTags(defaultMovieTags);
        }
        
        if (savedTvTags) {
            const parsedTvTags = JSON.parse(savedTvTags);
            tvTags = sanitizeDoubanTags(parsedTvTags, defaultTvTags);
            shouldResaveTags = shouldResaveTags || !Array.isArray(parsedTvTags) || tvTags.length !== parsedTvTags.length;
        } else {
            // 否则使用默认标签
            tvTags = sanitizeDoubanTags(defaultTvTags);
        }

        if (shouldResaveTags) {
            saveUserTags();
        }
    } catch (e) {
        console.error('加载标签失败：', e);
        // 初始化为默认值，防止错误
        movieTags = sanitizeDoubanTags(defaultMovieTags);
        tvTags = sanitizeDoubanTags(defaultTvTags);
    }
}

// 保存用户标签
function saveUserTags() {
    try {
        movieTags = sanitizeDoubanTags(movieTags, defaultMovieTags);
        tvTags = sanitizeDoubanTags(tvTags, defaultTvTags);
        localStorage.setItem('userMovieTags', JSON.stringify(movieTags));
        localStorage.setItem('userTvTags', JSON.stringify(tvTags));
    } catch (e) {
        console.error('保存标签失败：', e);
        showToast('保存标签失败', 'error');
    }
}

let doubanMovieTvCurrentSwitch = 'movie';
let doubanCurrentTag = '热门';
let doubanPageStart = 0;
const doubanPageSize = 16; // 一次显示的项目数量

function isAdultRecommendTagAvailable() {
    return typeof window.shouldShowAdultRecommendTag === 'function'
        && window.shouldShowAdultRecommendTag();
}

function getCurrentDoubanBaseTags() {
    const currentTags = doubanMovieTvCurrentSwitch === 'movie' ? movieTags : tvTags;
    return sanitizeDoubanTags(currentTags);
}

function getVisibleDoubanTags() {
    const visibleTags = getCurrentDoubanBaseTags();
    if (isAdultRecommendTagAvailable()) {
        visibleTags.push(ADULT_RECOMMEND_TAG);
    }
    return visibleTags;
}

function ensureValidDoubanTag() {
    if (doubanCurrentTag === ADULT_RECOMMEND_TAG && !isAdultRecommendTagAvailable()) {
        doubanCurrentTag = '热门';
        doubanPageStart = 0;
        return true;
    }
    return false;
}

function refreshDoubanAdultTagState() {
    const tagChanged = ensureValidDoubanTag();
    renderDoubanTags();

    const doubanArea = document.getElementById('doubanArea');
    const shouldReload = tagChanged || doubanCurrentTag === ADULT_RECOMMEND_TAG;
    if (
        shouldReload
        && localStorage.getItem('doubanEnabled') === 'true'
        && (!doubanArea || !doubanArea.classList.contains('hidden'))
    ) {
        renderRecommend(doubanCurrentTag, doubanPageSize, doubanPageStart);
    }
}

// 组合筛选（类型 / 地区 / 年代 / 排序）：打开筛选面板时，列表改为按筛选条件加载，并支持“加载更多”
let doubanFilterState = window.DoubanFilter ? window.DoubanFilter.readState() : null;
let doubanFilterStart = 0;

function isDoubanFilterMode() {
    return Boolean(doubanFilterState?.open);
}

function setDoubanFilterOpen(open) {
    if (!doubanFilterState) return;
    doubanFilterState.open = open;
    window.DoubanFilter.writeState(doubanFilterState);
}

function setDoubanButtonVisible(id, visible) {
    const button = document.getElementById(id);
    if (button) button.style.display = visible ? '' : 'none';
}

function renderDoubanFilterPanel() {
    const panel = document.getElementById('douban-filter-panel');
    const filterMode = isDoubanFilterMode();
    setDoubanButtonVisible('douban-refresh', !filterMode);
    if (!filterMode) setDoubanButtonVisible('douban-more', false);
    if (!panel || !doubanFilterState) return;
    panel.hidden = !filterMode;
    if (!filterMode) {
        panel.replaceChildren();
        return;
    }
    const kind = doubanMovieTvCurrentSwitch;
    window.DoubanFilter.renderPanel(panel, kind, doubanFilterState[kind], nextFilter => {
        doubanFilterState[kind] = nextFilter;
        window.DoubanFilter.writeState(doubanFilterState);
        renderDoubanFilterPanel();
        loadDoubanFilterResults(true);
    });
}

function toggleDoubanFilter() {
    setDoubanFilterOpen(!isDoubanFilterMode());
    renderDoubanTags();
    if (localStorage.getItem('doubanEnabled') === 'true') {
        renderRecommend(doubanCurrentTag, doubanPageSize, doubanPageStart);
    }
}

function loadDoubanFilterResults(reset = true) {
    const container = document.getElementById('douban-results');
    if (!container || !doubanFilterState) return;
    const requestId = ++doubanRenderSeq;
    const isCurrentRequest = () => requestId === doubanRenderSeq;
    const kind = doubanMovieTvCurrentSwitch;
    const filter = doubanFilterState[kind];
    const start = reset ? 0 : doubanFilterStart;
    const moreButton = document.getElementById('douban-more');

    if (reset) {
        showDoubanLoadingOverlay(container);
        setDoubanButtonVisible('douban-more', false);
    } else if (moreButton) {
        moreButton.disabled = true;
        moreButton.textContent = '加载中…';
    }

    const target = window.DoubanFilter.buildRecommendUrl(kind, filter, start);
    return fetchDoubanDataShared(target)
        .then(data => {
            if (!isCurrentRequest()) return;
            const page = window.DoubanFilter.mapRecommend(data);
            doubanFilterStart = start + page.received;
            renderDoubanCards({ subjects: page.subjects }, container, {
                append: !reset,
                emptyText: '没有符合条件的影片，换个条件试试'
            });
            setDoubanButtonVisible('douban-more', page.received > 0 && doubanFilterStart < page.total);
        })
        .catch(error => {
            if (!isCurrentRequest()) return;
            console.error('豆瓣筛选加载失败：', error);
            if (reset) {
                container.innerHTML = `
                    <div class="col-span-full text-center py-8">
                        <div class="text-red-400">❌ 筛选结果加载失败，请稍后重试</div>
                        <div class="text-gray-500 text-sm mt-2">可以先关闭“筛选”，用上方标签浏览</div>
                    </div>
                `;
            } else {
                showToast('加载失败，请稍后重试', 'error');
            }
        })
        .finally(() => {
            if (moreButton) {
                moreButton.disabled = false;
                moreButton.textContent = '加载更多';
            }
        });
}

function showDoubanLoadingOverlay(container) {
    container.classList.add('relative');
    container.querySelector('.douban-loading-overlay')?.remove();
    container.insertAdjacentHTML('beforeend', `
        <div class="douban-loading-overlay absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-10">
            <div class="flex items-center justify-center">
                <div class="w-6 h-6 border-2 border-pink-500 border-t-transparent rounded-full animate-spin inline-block"></div>
                <span class="text-pink-500 ml-4">加载中...</span>
            </div>
        </div>
    `);
}

// 找不到播放源的豆瓣条目自动隐藏（可点“显示”看回来）；筛选模式下隐藏太多时自动补一页
let doubanHiddenCount = 0;
let doubanAutoLoads = 0;
let doubanAutoLoadTimer = null;
const DOUBAN_MIN_VISIBLE = 12;

function updateDoubanHiddenNote() {
    const note = document.getElementById('douban-hidden-note');
    if (!note) return;
    note.hidden = doubanHiddenCount === 0;
    const count = note.querySelector('[data-hidden-count]');
    if (count) count.textContent = String(doubanHiddenCount);
}

function toggleDoubanUnavailable() {
    const container = document.getElementById('douban-results');
    const button = document.querySelector('#douban-hidden-note button');
    if (!container || !button) return;
    const showing = container.classList.toggle('show-unavailable');
    button.textContent = showing ? '隐藏' : '显示';
    button.setAttribute('aria-pressed', String(showing));
}

function visibleDoubanCards(container) {
    return [...container.children].filter(card => card.dataset.doubanCard && !card.classList.contains('douban-unavailable')).length;
}

function maybeAutoLoadMoreDouban(container) {
    if (!isDoubanFilterMode() || doubanAutoLoads >= 3) return;
    clearTimeout(doubanAutoLoadTimer);
    doubanAutoLoadTimer = setTimeout(() => {
        const moreButton = document.getElementById('douban-more');
        const canLoadMore = moreButton && moreButton.style.display !== 'none' && !moreButton.disabled;
        if (canLoadMore && visibleDoubanCards(container) < DOUBAN_MIN_VISIBLE) {
            doubanAutoLoads++;
            loadDoubanFilterResults(false);
        }
    }, 800);
}

// Douban sends a generic picture (…/pics/subject/movie_normal.png) for titles without a poster yet.
function isDoubanDefaultPoster(url) {
    return /doubanio\.com\/f\/|\/pics\/subject\/|_default/.test(String(url || ''));
}

function checkDoubanCardAvailability(card, item, container) {
    if (!window.SourceAvailability) return;
    const request = {
        title: item.title,
        year: item.year || '',
        kind: doubanMovieTvCurrentSwitch,
        isWanted: () => card.isConnected
    };
    window.SourceAvailability.check(request).then(available => {
        if (available && isDoubanDefaultPoster(item.cover)) {
            const cover = window.SourceAvailability.coverOf(request);
            const image = card.querySelector('img');
            if (cover && image) { image.dataset.originalSrc = cover; image.src = cover; }
        }
        if (available !== false || !card.isConnected) return;
        card.classList.add('douban-unavailable');
        doubanHiddenCount++;
        updateDoubanHiddenNote();
        maybeAutoLoadMoreDouban(container);
    });
}

let doubanInitialized = false;
// 最近一次推荐请求的序号：只有最新请求的结果会被渲染
let doubanRenderSeq = 0;
// 进行中的豆瓣列表请求（按请求地址共享），重复调用不会再次请求
const doubanInflightRequests = new Map();

function fetchDoubanDataShared(url) {
    if (!doubanInflightRequests.has(url)) {
        const request = fetchDoubanData(url).finally(() => doubanInflightRequests.delete(url));
        doubanInflightRequests.set(url, request);
    }
    return doubanInflightRequests.get(url);
}

// 初始化豆瓣功能
function initDouban() {
    // 密码验证通过后会再次调用：只刷新显示状态，避免重复绑定事件和重复加载封面
    if (doubanInitialized) {
        updateDoubanVisibility();
        return;
    }
    doubanInitialized = true;

    // 先准备标签和切换状态，再按显示状态加载一次推荐内容
    loadUserTags();
    renderDoubanMovieTvSwitch();
    renderDoubanTags();
    setupDoubanRefreshBtn();
    const moreButton = document.getElementById('douban-more');
    if (moreButton) moreButton.onclick = () => loadDoubanFilterResults(false);

    // 设置豆瓣开关的初始状态
    const doubanToggle = document.getElementById('doubanToggle');
    if (doubanToggle) {
        const isEnabled = localStorage.getItem('doubanEnabled') === 'true';
        doubanToggle.checked = isEnabled;
        
        // 设置开关外观
        const toggleBg = doubanToggle.nextElementSibling;
        const toggleDot = toggleBg.nextElementSibling;
        if (isEnabled) {
            toggleBg.classList.add('bg-pink-600');
            toggleDot.classList.add('translate-x-6');
        }
        
        // 添加事件监听
        doubanToggle.addEventListener('change', function(e) {
            const isChecked = e.target.checked;
            localStorage.setItem('doubanEnabled', isChecked);
            
            // 更新开关外观
            if (isChecked) {
                toggleBg.classList.add('bg-pink-600');
                toggleDot.classList.add('translate-x-6');
            } else {
                toggleBg.classList.remove('bg-pink-600');
                toggleDot.classList.remove('translate-x-6');
            }
            
            // 更新显示状态
            updateDoubanVisibility();
        });
        
        // 初始更新显示状态（启用且列表为空时会加载一次推荐内容）
        updateDoubanVisibility();

        // 滚动到页面顶部
        window.scrollTo(0, 0);
    }
}

// 根据设置更新豆瓣区域的显示状态
function updateDoubanVisibility() {
    const doubanArea = document.getElementById('doubanArea');
    if (!doubanArea) return;
    
    const isEnabled = localStorage.getItem('doubanEnabled') === 'true';
    const isSearching = document.getElementById('resultsArea') && 
        !document.getElementById('resultsArea').classList.contains('hidden');
    
    // 只有在启用且没有搜索结果显示时才显示豆瓣区域
    window.renderHomeGuide?.();
    if (isEnabled && !isSearching) {
        doubanArea.classList.remove('hidden');
        // 如果豆瓣结果为空，重新加载
        if (document.getElementById('douban-results').children.length === 0) {
            renderRecommend(doubanCurrentTag, doubanPageSize, doubanPageStart);
        }
    } else {
        doubanArea.classList.add('hidden');
    }
}

// 只填充搜索框，不执行搜索，让用户自主决定搜索时机
function fillSearchInput(title) {
    if (!title) return;
    
    // 安全处理标题，防止XSS
    const safeTitle = title
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    
    const input = document.getElementById('searchInput');
    if (input) {
        input.value = safeTitle;
        
        // 聚焦搜索框，便于用户立即使用键盘操作
        input.focus();
        
        // 显示一个提示，告知用户点击搜索按钮进行搜索
        showToast('已填充搜索内容，点击搜索按钮开始搜索', 'info');
    }
}

// 填充搜索框并执行搜索
function fillAndSearch(title) {
    if (!title) return;
    
    // 安全处理标题，防止XSS
    const safeTitle = title
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    
    const input = document.getElementById('searchInput');
    if (input) {
        input.value = safeTitle;
        search(); // 使用已有的search函数执行搜索
        
        // 同时更新浏览器URL，使其反映当前的搜索状态
        try {
            // 使用URI编码确保特殊字符能够正确显示
            const encodedQuery = encodeURIComponent(safeTitle);
            // 使用HTML5 History API更新URL，不刷新页面
            window.history.pushState(
                { search: safeTitle }, 
                `搜索: ${safeTitle} - LibreTV`, 
                `/s=${encodedQuery}`
            );
            // 更新页面标题
            document.title = `搜索: ${safeTitle} - LibreTV`;
        } catch (e) {
            console.error('更新浏览器历史失败:', e);
        }
    }
}

// 填充搜索框，确保推荐资源API被选中，然后执行搜索
async function fillAndSearchWithDouban(title) {
    if (!title) return;
    
    // 安全处理标题，防止XSS
    const safeTitle = title
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    
    const preferredSource = DEFAULT_SELECTED_APIS.find(apiId => API_SITES[apiId]);
    const hasSearchableSource = typeof selectedAPIs !== 'undefined' &&
        (typeof getSearchableApiIds === 'function' ? getSearchableApiIds(selectedAPIs) : selectedAPIs).length > 0;

    // 只有一个可搜索的源都没选时才自动补选默认源，不改动用户自己的选择
    if (preferredSource && !hasSearchableSource && !selectedAPIs.includes(preferredSource)) {
        const sourceCheckbox = document.querySelector(`input[id="api_${preferredSource}"]`);
        if (sourceCheckbox) {
            sourceCheckbox.checked = true;
            
            // 触发updateSelectedAPIs函数以更新状态
            if (typeof updateSelectedAPIs === 'function') {
                updateSelectedAPIs();
            } else {
                // 如果函数不可用，则手动添加到selectedAPIs
                selectedAPIs.push(preferredSource);
                localStorage.setItem('selectedAPIs', JSON.stringify(selectedAPIs));
                
                // 更新选中API计数（如果有这个元素）
                const countEl = document.getElementById('selectedAPICount');
                if (countEl) {
                    countEl.textContent = selectedAPIs.length;
                }
            }
            
            showToast('已自动选择推荐资源API', 'info');
        }
    }
    
    // 填充搜索框并执行搜索
    const input = document.getElementById('searchInput');
    if (input) {
        input.value = safeTitle;
        await search(); // 使用已有的search函数执行搜索
        
        // 更新浏览器URL，使其反映当前的搜索状态
        try {
            // 使用URI编码确保特殊字符能够正确显示
            const encodedQuery = encodeURIComponent(safeTitle);
            // 使用HTML5 History API更新URL，不刷新页面
            window.history.pushState(
                { search: safeTitle }, 
                `搜索: ${safeTitle} - LibreTV`, 
                `/s=${encodedQuery}`
            );
            // 更新页面标题
            document.title = `搜索: ${safeTitle} - LibreTV`;
        } catch (e) {
            console.error('更新浏览器历史失败:', e);
        }

        if (window.innerWidth <= 768) {
          window.scrollTo({
              top: 0,
              behavior: 'smooth'
          });
        }
    }
}

// 渲染电影/电视剧切换器
function renderDoubanMovieTvSwitch() {
    // 获取切换按钮元素
    const movieToggle = document.getElementById('douban-movie-toggle');
    const tvToggle = document.getElementById('douban-tv-toggle');

    if (!movieToggle ||!tvToggle) return;

    movieToggle.addEventListener('click', function() {
        if (doubanMovieTvCurrentSwitch !== 'movie') {
            // 更新按钮样式
            movieToggle.classList.add('bg-pink-600', 'text-white');
            movieToggle.classList.remove('text-gray-300');
            
            tvToggle.classList.remove('bg-pink-600', 'text-white');
            tvToggle.classList.add('text-gray-300');
            
            doubanMovieTvCurrentSwitch = 'movie';
            doubanCurrentTag = '热门';

            // 重新加载豆瓣内容
            renderDoubanTags(movieTags);

            // 换一批按钮事件监听
            setupDoubanRefreshBtn();
            
            // 初始加载热门内容
            if (localStorage.getItem('doubanEnabled') === 'true') {
                renderRecommend(doubanCurrentTag, doubanPageSize, doubanPageStart);
            }
        }
    });
    
    // 电视剧按钮点击事件
    tvToggle.addEventListener('click', function() {
        if (doubanMovieTvCurrentSwitch !== 'tv') {
            // 更新按钮样式
            tvToggle.classList.add('bg-pink-600', 'text-white');
            tvToggle.classList.remove('text-gray-300');
            
            movieToggle.classList.remove('bg-pink-600', 'text-white');
            movieToggle.classList.add('text-gray-300');
            
            doubanMovieTvCurrentSwitch = 'tv';
            doubanCurrentTag = '热门';

            // 重新加载豆瓣内容
            renderDoubanTags(tvTags);

            // 换一批按钮事件监听
            setupDoubanRefreshBtn();
            
            // 初始加载热门内容
            if (localStorage.getItem('doubanEnabled') === 'true') {
                renderRecommend(doubanCurrentTag, doubanPageSize, doubanPageStart);
            }
        }
    });
}

// 渲染豆瓣标签选择器
function renderDoubanTags(tags) {
    const tagContainer = document.getElementById('douban-tags');
    if (!tagContainer) return;

    ensureValidDoubanTag();

    // 确定当前应该使用的标签列表
    const currentTags = getVisibleDoubanTags();
    
    // 清空标签容器
    tagContainer.innerHTML = '';

    // 先添加标签管理按钮
    const manageBtn = document.createElement('button');
    manageBtn.className = 'py-1.5 px-3.5 rounded text-sm font-medium transition-all duration-300 bg-[#1a1a1a] text-gray-300 hover:bg-pink-700 hover:text-white border border-[#333] hover:border-white';
    manageBtn.innerHTML = '<span class="flex items-center"><svg class="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>管理标签</span>';
    manageBtn.onclick = function() {
        showTagManageModal();
    };
    tagContainer.appendChild(manageBtn);

    const filterMode = isDoubanFilterMode();
    if (doubanFilterState) {
        const filterBtn = document.createElement('button');
        filterBtn.id = 'douban-filter-toggle';
        filterBtn.className = 'douban-filter-toggle py-1.5 px-3.5 rounded text-sm font-medium transition-all duration-300 border ' +
            (filterMode ? 'bg-pink-600 text-white shadow-md border-white' : 'bg-[#1a1a1a] text-gray-300 hover:bg-pink-700 hover:text-white border-[#333] hover:border-white');
        filterBtn.setAttribute('aria-expanded', String(filterMode));
        filterBtn.setAttribute('aria-controls', 'douban-filter-panel');
        filterBtn.innerHTML = '<span class="flex items-center"><svg class="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4h18l-7 8v6l-4 2v-8L3 4z"></path></svg>筛选</span>';
        filterBtn.onclick = toggleDoubanFilter;
        tagContainer.appendChild(filterBtn);
    }

    // 添加所有标签
    currentTags.forEach(tag => {
        const btn = document.createElement('button');
        
        // 设置样式
        let btnClass = 'py-1.5 px-3.5 rounded text-sm font-medium transition-all duration-300 border ';
        
        // 当前选中的标签使用高亮样式（筛选模式下标签不高亮）
        if (tag === doubanCurrentTag && !filterMode) {
            btnClass += 'bg-pink-600 text-white shadow-md border-white';
        } else {
            btnClass += 'bg-[#1a1a1a] text-gray-300 hover:bg-pink-700 hover:text-white border-[#333] hover:border-white';
        }
        
        btn.className = btnClass;
        btn.textContent = tag;
        
        btn.onclick = function() {
            // 点快捷标签即退出筛选模式
            if (doubanCurrentTag !== tag || isDoubanFilterMode()) {
                setDoubanFilterOpen(false);
                doubanCurrentTag = tag;
                doubanPageStart = 0;
                renderDoubanTags();
                renderRecommend(doubanCurrentTag, doubanPageSize, doubanPageStart);
            }
        };
        
        tagContainer.appendChild(btn);
    });

    renderDoubanFilterPanel();
}

// 设置换一批按钮事件
function setupDoubanRefreshBtn() {
    // 修复ID，使用正确的ID douban-refresh 而不是 douban-refresh-btn
    const btn = document.getElementById('douban-refresh');
    if (!btn) return;
    
    btn.onclick = function() {
        doubanPageStart += doubanPageSize;
        if (doubanPageStart > 9 * doubanPageSize) {
            doubanPageStart = 0;
        }
        
        renderRecommend(doubanCurrentTag, doubanPageSize, doubanPageStart);
    };
}

function fetchDoubanTags() {
    const movieTagsTarget = `https://movie.douban.com/j/search_tags?type=movie`
    fetchDoubanData(movieTagsTarget)
        .then(data => {
            movieTags = sanitizeDoubanTags(data.tags, defaultMovieTags);
            if (doubanMovieTvCurrentSwitch === 'movie') {
                renderDoubanTags(movieTags);
            }
        })
        .catch(error => {
            console.error("获取豆瓣热门电影标签失败：", error);
        });
    const tvTagsTarget = `https://movie.douban.com/j/search_tags?type=tv`
    fetchDoubanData(tvTagsTarget)
       .then(data => {
            tvTags = sanitizeDoubanTags(data.tags, defaultTvTags);
            if (doubanMovieTvCurrentSwitch === 'tv') {
                renderDoubanTags(tvTags);
            }
        })
       .catch(error => {
            console.error("获取豆瓣热门电视剧标签失败：", error);
        });
}

// 渲染热门推荐内容
function renderRecommend(tag, pageLimit, pageStart) {
    const container = document.getElementById("douban-results");
    if (!container) return;

    if (isDoubanFilterMode()) {
        return loadDoubanFilterResults(true);
    }

    const requestId = ++doubanRenderSeq;
    const isCurrentRequest = () => requestId === doubanRenderSeq;

    showDoubanLoadingOverlay(container);

    if (tag === ADULT_RECOMMEND_TAG) {
        return renderAdultRecommend(pageLimit, pageStart, isCurrentRequest);
    }

    const target = `https://movie.douban.com/j/search_subjects?type=${doubanMovieTvCurrentSwitch}&tag=${tag}&sort=recommend&page_limit=${pageLimit}&page_start=${pageStart}`;

    // 相同的请求共享同一份数据，但只有最新一次调用会渲染，避免同一批封面被渲染两次
    return fetchDoubanDataShared(target)
        .then(data => {
            if (isCurrentRequest()) renderDoubanCards(data, container);
        })
        .catch(error => {
            if (!isCurrentRequest()) return;
            console.error("获取豆瓣数据失败：", error);
            container.innerHTML = `
                <div class="col-span-full text-center py-8">
                    <div class="text-red-400">❌ 获取豆瓣数据失败，请稍后重试</div>
                    <div class="text-gray-500 text-sm mt-2">提示：使用VPN可能有助于解决此问题</div>
                </div>
            `;
        });
}

function escapeInlineJsString(value) {
    return String(value || '')
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\r?\n/g, ' ');
}

function getAdultRecommendPage(pageLimit, pageStart) {
    const limit = Number.parseInt(pageLimit, 10) || doubanPageSize;
    const start = Number.parseInt(pageStart, 10) || 0;
    return Math.max(1, Math.floor(start / limit) + 1);
}

async function renderAdultRecommend(pageLimit, pageStart, isCurrentRequest = () => true) {
    const container = document.getElementById("douban-results");
    if (!container) return;

    const adultApiIds = typeof window.getSelectedAdultApiIds === 'function'
        ? window.getSelectedAdultApiIds()
        : [];

    if (!isAdultRecommendTagAvailable() || adultApiIds.length === 0) {
        if (isCurrentRequest()) renderDoubanCards({ subjects: [] }, container);
        return;
    }

    try {
        const page = getAdultRecommendPage(pageLimit, pageStart);
        const batches = await Promise.all(adultApiIds.map(async apiId => {
            if (typeof fetchLatestByAPI !== 'function') return [];
            return fetchLatestByAPI(apiId, page);
        }));

        const adultResults = batches
            .flat()
            .filter(item => typeof matchesYellowContent !== 'function' || matchesYellowContent(item))
            .slice(0, pageLimit);

        if (isCurrentRequest()) renderAdultCards(adultResults, container);
    } catch (error) {
        if (!isCurrentRequest()) return;
        console.error("获取成人视频数据失败：", error);
        container.innerHTML = `
            <div class="col-span-full text-center py-8">
                <div class="text-red-400">❌ 获取成人视频数据失败，请稍后重试</div>
            </div>
        `;
    }
}

function renderAdultCards(items, container) {
    const fragment = document.createDocumentFragment();

    if (!items || items.length === 0) {
        const emptyEl = document.createElement("div");
        emptyEl.className = "col-span-full text-center py-8";
        emptyEl.innerHTML = `
            <div class="text-pink-500">❌ 暂无数据，请尝试其他分类或刷新</div>
        `;
        fragment.appendChild(emptyEl);
    } else {
        items.forEach(item => {
            const card = document.createElement("div");
            card.className = "bg-[#111] hover:bg-[#222] transition-all duration-300 rounded-lg overflow-hidden flex flex-col transform hover:scale-105 shadow-md hover:shadow-lg";

            const rawTitle = item.vod_name || '未知视频';
            const safeTitle = escapeHtmlAttr(rawTitle);
            const safeTitleJs = escapeInlineJsString(rawTitle);
            const safeIdJs = escapeInlineJsString(item.vod_id || '');
            const safeSourceCodeJs = escapeInlineJsString(item.source_code || '');
            const sourceName = escapeHtmlAttr(item.source_name || '');
            const originalCoverUrl = normalizeImageUrl(item.vod_pic, item.api_url || API_SITES[item.source_code]?.api || '');
            const safeCoverUrl = escapeHtmlAttr(originalCoverUrl);

            card.innerHTML = `
                <div class="relative w-full aspect-[2/3] overflow-hidden cursor-pointer" data-quick-entry>
                    <img src="${safeCoverUrl}" data-original-src="${safeCoverUrl}" alt="${safeTitle}"
                        class="w-full h-full object-cover transition-transform duration-500 hover:scale-110"
                        onerror="window.setImageProxyFallback(this, this.dataset.originalSrc, '暂无封面')"
                        loading="lazy" referrerpolicy="no-referrer">
                    <div class="absolute inset-0 bg-gradient-to-t from-black to-transparent opacity-60"></div>
                    <div class="absolute bottom-2 left-2 bg-pink-500/80 text-white text-xs px-2 py-1 rounded-sm">
                        ${ADULT_RECOMMEND_TAG}
                    </div>
                    ${sourceName ? `
                    <div class="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded-sm">
                        ${sourceName}
                    </div>` : ''}
                </div>
                <div class="p-2 text-center bg-[#111]">
                    <button data-quick-entry
                            class="text-sm font-medium text-white truncate w-full hover:text-pink-400 transition"
                            title="${safeTitle}">
                        ${safeTitle}
                    </button>
                </div>
            `;

            card.querySelectorAll('[data-quick-entry]').forEach(entry => entry.addEventListener('click', event => {
                if (event.target.closest('a')) return;
                QuickPlay.open({ ...QuickPlay.logic.identity(item), id: item.vod_id, source: item.source_code });
            }));
            fragment.appendChild(card);
        });
    }

    container.innerHTML = "";
    container.appendChild(fragment);
}

async function fetchDoubanData(url) {
    // 添加超时控制
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时
    
    // 设置请求选项，包括信号和头部
    const fetchOptions = {
        signal: controller.signal,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'Referer': 'https://movie.douban.com/',
            'Accept': 'application/json, text/plain, */*',
        }
    };

    try {
        // 添加鉴权参数到代理URL
        const proxiedUrl = await window.ProxyAuth?.addAuthToProxyUrl ? 
            await window.ProxyAuth.addAuthToProxyUrl(PROXY_URL + encodeURIComponent(url)) :
            PROXY_URL + encodeURIComponent(url);
            
        // 尝试直接访问（豆瓣API可能允许部分CORS请求）
        const response = await fetch(proxiedUrl, fetchOptions);
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        
        return await response.json();
    } catch (err) {
        console.error("豆瓣 API 请求失败（直接代理）：", err);
        
        // 失败后尝试备用方法：作为备选
        const fallbackUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
        
        try {
            const fallbackResponse = await fetch(fallbackUrl);
            
            if (!fallbackResponse.ok) {
                throw new Error(`备用API请求失败! 状态: ${fallbackResponse.status}`);
            }
            
            const data = await fallbackResponse.json();
            
            // 解析原始内容
            if (data && data.contents) {
                return JSON.parse(data.contents);
            } else {
                throw new Error("无法获取有效数据");
            }
        } catch (fallbackErr) {
            console.error("豆瓣 API 备用请求也失败：", fallbackErr);
            throw fallbackErr; // 向上抛出错误，让调用者处理
        }
    }
}

// 抽取渲染豆瓣卡片的逻辑到单独函数
function renderDoubanCards(data, container, options = {}) {
    // 创建文档片段以提高性能
    const fragment = document.createDocumentFragment();
    const subjects = Array.isArray(data.subjects)
        ? data.subjects.filter(item => typeof matchesYellowContent !== 'function' || !matchesYellowContent(item))
        : [];
    
    // 如果没有数据
    if (subjects.length === 0) {
        const emptyEl = document.createElement("div");
        emptyEl.className = "col-span-full text-center py-8";
        emptyEl.innerHTML = `
            <div class="text-pink-500">❌ ${escapeHtmlAttr(options.emptyText || '暂无数据，请尝试其他分类或刷新')}</div>
        `;
        fragment.appendChild(emptyEl);
    } else {
        // 循环创建每个影视卡片
        subjects.forEach(item => {
            const card = document.createElement("div");
            card.className = "bg-[#111] hover:bg-[#222] transition-all duration-300 rounded-lg overflow-hidden flex flex-col transform hover:scale-105 shadow-md hover:shadow-lg";
            
            // 生成卡片内容，确保安全显示（防止XSS）
            const safeTitle = item.title
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
            
            const safeRate = escapeHtmlAttr(item.rate || '');
            
            const originalCoverUrl = normalizeImageUrl(item.cover);
            const safeCoverUrl = escapeHtmlAttr(originalCoverUrl);
            
            // 为不同设备优化卡片布局
            card.innerHTML = `
                <div class="relative w-full aspect-[2/3] overflow-hidden cursor-pointer" data-quick-entry>
                    <img src="${safeCoverUrl}" data-original-src="${safeCoverUrl}" alt="${safeTitle}"
                        class="w-full h-full object-cover transition-transform duration-500 hover:scale-110"
                        onerror="window.setImageProxyFallback(this, this.dataset.originalSrc, '暂无封面')"
                        loading="lazy" referrerpolicy="no-referrer">
                    <div class="absolute inset-0 bg-gradient-to-t from-black to-transparent opacity-60"></div>
                    ${safeRate ? `<div class="absolute bottom-2 left-2 bg-black/70 text-white text-xs px-2 py-1 rounded-sm">
                        <span class="text-yellow-400">★</span> ${safeRate}
                    </div>` : `<div class="douban-unrated-badge" title="豆瓣评分人数不足，暂未给出评分">暂无评分</div>`}
                    <div class="douban-unavailable-badge">暂无播放源</div>
                    <div class="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded-sm hover:bg-[#333] transition-colors">
                        <a href="${escapeHtmlAttr(item.url)}" target="_blank" rel="noopener noreferrer" title="在豆瓣查看" onclick="event.stopPropagation();">
                            🔗
                        </a>
                    </div>
                </div>
                <div class="p-2 text-center bg-[#111]">
                    <button data-quick-entry
                            class="text-sm font-medium text-white truncate w-full hover:text-pink-400 transition"
                            title="${safeTitle}">
                        ${safeTitle}
                    </button>
                    ${item.meta ? `<div class="douban-card-meta">${escapeHtmlAttr(item.meta)}</div>` : ''}
                    <button data-watch-later class="text-xs text-gray-300 mt-2" type="button">稍后看</button>
                </div>
            `;
            
            card.querySelectorAll('[data-quick-entry]').forEach(entry => entry.addEventListener('click', event => {
                if (event.target.closest('a')) return;
                QuickPlay.open({ title: item.title, year: item.year || '', kind: doubanMovieTvCurrentSwitch === 'tv' ? 'tv' : 'movie' });
            }));
            card.querySelector('[data-watch-later]')?.addEventListener('click', () => {
                LibreExperience.addWatchLater({title:item.title,year:item.year || '',kind:doubanMovieTvCurrentSwitch === 'tv' ? 'tv' : 'movie'});
                showToast('已加入稍后看', 'success');
            });
            card.dataset.doubanCard = 'true';
            fragment.appendChild(card);
            if (options.checkAvailability !== false) checkDoubanCardAvailability(card, item, container);
        });
    }
    
    if (!options.append) {
        doubanHiddenCount = 0;
        doubanAutoLoads = 0;
        updateDoubanHiddenNote();
    }

    // 加载更多时追加到末尾（空结果不追加提示）；否则清空后替换
    if (options.append) {
        container.querySelector('.douban-loading-overlay')?.remove();
        if (subjects.length) container.appendChild(fragment);
        return;
    }
    container.innerHTML = "";
    container.appendChild(fragment);
}

// 重置到首页
function resetToHome() {
    window.cancelActiveSearch?.();
    resetSearchArea();
    window.renderHomeGuide?.();
    updateDoubanVisibility();
}

// 加载豆瓣首页内容
document.addEventListener('DOMContentLoaded', initDouban);

window.ADULT_RECOMMEND_TAG = ADULT_RECOMMEND_TAG;
window.refreshDoubanAdultTagState = refreshDoubanAdultTagState;

// 显示标签管理模态框
function showTagManageModal() {
    // 确保模态框在页面上只有一个实例
    let modal = document.getElementById('tagManageModal');
    if (modal) {
        document.body.removeChild(modal);
    }
    
    // 创建模态框元素
    modal = document.createElement('div');
    modal.id = 'tagManageModal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-40';
    
    // 当前使用的标签类型和默认标签
    const isMovie = doubanMovieTvCurrentSwitch === 'movie';
    const currentTags = isMovie ? movieTags : tvTags;
    const defaultTags = isMovie ? defaultMovieTags : defaultTvTags;
    
    // 模态框内容
    modal.innerHTML = `
        <div class="bg-[#191919] rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto relative">
            <button id="closeTagModal" class="absolute top-4 right-4 text-gray-400 hover:text-white text-xl">&times;</button>
            
            <h3 class="text-xl font-bold text-white mb-4">标签管理 (${isMovie ? '电影' : '电视剧'})</h3>
            
            <div class="mb-4">
                <div class="flex justify-between items-center mb-2">
                    <h4 class="text-lg font-medium text-gray-300">标签列表</h4>
                    <button id="resetTagsBtn" class="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded">
                        恢复默认标签
                    </button>
                </div>
                <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4" id="tagsGrid">
                    ${currentTags.length ? currentTags.map(tag => {
                        // "热门"标签不能删除
                        const canDelete = tag !== '热门';
                        return `
                            <div class="bg-[#1a1a1a] text-gray-300 py-1.5 px-3 rounded text-sm font-medium flex justify-between items-center group">
                                <span>${tag}</span>
                                ${canDelete ? 
                                    `<button class="delete-tag-btn text-gray-500 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity" 
                                        data-tag="${tag}">✕</button>` : 
                                    `<span class="text-gray-500 text-xs italic opacity-0 group-hover:opacity-100">必需</span>`
                                }
                            </div>
                        `;
                    }).join('') : 
                    `<div class="col-span-full text-center py-4 text-gray-500">无标签，请添加或恢复默认</div>`}
                </div>
            </div>
            
            <div class="border-t border-gray-700 pt-4">
                <h4 class="text-lg font-medium text-gray-300 mb-3">添加新标签</h4>
                <form id="addTagForm" class="flex items-center">
                    <input type="text" id="newTagInput" placeholder="输入标签名称..." 
                           class="flex-1 bg-[#222] text-white border border-gray-700 rounded px-3 py-2 focus:outline-none focus:border-pink-500">
                    <button type="submit" class="ml-2 bg-pink-600 hover:bg-pink-700 text-white px-4 py-2 rounded">添加</button>
                </form>
                <p class="text-xs text-gray-500 mt-2">提示：标签名称不能为空，不能重复，不能包含特殊字符</p>
            </div>
        </div>
    `;
    
    // 添加模态框到页面
    document.body.appendChild(modal);
    
    // 焦点放在输入框上
    setTimeout(() => {
        document.getElementById('newTagInput').focus();
    }, 100);
    
    // 添加事件监听器 - 关闭按钮
    document.getElementById('closeTagModal').addEventListener('click', function() {
        document.body.removeChild(modal);
    });
    
    // 添加事件监听器 - 点击模态框外部关闭
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    });
    
    // 添加事件监听器 - 恢复默认标签按钮
    document.getElementById('resetTagsBtn').addEventListener('click', function() {
        resetTagsToDefault();
        showTagManageModal(); // 重新加载模态框
    });
    
    // 添加事件监听器 - 删除标签按钮
    const deleteButtons = document.querySelectorAll('.delete-tag-btn');
    deleteButtons.forEach(btn => {
        btn.addEventListener('click', function() {
            const tagToDelete = this.getAttribute('data-tag');
            deleteTag(tagToDelete);
            showTagManageModal(); // 重新加载模态框
        });
    });
    
    // 添加事件监听器 - 表单提交
    document.getElementById('addTagForm').addEventListener('submit', function(e) {
        e.preventDefault();
        const input = document.getElementById('newTagInput');
        const newTag = input.value.trim();
        
        if (newTag) {
            addTag(newTag);
            input.value = '';
            showTagManageModal(); // 重新加载模态框
        }
    });
}

// 添加标签
function addTag(tag) {
    // 安全处理标签名，防止XSS
    const safeTag = tag
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    if (safeTag === ADULT_RECOMMEND_TAG) {
        showToast('成人视频为系统标签，无需手动添加', 'info');
        return;
    }
    
    // 确定当前使用的是电影还是电视剧标签
    const isMovie = doubanMovieTvCurrentSwitch === 'movie';
    const currentTags = isMovie ? movieTags : tvTags;
    
    // 检查是否已存在（忽略大小写）
    const exists = currentTags.some(
        existingTag => existingTag.toLowerCase() === safeTag.toLowerCase()
    );
    
    if (exists) {
        showToast('标签已存在', 'warning');
        return;
    }
    
    // 添加到对应的标签数组
    if (isMovie) {
        movieTags.push(safeTag);
    } else {
        tvTags.push(safeTag);
    }
    
    // 保存到本地存储
    saveUserTags();
    
    // 重新渲染标签
    renderDoubanTags();
    
    showToast('标签添加成功', 'success');
}

// 删除标签
function deleteTag(tag) {
    // 热门标签不能删除
    if (tag === '热门') {
        showToast('热门标签不能删除', 'warning');
        return;
    }
    
    // 确定当前使用的是电影还是电视剧标签
    const isMovie = doubanMovieTvCurrentSwitch === 'movie';
    const currentTags = isMovie ? movieTags : tvTags;
    
    // 寻找标签索引
    const index = currentTags.indexOf(tag);
    
    // 如果找到标签，则删除
    if (index !== -1) {
        currentTags.splice(index, 1);
        
        // 保存到本地存储
        saveUserTags();
        
        // 如果当前选中的是被删除的标签，则重置为"热门"
        if (doubanCurrentTag === tag) {
            doubanCurrentTag = '热门';
            doubanPageStart = 0;
            renderRecommend(doubanCurrentTag, doubanPageSize, doubanPageStart);
        }
        
        // 重新渲染标签
        renderDoubanTags();
        
        showToast('标签删除成功', 'success');
    }
}

// 重置为默认标签
function resetTagsToDefault() {
    // 确定当前使用的是电影还是电视剧
    const isMovie = doubanMovieTvCurrentSwitch === 'movie';
    
    // 重置为默认标签
    if (isMovie) {
        movieTags = sanitizeDoubanTags(defaultMovieTags);
    } else {
        tvTags = sanitizeDoubanTags(defaultTvTags);
    }
    
    // 设置当前标签为热门
    doubanCurrentTag = '热门';
    doubanPageStart = 0;
    
    // 保存到本地存储
    saveUserTags();
    
    // 重新渲染标签和内容
    renderDoubanTags();
    renderRecommend(doubanCurrentTag, doubanPageSize, doubanPageStart);
    
    showToast('已恢复默认标签', 'success');
}
