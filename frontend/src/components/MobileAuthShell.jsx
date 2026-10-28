// =====================================================================
import { afterPasswordLogin } from '../lib/kioskEntry';
import PersonalPinSetup from './PersonalPinSetup';
// MobileAuthShell — orange full-screen "native app" stijl voor mobiel.
//
// Bevat twee componenten:
//   - MobileEmailLogin    : e-mail + wachtwoord login (matcht PIN-pad)
//   - MobileRegisterWizard: registratie als 4-stappen wizard
//
// Beide gebruiken hetzelfde visuele patroon als PinLanding op mobiel:
//   - Full-screen primary background (oranje)
//   - Top-bar met terug-knop (en evt. progress dots)
//   - Logo-cirkel + "Welkom" titel
//   - Witte input pillen op oranje achtergrond
//   - Grote oranje (of witte) primary action button onderaan
// =====================================================================
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Loader2, Eye, EyeOff, LogIn, KeyRound,
  Sparkles, Check, Globe, X,
} from 'lucide-react';
import { api, formatError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { RESERVED_SLUGS, useBrandedNavigate } from '../lib/branded-nav';
import { setPreferredRole } from '../lib/pwaRole';
import { publicMarketingUrl } from '../lib/env';
import PasswordStrength from './PasswordStrength';

// ────────────────────────────────────────────────────────────────────
// Shared shell — oranje canvas + safe-area + decorative blurs.
// Gebruikt door zowel login als wizard zodat het visueel identiek
// voelt aan de PIN-pad ervaring.
// ────────────────────────────────────────────────────────────────────
function OrangeShell({ children, primary = '#FF5C00' }) {
  // Schilder html+body in primary kleur zodat iOS PWA gesture-zone
  // niet wit doorlekt (zelfde truc als PinLanding).
  useEffect(() => {
    const prevHtml = document.documentElement.style.backgroundColor;
    const prevBody = document.body.style.backgroundColor;
    document.documentElement.style.backgroundColor = primary;
    document.body.style.backgroundColor = primary;
    return () => {
      document.documentElement.style.backgroundColor = prevHtml;
      document.body.style.backgroundColor = prevBody;
    };
  }, [primary]);

  return (
    <div className="flex flex-col text-white relative overflow-hidden" style={{
      position: 'fixed', inset: 0, zIndex: 200,
      backgroundColor: primary,
      paddingTop: 'env(safe-area-inset-top, 0px)',
      paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      paddingLeft: 'env(safe-area-inset-left, 0px)',
      paddingRight: 'env(safe-area-inset-right, 0px)',
    }}>
      {/* Decoratieve blur-circels + diagonale curves zoals PinLanding */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden -z-0">
        <div className="absolute -top-32 -right-40 w-[600px] h-[600px] rounded-full opacity-20 blur-3xl"
          style={{ background: 'rgba(255,255,255,0.4)' }} />
        <div className="absolute top-[20%] -left-32 w-[400px] h-[400px] rounded-full opacity-15 blur-3xl"
          style={{ background: 'rgba(255,176,99,0.6)' }} />
        <svg className="absolute top-0 right-0 w-full h-full opacity-[0.08]" preserveAspectRatio="none" viewBox="0 0 400 800">
          <path d="M0,200 Q200,150 400,250 L400,300 Q200,200 0,250 Z" fill="white" />
          <path d="M0,360 Q200,310 400,410 L400,460 Q200,360 0,410 Z" fill="white" />
        </svg>
      </div>
      {children}
    </div>
  );
}

// =====================================================================
// MobileEmailLogin — orange full-screen e-mail/wachtwoord login.
// Wordt getoond op mobiel (sm:hidden) in plaats van het witte
// card-design dat op desktop wordt gebruikt.
// =====================================================================
export function MobileEmailLogin({ onBack, onForgot, branding, onLoginStart }) {
  const { login } = useAuth();
  const [pinNext, setPinNext] = useState(null);
  const navigate = useBrandedNavigate();
  const [email, setEmail] = useState(() => {
    try { return localStorage.getItem('saved_login_email') || ''; } catch { return ''; }
  });
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(() => {
    try {
      const standalone = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
      return standalone || localStorage.getItem('saved_login_email') !== null;
    } catch { return false; }
  });
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const primary = branding?.primary_color || '#FF5C00';
  const appName = branding?.app_name || 'SuriRent';
  const logoUrl = branding?.logo_url ? branding._logoResolved : '/kiosk-icons/kiosk-512.png';

  const submit = async (e) => {
    e?.preventDefault();
    setLoading(true); setError('');
    try {
      onLoginStart?.();
      const res = await login(email.trim(), password, remember);
      if (res?.pin_required) return;
      try {
        localStorage.removeItem('auto_login_paused');
        if (remember) {
          localStorage.setItem('saved_login_email', email.trim());
          localStorage.setItem('saved_login_password', password);
        } else {
          localStorage.removeItem('saved_login_email');
          localStorage.removeItem('saved_login_password');
        }
      } catch { /* ignore */ }
      // Zelf navigeren: na uitloggen (?loggedout=1) slaat LoginPage de auto-redirect over.
      setPreferredRole('admin');
      let pendingQr = null;
      try { pendingQr = sessionStorage.getItem('pending_qr_token'); } catch { /* ignore */ }
      const userSlug = res?.company?.slug || res?.user?.company_slug;
      const goAdmin = () => {
        if (userSlug && /^\/login(\/|$)/i.test(window.location.pathname)) window.location.assign(`/${userSlug}/admin`);
        else navigate('/admin', { replace: true });
      };
      if (pendingQr) navigate(`/qr-link?token=${encodeURIComponent(pendingQr)}`);
      else await afterPasswordLogin(res?.user, { fallback: goAdmin, onNeedPin: (next) => setPinNext(() => next) });
    } catch (err) {
      setError(formatError(err, 'Inloggen mislukt'));
    } finally { setLoading(false); }
  };

  if (pinNext) return <PersonalPinSetup mandatory onDone={pinNext} />;
  return (
    <OrangeShell primary={primary}>
      {/* TOP: terug-knop */}
      <div className="relative z-10 flex items-center justify-between px-5"
        style={{ paddingTop: 'clamp(12px, 2vh, 24px)', paddingBottom: 'clamp(8px, 1.5vh, 16px)' }}>
        <button onClick={onBack} data-testid="mobile-login-back"
          className="flex items-center gap-2 px-3 py-2 rounded-full bg-white/15 hover:bg-white/25 backdrop-blur-sm border border-white/20 text-white text-sm font-bold">
          <ArrowLeft className="w-4 h-4" />
          Terug
        </button>
      </div>

      {/* CENTER: welkom + logo + form */}
      <div className="relative z-10 flex-1 min-h-0 flex flex-col items-center overflow-y-auto px-5"
        style={{ paddingTop: 'clamp(8px, 2vh, 24px)', paddingBottom: 'clamp(20px, 4vh, 40px)' }}>

        <h1 className="font-black tracking-tight text-white text-center"
          style={{ fontSize: 'clamp(28px, 5vh, 44px)', lineHeight: '1.05' }}>
          Welkom terug
        </h1>

        {/* Logo cirkel — gelijk aan PinLanding */}
        <div className="relative mt-4 mb-3">
          <div className="rounded-full bg-white p-1 shadow-[0_12px_28px_-8px_rgba(0,0,0,0.35)]"
            style={{
              width: 'clamp(76px, 12vh, 110px)',
              height: 'clamp(76px, 12vh, 110px)',
            }}>
            <div className="w-full h-full rounded-full overflow-hidden flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #FFF6D6 0%, #F8C260 60%, #D4A037 100%)' }}>
              <img loading="lazy" src={logoUrl} alt={appName} className="w-[70%] h-[70%] object-contain drop-shadow-md" />
            </div>
          </div>
          <span className="absolute bottom-1 right-1 w-4 h-4 rounded-full border-2 border-white bg-emerald-400 shadow-md" />
        </div>

        <p className="text-white/90 font-black text-center uppercase tracking-wider"
          style={{ fontSize: 'clamp(13px, 1.8vh, 17px)' }}>
          {appName}
        </p>
        <p className="text-white/80 text-center font-medium mt-2 mb-5"
          style={{ fontSize: 'clamp(12px, 1.6vh, 15px)' }}>
          Log in met je e-mail en wachtwoord
        </p>

        {error && (
          <div className="mb-3 px-4 py-2 rounded-full bg-red-500/95 text-white text-xs font-bold shadow-lg"
            data-testid="mobile-login-error">
            {error}
          </div>
        )}

        <form onSubmit={submit} className="w-full max-w-sm space-y-3">
          {/* E-mail */}
          <div className="relative">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              data-testid="mobile-login-email"
              required autoComplete="username" placeholder="E-mailadres"
              className="w-full h-14 px-5 rounded-full bg-white text-slate-900 text-base font-medium placeholder:text-slate-400 outline-none shadow-[0_4px_12px_-4px_rgba(0,0,0,0.2)] focus:ring-4 focus:ring-white/30 transition-all" />
          </div>

          {/* Wachtwoord */}
          <div className="relative">
            <input type={showPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
              data-testid="mobile-login-password"
              required minLength={6} autoComplete="current-password" placeholder="Wachtwoord"
              className="w-full h-14 px-5 pr-14 rounded-full bg-white text-slate-900 text-base font-medium placeholder:text-slate-400 outline-none shadow-[0_4px_12px_-4px_rgba(0,0,0,0.2)] focus:ring-4 focus:ring-white/30 transition-all" />
            <button type="button" onClick={() => setShowPw((s) => !s)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              {showPw ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>

          {/* Onthouden + vergeten */}
          <div className="flex items-center justify-between px-2 text-sm">
            <label className="inline-flex items-center gap-2 text-white/90 font-bold select-none">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)}
                data-testid="mobile-login-remember"
                className="w-4 h-4 rounded border-2 border-white/60 bg-white/20 accent-white" />
              Onthoud mij
            </label>
            <button type="button" onClick={onForgot} data-testid="mobile-login-forgot"
              className="text-white/90 font-bold underline underline-offset-2">
              Wachtwoord vergeten?
            </button>
          </div>

          {/* Submit */}
          <button type="submit" disabled={loading} data-testid="mobile-login-submit"
            className="w-full h-14 mt-2 bg-white text-[#0F0F0F] rounded-full text-lg font-black shadow-[0_8px_20px_-6px_rgba(0,0,0,0.35)] active:scale-[0.97] transition-all disabled:opacity-60 flex items-center justify-center gap-2">
            {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : (
              <><LogIn className="w-5 h-5" /> Inloggen</>
            )}
          </button>

          {/* Registreer link — alleen op generieke /login (geen branded portal).
              Navigeer naar het MARKETING domein (publicMarketingUrl) zodat dit
              ook op split-domain productie (app.surirent.sr → surirent.sr) werkt;
              op het app-subdomein zou `/` de LoginPage tonen i.p.v. de landing. */}
          {!branding?.slug && (
            <p className="text-center text-white/85 text-sm font-medium pt-3">
              Nog geen account?{' '}
              <button type="button" onClick={() => { window.location.assign(`${publicMarketingUrl()}/?register=1`); }}
                data-testid="mobile-login-to-register"
                className="font-extrabold text-white underline underline-offset-2">
                Registreer hier
              </button>
            </p>
          )}
        </form>
      </div>
    </OrangeShell>
  );
}

// =====================================================================
// MobileRegisterWizard — orange full-screen 4-stappen registratie.
// Stappen:
//   1) Bedrijf       (companyName + address)
//   2) Persoon       (name + telefoon)
//   3) Account       (email + wachtwoord)
//   4) Pakket+Land   (country + plan) → submit
// =====================================================================
const STEPS = ['Bedrijf', 'Persoon', 'Account', 'Pakket'];

// Gedeelde registratie-logica voor mobiele en desktop wizard.
export function useRegisterWizard({ onClose, initialPlan = 'starter' }) {
  const { register } = useAuth();

  const [step, setStep] = useState(0);
  const [companyName, setCompanyName] = useState('');
  const [address, setAddress] = useState('');
  const [name, setName] = useState('');
  const [telefoon, setTelefoon] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [country, setCountry] = useState('SR');
  const [plan, setPlan] = useState(typeof initialPlan === 'string' && initialPlan ? initialPlan : 'starter');
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [registeredSlug, setRegisteredSlug] = useState('');

  // Plans laden zodra we naar stap 4 gaan (of bij country change).
  // Óók eagerly laden wanneer bezoeker met initialPlan is gekomen, zodat de
  // "U koos: <naam>" badge direct de leesbare naam kan tonen ipv de plan-id.
  useEffect(() => {
    if (step !== 3 && !initialPlan) return;
    const q = country === 'NL' ? '?currency=EUR' : '?currency=SRD';
    api.get(`/billing/plans${q}`).then((r) => setPlans(r.data)).catch(() => setPlans([]));
  }, [step, country, initialPlan]);

  // Naam van het gekozen plan voor de sticky "U koos"-badge.
  // Val terug op capitalized plan-id als de catalog nog niet geladen is
  // zodat er nooit een lege badge staat.
  const chosenPlanName = useMemo(() => {
    if (!initialPlan) return '';
    const doc = plans.find((p) => p.id === plan);
    if (doc?.name) return doc.name;
    return plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : '';
  }, [plans, plan, initialPlan]);

  // Live slug preview met beschikbaarheidscheck (alleen op stap 0)
  const portalPreview = useMemo(() => {
    const raw = (companyName || '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    if (!raw) return { slug: '', host: '' };
    const slug = RESERVED_SLUGS.has(raw) ? `${raw}-bedrijf` : raw;
    let host = '';
    try { host = (window.location.host || '').replace(/:.*$/, ''); } catch { /* ignore */ }
    return { slug, host };
  }, [companyName]);

  const [slugStatus, setSlugStatus] = useState('idle');
  useEffect(() => {
    const s = portalPreview.slug;
    if (!s) { setSlugStatus('idle'); return undefined; }
    setSlugStatus('checking');
    const h = setTimeout(async () => {
      try {
        const { data } = await api.get(`/public/companies/${encodeURIComponent(s)}/available`);
        setSlugStatus(data?.available ? 'available' : (data?.reason || 'taken'));
      } catch { setSlugStatus('idle'); }
    }, 350);
    return () => clearTimeout(h);
  }, [portalPreview.slug]);

  // Wat moet ingevuld zijn om naar volgende stap te mogen?
  const stepValid = (() => {
    if (step === 0) return companyName.trim().length >= 2 && slugStatus !== 'taken';
    if (step === 1) return name.trim().length >= 2;
    if (step === 2) return /\S+@\S+\.\S+/.test(email) && password.length >= 6;
    if (step === 3) return Boolean(country && plan);
    return false;
  })();

  const submit = async () => {
    setLoading(true); setError('');
    try {
      const result = await register({
        name: name.trim(),
        email: email.trim(),
        password,
        company_name: companyName.trim(),
        telefoon: telefoon.trim(),
        address: address.trim(),
        plan,
        country,
        slug: portalPreview.slug,
      });
      const newSlug = result?.company?.slug || '';
      if (newSlug) setRegisteredSlug(newSlug);
      setSuccess(true);
    } catch (e) {
      setError(formatError(e, 'Registratie mislukt'));
    } finally { setLoading(false); }
  };

  const next = () => {
    setError('');
    if (!stepValid) return;
    if (step < 3) setStep((s) => s + 1);
    else submit();
  };
  const prev = () => {
    setError('');
    if (step === 0) onClose?.();
    else setStep((s) => s - 1);
  };

  const goToPortal = () => {
    if (registeredSlug) window.location.assign(`/${registeredSlug}/admin`);
    else window.location.assign('/admin');
  };
  return { step, setStep, companyName, setCompanyName, address, setAddress, name, setName, telefoon, setTelefoon, email, setEmail, password, setPassword, showPw, setShowPw, country, setCountry, plan, setPlan, plans, loading, error, success, chosenPlanName, portalPreview, slugStatus, stepValid, next, prev, goToPortal };
}

export function MobileRegisterWizard({ onClose, primary = '#FF5C00', initialPlan = 'starter' }) {
  const {
    step, setStep, companyName, setCompanyName, address, setAddress, name, setName, telefoon, setTelefoon, email, setEmail, password, setPassword, showPw, setShowPw, country, setCountry, plan, setPlan, plans, loading, error, success, chosenPlanName, portalPreview, slugStatus, stepValid, next, prev, goToPortal,
  } = useRegisterWizard({ onClose, initialPlan });

  // ───────────── SUCCESS VIEW ─────────────
  if (success) {
    return (
      <OrangeShell primary={primary}>
        <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 text-center">
          <div className="w-20 h-20 rounded-full bg-white flex items-center justify-center mb-5 shadow-2xl">
            <Check className="w-12 h-12 text-emerald-500" strokeWidth={3} />
          </div>
          <h2 className="text-3xl font-black text-white tracking-tight mb-2">Welkom!</h2>
          <p className="text-white/90 font-medium mb-1">{companyName}</p>
          <p className="text-white/80 text-sm mb-8 max-w-sm">
            Je eigen vastgoed-omgeving is aangemaakt en klaar voor gebruik. 14 dagen gratis proberen.
          </p>
          <button onClick={goToPortal} data-testid="register-success-continue"
            className="w-full max-w-sm h-14 bg-white text-[#0F0F0F] rounded-full text-lg font-black shadow-[0_8px_20px_-6px_rgba(0,0,0,0.35)] active:scale-[0.97] transition-all flex items-center justify-center gap-2">
            Naar mijn dashboard
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </OrangeShell>
    );
  }

  // ───────────── WIZARD VIEW ─────────────
  return (
    <OrangeShell primary={primary}>
      {/* Content-clamp: fullscreen op mobiel, gecenterde max-2xl kolom
          op desktop zodat het formulier niet gestretched aanvoelt.
          De oranje achtergrond blijft volledig doorlopen. */}
      <div className="relative z-10 flex flex-col flex-1 min-h-0 w-full mx-auto md:max-w-2xl md:px-4 md:py-6">
      {/* TOP: terug-knop + logo + close-knop */}
      <div className="flex items-center justify-between px-5"
        style={{ paddingTop: 'clamp(12px, 2vh, 24px)', paddingBottom: 'clamp(8px, 1.5vh, 16px)' }}>
        <button onClick={prev} data-testid="register-back"
          className="flex items-center gap-2 px-3 py-2 rounded-full bg-white/15 hover:bg-white/25 backdrop-blur-sm border border-white/20 text-white text-sm font-bold">
          <ArrowLeft className="w-4 h-4" />
          {step === 0 ? 'Sluiten' : 'Vorige'}
        </button>
        {/* SuriRent brand-mark — bevestigt aan de gebruiker dat ze
            zich op de juiste service registreren. Klein en subtiel
            zodat het niet met de step-titel concurreert. */}
        <div className="flex items-center gap-2 select-none pointer-events-none">
          <div className="w-8 h-8 rounded-xl bg-white/95 shadow-[0_2px_8px_-2px_rgba(0,0,0,0.25)] flex items-center justify-center">
            <img loading="lazy" src="/kiosk-icons/kiosk-192.png" alt="SuriRent"
              className="w-6 h-6 object-contain"
              onError={(e) => { e.currentTarget.style.display = 'none'; }} />
          </div>
          <span className="hidden sm:inline text-white font-black text-sm tracking-tight">SuriRent</span>
        </div>
        <button onClick={onClose} data-testid="register-close"
          className="w-9 h-9 rounded-full bg-white/15 hover:bg-white/25 backdrop-blur-sm border border-white/20 flex items-center justify-center text-white"
          aria-label="Sluiten">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Progress dots */}
      <div className="relative z-10 flex items-center justify-center gap-2 mb-3 px-5">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <span className={`h-1.5 rounded-full transition-all ${
              i === step ? 'w-8 bg-white' : i < step ? 'w-4 bg-white/80' : 'w-4 bg-white/30'
            }`} />
          </div>
        ))}
      </div>

      {/* "U koos"-badge — verschijnt op elke stap zolang de bezoeker via een
          plan-CTA op de landing binnenkwam (initialPlan). Bevestigt de keuze
          zodat de wizard niet aanvoelt als "wat kies ik eigenlijk?". Op stap 3
          zelf verbergen we hem — daar staan de plan-kaarten zichtbaar. */}
      {chosenPlanName && step !== 3 && (
        <div className="relative z-10 flex items-center justify-center mb-3 px-5"
          data-testid="chosen-plan-badge">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white text-[#FF5C00] shadow-[0_6px_16px_-6px_rgba(0,0,0,0.35)]">
            <Sparkles className="w-3.5 h-3.5" />
            <span className="text-[11px] font-black tracking-[0.18em] uppercase">
              U koos: {chosenPlanName}
            </span>
          </div>
        </div>
      )}

      {/* Eyebrow + titel per stap */}
      <div className="relative z-10 px-6 mb-4">
        <p className="text-white/70 text-xs font-black tracking-[0.32em] uppercase">
          Stap {step + 1} van {STEPS.length} · {STEPS[step]}
        </p>
        <h1 className="font-black tracking-tight text-white mt-1"
          style={{ fontSize: 'clamp(24px, 4.2vh, 36px)', lineHeight: '1.05' }}>
          {step === 0 && <>Hoe heet je bedrijf?</>}
          {step === 1 && <>Hoe mogen we je<br />noemen?</>}
          {step === 2 && <>Maak je<br />account aan</>}
          {step === 3 && <>Kies je pakket</>}
        </h1>
        {step === 3 && (
          <div className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/15 backdrop-blur-sm border border-white/20">
            <Sparkles className="w-3.5 h-3.5" />
            <span className="text-[10px] font-extrabold tracking-[0.18em] uppercase">14 dagen gratis</span>
          </div>
        )}
      </div>

      {/* Form per stap (scrollable middle) */}
      <div className="relative z-10 flex-1 min-h-0 overflow-y-auto px-6 pb-4" style={{ WebkitOverflowScrolling: 'touch' }}>

        {error && (
          <div className="mb-3 px-4 py-2 rounded-full bg-red-500/95 text-white text-xs font-bold shadow-lg text-center"
            data-testid="register-error">
            {error}
          </div>
        )}

        {/* STAP 0 — Bedrijf */}
        {step === 0 && (
          <div className="space-y-3">
            {/* Snelle registratie via Google — één klik i.p.v. 4 stappen.
                Verschijnt alleen op de eerste stap zodat gebruikers die
                al bezig zijn niet worden afgeleid. */}
            <button type="button" onClick={() => {
                const redirectUrl = window.location.origin + '/auth/callback';
                window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
              }}
              data-testid="register-google-btn"
              className="w-full h-14 rounded-full bg-white text-slate-800 text-sm font-black flex items-center justify-center gap-2.5 shadow-[0_4px_12px_-4px_rgba(0,0,0,0.25)] active:scale-95 transition">
              <svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Snel registreren met Google
            </button>
            <div className="relative py-1">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/25" /></div>
              <div className="relative flex justify-center">
                <span className="bg-transparent px-3 text-white/70 text-[10px] font-bold uppercase tracking-widest">of vul zelf in</span>
              </div>
            </div>
            <input type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)}
              data-testid="register-company" autoFocus
              placeholder="Bedrijfsnaam (bv. Demo Vastgoed N.V.)"
              className="w-full h-14 px-5 rounded-full bg-white text-slate-900 text-base font-medium placeholder:text-slate-400 outline-none shadow-[0_4px_12px_-4px_rgba(0,0,0,0.2)] focus:ring-4 focus:ring-white/30" />
            {portalPreview.slug && (
              <div className={`flex items-center gap-2 px-4 py-2 rounded-full border text-xs font-bold ${
                slugStatus === 'taken' ? 'bg-rose-500/20 border-rose-300/40 text-white' : 'bg-emerald-500/20 border-emerald-300/40 text-white'
              }`}>
                <Globe className="w-3.5 h-3.5 shrink-0" />
                <span className="font-mono truncate flex-1">{portalPreview.host || 'app.surirent.sr'}/{portalPreview.slug}</span>
                {slugStatus === 'checking' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {slugStatus === 'available' && <span>✓ VRIJ</span>}
                {slugStatus === 'taken' && <span>✗ BEZET</span>}
              </div>
            )}
            <input type="text" value={address} onChange={(e) => setAddress(e.target.value)}
              data-testid="register-address"
              placeholder="Adres (optioneel)"
              className="w-full h-14 px-5 rounded-full bg-white text-slate-900 text-base font-medium placeholder:text-slate-400 outline-none shadow-[0_4px_12px_-4px_rgba(0,0,0,0.2)] focus:ring-4 focus:ring-white/30" />
          </div>
        )}

        {/* STAP 1 — Persoon */}
        {step === 1 && (
          <div className="space-y-3">
            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              data-testid="register-name" autoFocus
              placeholder="Voor- en achternaam"
              className="w-full h-14 px-5 rounded-full bg-white text-slate-900 text-base font-medium placeholder:text-slate-400 outline-none shadow-[0_4px_12px_-4px_rgba(0,0,0,0.2)] focus:ring-4 focus:ring-white/30" />
            <input type="tel" value={telefoon} onChange={(e) => setTelefoon(e.target.value)}
              data-testid="register-phone"
              placeholder="Telefoon (optioneel)"
              className="w-full h-14 px-5 rounded-full bg-white text-slate-900 text-base font-medium placeholder:text-slate-400 outline-none shadow-[0_4px_12px_-4px_rgba(0,0,0,0.2)] focus:ring-4 focus:ring-white/30" />
          </div>
        )}

        {/* STAP 2 — Account */}
        {step === 2 && (
          <div className="space-y-3">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              data-testid="register-email" autoFocus autoComplete="email"
              placeholder="E-mailadres"
              className="w-full h-14 px-5 rounded-full bg-white text-slate-900 text-base font-medium placeholder:text-slate-400 outline-none shadow-[0_4px_12px_-4px_rgba(0,0,0,0.2)] focus:ring-4 focus:ring-white/30" />
            <div className="relative">
              <input type={showPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                data-testid="register-password" minLength={6} autoComplete="new-password"
                placeholder="Wachtwoord (min. 6 tekens)"
                className="w-full h-14 px-5 pr-14 rounded-full bg-white text-slate-900 text-base font-medium placeholder:text-slate-400 outline-none shadow-[0_4px_12px_-4px_rgba(0,0,0,0.2)] focus:ring-4 focus:ring-white/30" />
              <button type="button" onClick={() => setShowPw((s) => !s)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                {showPw ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            <div className="px-2">
              <PasswordStrength password={password} variant="dark" />
            </div>
          </div>
        )}

        {/* STAP 3 — Pakket + land */}
        {step === 3 && (
          <div className="space-y-3">
            <p className="text-white/80 text-xs font-black tracking-wider uppercase">Land & valuta</p>
            <div className="grid grid-cols-2 gap-2.5">
              {[
                { code: 'SR', flag: '🇸🇷', label: 'Suriname', sub: 'SRD' },
                { code: 'NL', flag: '🇳🇱', label: 'Nederland', sub: 'EUR' },
              ].map((c) => {
                const sel = country === c.code;
                return (
                  <button key={c.code} type="button" onClick={() => setCountry(c.code)}
                    data-testid={`register-country-${c.code.toLowerCase()}`}
                    className={`h-14 rounded-2xl border-2 transition-all flex items-center justify-center gap-2 ${
                      sel ? 'bg-white text-slate-900 border-white shadow-lg' : 'bg-white/10 text-white border-white/30'
                    }`}>
                    <span className="text-xl leading-none">{c.flag}</span>
                    <div className="text-left leading-tight">
                      <div className="font-extrabold text-sm">{c.label}</div>
                      <div className="text-[10px] opacity-70">{c.sub}</div>
                    </div>
                  </button>
                );
              })}
            </div>

            <p className="text-white/80 text-xs font-black tracking-wider uppercase mt-3">Kies je pakket</p>
            {plans.length === 0 ? (
              <div className="h-20 flex items-center justify-center text-white/60 text-sm">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            ) : (
              <div className="space-y-2">
                {plans.map((p) => {
                  const sel = plan === p.id;
                  return (
                    <button key={p.id} type="button" onClick={() => setPlan(p.id)}
                      data-testid={`register-plan-${p.id}`}
                      className={`w-full text-left rounded-2xl border-2 p-4 transition-all flex items-center justify-between ${
                        sel ? 'bg-white text-slate-900 border-white shadow-lg' : 'bg-white/10 text-white border-white/30'
                      }`}>
                      <div className="min-w-0">
                        <p className={`font-extrabold text-base ${sel ? 'text-slate-900' : 'text-white'}`}>{p.name}</p>
                        <p className={`text-xs mt-0.5 ${sel ? 'text-slate-500' : 'text-white/70'} truncate`}>{p.description}</p>
                      </div>
                      <p className={`text-xl font-black whitespace-nowrap ${sel ? 'text-[#FF5C00]' : 'text-white'}`}>
                        {(p.currency || 'SRD').toUpperCase() === 'EUR'
                          ? `€${Number(p.amount).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          : `${p.currency} ${Number(p.amount).toLocaleString('nl-NL')}`}
                        <span className={`text-[10px] font-medium ml-1 ${sel ? 'text-slate-400' : 'text-white/60'}`}>/m</span>
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* BOTTOM: primary action button */}
      <div className="px-6 pb-6 pt-2 shrink-0">
        <button onClick={next} disabled={!stepValid || loading} data-testid="register-next"
          className="w-full h-14 bg-white text-[#0F0F0F] rounded-full text-lg font-black shadow-[0_8px_20px_-6px_rgba(0,0,0,0.35)] active:scale-[0.97] transition-all disabled:opacity-50 flex items-center justify-center gap-2">
          {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : (
            <>
              {step < 3 ? 'Volgende' : 'Account aanmaken'}
              <ArrowRight className="w-5 h-5" />
            </>
          )}
        </button>
      </div>
      </div>{/* /content-clamp */}
    </OrangeShell>
  );
}
