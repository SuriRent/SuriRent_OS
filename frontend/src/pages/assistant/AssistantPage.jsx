import { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Loader2, LogOut, Sparkles, Check, AlertCircle, Mic, MicOff, Volume2, VolumeX, Phone, PhoneOff } from 'lucide-react';
import { api, formatError } from '../../lib/api';
import { useAuth } from '../../lib/auth';

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
    { role: 'assistant', content: `Hallo ${user.name || 'daar'}! Ik ben je AI-assistent. Vraag me bijvoorbeeld:\n• "Huis 1A heeft SRD 5000 betaald"\n• "Wie heeft achterstand?"\n• "Maak een factuur van SRD 3500 voor Jan Pieterse"\n\nTip: druk op de microfoon om in te spreken, of tik op het telefoon-icoon voor een live gesprek.`, actions: [] },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [voiceOn, setVoiceOn] = useState(() => {
    try { return localStorage.getItem('assistant_tts_on') !== '0'; } catch { return true; }
  });
  const [speaking, setSpeaking] = useState(false);
  const [convoMode, setConvoMode] = useState(false); // Gesprek-modus (hands-free loop)
  const scrollRef = useRef(null);
  const mediaRecRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const audioRef = useRef(null);
  const audioUnlockedRef = useRef(false);      // browser autoplay unlock
  const pendingAudioRef = useRef(null);        // blob-URL wachtend op user-gesture
  const [needsUnlock, setNeedsUnlock] = useState(false);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const vadRafRef = useRef(0);
  const speechRecRef = useRef(null);
  const convoModeRef = useRef(false);          // ref-mirror voor callbacks
  const pendingAutosendRef = useRef(false);    // markeert: na transcriptie automatisch versturen
  const startRecordingRef = useRef(null);      // ref-mirror voor callbacks (voorkomt TDZ)
  const { logout } = useAuth();

  // MediaRecorder + getUserMedia — Emergent-managed Whisper via backend.
  const voiceSupported = typeof navigator !== 'undefined'
    && navigator.mediaDevices?.getUserMedia
    && typeof window !== 'undefined' && window.MediaRecorder;
  // Web Speech API voor live preview-tekst (interim). Chrome/Safari/Edge.
  const liveSupported = typeof window !== 'undefined'
    && !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  const stopStream = useCallback(() => {
    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
    streamRef.current = null;
    if (vadRafRef.current) { cancelAnimationFrame(vadRafRef.current); vadRafRef.current = 0; }
    try { analyserRef.current?.disconnect(); } catch { /* ignore */ }
    analyserRef.current = null;
    try { audioCtxRef.current?.close(); } catch { /* ignore */ }
    audioCtxRef.current = null;
  }, []);

  const stopLive = useCallback(() => {
    try { speechRecRef.current?.stop(); } catch { /* ignore */ }
    speechRecRef.current = null;
  }, []);

  // Roept mediaRecorder.stop() aan; de onstop-handler regelt uploaden.
  const stopRecording = useCallback(() => {
    stopLive();
    try { mediaRecRef.current?.stop(); } catch { /* ignore */ }
    setRecording(false);
  }, [stopLive]);

  // playReply — declared before startRecording zodat convo-loop hem kan bereiken.
  // Autoplay-strategie: browsers blokkeren `audio.play()` na langere network-
  // latency (Whisper+chat+TTS) omdat de "user gesture" verlopen is. We
  // unlocken audio bij de eerste user-tap (unlockAudio()) door een geluidloze
  // buffer te spelen; daarna werken alle vervolg-clips vrij. Als een play()
  // toch nog rejectet met NotAllowedError, tonen we een "Tik om te horen"-
  // knop met de wachtende blob-URL.
  const unlockAudio = useCallback(() => {
    if (audioUnlockedRef.current) return;
    try {
      // 0.1s stilte MP3 (base64) — universeel afspeelbaar
      const silentSrc = 'data:audio/mp3;base64,SUQzBAAAAAABEVRYWFgAAAAtAAADY29tbWVudABCaWdTb3VuZEJhbmsuY29tIC8gTGFTb25vdGhlcXVlLm9yZwBURU5DAAAAHQAAA1N3aXRjaCBQbHVzIMKpIE5DSCBTb2Z0d2FyZQBUSVQyAAAABgAAAzIyMzUAVFNTRQAAAA8AAANMYXZmNTcuODMuMTAwAAAAAAAAAAAAAAD/80DEAAAAA0gAAAAATEFNRTMuMTAwVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV/zQsQAAADSAAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV/zQsQZAABkAG//gAAAgAAA0gAAABERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERE=';
      const a = new Audio(silentSrc);
      a.volume = 0.01;
      const p = a.play();
      if (p && typeof p.then === 'function') {
        p.then(() => { audioUnlockedRef.current = true; }).catch(() => { /* silent */ });
      } else {
        audioUnlockedRef.current = true;
      }
    } catch { /* silent */ }
  }, []);

  const playReply = useCallback(async (text, onDone) => {
    if (!voiceOn || !text) { onDone?.(); return; }
    try {
      try { audioRef.current?.pause(); } catch { /* ignore */ }
      setSpeaking(true);
      const { data } = await api.post('/assistant/tts', { text, voice: 'nova' }, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(data);
      const audio = new Audio(url);
      audioRef.current = audio;
      const finish = () => {
        setSpeaking(false); URL.revokeObjectURL(url); onDone?.();
      };
      audio.onended = finish;
      audio.onerror = finish;
      try {
        await audio.play();
      } catch (playErr) {
        // Autoplay geweigerd — sla blob-URL op en toon unlock-knop
        // We roepen onDone NIET aan zodat de gesprek-modus-loop wacht
        // tot de gebruiker de unlock-knop tikt (voorkomt dat de mic weer
        // opent voordat het antwoord is gehoord).
        console.warn('Autoplay blocked, waiting for tap', playErr);
        pendingAudioRef.current = url;
        setNeedsUnlock(true);
        setSpeaking(false);
      }
    } catch (ex) {
      console.warn('TTS failed', ex);
      setSpeaking(false); onDone?.();
    }
  }, [voiceOn]);

  const manualPlayPending = useCallback(async () => {
    const url = pendingAudioRef.current;
    if (!url) { setNeedsUnlock(false); return; }
    audioUnlockedRef.current = true;
    try {
      const audio = new Audio(url);
      audioRef.current = audio;
      setSpeaking(true);
      const onEndOrErr = () => {
        setSpeaking(false); URL.revokeObjectURL(url);
        // Herstart gesprek-modus loop via ref (voorkomt TDZ)
        if (convoModeRef.current && startRecordingRef.current) {
          pendingAutosendRef.current = true;
          setTimeout(() => startRecordingRef.current?.(), 250);
        }
      };
      audio.onended = onEndOrErr;
      audio.onerror = onEndOrErr;
      await audio.play();
    } catch (e) { console.warn('manual play failed', e); }
    pendingAudioRef.current = null;
    setNeedsUnlock(false);
  }, []);

  const uploadAndTranscribe = useCallback(async (blob) => {
    setTranscribing(true);
    try {
      const fd = new FormData();
      const ext = blob.type.includes('mp4') || blob.type.includes('m4a') ? 'm4a'
        : blob.type.includes('wav') ? 'wav'
        : blob.type.includes('mpeg') ? 'mp3' : 'webm';
      fd.append('file', blob, `opname.${ext}`);
      fd.append('language', 'nl');
      const { data } = await api.post('/assistant/stt', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const finalText = (data?.text || '').trim();
      if (finalText) setInput(finalText);
      return finalText;
    } catch (ex) {
      console.warn('STT failed', ex);
      setMessages((m) => [...m, { role: 'assistant', content: `⚠️ Transcriptie mislukt: ${formatError(ex)}` }]);
      return '';
    } finally { setTranscribing(false); }
  }, []);

  // Silence-detectie via Web Audio API AnalyserNode.
  // Auto-stop na `silenceMs` stilte, mits minimaal `minSpeechMs` gesproken.
  const startVAD = useCallback((stream) => {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(analyser);
      analyserRef.current = analyser;
      const data = new Uint8Array(analyser.fftSize);
      const started = Date.now();
      let lastVoiceAt = Date.now();
      let sawVoice = false;
      const THRESH = 8;         // RMS-drempel (0-128 range) — laag om ruis te vermijden
      const SILENCE_MS = 1500;  // 1,5s stilte → auto-stop
      const MIN_SPEECH_MS = 700; // minimaal 0,7s spraak vereist voordat we mogen stoppen
      const MAX_TOTAL_MS = 60_000; // veiligheidsplafond 60s

      const tick = () => {
        if (!analyserRef.current) return;
        analyser.getByteTimeDomainData(data);
        // Compute RMS deviatie van 128 (silence-center)
        let sumSq = 0;
        for (let i = 0; i < data.length; i++) {
          const v = data[i] - 128;
          sumSq += v * v;
        }
        const rms = Math.sqrt(sumSq / data.length);
        const now = Date.now();
        if (rms > THRESH) { lastVoiceAt = now; sawVoice = true; }
        const totalMs = now - started;
        const silenceMs = now - lastVoiceAt;
        const speechMs = sawVoice ? (lastVoiceAt - started) : 0;

        if (totalMs > MAX_TOTAL_MS) { stopRecording(); return; }
        if (sawVoice && silenceMs >= SILENCE_MS && speechMs >= MIN_SPEECH_MS) {
          // Genoeg gesproken en 1,5s stil → auto-verzenden
          pendingAutosendRef.current = true;
          stopRecording();
          return;
        }
        vadRafRef.current = requestAnimationFrame(tick);
      };
      vadRafRef.current = requestAnimationFrame(tick);
    } catch (e) { console.warn('VAD init failed', e); }
  }, [stopRecording]);

  const startLive = useCallback(() => {
    if (!liveSupported) return;
    try {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      const rec = new SR();
      rec.lang = 'nl-NL';
      rec.continuous = true;
      rec.interimResults = true;
      rec.onresult = (e) => {
        let interim = '';
        let final_ = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) final_ += r[0].transcript;
          else interim += r[0].transcript;
        }
        setInterimText((prev) => (final_ ? (prev + final_) : interim));
      };
      rec.onerror = () => { /* stil falen — Whisper is fallback */ };
      rec.onend = () => { /* MediaRecorder blijft leidend */ };
      speechRecRef.current = rec;
      rec.start();
    } catch (e) { console.warn('live STT init failed', e); }
  }, [liveSupported]);

  const startRecording = useCallback(async () => {
    if (!voiceSupported || recording) return;
    // Als TTS bezig is → eerst stoppen om feedback te voorkomen.
    try { audioRef.current?.pause(); } catch { /* ignore */ }
    setSpeaking(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      let mime = '';
      const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac'];
      for (const c of candidates) {
        if (window.MediaRecorder.isTypeSupported?.(c)) { mime = c; break; }
      }
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      setInterimText('');
      setInput('');
      rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stopStream();
        stopLive();
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        chunksRef.current = [];
        if (blob.size < 500) {
          setInterimText('');
          pendingAutosendRef.current = false;
          return;
        }
        const finalText = await uploadAndTranscribe(blob);
        setInterimText('');
        // Auto-verzenden in gesprek-modus of wanneer VAD triggerde
        if (pendingAutosendRef.current && finalText) {
          pendingAutosendRef.current = false;
          // send() kan niet direct — het leest input via state die net gezet is.
          // Roep chat rechtstreeks aan om race condition met setState te vermijden.
          setMessages((m) => [...m, { role: 'user', content: finalText }]);
          setInput(''); setBusy(true);
          try {
            const { data } = await api.post('/assistant/chat', { message: finalText, session_id: sessionId });
            if (data.session_id && !sessionId) setSessionId(data.session_id);
            const reply = data.reply || '(geen antwoord)';
            setMessages((m) => [...m, { role: 'assistant', content: reply, actions: data.actions || [] }]);
            playReply(reply, () => {
              // Herstart luisteren in gesprek-modus
              if (convoModeRef.current) {
                pendingAutosendRef.current = true;
                setTimeout(() => startRecording(), 250);
              }
            });
          } catch (ex) {
            setMessages((m) => [...m, { role: 'assistant', content: `⚠️ ${formatError(ex)}`, error: true }]);
          } finally { setBusy(false); }
        } else {
          pendingAutosendRef.current = false;
        }
      };
      rec.onerror = (e) => { console.warn('rec error', e); setRecording(false); stopStream(); stopLive(); };
      mediaRecRef.current = rec;
      rec.start();
      setRecording(true);
      startLive();
      if (convoModeRef.current) startVAD(stream);
    } catch (ex) {
      console.warn('mic permission denied', ex);
      setMessages((m) => [...m, { role: 'assistant', content: '⚠️ Geen microfoon-toegang. Sta toegang toe in je browser.' }]);
      setRecording(false);
      convoModeRef.current = false;
      setConvoMode(false);
    }
  }, [voiceSupported, recording, uploadAndTranscribe, stopStream, stopLive, startLive, startVAD, sessionId, playReply]);

  useEffect(() => { startRecordingRef.current = startRecording; }, [startRecording]);

  const toggleMic = useCallback(() => {
    unlockAudio(); // Ontgrendel audio-autoplay bij eerste user-tap
    if (recording) { stopRecording(); return; }
    pendingAutosendRef.current = false; // handmatige mic-klik → tekst in input, niet auto-send
    startRecording();
  }, [recording, startRecording, stopRecording, unlockAudio]);

  const toggleConvoMode = useCallback(() => {
    unlockAudio(); // Ontgrendel audio-autoplay bij eerste user-tap
    setConvoMode((v) => {
      const nv = !v;
      convoModeRef.current = nv;
      if (nv) {
        pendingAutosendRef.current = true;
        if (!recording) startRecording();
      } else {
        pendingAutosendRef.current = false;
        try { audioRef.current?.pause(); } catch { /* ignore */ }
        setSpeaking(false);
        if (recording) stopRecording();
      }
      return nv;
    });
  }, [recording, startRecording, stopRecording, unlockAudio]);

  const toggleTts = useCallback(() => {
    unlockAudio();
    setVoiceOn((v) => {
      const nv = !v;
      try { localStorage.setItem('assistant_tts_on', nv ? '1' : '0'); } catch { /* ignore */ }
      if (!nv) {
        try { audioRef.current?.pause(); } catch { /* ignore */ }
        setSpeaking(false);
      }
      return nv;
    });
  }, [unlockAudio]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  // Cleanup bij unmount
  useEffect(() => () => {
    try { mediaRecRef.current?.stop(); } catch { /* ignore */ }
    stopStream(); stopLive();
    try { audioRef.current?.pause(); } catch { /* ignore */ }
  }, [stopStream, stopLive]);

  const send = useCallback(async () => {
    unlockAudio();
    const q = input.trim();
    if (!q || busy) return;
    setMessages((m) => [...m, { role: 'user', content: q }]);
    setInput(''); setBusy(true);
    try {
      const { data } = await api.post('/assistant/chat', { message: q, session_id: sessionId });
      if (data.session_id && !sessionId) setSessionId(data.session_id);
      const reply = data.reply || '(geen antwoord)';
      setMessages((m) => [...m, { role: 'assistant', content: reply, actions: data.actions || [] }]);
      playReply(reply);
    } catch (ex) {
      setMessages((m) => [...m, { role: 'assistant', content: `⚠️ ${formatError(ex)}`, error: true }]);
    } finally { setBusy(false); }
  }, [input, busy, sessionId, playReply, unlockAudio]);

  const doLogout = async () => {
    try { await logout(); } catch { /* ignore */ }
    // Assistent is een beheerder-tool → terug naar login-scherm, niet
    // naar de marketing-landing. Gebruik branded slug als beschikbaar.
    let target = '/login';
    try {
      const slug = localStorage.getItem('pwa_company_slug');
      if (slug) target = `/${slug}/login`;
    } catch { /* noop */ }
    window.location.replace(target);
  };

  // Statusbanner boven input — gesprek-modus indicator
  const statusBanner = (() => {
    if (busy) return { label: 'Denkt na…', tone: 'thinking' };
    if (speaking) return { label: 'Assistent praat…', tone: 'speaking' };
    if (transcribing) return { label: 'Transcriberen met Whisper…', tone: 'thinking' };
    if (recording) return { label: interimText ? `Ik hoor je: "${interimText}"` : 'Luistert… (spreek, ik stop automatisch bij 1,5s stilte)', tone: 'listening' };
    if (convoMode) return { label: 'Gesprek-modus actief', tone: 'idle' };
    return null;
  })();

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
        <div className="flex items-center gap-2">
          <button onClick={toggleConvoMode} data-testid="assistant-convo-toggle"
            title={convoMode ? 'Gesprek-modus stoppen' : 'Start live gesprek (hands-free)'}
            className={`h-9 w-9 rounded-lg flex items-center justify-center transition ${
              convoMode ? 'bg-red-500 text-white shadow-lg shadow-red-300 animate-pulse' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}>
            {convoMode ? <PhoneOff className="w-4 h-4" /> : <Phone className="w-4 h-4" />}
          </button>
          <button onClick={toggleTts} data-testid="assistant-tts-toggle"
            title={voiceOn ? 'Stemantwoord uitzetten' : 'Stemantwoord aanzetten'}
            className={`h-9 w-9 rounded-lg flex items-center justify-center transition ${
              voiceOn ? 'bg-[#FF5C00]/10 text-[#FF5C00]' : 'bg-slate-100 text-slate-400 hover:text-slate-700'
            } ${speaking ? 'animate-pulse' : ''}`}>
            {voiceOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
          <button onClick={doLogout} data-testid="assistant-logout"
            className="text-xs font-bold text-slate-500 hover:text-slate-900 flex items-center gap-1">
            <LogOut className="w-4 h-4" /> Uitloggen
          </button>
        </div>
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

      {/* Autoplay-fallback — verschijnt als browser TTS blokkeerde */}
      {needsUnlock && (
        <button onClick={manualPlayPending} data-testid="assistant-play-pending"
          className="mx-4 mb-2 px-4 py-3 bg-[#FF5C00] text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-lg animate-pulse">
          <Volume2 className="w-4 h-4" />
          Tik hier om het antwoord te horen
        </button>
      )}

      {/* Status-banner */}
      {statusBanner && (
        <div data-testid="assistant-status-banner"
          className={`px-4 py-2 text-xs font-medium border-t shrink-0 ${
            statusBanner.tone === 'listening' ? 'bg-red-50 text-red-700 border-red-100'
            : statusBanner.tone === 'thinking' ? 'bg-slate-50 text-slate-600 border-slate-200'
            : statusBanner.tone === 'speaking' ? 'bg-[#FF5C00]/10 text-[#FF5C00] border-[#FF5C00]/20'
            : 'bg-slate-50 text-slate-500 border-slate-200'
          }`}>
          <div className="flex items-center gap-2 max-w-3xl mx-auto">
            {statusBanner.tone === 'listening' && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />}
            {statusBanner.tone === 'thinking' && <Loader2 className="w-3 h-3 animate-spin" />}
            {statusBanner.tone === 'speaking' && <Volume2 className="w-3 h-3" />}
            <span className="truncate">{statusBanner.label}</span>
          </div>
        </div>
      )}

      {/* Input */}
      <footer className="bg-white border-t border-slate-200 p-3 shrink-0">
        <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex gap-2 max-w-3xl mx-auto">
          {voiceSupported && (
            <button type="button" onClick={toggleMic} data-testid="assistant-mic"
              disabled={transcribing || busy || speaking}
              className={`h-12 w-12 rounded-2xl flex items-center justify-center shrink-0 transition disabled:opacity-50 ${
                recording
                  ? 'bg-red-500 text-white animate-pulse shadow-lg shadow-red-300'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
              title={recording ? 'Stop opname' : 'Spreek in'}>
              {transcribing ? <Loader2 className="w-5 h-5 animate-spin" />
                : recording ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>
          )}
          <input type="text" value={input} onChange={(e) => setInput(e.target.value)}
            placeholder={recording ? 'Luistert…' : transcribing ? 'Transcriberen…' : 'Typ je vraag of opdracht…'}
            disabled={busy}
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
