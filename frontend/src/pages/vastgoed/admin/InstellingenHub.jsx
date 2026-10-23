import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useBrandedNavigate } from '../../../lib/branded-nav';
import MijnAbonnement from './MijnAbonnement';
import BusinessInfo from './BusinessInfo';
import Branding from './Branding';
import BackupRestore from './BackupRestore';
import SettingsPage from './Settings';
import StripeCompanySettings from './StripeCompanySettings';
import KioskDevices from './KioskDevices';
import BonPrinter from './BonPrinter';
import { INSTELLINGEN_SECTIONS, activeInstellingenSection } from './instellingenSections';

// Navigatie tussen onderdelen gebeurt via de Instellingen-dropdown in het
// zijmenu (desktop) of de mobiele sheet; de sectie volgt de URL-hash.
const RENDER = {
  abonnement: () => <MijnAbonnement />,
  bedrijf: () => <BusinessInfo />,
  branding: () => <Branding />,
  smtp: () => <SettingsPage initialSection="smtp" hideSubNav />,
  invoicing: () => <SettingsPage initialSection="invoicing" hideSubNav />,
  stripe: () => <StripeCompanySettings />,
  bon: () => <SettingsPage initialSection="receipts" hideSubNav />,
  'bon-printer': () => <BonPrinter />,
  'kiosk-apparaten': () => <KioskDevices />,
  backup: () => <BackupRestore />,
};

export default function InstellingenHub({ embedded = false }) {
  const location = useLocation();
  const navigate = useBrandedNavigate();
  const [sec, setSec] = useState('bedrijf');
  const active = embedded ? sec : activeInstellingenSection(location.hash);
  const current = INSTELLINGEN_SECTIONS.find((s) => s.id === active);
  const Icon = current.icon;

  // Deep-link vanuit andere pagina's:
  //   window.dispatchEvent(new CustomEvent('go-instellingen-section', { detail: { section } }))
  useEffect(() => {
    const onDeepLink = (ev) => {
      let s = ev?.detail?.section;
      const sub = ev?.detail?.integrationsSection;
      if (s === 'integraties') s = sub || 'smtp';
      if (!s) return;
      if (embedded) setSec(s);
      else navigate(`/admin/instellingen#${s}`, { replace: true });
    };
    window.addEventListener('go-instellingen-section', onDeepLink);
    return () => window.removeEventListener('go-instellingen-section', onDeepLink);
  }, [navigate, embedded]);

  return (
    <div data-testid="instellingen-hub" className="w-full max-w-none">
      {embedded && (
        <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto pb-1" data-testid="instellingen-tabs">
          {INSTELLINGEN_SECTIONS.map((s) => {
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
      <div className={`${embedded ? 'mb-4' : 'mb-6'} flex items-start gap-3`}>
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
