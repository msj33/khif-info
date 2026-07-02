const CONTENT_URL='./content/pages.json';
const VERSION_URL='./version.json';
const DEFAULT_INTERVAL_SECONDS=30;
const CONTENT_REFRESH_MINUTES=5;
const APP_VERSION_CHECK_MINUTES=1;
const IMAGE_PRELOAD_TIMEOUT_MS=3500;
const UPDATE_OVERLAY_MS=5000;
const app=document.querySelector('#app');
const progressBar=document.querySelector('#progressBar');
const updateOverlay=document.querySelector('#updateOverlay');
let pages=[];
let currentIndex=0;
let intervalSeconds=DEFAULT_INTERVAL_SECONDS;
let slideTimerId=null;
let imageTimerId=null;
let activeSlideToken=0;
let lastLoadedContentVersion=null;
let globalConfig={};
let runningAppVersion=window.KHIF_BOOT_VERSION||null;
let isShowingUpdate=false;
const DEFAULT_CONFIG={fontSizes:{kicker:2.2,title:7,text:3,footer:1.3}};
function escapeHtml(value,fallback=''){return String(value??fallback).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;')}
function normalizeConfig(data){const incoming=data?.config||data?.settings||{};return{...DEFAULT_CONFIG,...incoming,fontSizes:{...DEFAULT_CONFIG.fontSizes,...(incoming.fontSizes||{})}}}
function asRem(value,fallback){const number=Number(value);return`${Number.isFinite(number)?number:fallback}rem`}
function applyConfig(config){const sizes=config.fontSizes||DEFAULT_CONFIG.fontSizes;document.documentElement.style.setProperty('--kicker-size',asRem(sizes.kicker,2.2));document.documentElement.style.setProperty('--title-size',asRem(sizes.title,7));document.documentElement.style.setProperty('--text-size',asRem(sizes.text,3));document.documentElement.style.setProperty('--footer-size',asRem(sizes.footer,1.3))}
function unique(values){const out=[];values.forEach(value=>{const s=String(value||'').trim();if(s&&!out.includes(s))out.push(s)});return out}
function pageImages(page){const hasImagesArray=Array.isArray(page.images)&&page.images.filter(Boolean).length>0;return unique(hasImagesArray?page.images:[page.image]).slice(0,3)}
function normalizePages(data){intervalSeconds=Number(data.intervalSeconds||DEFAULT_INTERVAL_SECONDS);return(Array.isArray(data.pages)?data.pages:[]).filter(page=>page&&page.enabled!==false)}
function getContentVersion(data){return data?.meta?.version??data?.version??null}
function setTheme(page){document.documentElement.style.setProperty('--bg',page.backgroundColor||'#111827');document.documentElement.style.setProperty('--fg',page.textColor||'#f9fafb');document.documentElement.style.setProperty('--accent',page.accentColor||'#f59e0b');app.style.backgroundImage='none'}
function restartProgress(seconds=intervalSeconds){if(!progressBar)return;progressBar.classList.remove('run');progressBar.style.animationDuration=`${seconds}s`;void progressBar.offsetWidth;progressBar.classList.add('run')}
function clearSlideTimers(){if(slideTimerId)clearTimeout(slideTimerId);if(imageTimerId)clearTimeout(imageTimerId);slideTimerId=null;imageTimerId=null}
function showUpdateOverlay(){isShowingUpdate=true;activeSlideToken+=1;clearSlideTimers();if(updateOverlay){updateOverlay.classList.remove('hidden');updateOverlay.setAttribute('aria-hidden','false')}}
function hideUpdateOverlay(){isShowingUpdate=false;if(updateOverlay){updateOverlay.classList.add('hidden');updateOverlay.setAttribute('aria-hidden','true')}}
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
function preloadImage(src,timeoutMs=IMAGE_PRELOAD_TIMEOUT_MS){return new Promise(resolve=>{if(!src)return resolve(null);const image=new Image();let finished=false;const finish=ok=>{if(finished)return;finished=true;resolve(ok?src:null)};const timeout=setTimeout(()=>finish(true),timeoutMs);image.onload=async()=>{clearTimeout(timeout);try{if(image.decode)await image.decode()}catch(_){}finish(true)};image.onerror=()=>{clearTimeout(timeout);finish(null)};image.src=src})}
async function prepareImages(images){const loaded=await Promise.all(images.map(src=>preloadImage(src)));return loaded.filter(Boolean)}
function preloadNextPage(){if(!pages.length)return;const next=pages[(currentIndex+1)%pages.length];pageImages(next).forEach(src=>{const image=new Image();image.src=src;if(image.decode)image.decode().catch(()=>{})})}
async function renderPage(page){if(isShowingUpdate)return;activeSlideToken+=1;const token=activeSlideToken;clearSlideTimers();setTheme(page);const images=await prepareImages(pageImages(page));if(token!==activeSlideToken||isShowingUpdate)return;const hasImage=images.length>0;app.innerHTML=`<section class="slide ${hasImage?'has-image':''}"><div class="slide-copy">${page.kicker?`<p class="eyebrow">${escapeHtml(page.kicker)}</p>`:''}<h1>${escapeHtml(page.title,'Uden titel')}</h1><p class="body">${escapeHtml(page.text)}</p><div class="meta"><span>Side ${currentIndex+1} / ${pages.length}</span>${page.footer?`<span>•</span><span>${escapeHtml(page.footer)}</span>`:''}</div></div>${hasImage?`<figure class="slide-image-wrap"><img id="slideImage" src="${escapeHtml(images[0])}" alt="" loading="eager" decoding="async" /></figure>`:''}</section>`;const slideStartedAt=performance.now();const slideDurationMs=intervalSeconds*1000;const imageCount=images.length;const imageSliceMs=imageCount>0?slideDurationMs/imageCount:slideDurationMs;restartProgress(intervalSeconds);preloadNextPage();function scheduleImageTick(){if(token!==activeSlideToken||isShowingUpdate)return;if(imageCount<=1)return;const elapsed=performance.now()-slideStartedAt;const expectedIndex=Math.min(imageCount-1,Math.floor(elapsed/imageSliceMs));const imageElement=document.querySelector('#slideImage');if(imageElement&&images[expectedIndex]){const expectedUrl=new URL(images[expectedIndex],location.href).href;if(imageElement.src!==expectedUrl){imageElement.classList.add('fade-out');setTimeout(()=>{if(token!==activeSlideToken||isShowingUpdate)return;imageElement.src=images[expectedIndex];imageElement.classList.remove('fade-out')},180)}}const nextBoundary=(expectedIndex+1)*imageSliceMs;const delay=Math.max(100,nextBoundary-elapsed);if(elapsed<slideDurationMs)imageTimerId=setTimeout(scheduleImageTick,delay)}scheduleImageTick();slideTimerId=setTimeout(()=>{if(token!==activeSlideToken||isShowingUpdate)return;nextPage()},slideDurationMs)}
function nextPage(){if(!pages.length)return;currentIndex=(currentIndex+1)%pages.length;renderPage(pages[currentIndex])}
function previousPage(){if(!pages.length)return;currentIndex=(currentIndex-1+pages.length)%pages.length;renderPage(pages[currentIndex])}
async function fetchContent(){const response=await fetch(`${CONTENT_URL}?t=${Date.now()}`,{cache:'no-store'});if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.json()}
function preloadAllKnownImages(){pages.forEach(page=>pageImages(page).forEach(src=>{const image=new Image();image.src=src;if(image.decode)image.decode().catch(()=>{})}))}
async function loadContent(startAtFirst=true){try{const data=await fetchContent();globalConfig=normalizeConfig(data);applyConfig(globalConfig);const loadedPages=normalizePages(data);if(!loadedPages.length)throw new Error('Ingen aktive sider i content/pages.json');pages=loadedPages;lastLoadedContentVersion=getContentVersion(data);preloadAllKnownImages();currentIndex=startAtFirst?0:Math.min(currentIndex,pages.length-1);await renderPage(pages[currentIndex])}catch(error){console.error(error);pages=[{kicker:'Fejl',title:'Kunne ikke hente indhold',text:'Tjek content/pages.json og prøv igen.',footer:error.message,backgroundColor:'#7f1d1d',accentColor:'#fecaca'}];currentIndex=0;await renderPage(pages[0])}}
async function refreshContentIfChanged(){if(isShowingUpdate)return;try{const data=await fetchContent();const newPages=normalizePages(data);const newConfig=normalizeConfig(data);const newContentVersion=getContentVersion(data);if(!newPages.length)return;const changed=newContentVersion!==lastLoadedContentVersion||JSON.stringify({pages,globalConfig})!==JSON.stringify({pages:newPages,globalConfig:newConfig});if(changed){showUpdateOverlay();await sleep(UPDATE_OVERLAY_MS);hideUpdateOverlay();pages=newPages;globalConfig=newConfig;applyConfig(newConfig);lastLoadedContentVersion=newContentVersion;currentIndex=0;preloadAllKnownImages();await renderPage(pages[0])}}catch(error){console.warn('Kunne ikke opdatere content endnu',error)}}
async function checkAppVersion(){if(isShowingUpdate)return;try{const response=await fetch(`${VERSION_URL}?t=${Date.now()}`,{cache:'no-store'});if(!response.ok)return;const json=await response.json();const remoteVersion=String(json.appVersion||'');if(!remoteVersion)return;if(!runningAppVersion||runningAppVersion==='booting'){runningAppVersion=remoteVersion;window.KHIF_BOOT_VERSION=remoteVersion;return}if(remoteVersion!==runningAppVersion){showUpdateOverlay();await sleep(UPDATE_OVERLAY_MS);location.replace(`${location.pathname}?reload=${Date.now()}`)}}catch(error){console.warn('Kunne ikke tjekke app-version',error)}}
window.addEventListener('keydown',event=>{if(!pages.length||isShowingUpdate)return;if(event.key==='ArrowRight')nextPage();if(event.key==='ArrowLeft')previousPage()});
loadContent(true);checkAppVersion();setInterval(refreshContentIfChanged,CONTENT_REFRESH_MINUTES*60*1000);setInterval(checkAppVersion,APP_VERSION_CHECK_MINUTES*60*1000);
