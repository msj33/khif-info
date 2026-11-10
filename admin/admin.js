(function(){
'use strict';
const CONFIG=window.KHIF_ADMIN_SECRET;
const $=id=>document.getElementById(id);
const DEFAULT_CONFIG={fontSizes:{kicker:2.2,title:7,text:3,footer:1.3}};
const LOGINS_PATH='content/logins.json';
const AREAS_PATH='content/areas.json';
const DEFAULT_AREAS=['KHIF - Info','Fodbold','Badminton','Gymnastik','Tennis','Volleyball','Fitness','Andet'];
const TITLE_MAX_CHARS=48;
const TEXT_MAX_LINES=16;
let token=null,sha=null,data=null,selectedIndex=0,mediaFiles=[],imageSlot=0,lastEmojiTarget=null,deployTimer=null,deployMonitoring=false,inboxTimer=null,pendingImagePreviews={},githubStatus={repoVersion:'-',repoUpdated:'-',deployedVersion:'-',deployedChecked:'-'},areaOptions=[...DEFAULT_AREAS],inboxIssues=[];
const els={loginForm:$('loginForm'),loginPanel:$('loginPanel'),editorPanel:$('editorPanel'),logoutButton:$('logoutButton'),username:$('username'),password:$('password'),loginButton:$('loginButton'),loginMessage:$('loginMessage'),
 pageTabs:$('pageTabs'),form:$('editorForm'),saveMessage:$('saveMessage'),topSaveMessage:$('topSaveMessage'),saveToScreenButton:$('saveToScreenButton'),previewButton:$('previewButton'),previewAllButton:$('previewAllButton'),
 inboxButton:$('inboxButton'),inboxBadge:$('inboxBadge'),inboxPanel:$('inboxPanel'),inboxList:$('inboxList'),inboxMessage:$('inboxMessage'),refreshInboxButton:$('refreshInboxButton'),closeInboxButton:$('closeInboxButton'),
 pageEditorPanel:$('pageEditorPanel'),imageLibraryButton:$('imageLibraryButton'),imageLibraryPanel:$('imageLibraryPanel'),theme:$('theme'),addPageButton:$('addPageButton'),removePageButton:$('removePageButton'),enabled:$('enabled'),kicker:$('kicker'),title:$('title'),text:$('text'),footer:$('footer'),image1:$('image1'),image2:$('image2'),image3:$('image3'),clearImage1:$('clearImage1'),clearImage2:$('clearImage2'),clearImage3:$('clearImage3'),uploadSlot:$('uploadSlot'),imageUpload:$('imageUpload'),
 screenEta:$('screenEta'),deployStatus:$('deployStatus'),checkDeployButton:$('checkDeployButton'),technicalDetailsButton:$('technicalDetailsButton'),technicalDetailsModal:$('technicalDetailsModal'),closeTechnicalDetails:$('closeTechnicalDetails'),modalRepoVersion:$('modalRepoVersion'),modalRepoUpdated:$('modalRepoUpdated'),modalDeployedVersion:$('modalDeployedVersion'),modalDeployedChecked:$('modalDeployedChecked'),mediaLibrary:$('mediaLibrary'),refreshMediaButton:$('refreshMediaButton'),imageModal:$('imageModal'),closeImageModal:$('closeImageModal'),imagePickerGrid:$('imagePickerGrid'),
 emojiButton:$('emojiButton'),emojiModal:$('emojiModal'),closeEmojiModal:$('closeEmojiModal'),emojiSearch:$('emojiSearch'),emojiGrid:$('emojiGrid')
};
function msg(el,t,e=false){if(!el)return;el.textContent=t||'';el.classList.toggle('error',!!e)}
function friendlyError(error){if(error?.name==='OperationError'||String(error?.message||error||'').includes('OperationError'))return'Forkert brugernavn eller password.';return error?.message||String(error||'Ukendt fejl')}
function formatDate(v){if(!v)return'-';const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toLocaleString('da-DK')}
function contentVersion(o){return Number(o?.meta?.version??o?.version??0)}
function ensureMeta(){data.meta=data.meta||{};data.meta.version=Number(data.meta.version||0);return data.meta}
function ensureConfig(){const config=data?.config||{};return {fontSizes:{...DEFAULT_CONFIG.fontSizes,...(config.fontSizes||{})}}}
function b64ToBytes(b64){return Uint8Array.from(atob(b64),c=>c.charCodeAt(0))}
function utf8ToB64(text){const bytes=new TextEncoder().encode(text);let bin='';bytes.forEach(b=>bin+=String.fromCharCode(b));return btoa(bin)}
function b64ToUtf8(b64){return new TextDecoder().decode(Uint8Array.from(atob(b64),c=>c.charCodeAt(0)))}
function normalize(text){return String(text||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')}
function limitTextLines(value,maxLines){const lines=String(value||'').split(/\r?\n/);return lines.length<=maxLines?String(value||''):lines.slice(0,maxLines).join('\n')}
function enforceEditorLimits(){let changed=false;if(els.title&&els.title.value.length>TITLE_MAX_CHARS){els.title.value=els.title.value.slice(0,TITLE_MAX_CHARS);changed=true}if(els.text){const limited=limitTextLines(els.text.value,TEXT_MAX_LINES);if(limited!==els.text.value){els.text.value=limited;changed=true}}return changed}
function normalizeUsername(value){return String(value||'').trim().toLowerCase()}
function normalizeRole(value){return value==='superadmin'?'superadmin':'admin'}
async function deriveKey(password,salt,iterations){const base=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:iterations||CONFIG.iterations||250000,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['decrypt'])}
async function decryptWithCredential(password,credential){const key=await deriveKey(password,b64ToBytes(credential.salt),credential.iterations);const dec=await crypto.subtle.decrypt({name:'AES-GCM',iv:b64ToBytes(credential.iv)},key,b64ToBytes(credential.encryptedToken));return new TextDecoder().decode(dec)}
function defaultLogins(){return{users:[{username:normalizeUsername(CONFIG.adminUsername||'admin'),role:'superadmin',iterations:Number(CONFIG.iterations||250000),salt:String(CONFIG.salt||''),iv:String(CONFIG.iv||''),encryptedToken:String(CONFIG.encryptedToken||'')}]}}
function normalizeLogins(logins){const users=[];(Array.isArray(logins?.users)?logins.users:[]).forEach(entry=>{const username=normalizeUsername(entry?.username);if(!username)return;const role=normalizeRole(entry?.role);const iterations=Number(entry?.iterations||CONFIG.iterations||250000);const salt=String(entry?.salt||'');const iv=String(entry?.iv||'');const encryptedToken=String(entry?.encryptedToken||'');if(!salt||!iv||!encryptedToken)return;if(users.some(u=>u.username===username))return;users.push({username,role,iterations,salt,iv,encryptedToken})});const root=normalizeUsername(CONFIG.adminUsername||'admin');if(!users.some(u=>u.username===root)){users.push({username:root,role:'superadmin',iterations:Number(CONFIG.iterations||250000),salt:String(CONFIG.salt||''),iv:String(CONFIG.iv||''),encryptedToken:String(CONFIG.encryptedToken||'')})}return{users}}
async function fetchLogins(){const url=`https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${LOGINS_PATH}?ref=${encodeURIComponent(CONFIG.branch||'main')}`;const res=await fetch(url,{cache:'no-store',headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}});if(!res.ok)return defaultLogins();const json=await res.json().catch(()=>({}));const raw=String(json.content||'').replace(/\n/g,'');if(!raw)return defaultLogins();return normalizeLogins(JSON.parse(b64ToUtf8(raw)))}
function normalizeAreaName(value){return String(value||'').trim()}
function normalizeAreas(payload){const src=Array.isArray(payload?.areas)?payload.areas:[];const areas=[];src.forEach(name=>{const area=normalizeAreaName(name);if(!area)return;if(areas.includes(area))return;areas.push(area)});if(!areas.length)return[...DEFAULT_AREAS];return areas}
function ensureAreaOption(value){const area=normalizeAreaName(value);if(!area)return;if(!areaOptions.includes(area))areaOptions.push(area)}
function renderAreaOptions(selected){if(!els.kicker)return;const selectedValue=normalizeAreaName(selected)||areaOptions[0]||DEFAULT_AREAS[0];ensureAreaOption(selectedValue);els.kicker.innerHTML=areaOptions.map(area=>`<option value="${area.replace(/"/g,'&quot;')}">${area}</option>`).join('');els.kicker.value=selectedValue}
async function fetchAreas(){try{const file=await githubContent(AREAS_PATH);const payload=JSON.parse(b64ToUtf8(String(file.content||'').replace(/\n/g,'')));areaOptions=normalizeAreas(payload)}catch(_){areaOptions=[...DEFAULT_AREAS]}}
function apiHeaders(extra={}){return{Accept:'application/vnd.github+json',Authorization:`Bearer ${token}`,'X-GitHub-Api-Version':'2022-11-28',...extra}}
async function githubContent(path,options={}){const res=await fetch(`https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${path}`,{...options,headers:apiHeaders(options.headers||{})});const json=await res.json().catch(()=>({}));if(!res.ok)throw new Error(json.message||`GitHub API fejl ${res.status}`);return json}
async function githubJson(url){const res=await fetch(url,{cache:'no-store',headers:apiHeaders()});const json=await res.json().catch(()=>({}));if(!res.ok)throw new Error(json.message||`GitHub API fejl ${res.status}`);return json}
function defaultSide(n){return{enabled:true,kicker:areaOptions[0]||DEFAULT_AREAS[0],title:`Ny side ${n}`,text:'',theme:'',images:[],image:''}}
function sideImages(side){const src=Array.isArray(side.images)&&side.images.filter(Boolean).length?side.images:[side.image];const out=[];src.forEach(x=>{const s=String(x||'').trim();if(s&&!out.includes(s))out.push(s)});return out.slice(0,3)}
async function loadSides(){const file=await githubContent(CONFIG.contentPath);sha=file.sha;data=JSON.parse(b64ToUtf8(String(file.content||'').replace(/\n/g,'')));if(!Array.isArray(data.pages))data.pages=[];await fetchAreas();if(!data.pages.length)data.pages.push(defaultSide(1));selectedIndex=Math.min(Math.max(selectedIndex,0),data.pages.length-1);ensureMeta();await loadMedia();renderTabs();fillForm();updateRepoStatus();await checkDeploy()}
function updateRepoStatus(){const m=ensureMeta();githubStatus.repoVersion=`v${m.version||0}`;githubStatus.repoUpdated=`Gemt: ${formatDate(m.updatedAt)}`;updateTechnicalDetailsModal()}
function updateTechnicalDetailsModal(){if(!els.modalRepoVersion)return;els.modalRepoVersion.textContent=githubStatus.repoVersion||'-';els.modalRepoUpdated.textContent=githubStatus.repoUpdated||'-';els.modalDeployedVersion.textContent=githubStatus.deployedVersion||'-';els.modalDeployedChecked.textContent=githubStatus.deployedChecked||'-'}
function setPill(t,c='neutral'){if(!els.deployStatus)return;els.deployStatus.textContent=t;els.deployStatus.className=`status-pill ${c}`;updateTechnicalDetailsModal()}
function isPagesRun(run){const s=String(run?.name||run?.display_title||run?.path||'').toLowerCase();return s.includes('pages')||s.includes('deploy')||s.includes('build')}
async function latestPagesRun(){const url=`https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/actions/runs?per_page=10&branch=${encodeURIComponent(CONFIG.branch||'main')}&t=${Date.now()}`;const json=await githubJson(url);const runs=Array.isArray(json.workflow_runs)?json.workflow_runs:[];return runs.find(isPagesRun)||runs[0]||null}
async function fetchDeployedContent(){const res=await fetch(`../${CONFIG.contentPath}?t=${Date.now()}`,{cache:'no-store'});if(!res.ok)throw new Error(`HTTP ${res.status}`);return res.json()}
async function checkDeploy(){if(!data)return;try{setPill('Tjekker…');const checked=new Date();const [depRes,runRes]=await Promise.allSettled([fetchDeployedContent(),latestPagesRun()]);const deployed=depRes.status==='fulfilled'?depRes.value:null;const run=runRes.status==='fulfilled'?runRes.value:null;const dv=deployed?contentVersion(deployed):0;const rv=contentVersion(data);if(els.deployedVersion)els.deployedVersion.textContent=dv?`v${dv}`:'-';githubStatus.deployedVersion=dv?`v${dv}`:'-';if(run){const status=String(run.status||'').toLowerCase();const conclusion=String(run.conclusion||'').toLowerCase();const no=run.run_number?`#${run.run_number}`:'';const dt=run.updated_at||run.created_at||checked;const deployedText=`${no} • ${status}${conclusion?` / ${conclusion}`:''} • ${formatDate(dt)}`;if(els.deployedChecked)els.deployedChecked.textContent=deployedText;githubStatus.deployedChecked=deployedText;if(status!=='completed'){if(els.screenEta)els.screenEta.textContent='Afventer GitHub Pages';setPill('Deployment kører','pending');return}if(conclusion&&conclusion!=='success'){if(els.screenEta)els.screenEta.textContent='Fejl i GitHub deployment';setPill('Deployment fejlede','error');stopDeployMonitor();return}}else if(els.deployedChecked){const text=`Tjekket: ${formatDate(checked)}`;els.deployedChecked.textContent=text;githubStatus.deployedChecked=text}
	if(dv===rv){if(els.screenEta)els.screenEta.textContent='';setPill('Infoskærm opdateret','ok');stopDeployMonitor()}else if(dv&&dv!==rv){if(els.screenEta)els.screenEta.textContent='Afventer GitHub Pages';setPill('Opdatering igang','pending')}else{if(els.screenEta)els.screenEta.textContent='Ukendt status';setPill('Ukendt deploy-status','error');stopDeployMonitor()}}catch(error){if(els.deployedVersion)els.deployedVersion.textContent='-';if(els.deployedChecked)els.deployedChecked.textContent=friendlyError(error);if(els.screenEta)els.screenEta.textContent='-';setPill('Kunne ikke tjekke deploy','error');stopDeployMonitor()}}
function stopDeployMonitor(){if(deployTimer){clearInterval(deployTimer);deployTimer=null}deployMonitoring=false}
function startDeployMonitor(){if(deployMonitoring)return;if(deployTimer)clearInterval(deployTimer);deployMonitoring=true;deployTimer=setInterval(()=>{if(els.editorPanel&&!els.editorPanel.classList.contains('hidden'))checkDeploy()},15000)}
function beginDeployCheck(){if(!data)return;startDeployMonitor();void checkDeploy()}
async function loadMedia(){try{const list=await githubContent('assets/uploads');mediaFiles=(Array.isArray(list)?list:[]).filter(x=>x.type==='file'&&/\.(png|jpe?g|gif|webp|svg)$/i.test(x.name)).map(x=>({name:x.name,path:x.path,sha:x.sha,url:`/khif-info/${x.path}`}));renderMedia();renderPicker()}catch(error){mediaFiles=[];renderMedia(`Kunne ikke læse assets/uploads: ${friendlyError(error)}`);renderPicker()}}
function renderMedia(error){if(!els.mediaLibrary)return;if(error){els.mediaLibrary.innerHTML=`<p class="message error">${error}</p>`;return}if(!mediaFiles.length){els.mediaLibrary.innerHTML='<p class="message">Ingen billeder fundet.</p>';return}els.mediaLibrary.innerHTML=mediaFiles.map((m,i)=>`<div class="media-item"><img src="${m.url}?t=${Date.now()}" alt=""><code>${m.name}</code><button type="button" class="danger" data-del="${i}">Slet</button></div>`).join('');els.mediaLibrary.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>deleteImage(Number(b.dataset.del)))}
function renderPicker(){if(!els.imagePickerGrid)return;if(!mediaFiles.length){els.imagePickerGrid.innerHTML='<p class="message">Ingen billeder fundet.</p>';return}els.imagePickerGrid.innerHTML=mediaFiles.map((m,i)=>`<div class="media-item"><img src="${m.url}?t=${Date.now()}" alt=""><code>${m.name}</code><button type="button" class="secondary" data-pick="${i}">Vælg</button></div>`).join('');els.imagePickerGrid.querySelectorAll('[data-pick]').forEach(b=>b.onclick=()=>{[els.image1,els.image2,els.image3][imageSlot].value=mediaFiles[Number(b.dataset.pick)].url;els.imageModal?.classList.add('hidden')})}
async function deleteImage(i){const file=mediaFiles[i];if(!file||!confirm(`Slet ${file.name}?`))return;await githubContent(file.path,{method:'DELETE',body:JSON.stringify({message:`Delete KHIF Info image ${file.name}`,sha:file.sha,branch:CONFIG.branch})});await loadMedia()}
function renderTabs(){if(!els.pageTabs)return;els.pageTabs.innerHTML='';data.pages.forEach((p,i)=>{const b=document.createElement('button');b.type='button';b.draggable=true;b.dataset.index=String(i);b.textContent=`↕ Side ${i+1}: ${p.title||'Uden titel'}`;b.className=(i===selectedIndex?'active ':'')+'draggable-side';b.addEventListener('dragstart',ev=>{ev.dataTransfer.setData('text/plain',String(i));b.classList.add('dragging')});b.addEventListener('dragend',()=>b.classList.remove('dragging'));b.addEventListener('dragover',ev=>{ev.preventDefault();b.classList.add('drag-over')});b.addEventListener('dragleave',()=>b.classList.remove('drag-over'));b.addEventListener('drop',ev=>{ev.preventDefault();b.classList.remove('drag-over');moveSide(Number(ev.dataTransfer.getData('text/plain')),i)});b.onclick=()=>{saveCurrent();selectedIndex=i;renderTabs();fillForm();togglePanels();setLibraryPanelVisible(false)};els.pageTabs.appendChild(b)});togglePanels()}
function togglePanels(){const inboxOpen=els.inboxPanel&&!els.inboxPanel.classList.contains('hidden');els.pageEditorPanel?.classList.toggle('hidden',inboxOpen);els.previewButton?.classList.toggle('hidden',inboxOpen);$('saveCurrentPageButton')?.classList.toggle('hidden',inboxOpen);if(els.removePageButton)els.removePageButton.disabled=data.pages.length<=1}function setLibraryPanelVisible(visible){if(els.inboxPanel)els.inboxPanel.classList.add('hidden');if(els.imageLibraryPanel)els.imageLibraryPanel.classList.toggle('hidden',!visible);if(els.pageEditorPanel)els.pageEditorPanel.classList.toggle('hidden',visible);if(els.previewButton)els.previewButton.classList.toggle('hidden',visible);$('saveCurrentPageButton')?.classList.toggle('hidden',visible);}

function fillForm(){if(selectedIndex<0)return togglePanels();const p=data.pages[selectedIndex],im=sideImages(p);if(els.enabled)els.enabled.checked=p.enabled!==false;renderAreaOptions(p.kicker||'');if(els.title)els.title.value=p.title||'';if(els.text)els.text.value=p.text||'';if(els.theme)els.theme.value=p.theme||'';if(els.image1)els.image1.value=im[0]||'';if(els.image2)els.image2.value=im[1]||'';if(els.image3)els.image3.value=im[2]||'';if(els.imageUpload)els.imageUpload.value='';enforceEditorLimits();togglePanels()}
function sideFromForm(){enforceEditorLimits();const images=[els.image1?.value,els.image2?.value,els.image3?.value].filter(Boolean).map(x=>x.trim()).filter(Boolean).slice(0,3);const selectedArea=normalizeAreaName(els.kicker?.value)||areaOptions[0]||DEFAULT_AREAS[0];ensureAreaOption(selectedArea);return{enabled:els.enabled?.checked!==false,kicker:selectedArea,title:els.title?.value||'',text:els.text?.value||'',theme:els.theme?.value||'',image:images[0]||'',images}}
function saveCurrent(){if(!data)return;if(selectedIndex<0||!data.pages[selectedIndex])return;const current=data.pages[selectedIndex];const updated={...current,...sideFromForm()};delete updated.backgroundColor;delete updated.textColor;delete updated.accentColor;data.pages[selectedIndex]=updated}
function fileName(name){const ext=(name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,8)||'jpg';const base=name.replace(/\.[^.]+$/,'').toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40)||'image';return`${Date.now()}-${base}.${ext}`}
async function fileToB64(file){const buf=await file.arrayBuffer();const bytes=new Uint8Array(buf);let bin='';bytes.forEach(b=>bin+=String.fromCharCode(b));return btoa(bin)}
async function fileToDataUrl(file){return `data:${file.type};base64,${await fileToB64(file)}`}
async function uploadIfNeeded(){if(selectedIndex<0||!els.imageUpload?.files?.[0])return;const file=els.imageUpload.files[0];if(!file.type.startsWith('image/'))throw new Error('Den valgte fil er ikke et billede.');const slot=Number(els.uploadSlot?.value||0);const name=fileName(file.name),path=`assets/uploads/${name}`;const b64=await fileToB64(file);const previewUrl=`data:${file.type};base64,${b64}`;await githubContent(path,{method:'PUT',body:JSON.stringify({message:`Upload KHIF Info image ${name}`,content:b64,branch:CONFIG.branch})});[els.image1,els.image2,els.image3][slot].value=`/khif-info/${path}`;pendingImagePreviews[slot]={path:`/khif-info/${path}`,url:previewUrl}}
async function savePages(){await uploadIfNeeded();saveCurrent();const m=ensureMeta();m.version=Number(m.version||0)+1;m.updatedAt=new Date().toISOString();m.updatedBy=CONFIG.adminUsername||'admin';const res=await githubContent(CONFIG.contentPath,{method:'PUT',body:JSON.stringify({message:`Update KHIF Info content v${m.version}`,content:utf8ToB64(JSON.stringify(data,null,2)+'\n'),sha,branch:CONFIG.branch})});sha=res.content.sha;await loadMedia();renderTabs();if(selectedIndex>=0)fillForm();updateRepoStatus();beginDeployCheck()}
async function login(){try{msg(els.loginMessage,'Logger ind…');els.loginButton.disabled=true;if(!CONFIG)throw new Error('Admin-konfiguration mangler i secret.js.');const username=normalizeUsername(els.username.value);const password=String(els.password.value||'');const logins=await fetchLogins();const user=normalizeLogins(logins).users.find(u=>u.username===username);if(!user)throw new Error('Forkert brugernavn eller password.');if(user.role!=='admin'&&user.role!=='superadmin')throw new Error('Manglende adgang til admin.');token=await decryptWithCredential(password,user);await loadSides();els.loginPanel.classList.add('hidden');els.editorPanel.classList.remove('hidden');els.logoutButton?.classList.remove('hidden');els.password.value='';msg(els.loginMessage,'')}catch(error){token=null;msg(els.loginMessage,friendlyError(error),true)}finally{els.loginButton.disabled=false}}
function addSide(){saveCurrent();data.pages.push(defaultSide(data.pages.length+1));selectedIndex=data.pages.length-1;renderTabs();fillForm()}
function removeSide(){if(selectedIndex<0||data.pages.length<=1)return;if(confirm('Fjern side?')){data.pages.splice(selectedIndex,1);selectedIndex=Math.min(selectedIndex,data.pages.length-1);renderTabs();fillForm()}}
function moveSide(from,to){if(from===to||from<0||to<0||from>=data.pages.length||to>=data.pages.length)return;saveCurrent();const current=data.pages[selectedIndex];const[moved]=data.pages.splice(from,1);data.pages.splice(to,0,moved);selectedIndex=data.pages.indexOf(current);renderTabs();fillForm()}
function openPreview(all){saveCurrent();const currentSide=sideFromForm();const localPreviews=currentSide.images.map((url,i)=>pendingImagePreviews[i]?.path===url?pendingImagePreviews[i].url:null).filter(Boolean);if(localPreviews.length)currentSide.localPreviewImages=localPreviews;const payload=all?{pages:data.pages.map((page,i)=>i===selectedIndex&&localPreviews.length?{...page,localPreviewImages:localPreviews}:page),config:ensureConfig(),index:Math.max(0,selectedIndex)}:{pages:[currentSide],config:ensureConfig(),index:0};sessionStorage.setItem('khif-preview-data',JSON.stringify(payload));window.open('./preview.html',all?'khifPreviewAll':'khifPreview','width=1280,height=780,resizable=yes,scrollbars=no')}
function emojiItems(){return(window.KHIF_EMOJIS||[]).map(item=>({e:item.emoji||item.e,k:Array.isArray(item.keywords)?item.keywords.join(' '):String(item.keywords||item.k||'')})).filter(item=>item.e)}
function insertAtCursor(el,text){if(!el)return;const s=el.selectionStart??el.value.length,e=el.selectionEnd??el.value.length;el.value=el.value.slice(0,s)+text+el.value.slice(e);el.focus();el.selectionStart=el.selectionEnd=s+text.length;el.dispatchEvent(new Event('input',{bubbles:true}))}
function renderEmoji(q=''){if(!els.emojiGrid)return;const query=normalize(q);els.emojiGrid.innerHTML=emojiItems().filter(item=>!query||normalize(`${item.e} ${item.k}`).includes(query)).map(item=>`<button type="button" title="${item.k}">${item.e}</button>`).join('');els.emojiGrid.querySelectorAll('button').forEach(b=>b.onclick=()=>{insertAtCursor(lastEmojiTarget||els.text,b.textContent);els.emojiModal?.classList.add('hidden')})}
function confirmImageGuidelines(){return new Promise(resolve=>{const modal=$('uploadGuidelinesModal'),ok=$('acceptUploadGuidelines'),cancel=$('cancelUploadGuidelines');if(!modal||!ok||!cancel){resolve(true);return}const done=v=>{modal.classList.add('hidden');ok.onclick=null;cancel.onclick=null;resolve(v)};ok.onclick=()=>done(true);cancel.onclick=()=>done(false);modal.classList.remove('hidden')})}
async function saveToScreen(){try{msg(els.topSaveMessage||els.saveMessage,els.imageUpload?.files?.[0]?'Uploader billede og gemmer til infoskærm…':'Gemmer til infoskærm…');await savePages();msg(els.topSaveMessage||els.saveMessage,'Gemt til infoskærm. Status opdateres automatisk.')}catch(error){msg(els.topSaveMessage||els.saveMessage,friendlyError(error),true)}}
const SIDE_THEMES=['green','blue','purple','gold',''];
window.KHIF_ACTIVE_LOGIN_AREAS=null;
window.KHIF_ALL_PAGES=[];

function normalizeLogins(logins){
 const root=normalizeUsername(CONFIG.adminUsername||'admin'),users=[];
 (Array.isArray(logins?.users)?logins.users:[]).forEach(entry=>{
  const username=normalizeUsername(entry?.username);
  if(!username||users.some(user=>user.username===username))return;
  const role=normalizeRole(entry?.role),iterations=Number(entry?.iterations||CONFIG.iterations||250000);
  const salt=String(entry?.salt||''),iv=String(entry?.iv||''),encryptedToken=String(entry?.encryptedToken||'');
  if(!salt||!iv||!encryptedToken)return;
  users.push({username,role,iterations,salt,iv,encryptedToken,areas:Array.isArray(entry?.areas)?entry.areas.map(normalizeAreaName).filter(Boolean):null});
 });
 if(!users.some(user=>user.username===root)){
  users.push({username:root,role:'superadmin',iterations:Number(CONFIG.iterations||250000),salt:String(CONFIG.salt||''),iv:String(CONFIG.iv||''),encryptedToken:String(CONFIG.encryptedToken||''),areas:null});
 }
 return{users};
}

async function fetchLogins(){
 const url=`https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${LOGINS_PATH}?ref=${encodeURIComponent(CONFIG.branch||'main')}`;
 const response=await fetch(url,{cache:'no-store',headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}});
 if(!response.ok)return defaultLogins();
 const file=await response.json();
 const encoded=String(file.content||'').replace(/\n/g,'');
 if(!encoded)return defaultLogins();
 const parsed=normalizeLogins(JSON.parse(b64ToUtf8(encoded)));
 const username=normalizeUsername(els.username.value);
 const user=parsed.users.find(entry=>entry.username===username);
 window.KHIF_ACTIVE_LOGIN_AREAS=user?.role==='superadmin'||!Array.isArray(user?.areas)?null:user.areas;
 return parsed;
}

function renderAreaOptions(selected){
 if(!els.kicker)return;
 const allowed=window.KHIF_ACTIVE_LOGIN_AREAS;
 const options=allowed===null?areaOptions:areaOptions.filter(area=>allowed.includes(area));
 const selectedValue=normalizeAreaName(selected)||options[0]||DEFAULT_AREAS[0];
 if(!options.includes(selectedValue)&&allowed===null)options.push(selectedValue);
 els.kicker.innerHTML=options.map(area=>`<option value="${area.replace(/"/g,'&quot;')}">${area}</option>`).join('');
 els.kicker.value=options.includes(selectedValue)?selectedValue:(options[0]||'');
}

function pageExpired(page){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Copenhagen',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
 const today=`${parts.find(part=>part.type==='year')?.value}-${parts.find(part=>part.type==='month')?.value}-${parts.find(part=>part.type==='day')?.value}`;
 return Boolean(page?.expiresOn&&page.expiresOn<=today);
}
function pageIsActive(page){return page?.enabled!==false&&!pageExpired(page)}
function managedPage(page){
 const allowed=window.KHIF_ACTIVE_LOGIN_AREAS;
 return allowed===null||allowed.includes(normalizeAreaName(page?.kicker));
}
function updateExpirationUI(page){
 const input=$('expiresOn');
 if(!input||!els.enabled)return;
 const expired=pageExpired({expiresOn:input.value});
 els.enabled.disabled=expired;
 if(expired)els.enabled.checked=false;
 if(page&&expired)page.enabled=false;
 const chooseButton=$('chooseExpirationDate');
 const clearButton=$('clearExpirationDate');
 const dateLabel=$('expirationDateLabel');
 if(dateLabel){
  dateLabel.replaceChildren();
  if(input.value)dateLabel.textContent=input.value.split('-').reverse().join('/');
  else{const placeholder=document.createElement('em');placeholder.textContent='Ingen udløbsdato valgt';dateLabel.appendChild(placeholder)}
 }
 if(chooseButton)chooseButton.textContent='Vælg dato';
 if(clearButton)clearButton.hidden=!input.value;
}

async function loadSides(){
 const file=await githubContent(CONFIG.contentPath);
 sha=file.sha;
 data=JSON.parse(b64ToUtf8(String(file.content||'').replace(/\n/g,'')));
 if(!Array.isArray(data.pages))data.pages=[];
 await fetchAreas();
 window.KHIF_ALL_PAGES=data.pages.map((page,index)=>{
  const updated={...page,theme:SIDE_THEMES[index%SIDE_THEMES.length]};
  if(pageExpired(updated))updated.enabled=false;
  return updated;
 });
 const allowed=window.KHIF_ACTIVE_LOGIN_AREAS;
 data.pages=window.KHIF_ALL_PAGES.filter(managedPage);
 if(!data.pages.length){
  if(allowed!==null)throw new Error('Dette login er ikke tilknyttet områder med sider.');
  data.pages.push(defaultSide(1));
 }
 if(!data.pages.length)data.pages.push(defaultSide(1));
 selectedIndex=Math.min(Math.max(selectedIndex,0),data.pages.length-1);
 ensureMeta();
 await loadMedia();
 renderTabs();
 fillForm();
 updateRepoStatus();
 await checkDeploy();
}

function fillForm(){
 if(selectedIndex<0)return togglePanels();
 const page=data.pages[selectedIndex],images=sideImages(page);
 if(els.enabled){els.enabled.checked=page.enabled!==false&&!pageExpired(page);els.enabled.disabled=pageExpired(page)}
 renderAreaOptions(page.kicker||'');
 if(els.title)els.title.value=page.title||'';
 if(els.text)els.text.value=page.text||'';
 const expiresOn=$('expiresOn');
 if(expiresOn)expiresOn.value=page.expiresOn||'';
 if(els.image1)els.image1.value=images[0]||'';
 if(els.image2)els.image2.value=images[1]||'';
 if(els.image3)els.image3.value=images[2]||'';
 if(els.imageUpload)els.imageUpload.value='';
 enforceEditorLimits();
 updateExpirationUI(page);
 togglePanels();
}

function sideFromForm(){
 enforceEditorLimits();
 const images=[els.image1?.value,els.image2?.value,els.image3?.value].filter(Boolean).map(value=>value.trim()).filter(Boolean).slice(0,3);
 const selectedArea=normalizeAreaName(els.kicker?.value)||areaOptions[0]||DEFAULT_AREAS[0];
 ensureAreaOption(selectedArea);
 const current=data?.pages?.[selectedIndex]||{};
 const expiresOn=$('expiresOn')?.value||'';
 const expired=pageExpired({expiresOn});
 return{...current,enabled:!expired&&els.enabled?.checked!==false,kicker:selectedArea,title:els.title?.value||'',text:els.text?.value||'',theme:current.theme??SIDE_THEMES[selectedIndex%SIDE_THEMES.length],expiresOn,image:images[0]||'',images};
}

function persistedPages(){
 const original=window.KHIF_ALL_PAGES||[];
 const firstOwned=original.findIndex(managedPage);
 const before=firstOwned<0?original.length:original.slice(0,firstOwned).filter(page=>!managedPage(page)).length;
 const retained=original.filter(page=>!managedPage(page));
 retained.splice(before,0,...data.pages);
 return retained;
}
function validatePageLimit(pages){
 const counts=new Map();
 pages.filter(pageIsActive).forEach(page=>{
  const area=normalizeAreaName(page.kicker);
  counts.set(area,(counts.get(area)||0)+1);
 });
 if([...counts.values()].some(count=>count>5))throw new Error('Max 5 sider per forening');
}

async function savePages(){
 saveCurrent();
 validatePageLimit(persistedPages());
 await uploadIfNeeded();
 saveCurrent();
 const pages=persistedPages();
 validatePageLimit(pages);
 const meta=ensureMeta();
 meta.version=Number(meta.version||0)+1;
 meta.updatedAt=new Date().toISOString();
 meta.updatedBy=CONFIG.adminUsername||'admin';
 const payload={...data,pages};
 const response=await githubContent(CONFIG.contentPath,{method:'PUT',body:JSON.stringify({message:`Update KHIF Info content v${meta.version}`,content:utf8ToB64(JSON.stringify(payload,null,2)+'\n'),sha,branch:CONFIG.branch})});
 sha=response.content.sha;
 window.KHIF_ALL_PAGES=pages;
 await loadMedia();
 renderTabs();
 if(selectedIndex>=0)fillForm();
 updateRepoStatus();
 beginDeployCheck();
}

async function login(){
 try{
  msg(els.loginMessage,'Logger ind…');
  els.loginButton.disabled=true;
  if(!CONFIG)throw new Error('Admin-konfiguration mangler i secret.js.');
  const username=normalizeUsername(els.username.value);
  const password=String(els.password.value||'');
  const logins=await fetchLogins();
  const user=normalizeLogins(logins).users.find(entry=>entry.username===username);
  if(!user)throw new Error('Forkert brugernavn eller password.');
  if(user.role!=='admin'&&user.role!=='superadmin')throw new Error('Manglende adgang til admin.');
  token=await decryptWithCredential(password,user);
  await loadSides();
  els.loginPanel.classList.add('hidden');
  els.editorPanel.classList.remove('hidden');
  els.logoutButton?.classList.remove('hidden');
  els.password.value='';
  msg(els.loginMessage,'');
  await refreshInbox();
  if(!inboxTimer)inboxTimer=setInterval(refreshInbox,60000);
 }catch(error){token=null;msg(els.loginMessage,friendlyError(error),true)}
 finally{els.loginButton.disabled=false}
}

function addSide(){
 saveCurrent();
 try{validatePageLimit(persistedPages())}catch(error){alert(friendlyError(error));return}
 const areas=window.KHIF_ACTIVE_LOGIN_AREAS===null?areaOptions:window.KHIF_ACTIVE_LOGIN_AREAS;
 const currentPages=persistedPages();
 const area=areas.find(candidate=>currentPages.filter(page=>pageIsActive(page)&&normalizeAreaName(page.kicker)===candidate).length<5);
 if(!area){alert('Max 5 sider per forening');return}
 data.pages.push({...defaultSide(data.pages.length+1),kicker:area,theme:SIDE_THEMES[(window.KHIF_ALL_PAGES.length+data.pages.length)%SIDE_THEMES.length]});
 selectedIndex=data.pages.length-1;
 renderTabs();
 fillForm();
}

async function saveToScreen(){
 try{
  msg(els.topSaveMessage||els.saveMessage,els.imageUpload?.files?.[0]?'Uploader billede og gemmer til infoskærm…':'Gemmer aktuel side…');
  await savePages();
  msg(els.topSaveMessage||els.saveMessage,'Aktuel side gemt til infoskærm. Status opdateres automatisk.');
 }catch(error){
  const message=friendlyError(error);
  if(message==='Max 5 sider per forening')alert(message);
  msg(els.topSaveMessage||els.saveMessage,message,true);
 }
}

function issueArea(issue){
 return String(issue.body||'').match(/^Område:\s*(.+)$/m)?.[1]?.trim()||'';
}
function canManageIssue(issue){
 const areas=window.KHIF_ACTIVE_LOGIN_AREAS;
 return areas===null||areas.includes(issueArea(issue));
}
function issueFields(issue){
 const title=String(issue.title||'').replace(/^\[Indsendelse\]\s*/i,'').trim();
 const body=String(issue.body||'');
 const separator='\n\n---\nIndsendt anonymt via KHIF Info.';
 const marker=body.indexOf(separator);
 const withoutArea=body.replace(/^Område:\s*.+\r?\n/m,'');
 const text=(marker>=0?withoutArea.slice(0,withoutArea.indexOf(separator)).trim():withoutArea.trim());
 return{area:issueArea(issue),title,text};
}
async function inboxRequest(path,options={}){
 const response=await fetch(`https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}${path}`,{
  ...options,
  headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${token}`,'X-GitHub-Api-Version':'2022-11-28',...(options.headers||{})}
 });
 const result=response.status===204?{}:await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(result.message||`GitHub API fejl ${response.status}`);
 return result;
}
function updateInboxBadge(){
 const count=inboxIssues.filter(canManageIssue).length;
 if(els.inboxBadge){els.inboxBadge.textContent=String(count);els.inboxBadge.classList.toggle('hidden',count===0)}
}
function renderInbox(){
 if(!els.inboxList)return;
 const visible=inboxIssues.filter(canManageIssue);
 updateInboxBadge();
 els.inboxList.replaceChildren();
 if(!visible.length){
  const empty=document.createElement('p');empty.className='muted';empty.textContent='Ingen ubehandlede nyheder i dine områder.';
  els.inboxList.appendChild(empty);
  return;
 }
 visible.forEach(issue=>{
  const fields=issueFields(issue),card=document.createElement('article');
  card.className='inbox-item';
  const area=document.createElement('p');area.className='inbox-area';area.textContent=fields.area;
  const title=document.createElement('h3');title.textContent=fields.title;
  const text=document.createElement('p');text.className='inbox-text';text.textContent=fields.text;
  const link=document.createElement('a');link.href=issue.html_url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=`Issue #${issue.number}`;
  const actions=document.createElement('div');actions.className='actions';
  const approve=document.createElement('button');approve.type='button';approve.textContent='Godkend';approve.onclick=()=>approveInboxIssue(issue);
  const reject=document.createElement('button');reject.type='button';reject.className='danger';reject.textContent='Afvis';reject.onclick=()=>rejectInboxIssue(issue);
  actions.append(approve,reject);
  card.append(area,title,text,link,actions);
  els.inboxList.appendChild(card);
 });
}
async function refreshInbox(){
 if(!token||!els.inboxList)return;
 msg(els.inboxMessage,'Henter indbakke…');
 try{
  const issues=await inboxRequest('/issues?state=open&labels=indsendelse&per_page=100');
  inboxIssues=Array.isArray(issues)?issues.filter(issue=>!issue.pull_request):[];
  renderInbox();
  msg(els.inboxMessage,inboxIssues.length>100?'Viser højst 100 åbne indsendelser.':'');
 }catch(error){
  inboxIssues=[];
  updateInboxBadge();
  msg(els.inboxMessage,friendlyError(error),true);
 }
}
async function closeInboxIssue(issue,reason){
 await inboxRequest(`/issues/${issue.number}`,{
  method:'PATCH',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({state:'closed',state_reason:reason})
 });
}
async function rejectInboxIssue(issue){
 if(!canManageIssue(issue))return;
 if(!confirm('Afvis den indsendte nyhed?'))return;
 try{
  await closeInboxIssue(issue,'not_planned');
  await refreshInbox();
  msg(els.inboxMessage,`Nyhed #${issue.number} afvist og lukket.`);
 }catch(error){msg(els.inboxMessage,friendlyError(error),true)}
}
async function approveInboxIssue(issue){
 if(!canManageIssue(issue))return;
 const fields=issueFields(issue);
 if(!fields.area||!fields.title||!fields.text){msg(els.inboxMessage,`Nyhed #${issue.number} mangler område, titel eller tekst.`,true);return}
 if(!confirm(`Godkend "${fields.title}" fra ${fields.area}? Der oprettes en aktiv side på infoskærmen.`))return;
 const existing=persistedPages().find(page=>page.submissionIssueUrl===issue.html_url);
 try{
  if(!existing){
   const page={
    ...defaultSide(data.pages.length+1),
    enabled:true,
    kicker:fields.area,
    title:fields.title.slice(0,TITLE_MAX_CHARS),
    text:fields.text.slice(0,200),
    theme:SIDE_THEMES[(window.KHIF_ALL_PAGES.length+data.pages.length)%SIDE_THEMES.length],
    submissionIssueUrl:issue.html_url
   };
   validatePageLimit([...persistedPages(),page]);
   data.pages.push(page);
   selectedIndex=data.pages.length-1;
   renderTabs();
   fillForm();
   await savePages();
  }
  await closeInboxIssue(issue,'completed');
  if(existing){
   selectedIndex=data.pages.findIndex(page=>page.submissionIssueUrl===issue.html_url);
   if(selectedIndex>=0){renderTabs();fillForm()}
  }
  if(els.inboxPanel)els.inboxPanel.classList.add('hidden');
  if(els.pageEditorPanel)els.pageEditorPanel.classList.remove('hidden');
  togglePanels();
  msg(els.saveMessage,`Nyhed #${issue.number} godkendt. Siden kan nu redigeres og previewes.`);
  await refreshInbox();
 }catch(error){
  const message=friendlyError(error);
  await refreshInbox();
  msg(els.inboxMessage,message,true);
 }
}
function openInbox(){
 if(els.inboxPanel&&!els.inboxPanel.classList.contains('hidden')){closeInbox();return}
 saveCurrent();
 if(els.imageLibraryPanel)els.imageLibraryPanel.classList.add('hidden');
 if(els.pageEditorPanel)els.pageEditorPanel.classList.add('hidden');
 if(els.previewButton)els.previewButton.classList.add('hidden');
 $('saveCurrentPageButton')?.classList.add('hidden');
 if(els.inboxPanel)els.inboxPanel.classList.remove('hidden');
 void refreshInbox();
}
function closeInbox(){
 if(els.inboxPanel)els.inboxPanel.classList.add('hidden');
 if(els.pageEditorPanel)els.pageEditorPanel.classList.remove('hidden');
 if(els.imageLibraryPanel)els.imageLibraryPanel.classList.add('hidden');
 togglePanels();
}

const expirationInput=$('expiresOn');
expirationInput?.addEventListener('change',()=>updateExpirationUI(data?.pages?.[selectedIndex]));
$('chooseExpirationDate')?.addEventListener('click',()=>{
 if(typeof expirationInput?.showPicker==='function')expirationInput.showPicker();
 else expirationInput?.click();
});
$('clearExpirationDate')?.addEventListener('click',()=>{
 if(!expirationInput)return;
 expirationInput.value='';
 updateExpirationUI(data?.pages?.[selectedIndex]);
});
$('saveCurrentPageButton')?.addEventListener('click',event=>{event.preventDefault();saveToScreen()});
els.inboxButton?.addEventListener('click',openInbox);
els.refreshInboxButton?.addEventListener('click',refreshInbox);
els.closeInboxButton?.addEventListener('click',closeInbox);

function init(){if(!els.loginButton)return;msg(els.loginMessage,'Klar til login.');if(els.checkDeployButton)els.checkDeployButton.classList.remove('hidden');if(els.loginForm)els.loginForm.onsubmit=async e=>{e.preventDefault();await login()};els.loginButton.onclick=login;els.password?.addEventListener('keydown',e=>{if(e.key==='Enter')login()});if(els.title)els.title.addEventListener('input',()=>enforceEditorLimits());if(els.text)els.text.addEventListener('input',()=>enforceEditorLimits());document.querySelectorAll('.emoji-target').forEach(el=>el.addEventListener('focus',()=>lastEmojiTarget=el));if(els.emojiButton)els.emojiButton.onclick=()=>{renderEmoji();els.emojiModal?.classList.remove('hidden');els.emojiSearch?.focus()};if(els.emojiSearch)els.emojiSearch.oninput=()=>renderEmoji(els.emojiSearch.value);if(els.closeEmojiModal)els.closeEmojiModal.onclick=()=>els.emojiModal?.classList.add('hidden');if(els.technicalDetailsButton)els.technicalDetailsButton.onclick=()=>{updateTechnicalDetailsModal();els.technicalDetailsModal?.classList.remove('hidden')};if(els.closeTechnicalDetails)els.closeTechnicalDetails.onclick=()=>els.technicalDetailsModal?.classList.add('hidden');[1,2,3].forEach((n,i)=>{const choose=$(`chooseImage${n}`),upload=$(`uploadImage${n}`);if(choose)choose.onclick=()=>{imageSlot=i;renderPicker();els.imageModal?.classList.remove('hidden')};if(upload)upload.onclick=async()=>{if(!(await confirmImageGuidelines()))return;imageSlot=i;if(els.uploadSlot)els.uploadSlot.value=String(i);els.imageUpload?.click()}});if(els.closeImageModal)els.closeImageModal.onclick=()=>els.imageModal?.classList.add('hidden');const clear=$('clearImagesButton');if(clear)clear.onclick=()=>{if(els.image1)els.image1.value='';if(els.image2)els.image2.value='';if(els.image3)els.image3.value=''};if(els.clearImage1)els.clearImage1.onclick=()=>{if(els.image1)els.image1.value=''};if(els.clearImage2)els.clearImage2.onclick=()=>{if(els.image2)els.image2.value=''};if(els.clearImage3)els.clearImage3.onclick=()=>{if(els.image3)els.image3.value=''};if(els.imageLibraryButton)els.imageLibraryButton.onclick=()=>setLibraryPanelVisible(els.imageLibraryPanel?.classList.contains('hidden')===true);if(els.addPageButton)els.addPageButton.onclick=addSide;if(els.removePageButton)els.removePageButton.onclick=removeSide;if(els.refreshMediaButton)els.refreshMediaButton.onclick=loadMedia;if(els.form)els.form.onsubmit=async e=>{e.preventDefault();await saveToScreen()};if(els.saveToScreenButton)els.saveToScreenButton.onclick=e=>{e.preventDefault();saveToScreen()};if(els.previewButton)els.previewButton.onclick=e=>{e.preventDefault();openPreview(false)};if(els.previewAllButton)els.previewAllButton.onclick=e=>{e.preventDefault();openPreview(true)};if(els.logoutButton)els.logoutButton.onclick=()=>location.reload();if(els.checkDeployButton)els.checkDeployButton.onclick=()=>checkDeploy()}
if(els.imageUpload){els.imageUpload.addEventListener('change',async()=>{try{if(!els.imageUpload.files?.[0])return;msg(els.saveMessage,'Uploader billede…');await uploadIfNeeded();await loadMedia();msg(els.saveMessage,'Billede uploaded.');}catch(error){msg(els.saveMessage,friendlyError(error),true)}})}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
