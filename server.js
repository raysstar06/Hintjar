import 'dotenv/config';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { detectMessage } from './detector.js';

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const server = app.listen(PORT, () => console.log(`[HintJar] Server listening at http://localhost:${PORT}`));
const CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
const BROADCASTER_LOGIN = (process.env.BROADCASTER_LOGIN || '').toLowerCase();
const REDIRECT_URI = `http://localhost:${PORT}/auth/callback`;
const SCOPES = ['user:read:chat','user:write:chat','user:bot','moderator:manage:chat_messages'];
const TOKEN_FILE = new URL('./tokens.json', import.meta.url);
const JAR_FILE = new URL('./jar.json', import.meta.url);
let tokens = null, broadcaster = null, bot = null, eventSocket = null, reconnectUrl = null;
let spoilerWords = [];
let jar = await loadJar();
const clients = new Set();

async function loadJar() {
  try { return JSON.parse(await readFile(JAR_FILE, 'utf8')); }
  catch { return { entries: [], revealed: [], nextId: 1 }; }
}
async function saveJar() { await writeFile(JAR_FILE, JSON.stringify(jar, null, 2)); }
function broadcast(event) { const data = JSON.stringify(event); for (const ws of clients) if (ws.readyState === WebSocket.OPEN) ws.send(data); }
function publicJar() { return { total: jar.entries.length, sealed: jar.entries.filter(x => !jar.revealed.includes(x.id)).length, entries: jar.entries, revealed: jar.revealed }; }
function configReady() { return CLIENT_ID && CLIENT_SECRET && BROADCASTER_LOGIN; }

async function loadTokens() {
  if (tokens) return tokens;
  if (existsSync(TOKEN_FILE)) { try { tokens = JSON.parse(await readFile(TOKEN_FILE, 'utf8')); } catch {} }
  return tokens;
}
async function saveTokens(value) { tokens = value; await writeFile(TOKEN_FILE, JSON.stringify(value, null, 2)); }
async function refreshToken() {
  await loadTokens();
  if (!tokens?.refresh_token) throw new Error('No refresh token. Visit /auth/login first.');
  const body = new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
  const response = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', body });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Token refresh failed');
  await saveTokens({ ...tokens, ...data, obtained_at: Date.now() });
  console.log('[Twitch] Access token refreshed');
  return tokens;
}
async function accessToken() {
  await loadTokens();
  if (!tokens) throw new Error('Bot is not authenticated. Visit /auth/login.');
  const expiry = Number(tokens.obtained_at || 0) + Number(tokens.expires_in || 0) * 1000;
  if (Date.now() >= expiry - 60_000) await refreshToken();
  return tokens.access_token;
}
async function helix(path, options = {}, retry = true) {
  const token = await accessToken();
  const response = await fetch(`https://api.twitch.tv/helix${path}`, { ...options, headers: { 'Client-Id': CLIENT_ID, Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  if (response.status === 401 && retry) { await refreshToken(); return helix(path, options, false); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `Helix ${response.status}`);
  return data;
}
async function getUsers() {
  const result = await helix(`/users?login=${encodeURIComponent(BROADCASTER_LOGIN)}`);
  broadcaster = result.data?.[0];
  const own = await helix('/users');
  bot = own.data?.[0];
  if (!broadcaster || !bot) throw new Error('Could not resolve broadcaster or bot user ID');
  console.log(`[Twitch] broadcaster @${broadcaster.login} (${broadcaster.id}), bot @${bot.login} (${bot.id})`);
}
async function sendChat(text) {
  if (!broadcaster || !bot) await getUsers();
  return helix('/chat/messages', { method: 'POST', body: JSON.stringify({ broadcaster_id: broadcaster.id, sender_id: bot.id, message: text }) });
}
async function sendDelete(messageId) {
  if (!broadcaster || !bot) await getUsers();
  return helix(`/moderation/chat?broadcaster_id=${broadcaster.id}&moderator_id=${bot.id}&message_id=${messageId}`, { method: 'DELETE' });
}
async function reveal(entry) {
  if (!jar.revealed.includes(entry.id)) jar.revealed.push(entry.id);
  await saveJar();
  const item = { ...entry, sealed: false };
  broadcast({ type: 'reveal', entry: item, jar: publicJar() });
  return item;
}
async function handleCommand(text, login, isPrivileged, simulate = false) {
  const reply = message => simulate ? console.log(`[Demo chat] ${message}`) : sendChat(message);
  const [command, ...rest] = text.trim().split(/\s+/);
  if (command === '!jarcount') { await reply(`${jar.entries.filter(x => !jar.revealed.includes(x.id)).length} hints sealed in the jar 🫙`); return true; }
  if (!isPrivileged) return false;
  if (command === '!spoilers') {
    spoilerWords = rest.join(' ').split(',').map(x => x.trim()).filter(Boolean);
    await reply(spoilerWords.length ? `Spoiler words set: ${spoilerWords.join(', ')}` : 'Spoiler word list cleared.');
    broadcast({ type: 'spoilers', words: spoilerWords }); return true;
  }
  if (command === '!jar') {
    const entry = jar.entries.find(x => !jar.revealed.includes(x.id));
    if (!entry) { await reply('The jar is empty! 🫙'); return true; }
    const revealed = await reveal(entry);
    await reply(`💡 Hint from @${revealed.user}: ${revealed.text}`); return true;
  }
  if (command === '!spill') {
    const entries = jar.entries.filter(x => !jar.revealed.includes(x.id));
    for (const entry of entries) { await reveal(entry); await new Promise(resolve => setTimeout(resolve, 3000)); }
    if (!entries.length) broadcast({ type: 'spill', entries: [], jar: publicJar() });
    return true;
  }
  if (command === '!jarreset') { jar = { entries: [], revealed: [], nextId: 1 }; await saveJar(); broadcast({ type: 'reset', jar: publicJar() }); await reply('The hint jar has been emptied. 🫙'); return true; }
  return false;
}
async function processChat({ user, text, messageId, isBroadcaster = false, isMod = false, simulate = false }) {
  if (text.trim().startsWith('!')) {
    const handled = await handleCommand(text, user, isBroadcaster || isMod || simulate, simulate);
    if (handled) return { command: true };
  }
  const result = detectMessage(text, { spoilerWords, isBroadcaster, isMod });
  if (!result.flagged) return result;
  if (!simulate && messageId) await sendDelete(messageId);
  const entry = { id: jar.nextId++, user, text, type: result.type, time: new Date().toISOString() };
  jar.entries.push(entry); await saveJar();
  broadcast({ type: 'sealed', entry, jar: publicJar() });
  if (!simulate) await sendChat(`@${user} your hint went in the jar 🫙 (#${entry.id})`);
  console.log(`[Jar] #${entry.id} ${result.type} from @${user}: ${text}`);
  return { ...result, entry };
}

function connectEventSub(url = 'wss://eventsub.wss.twitch.tv/ws') {
  if (!tokens || !broadcaster || !bot) return;
  console.log(`[EventSub] Connecting${url !== 'wss://eventsub.wss.twitch.tv/ws' ? ' for reconnect' : ''}...`);
  const ws = new WebSocket(url); eventSocket = ws;
  ws.on('message', async raw => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const metadata = msg.metadata || {}, payload = msg.payload || {};
    if (metadata.message_type === 'session_welcome') {
      const sessionId = payload.session?.id;
      console.log(`[EventSub] Session ready (${sessionId})`);
      try {
        const token = await accessToken();
        const response = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', { method: 'POST', headers: { 'Client-Id': CLIENT_ID, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'channel.chat.message', version: '1', condition: { broadcaster_user_id: broadcaster.id, user_id: bot.id }, transport: { method: 'websocket', session_id: sessionId } }) });
        const data = await response.json();
        if (!response.ok && response.status !== 409) throw new Error(data.message || `subscribe ${response.status}`);
        console.log('[EventSub] Subscribed to channel.chat.message');
      } catch (err) { console.error('[EventSub] Subscription failed:', err.message); }
    } else if (metadata.message_type === 'session_keepalive') {
      console.log('[EventSub] Keepalive');
    } else if (metadata.message_type === 'session_reconnect') {
      reconnectUrl = payload.session?.reconnect_url;
      console.log('[EventSub] Reconnecting using Twitch migration URL');
      connectEventSub(reconnectUrl);
    } else if (metadata.message_type === 'notification' && metadata.subscription_type === 'channel.chat.message') {
      const event = payload.event;
      if (!event) return;
      const user = event.chatter_user_login || event.chatter_user_name;
      const badges = event.badges || [];
      const isBroadcaster = event.broadcaster_user_id === event.chatter_user_id;
      const isMod = isBroadcaster || badges.some(b => b.set_id === 'moderator');
      try { await processChat({ user, text: event.message?.text || '', messageId: event.message_id, isBroadcaster, isMod }); }
      catch (err) { console.error('[Chat] Failed to process message:', err.message); }
    } else if (metadata.message_type === 'session_reconnect') {
      // handled above
    } else if (metadata.message_type === 'revocation') console.warn('[EventSub] Subscription revoked:', payload.subscription?.status);
  });
  ws.on('error', err => console.error('[EventSub] WebSocket error:', err.message));
  ws.on('close', () => { if (eventSocket === ws && !reconnectUrl) { console.log('[EventSub] Disconnected; reconnecting in 5s'); setTimeout(() => connectEventSub(), 5000); } });
}

app.use(express.json());
app.use(express.static(fileURLToPath(new URL('./public', import.meta.url))));
app.get('/auth/login', (req, res) => {
  if (!configReady()) return res.status(500).send('Set TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, and BROADCASTER_LOGIN in .env first.');
  const state = randomBytes(18).toString('hex'); app.locals.oauthState = state;
  const query = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code', scope: SCOPES.join(' '), state });
  res.redirect(`https://id.twitch.tv/oauth2/authorize?${query}`);
});
app.get('/auth/callback', async (req, res) => {
  if (req.query.error) return res.status(400).send(`Twitch authorization failed: ${req.query.error_description || req.query.error}`);
  if (!req.query.code || req.query.state !== app.locals.oauthState) return res.status(400).send('Invalid OAuth state. Start again at /auth/login.');
  try {
    const form = new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code: req.query.code, grant_type: 'authorization_code', redirect_uri: REDIRECT_URI });
    const response = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', body: form });
    const data = await response.json(); if (!response.ok) throw new Error(data.message || 'Token exchange failed');
    await saveTokens({ ...data, obtained_at: Date.now() }); await getUsers(); connectEventSub();
    res.send('<h1>HintJar is connected!</h1><p>Keep this server running. Open <a href="/test">/test</a> to demo or add <a href="/overlay">/overlay</a> in OBS.</p>');
    console.log(`[Auth] Connected as @${bot.login}`);
  } catch (err) { console.error('[Auth] Callback failed:', err.message); res.status(500).send(`Could not connect HintJar: ${err.message}`); }
});
app.get('/api/state', (req, res) => res.json({ jar: publicJar(), connected: Boolean(tokens), broadcaster: broadcaster?.login || BROADCASTER_LOGIN }));
app.post('/api/test', async (req, res) => {
  const text = String(req.body?.text || '').slice(0, 1000);
  if (!text.trim()) return res.status(400).json({ error: 'Enter a message first.' });
  try {
    const result = await processChat({ user: 'demo_viewer', text, simulate: true });
    res.json({ ...result, jar: publicJar() });
  } catch (err) { console.error('[Test] Simulation failed:', err.message); res.status(500).json({ error: err.message }); }
});
app.get('/overlay', (req, res) => res.sendFile(fileURLToPath(new URL('./public/overlay.html', import.meta.url))));
app.get('/test', (req, res) => res.sendFile(fileURLToPath(new URL('./public/test.html', import.meta.url))));
const wss = new WebSocketServer({ server });
wss.on('connection', ws => { clients.add(ws); ws.send(JSON.stringify({ type: 'init', jar: publicJar(), connected: Boolean(tokens) })); ws.on('close', () => clients.delete(ws)); });

if (configReady()) {
  loadTokens().then(async value => { if (value) { try { await getUsers(); connectEventSub(); } catch (err) { console.error('[Startup] Twitch connection failed:', err.message); } } else console.log('[Startup] Visit /auth/login to connect the bot.'); });
} else console.log('[Startup] Configure .env to connect Twitch. Local /test demo is available without credentials.');
