(function(){
'use strict';
const CONFIG = window.KHIF_ADMIN_SECRET;
const DEVICE_ID = 'khif-infoscreen-01';
const COMMAND_PATH = 'remote/command.json';
const STATUS_PATH = `remote/status/${DEVICE_ID}.json`;
const POLL_MS = 5000;
const OFFLINE_AFTER_MS = 2 * 60 * 1000;
const $ = id => document.getElementById(id);
let token = null;
let commandSha = null;
let statusTimer = null;
const els = {
  loginPanel:$('loginPanel'), superPanel:$('superPanel'), logoutButton:$('logoutButton'), username:$('username'), password:$('password'), loginButton:$('loginButton'), loginMessage:$('loginMessage'),
  onlinePill:$('onlinePill'), deviceTitle:$('deviceTitle'), lastSeen:$('lastSeen'), hostname:$('hostname'), uptime:$('uptime'), temperature:$('temperature'), browser:$('browser'), lastCommand:$('lastCommand'), lastError:$('lastError'), rawStatus:$('rawStatus'),
  reloadPageButton:$('reloadPageButton'), restartBrowserButton:$('restartBrowserButton'), rebootPiButton:$('rebootPiButton'), commandMessage:$('commandMessage')
};
function msg(el,text,error=false){ if(!el) return; el.textContent=text||''; el.classList.toggle('error',!!error); }
function friendlyError(error){ if(error?.name==='OperationError'||String(error?.message||error||'').includes('OperationError')) return 'Forkert brugernavn eller password.'; return error?.message || String(error || 'Ukendt fejl'); }
function b64ToBytes(b64){ return Uint8Array.from(atob(b64), c => c.charCodeAt(0)); }
function b64ToUtf8(b64){ return new TextDecoder().decode(Uint8Array.from(atob(String(b64||'').replace(/\n/g,'')), c => c.charCodeAt(0))); }
function utf8ToB64(text){ const bytes=new TextEncoder().encode(text); let bin=''; bytes.forEach(b=>bin+=String.fromCharCode(b)); return btoa(bin); }
async function deriveKey(password,salt){ const base=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']); return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:CONFIG.iterations||250000,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['decrypt']); }
async function decryptToken(password){ if(!CONFIG) throw new Error('Admin-konfiguration mangler i ../admin/secret.js.'); const key=await deriveKey(password,b64ToBytes(CONFIG.salt)); const dec=await crypto.subtle.decrypt({name:'AES-GCM',iv:b64ToBytes(CONFIG.iv)},key,b64ToBytes(CONFIG.encryptedToken)); return new TextDecoder().decode(dec); }
function headers(extra={}){ return {Accept:'application/vnd.github+json',Authorization:`Bearer ${token}`,'X-GitHub-Api-Version':'2022-11-28',...extra}; }
async function githubContent(path,options={}){ const res=await fetch(`https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${path}`,{...options,headers:headers(options.headers||{})}); const json=await res.json().catch(()=>({})); if(!res.ok) throw new Error(json.message||`GitHub API fejl ${res.status}`); return json; }
async function readJsonFile(path){ const file=await githubContent(path); const json=JSON.parse(b64ToUtf8(file.content)); return {json,sha:file.sha}; }
async function writeJsonFile(path,obj,sha){ const body={message:`Superadmin update ${path}`,content:utf8ToB64(JSON.stringify(obj,null,2)+'\n'),branch:CONFIG.branch}; if(sha) body.sha=sha; const res=await githubContent(path,{method:'PUT',body:JSON.stringify(body)}); return res.content?.sha || null; }
function formatDate(value){ if(!value) return '-'; const d=new Date(value); return Number.isNaN(d.getTime())?String(value):d.toLocaleString('da-DK'); }
function formatUptime(seconds){ const s=Number(seconds||0); if(!s) return '-'; const d=Math.floor(s/86400); const h=Math.floor((s%86400)/3600); const m=Math.floor((s%3600)/60); return d>0?`${d}d ${h}t ${m}m`:`${h}t ${m}m`; }
function setPill(text,cls){ els.onlinePill.textContent=text; els.onlinePill.className=`status-pill ${cls}`; }
function renderStatus(status){
  const lastSeenDate = status.lastSeen ? new Date(status.lastSeen) : null;
  const offline = !lastSeenDate || (Date.now() - lastSeenDate.getTime() > OFFLINE_AFTER_MS);
  setPill(offline ? 'Offline' : 'Online', offline ? 'error' : 'ok');
  els.deviceTitle.textContent = status.deviceId || DEVICE_ID;
  els.lastSeen.textContent = formatDate(status.lastSeen);
  els.hostname.textContent = status.hostname || '-';
  els.uptime.textContent = formatUptime(status.uptimeSeconds);
  els.temperature.textContent = typeof status.temperatureC === 'number' ? `${status.temperatureC.toFixed(1)} °C` : '-';
  els.browser.textContent = status.browser || '-';
  const lastCmd = [status.lastCommand,status.lastCommandResult].filter(Boolean).join(' / ');
  els.lastCommand.textContent = lastCmd || '-';
  msg(els.lastError,status.lastError||'',!!status.lastError);
  els.rawStatus.textContent = JSON.stringify(status,null,2);
}
async function refreshStatus(){
  try{ const {json}=await readJsonFile(STATUS_PATH); renderStatus(json); }
  catch(error){ setPill('Offline','error'); msg(els.lastError,`Kunne ikke hente status: ${friendlyError(error)}`,true); }
}
async function sendCommand(command){
  const labels = { 'reload-page':'reload infoskærmen', 'restart-browser':'genstarte browseren', 'reboot-pi':'genstarte Raspberry Pi’en' };
  if(command === 'reboot-pi' && !confirm('Er du sikker på at du vil genstarte Raspberry Pi’en?')) return;
  if(command === 'restart-browser' && !confirm('Er du sikker på at du vil genstarte browseren?')) return;
  try{
    msg(els.commandMessage,`Sender kommando: ${labels[command] || command}…`);
    try{ const existing=await readJsonFile(COMMAND_PATH); commandSha=existing.sha; }catch(_){ commandSha=null; }
    const now=new Date();
    const obj={
      id:`${now.toISOString()}-${Math.random().toString(16).slice(2,8)}`,
      deviceId:DEVICE_ID,
      command,
      createdAt:now.toISOString(),
      expiresAt:new Date(now.getTime()+10*60*1000).toISOString(),
      createdBy:'superadmin'
    };
    commandSha=await writeJsonFile(COMMAND_PATH,obj,commandSha);
    msg(els.commandMessage,'Kommando sendt. Status opdateres automatisk.');
    setTimeout(refreshStatus,2000);
  }catch(error){ msg(els.commandMessage,friendlyError(error),true); }
}
async function login(){
  try{
    msg(els.loginMessage,'Logger ind…');
    els.loginButton.disabled=true;
    if((els.username.value||'').trim()!==CONFIG.adminUsername) throw new Error('Forkert brugernavn eller password.');
    token=await decryptToken(els.password.value);
    els.loginPanel.classList.add('hidden');
    els.superPanel.classList.remove('hidden');
    els.logoutButton.classList.remove('hidden');
    els.password.value='';
    msg(els.loginMessage,'');
    await refreshStatus();
    statusTimer=setInterval(refreshStatus,POLL_MS);
  }catch(error){ token=null; msg(els.loginMessage,friendlyError(error),true); }
  finally{ els.loginButton.disabled=false; }
}
function init(){
  msg(els.loginMessage,'Klar til login.');
  els.loginButton.onclick=login;
  els.password?.addEventListener('keydown',e=>{ if(e.key==='Enter') login(); });
  els.logoutButton.onclick=()=>location.reload();
  els.reloadPageButton.onclick=()=>sendCommand('reload-page');
  els.restartBrowserButton.onclick=()=>sendCommand('restart-browser');
  els.rebootPiButton.onclick=()=>sendCommand('reboot-pi');
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init); else init();
})();
