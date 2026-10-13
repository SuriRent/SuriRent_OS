import { useCallback, useEffect, useRef, useState } from 'react';
import { Smartphone, Upload, Loader2, Trash2, Download, AlertCircle } from 'lucide-react';
import { api, formatError } from '../../../lib/api';

export const fmtSize = (b) => `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
const fmtDate = (s) => new Date(s).toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Eén stuk met tot 3 herpogingen (mobiel netwerk kan even haperen).
async function putChunk(url, blob) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await api.put(url, blob, { headers: { 'Content-Type': 'application/octet-stream' }, timeout: 120000 });
    } catch (e) {
      if (attempt >= 3 || (e?.response && e.response.status < 500)) throw e;
      await sleep(1500 * (attempt + 1));
    }
  }
}

function UploadForm({ onDone }) {
  const [file, setFile] = useState(null);
  const [version, setVersion] = useState('');
  const [notes, setNotes] = useState('');
  const [progress, setProgress] = useState(null);
  const [err, setErr] = useState('');
  const [stage, setStage] = useState('');
  const inputRef = useRef(null);

  const upload = async () => {
    setErr(''); setProgress(0);
    try {
      const { data: init } = await api.post('/superadmin/apk/upload/init', { filename: file.name, size: file.size, version, notes });
      const cs = init.chunk_size;
      const total = Math.ceil(file.size / cs);
      for (let i = 0; i < total; i += 1) {
        const blob = file.slice(i * cs, (i + 1) * cs);
        await putChunk(`/superadmin/apk/upload/${init.upload_id}/chunk/${i}`, blob);
        setProgress(Math.round(((i + 1) / total) * 90));
      }
      await api.post(`/superadmin/apk/upload/${init.upload_id}/complete`);
      setStage('Opslaan…');
      for (;;) {
        await sleep(2000);
        const { data: st } = await api.get(`/superadmin/apk/upload/${init.upload_id}/status`);
        if (st.state === 'done') break;
        if (st.state === 'error') throw new Error(st.error || 'Opslaan mislukt');
      }
      setProgress(100);
      setFile(null); setVersion(''); setNotes('');
      if (inputRef.current) inputRef.current.value = '';
      onDone();
    } catch (e) { setErr(e?.response ? formatError(e) : (e?.message || 'Upload mislukt')); }
    finally { setStage(''); setTimeout(() => setProgress(null), 800); }
  };

  const busy = progress !== null;
  return (
    <div className="space-y-3">
      <input ref={inputRef} type="file" accept=".apk,application/vnd.android.package-archive" disabled={busy}
        onChange={(e) => setFile(e.target.files?.[0] || null)} data-testid="apk-file-input"
        className="block w-full text-sm text-slate-600 file:mr-3 file:h-10 file:px-4 file:rounded-xl file:border-0 file:bg-orange-50 file:text-orange-700 file:font-bold" />
      <div className="grid sm:grid-cols-3 gap-3">
        <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="Versie, bijv. 1.2.0" disabled={busy}
          data-testid="apk-version-input" className="h-11 px-3 rounded-xl border border-slate-200 text-sm focus:border-orange-400 outline-none" />
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notities (optioneel)" disabled={busy}
          data-testid="apk-notes-input" className="sm:col-span-2 h-11 px-3 rounded-xl border border-slate-200 text-sm focus:border-orange-400 outline-none" />
      </div>
      {busy && (
        <div className="h-2 rounded-full bg-slate-100 overflow-hidden" data-testid="apk-upload-progress">
          <div className="h-full bg-[#FF5C00] transition-[width] duration-300" style={{ width: `${progress}%` }} />
        </div>
      )}
      {err && <p className="text-sm text-red-600 flex items-center gap-1.5" data-testid="apk-upload-error"><AlertCircle className="w-4 h-4" />{err}</p>}
      <button type="button" onClick={upload} disabled={!file || !version.trim() || busy} data-testid="apk-upload-btn"
        className="w-full h-11 rounded-xl bg-[#FF5C00] hover:bg-[#e65300] text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50 transition-colors">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
        {busy ? (stage || `Uploaden… ${progress}%`) : file ? `Upload ${file.name} (${fmtSize(file.size)})` : 'Kies eerst een .apk bestand'}
      </button>
    </div>
  );
}

function ReleaseRow({ r, active, onDelete }) {
  return (
    <li className="flex items-center gap-3 py-3" data-testid={`apk-release-${r.id}`}>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-slate-900 text-sm">
          v{r.version} {active && <span className="ml-1 text-[10px] font-black uppercase tracking-wider text-emerald-600 bg-emerald-50 rounded px-1.5 py-0.5">Actief</span>}
        </p>
        <p className="text-xs text-slate-500 truncate">{fmtSize(r.size)} · {fmtDate(r.created_at)} · {r.downloads || 0} downloads{r.notes ? ` · ${r.notes}` : ''}</p>
      </div>
      <button type="button" onClick={() => onDelete(r)} data-testid={`apk-delete-${r.id}`} title="Verwijderen"
        className="h-9 w-9 rounded-lg border border-slate-200 text-red-500 hover:bg-red-50 flex items-center justify-center transition-colors">
        <Trash2 className="w-4 h-4" />
      </button>
    </li>
  );
}

export default function ApkReleases() {
  const [list, setList] = useState(null);
  const load = useCallback(() => api.get('/superadmin/apk').then(({ data }) => setList(data)).catch(() => setList([])), []);
  useEffect(() => { load(); }, [load]);

  const onDelete = async (r) => {
    if (!window.confirm(`Versie ${r.version} verwijderen? Deze is daarna niet meer te downloaden.`)) return;
    try { await api.delete(`/superadmin/apk/${r.id}`); load(); } catch (e) { window.alert(formatError(e)); }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden lg:col-span-2" data-testid="apk-releases-section">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-emerald-100 text-emerald-600"><Smartphone className="w-5 h-5" /></div>
        <div className="flex-1">
          <h3 className="text-base font-extrabold text-slate-900">Android-app (APK)</h3>
          <p className="text-xs text-slate-500">De nieuwste versie is te downloaden via de knop op de landingspagina.</p>
        </div>
        {list?.length > 0 && (
          <a href={`${process.env.REACT_APP_BACKEND_URL}/api/public/apk/download`} data-testid="apk-download-link"
            className="hidden sm:inline-flex items-center gap-1.5 text-sm font-bold text-emerald-700 hover:underline"><Download className="w-4 h-4" /> Download</a>
        )}
      </div>
      <div className="p-5 space-y-4">
        <UploadForm onDone={load} />
        {list === null ? <Loader2 className="w-4 h-4 animate-spin text-slate-400" /> : list.length === 0 ? (
          <p className="text-sm text-slate-400" data-testid="apk-empty">Nog geen APK geüpload — de downloadknop is verborgen.</p>
        ) : (
          <ul className="divide-y divide-slate-100">{list.map((r, i) => <ReleaseRow key={r.id} r={r} active={i === 0} onDelete={onDelete} />)}</ul>
        )}
      </div>
    </div>
  );
}
