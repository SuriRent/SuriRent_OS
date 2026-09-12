import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Image as ImageIcon, FileText, ArrowLeft, Loader2, Sparkles } from 'lucide-react';

// =====================================================================
// SharedReceivePage — landing na een Web Share Target POST.
// De service worker heeft de gedeelde bestand(en) in de SHARE_CACHE
// opgeslagen onder `/__share/{i}` + meta op `/__share/meta.json`.
// We laden die hier in en tonen een preview. OCR-integratie volgt in
// een latere iteratie — voor nu bewijst dit dat de deel-actie werkt
// en dat de foto in de PWA-context binnenkomt (geen link, echt bestand).
// =====================================================================
export default function SharedReceivePage() {
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const cacheNames = await caches.keys();
        const shareCacheName = cacheNames.find((n) => n.endsWith('-share'));
        if (!shareCacheName) {
          setError('Geen gedeelde bestanden gevonden. Probeer opnieuw te delen vanuit een andere app.');
          setLoading(false);
          return;
        }
        const cache = await caches.open(shareCacheName);
        const metaResp = await cache.match('/__share/meta.json');
        const m = metaResp ? await metaResp.json() : null;
        setMeta(m);

        const collected = [];
        for (let i = 0; i < (m?.count || 0); i++) {
          const r = await cache.match(`/__share/${i}`);
          if (!r) continue;
          const blob = await r.blob();
          collected.push({
            name: m?.names?.[i] || `bestand-${i + 1}`,
            type: m?.types?.[i] || blob.type,
            size: blob.size,
            url: URL.createObjectURL(blob),
          });
        }
        setItems(collected);
      } catch (e) {
        setError(`Kon gedeelde inhoud niet laden: ${e.message || e}`);
      } finally {
        setLoading(false);
      }
    })();
    // Cleanup object URLs on unmount
    return () => {
      items.forEach((it) => { try { URL.revokeObjectURL(it.url); } catch { /* noop */ } });
    };
  }, []);  // eslint-disable-line

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-8" data-testid="shared-receive-page">
      <div className="max-w-2xl mx-auto">
        <Link to="/admin" className="inline-flex items-center gap-1.5 text-slate-600 hover:text-slate-900 text-sm font-bold mb-4" data-testid="shared-back">
          <ArrowLeft className="w-4 h-4" /> Naar beheer
        </Link>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 sm:p-7">
          <div className="flex items-start gap-3 mb-5">
            <div className="w-12 h-12 rounded-2xl bg-emerald-100 flex items-center justify-center shrink-0">
              <Sparkles className="w-6 h-6 text-emerald-600" />
            </div>
            <div>
              <h1 className="text-xl font-black text-slate-900">Gedeeld met SuriRent</h1>
              <p className="text-sm text-slate-500">
                Deze bestanden zijn direct vanuit een andere app naar SuriRent gestuurd. OCR-inlezen volgt binnenkort — voorlopig kun je ze hier bekijken en opslaan.
              </p>
            </div>
          </div>

          {loading && (
            <div className="flex items-center gap-2 text-slate-500 py-6">
              <Loader2 className="w-5 h-5 animate-spin" /> Bezig met laden…
            </div>
          )}

          {!loading && error && (
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm" data-testid="shared-error">
              {error}
            </div>
          )}

          {!loading && !error && items.length === 0 && (
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-slate-500 text-sm">
              Geen bestanden ontvangen.
            </div>
          )}

          {!loading && items.length > 0 && (
            <div className="space-y-3" data-testid="shared-items">
              {items.map((it, idx) => (
                <div key={idx} className="border-2 border-slate-200 rounded-2xl overflow-hidden bg-slate-50">
                  {it.type.startsWith('image/') ? (
                    <img src={it.url} alt={it.name}
                      className="w-full max-h-[70vh] object-contain bg-white"
                      data-testid={`shared-image-${idx}`} />
                  ) : (
                    <div className="p-8 text-center">
                      <FileText className="w-14 h-14 text-slate-400 mx-auto mb-2" />
                      <p className="text-sm text-slate-600 font-bold">{it.name}</p>
                    </div>
                  )}
                  <div className="flex items-center justify-between px-3 py-2 bg-white border-t border-slate-100">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-slate-700 truncate">{it.name}</p>
                      <p className="text-[10px] text-slate-400">
                        {(it.size / 1024).toFixed(1)} KB · {it.type || 'onbekend'}
                      </p>
                    </div>
                    <a href={it.url} download={it.name}
                      data-testid={`shared-download-${idx}`}
                      className="ml-3 shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold">
                      <ImageIcon className="w-3.5 h-3.5" /> Opslaan
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}

          {meta?.text && (
            <div className="mt-4 p-3 rounded-xl bg-slate-50 border border-slate-200">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Bijgevoegde tekst</p>
              <p className="text-sm text-slate-700">{meta.text}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
