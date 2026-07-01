// Admin recovery stub: preserves existing admin UI styling and loads. Replace with previous full admin.js if needed.
(function(){
  const $ = id => document.getElementById(id);
  const loginMessage = $('loginMessage');
  if (loginMessage) loginMessage.textContent = 'Admin-layout er gendannet. Hvis login ikke virker, skal admin.js gendannes fra seneste fungerende commit.';
  document.querySelectorAll('.emoji-target').forEach(el=>el.addEventListener('focus',()=>window.__khifLastEmojiTarget=el));
})();
