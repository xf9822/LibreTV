import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const base=process.env.LIBRETV_BASE_URL || 'http://127.0.0.1:8080';
const hash=createHash('sha256').update(process.env.LIBRETV_TEST_PASSWORD || 'browser-test-only').digest('hex');
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
await context.addInitScript(hash=>{
 localStorage.setItem('passwordVerified',JSON.stringify({verified:true,timestamp:Date.now(),passwordHash:hash}));
 localStorage.setItem('proxyAuthHash',hash);
 localStorage.setItem('hasSeenDisclaimer','true');localStorage.setItem('firstRunGuideSeen','true');
 localStorage.setItem('doubanEnabled','false');
 localStorage.setItem('selectedAPIs',JSON.stringify(['ysgc','jszy']));
 localStorage.setItem('hasInitializedDefaults','true');
 localStorage.setItem('defaultApiMigrationVersion','20260511-sources-v2');
 localStorage.setItem('viewingHistory',JSON.stringify([{title:'续看测试',movieYear:'2026',movieKind:'tv',sourceName:'ysgc',vod_id:'resume',url:'player.html?title=续看测试&source=ysgc&id=resume',episodeName:'第2集',episodeIndex:1,playbackPosition:60,duration:300,timestamp:Date.now()}]));
},hash);
let delayed=false;
await context.route('**/proxy/**',async route=>{
 const u=new URL(route.request().url());
 let target;try{target=new URL(decodeURIComponent(u.pathname.slice('/proxy/'.length)));}catch{return route.fulfill({status:200,contentType:'application/json',body:'{"list":[]}'})}
 const source=target.hostname.includes('jszy')?'jszy':'ysgc';
 const title=target.searchParams.get('wd')||'';
 if(source==='jszy'&&title==='体验测试电影'){delayed=true;await new Promise(resolve=>setTimeout(resolve,1600));}
 const item={vod_name:title,vod_id:source,source_code:source,vod_year:'2026',type_name:'剧情片',vod_remarks:'正片'};
 return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({code:1,list:title?[item]:[],pagecount:1})});
});
try {
 const page=await context.newPage();page.setDefaultTimeout(30000);
 await page.goto(base);
 await page.getByText('继续观看',{exact:true}).waitFor();
 assert.match(await page.locator('#continueWatchingList').innerText(),/续看测试/);
 await page.locator('#searchInput').fill('体验测试电影');
 await page.locator('button[aria-label="搜索按钮"]').click();
 await page.locator('#results .card-hover').first().waitFor();
 assert.equal(await page.locator('#results .card-hover').count(),1);
 assert.equal(await page.locator('#searchProgress').innerText()==='已完成 2 个来源',false);
 await page.getByText('已完成 2 个来源').waitFor();
 assert.equal(await page.locator('#results .card-hover').count(),1);
 assert.match(await page.locator('#results').innerText(),/2 个来源/);
 assert.equal(delayed,true);
 await page.screenshot({path:'/tmp/libretv-experience-mobile-search.png',fullPage:true});
 const details=page.locator('#results button').filter({hasText:/^来源$/});
 await details.focus();await details.click();
 assert.equal(await page.locator('#modalContent .grouped-source-button').count(),2);
 await page.keyboard.press('Escape');
 await page.locator('#modal').waitFor({state:'hidden'});
 assert.equal(await details.evaluate(node=>document.activeElement===node),true);
 await page.locator('#results button').filter({hasText:'稍后看'}).click();
 await page.locator('.lt-topbar-brand').click();
 assert.match(await page.locator('#watchLaterList').innerText(),/体验测试电影/);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 const other=await context.newPage();await other.goto(base);
 await page.evaluate(()=>EpisodeContext.write({source:'ysgc',id:'show-a',episodes:['a-1','a-2'],episodeNames:['第1集','第2集']}));
 assert.equal(await other.evaluate(()=>EpisodeContext.read({source:'ysgc',id:'show-a',url:'a-2'})),null);
 await other.evaluate(()=>EpisodeContext.write({source:'jszy',id:'show-b',episodes:['b-1']}));
 assert.equal(await page.evaluate(()=>EpisodeContext.read({source:'ysgc',id:'show-a',url:'a-2'}).episodeNames[1]),'第2集');
 console.log('Progressive grouped search, focus recovery, watch later and two-tab episode isolation passed.');
} catch(error) {
 console.log('Experience diagnostics',JSON.stringify({progress:await context.pages()[0]?.locator('#searchProgress').innerText().catch(()=>''),selected:await context.pages()[0]?.evaluate(()=>({selectedAPIs,activeSearchRequest,results:document.getElementById('results')?.innerText})).catch(()=>null),delayed}));
 throw error;
} finally {await context.close();await browser.close();}
