import { useState, useEffect } from 'react';
import { Code2, Copy, Check, ExternalLink, Info } from 'lucide-react';
import { api } from '../../../lib/api';

/**
 * ApiIntegration — publieke API-endpoints voor externe integraties.
 *
 * Toont voor de huidige tenant alle beschikbare `/api/public/{slug}/...`
 * endpoints in de vorm van kopieerbare URL's. Bedoeld voor developers of
 * partners die een externe website / app op deze tenant willen aansluiten
 * zonder authenticatie.
 */
export default function ApiIntegration() {
  const [slug, setSlug] = useState('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState('');

  useEffect(() => {
    let mounted = true;
    api.get('/companies/me').then(({ data }) => {
      if (mounted) setSlug(data?.slug || '');
    }).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  const baseUrl = typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.host}`
    : 'https://app.surirent.sr';

  const endpoints = slug ? [
    {
      id: 'landing',
      method: 'GET',
      label: 'Landingpagina data',
      desc: 'Bedrijfsinfo, gepubliceerde landing-content en beschikbare woningen. Ideaal voor externe marketing sites die willen tonen dat er woningen te huur staan.',
      path: `/api/public/${slug}/landing`,
      shape: '{ found, company, content, apartments }',
    },
    {
      id: 'login',
      method: 'GET',
      label: 'Login instellingen',
      desc: 'Branding, login-URL en portal-URL voor dit bedrijf. Handig om een custom login-scherm te bouwen dat je gebruikers doorstuurt naar deze tenant.',
      path: `/api/public/${slug}/login`,
      shape: '{ company, login_url, portal_url, branding }',
    },
    {
      id: 'woningen',
      method: 'GET',
      label: 'Beschikbare woningen',
      desc: 'Lijst van alle vacant/available appartementen met foto, prijs, locatie en features. Optionele query params: ?limit=N, ?currency=SRD|USD|EUR.',
      path: `/api/public/${slug}/woningen`,
      shape: '{ company, count, woningen }',
    },
  ] : [];

  const copyUrl = async (id, path) => {
    const full = `${baseUrl}${path}`;
    try {
      await navigator.clipboard.writeText(full);
      setCopied(id);
      setTimeout(() => setCopied(''), 2000);
    } catch { /* niet-kritisch */ }
  };

  if (loading) {
    return <div className="text-sm text-slate-500">Bezig met laden…</div>;
  }
  if (!slug) {
    return <div className="text-sm text-red-600">Geen bedrijfs-slug gevonden voor deze account.</div>;
  }

  return (
    <div className="space-y-4" data-testid="api-integration">
      {/* Info banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
          <Info className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-black text-slate-900">Publieke API — geen authenticatie nodig</p>
          <p className="text-xs text-slate-600 mt-1 leading-snug">
            Deze endpoints geven alleen data terug die publiek zichtbaar is (branding, actieve
            listings). Perfect voor externe websites, embedbare widgets en partnerintegraties.
            Vervang <code className="px-1 bg-white/70 rounded text-[11px] font-mono">{slug}</code>
            {' '}met je slug om andere tenants op te vragen.
          </p>
        </div>
      </div>

      {/* Endpoints */}
      <div className="space-y-3">
        {endpoints.map((ep) => {
          const full = `${baseUrl}${ep.path}`;
          const isCopied = copied === ep.id;
          return (
            <div key={ep.id} className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden"
              data-testid={`api-endpoint-${ep.id}`}>
              <div className="p-4">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">
                    {ep.method}
                  </span>
                  <h3 className="text-sm font-black text-slate-900">{ep.label}</h3>
                </div>
                <p className="text-xs text-slate-500 leading-snug">{ep.desc}</p>
              </div>

              {/* Kopieerbare URL */}
              <div className="border-t border-slate-100 bg-slate-50 p-2 flex items-center gap-2">
                <Code2 className="w-4 h-4 text-slate-400 shrink-0 ml-1" />
                <code className="flex-1 text-[11px] font-mono text-slate-700 truncate select-all"
                  data-testid={`api-url-${ep.id}`}>{full}</code>
                <button type="button" onClick={() => copyUrl(ep.id, ep.path)}
                  data-testid={`api-copy-${ep.id}`}
                  className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-black transition ${
                    isCopied
                      ? 'bg-emerald-500 text-white'
                      : 'bg-white border border-slate-200 hover:bg-slate-100 text-slate-700'
                  }`}>
                  {isCopied ? <><Check className="w-3.5 h-3.5" /> Gekopieerd</> : <><Copy className="w-3.5 h-3.5" /> Kopieer</>}
                </button>
                <a href={full} target="_blank" rel="noreferrer"
                  data-testid={`api-open-${ep.id}`}
                  className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-slate-600" title="Open in nieuw tabblad">
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>

              {/* Response-shape */}
              <div className="border-t border-slate-100 px-4 py-2 flex items-center gap-2">
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Response</span>
                <code className="text-[11px] font-mono text-slate-500 truncate">{ep.shape}</code>
              </div>
            </div>
          );
        })}
      </div>

      {/* cURL voorbeeld */}
      <div className="bg-slate-900 rounded-2xl p-4 text-slate-100">
        <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400 mb-2">cURL voorbeeld</p>
        <pre className="text-[11px] font-mono overflow-x-auto whitespace-pre">
{`curl ${baseUrl}/api/public/${slug}/landing
curl ${baseUrl}/api/public/${slug}/login
curl "${baseUrl}/api/public/${slug}/woningen?limit=10"`}
        </pre>
      </div>
    </div>
  );
}
