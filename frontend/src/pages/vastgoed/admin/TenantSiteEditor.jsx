// Marketing website-editor voor tenants (Kiosk beheer → Instellingen → Marketing website).
// Toont de echte website in een iframe (/landing-preview?edit=1) in een donkere
// builder-stijl: linker zijbalk met tabs, bovenbalk met Opgeslagen / Voorbeeld /
// Publiceren en apparaat-schakelaar. Patches uit de iframe worden als concept
// bewaard (autosave); Publiceren zet het concept live.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft, Type, Image as ImageIcon, Settings, Layers, Smartphone, Tablet, Monitor,
  Loader2, Upload, Undo2, ExternalLink, Globe, Check, LayoutTemplate,
} from 'lucide-react';
import { api, formatError } from '../../../lib/api';
import { setPath } from '../../../lib/landing-editable';

const DEVICES = [
  { id: 'mobile', icon: Smartphone, w: 390 },
  { id: 'tablet', icon: Tablet, w: 820 },
  { id: 'desktop', icon: Monitor, w: '100%' },
];

const GROUPS = {
  logo_url: 'Algemeen', brand_name: 'Algemeen', header_cta: 'Algemeen',
  hero: 'Hoofdbanner', types: 'Kies een type', aanbod: 'Aanbod', about: 'Over ons', contact: 'Contact', footer: 'Voettekst',
};

const SECTIONS = [
  { id: 'hero', label: 'Hoofdbanner', scroll: 'hero.title_line1' },
  { id: 'aanbod', label: 'Aanbod', scroll: 'aanbod.title' },
  { id: 'types', label: 'Kies een type', scroll: 'types.title' },
  { id: 'about', label: 'Over ons', scroll: 'about.title' },
  { id: 'contact', label: 'Contact', scroll: 'contact.title' },
];

const TEMPLATES = [
  { id: 'homeland', name: 'Homeland', desc: 'Licht, foto rechts, zoekkaart.', bg: 'from-orange-50 to-white', dark: false },
  { id: 'modern', name: 'Modern', desc: 'Grote foto-banner, donkere accenten.', bg: 'from-slate-800 to-slate-950', dark: true },
  { id: 'minimal', name: 'Minimal', desc: 'Strak en wit, brede foto onder de titel.', bg: 'from-white to-slate-100', dark: false },
];

const prettify = (path) => {
  const last = path.split('.').slice(-1)[0].replace(/_/g, ' ');
  return last.charAt(0).toUpperCase() + last.slice(1);
};

export default function TenantSiteEditor({ onClose }) {
  const iframeRef = useRef(null);
  const fileRef = useRef(null);
  const imgPathRef = useRef('');
  const [draft, setDraft] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [hasUnpublished, setHasUnpublished] = useState(false);
  const [ready, setReady] = useState(false);
  const [fields, setFields] = useState([]);
  const [tab, setTab] = useState('content');
  const [device, setDevice] = useState('desktop');
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');
  const [site, setSite] = useState({ marketing_url: null, login_url: null, slug: '' });

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2200); };

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/companies/me/landing', { params: { mode: 'draft' } });
      setDraft(data.content || {});
      setHasUnpublished(!!data.has_unpublished_changes);
      setDirty(false);
    } catch (e) { setErr(formatError(e, 'Kon concept niet laden.')); }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    (async () => {
      try {
        const me = (await api.get('/auth/me')).data;
        const slug = me?.active_company?.slug || '';
        const pub = slug ? (await api.get(`/public/company-landing/by-slug/${encodeURIComponent(slug)}`)).data : {};
        setSite({ slug, marketing_url: null, login_url: null, ...(pub || {}) });
        const st = (await api.get('/settings')).data;
        const dom = st?.domain || {};
        setSite((s) => ({
          ...s,
          marketing_url: dom.marketing_enabled && dom.marketing_domain ? `https://${dom.marketing_domain}` : null,
          login_url: dom.enabled && dom.custom_domain ? `https://${dom.custom_domain}` : null,
        }));
      } catch { /* optioneel */ }
    })();
  }, []);

  const post = useCallback((msg) => {
    try { iframeRef.current?.contentWindow?.postMessage(msg, window.location.origin); } catch { /* noop */ }
  }, []);

  // Berichten uit de iframe
  useEffect(() => {
    const onMsg = (ev) => {
      const d = ev?.data;
      if (ev.origin !== window.location.origin || ev.source !== iframeRef.current?.contentWindow
        || !d || typeof d !== 'object') return;
      if (d.type === 'landing-edit-ready') setReady(true);
      else if (d.type === 'landing-edit-register' && d.path) {
        setFields((prev) => [
          ...prev.filter((f) => f.path !== d.path),
          { path: d.path, kind: d.kind === 'image' ? 'image' : 'text', value: d.value == null ? '' : String(d.value) },
        ]);
      } else if (d.type === 'landing-edit-patch' && d.path) {
        setDraft((prev) => setPath(prev || {}, d.path, d.value));
        setDirty(true);
      } else if (d.type === 'landing-edit-image-request' && d.path) {
        imgPathRef.current = d.path;
        fileRef.current?.click();
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  useEffect(() => {
    if (ready && draft) post({ type: 'landing-edit-reset', content: draft });
  }, [ready, draft, post]);

  const save = useCallback(async () => {
    if (!draft) return false;
    setSaving(true); setErr('');
    try {
      await api.put('/companies/me/landing', { content: draft });
      setDirty(false); setHasUnpublished(true);
      return true;
    } catch (e) { setErr(formatError(e, 'Opslaan mislukt')); return false; }
    finally { setSaving(false); }
  }, [draft]);

  useEffect(() => {
    if (!dirty) return undefined;
    const t = setTimeout(save, 1500);
    return () => clearTimeout(t);
  }, [dirty, save]);

  const publish = async () => {
    if (dirty && !(await save())) return;
    if (!window.confirm('Website publiceren? De wijzigingen zijn direct zichtbaar voor bezoekers.')) return;
    setPublishing(true); setErr('');
    try {
      await api.post('/companies/me/landing/publish');
      setHasUnpublished(false);
      flash('Gepubliceerd ✓');
    } catch (e) { setErr(formatError(e, 'Publiceren mislukt')); }
    finally { setPublishing(false); }
  };

  const discard = async () => {
    if (!window.confirm('Concept terugzetten naar de live versie?')) return;
    try {
      await api.post('/companies/me/landing/discard');
      await load();
      flash('Concept teruggezet');
    } catch (e) { setErr(formatError(e)); }
  };

  const update = (path, value) => {
    setDraft((prev) => setPath(prev || {}, path, value));
    setFields((prev) => prev.map((f) => (f.path === path ? { ...f, value } : f)));
    setDirty(true);
  };

  const upload = async (file) => {
    const path = imgPathRef.current;
    if (!file || !path) return;
    try {
      const form = new FormData();
      form.append('file', file);
      const { data } = await api.post('/companies/me/landing/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      update(path, data.url);
      flash('Afbeelding bijgewerkt ✓');
    } catch (e) { setErr(formatError(e, 'Upload mislukt')); }
    finally { if (fileRef.current) fileRef.current.value = ''; }
  };

  const grouped = useMemo(() => {
    const out = {};
    fields.forEach((f) => {
      const g = GROUPS[f.path.split('.')[0]] || 'Overig';
      (out[g] = out[g] || []).push(f);
    });
    return out;
  }, [fields]);

  const previewUrl = site.marketing_url || (site.slug ? `/site/${site.slug}` : null);
  const dev = DEVICES.find((d) => d.id === device) || DEVICES[2];

  const rail = [
    { id: 'templates', label: 'Templates', icon: LayoutTemplate },
    { id: 'content', label: 'Inhoud', icon: Type },
    { id: 'sections', label: 'Secties', icon: Layers },
    { id: 'settings', label: 'Instellingen', icon: Settings },
  ];

  const status = saving ? 'Opslaan…' : dirty ? 'Niet opgeslagen' : hasUnpublished ? 'Concept' : 'Opgeslagen';

  return createPortal(
    <div className="fixed inset-0 z-[400] flex flex-col bg-[#14161a] text-white" data-testid="tenant-site-editor">
      <input ref={fileRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => upload(e.target.files?.[0])} />

      <div className="h-14 shrink-0 flex items-center gap-3 px-3 sm:px-4 border-b border-white/10 bg-[#101215]">
        <button type="button" onClick={onClose} data-testid="site-editor-back"
          className="h-9 px-3 rounded-lg hover:bg-white/10 flex items-center gap-2 text-sm font-bold text-orange-400">
          <ArrowLeft className="w-4 h-4" /> <span className="hidden sm:inline">Terug naar kiosk</span>
        </button>
        <div className="hidden md:block w-px h-6 bg-white/15" />
        <p className="font-bold text-sm truncate">Marketing website</p>
        <span className={`text-[11px] font-black uppercase tracking-wider px-2 py-1 rounded ${
          dirty || saving ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/20 text-emerald-300'}`}>
          {status}
        </span>
        <div className="flex-1" />
        <div className="hidden sm:flex items-center gap-1 bg-black/30 rounded-lg p-1">
          {DEVICES.map((d) => {
            const I = d.icon;
            return (
              <button key={d.id} type="button" onClick={() => setDevice(d.id)} data-testid={`site-device-${d.id}`}
                className={`w-9 h-8 rounded-md flex items-center justify-center ${device === d.id ? 'bg-orange-500 text-white' : 'text-white/60 hover:text-white'}`}>
                <I className="w-4 h-4" />
              </button>
            );
          })}
        </div>
        <button type="button" onClick={discard} title="Concept terugzetten"
          className="h-9 w-9 rounded-lg hover:bg-white/10 flex items-center justify-center text-white/70">
          <Undo2 className="w-4 h-4" />
        </button>
        {previewUrl && (
          <a href={previewUrl} target="_blank" rel="noreferrer" data-testid="site-editor-preview"
            className="h-9 px-4 rounded-full bg-white/10 hover:bg-white/20 text-sm font-bold flex items-center gap-1.5">
            <ExternalLink className="w-4 h-4" /> <span className="hidden sm:inline">Voorbeeld</span>
          </a>
        )}
        <button type="button" onClick={publish} disabled={publishing || (!dirty && !hasUnpublished)}
          data-testid="site-editor-publish"
          className="h-9 px-5 rounded-full bg-[#FF5C00] hover:bg-[#e65300] text-white text-sm font-extrabold disabled:opacity-40 flex items-center gap-1.5">
          {publishing && <Loader2 className="w-4 h-4 animate-spin" />} Publiceren
        </button>
      </div>

      {err && (
        <div className="px-4 py-2 bg-red-500/20 text-red-200 text-sm flex items-center justify-between">
          {err}<button type="button" onClick={() => setErr('')} className="font-bold">×</button>
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col md:flex-row">
        <div className="md:w-[84px] shrink-0 flex md:flex-col gap-1 p-2 bg-[#101215] border-b md:border-b-0 md:border-r border-white/10">
          {rail.map((r) => {
            const I = r.icon;
            return (
              <button key={r.id} type="button" onClick={() => setTab(r.id)} data-testid={`site-tab-${r.id}`}
                className={`flex-1 md:flex-none md:h-[72px] rounded-xl flex flex-col items-center justify-center gap-1 text-[11px] font-bold py-2 ${
                  tab === r.id ? 'bg-orange-500/20 text-orange-300' : 'text-white/60 hover:bg-white/5'}`}>
                <I className="w-5 h-5" /> {r.label}
              </button>
            );
          })}
        </div>

        <div className="md:w-[340px] shrink-0 max-h-[38%] md:max-h-none overflow-y-auto bg-[#1b1e24] border-b md:border-b-0 md:border-r border-white/10 p-4 space-y-4">
          {tab === 'templates' && (
            <>
              <p className="text-xs text-white/50">Kies een ontwerp. Je teksten en foto's blijven behouden.</p>
              {TEMPLATES.map((t) => {
                const on = (draft?.template || 'homeland') === t.id;
                return (
                  <button key={t.id} type="button" onClick={() => update('template', t.id)} data-testid={`site-template-${t.id}`}
                    className={`w-full text-left rounded-xl overflow-hidden border-2 ${on ? 'border-orange-500' : 'border-white/10 hover:border-white/30'}`}>
                    <div className={`h-24 bg-gradient-to-br ${t.bg} p-3 flex flex-col gap-1.5`}>
                      <span className={`h-2 w-1/2 rounded ${t.dark ? 'bg-white/80' : 'bg-slate-800/70'}`} />
                      <span className="h-2 w-1/3 rounded bg-orange-500" />
                      <span className={`mt-auto h-6 rounded ${t.dark ? 'bg-white/15' : 'bg-white shadow'}`} />
                    </div>
                    <div className="p-3 bg-black/25">
                      <p className="text-sm font-extrabold flex items-center gap-2">{t.name}{on && <Check className="w-4 h-4 text-orange-400" />}</p>
                      <p className="text-xs text-white/60">{t.desc}</p>
                    </div>
                  </button>
                );
              })}
            </>
          )}

          {tab === 'content' && (
            <>
              <p className="text-xs text-white/50">Klik op een tekst in het voorbeeld om hem direct te bewerken, of pas hem hier aan.</p>
              {!fields.length && <p className="text-sm text-white/60 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Laden…</p>}
              {Object.entries(grouped).map(([g, list]) => (
                <div key={g} className="space-y-2">
                  <p className="text-[11px] font-black uppercase tracking-widest text-orange-400">{g}</p>
                  {list.map((f) => (f.kind === 'image' ? (
                    <div key={f.path} className="bg-black/25 rounded-xl p-2">
                      <p className="text-xs font-bold text-white/70 mb-2 flex items-center gap-1.5"><ImageIcon className="w-3.5 h-3.5" /> {prettify(f.path)}</p>
                      {f.value && <img src={f.value} alt="" className="w-full h-24 object-cover rounded-lg mb-2" />}
                      <button type="button" onClick={() => { imgPathRef.current = f.path; fileRef.current?.click(); }}
                        className="w-full h-9 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-bold flex items-center justify-center gap-1.5">
                        <Upload className="w-3.5 h-3.5" /> Afbeelding kiezen
                      </button>
                    </div>
                  ) : (
                    <label key={f.path} className="block">
                      <span className="text-xs font-bold text-white/70">{prettify(f.path)}</span>
                      <textarea value={f.value} rows={f.value.length > 60 ? 3 : 1}
                        onChange={(e) => update(f.path, e.target.value)}
                        className="mt-1 w-full rounded-lg bg-black/30 border border-white/10 focus:border-orange-400 outline-none px-3 py-2 text-sm text-white resize-none" />
                    </label>
                  )))}
                </div>
              ))}
            </>
          )}

          {tab === 'sections' && (
            <>
              <p className="text-xs text-white/50">Spring naar een onderdeel van de website.</p>
              {SECTIONS.map((s) => (
                <button key={s.id} type="button"
                  onClick={() => post({ type: 'landing-edit-focus', path: s.scroll })}
                  className="w-full h-11 rounded-xl bg-black/25 hover:bg-white/10 px-4 text-left text-sm font-bold">
                  {s.label}
                </button>
              ))}
            </>
          )}

          {tab === 'settings' && (
            <>
              <div className="bg-black/25 rounded-xl p-3 space-y-2 text-sm">
                <p className="font-bold flex items-center gap-2"><Globe className="w-4 h-4 text-orange-400" /> Adressen</p>
                <p className="text-white/70 break-all">Website: {site.marketing_url || (site.slug ? `/site/${site.slug}` : '—')}</p>
                <p className="text-white/70 break-all">Inloggen: {site.login_url || (site.slug ? `/${site.slug}/login` : '—')}</p>
              </div>
              <p className="text-xs text-white/50">Een eigen domein koppel je bij Instellingen → Eigen domein.</p>
              <button type="button" data-testid="site-open-domain"
                onClick={() => { onClose(); setTimeout(() => window.dispatchEvent(new CustomEvent('go-instellingen-section', { detail: { section: 'domein' } })), 50); }}
                className="w-full h-10 rounded-xl bg-white/10 hover:bg-white/20 text-sm font-bold flex items-center justify-center gap-2">
                <Check className="w-4 h-4" /> Naar Eigen domein
              </button>
            </>
          )}
        </div>

        <div className="flex-1 min-w-0 min-h-0 bg-[#0b0c0e] p-2 sm:p-4 overflow-auto flex justify-center">
          <div className="bg-white rounded-xl overflow-hidden shadow-2xl h-full"
            style={{ width: dev.w === '100%' ? '100%' : dev.w, maxWidth: '100%', transition: 'width 250ms ease' }}>
            <iframe ref={iframeRef} title="Website voorbeeld" src="/landing-preview?edit=1"
              data-testid="site-editor-iframe" className="w-full h-full border-0 block" />
          </div>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 bg-emerald-500 text-white text-sm font-bold px-4 py-2 rounded-full shadow-lg">
          {toast}
        </div>
      )}
    </div>,
    document.body,
  );
}
