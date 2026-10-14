// Kiosk-chat store: privégesprekken beheer ↔ medewerker via de kiosk-WebSocket.
import { sendKioskLive, subscribeKioskLive, getKioskLiveState } from './kiosk-live';

const ME = '__me';
let role = 'employee';
let state = { threads: {}, open: false, active: null };
const listeners = new Set();
let installed = false;

const emit = (patch) => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };
export const subscribeChat = (l) => { listeners.add(l); return () => listeners.delete(l); };
export const getChatState = () => state;
export const totalUnread = (s) => Object.values(s.threads).reduce((n, t) => n + (t.unread || 0), 0);

const keyOf = (empKey) => (role === 'employee' ? ME : empKey);
const fromOther = (m) => (role === 'admin' ? m.sender === 'employee' : m.sender === 'admin');
const isUnread = (m) => fromOther(m) && !(role === 'admin' ? m.read_by_admin : m.read_by_emp);
const isViewing = (k) => state.open && (role === 'employee' || state.active === k);

function putThread(k, patch) {
  const t = state.threads[k] || { emp_key: k, emp_name: '', messages: [], unread: 0 };
  emit({ threads: { ...state.threads, [k]: { ...t, ...patch } } });
}

function ding() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = 880; g.gain.setValueAtTime(0.15, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.25);
    setTimeout(() => ctx.close(), 400);
  } catch { /* geen audio */ }
}

function onWs(e) {
  const msg = e.detail;
  if (msg.type === 'chat_threads') {
    const threads = { ...state.threads };
    msg.threads.forEach((t) => { threads[t.emp_key] = { messages: [], ...threads[t.emp_key], ...t }; });
    emit({ threads });
  } else if (msg.type === 'chat_history') {
    const k = keyOf(msg.emp_key);
    const viewing = isViewing(k);
    putThread(k, { messages: msg.messages, unread: viewing ? 0 : msg.messages.filter(isUnread).length, real_key: msg.emp_key });
    if (viewing && msg.messages.some(isUnread)) markRead(k);
  } else if (msg.type === 'chat') {
    const m = msg.message;
    const k = keyOf(msg.emp_key);
    const t = state.threads[k] || { messages: [], unread: 0 };
    const rest = t.messages.filter((x) => x.id !== m.id && !(m.client_id && x.client_id === m.client_id));
    const viewing = isViewing(k);
    const unread = fromOther(m) && !viewing ? (t.unread || 0) + 1 : t.unread || 0;
    putThread(k, { messages: [...rest, m], unread, emp_name: m.emp_name || t.emp_name, last_text: m.text, last_at: m.created_at, real_key: msg.emp_key });
    if (fromOther(m)) { ding(); if (viewing) markRead(k); }
  } else if (msg.type === 'chat_read') {
    const k = keyOf(msg.emp_key);
    const t = state.threads[k];
    if (!t || (role === 'admin') === (msg.reader === 'admin')) return;
    const field = msg.reader === 'admin' ? 'read_by_admin' : 'read_by_emp';
    putThread(k, { messages: t.messages.map((m) => ({ ...m, [field]: true })) });
  }
}

function markRead(k) {
  const t = state.threads[k];
  if (t) putThread(k, { unread: 0 });
  sendKioskLive(role === 'admin' ? { type: 'chat_read', emp_key: k } : { type: 'chat_read' });
}

export function installKioskChat(asRole) {
  role = asRole;
  if (installed) return;
  installed = true;
  window.addEventListener('kiosk-chat', onWs);
  let wasConnected = false;
  const sync = () => {
    const c = getKioskLiveState().connected;
    if (c && !wasConnected) sendKioskLive(role === 'admin' ? { type: 'chat_threads' } : { type: 'chat_history' });
    wasConnected = c;
  };
  subscribeKioskLive(sync);
  sync();
}

export function openChat(open) {
  emit({ open });
  if (open && role === 'employee') markRead(ME);
  if (open && role === 'admin' && state.active) markRead(state.active);
}

export function openThread(empKey, empName) {
  if (!state.threads[empKey]) putThread(empKey, { emp_name: empName });
  emit({ active: empKey });
  sendKioskLive({ type: 'chat_history', emp_key: empKey });
  markRead(empKey);
}

export const closeThread = () => emit({ active: null });

export function sendChat(text, receipt = null) {
  const clean = (text || '').trim();
  if (!clean && !receipt) return;
  const client_id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const k = role === 'admin' ? state.active : ME;
  if (!k) return;
  const t = state.threads[k] || { messages: [] };
  const optimistic = { id: client_id, client_id, sender: role, text: clean, receipt, created_at: new Date().toISOString(), pending: true };
  putThread(k, { messages: [...t.messages, optimistic] });
  sendKioskLive(role === 'admin'
    ? { type: 'chat_send', emp_key: k, emp_name: t.emp_name, text: clean, client_id, receipt_payment_id: receipt?.payment_id }
    : { type: 'chat_send', text: clean, client_id });
}
