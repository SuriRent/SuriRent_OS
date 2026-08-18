/**
 * useLivePulse — listent naar `surirent:live-change` events (dispatched
 * door de SSE-verbinding in AdminDashboard) en houdt een Set bij van
 * sidebar-tab-ids die "recent gepulseerd" zijn. Sidebar rendert een
 * kleine groene ping-dot naast de tab-icoon voor ~2.5s, zodat gebruikers
 * visueel zien dat live-sync werkt.
 *
 * Skip de actieve tab — de gebruiker kijkt daar al naar, de data is al
 * ververst via SWR globalMutate.
 */
import { useEffect, useState } from 'react';

// Map API-pad (na strippen van `/api`) → sidebar-tab-id.
// Meer specifieke matches eerst.
const PATH_TO_TAB = [
  { match: (p) => p.includes('/assign-tenant') || p.includes('/remove-tenant'),
    tabs: ['tenants', 'apartments'] },
  { match: (p) => p.startsWith('/tenants'), tabs: ['tenants'] },
  { match: (p) => p.startsWith('/apartments'), tabs: ['apartments'] },
  { match: (p) => p.startsWith('/contracts'), tabs: ['contracts'] },
  { match: (p) => p.startsWith('/payments'), tabs: ['payments', 'invoices'] },
  { match: (p) => p.startsWith('/invoices'), tabs: ['invoices'] },
  { match: (p) => p.startsWith('/locations'), tabs: ['locations'] },
  { match: (p) => p.startsWith('/deposits'), tabs: ['deposits'] },
  { match: (p) => p.startsWith('/kasgeld'), tabs: ['kasgeld'] },
  { match: (p) => p.startsWith('/payment-plans'), tabs: ['payment_plans'] },
  { match: (p) => p.startsWith('/maintenance'), tabs: ['maintenance'] },
  { match: (p) => p.startsWith('/employees') || p.startsWith('/salaries'),
    tabs: ['employees'] },
];

const PULSE_MS = 2500;

export function useLivePulse(activeTab) {
  const [pulsing, setPulsing] = useState(() => new Set());

  useEffect(() => {
    const timers = new Map();
    const onLive = (ev) => {
      const rawPath = String(ev?.detail?.path || '');
      if (!rawPath.startsWith('/api/')) return;
      const swrKey = rawPath.slice(4); // strip '/api'
      const rule = PATH_TO_TAB.find((r) => r.match(swrKey));
      if (!rule) return;
      const nextTabs = rule.tabs.filter((t) => t !== activeTab);
      if (nextTabs.length === 0) return;
      setPulsing((prev) => {
        const next = new Set(prev);
        nextTabs.forEach((t) => next.add(t));
        return next;
      });
      nextTabs.forEach((t) => {
        if (timers.has(t)) clearTimeout(timers.get(t));
        timers.set(t, setTimeout(() => {
          setPulsing((prev) => {
            if (!prev.has(t)) return prev;
            const next = new Set(prev);
            next.delete(t);
            return next;
          });
          timers.delete(t);
        }, PULSE_MS));
      });
    };
    window.addEventListener('surirent:live-change', onLive);
    return () => {
      window.removeEventListener('surirent:live-change', onLive);
      timers.forEach((id) => clearTimeout(id));
      timers.clear();
    };
  }, [activeTab]);

  return pulsing;
}
