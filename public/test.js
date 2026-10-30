const message = document.getElementById('message'), result = document.getElementById('result'), list = document.getElementById('list'), count = document.getElementById('count');
async function refresh() {
  const state = await fetch('/api/state').then(r => r.json()), jar = state.jar;
  count.textContent = jar.sealed;
  const sealed = jar.entries.filter(x => !jar.revealed.includes(x.id)).slice().reverse();
  list.innerHTML = sealed.length ? sealed.map(x => `<article class="hint-row"><strong>#${x.id} · ${escapeHtml(x.type.toUpperCase())}</strong><p>${escapeHtml(x.text)}</p><small>@${escapeHtml(x.user)} · ${new Date(x.time).toLocaleTimeString()}</small></article>`).join('') : '<div class="empty">No sealed hints. Try a hint pattern above.</div>';
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
document.getElementById('send').addEventListener('click', async () => {
  const text = message.value.trim(); if (!text) { result.textContent = 'Type a message first.'; return; }
  result.textContent = 'Checking message…';
  try {
    const response = await fetch('/api/test', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({text}) }); const data = await response.json();
    result.textContent = data.error || (data.flagged ? `Sealed as a ${data.type}! 🫙` : data.command ? 'Command processed.' : 'This one stays in chat.');
    if (data.flagged) message.value = '';
    await refresh();
  } catch { result.textContent = 'Could not reach HintJar server.'; }
});
message.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); document.getElementById('send').click(); } });
const live = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`); live.onmessage = () => refresh();
refresh();
