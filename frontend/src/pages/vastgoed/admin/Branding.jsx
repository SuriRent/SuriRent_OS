import { useState, useEffect, useCallback, useRef } from 'react';
import { Palette, Save, Loader2, Upload, Check, AlertCircle, Eye, RotateCcw, Building2, Mail, Phone, MapPin, Landmark } from 'lucide-react';
import { api, formatError } from '../../../lib/api';
import { resolveLogoUrl, applyBranding } from '../../../lib/branding';
import MyUrlCard from '../../../components/MyUrlCard';

const PRESET_COLORS = [
  '#FF5C00', '#1e88e5', '#7c3aed', '#059669',
  '#dc2626', '#0ea5e9', '#ea580c', '#0f172a',
];

function ColorPicker({ value, onChange }) {
  return (
    <div className="space-y-2" data-testid="branding-color-picker">
      <div className="flex flex-wrap gap-2">
        {PRESET_COLORS.map((c) => (
          <button key={c} type="button" onClick={() => onChange(c)}
            data-testid={`branding-color-${c.replace('#', '')}`}
            title={c}
            className={`w-9 h-9 rounded-lg border-2 transition ${value?.toLowerCase() === c.toLowerCase() ? 'border-slate-900 scale-110' : 'border-white shadow'}`}
            style={{ backgroundColor: c }} />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input type="color" value={value || '#FF5C00'} onChange={(e) => onChange(e.target.value)}
          data-testid="branding-color-input"
          className="h-10 w-12 cursor-pointer rounded border border-slate-200" />
        <input type="text" value={value || ''} onChange={(e) => onChange(e.target.value)}
          placeholder="#FF5C00"
          data-testid="branding-color-hex"
          className="h-10 flex-1 px-3 border-2 border-slate-200 rounded-lg font-mono text-sm focus:border-slate-900 focus:outline-none" />
      </div>
    </div>
  );
}

// =====================================================================
// PDF template picker — 4 luxe kleurcombinaties voor kwitantie/factuur
// =====================================================================
const PDF_TEMPLATES = [
  { key: 'midnight_gold',  label: 'Midnight Gold',  dark: '#0B1F3A', gold: '#C9A24A', desc: 'Donkerblauw + goud' },
  { key: 'charcoal_gold',  label: 'Charcoal Gold',  dark: '#0F0F10', gold: '#C9A24A', desc: 'Zwart + goud' },
  { key: 'forest_gold',    label: 'Forest Gold',    dark: '#0F3B2E', gold: '#C9A24A', desc: 'Groen + goud' },
  { key: 'sunset_gold',    label: 'Sunset Gold',    dark: '#8A2B0F', gold: '#F0B34A', desc: 'Oranje + goud' },
];

function PdfTemplatePicker({ value, onChange }) {
  return (
    <div className="grid grid-cols-2 gap-2.5" data-testid="branding-pdf-template-picker">
      {PDF_TEMPLATES.map((tmpl) => {
        const active = value === tmpl.key;
        return (
          <button key={tmpl.key} type="button" onClick={() => onChange(tmpl.key)}
            data-testid={`pdf-template-${tmpl.key}`}
            className={`relative overflow-hidden rounded-xl border-2 text-left transition ${active ? 'border-slate-900 scale-[1.02] shadow-lg' : 'border-slate-200 hover:border-slate-300'}`}>
            {/* Mini kwitantie-preview */}
            <div className="h-16 relative" style={{ backgroundColor: tmpl.dark }}>
              <div className="absolute right-0 top-0 h-full w-16"
                style={{ background: `linear-gradient(135deg, transparent 40%, ${tmpl.gold} 40%)` }} />
              <div className="absolute bottom-0 inset-x-0 h-1" style={{ backgroundColor: tmpl.gold }} />
              <div className="px-2.5 py-2 text-white text-[10px] font-black tracking-wider">
                UW BEDRIJF
              </div>
            </div>
            <div className="bg-white px-3 py-2">
              <p className="text-xs font-black text-slate-900">{tmpl.label}</p>
              <p className="text-[10px] text-slate-500">{tmpl.desc}</p>
            </div>
            {active && (
              <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-slate-900 flex items-center justify-center">
                <Check className="w-3 h-3 text-white" />
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}


function PdfPreviewButton({ template, customDark }) {
  const [busy, setBusy] = useState(false);
  const openPreview = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const qs = new URLSearchParams();
      if (template) qs.set('template', template);
      if (customDark) qs.set('custom_dark', customDark);
      // Fetch als blob via axios (met auth-header) → open in nieuwe tab.
      // Kan niet gewoon window.open() gebruiken want die stuurt geen
      // Bearer-token mee → 401.
      const resp = await api.get(`/companies/me/branding/preview-pdf?${qs}`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(resp.data);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" onClick={openPreview} disabled={busy}
      data-testid="pdf-preview-btn"
      className="h-8 px-3 rounded-lg text-[11px] font-extrabold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 inline-flex items-center gap-1.5 shrink-0">
      {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />}
      Preview PDF
    </button>
  );
}


function LogoUploader({ value, onChange }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const handleFile = async (file) => {
    if (!file) return;
    setBusy(true); setErr('');
    try {
      const form = new FormData();
      form.append('file', file);
      const { data } = await api.post('/companies/me/branding/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onChange(data.url);
    } catch (e) { setErr(formatError(e)); }
    finally { setBusy(false); }
  };
  const preview = resolveLogoUrl(value);
  return (
    <div data-testid="branding-logo">
      {preview && (
        <div className="mb-2 flex items-center gap-2">
          <img src={preview} alt="logo preview" className="w-20 h-20 object-contain rounded-lg border border-slate-200 bg-white p-2" />
          <button type="button" onClick={() => onChange('')}
            data-testid="branding-logo-clear"
            className="text-xs text-rose-600 font-semibold hover:underline">verwijderen</button>
        </div>
      )}
      <label className="block">
        <span className="block w-full h-10 rounded-lg border-2 border-dashed border-slate-300 hover:border-slate-900 hover:bg-slate-50 flex items-center justify-center gap-1.5 text-xs font-bold text-slate-700 cursor-pointer">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          {busy ? 'Uploaden...' : 'Upload logo (max 5 MB)'}
        </span>
        <input type="file" accept="image/*" className="hidden"
          data-testid="branding-logo-file"
          onChange={(e) => handleFile(e.target.files?.[0])} />
      </label>
      {err && <p className="text-[11px] text-rose-600 mt-1">{err}</p>}
    </div>
  );
}

export default function Branding() {
  const [b, setB] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/companies/me/branding');
      setB(data);
    } catch (e) { setErr(formatError(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const upd = (k, v) => setB((prev) => ({ ...prev, [k]: v }));

  const save = async () => {
    setSaving(true); setErr(''); setMsg('');
    try {
      // Branding-only: logo / kleur / app_name / tagline. Bedrijfsgegevens
      // (naam, contact, bank, wallets) worden onder Account → Bedrijfsgegevens
      // beheerd zodat het visueel duidelijk gescheiden is.
      const { data } = await api.put('/companies/me/branding', {
        app_name: b.app_name || '',
        primary_color: b.primary_color || '',
        logo_url: b.logo_url || '',
        tagline: b.tagline || '',
        pdf_template: b.pdf_template || 'midnight_gold',
        pdf_custom_dark: b.pdf_custom_dark || '',
      });
      setB((prev) => ({ ...prev, ...data }));
      applyBranding(data);
      setMsg('Branding opgeslagen.');
      setTimeout(() => setMsg(''), 4000);
    } catch (e) { setErr(formatError(e)); }
    finally { setSaving(false); }
  };

  if (loading || !b) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-slate-900" /></div>;
  }

  const previewColor = b.primary_color || '#FF5C00';
  const loginUrl = `/login?c=${encodeURIComponent(b.slug || '')}`;

  return (
    <div className="space-y-4" data-testid="branding-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
            <Palette className="w-5 h-5" /> Branding
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">Logo, kleur en naam die uw klanten zien bij login en in de PWA.</p>
        </div>
        <div className="flex items-center gap-2">
          <a href={loginUrl} target="_blank" rel="noreferrer"
            data-testid="branding-preview-link"
            className="h-10 px-3 rounded-lg text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 inline-flex items-center gap-1.5">
            <Eye className="w-3.5 h-3.5" /> Preview login
          </a>
          <button type="button" onClick={save} disabled={saving}
            data-testid="branding-save"
            className="h-10 px-4 rounded-lg text-xs font-extrabold text-white inline-flex items-center gap-1.5 disabled:opacity-60"
            style={{ backgroundColor: previewColor }}>
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Opslaan
          </button>
        </div>
      </div>

      {err && <div className="bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold rounded-lg p-3 flex items-center gap-2"><AlertCircle className="w-4 h-4" />{err}</div>}
      {msg && <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold rounded-lg p-3 flex items-center gap-2"><Check className="w-4 h-4" />{msg}</div>}

      <MyUrlCard />

      <div className="grid md:grid-cols-2 gap-4">
        {/* LEFT: form */}
        <div className="space-y-3">
          <div className="bg-sky-50 border border-sky-200 rounded-2xl p-3">
            <p className="text-xs text-sky-800 leading-relaxed">
              <strong>Tip:</strong> Bedrijfsnaam, contact en bankrekeningen kun je
              nu beheren onder <strong>Account → Bedrijfsgegevens</strong>.
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-4">
            <h3 className="text-sm font-extrabold text-slate-900 mb-3">Logo</h3>
            <LogoUploader value={b.logo_url} onChange={(v) => upd('logo_url', v)} />
            <p className="text-[11px] text-slate-400 mt-2">PNG/SVG met transparante achtergrond werkt het beste. Maximaal 5 MB.</p>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-4">
            <h3 className="text-sm font-extrabold text-slate-900 mb-3">Primaire kleur</h3>
            <ColorPicker value={b.primary_color} onChange={(v) => upd('primary_color', v)} />
            <p className="text-[11px] text-slate-400 mt-2">Wordt gebruikt voor knoppen en accenten op uw eigen login-pagina.</p>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-4">
            <h3 className="text-sm font-extrabold text-slate-900 mb-3">Naam & tagline</h3>
            <label className="block mb-3">
              <span className="block text-xs font-bold text-slate-700 mb-1">App naam</span>
              <input type="text" value={b.app_name || ''} onChange={(e) => upd('app_name', e.target.value)}
                placeholder={b.name || 'Uw bedrijfsnaam'}
                data-testid="branding-app-name"
                className="w-full h-10 px-3 border-2 border-slate-200 rounded-lg text-sm focus:border-slate-900 focus:outline-none" />
              <p className="text-[11px] text-slate-400 mt-1">Verschijnt boven het PIN-veld op de login-pagina.</p>
            </label>
            <label className="block">
              <span className="block text-xs font-bold text-slate-700 mb-1">Tagline (optioneel)</span>
              <input type="text" value={b.tagline || ''} onChange={(e) => upd('tagline', e.target.value)}
                placeholder="bv. Beheer & Kiosk toegang"
                data-testid="branding-tagline"
                className="w-full h-10 px-3 border-2 border-slate-200 rounded-lg text-sm focus:border-slate-900 focus:outline-none" />
            </label>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-4">
            <div className="flex items-start justify-between gap-2 mb-1">
              <div>
                <h3 className="text-sm font-extrabold text-slate-900">Kwitantie & Factuur sjabloon</h3>
                <p className="text-[11px] text-slate-500">Kies de kleuren van uw PDF-kwitanties en facturen — dark + goud accenten.</p>
              </div>
              <PdfPreviewButton template={b.pdf_template || 'midnight_gold'} customDark={b.pdf_custom_dark || ''} />
            </div>
            <div className="mt-3">
              <PdfTemplatePicker value={b.pdf_template || 'midnight_gold'} onChange={(v) => upd('pdf_template', v)} />
            </div>
            <div className="mt-4 pt-3 border-t border-slate-100">
              <label className="block">
                <span className="block text-xs font-bold text-slate-700 mb-1">Custom hoofdkleur (optioneel)</span>
                <div className="flex items-center gap-2">
                  <input type="color" value={b.pdf_custom_dark || '#0B1F3A'}
                    onChange={(e) => upd('pdf_custom_dark', e.target.value)}
                    data-testid="pdf-custom-dark-picker"
                    className="h-10 w-12 cursor-pointer rounded border border-slate-200" />
                  <input type="text" value={b.pdf_custom_dark || ''}
                    onChange={(e) => upd('pdf_custom_dark', e.target.value)}
                    placeholder="Laat leeg voor standaard sjabloon-kleur"
                    data-testid="pdf-custom-dark-hex"
                    className="h-10 flex-1 px-3 border-2 border-slate-200 rounded-lg font-mono text-xs focus:border-slate-900 focus:outline-none" />
                  {b.pdf_custom_dark && (
                    <button type="button" onClick={() => upd('pdf_custom_dark', '')}
                      className="h-10 px-3 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold">
                      Wissen
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 mt-1">Overschrijft de dark-kleur van het gekozen sjabloon. Goud blijft goud.</p>
              </label>
            </div>
          </div>

          <LandlordSignatureSection value={b.landlord_signature_url} signedAt={b.landlord_signature_signed_at} onReload={load} />
        </div>

        {/* RIGHT: live preview */}
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-widest font-extrabold text-slate-500">Live preview</p>
          <div className="rounded-3xl overflow-hidden border-2 border-slate-200 shadow-2xl" data-testid="branding-preview">
            <div className="w-full h-32 flex items-center px-6 gap-3"
              style={{ background: `linear-gradient(135deg, ${previewColor} 0%, ${previewColor}DD 100%)` }}>
              {b.logo_url ? (
                <img src={resolveLogoUrl(b.logo_url)} alt="logo" className="w-14 h-14 rounded-xl bg-white p-2 object-contain" />
              ) : (
                <div className="w-14 h-14 rounded-xl bg-white/95 flex items-center justify-center text-2xl font-black"
                  style={{ color: previewColor }}>
                  {(b.app_name || b.name || '?').charAt(0).toUpperCase()}
                </div>
              )}
              <div className="text-white">
                <p className="text-lg font-black tracking-tight">{b.app_name || b.name || 'Uw bedrijf'}</p>
                <p className="text-xs opacity-90">{b.tagline || 'Beheer & Kiosk toegang'}</p>
              </div>
            </div>
            <div className="bg-white p-6 text-center">
              <h3 className="text-base font-black text-slate-900 mb-1">Welkom bij {b.app_name || b.name || 'Kiosk'}</h3>
              <p className="text-xs text-slate-500 mb-4">Voer uw PIN code in om te beginnen</p>
              <div className="flex justify-center gap-2 mb-4">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="w-9 h-9 border-2 border-slate-200 rounded-lg" />
                ))}
              </div>
              <button type="button" className="w-full h-10 rounded-lg text-sm font-black text-white"
                style={{ backgroundColor: previewColor }}>
                Inloggen
              </button>
            </div>
          </div>
          <p className="text-[11px] text-slate-400 text-center">Dit is wat klanten zien op {(typeof window !== 'undefined' ? window.location.origin : '')}/login?c={b.slug}</p>

          <EmailPreview brandName={b.app_name || b.name} brandColor={previewColor} logoUrl={b.logo_url} />
        </div>
      </div>
    </div>
  );
}

// ============== Email white-label preview ==============
// Live iframe-preview van hoe een tenant-email eruit ziet met de huidige
// brand-instellingen. Debounced fetch naar /api/settings/email/preview zodat
// we niet bij elke keystroke een backend call doen.
function EmailPreview({ brandName, brandColor, logoUrl }) {
  const [html, setHtml] = useState('');
  const [kind, setKind] = useState('kwitantie');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const debRef = useRef(null);

  const fetchPreview = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const { data } = await api.post('/settings/email/preview', {
        brand_name: brandName || undefined,
        brand_color: brandColor || undefined,
        logo_url: logoUrl || '',
        kind,
      });
      setHtml(data.html || '');
    } catch (e) { setErr(formatError(e)); }
    finally { setLoading(false); }
  }, [brandName, brandColor, logoUrl, kind]);

  // Debounced live-update wanneer branding-inputs wijzigen.
  useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current);
    debRef.current = setTimeout(fetchPreview, 350);
    return () => { if (debRef.current) clearTimeout(debRef.current); };
  }, [fetchPreview]);

  const KINDS = [
    { id: 'kwitantie', label: 'Kwitantie' },
    { id: 'factuur', label: 'Factuur' },
    { id: 'contract', label: 'Contract' },
    { id: 'herinnering', label: 'Herinnering' },
  ];

  return (
    <div className="mt-4 space-y-2" data-testid="branding-email-preview">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-widest font-extrabold text-slate-500 flex items-center gap-1.5">
          <Mail className="w-3.5 h-3.5" /> Email preview (white-label)
        </p>
        <div className="flex gap-1">
          {KINDS.map((k) => (
            <button key={k.id} type="button" onClick={() => setKind(k.id)}
              data-testid={`branding-email-kind-${k.id}`}
              className={`h-7 px-2.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider transition ${kind === k.id ? 'text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              style={kind === k.id ? { backgroundColor: brandColor || '#FF5C00' } : {}}>
              {k.label}
            </button>
          ))}
        </div>
      </div>
      <div className="rounded-3xl overflow-hidden border-2 border-slate-200 shadow-2xl bg-slate-100 relative" style={{ minHeight: 420 }}>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/60 backdrop-blur-sm z-10">
            <Loader2 className="w-6 h-6 animate-spin text-slate-600" />
          </div>
        )}
        {err ? (
          <div className="p-4 text-xs text-rose-700 bg-rose-50 flex items-center gap-2"><AlertCircle className="w-4 h-4" />{err}</div>
        ) : (
          <iframe
            title="Email preview"
            data-testid="branding-email-iframe"
            srcDoc={html}
            className="w-full block border-0 bg-white"
            style={{ height: 480 }}
            sandbox=""
          />
        )}
      </div>
      <p className="text-[11px] text-slate-400 text-center">
        Zo ontvangen uw huurders {kind === 'kwitantie' ? 'een kwitantie' : kind === 'factuur' ? 'een factuur' : kind === 'contract' ? 'hun huurcontract' : 'een betalingsherinnering'} —
        geen enkele SuriRent branding.
      </p>
    </div>
  );
}

// Quiet unused-import lint flag
void RotateCcw;

// =====================================================================
// LandlordSignatureSection — Verhuurder-handtekening tekenen of uploaden.
// Wordt inline op elk contract PDF gerenderd bij "Verhuurder → Handtekening".
// =====================================================================
function LandlordSignatureSection({ value, signedAt, onReload }) {
  const canvasRef = useRef(null);
  const [drawing, setDrawing] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  const [saving, setSaving] = useState(false);
  const [redraw, setRedraw] = useState(false);
  const [err, setErr] = useState('');
  const src = value ? resolveLogoUrl(value) : '';

  useEffect(() => {
    if (value && !redraw) return;   // canvas niet zichtbaar in bekijk-modus
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    setHasInk(false);
  }, [value, redraw]);

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

  const uploadBlob = async (blob, filename = 'landlord-signature.png') => {
    setSaving(true); setErr('');
    try {
      const fd = new FormData(); fd.append('file', blob, filename);
      await api.post('/companies/me/landlord-signature', fd,
        { headers: { 'Content-Type': 'multipart/form-data' } });
      setRedraw(false);
      setHasInk(false);
      if (onReload) await onReload();
    } catch (e) { setErr(formatError(e)); }
    finally { setSaving(false); }
  };

  const save = async () => {
    if (!hasInk) return;
    const blob = await new Promise((res) => canvasRef.current.toBlob(res, 'image/png'));
    await uploadBlob(blob);
  };

  const uploadFile = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return setErr('Alleen afbeeldingen toegestaan.');
    await uploadBlob(file, file.name);
  };

  const remove = async () => {
    if (!window.confirm('Verhuurder-handtekening verwijderen?')) return;
    setSaving(true); setErr('');
    try {
      await api.delete('/companies/me/landlord-signature');
      if (onReload) await onReload();
    } catch (e) { setErr(formatError(e)); }
    finally { setSaving(false); }
  };

  const showCanvas = !value || redraw;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4" data-testid="landlord-signature-section">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-extrabold text-slate-900">Verhuurder handtekening</h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {value ? `Ondertekend op ${(signedAt || '').slice(0, 10)}` : 'Teken of upload één keer — komt automatisch op elk contract'}
          </p>
        </div>
        {value && !redraw && (
          <button type="button" onClick={remove} data-testid="landlord-signature-remove"
            className="h-8 px-2.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 font-bold text-[11px]">
            Wissen
          </button>
        )}
      </div>

      {err && <p className="text-[11px] text-rose-600 mb-2" data-testid="landlord-signature-err">{err}</p>}

      {showCanvas ? (
        <>
          <div className="rounded-xl border-2 border-dashed border-slate-300 overflow-hidden bg-white">
            <canvas ref={canvasRef} width={600} height={180}
              className="w-full h-40 touch-none"
              onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
              onTouchStart={start} onTouchMove={move} onTouchEnd={end}
              data-testid="landlord-signature-canvas" />
          </div>
          <div className="flex gap-2 mt-3">
            <button type="button" onClick={clearCanvas} disabled={!hasInk}
              data-testid="landlord-signature-clear"
              className="flex-1 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm disabled:opacity-50">
              Wis
            </button>
            <button type="button" onClick={save} disabled={!hasInk || saving}
              data-testid="landlord-signature-save"
              className="flex-1 h-10 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm disabled:opacity-50 flex items-center justify-center gap-1.5">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              Opslaan
            </button>
          </div>
          <label className="mt-3 block w-full h-10 rounded-lg border-2 border-dashed border-slate-300 hover:border-slate-900 hover:bg-slate-50 flex items-center justify-center gap-1.5 text-xs font-bold text-slate-700 cursor-pointer"
            data-testid="landlord-signature-upload">
            <Upload className="w-4 h-4" /> Of upload een afbeelding (PNG)
            <input type="file" accept="image/*" className="hidden"
              onChange={(e) => uploadFile(e.target.files?.[0])}
              data-testid="landlord-signature-file" />
          </label>
        </>
      ) : (
        <>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <img src={src} alt="Verhuurder handtekening" className="w-full max-h-32 object-contain" data-testid="landlord-signature-image" />
          </div>
          <div className="flex gap-2 mt-3">
            <button type="button" onClick={() => setRedraw(true)}
              data-testid="landlord-signature-redraw"
              className="flex-1 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm">
              Opnieuw tekenen
            </button>
            <a href={`${process.env.REACT_APP_BACKEND_URL}/api/companies/me/landlord-signature/preview.pdf`}
              target="_blank" rel="noreferrer"
              data-testid="landlord-signature-preview-pdf"
              className="flex-1 h-10 rounded-xl bg-orange-50 hover:bg-orange-100 text-[#FF5C00] font-bold text-sm flex items-center justify-center gap-1.5">
              <Eye className="w-3.5 h-3.5" /> Bekijk op contract
            </a>
          </div>
        </>
      )}
    </div>
  );
}
