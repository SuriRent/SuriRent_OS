import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useBrandedNavigate } from '../../../lib/branded-nav';
import { useAuth } from '../../../lib/auth';
import MijnAbonnement from './MijnAbonnement';
import BusinessInfo from './BusinessInfo';
import Branding from './Branding';
import BackupRestore from './BackupRestore';
import Notifications from './Notifications';
import SettingsPage from './Settings';
import StripeCompanySettings from './StripeCompanySettings';
import MopeCompanySettings from './MopeCompanySettings';
import PowerSettings from './PowerSettings';
import KioskDevices from './KioskDevices';
import BonPrinter from './BonPrinter';
import TenantSiteEditor from './TenantSiteEditor';
import { availableInstellingenSections, activeInstellingenSection } from './instellingenSections';

function WebsiteSettings() {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-3" data-testid="website-settings">
      <p className="text-sm text-gray-600">
        Bewerk teksten en afbeeldingen van je publieke website, bekijk het resultaat op mobiel, tablet en desktop en publiceer wanneer je klaar bent.
      </p>
      <button type="button" onClick={() => setOpen(true)} data-testid="open-site-editor"
        className="h-11 px-5 rounded-xl bg-[#FF5C00] hover:bg-[#e65300] text-white font-bold">
        Open website-editor
      </button>
      {open && <TenantSiteEditor onClose={() => setOpen(false)} />}
    </div>
  );
}

function PaymentMethodsSettings() {
  const { activeCompany } = useAuth();
  const limits = activeCompany?.limits || {};
  return (
    <div className="space-y-8" data-testid="payment-methods-settings">
      {limits.allow_stripe === true && (
        <section className="space-y-3">
          <h2 className="text-lg font-black text-slate-900">Stripe betalingen</h2>
          <StripeCompanySettings />
        </section>
      )}
      {limits.allow_mope === true && (
        <section className="space-y-3">
          <h2 className="text-lg font-black text-slate-900">Mopé betalingen</h2>
          <MopeCompanySettings />
        </section>
      )}
    </div>
  );
}

// Navigatie tussen onderdelen gebeurt via de Instellingen-dropdown in het
// zijmenu (desktop) of de mobiele sheet; de sectie volgt de URL-hash.
export const RENDER = {
  abonnement: () => <MijnAbonnement />,
  bedrijf: () => <BusinessInfo />,
  branding: () => <Branding />,
  smtp: () => <SettingsPage initialSection="smtp" hideSubNav />,
  invoicing: () => <SettingsPage initialSection="invoicing" hideSubNav />,
  deposit: () => <SettingsPage initialSection="deposit" hideSubNav />,
  betaalmethoden: () => <PaymentMethodsSettings />,
  stroom: () => <PowerSettings />,
  bon: () => <SettingsPage initialSection="receipts" hideSubNav />,
  'bon-printer': () => <BonPrinter />,
  'kiosk-apparaten': () => <KioskDevices />,
  website: () => <WebsiteSettings />,
  notificaties: () => <Notifications embedded />,
  backup: () => <BackupRestore />,
  domein: () => <SettingsPage initialSection="domain" hideSubNav />,
};

export default function InstellingenHub({ embedded = false, section = null }) {
  const location = useLocation();
  const navigate = useBrandedNavigate();
  const { activeCompany } = useAuth();
  const [sec, setSec] = useState(section || 'bedrijf');
  const sections = useMemo(
    () => availableInstellingenSections(activeCompany?.limits),
    [activeCompany?.limits],
  );
  const requestedSection = embedded ? (section || sec) : activeInstellingenSection(location.hash, activeCompany?.limits);
  const active = sections.some((s) => s.id === requestedSection) ? requestedSection : 'abonnement';
  const current = sections.find((s) => s.id === active) || sections[0];
  const Icon = current.icon;

  // Deep-link vanuit andere pagina's:
  //   window.dispatchEvent(new CustomEvent('go-instellingen-section', { detail: { section } }))
  useEffect(() => {
    const onDeepLink = (ev) => {
      let s = ev?.detail?.section;
      const sub = ev?.detail?.integrationsSection;
      if (s === 'integraties') s = sub || 'smtp';
      if (s === 'stripe' || s === 'mope') s = 'betaalmethoden';
      if (!sections.some((item) => item.id === s)) return;
      if (embedded) window.dispatchEvent(new CustomEvent('kiosk-nav', { detail: `admin:inst-${s}` }));
      else navigate(`/admin/instellingen#${s}`, { replace: true });
    };
    window.addEventListener('go-instellingen-section', onDeepLink);
    return () => window.removeEventListener('go-instellingen-section', onDeepLink);
  }, [navigate, embedded, sections]);

  return (
    <div data-testid="instellingen-hub" className="w-full max-w-none">
      {embedded && !section && (
        <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto pb-1" data-testid="instellingen-tabs">
          {sections.map((s) => {
            const I = s.icon;
            return (
              <button key={s.id} type="button" onClick={() => setSec(s.id)} data-testid={`instellingen-tab-${s.id}`}
                className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-colors ${active === s.id ? 'bg-[#FF5C00] text-white' : 'bg-slate-100 text-slate-700 hover:bg-orange-50'}`}>
                <I className="w-4 h-4" /> {s.label}
              </button>
            );
          })}
        </div>
      )}
      <div className={`${section ? 'hidden' : embedded ? 'mb-4 flex' : 'mb-6 flex'} items-start gap-3`}>
        <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#FF8A3D] to-[#C74600] flex items-center justify-center shadow-[0_8px_18px_-6px_rgba(255,92,0,0.45)] shrink-0">
          <Icon className="w-5 h-5 text-white" strokeWidth={2.4} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Instellingen</p>
          <h1 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight" data-testid="instellingen-title">{current.label}</h1>
          <p className="text-sm text-slate-500 mt-0.5 max-w-2xl">{current.desc}</p>
        </div>
      </div>
      <div className="min-w-0 w-full" data-testid={`instellingen-content-${current.id}`} key={current.id}>
        {RENDER[current.id]()}
      </div>
    </div>
  );
}
