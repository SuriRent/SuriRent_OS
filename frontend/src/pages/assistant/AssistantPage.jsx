import { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Loader2, LogOut, Sparkles, Check, AlertCircle, Mic, MicOff } from 'lucide-react';
import { api, formatError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { publicMarketingUrl } from '../../lib/env';

// AssistantPage — chat-UI voor de AI-assistent op /assistent.
// Vereist login (email/password of PIN via bestaande auth). Beheerder
// heeft automatisch toegang; werknemer alleen wanneer toggle aanstaat.

function useAssistantManifest() {
  useEffect(() => {
    const link = document.querySelector('link[rel="manifest"]');
    const prev = link?.getAttribute('href');
    if (link) link.setAttribute('href', '/assistent-manifest.json');
    document.title = 'SuriRent Assistent';
    const theme = document.querySelector('meta[name="theme-color"]');
    const prevTheme = theme?.getAttribute('content');
    if (theme) theme.setAttribute('content', '#FF5C00');
    return () => {
      if (link && prev) link.setAttribute('href', prev);
      if (theme && prevTheme) theme.setAttribute('content', prevTheme);
    };
  }, []);
}

function LoginBox({ onSuccess }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await api.post('/auth/login', { email: email.trim().toLowerCase(), password });
      onSuccess();
    } catch (ex) { setErr(formatError(ex)); }
    finally { setBusy(false); }
  };
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-orange-900 p-4">
      <form onSubmit={submit} data-testid="assistant-login-form"
        className="w-full max-w-md bg-white rounded-3xl shadow-2xl p-8 space-y-5">
        <div className="flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-2xl bg-[#FF5C00] flex items-center justify-center shadow-lg mb-3">
            <Sparkles className="w-9 h-9 text-white" />
          </div>
          <h1 className="text-2xl font-black text-slate-900">SuriRent Assistent</h1>
          <p className="text-sm text-slate-500 mt-1">Log in met je beheerder- of werknemer-account</p>
        </div>
        <label className="block">
          <span className="text-xs font-bold text-slate-700">E-mailadres</span>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            data-testid="assistant-login-email"
            className="mt-1 w-full h-11 px-3 border-2 border-slate-200 rounded-xl focus:border-[#FF5C00] outline-none" />
        </label>
        <label className="block">
          <span className="text-xs font-bold text-slate-700">Wachtwoord</span>
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
            data-testid="assistant-login-password"
            className="mt-1 w-full h-11 px-3 border-2 border-slate-200 rounded-xl focus:border-[#FF5C00] outline-none" />
        </label>
        {err && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}
        <button type="submit" disabled={busy} data-testid="assistant-login-submit"
          className="w-full h-12 rounded-xl bg-[#FF5C00] hover:bg-[#E64F00] text-white font-black disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg">
          {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
          {busy ? 'Bezig…' : 'Inloggen'}
        </button>
      </form>
    </div>
  );
}

function Message({ role, content, actions }) {
  const isUser = role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${
        isUser ? 'bg-[#FF5C00] text-white' : 'bg-white border border-slate-200 text-slate-900'
      }`} data-testid={`assistant-msg-${role}`}>
        <div className="text-sm whitespace-pre-wrap leading-relaxed">{content}</div>
        {actions && actions.length > 0 && (
          <div className="mt-2 space-y-1">
            {actions.map((a, i) => (
              <div key={i} className="text-xs flex items-start gap-1.5 bg-emerald-50 text-emerald-900 rounded-lg px-2 py-1">
                <Check className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span><b>{a.tool}</b>: {JSON.stringify(a.result).slice(0, 140)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ChatUI({ user }) {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: `Hallo ${user.name || 'daar'}! Ik ben je AI-assistent. Vraag me bijvoorbeeld:\n• "Huis 1A heeft SRD 5000 betaald"\n• "Wie heeft achterstand?"\n• "Maak een factuur van SRD 3500 voor Jan Pieterse"\n\nTip: druk op de microfoon om in te spreken.`, actions: [] },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [listening, setListening] = useState(false);
  const scrollRef = useRef(null);
  const recRef = useRef(null);
  const { logout } = useAuth();

  // Voice input via Web Speech API. Chrome/Safari/Edge ondersteunen dit;
  // Firefox helaas niet. We tonen de knop alleen wanneer beschikbaar.
  const voiceSupported = typeof window !== 'undefined' &&
    (window.SpeechRecognition || window.webkitSpeechRecognition);

  const toggleVoice = useCallback(() => {
    if (!voiceSupported) return;
    if (listening) {
      try { recRef.current?.stop(); } catch { /* ignore */ }
      setListening(false);
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = 'nl-NL';
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e) => {
      const txt = Array.from(e.results).map((r) => r[0].transcript).join('');
      setInput(txt);
    };
    rec.onend = () => setListening(false);
    rec.onerror = (e) => { setListening(false); console.warn('speech error', e.error); };
    recRef.current = rec;
    try { rec.start(); setListening(true); } catch { setListening(false); }
  }, [listening, voiceSupported]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const send = useCallback(async () => {
    const q = input.trim();
    if (!q || busy) return;
    setMessages((m) => [...m, { role: 'user', content: q }]);
    setInput(''); setBusy(true);
    try {
      const { data } = await api.post('/assistant/chat', { message: q, session_id: sessionId });
      if (data.session_id && !sessionId) setSessionId(data.session_id);
      setMessages((m) => [...m, { role: 'assistant', content: data.reply || '(geen antwoord)', actions: data.actions || [] }]);
    } catch (ex) {
      setMessages((m) => [...m, { role: 'assistant', content: `⚠️ ${formatError(ex)}`, error: true }]);
    } finally { setBusy(false); }
  }, [input, busy, sessionId]);

  const doLogout = async () => {
    try { await logout(); } catch { /* ignore */ }
    window.location.replace(`${publicMarketingUrl()}/`);
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-slate-50 to-slate-100">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-[#FF5C00] flex items-center justify-center shadow">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-sm font-black text-slate-900">SuriRent Assistent</h1>
            <p className="text-[10px] text-slate-500">{user.email}</p>
          </div>
        </div>
        <button onClick={doLogout} data-testid="assistant-logout"
          className="text-xs font-bold text-slate-500 hover:text-slate-900 flex items-center gap-1">
          <LogOut className="w-4 h-4" /> Uitloggen
        </button>
      </header>

      {/* Messages */}
      <main ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3" data-testid="assistant-messages">
        {messages.map((m, i) => <Message key={i} {...m} />)}
        {busy && (
          <div className="flex justify-start">
            <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-[#FF5C00]" />
              <span className="text-sm text-slate-500">Denkt na…</span>
            </div>
          </div>
        )}
      </main>

      {/* Input */}
      <footer className="bg-white border-t border-slate-200 p-3 shrink-0">
        <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex gap-2 max-w-3xl mx-auto">
          {voiceSupported && (
            <button type="button" onClick={toggleVoice} data-testid="assistant-mic"
              className={`h-12 w-12 rounded-2xl flex items-center justify-center shrink-0 transition ${
                listening
                  ? 'bg-red-500 text-white animate-pulse shadow-lg shadow-red-300'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
              title={listening ? 'Stop opname' : 'Spreek in'}>
              {listening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>
          )}
          <input type="text" value={input} onChange={(e) => setInput(e.target.value)}
            placeholder={listening ? 'Luistert…' : 'Typ je vraag of opdracht…'} disabled={busy}
            data-testid="assistant-input"
            className="flex-1 h-12 px-4 rounded-2xl border-2 border-slate-200 focus:border-[#FF5C00] outline-none text-sm" />
          <button type="submit" disabled={busy || !input.trim()} data-testid="assistant-send"
            className="h-12 px-5 rounded-2xl bg-[#FF5C00] hover:bg-[#E64F00] text-white font-bold disabled:opacity-50 flex items-center gap-2 shadow">
            <Send className="w-4 h-4" />
          </button>
        </form>
      </footer>
    </div>
  );
}

export default function AssistantPage() {
  useAssistantManifest();
  const { user, loading, refresh } = useAuth();
  const [status, setStatus] = useState(null);
  const [statusErr, setStatusErr] = useState(null);

  useEffect(() => {
    if (loading || !user) return;
    api.get('/assistant/me')
      .then((r) => setStatus(r.data))
      .catch((e) => setStatusErr(formatError(e)));
  }, [loading, user]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-900">
      <Loader2 className="w-8 h-8 animate-spin text-[#FF5C00]" />
    </div>;
  }
  if (!user) {
    return <LoginBox onSuccess={refresh} />;
  }
  if (statusErr) {
    return <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-md bg-white rounded-2xl p-6 border border-red-200">
        <AlertCircle className="w-8 h-8 text-red-500 mb-2" />
        <p className="text-sm text-red-700">{statusErr}</p>
      </div>
    </div>;
  }
  if (status && !status.ai_assistant_enabled) {
    return <div className="min-h-screen flex items-center justify-center p-4 bg-slate-50">
      <div className="max-w-md bg-white rounded-2xl p-6 shadow-lg text-center">
        <AlertCircle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
        <h2 className="font-black text-slate-900 mb-1">Geen toegang</h2>
        <p className="text-sm text-slate-600">Je hebt geen toegang tot de AI-assistent. Vraag je beheerder om toegang in te schakelen.</p>
      </div>
    </div>;
  }
  return status ? <ChatUI user={status} /> : null;
}
