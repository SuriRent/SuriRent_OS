import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useBrandedNavigate } from '../../../lib/branded-nav';
import MijnAbonnement from './MijnAbonnement';
import BusinessInfo from './BusinessInfo';
import Branding from './Branding';
import BackupRestore from './BackupRestore';
import SettingsPage from './Settings';
import StripeCompanySettings from './StripeCompanySettings';
import { INSTELLINGEN_SECTIONS, activeInstellingenSection } from './instellingenSections';

// Navigatie tussen onderdelen gebeurt via de Instellingen-dropdown in het
// zijmenu (desktop) of de mobiele sheet; de sectie volgt de URL-hash.
const RENDER = {
  abonnement: () => <MijnAbonnement />,
  bedrijf: () => <BusinessInfo />,
  branding: () => <Branding />,
  smtp: () => <SettingsPage initialSection="smtp" hideSubNav />,
  invoicing: () => <SettingsPage initialSection="invoicing" hideSubNav />,
  kiosk: () => <SettingsPage initialSection="kiosk" hideSubNav />,
  stripe: () => <StripeCompanySettings />,
  bon: () => <SettingsPage initialSection="receipts" hideSubNav />,
  backup: () => <BackupRestore />,
};

export default function InstellingenHub() {
  const location = useLocation();
  const navigate = useBrandedNavigate();
  const active = activeInstellingenSection(location.hash);
  const current = INSTELLINGEN_SECTIONS.find((s) => s.id === active);
  const Icon = current.icon;

  // Deep-link vanuit andere pagina's:
  //   window.dispatchEvent(new CustomEvent('go-instellingen-section', { detail: { section } }))
  useEffect(() => {
    const onDeepLink = (ev) => {
      let s = ev?.detail?.section;
      const sub = ev?.detail?.integrationsSection;
      if (s === 'integraties') s = sub || 'smtp';
      if (s) navigate(`/admin/instellingen#${s}`, { replace: true });
    };
    window.addEventListener('go-instellingen-section', onDeepLink);
    return () => window.removeEventListener('go-instellingen-section', onDeepLink);
  }, [navigate]);

  return (
    <div data-testid="instellingen-hub" className="w-full max-w-none">
      <div className="mb-6 flex items-start gap-3">
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
