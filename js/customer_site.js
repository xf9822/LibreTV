const CUSTOMER_SITES = {
    // 默认启用：覆盖面广、彼此不是镜像（2026-10 实测：热门片 6 部全部命中）
    ysgc: {
        api: 'https://cj.lziapi.com/api.php/provide/vod',
        name: '影视工厂',
        family: 'liangzi',
    },
    ffzy: {
        api: 'https://api.ffzyapi.com/api.php/provide/vod',
        name: '非凡影视',
    },
    bfzy: {
        api: 'https://bfzyapi.com/api.php/provide/vod',
        name: '暴风资源',
    },
    jszy: {
        api: 'https://jszyapi.com/api.php/provide/vod',
        name: '极速资源',
        family: 'jisu',
    },
    wujin: {
        api: 'https://api.wujinapi.com/api.php/provide/vod',
        name: '无尽资源',
        family: 'wujin',
    },
    // 可选
    zuid: {
        api: 'https://api.zuidapi.com/api.php/provide/vod',
        name: '最大资源',
    },
    ikun: {
        api: 'https://ikunzyapi.com/api.php/provide/vod',
        name: 'iKun资源',
    },
    mdzy: {
        api: 'https://www.mdzyapi.com/api.php/provide/vod',
        name: '魔都资源',
        family: 'modu',
    },
    baidu: {
        api: 'https://api.apibdzy.com/api.php/provide/vod',
        name: '百度云资源',
    },
    uku: {
        api: 'https://api.ukuapi88.com/api.php/provide/vod',
        name: 'U酷资源',
    },
    rycj: {
        api: 'https://cj.rycjapi.com/api.php/provide/vod',
        name: '如意资源',
    },
    zy360: {
        api: 'https://360zy.com/api.php/provide/vod',
        name: '360资源',
    },
    maoyan: {
        api: 'https://api.maoyanapi.top/api.php/provide/vod',
        name: '猫眼资源',
    },
    // 2026-10-31 新增：片库与上面各站都不同
    aidan: {
        api: 'https://lovedan.net/api.php/provide/vod',
        name: '爱蛋资源',
    },
    yzzy: {
        api: 'https://api.yzzy-api.com/inc/apijson.php',
        name: '优质资源',
    },
    // 备用线路：与上面某个站是同一家（片库相同、CDN 不同），一键优选只会在同一家里留最快的一个
    lzcaiji: {
        api: 'https://cj.lzcaiji.com/api.php/provide/vod',
        name: '量子资源',
        family: 'liangzi',
    },
    wujinme: {
        api: 'https://api.wujinapi.me/api.php/provide/vod',
        name: '无尽资源（备用）',
        family: 'wujin',
    },
    modu: {
        api: 'https://caiji.moduapi.cc/api.php/provide/vod',
        name: '魔都资源（备用）',
        family: 'modu',
    },
    // 与极速资源同一家的镜像站（片库、编号相同，只是 CDN 不同），选一个即可，其余作备用
    huya: {
        api: 'https://www.huyaapi.com/api.php/provide/vod',
        name: '虎牙资源',
        family: 'jisu',
    },
    guangsu: {
        api: 'https://api.guangsuapi.com/api.php/provide/vod',
        name: '光速资源',
        family: 'jisu',
    },
    jinying: {
        api: 'https://jinyingzy.com/api.php/provide/vod',
        name: '金鹰资源',
        family: 'jisu',
    },
    hongniu: {
        api: 'https://www.hongniuzy2.com/api.php/provide/vod',
        name: '红牛资源',
        family: 'jisu',
    },
    hhzy: {
        api: 'https://hhzyapi.com/api.php/provide/vod',
        name: '豪华资源',
        family: 'jisu',
    },
    xinlang: {
        api: 'https://api.xinlangapi.com/xinlangapi.php/provide/vod',
        name: '新浪资源',
        family: 'jisu',
    },
    ckzy: {
        api: 'https://www.ckzy1.com/api.php/provide/vod',
        name: 'CK资源',
        adult: true,
    },
    jkun: {
        api: 'https://jkunzyapi.com/api.php/provide/vod',
        name: 'jKun资源',
        adult: true,
    },
    r155: {
        api: 'https://155api.com/api.php/provide/vod',
        name: '155资源',
        adult: true,
    },
    huangcang: {
        api: 'https://hsckzy.vip/api.php/provide/vod',
        name: '黄色仓库',
        adult: true,
        family: 'hsck',
    },
    yutu: {
        api: 'https://yutuzy10.com/api.php/provide/vod',
        name: '玉兔资源',
        adult: true,
        family: 'yutu',
    },
    // 2026-10-31 新增（视频实测可下载）；百万、丝袜已失效移除
    aosika: { api: 'https://aosikazy.com/api.php/provide/vod', name: '奥斯卡资源', adult: true },
    lajiao: { api: 'https://apilj.com/api.php/provide/vod', name: '辣椒资源', adult: true },
    lbzy: { api: 'https://lbapi9.com/api.php/provide/vod', name: '乐播资源', adult: true },
    naixiang: { api: 'https://naixxzy.com/api.php/provide/vod', name: '奶香资源', adult: true },
    shayu: { api: 'https://shayuapi.com/api.php/provide/vod', name: '鲨鱼资源', adult: true },
    senlin: { api: 'https://slapibf.com/api.php/provide/vod', name: '森林资源', adult: true },
    xingba: { api: 'https://xingba111.com/api.php/provide/vod', name: '杏吧资源', adult: true },
    hsck2: { api: 'https://hsckzy888.com/api.php/provide/vod', name: '黄色仓库（备用）', adult: true, family: 'hsck' },
    yutu2: { api: 'https://apilsbzy1.com/api.php/provide/vod', name: '玉兔资源（备用）', adult: true, family: 'yutu' }
};

// 调用全局方法合并
if (window.extendAPISites) {
    window.extendAPISites(CUSTOMER_SITES);
} else {
    console.error("错误：请先加载 config.js！");
}
