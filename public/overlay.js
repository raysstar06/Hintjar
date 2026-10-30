const wsUrl = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`;
let socket, hideTimer;
const fill = document.getElementById('fill'), counter = document.getElementById('counter'), statusEl = document.getElementById('status'), corks = document.getElementById('corks');
function paint(jar = { sealed: 0, entries: [] }) {
  const count = jar.sealed ?? 0;
  counter.textContent = `${count} ${count === 1 ? 'hint' : 'hints'} sealed`;
  fill.style.height = `${Math.min(75, count * 9)}%`;
  corks.innerHTML = '';
  const corkCount = Math.min(10, count);
  for (let i=0; i<corkCount; i++) {
    const cork = document.createElement('i'); cork.className = 'cork'; cork.style.left = `${13 + (i * 29 % 68)}px`; cork.style.bottom = `${10 + Math.floor(i/4)*17 + (i%4)*5}px`; cork.style.setProperty('--r', `${(i*31)%45-22}deg`); corks.append(cork);
  }
}
function show(entry) {
  const card = document.getElementById('card');
  document.getElementById('hint-text').textContent = entry.text;
  document.getElementById('hint-credit').textContent = `Hint from @${entry.user}`;
  card.classList.add('visible'); clearTimeout(hideTimer); hideTimer = setTimeout(() => card.classList.remove('visible'), 8500);
}
function connect() {
  socket = new WebSocket(wsUrl);
  socket.onopen = () => { statusEl.textContent = 'LIVE'; statusEl.style.color = '#49836b'; };
  socket.onclose = () => { statusEl.textContent = 'RECONNECTING'; statusEl.style.color = '#a18472'; setTimeout(connect, 2000); };
  socket.onerror = () => socket.close();
  socket.onmessage = event => {
    const data = JSON.parse(event.data);
    if (data.jar) paint(data.jar);
    if (data.type === 'reveal') show(data.entry);
    if (data.type === 'reset') document.getElementById('card').classList.remove('visible');
    if (data.type === 'spill') data.entries?.forEach((entry, i) => setTimeout(() => show(entry), i*3000));
  };
}
fetch('/api/state').then(r => r.json()).then(data => paint(data.jar)).catch(() => {});
connect();
