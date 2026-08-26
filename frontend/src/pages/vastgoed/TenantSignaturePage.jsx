import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Check, Loader2, PenTool, ShieldCheck } from 'lucide-react';
import { api, formatError } from '../../lib/api';

// Publieke pagina waar een huurder zijn handtekening plaatst via een
// tijdelijke link (24u geldig, éénmalig te gebruiken). Wit-labeled met
// de branding van het bedrijf dat de link verstuurde — geen SuriRent.
export default function TenantSignaturePage() {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [drawing, setDrawing] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const canvasRef = useRef(null);

  useEffect(() => {
    document.title = 'Handtekening plaatsen';
    api.get(`/public/signature-request/${token}`)
      .then((r) => setInfo(r.data))
      .catch((e) => setError(formatError(e, 'Link ongeldig of verlopen')))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    if (!info || done) return;
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, [info, done]);

  const pos = (e) => {
    const c = canvasRef.current;
    const r = c.getBoundingClientRect();
    const evt = e.touches?.[0] || e;
    return { x: (evt.clientX - r.left) * (c.width / r.width),
             y: (evt.clientY - r.top) * (c.height / r.height) };
  };
  const start = (e) => { e.preventDefault(); const { x, y } = pos(e); const ctx = canvasRef.current.getContext('2d'); ctx.beginPath(); ctx.moveTo(x, y); setDrawing(true); };
  const move = (e) => { if (!drawing) return; e.preventDefault(); const { x, y } = pos(e); const ctx = canvasRef.current.getContext('2d'); ctx.lineTo(x, y); ctx.stroke(); setHasInk(true); };
  const end = () => setDrawing(false);
  const clearCanvas = () => {
    const c = canvasRef.current;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
    setHasInk(false);
  };
  const submit = async () => {
    if (!hasInk) return;
    setSaving(true); setError('');
    try {
      const blob = await new Promise((res) => canvasRef.current.toBlob(res, 'image/png'));
      const fd = new FormData(); fd.append('file', blob, 'signature.png');
      await api.post(`/public/signature-request/${token}`, fd,
        { headers: { 'Content-Type': 'multipart/form-data' } });
      setDone(true);
    } catch (e) { setError(formatError(e, 'Handtekening kon niet worden opgeslagen')); }
    finally { setSaving(false); }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-slate-500 animate-spin" />
      </div>
    );
  }
  if (error && !info) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-3xl shadow-xl p-8 max-w-md text-center" data-testid="tenant-sign-error">
          <p className="text-lg font-black text-red-600 mb-2">Link ongeldig</p>
          <p className="text-sm text-slate-500">{error}</p>
        </div>
      </div>
    );
  }

  const color = info.brand_color || '#FF5C00';

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ backgroundColor: `${color}12` }}>
        <div className="bg-white rounded-3xl shadow-xl p-10 max-w-md text-center" data-testid="tenant-sign-done">
          <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ backgroundColor: color }}>
            <Check className="w-9 h-9 text-white" strokeWidth={3} />
          </div>
          <h1 className="text-xl font-black text-slate-900 mb-2">Bedankt!</h1>
          <p className="text-sm text-slate-600">Uw handtekening is ontvangen door {info.brand_name}. U kunt dit venster nu sluiten.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 sm:p-6" style={{ backgroundColor: `${color}12` }} data-testid="tenant-sign-page">
      <div className="max-w-lg mx-auto">
        <div className="flex items-center gap-3 mb-4 px-1">
          {info.logo_url ? (
            <img loading="lazy" src={info.logo_url} alt={info.brand_name} className="h-10 max-w-[140px] object-contain" />
          ) : (
            <div className="h-10 px-4 rounded-xl text-white font-black flex items-center" style={{ backgroundColor: color }}>
              {info.brand_name}
            </div>
          )}
        </div>

        <div className="bg-white rounded-3xl shadow-xl overflow-hidden">
          <div className="p-6 border-b border-slate-100">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-400 mb-2">
              <PenTool className="w-3.5 h-3.5" /> Digitale handtekening
            </div>
            <h1 className="text-xl font-black text-slate-900">Hallo {info.tenant_name}</h1>
            <p className="text-sm text-slate-600 mt-1">{info.brand_name} vraagt u om uw handtekening. Teken hieronder met uw vinger of muis.</p>
          </div>

          <div className="p-5 space-y-4">
            <div className="rounded-xl border-2 border-dashed border-slate-300 overflow-hidden bg-white">
              <canvas ref={canvasRef} width={600} height={260}
                className="w-full h-56 touch-none"
                onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
                onTouchStart={start} onTouchMove={move} onTouchEnd={end}
                data-testid="tenant-sign-canvas" />
            </div>

            {error && <p className="text-sm text-red-600 font-bold" data-testid="tenant-sign-err">{error}</p>}

            <div className="flex gap-2">
              <button onClick={clearCanvas} disabled={!hasInk}
                data-testid="tenant-sign-clear"
                className="flex-1 h-12 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm disabled:opacity-50">
                Wis
              </button>
              <button onClick={submit} disabled={!hasInk || saving}
                data-testid="tenant-sign-submit"
                className="flex-1 h-12 rounded-xl text-white font-black text-sm disabled:opacity-50 flex items-center justify-center gap-1.5"
                style={{ backgroundColor: color }}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Ondertekenen
              </button>
            </div>

            <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-400 pt-2">
              <ShieldCheck className="w-3.5 h-3.5" /> Veilige link · 24u geldig · éénmalig te gebruiken
            </div>
          </div>
        </div>

        <p className="text-[11px] text-slate-400 text-center mt-4">Aangeboden door {info.brand_name}</p>
      </div>
    </div>
  );
}
