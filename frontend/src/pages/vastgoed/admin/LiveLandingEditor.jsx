// Superadmin · Live Landing Editor
// =============================================================================
// Toon de echte landing in een iframe (`/?edit=1`), luister naar postMessage
// patches en sla ze op in de `landing_content` draft. Publish kopieert draft
// naar published. Discard reset draft naar published.
//
// Patches komen binnen als { type:'landing-edit-patch', path:'v2.hero.title', value:'…' }
// Image-request: { type:'landing-edit-image-request', path, current }  → toon picker
// Image-reply:   { type:'landing-edit-image-reply', path, url }       → naar iframe
//
// Pad-conventie: alle V2 velden onder `v2.*` (zodat ze losstaan van het oude
// landing schema dat door MarketingLanding.jsx wordt gebruikt).
// =============================================================================

import { useEffect, useState, useRef, useCallback } from 'react';
import {
  Save, Eye, RefreshCw, Trash2, Upload, X, ExternalLink, AlertCircle,
  CheckCircle2, Loader2, Monitor, Smartphone, Tablet, Paintbrush, History,
} from 'lucide-react';
import { api, formatError } from '../../../lib/api';

const DEVICE_PRESETS = [
  { id: 'desktop', label: 'Desktop', icon: Monitor, w: '100%', h: '100%' },
  { id: 'tablet',  label: 'Tablet',  icon: Tablet,  w: 820,    h: '100%' },
  { id: 'mobile',  label: 'Mobiel',  icon: Smartphone, w: 390, h: '100%' },
];

const MARKETING_PAGES = [
  { path: '/', label: 'Home' },
  { path: '/functies', label: 'Functies' },
  { path: '/contact', label: 'Contact' },
  { path: '/over-ons', label: 'Over ons' },
  { path: '/handleiding', label: 'Handleiding' },
  { path: '/algemene-voorwaarden', label: 'Voorwaarden' },
  { path: '/privacy', label: 'Privacy' },
  { path: '/over-surirent', label: 'Over SuriRent' },
];

function setPath(obj, path, value) {
  if (!path) return obj;
  const parts = path.split('.');
  const out = Array.isArray(obj) ? [...obj] : { ...(obj || {}) };
  let cur = out;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    const next = cur[k];
    const isArr = Array.isArray(next);
    cur[k] = isArr ? [...next] : { ...(next || {}) };
    cur = cur[k];
  }
  cur[parts[parts.length - 1]] = value;
  return out;
}

function getPath(obj, path) {
  return path.split('.').reduce((value, key) => value?.[key], obj);
}

function previewUrl(path) {
  return `${path}?edit=1&landing=1&_t=${Date.now()}`;
}

function assetPreviewUrl(value) {
  return value?.startsWith('/api/')
    ? `${(process.env.REACT_APP_BACKEND_URL || '').replace(/\/$/, '')}${value}`
    : value;
}

export default function LiveLandingEditor() {
  const iframeRef = useRef(null);
  const [draft, setDraft] = useState(null);            // content object van /superadmin/landing/content?mode=draft
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');
  const [device, setDevice] = useState('desktop');
  const [hasUnpublished, setHasUnpublished] = useState(false);
  const [iframeReady, setIframeReady] = useState(false);
  const [previewPage, setPreviewPage] = useState('/');
  const [previewSrc, setPreviewSrc] = useState(() => previewUrl('/'));
  const [editableFields, setEditableFields] = useState([]);
  const [contentOpen, setContentOpen] = useState(true);
  const previewPageRef = useRef('/');
  // Image picker dialog
  const [imageReq, setImageReq] = useState(null);  // { path, current }
  const [uploadingImg, setUploadingImg] = useState(false);

  const loadDraft = useCallback(async () => {
    setLoading(true); setErr('');
    try {
      const { data } = await api.get('/superadmin/landing/content', { params: { mode: 'draft' } });
      setDraft(data.content || {});
      setHasUnpublished(!!data.has_unpublished_changes);
      setDirty(false);
    } catch (e) {
      setErr(formatError(e, 'Kon concept niet laden.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadDraft(); }, [loadDraft]);

  // PostMessage listener — luistert naar patches uit de iframe.
  useEffect(() => {
    const onMsg = (ev) => {
      const data = ev?.data;
      if (ev.origin !== window.location.origin
        || ev.source !== iframeRef.current?.contentWindow
        || !data || typeof data !== 'object') return;
      if (data.type === 'landing-edit-ready') {
        setIframeReady(true);
        return;
      }
      if (data.type === 'landing-edit-page' && typeof data.page === 'string') {
        if (data.page !== previewPageRef.current) {
          previewPageRef.current = data.page;
          setPreviewPage(data.page);
          setEditableFields([]);
        }
        return;
      }
      if (data.type === 'landing-edit-register' && data.path && typeof data.path === 'string') {
        const page = typeof data.page === 'string' ? data.page : previewPageRef.current;
        if (page !== previewPageRef.current) {
          previewPageRef.current = page;
          setPreviewPage(page);
          setEditableFields([]);
        }
        const field = {
          path: data.path,
          label: data.label || data.path,
          kind: ['text', 'image', 'media', 'link'].includes(data.kind) ? data.kind : 'text',
          value: data.value == null ? '' : String(data.value),
          typePath: typeof data.typePath === 'string' ? data.typePath : '',
          mediaType: typeof data.mediaType === 'string' ? data.mediaType : '',
        };
        setEditableFields((prev) => [
          ...prev.filter((item) => item.path !== field.path),
          field,
        ]);
        return;
      }
      if (data.type === 'landing-edit-patch' && data.path) {
        setDraft((prev) => setPath(prev || {}, data.path, data.value));
        setDirty(true);
        return;
      }
      if (data.type === 'landing-edit-image-request' && data.path) {
        setImageReq({ path: data.path, current: data.current || '', allowVideo: false });
      }
      if (data.type === 'landing-edit-media-request' && data.path) {
        setImageReq({
          path: data.path,
          typePath: data.typePath || '',
          current: data.current || '',
          mediaType: data.mediaType || '',
          allowVideo: true,
        });
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // Stuur draft naar iframe bij elke reload (zodat hij ook draft toont, niet published).
  useEffect(() => {
    if (!iframeReady || !draft) return;
    try {
      iframeRef.current?.contentWindow?.postMessage(
        { type: 'landing-edit-reset', content: draft }, window.location.origin,
      );
    } catch { /* no-op */ }
  }, [iframeReady, draft]);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  };

  const saveDraft = useCallback(async () => {
    if (!draft) return false;
    setSaving(true); setErr('');
    try {
      const { data } = await api.put('/superadmin/landing/content', { content: draft });
      setHasUnpublished(!!data.has_unpublished_changes);
      setDirty(false);
      showToast('Concept opgeslagen ✓');
      return true;
    } catch (e) {
      setErr(formatError(e, 'Opslaan mislukt'));
      return false;
    } finally {
      setSaving(false);
    }
  }, [draft]);

  // Autosave 1.5s na laatste edit
  useEffect(() => {
    if (!dirty) return undefined;
    const t = setTimeout(() => { saveDraft(); }, 1500);
    return () => clearTimeout(t);
  }, [dirty, saveDraft]);

  const publish = async () => {
    if (dirty && !(await saveDraft())) return;
    if (!window.confirm('Concept publiceren naar de live landing page? Deze wijzigingen worden direct zichtbaar voor bezoekers.')) return;
    setPublishing(true); setErr('');
    try {
      await api.post('/superadmin/landing/publish');
      setHasUnpublished(false);
      showToast('Live gepubliceerd ✓');
    } catch (e) {
      setErr(formatError(e, 'Publiceren mislukt'));
    } finally {
      setPublishing(false);
    }
  };

  const discard = async () => {
    if (!window.confirm('Concept resetten naar de huidige live versie? Niet-opgeslagen wijzigingen gaan verloren.')) return;
    try {
      await api.post('/superadmin/landing/discard');
      await loadDraft();
      // Force iframe-reload zodat hij de nieuwe state oppikt.
      setPreviewPage('/');
      previewPageRef.current = '/';
      setEditableFields([]);
      setIframeReady(false);
      setPreviewSrc(previewUrl('/'));
      showToast('Concept gereset');
    } catch (e) {
      setErr(formatError(e));
    }
  };

  const [migrating, setMigrating] = useState(false);
  const migrateWebP = async () => {
    if (!window.confirm('Converteer alle bestaande landing-afbeeldingen naar WebP-formaat? Dit kan even duren, maar de laadtijd van de landing-pagina wordt dan flink sneller.')) return;
    setMigrating(true);
    setErr('');
    try {
      const { data } = await api.post('/superadmin/landing/migrate-webp');
      const beforeMB = (data.bytes_before / 1024 / 1024).toFixed(2);
      const afterMB = (data.bytes_after / 1024 / 1024).toFixed(2);
      showToast(`${data.converted} afbeeldingen → WebP · ${beforeMB} MB → ${afterMB} MB (-${data.reduction_pct}%)`);
    } catch (e) {
      setErr(formatError(e));
    } finally {
      setMigrating(false);
    }
  };

  const uploadImage = async (file) => {
    if (!file || !imageReq) return;
    setUploadingImg(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const { data } = await api.post('/superadmin/landing/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      // Stuur reply naar iframe — die patcht z'n local state EN we patchen onze draft.
      const url = data.url;
      try {
        iframeRef.current?.contentWindow?.postMessage(
          imageReq.allowVideo
            ? { type: 'landing-edit-media-reply', path: imageReq.path, url, mediaType: data.content_type, typePath: imageReq.typePath }
            : { type: 'landing-edit-image-reply', path: imageReq.path, url },
          window.location.origin,
        );
      } catch { /* no-op */ }
      setDraft((prev) => setPath(prev || {}, imageReq.path, url));
      if (imageReq.allowVideo && imageReq.typePath) {
        setDraft((prev) => setPath(prev || {}, imageReq.typePath, data.content_type || ''));
      }
      setDirty(true);
      setImageReq(null);
      showToast(imageReq.allowVideo ? 'Foto/video bijgewerkt ✓' : 'Afbeelding bijgewerkt ✓');
    } catch (e) {
      setErr(formatError(e, 'Upload mislukt'));
    } finally {
      setUploadingImg(false);
    }
  };

  const updateField = (path, value) => {
    setDraft((prev) => setPath(prev || {}, path, value));
    setDirty(true);
  };

  const focusField = (path) => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'landing-edit-focus', path }, window.location.origin,
    );
  };

  const clearMedia = () => {
    if (!imageReq?.allowVideo) return;
    setDraft((prev) => setPath(setPath(prev || {}, imageReq.path, ''), imageReq.typePath, ''));
    iframeRef.current?.contentWindow?.postMessage({
      type: 'landing-edit-media-reply',
      path: imageReq.path,
      typePath: imageReq.typePath,
      url: '',
      mediaType: '',
    }, window.location.origin);
    setDirty(true);
    setImageReq(null);
    showToast('Hero media verwijderd');
  };

  const openPreviewPage = (path) => {
    previewPageRef.current = path;
    setPreviewPage(path);
    setEditableFields([]);
    setIframeReady(false);
    setPreviewSrc(previewUrl(path));
  };

  const dev = DEVICE_PRESETS.find((d) => d.id === device) || DEVICE_PRESETS[0];

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)] -mx-5 md:-mx-6 lg:-mx-8 -my-5 md:-my-5 lg:-my-3" data-testid="live-landing-editor">
      {/* Toolbar */}
      <div className="px-4 lg:px-6 py-3 bg-white border-b border-slate-200 flex items-center gap-2 flex-wrap shrink-0">
        <div className="flex items-center gap-2 mr-3">
          <Paintbrush className="w-5 h-5 text-orange-500" />
          <h1 className="font-extrabold text-slate-900">Landing Editor</h1>
        </div>

        {/* Device switcher */}
        <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
          {DEVICE_PRESETS.map((d) => {
            const Icon = d.icon;
            return (
              <button key={d.id} onClick={() => setDevice(d.id)}
                data-testid={`device-${d.id}`}
                className={`px-2.5 py-1.5 rounded-md text-xs font-bold flex items-center gap-1.5 transition ${
                  device === d.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}>
                <Icon className="w-3.5 h-3.5" /> {d.label}
              </button>
            );
          })}
        </div>

        <select value={previewPage} onChange={(event) => openPreviewPage(event.target.value)}
          data-testid="landing-page-select"
          className="h-9 max-w-44 rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold text-slate-700">
          {MARKETING_PAGES.map((page) => <option key={page.path} value={page.path}>{page.label}</option>)}
          {!MARKETING_PAGES.some((page) => page.path === previewPage)
            && <option value={previewPage}>{previewPage}</option>}
        </select>

        <button type="button" onClick={() => setContentOpen((value) => !value)}
          data-testid="landing-content-toggle"
          aria-expanded={contentOpen}
          className={`h-9 px-3 rounded-lg border text-xs font-bold transition ${
            contentOpen ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}>
          Inhoud ({editableFields.length})
        </button>

        <div className="flex-1" />

        {/* Status */}
        <div className="flex items-center gap-1.5 text-xs">
          {saving ? (
            <span className="text-orange-600 font-bold flex items-center gap-1"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Opslaan…</span>
          ) : dirty ? (
            <span className="text-amber-700 font-bold flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" /> Niet opgeslagen</span>
          ) : hasUnpublished ? (
            <span className="text-orange-700 font-bold flex items-center gap-1"><History className="w-3.5 h-3.5" /> Onuitgegeven</span>
          ) : (
            <span className="text-emerald-700 font-bold flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Live = Concept</span>
          )}
        </div>

        <button onClick={migrateWebP} disabled={migrating}
          data-testid="landing-migrate-webp"
          title="Converteer alle bestaande landing-afbeeldingen naar WebP"
          className="h-9 px-3 rounded-lg border border-emerald-200 hover:border-emerald-400 hover:bg-emerald-50 text-emerald-700 font-bold text-xs flex items-center gap-1.5 disabled:opacity-50">
          {migrating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : (
            <span className="text-[9px] font-black px-1 py-0.5 bg-emerald-100 rounded">WebP</span>
          )}
          Migreer
        </button>

        <button onClick={discard} title="Concept resetten naar live"
          data-testid="landing-discard"
          className="h-9 w-9 rounded-lg border border-slate-200 hover:border-red-300 hover:bg-red-50 hover:text-red-700 text-slate-500 flex items-center justify-center">
          <Trash2 className="w-4 h-4" />
        </button>

        <a href="/" target="_blank" rel="noreferrer"
          className="h-9 w-9 rounded-lg border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-500 flex items-center justify-center"
          title="Open live landing in nieuw tabblad">
          <ExternalLink className="w-4 h-4" />
        </a>

        <button onClick={saveDraft} disabled={!dirty || saving}
          data-testid="landing-save"
          className="h-9 px-4 rounded-lg border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 font-bold text-sm flex items-center gap-1.5 disabled:opacity-50">
          <Save className="w-4 h-4" /> Opslaan
        </button>

        <button onClick={publish} disabled={publishing || (!hasUnpublished && !dirty)}
          data-testid="landing-publish"
          className="h-9 px-4 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-extrabold text-sm flex items-center gap-1.5 disabled:opacity-50 shadow-md shadow-emerald-500/25">
          {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
          Publiceer live
        </button>
      </div>

      {err && (
        <div className="px-4 py-2 bg-red-50 border-b border-red-200 text-sm text-red-700 flex items-center gap-2 shrink-0">
          <AlertCircle className="w-4 h-4" /> {err}
          <button onClick={() => setErr('')} className="ml-auto"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Iframe preview and automatically discovered content fields */}
      <div className="flex-1 min-h-0 bg-slate-100 flex flex-col lg:flex-row overflow-hidden">
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-8 h-8 text-orange-500 animate-spin" />
          </div>
        ) : (
          <>
            <div className="flex-1 min-w-0 min-h-0 flex items-center justify-center p-4 overflow-auto">
              <div className="bg-white rounded-xl shadow-2xl overflow-hidden mx-auto shrink-0"
                style={{
                  width: dev.w === '100%' ? '100%' : `${dev.w}px`,
                  maxWidth: '100%',
                  height: '100%',
                  maxHeight: '100%',
                  transition: 'width 250ms ease',
                }}>
                <iframe ref={iframeRef} title="Landing preview" src={previewSrc}
                  data-testid="landing-iframe"
                  className="w-full h-full border-0 block" />
              </div>
            </div>
            {contentOpen && (
              <aside className="w-full lg:w-[360px] shrink-0 border-t lg:border-t-0 lg:border-l border-slate-200 bg-white flex flex-col min-h-0">
                <div className="p-4 border-b border-slate-100">
                  <h2 className="text-sm font-extrabold text-slate-900">Bewerkbare inhoud</h2>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                    Velden van deze pagina. Nieuwe tekst, afbeeldingen, video’s en links verschijnen hier automatisch zodra ze de bewerkbare marketingcomponenten gebruiken.
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                    Pakketnamen, prijzen en limieten komen uit SaaS Pakketten, zodat de marketingprijzen gelijk blijven aan de facturatie.
                  </p>
                  <p className="mt-1 text-[10px] font-semibold text-slate-400 truncate" title={previewPage}>{previewPage}</p>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
                  {editableFields.length === 0 ? (
                    <p className="rounded-xl bg-slate-50 p-4 text-xs leading-relaxed text-slate-500">
                      Nog geen bewerkbare velden gevonden. Controleer of de pagina is geladen, of kies een andere marketingpagina.
                    </p>
                  ) : editableFields.map((field) => {
                    const current = getPath(draft || {}, field.path);
                    const value = current == null ? field.value : String(current);
                    return (
                      <label key={field.path} className="block rounded-xl border border-slate-200 p-3 hover:border-emerald-300">
                        <span className="flex items-center justify-between gap-2 text-[11px] font-bold text-slate-700">
                          <span className="truncate">{field.label}</span>
                          {field.kind !== 'media' && (
                            <button type="button" onClick={() => focusField(field.path)}
                              className="shrink-0 text-[10px] font-bold text-emerald-700 hover:underline">
                              Toon
                            </button>
                          )}
                        </span>
                        <span className="mt-1 block truncate font-mono text-[9px] text-slate-400">{field.path}</span>
                        {field.kind === 'media' ? (
                          <div className="mt-2">
                            {value && (getPath(draft || {}, field.typePath) || field.mediaType).startsWith('video/') ? (
                              <video src={assetPreviewUrl(value)} controls playsInline className="h-28 w-full rounded-lg bg-slate-100 object-contain" />
                            ) : value ? (
                              <img loading="lazy" src={assetPreviewUrl(value)} alt="" className="h-28 w-full rounded-lg bg-slate-100 object-contain" />
                            ) : (
                              <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">Geen foto of video ingesteld.</p>
                            )}
                            <div className="mt-2 flex gap-2">
                              <button type="button"
                                onClick={() => setImageReq({
                                  path: field.path,
                                  typePath: field.typePath,
                                  current: value,
                                  mediaType: getPath(draft || {}, field.typePath) || field.mediaType,
                                  allowVideo: true,
                                })}
                                className="min-h-9 flex-1 rounded-lg bg-emerald-700 px-3 text-xs font-bold text-white hover:bg-emerald-800">
                                Foto of video kiezen
                              </button>
                              {value && (
                                <button type="button" onClick={() => {
                                  updateField(field.path, '');
                                  if (field.typePath) updateField(field.typePath, '');
                                }} className="min-h-9 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-600 hover:bg-slate-50">
                                  Verwijderen
                                </button>
                              )}
                            </div>
                            <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
                              De bestaande laptop- en telefoonmockupteksten blijven bewerkbaar. Kies in de preview “Mockupteksten bewerken” om ze te openen.
                            </p>
                          </div>
                        ) : field.kind === 'text' ? (
                          <textarea value={value} onChange={(event) => updateField(field.path, event.target.value)}
                            rows={Math.min(5, Math.max(2, value.split('\n').length))}
                            data-testid={`landing-field-${field.path.replace(/[^a-zA-Z0-9_-]/g, '-')}`}
                            className="mt-2 w-full resize-y rounded-lg border border-slate-200 px-2.5 py-2 text-xs text-slate-800 focus:border-emerald-500 focus:outline-none" />
                        ) : (
                          <input value={value} onChange={(event) => updateField(field.path, event.target.value)}
                            type="text" data-testid={`landing-field-${field.path.replace(/[^a-zA-Z0-9_-]/g, '-')}`}
                            className="mt-2 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs text-slate-800 focus:border-emerald-500 focus:outline-none" />
                        )}
                        {field.kind === 'image' && value && (
                          <img loading="lazy" src={assetPreviewUrl(value)}
                            alt="" className="mt-2 h-20 w-full rounded-lg bg-slate-100 object-contain" />
                        )}
                      </label>
                    );
                  })}
                </div>
              </aside>
            )}
          </>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white px-5 py-3 rounded-xl text-sm font-bold shadow-2xl z-50 flex items-center gap-2"
          data-testid="landing-toast">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" /> {toast}
        </div>
      )}

      {/* Image and video picker modal */}
      {imageReq && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setImageReq(null); }}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6" data-testid="image-picker">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-extrabold text-slate-900">{imageReq.allowVideo ? 'Foto of video wijzigen' : 'Afbeelding wijzigen'}</h3>
              <button onClick={() => setImageReq(null)} className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-500 font-mono mb-3 truncate">{imageReq.path}</p>
            {imageReq.current && imageReq.allowVideo && imageReq.mediaType?.startsWith('video/') ? (
              <video src={assetPreviewUrl(imageReq.current)} controls playsInline className="w-full h-40 rounded-lg mb-3 bg-slate-100 object-contain" />
            ) : imageReq.current ? (
              <img loading="lazy" src={assetPreviewUrl(imageReq.current)} alt="" className="w-full h-32 object-cover rounded-lg mb-3 bg-slate-100" />
            ) : null}
            {imageReq.allowVideo && (
              <p className="mb-3 text-xs text-slate-500">Afbeelding maximaal 5 MB; video MP4 of WebM maximaal 100 MB.</p>
            )}
            <label className="block">
              <input type="file" accept={imageReq.allowVideo ? 'image/*,video/mp4,video/webm' : 'image/*'}
                onChange={(e) => uploadImage(e.target.files?.[0])}
                disabled={uploadingImg}
                className="block w-full text-sm text-slate-600 file:mr-3 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:font-bold file:text-sm file:bg-orange-500 file:text-white hover:file:bg-orange-600 file:cursor-pointer disabled:opacity-50" />
            </label>
            {imageReq.allowVideo && imageReq.current && (
              <button type="button" onClick={clearMedia} disabled={uploadingImg}
                className="mt-3 rounded-lg border border-red-200 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50">
                Foto/video verwijderen
              </button>
            )}
            {uploadingImg && (
              <p className="text-sm text-orange-600 flex items-center gap-2 mt-3">
                <Loader2 className="w-4 h-4 animate-spin" /> Uploaden…
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
