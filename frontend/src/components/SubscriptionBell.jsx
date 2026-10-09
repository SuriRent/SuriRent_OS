import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Bell, X, CheckCircle2, CreditCard, Landmark, AlertTriangle, Receipt, Clock, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useBrandedSlug } from '../lib/branded-nav';
import { useAdminEvents } from '../lib/admin-events';

const CLOSED = ['paid', 'superseded', 'cancelled', 'void'];
const DAY = 86400000;
const fmt = (n, c = 'SRD') => (String(c).toUpperCase() === 'EUR'
  ? `€${Number(n || 0).toLocaleString('nl-NL', { minimumFractionDigits: 2 })}`
  : `${c} ${Number(n || 0).toLocaleString('nl-NL')}`);
const fmtDate = (s) => (s ? new Date(s).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

// Bouwt de abonnementsmeldingen: verlopen, proef/vernieuwing bijna, open facturen.
function buildAlerts(me, invoices, stripeOn) {
  const out = [];
  if (!me) return out;
  const now = Date.now();
  if (me.status === 'expired') {
    out.push({ id: 'expired', tone: 'red', icon: AlertTriangle, title: 'Abonnement verlopen', text: 'Betaal de openstaande factuur om uw abonnement direct te heractiveren.' });
  } else if (me.status === 'trial' && me.days_left != null && me.days_left <= 7) {
    out.push({ id: 'trial', tone: 'amber', icon: Clock, title: `Proefperiode eindigt over ${me.days_left} ${me.days_left === 1 ? 'dag' : 'dagen'}`, text: `Op ${fmtDate(me.trial_ends_at)}. Rond de eerste betaling af om door te gaan.` });
  } else if (me.status === 'active' && me.renews_at && new Date(me.renews_at) - now < 7 * DAY) {
    out.push({ id: 'renew', tone: 'amber', icon: Clock, title: 'Abonnement verloopt binnenkort', text: `Vernieuwing op ${fmtDate(me.renews_at)}.` });
  }
  const open = invoices.filter((i) => !CLOSED.includes(i.status))
    .sort((a, b) => String(a.period_start || a.created_at).localeCompare(String(b.period_start || b.created_at)));
  for (const inv of open) {
    const overdue = inv.period_start && new Date(inv.period_start).getTime() < now - 3 * DAY;
    out.push({
      id: inv.id, invoice: inv, tone: overdue ? 'red' : 'orange', icon: Receipt, pay: stripeOn,
      title: overdue ? 'Achterstallige factuur' : 'Nieuwe factuur',
      text: `${fmt(inv.amount, inv.currency)} · ${fmtDate(inv.period_start)} → ${fmtDate(inv.period_end)}`,
    });
  }
  return out;
}

const TONES = {
  red: 'bg-red-50 text-red-600',
  amber: 'bg-amber-50 text-amber-600',
  orange: 'bg-orange-50 text-[#FF5C00]',
};

export default function SubscriptionBell() {
  const navigate = useNavigate();
  const slug = useBrandedSlug();
  const [me, setMe] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [stripeOn, setStripeOn] = useState(false);
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);
  const subPath = `${slug ? `/c/${slug}` : ''}/admin/instellingen#abonnement`;

  const load = useCallback(async () => {
    try {
      const [m, inv, cfg] = await Promise.all([
        api.get('/billing/me'), api.get('/billing/me/invoices'),
        api.get('/saas-stripe/public-config').catch(() => ({ data: {} })),
      ]);
      setMe(m.data); setInvoices(inv.data || []); setStripeOn(!!cfg.data?.enabled);
    } catch { /* stil falen */ }
  }, []);

  useEffect(() => {
    load();
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [load]);

  useAdminEvents((evt) => { if (evt?.type === 'notification' || evt?.type === 'subscription_updated') load(); });

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => { if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('touchstart', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('touchstart', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const alerts = useMemo(() => buildAlerts(me, invoices, stripeOn), [me, invoices, stripeOn]);
  const count = alerts.length;
  const urgent = alerts.some((a) => a.tone === 'red');

  const pay = (inv, method) => {
    setOpen(false);
    navigate(`/saas/checkout/${inv.id}?method=${method}&back=${encodeURIComponent(subPath)}`);
  };
  const goSub = () => { setOpen(false); navigate(subPath); };

  return (
    <div className="relative" ref={panelRef} data-testid="subscription-bell-wrapper">
      <button type="button" onClick={() => setOpen((v) => !v)} data-testid="subscription-bell-btn"
        aria-label={count > 0 ? `${count} abonnementsmeldingen` : 'Geen abonnementsmeldingen'}
        className={`relative w-12 h-12 md:w-14 md:h-14 landscape:w-10 landscape:h-10 rounded-2xl landscape:rounded-xl flex items-center justify-center transition-colors active:scale-95 ${
          count > 0
            ? (urgent ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-orange-50 text-[#FF5C00] hover:bg-orange-100')
            : 'bg-white text-slate-500 hover:bg-orange-50 hover:text-[#FF5C00] border border-slate-200/70'}`}>
        <Bell className="w-6 h-6 md:w-7 md:h-7 landscape:w-5 landscape:h-5" strokeWidth={count > 0 ? 2.4 : 2} />
        {count > 0 && (
          <>
            <span className={`absolute -top-1 -right-1 min-w-[20px] h-[20px] px-1.5 rounded-full text-white text-[10px] font-black flex items-center justify-center ring-2 ring-[#F7F8FA] ${urgent ? 'bg-red-500' : 'bg-[#FF5C00]'}`}
              data-testid="subscription-bell-count">{count > 9 ? '9+' : count}</span>
            {urgent && <span className="absolute -top-1 -right-1 w-[20px] h-[20px] rounded-full bg-red-400 opacity-60 animate-ping" />}
          </>
        )}
      </button>

      {open && (
        <div className="fixed inset-x-3 z-50 sm:left-auto sm:right-3 sm:w-[380px]"
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 68px)' }} data-testid="subscription-panel">
          <div className="bg-white rounded-2xl border border-orange-100 shadow-[0_24px_48px_-12px_rgba(15,23,42,0.25)] overflow-hidden animate-slide-up">
            <div className="px-4 py-3 bg-gradient-to-br from-[#FFF4EC] to-[#FFE6D3] border-b border-orange-100 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-black text-slate-900 truncate">Abonnement {count > 0 && <span className={urgent ? 'text-red-500' : 'text-[#FF5C00]'}>({count})</span>}</p>
                {me?.plan?.name && <p className="text-[11px] text-slate-500 truncate">{me.plan.name} · {fmt(me.monthly_amount, me.currency)}/maand</p>}
              </div>
              <button onClick={() => setOpen(false)} className="w-7 h-7 rounded-full hover:bg-white/60 flex items-center justify-center" aria-label="Sluiten" data-testid="subscription-panel-close">
                <X className="w-3.5 h-3.5 text-slate-500" />
              </button>
            </div>

            <div className="max-h-[60vh] landscape:max-h-[40vh] overflow-y-auto">
              {count === 0 ? (
                <div className="px-4 py-8 text-center" data-testid="subscription-empty">
                  <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-2">
                    <CheckCircle2 className="w-6 h-6 text-emerald-500" strokeWidth={2.4} />
                  </div>
                  <p className="text-sm font-bold text-slate-900">Alles is betaald</p>
                  <p className="text-xs text-slate-500 mt-1">Geen openstaande facturen voor uw abonnement.</p>
                </div>
              ) : (
                <ul className="divide-y divide-orange-50">
                  {alerts.map((a) => {
                    const Icon = a.icon;
                    return (
                      <li key={a.id} className="px-3 py-3 flex items-start gap-3" data-testid={`subscription-alert-${a.id}`}>
                        <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${TONES[a.tone]}`}><Icon className="w-4 h-4" /></span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-slate-900">{a.title}</p>
                          <p className="text-[11px] text-slate-500 mt-0.5">{a.text}</p>
                          {a.pay && (
                            <div className="flex gap-1.5 mt-2">
                              <button onClick={() => pay(a.invoice, 'card')} data-testid={`subscription-pay-card-${a.id}`}
                                className="h-8 px-2.5 rounded-lg bg-[#FF5C00] hover:bg-[#E05200] text-white text-[11px] font-bold inline-flex items-center gap-1 transition-colors">
                                <CreditCard className="w-3.5 h-3.5" /> Creditcard
                              </button>
                              <button onClick={() => pay(a.invoice, 'ideal')} data-testid={`subscription-pay-ideal-${a.id}`}
                                className="h-8 px-2.5 rounded-lg bg-[#CC0066] hover:bg-[#B0005A] text-white text-[11px] font-bold inline-flex items-center gap-1 transition-colors">
                                <Landmark className="w-3.5 h-3.5" /> iDEAL
                              </button>
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <button onClick={goSub} data-testid="subscription-panel-open"
              className="w-full px-4 py-3 border-t border-orange-100 bg-slate-50/60 hover:bg-orange-50 text-sm font-bold text-[#FF5C00] flex items-center justify-center gap-1 transition-colors">
              Naar Mijn abonnement <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
