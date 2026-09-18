import { useEffect } from 'react';

/**
 * Dismiss de HTML PWA splash die in `public/index.html` staat.
 * Wordt aangeroepen door elke top-level pagina-component (LoginPage,
 * KioskLayout, AdminDashboard, TenantKioskLayout, TenantPublicLanding)
 * zodra hij mount. Dubbele aanroepen zijn no-ops (de helper is
 * idempotent via `el.__hidden` guard).
 *
 * We wachten 2 requestAnimationFrames zodat de eerste paint van de
 * pagina zeker klaar is vóór de splash uit-fadet — geen wit frame
 * tussen splash en app.
 */
export function useHidePwaSplash() {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.__hidePwaSplash !== 'function') return;
    let raf1 = 0;
    let raf2 = 0;
    raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        try { window.__hidePwaSplash(); } catch (e) { /* no-op */ }
      });
    });
    return () => {
      if (raf1) window.cancelAnimationFrame(raf1);
      if (raf2) window.cancelAnimationFrame(raf2);
    };
  }, []);
}
