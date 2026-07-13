(function(){
'use strict';
const CONFIG=window.KHIF_ADMIN_SECRET;
const STATE_OWNER='msj33';
const STATE_REPO='khif-info-state';
const STATE_BRANCH='main';
const DEVICE_ID='khif-infoscreen-01';
const COMMAND_PATH='remote/command.json';
const STATUS_PATH=`remote/status/${DEVICE_ID}.json`;
const SCHEDULE_PATH='remote/screen-schedule.json';
const POLL_MS=5000;
const OFFLINE_AFTER_MS=2*60*1000;
const $=id=>document.getElementById(id);
let token=null,commandSha=null,statusTimer=null,scheduleSha=null,scheduleData=null;
const els={loginPanel:$('loginPanel'),superPanel:$('superPanel'),logoutButton:$('logoutButton'),username:$('username'),password:$('password'),loginButton:$('loginButton'),loginMessage:$('loginMessage'),onlinePill:$('onlinePill'),deviceTitle:$('deviceTitle'),lastSeen:$('lastSeen'),hostname:$('hostname'),uptime:$('uptime'),temperature:$('temperature'),browser:$('browser'),screenPower:$('screenPower'),lastCommand:$('lastCommand'),lastError:$('lastError'),rawStatus:$('rawStatus'),reloadPageButton:$('reloadPageButton'),restartBrowserButton:$('restartBrowserButton'),turnScreenOnButton:$('turnScreenOnButton'),turnScreenOffButton:$('turnScreenOffButton'),rebootPiButton:$('rebootPiButton'),commandMessage:$('commandMessage'),scheduleEnabled:$('scheduleEnabled'),scheduleDays:$('scheduleDays'),scheduleSummary:$('scheduleSummary'),scheduleMessage:$('scheduleMessage'),scheduleJson:$('scheduleJson'),saveScheduleButton:$('saveScheduleButton'),refreshScheduleButton:$('refreshScheduleButton'),refreshScheduleOnPiButton:$('refreshScheduleOnPiButton')};
function msg(el,text,error=false){if(!el)return;el.textContent=text||'';el.classList.toggle('error',!!error)}
function friendlyError(error){if(error?.name==='OperationError'||String(error?.message||error||'').includes('OperationError'))return'Forkert brugernavn eller password.';return error?.message||String(error||'Ukendt fejl')}
function b64ToBytes(b64){return Uint8Array.from(atob(b64),c=>c.charCodeAt(0))}
function b64ToUtf8(b64){return new TextDecoder().decode(Uint8Array.from(atob(String(b64||'').replace(/\n/g,'')),c=>c.charCodeAt(0)))}
function utf8ToB64(text){const bytes=new TextEncoder().encode(text);let bin='';bytes.forEach(b=>bin+=String.fromCharCode(b));return btoa(bin)}
async function deriveKey(password,salt){const base=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:CONFIG.iterations||250000,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['decrypt'])}
async function decryptToken(password){if(!CONFIG)throw new Error('Admin-konfiguration mangler i ../admin/secret.js.');const key=await deriveKey(password,b64ToBytes(CONFIG.salt));const dec=await crypto.subtle.decrypt({name:'AES-GCM',iv:b64ToBytes(CONFIG.iv)},key,b64ToBytes(CONFIG.encryptedToken));return new TextDecoder().decode(dec)}
function headers(extra={}){return{Accept:'application/vnd.github+json',Authorization:`Bearer ${token}`,'X-GitHub-Api-Version':'2022-11-28',...extra}}
async function stateContent(path,options={}){const res=await fetch(`https://api.github.com/repos/${STATE_OWNER}/${STATE_REPO}/contents/${path}`,{...options,headers:headers(options.headers||{})});const json=await res.json().catch(()=>({}));if(!res.ok)throw new Error(json.message||`GitHub API fejl ${res.status}`);return json}
async function repoContent(path,options={}){const method=(options.method||'GET').toUpperCase();const url=`https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${path}${method==='GET'?`?ref=${encodeURIComponent(CONFIG.branch||'main')}`:''}`;const res=await fetch(url,{...options,headers:headers(options.headers||{})});const json=await res.json().catch(()=>({}));if(!res.ok)throw new Error(json.message||`GitHub API fejl ${res.status}`);return json}
async function readJsonFile(path){
  const file=await stateContent(`${path}?ref=${encodeURIComponent(STATE_BRANCH)}`)
  const encoded=String(file.content||'')
  let parsed=null
  if (encoded) {
    try {
      parsed=JSON.parse(b64ToUtf8(encoded))
    } catch (_){
      parsed=null
    }
  }
  return {json:parsed,sha:file.sha}
}
async function writeJsonFile(path,obj,sha){
  if (!sha) {
    try {
      const existing=await stateContent(`${path}?ref=${encodeURIComponent(STATE_BRANCH)}`)
      sha=existing.sha
    } catch (error) {
      if (!String(error?.message||'').includes('404')) throw error
    }
  }
  const body={message:`Superadmin update ${path}`,content:utf8ToB64(JSON.stringify(obj,null,2)+'\n'),branch:STATE_BRANCH}
  if(sha)body.sha=sha
  const res=await stateContent(path,{method:'PUT',body:JSON.stringify(body)})
  return res.content?.sha||null
}
function formatDate(value){if(!value)return'-';const d=new Date(value);return Number.isNaN(d.getTime())?String(value):d.toLocaleString('da-DK')}
function formatUptime(seconds){const s=Number(seconds||0);if(!s)return'-';const d=Math.floor(s/86400),h=Math.floor((s%86400)/3600),m=Math.floor((s%3600)/60);return d>0?`${d}d ${h}t ${m}m`:`${h}t ${m}m`}
function parseTime(value){const [hours,minutes]=String(value||'00:00').split(':').map(Number);return{hours:Number.isNaN(hours)?0:hours,minutes:Number.isNaN(minutes)?0:minutes}}
function toMinutes(value){const p=parseTime(value);return p.hours*60+p.minutes}
const DAY_LABELS={monday:'Mandag',tuesday:'Tirsdag',wednesday:'Onsdag',thursday:'Torsdag',friday:'Fredag',saturday:'Lørdag',sunday:'Søndag'}
function weekdayLabel(day){return DAY_LABELS[day]||day.charAt(0).toUpperCase()+day.slice(1)}
function defaultSchedule(){return{enabled:true,days:{monday:{enabled:true,startTime:'10:00',endTime:'22:00'},tuesday:{enabled:true,startTime:'10:00',endTime:'22:00'},wednesday:{enabled:true,startTime:'10:00',endTime:'22:00'},thursday:{enabled:true,startTime:'10:00',endTime:'22:00'},friday:{enabled:true,startTime:'10:00',endTime:'22:00'},saturday:{enabled:true,startTime:'10:00',endTime:'22:00'},sunday:{enabled:true,startTime:'10:00',endTime:'22:00'}},updatedAt:new Date().toISOString(),updatedBy:'superadmin'}}
function normalizeSchedule(schedule){const base=defaultSchedule();const out={...base,...(schedule||{})};out.days={...base.days};const src=(schedule&&schedule.days)||{};Object.keys(base.days).forEach(day=>{const entry=src[day]||{};out.days[day]={enabled:entry.enabled!==false,startTime:String(entry.startTime||base.days[day].startTime||'10:00').slice(0,5),endTime:String(entry.endTime||base.days[day].endTime||'22:00').slice(0,5)}});return out}
function buildScheduleMarkup(schedule){const data=normalizeSchedule(schedule||scheduleData||defaultSchedule());const days=Object.keys(data.days);return days.map(day=>`<div class="schedule-day"><div class="schedule-day-head"><label class="schedule-day-name"><input type="checkbox" data-day="${day}" ${data.days[day].enabled!==false?'checked':''} /> ${weekdayLabel(day)}</label></div><div class="schedule-day-times"><label>Start<input type="time" data-day-start="${day}" value="${data.days[day].startTime||'10:00'}" /></label><label>Slut<input type="time" data-day-end="${day}" value="${data.days[day].endTime||'22:00'}" /></label></div></div>`).join('')}
function setScheduleForm(schedule){const data=normalizeSchedule(schedule||scheduleData||defaultSchedule());if(els.scheduleEnabled)els.scheduleEnabled.checked=data.enabled!==false;if(els.scheduleDays)els.scheduleDays.innerHTML=buildScheduleMarkup(data);return data}
function renderSchedule(schedule){const data=setScheduleForm(schedule||scheduleData||defaultSchedule());if(els.scheduleSummary)els.scheduleSummary.textContent=data.enabled===false?`Skærmen er deaktiveret.`:'';if(els.scheduleJson)els.scheduleJson.textContent=JSON.stringify(data,null,2);return data}
async function refreshSchedule(){try{const file=await readJsonFile(SCHEDULE_PATH);scheduleData=normalizeSchedule(file.json);scheduleSha=file.sha;renderSchedule(scheduleData)}catch(error){scheduleData=defaultSchedule();renderSchedule(scheduleData);msg(els.scheduleMessage,`Kunne ikke hente tidsplan: ${friendlyError(error)}`,true)}}
async function saveSchedule(){try{msg(els.scheduleMessage,'Gemmer tidsplan…');const days={};els.scheduleDays.querySelectorAll('[data-day]').forEach(box=>{const day=box.getAttribute('data-day');const start=els.scheduleDays.querySelector(`[data-day-start="${day}"]`)?.value||'10:00';const end=els.scheduleDays.querySelector(`[data-day-end="${day}"]`)?.value||'22:00';days[day]={enabled:box.checked,startTime:start.slice(0,5),endTime:end.slice(0,5)}});const payload={enabled:els.scheduleEnabled?.checked!==false,days,updatedAt:new Date().toISOString(),updatedBy:CONFIG.adminUsername||'superadmin'};scheduleSha=await writeJsonFile(SCHEDULE_PATH,payload,scheduleSha);scheduleData=payload;renderSchedule(scheduleData);msg(els.scheduleMessage,'Tidsplan gemt');await sendCommand('reload-schedule')}catch(error){msg(els.scheduleMessage,friendlyError(error),true)}}
function setPill(text,cls){els.onlinePill.textContent=text;els.onlinePill.className=`status-pill ${cls}`}
function renderStatus(status){const lastSeenDate=status.lastSeen?new Date(status.lastSeen):null;const offline=!lastSeenDate||(Date.now()-lastSeenDate.getTime()>OFFLINE_AFTER_MS);setPill(offline?'Offline':'Online',offline?'error':'ok');els.deviceTitle.textContent=status.deviceId||DEVICE_ID;els.lastSeen.textContent=formatDate(status.lastSeen);els.hostname.textContent=status.hostname||'-';els.uptime.textContent=formatUptime(status.uptimeSeconds);els.temperature.textContent=typeof status.temperatureC==='number'?`${status.temperatureC.toFixed(1)} °C`:'-';els.browser.textContent=status.browser||'-';const screenPower=String(status.screenPower||status.screenState||'').toLowerCase();els.screenPower.textContent=screenPower==='on'?'Tændt':screenPower==='off'?'Slukket':(screenPower||'-');if(els.turnScreenOnButton)els.turnScreenOnButton.disabled=screenPower==='on';if(els.turnScreenOffButton)els.turnScreenOffButton.disabled=screenPower==='off';els.lastCommand.textContent=[status.lastCommand,status.lastCommandResult].filter(Boolean).join(' / ')||'-';msg(els.lastError,status.lastError||'',!!status.lastError);els.rawStatus.textContent=JSON.stringify(status,null,2)}
async function refreshStatus(){try{const{json}=await readJsonFile(STATUS_PATH);renderStatus(json)}catch(error){setPill('Offline','error');msg(els.lastError,`Kunne ikke hente status fra ${STATE_REPO}: ${friendlyError(error)}`,true)}}
async function sendCommand(command){if(command==='reboot-pi'&&!confirm('Er du sikker på at du vil genstarte Raspberry Pi’en?'))return;if(command==='restart-browser'&&!confirm('Er du sikker på at du vil genstarte browseren?'))return;try{msg(els.commandMessage,`Sender kommando: ${command}…`);try{const existing=await readJsonFile(COMMAND_PATH);commandSha=existing.sha}catch(_){commandSha=null}const now=new Date();const obj={id:`${now.toISOString()}-${Math.random().toString(16).slice(2,8)}`,deviceId:DEVICE_ID,command,createdAt:now.toISOString(),expiresAt:new Date(now.getTime()+10*60*1000).toISOString(),createdBy:'superadmin'};commandSha=await writeJsonFile(COMMAND_PATH,obj,commandSha);msg(els.commandMessage,'Kommando sendt. Status opdateres automatisk.');setTimeout(refreshStatus,2000)}catch(error){msg(els.commandMessage,friendlyError(error),true)}}
async function login(){try{msg(els.loginMessage,'Logger ind…');els.loginButton.disabled=true;if((els.username.value||'').trim()!==CONFIG.adminUsername)throw new Error('Forkert brugernavn eller password.');token=await decryptToken(els.password.value);els.loginPanel.classList.add('hidden');els.superPanel.classList.remove('hidden');els.logoutButton.classList.remove('hidden');els.password.value='';msg(els.loginMessage,'');await Promise.all([refreshStatus(),refreshSchedule()]);statusTimer=setInterval(refreshStatus,POLL_MS)}catch(error){token=null;msg(els.loginMessage,friendlyError(error),true)}finally{els.loginButton.disabled=false}}
function init(){msg(els.loginMessage,'Klar til login.');els.loginButton.onclick=login;els.password?.addEventListener('keydown',e=>{if(e.key==='Enter')login()});els.logoutButton.onclick=()=>location.reload();els.reloadPageButton.onclick=()=>sendCommand('reload-page');els.restartBrowserButton.onclick=()=>sendCommand('restart-browser');els.turnScreenOnButton.onclick=()=>sendCommand('screen-on');els.turnScreenOffButton.onclick=()=>sendCommand('screen-off');els.rebootPiButton.onclick=()=>sendCommand('reboot-pi');els.saveScheduleButton.onclick=()=>saveSchedule();els.refreshScheduleButton.onclick=()=>refreshSchedule();els.refreshScheduleOnPiButton.onclick=()=>sendCommand('reload-schedule')}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
