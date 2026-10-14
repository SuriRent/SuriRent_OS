import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Check, CheckCheck, MessageCircle, Receipt, Send, X } from 'lucide-react';
import { ChatReceiptCard, ChatReceiptViewer, ChatReceiptPicker, receiptFromLog } from './KioskChatReceipt';
import { subscribeKioskLive, getKioskLiveState } from '../lib/kiosk-live';
import {
  subscribeChat, getChatState, totalUnread, installKioskChat, openChat, openThread, closeThread, sendChat,
} from '../lib/kiosk-chat';

const fmtTime = (s) => new Date(s).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });

function Bubble({ m, mine, onOpenReceipt }) {
  const read = mine && (m.sender === 'admin' ? m.read_by_emp : m.read_by_admin);
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm ${m.receipt ? 'min-w-[230px]' : ''} ${mine ? 'bg-[#FF5C00] text-white rounded-br-md' : 'bg-white text-slate-900 rounded-bl-md'}`}
        data-testid={`kiosk-chat-msg-${m.id}`}>
        {m.receipt && <ChatReceiptCard receipt={m.receipt} mine={mine} onOpen={() => onOpenReceipt(m.receipt)} />}
        {m.text && <p className={`whitespace-pre-wrap break-words ${m.receipt ? 'mt-1.5' : ''}`}>{m.text}</p>}
        <p className={`text-[10px] mt-0.5 flex items-center justify-end gap-1 ${mine ? 'text-white/70' : 'text-slate-400'}`}>
          {fmtTime(m.created_at)}
          {mine && (m.pending ? <Check className="w-3 h-3 opacity-60" /> : read ? <CheckCheck className="w-3 h-3" /> : <Check className="w-3 h-3" />)}
        </p>
      </div>
    </div>
  );
}

function Conversation({ thread, role }) {
  const [text, setText] = useState('');
  const [viewing, setViewing] = useState(null);
  const [picking, setPicking] = useState(false);
  const endRef = useRef(null);
  const msgs = thread?.messages || [];
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [msgs.length]);
  const submit = (e) => { e.preventDefault(); sendChat(text); setText(''); };
  return (
    <>
      <div className="relative flex-1 min-h-0 flex flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-2 bg-orange-50/60" data-testid="kiosk-chat-messages">
        {msgs.length === 0 && <p className="text-center text-xs text-slate-400 mt-6">Nog geen berichten vandaag. Berichten worden alleen vandaag bewaard.</p>}
        {msgs.map((m) => <Bubble key={m.id} m={m} mine={m.sender === role} onOpenReceipt={setViewing} />)}
        <div ref={endRef} />
      </div>
      {picking && <ChatReceiptPicker onClose={() => setPicking(false)} onPick={(l) => { sendChat('', receiptFromLog(l)); setPicking(false); }} />}
      {viewing && <ChatReceiptViewer receipt={viewing} onClose={() => setViewing(null)} />}
      <form onSubmit={submit} className="flex items-center gap-2 p-2 border-t border-slate-100 bg-white">
        {role === 'admin' && (
          <button type="button" onClick={() => setPicking(true)} data-testid="kiosk-chat-send-receipt" aria-label="Bon sturen" title="Bon sturen"
            className="w-11 h-11 shrink-0 rounded-full bg-orange-50 text-[#FF5C00] hover:bg-orange-100 flex items-center justify-center transition-colors">
            <Receipt className="w-5 h-5" />
          </button>
        )}
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Typ een bericht…" maxLength={1000}
          data-testid="kiosk-chat-input" autoComplete="off"
          className="flex-1 h-11 px-4 rounded-full bg-slate-100 text-sm outline-none focus:ring-2 focus:ring-orange-300" />
        <button type="submit" disabled={!text.trim()} data-testid="kiosk-chat-send" aria-label="Versturen"
          className="w-11 h-11 rounded-full bg-[#FF5C00] text-white flex items-center justify-center disabled:opacity-40 transition-opacity">
          <Send className="w-4 h-4" />
        </button>
      </form>
      </div>
    </>
  );
}

function ThreadList({ threads, employees }) {
  const rows = useMemo(() => {
    const m = new Map(Object.values(threads).map((t) => [t.emp_key, t]));
    employees.forEach((e) => { if (!m.has(e.key)) m.set(e.key, { emp_key: e.key, emp_name: e.name, unread: 0 }); });
    const online = new Set(employees.map((e) => e.key));
    return [...m.values()].map((t) => ({ ...t, online: online.has(t.emp_key) }))
      .sort((a, b) => (b.unread - a.unread) || (b.online - a.online) || String(b.last_at || '').localeCompare(String(a.last_at || '')));
  }, [threads, employees]);
  if (!rows.length) return <p className="p-6 text-center text-sm text-slate-400">Geen medewerkers online en nog geen gesprekken vandaag.</p>;
  return (
    <ul className="flex-1 overflow-y-auto divide-y divide-slate-100" data-testid="kiosk-chat-threads">
      {rows.map((t) => (
        <li key={t.emp_key}>
          <button onClick={() => openThread(t.emp_key, t.emp_name)} data-testid={`kiosk-chat-thread-${t.emp_key}`}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-orange-50 text-left transition-colors">
            <span className="relative w-10 h-10 rounded-full bg-orange-100 text-[#FF5C00] font-black flex items-center justify-center shrink-0">
              {(t.emp_name || '?').slice(0, 1).toUpperCase()}
              <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full ring-2 ring-white ${t.online ? 'bg-emerald-500' : 'bg-slate-300'}`} />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block font-bold text-sm text-slate-900 truncate">{t.emp_name || 'Medewerker'}</span>
              <span className="block text-xs text-slate-500 truncate">{t.last_text || (t.online ? 'Online — start een gesprek' : 'Offline')}</span>
            </span>
            {t.unread > 0 && <span className="min-w-[22px] h-[22px] px-1.5 rounded-full bg-red-500 text-white text-xs font-black flex items-center justify-center">{t.unread}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

function ChatPanel({ role, chat, employees }) {
  const thread = role === 'admin' ? chat.threads[chat.active] : chat.threads.__me;
  const title = role === 'admin' ? (chat.active ? (thread?.emp_name || 'Medewerker') : 'Chat met medewerkers') : 'Beheer';
  return createPortal((
    <div className="fixed inset-0 z-[10001] sm:inset-auto sm:right-4 sm:top-14 sm:w-[380px] sm:h-[560px] sm:rounded-2xl overflow-hidden bg-white shadow-2xl flex flex-col"
      data-testid="kiosk-chat-panel" style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <div className="flex items-center gap-2 px-3 h-14 bg-slate-900 text-white shrink-0">
        {role === 'admin' && chat.active && (
          <button onClick={closeThread} data-testid="kiosk-chat-back" aria-label="Terug" className="w-9 h-9 rounded-full hover:bg-white/10 flex items-center justify-center"><ArrowLeft className="w-5 h-5" /></button>
        )}
        <MessageCircle className="w-5 h-5 text-[#FF8A3D]" />
        <p className="flex-1 font-black truncate" data-testid="kiosk-chat-title">{title}</p>
        <button onClick={() => openChat(false)} data-testid="kiosk-chat-close" aria-label="Sluiten" className="w-9 h-9 rounded-full hover:bg-white/10 flex items-center justify-center"><X className="w-5 h-5" /></button>
      </div>
      {role === 'admin' && !chat.active
        ? <ThreadList threads={chat.threads} employees={employees} />
        : <Conversation thread={thread} role={role} />}
    </div>
  ), document.body);
}

// Chat-icoon op de kiosk (naast het groene bolletje) voor medewerker en beheerder.
export function KioskChat({ role, visible = true }) {
  useEffect(() => { installKioskChat(role); }, [role]);
  const chat = useSyncExternalStore(subscribeChat, getChatState);
  const live = useSyncExternalStore(subscribeKioskLive, getKioskLiveState);
  const unread = totalUnread(chat);
  return (
    <>
      {!visible && unread > 0 && !chat.open && (
        <button type="button" onClick={() => openChat(true)} data-testid="kiosk-chat-new-pill"
          className="fixed z-40 right-2 h-8 px-3 rounded-full bg-slate-900/85 text-white text-xs font-bold flex items-center gap-1.5 backdrop-blur"
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 6px)' }}>
          <MessageCircle className="w-3.5 h-3.5" /> Nieuw bericht ({unread})
        </button>
      )}
      {visible && <button type="button" onClick={() => openChat(!chat.open)} aria-label="Chat" title="Chat"
        data-testid="kiosk-chat-btn" className="fixed z-40 p-1" style={{ top: 'env(safe-area-inset-top, 0px)', right: 26 }}>
        <span className="relative block">
          <MessageCircle className="w-5 h-5 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.45)]" />
          {unread > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-black flex items-center justify-center"
              data-testid="kiosk-chat-unread">{unread}</span>
          )}
        </span>
      </button>}
      {chat.open && <ChatPanel role={role} chat={chat} employees={live.employees || []} />}
    </>
  );
}
