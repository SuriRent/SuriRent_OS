import { useCallback, useEffect, useState } from 'react';
import { X, Share, Plus } from 'lucide-react';
import { useLocation } from 'react-router-dom';

/**
 * Registers the service worker on mount.
 * Returns nothing visible; safe in production preview environments where
 * SW may not be available (silently no-ops).
 */
export function useRegisterServiceWorker() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV === 'development') return;
    let disposed = false;
    let registration = null;
    let interval = null;
    const hadController = !!navigator.serviceWorker.controller;
    let pendingReload = false;
    let reloadStarted = false;

    const safeReload = () => {
      if (reloadStarted) return;
      const onKiosk = /\/kiosk(\/|$)/.test(window.location.pathname);
      if (onKiosk && !window.__kioskSafeToReload) { pendingReload = true; return; }
      if (document.visibilityState !== 'visible') { pendingReload = true; return; }
      pendingReload = false;
      reloadStarted = true;
      window.location.reload();
    };
    const onKioskSafeToReload = () => {
      if (pendingReload) safeReload();
    };
    const onServiceWorkerMessage = (event) => {
      if (!hadController || event.data?.type !== 'SW_ACTIVATED' || !event.data.reload) return;
      pendingReload = true;
      safeReload();
    };
    const onControllerChange = () => {
      if (!hadController) return;
      pendingReload = true;
      safeReload();
    };
    const checkForUpdates = () => {
      if (!disposed) registration?.update().catch(() => {});
    };
    const onFocus = () => checkForUpdates();
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      if (pendingReload) safeReload();
      checkForUpdates();
    };
    const activate = (newWorker) => {
      const checkState = () => {
        if (newWorker.state === 'installed' && hadController) {
          newWorker.postMessage({ type: 'SKIP_WAITING' });
        }
      };
      newWorker.addEventListener('statechange', checkState);
      checkState();
    };
    const onUpdateFound = () => {
      if (registration?.installing) activate(registration.installing);
    };

    window.addEventListener('kiosk-safe-to-reload', onKioskSafeToReload);
    navigator.serviceWorker.addEventListener('message', onServiceWorkerMessage);
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);

    // Register on window load so we don't compete with critical render.
    const onReady = async () => {
      try {
        registration = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
        if (disposed) return;
        if (registration.waiting) activate(registration.waiting);
        if (registration.installing) activate(registration.installing);
        registration.addEventListener('updatefound', onUpdateFound);

        // Check at startup rather than waiting for the browser's next periodic check.
        checkForUpdates();
        interval = setInterval(checkForUpdates, 60_000);
      } catch (err) {
        console.warn('Service worker registration failed:', err);
      }
    };
    if (document.readyState === 'complete') onReady();
    else window.addEventListener('load', onReady, { once: true });

    return () => {
      disposed = true;
      if (interval) clearInterval(interval);
      registration?.removeEventListener('updatefound', onUpdateFound);
      window.removeEventListener('load', onReady);
      window.removeEventListener('kiosk-safe-to-reload', onKioskSafeToReload);
      navigator.serviceWorker.removeEventListener('message', onServiceWorkerMessage);
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);
}

const DISMISS_KEY = 'surirent_pwa_install_dismissed_at';
const DISMISS_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

/**
 * useBadge() — luistert naar BADGE_CHANGED van de service worker en
 * geeft de huidige in-app badge count terug. Reset met `clearBadge()`.
 * Stuur een CLEAR_BADGE message naar de SW zodat ook de OS-badge
 * (rode cijfer op het app-icoon) leeggemaakt wordt.
 */
export function useBadge() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const handler = (event) => {
      if (event.data && event.data.type === 'BADGE_CHANGED') {
        setCount(event.data.count || 0);
      }
    };
    navigator.serviceWorker.addEventListener('message', handler);
    return () => navigator.serviceWorker.removeEventListener('message', handler);
  }, []);
  // Stabiele referentie: anders draait `useEffect(clearBadge, [clearBadge])`
  // bij elke render opnieuw → CLEAR_BADGE ↔ BADGE_CHANGED pingpong met de SW.
  const clearBadge = useCallback(() => {
    setCount(0);
    // Headless/automatische browsers crashen op de Badging-API in de SW.
    if (navigator.webdriver) return;
    try {
      navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_BADGE' });
    } catch { /* noop */ }
  }, []);
  return { count, clearBadge };
}

function isIOS() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isIos = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
  const isIpadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return isIos || isIpadOS;
}

function isStandalone() {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

/**
 * Lightweight "Add to Home Screen" prompt.
 * - On Android/desktop Chromium: listens to beforeinstallprompt and shows a CTA
 *   that triggers the native install prompt.
 * - On iOS Safari (no beforeinstallprompt): shows the Share → Add to Home Screen tip.
 * - Hidden when already installed or recently dismissed.
 */
export function InstallPrompt() {
  const { pathname } = useLocation();
  const isSuperadmin = pathname === '/superadmin' || pathname.startsWith('/superadmin/');
  const dismissKey = isSuperadmin ? `${DISMISS_KEY}_superadmin` : DISMISS_KEY;
  const [deferred, setDeferred] = useState(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    const dismissed = parseInt(localStorage.getItem(dismissKey) || '0', 10);
    if (dismissed && Date.now() - dismissed < DISMISS_TTL_MS) return;

    const handler = (e) => {
      e.preventDefault();
      setDeferred(e);
      setShow(true);
    };
    window.addEventListener('beforeinstallprompt', handler);

    // iOS doesn't fire beforeinstallprompt — show after a short delay if iOS Safari.
    let timer;
    if (isIOS()) {
      timer = setTimeout(() => setShow(true), 4000);
    }
    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      if (timer) clearTimeout(timer);
    };
  }, [dismissKey]);

  const close = () => {
    setShow(false);
    localStorage.setItem(dismissKey, String(Date.now()));
  };

  const triggerInstall = async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice.catch(() => {});
    setDeferred(null);
    setShow(false);
  };

  if (!show) return null;
  const ios = isIOS();

  return (
    <div className={`fixed left-3 right-3 bottom-3 md:left-auto md:right-6 md:bottom-6 md:max-w-sm z-[60] bg-white rounded-2xl border-2 p-4 animate-slide-up ${
      isSuperadmin
        ? 'border-emerald-700 shadow-[0_14px_40px_-10px_rgba(4,120,87,0.4)]'
        : 'border-[#FF5C00] shadow-[0_14px_40px_-10px_rgba(255,92,0,0.5)]'
    }`}
      data-testid="pwa-install-prompt">
      <div className="flex items-start gap-3">
        <div className={`w-11 h-11 rounded-xl p-1 shrink-0 ${isSuperadmin ? 'bg-emerald-700' : 'bg-gradient-to-br from-[#FF8A3D] to-[#C74600] p-1.5'}`}>
          <img loading="lazy" src={isSuperadmin ? '/kiosk-icons/superadmin-192.png' : '/kiosk-icons/mark-white.png'}
            alt={isSuperadmin ? 'SuriRent Superadmin' : 'SuriRent'} className="w-full h-full object-contain rounded-lg" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-black text-slate-900 leading-tight">
            {isSuperadmin ? 'Installeer SuriRent Superadmin' : 'Installeer SuriRent'}
          </p>
          {ios ? (
            <p className="text-xs text-slate-600 mt-1 leading-snug">
              Tik op <Share className={`inline w-3.5 h-3.5 -mt-0.5 ${isSuperadmin ? 'text-emerald-700' : 'text-[#FF5C00]'}`} /> Delen
              {' '}en kies <span className="font-bold">"Zet op beginscherm"</span>.
              {isSuperadmin
                ? ' Laat "Open als webapp" ingeschakeld en tik op "Voeg toe". Open daarna SuriRent vanaf het nieuwe beginschermicoon; in Safari blijft de adresbalk zichtbaar.'
                : ' Open daarna SuriRent vanaf het nieuwe beginschermicoon.'}
            </p>
          ) : (
            <p className="text-xs text-slate-600 mt-1 leading-snug">
              Voeg {isSuperadmin ? 'SuriRent Superadmin' : 'SuriRent'} toe aan je startscherm voor sneller toegang — werkt ook offline.
            </p>
          )}
          {!ios && (
            <button onClick={triggerInstall} data-testid="pwa-install-btn"
              className={`mt-3 inline-flex items-center gap-1.5 px-3 h-9 rounded-lg text-white text-xs font-bold ${
                isSuperadmin ? 'bg-emerald-700 hover:bg-emerald-800' : 'bg-[#FF5C00] hover:bg-[#E05200]'
              }`}>
              <Plus className="w-3.5 h-3.5" /> Installeren
            </button>
          )}
        </div>
        <button onClick={close} data-testid="pwa-install-close"
          className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center shrink-0">
          <X className="w-4 h-4 text-slate-500" />
        </button>
      </div>
    </div>
  );
}
