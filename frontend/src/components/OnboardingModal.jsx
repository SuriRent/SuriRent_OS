/**
 * OnboardingModal — mini "Kies uw portalnaam" popup die verschijnt na
 * een Google-registratie waar de backend `needs_onboarding: true` op de
 * company heeft gezet. Gebruiker vult bedrijfsnaam + slug in, submit
 * roept `POST /api/companies/me/onboarding` aan en de flag klapt om.
 *
 * Ontwerp: fullscreen backdrop-blur + centered card met live slug-
 * beschikbaarheids-check. Kan NIET gesloten worden zonder submit —
 * gebruiker moet een naam kiezen want anders ziet hun portal er
 * professioneel uit als `surirent.sr/john-doe-3`.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { Loader2, Building2, Globe, Check, Sparkles } from 'lucide-react';
import { api, formatError } from '../lib/api';
import { RESERVED_SLUGS } from '../lib/branded-nav';

export default function OnboardingModal({ initialName = '', initialSlug = '', onDone, zClass = 'z-[100]' }) {
  const [name, setName] = useState(initialName);
  const [slug, setSlug] = useState(initialSlug);
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugStatus, setSlugStatus] = useState('idle'); // idle | checking | available | taken | reserved | format
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Auto-suggestie van slug op basis van bedrijfsnaam
  const slugSuggestion = useMemo(() => {
    const raw = (name || '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    if (!raw) return '';
    return RESERVED_SLUGS.has(raw) ? `${raw}-bedrijf` : raw;
  }, [name]);

  const effectiveSlug = slugTouched ? slug : slugSuggestion;

  // Live availability check
  useEffect(() => {
    const s = effectiveSlug;
    if (!s || s.length < 2) { setSlugStatus('idle'); return undefined; }
    if (RESERVED_SLUGS.has(s)) { setSlugStatus('reserved'); return undefined; }
    if (!/^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/.test(s)) { setSlugStatus('format'); return undefined; }
    setSlugStatus('checking');
    const h = setTimeout(async () => {
      try {
        const { data } = await api.get(`/public/companies/${encodeURIComponent(s)}/available`);
        setSlugStatus(data?.available ? 'available' : (data?.reason || 'taken'));
      } catch { setSlugStatus('idle'); }
    }, 350);
    return () => clearTimeout(h);
  }, [effectiveSlug]);

  const host = useMemo(() => {
    try { return (window.location.host || '').replace(/:.*$/, ''); }
    catch { return 'app.surirent.sr'; }
  }, []);

  const canSave = name.trim().length >= 2 && effectiveSlug && slugStatus === 'available';

  const submit = useCallback(async (e) => {
    e?.preventDefault?.();
    if (!canSave || loading) return;
    setLoading(true); setError('');
    try {
      const { data } = await api.post('/companies/me/onboarding', {
        name: name.trim(),
        slug: effectiveSlug,
      });
      onDone?.(data);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setLoading(false);
    }
  }, [canSave, loading, name, effectiveSlug, onDone]);

  return (
    <div className={`fixed inset-0 ${zClass} bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4`}
      data-testid="onboarding-modal">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="bg-gradient-to-br from-[#FF8A3D] to-[#FF5C00] px-6 pt-6 pb-8 text-white relative">
          <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full bg-white/10 blur-3xl pointer-events-none" />
          <div className="relative">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/15 backdrop-blur-sm border border-white/20 mb-3">
              <Sparkles className="w-3 h-3" />
              <span className="text-[9px] font-black tracking-[0.22em] uppercase">Bijna klaar</span>
            </div>
            <h2 className="text-xl font-black tracking-tight leading-tight">
              Kies een naam voor<br />uw portal
            </h2>
            <p className="text-white/85 text-xs mt-1.5">
              Zo herkennen huurders u — u kunt dit later altijd wijzigen in Instellingen.
            </p>
          </div>
        </div>

        <form onSubmit={submit} className="px-6 py-5 space-y-4">
          {error && (
            <div className="p-2.5 bg-red-50 border border-red-200 text-red-600 rounded-lg text-xs font-medium"
              data-testid="onboarding-error">
              {error}
            </div>
          )}

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
              Bedrijfsnaam
            </label>
            <div className="relative">
              <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <input type="text" value={name}
                onChange={(e) => setName(e.target.value)}
                data-testid="onboarding-name" autoFocus required minLength={2}
                placeholder="Bijvoorbeeld: Demo Vastgoed N.V."
                className="w-full h-11 pl-9 pr-3 text-sm rounded-xl border-2 border-slate-200 focus:border-[#FF5C00] focus:ring-2 focus:ring-[#FF5C00]/10 bg-slate-50 outline-none transition" />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
              Portal-URL {!slugTouched && slugSuggestion && (
                <span className="ml-1 font-normal normal-case text-[9px] text-slate-400 tracking-normal">
                  — voorstel: <span className="font-mono text-slate-500">{slugSuggestion}</span>
                </span>
              )}
            </label>
            <div className="flex items-stretch rounded-xl border-2 border-slate-200 focus-within:border-[#FF5C00] focus-within:ring-2 focus-within:ring-[#FF5C00]/10 bg-slate-50 overflow-hidden">
              <span className="hidden sm:inline-flex items-center px-2.5 text-[10px] font-mono text-slate-400 bg-slate-100 border-r border-slate-200">
                {host}/
              </span>
              <input type="text" value={slugTouched ? slug : slugSuggestion}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 40));
                }}
                onFocus={() => {
                  if (!slugTouched) { setSlug(slugSuggestion); setSlugTouched(true); }
                }}
                data-testid="onboarding-slug"
                placeholder="uw-portal"
                className="flex-1 h-11 text-sm px-3 bg-transparent outline-none font-mono" />
            </div>
            {effectiveSlug && (() => {
              const errTone = ['taken', 'reserved', 'format'].includes(slugStatus);
              const palette = errTone
                ? 'bg-rose-50 border-rose-200 text-rose-700'
                : slugStatus === 'available'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                  : 'bg-slate-50 border-slate-200 text-slate-500';
              return (
                <div className={`mt-1.5 flex items-center gap-1.5 px-2 py-1 rounded-md border text-[10px] font-bold ${palette}`}
                  data-testid="onboarding-slug-status">
                  <Globe className="w-3 h-3 shrink-0" />
                  <span className="font-mono truncate flex-1">{host}/{effectiveSlug}</span>
                  {slugStatus === 'checking' && <Loader2 className="w-3 h-3 animate-spin" />}
                  {slugStatus === 'available' && <span>✓ VRIJ</span>}
                  {slugStatus === 'taken' && <span>✗ BEZET</span>}
                  {slugStatus === 'reserved' && <span>✗ GERESERVEERD</span>}
                  {slugStatus === 'format' && <span>✗ FORMAT</span>}
                </div>
              );
            })()}
          </div>

          <button type="submit" disabled={!canSave || loading}
            data-testid="onboarding-submit"
            className="w-full h-12 rounded-xl bg-[#FF5C00] hover:bg-[#E05200] disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-black text-sm flex items-center justify-center gap-2 transition shadow-lg shadow-orange-500/20">
            {loading ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Opslaan…</>
            ) : (
              <><Check className="w-4 h-4" /> Ga verder naar dashboard</>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
