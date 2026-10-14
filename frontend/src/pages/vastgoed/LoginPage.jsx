import { useState, useEffect } from 'react';
import { setIosStatusBar } from '../../lib/ios-status-bar';
import { useSearchParams } from 'react-router-dom';
import { useBrandedNavigate } from '../../lib/branded-nav';
import { useAuth } from '../../lib/auth';
import {
  setPreferredRole, isStandalonePWA, getPreferredRole, routeForRole,
} from '../../lib/pwaRole';
import {
  detectCompanySlug, fetchBranding, fetchBrandingByHost, applyBranding,
  resolveLogoUrl, readCachedBranding, clearBrandingCache,
} from '../../lib/branding';
import PinLanding from './auth/PinLogin';
import PasswordView from './auth/EmailLogin';
import RegisterModal from '../../components/RegisterModal';
import PwaOnboarding, { PWA_ONBOARDING_KEY } from '../../components/PwaOnboarding';
import { useHidePwaSplash } from '../../lib/use-hide-pwa-splash';


// =============================================================================
// LoginPage — orchestreert branding-detection en kiest welke auth-view (PIN of
// e-mail/wachtwoord) wordt getoond. Alle deel-componenten zijn opgesplitst in
// /app/frontend/src/pages/vastgoed/auth/ voor onderhoudbaarheid.
// =============================================================================
export default function LoginPage() {
  useHidePwaSplash();
  const navigate = useBrandedNavigate();
  const [searchParams] = useSearchParams();
  const { user, loading, refresh } = useAuth();
  // Initial view from ?view=admin or ?view=register query string (e.g. when arriving
  // from the Kiosk "Beheerder" button or a marketing CTA). Defaults to PIN keypad.
  const initialView = (() => {
    const v = (searchParams.get('view') || '').toLowerCase();
    if (v === 'admin' || v === 'login' || v === 'password') return 'login';
    if (v === 'register' || v === 'signup') return 'register';
    if (v === 'pin') return 'pin';   // explicit PIN view (for testing / branded entry)
    // Shortcut: ?register=1 from marketing topbar
    if (searchParams.get('register') === '1') return 'register';
    // Desktop default: skip PIN keypad and show email login form directly.
    // Mobile keeps PIN-first flow (more tactile + branded). We detect via
    // viewport width on initial render — a no-op on SSR (window check).
    try {
      if (typeof window !== 'undefined' && window.innerWidth >= 1024) return 'login';
    } catch { /* noop */ }
    return 'pin';
  })();
  const [view, setView] = useState(initialView);
  const [skipRedirect, setSkipRedirect] = useState(false);
  // Als de PIN succesvol was gaan we in "authenticating"-mode: we tonen
  // een oranje overlay met het huis-icoon + spinner totdat de navigatie
  // naar /admin is afgerond. Zonder deze mask flitst de numpad tussen
  // PIN-success en de router-transitie doordat AuthProvider's user-state
  // pas op de volgende render cycle beschikbaar is.
  const [authenticating, setAuthenticating] = useState(false);

  // ────────────────────────────────────────────────────────────────────
  // PWA Onboarding — eerste-keer welkom-scherm na PWA installatie.
  // Toont 3 keuzes (nieuw bedrijf / inloggen / huurder) als:
  //   1) De gebruiker komt vanaf de PWA (?source=pwa of standalone mode)
  //   2) Er nog geen keuze is opgeslagen in localStorage
  //   3) Generieke /login (geen branding.slug — branded portals slaan dit over)
  // ────────────────────────────────────────────────────────────────────
  const [showOnboarding, setShowOnboarding] = useState(() => {
    try {
      const fromPwa = searchParams.get('source') === 'pwa' || isStandalonePWA();
      if (!fromPwa) return false;
      const saved = localStorage.getItem(PWA_ONBOARDING_KEY);
      // Als al eerder gekozen, sla onboarding over.
      if (saved) return false;
      // Na uitloggen (?loggedout=1) willen we NIET opnieuw onboarding tonen —
      // de gebruiker weet inmiddels wat hij doet en wil direct inloggen.
      if (searchParams.get('loggedout') === '1') return false;
      // ?view=login of ?view=register expliciet meegegeven? → sla onboarding over.
      const v = (searchParams.get('view') || '').toLowerCase();
      if (v) return false;
      if (searchParams.get('register') === '1') return false;
      // ?target=kiosk of ?target=admin uit manifest shortcut? → sla over (zij weten wat ze willen).
      if (searchParams.get('target')) return false;
      return true;
    } catch { return false; }
  });

  const handleOnboardingChoice = (choice) => {
    setShowOnboarding(false);
    if (choice === 'bedrijf') {
      // Op productie is de marketing landing op een ANDER domein (surirent.sr)
      // dan de app (app.surirent.sr). In een geïnstalleerde PWA valt navigatie
      // naar dat externe domein buiten de PWA-scope → de browser opent hem
      // extern of de standalone-modus breekt. We tonen daarom de
      // registratie-wizard DIRECT in-page via `view=register` (die rendert
      // dan RegisterModal → MobileRegisterWizard).
      setView('register');
      try { window.history.replaceState(null, '', `${window.location.pathname}?view=register`); } catch { /* noop */ }
    } else if (choice === 'huurder') {
      window.location.assign('/huurder');
    } else {
      // 'login' — blijf op /login en toon email/wachtwoord (of PIN op branded).
      setView('login');
    }
  };

  // ────────────────────────────────────────────────────────────────────
  // Registratie modal-redirect — wanneer iemand op /login?register=1 of
  // /login?view=register komt (bookmark, oude links, marketing CTA),
  // sturen we hem terug naar de landing met de popup direct open.
  // De register-pagina bestaat namelijk niet meer als losse view.
  //
  // BELANGRIJK: alleen op de GENERIEKE /login route. Op een branded
  // /<slug>/login is registreren niet relevant — klanten loggen daar
  // alleen in, er wordt geen nieuw bedrijf aangemaakt.
  // ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (initialView !== 'register') return;
    try {
      const path = window.location.pathname || '';
      // Plain /login met initialView=register → toon in-page register wizard
      // (RegisterModal). Branded /<slug>/login → laat zoals het is (register
      // view forceert daar zelf "alleen inloggen" mode).
      if (/^\/login(\/|$)/i.test(path)) {
        setView('register');
      }
    } catch { /* ignore */ }
  }, [initialView]);

  // Branding state — start from cache for instant render, then fetch fresh.
  const [branding, setBranding] = useState(() => {
    const cached = readCachedBranding();
    if (cached) {
      return { ...cached, _logoResolved: resolveLogoUrl(cached.logo_url) };
    }
    return null;
  });

  useEffect(() => {
    // document.title wordt centraal beheerd door usePwaManifest()
  }, []);

  // Login is volledig brand-oranje. We zetten body+#root in PWA standalone
  // op oranje (via body class) zodat het home-indicator gebied en eventuele
  // 1px doorlek aan de notch dezelfde kleur tonen.
  // NB: theme-color wordt NIET meer hier overschreven — dat gaf
  // flikkering op Android tussen /login → /admin. Centrale waarde
  // (#FFFFFF donker-oranje) staat in index.html.
  useEffect(() => {
    const primary = (branding?.primary_color || '#FF5C00');
    document.body.classList.add('login-mode');
    setIosStatusBar(getComputedStyle(document.body).getPropertyValue('--login-bg').trim() || '#FF5C00');
    document.documentElement.classList.add('login-mode-html');
    document.body.style.setProperty('--login-bg', primary);
    document.documentElement.style.setProperty('--login-bg', primary);
    return () => {
      document.body.classList.remove('login-mode');
      setIosStatusBar('#F7F8FA');
      document.documentElement.classList.remove('login-mode-html');
      document.body.style.removeProperty('--login-bg');
      document.documentElement.style.removeProperty('--login-bg');
    };
  }, [branding]);

  // PWA bedrijfs-context fallback. Wanneer iOS Safari de oude (verkeerde)
  // start_url heeft gecaptured (`/login` zonder slug) maar de gebruiker
  // eerder een bedrijfs-tenant heeft bezocht, redirecten we automatisch
  // naar `/<slug>/login` zodat de PIN-flow en branding correct laden.
  //
  // Dit is een vangnet voor het iOS PWA install-cache probleem waar de
  // start_url is geboekt vóór onze slug-aware manifest fix. Een normale
  // hard refresh kan iOS niet zomaar overrulen — vandaar deze in-app redir.
  useEffect(() => {
    try {
      const path = (window.location.pathname || '').toLowerCase();
      // Alleen op de generieke /login (niet al binnen een /<slug>/login).
      const onPlainLogin = path === '/login' || path === '/login/';
      if (!onPlainLogin) return;
      // Alleen wanneer er ECHT geen slug in de URL zit (geen ?c=, geen /c/<slug>).
      const params = new URLSearchParams(window.location.search);
      if (params.get('c')) return;
      // We vertrouwen op de eerder opgeslagen slug uit localStorage. Die
      // wordt gezet door BrandedShell bij elk bezoek aan /<slug>/...
      const stored = (typeof window !== 'undefined' && window.localStorage)
        ? (window.localStorage.getItem('pwa_company_slug') || '').trim().toLowerCase()
        : '';
      if (!stored) return;
      // Slug-shape sanity check (a-z, 0-9, dashes).
      if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(stored)) return;
      // Bouw target met behoud van bestaande query params (source=pwa, view=admin etc.)
      const qs = window.location.search || '';
      const next = `/${stored}/login${qs}`;
      window.location.replace(next);
    } catch { /* noop */ }
  }, []);

  // Resolve and apply company branding on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const slug = detectCompanySlug();
      let data = slug ? await fetchBranding(slug) : null;
      // Last resort: ask the backend based on the Host header (works for wildcard DNS
      // setups where the slug detector couldn't read window.location.hostname reliably).
      if (!data) {
        data = await fetchBrandingByHost();
      }
      if (cancelled) return;
      if (!data) {
        clearBrandingCache();
        setBranding(null);
        return;
      }
      const enriched = { ...data, _logoResolved: resolveLogoUrl(data.logo_url) };
      applyBranding(data);
      setBranding(enriched);
      // document.title wordt centraal beheerd door usePwaManifest()
    })();
    return () => { cancelled = true; };
  }, []);

  // PWA shortcut target. Two PWA app icons:
  //   /login?source=pwa&target=kiosk → after PIN, go to /kiosk
  //   /login?source=pwa&target=admin → after PIN, go to /admin (PIN gives both tokens)
  // Defaults to 'kiosk' (the original Kiosk-first PWA experience).
  const pwaTarget = (() => {
    const t = (searchParams.get('target') || '').toLowerCase();
    return t === 'admin' ? 'admin' : 'kiosk';
  })();

  // PWA: if user has a stored preferred role AND a still-valid token for that role,
  // jump directly to that surface (kiosk / admin / tenant). The token-check prevents
  // redirect loops when a token has expired or been revoked.
  // If the URL contains an explicit `target`, prefer that over the stored role so
  // the Beheer-shortcut always lands on /admin (or its PIN-gate) and not on /kiosk.
  useEffect(() => {
    if (!isStandalonePWA()) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('pick') === '1') return; // explicit override: show login picker
    if (params.get('view')) return; // explicit view override → respect it
    const targetParam = (params.get('target') || '').toLowerCase();
    const role = targetParam === 'admin' ? 'admin'
      : targetParam === 'kiosk' ? 'kiosk'
      : getPreferredRole();
    if (!role) return;
    const tokenKey = role === 'admin' ? 'admin_token'
      : role === 'tenant' ? 'tenant_token'
      : 'kiosk_token';
    let hasToken = false;
    try { hasToken = !!localStorage.getItem(tokenKey); } catch { /* ignore */ }
    if (!hasToken) return;
    navigate(routeForRole(role), { replace: true });
  }, [navigate]);

  // Bij ?loggedout=1 (uit doLogout) → forceer AuthProvider om /auth/me
  // opnieuw op te halen. Als de cookies correct zijn gewist retourneert
  // dat 401 → user=null en Safari kan geen "spookje" cached user tonen.
  useEffect(() => {
    if (searchParams.get('loggedout') === '1') {
      try { refresh?.(); } catch { /* noop */ }
    }
    // Alleen bij eerste mount uitvoeren; dependency op de searchParams zorgt
    // dat we niet in een loop komen wanneer AuthProvider zelf reagerend
    // updatet.
    // eslint-disable-next-line
  }, []);

  // Auto-redirect if already logged (but not when we're showing the success screen
  // OR wanneer er een pending QR claim is — de submit-handler zelf navigeert dan
  // naar /qr-link?token=... en deze useEffect zou dat anders overschrijven met
  // /admin (race-conditie). OOK niet als ?loggedout=1 in de URL staat — dat is
  // een signaal van doLogout dat Safari's cached auth-cookie mogelijk nog
  // meekomt; forceer dat de gebruiker de login-form ziet i.p.v. terug te
  // springen naar admin.
  useEffect(() => {
    if (searchParams.get('loggedout') === '1') return;
    if (!loading && user && !skipRedirect) {
      let hasPendingQr = false;
      try { hasPendingQr = !!sessionStorage.getItem('pending_qr_token'); } catch { /* ignore */ }
      if (hasPendingQr) return;
      navigate('/admin', { replace: true });
    }
  }, [user, loading, navigate, skipRedirect, searchParams]);

  // ────────────────────────────────────────────────────────────────────
  // PWA Onboarding heeft voorrang op alle andere views — alleen voor
  // eerste-keer PWA gebruikers zonder branded context en zonder ingelogde
  // user. Branded portals (/<slug>/login) tonen direct hun PIN-pad.
  // ────────────────────────────────────────────────────────────────────
  if (showOnboarding && !branding?.slug && !user) {
    return (
      <PwaOnboarding onChoice={handleOnboardingChoice} primary={branding?.primary_color || '#FF5C00'} />
    );
  }

  // View-state 'register' opent nu de nieuwe oranje step-wizard
  // (RegisterModal → MobileRegisterWizard) i.p.v. het oude compacte
  // PasswordView 'register' formulier. Consistente flow met de landing
  // page en betere UX (Google-shortcut, progress dots, grote inputs).
  if (view === 'register') {
    // Terugkeren naar login zodra wizard gesloten wordt zonder submit.
    // Als de wizard succesvol een account aanmaakt logt useAuth in
    // en de auto-redirect naar /admin (regel ~250) neemt het over.
    return <RegisterModal open={true} onClose={() => setView('pin')} />;
  }

  if (view === 'login') {
    return (
      <PasswordView initialMode={view} onBack={() => setView('pin')}
        onRegistered={() => setSkipRedirect(true)} branding={branding} />
    );
  }

  // Geen bedrijfs-context (gebruiker is op generieke `/login`, niet op
  // `/<slug>/login`)? → PIN-login is hier zinloos en zou onveilig zijn
  // (kruis-bedrijf matching). Toon direct het e-mail+wachtwoord formulier.
  // Klanten openen de PIN-flow alleen via hun branded URL.
  if (!branding?.slug) {
    return (
      <PasswordView initialMode="login" onBack={() => {}}
        onRegistered={() => setSkipRedirect(true)} branding={null} />
    );
  }

  // After PIN-success, navigate to the target surface. Both shortcuts require
  // PIN entry; the difference is only where the user lands afterwards.
  // BELANGRIJK: medewerker-PIN logins krijgen GEEN admin_token, dus we sturen
  // ze altijd naar /kiosk — ook als ze de "Beheer"-shortcut hebben gebruikt.
  //
  // SOFT NAVIGATIE: vroeger deden we `window.location.assign('/admin')` zodat
  // AuthProvider /auth/me opnieuw uitvoerde. Dat veroorzaakte echter een
  // full page reload + spinner flash. We doen nu refresh() (vernieuw /auth/me
  // in dezelfde React tree) en daarna een soft navigate. Geen flash, instant.
  const onPinSuccess = async (forced) => {
    setAuthenticating(true); // mask numpad totdat navigate klaar is
    if (forced === 'kiosk') { navigate('/kiosk', { replace: true }); return; }
    let hasAdmin = false;
    try { hasAdmin = !!localStorage.getItem('admin_token'); } catch { /* ignore */ }
    if ((pwaTarget === 'admin' || forced === 'admin') && hasAdmin) {
      setPreferredRole('admin');
      // Refresh AuthProvider zodat de nieuwe admin_token meteen actief is.
      // Soft navigate naar /admin nadat user state is bijgewerkt.
      try { await refresh(); } catch { /* niet-fataal */ }
      navigate('/admin', { replace: true });
    } else {
      navigate('/kiosk', { replace: true });
    }
  };

  // Wanneer authenticating aan staat, toon een oranje huis-splash i.p.v.
  // PinLanding — voorkomt de numpad-flikker die de gebruiker meldde.
  if (authenticating) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center z-50"
        style={{ background: '#FFF7F0' }}
        data-testid="pwa-auth-splash">
        <div className="w-28 h-28 flex items-center justify-center animate-pulse">
          <svg width="112" height="112" viewBox="0 0 24 24" fill="none" stroke="#FF5C00" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-label="Laden">
            <path d="M3 9.5L12 3l9 6.5V21a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1V9.5z" fill="#FF5C00" fillOpacity="0.08" />
          </svg>
        </div>
        <div className="mt-6 flex gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[#FF5C00] animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-2 h-2 rounded-full bg-[#FF5C00] animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-2 h-2 rounded-full bg-[#FF5C00] animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
        <p className="mt-5 text-xs font-black tracking-[0.24em] uppercase text-[#FF5C00]/75">
          Inloggen…
        </p>
      </div>
    );
  }

  return (
    <PinLanding
      branding={branding}
      pwaTarget={pwaTarget}
      onSuccess={onPinSuccess}
      onPassword={() => setView('login')}
      onRegister={() => setView('register')}
    />
  );
}
