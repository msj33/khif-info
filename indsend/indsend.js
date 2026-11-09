(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const form = $('submissionForm');
  const areaSelect = $('area');
  const titleInput = $('title');
  const textInput = $('text');
  const submitButton = $('submitButton');
  const message = $('message');
  const API_URL = String(window.KHIF_INBOX_API_URL || '').replace(/\/+$/, '');

  function setMessage(text, kind = '') {
    message.textContent = text;
    message.className = `message${kind ? ` ${kind}` : ''}`;
  }

  async function loadAreas() {
    if (!API_URL) {
      areaSelect.innerHTML = '<option value="">Indsendelse er ikke konfigureret</option>';
      submitButton.disabled = true;
      setMessage('Indsendelsesformularen er ikke sat op endnu.', 'error');
      return;
    }
    const response = await fetch(`${API_URL}/areas`, { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok || !Array.isArray(result.areas)) throw new Error(result.error || 'Områder kunne ikke hentes.');
    areaSelect.replaceChildren(new Option('Vælg område…', ''));
    result.areas.forEach(area => areaSelect.add(new Option(area, area)));
  }

  textInput.addEventListener('input', () => {
    $('textCount').textContent = `${textInput.value.length}/200`;
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    submitButton.disabled = true;
    setMessage('Sender nyheden…');
    try {
      const response = await fetch(`${API_URL}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          area: areaSelect.value,
          title: titleInput.value.trim(),
          text: textInput.value.trim(),
          website: $('website').value
        })
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'Indsendelse mislykkedes.');
      form.reset();
      $('textCount').textContent = '0/200';
      setMessage('Tak! Nyheden er sendt til godkendelse.', 'success');
    } catch (error) {
      setMessage(error.message || 'Indsendelse mislykkedes. Prøv igen.', 'error');
    } finally {
      submitButton.disabled = false;
    }
  });

  loadAreas().catch(error => {
    areaSelect.innerHTML = '<option value="">Områder kunne ikke hentes</option>';
    submitButton.disabled = true;
    setMessage(error.message, 'error');
  });
})();
