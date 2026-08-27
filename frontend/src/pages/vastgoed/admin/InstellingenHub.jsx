import { useState, useEffect, useMemo, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Crown, Sparkles, Briefcase, Palette, Database,
  Mail, FileText, KeySquare, Settings as Cog,
} from 'lucide-react';
import MijnAbonnement from './MijnAbonnement';
import SetupWizard from './SetupWizard';
import BusinessInfo from './BusinessInfo';
import Branding from './Branding';
import BackupRestore from './BackupRestore';
import SettingsPage from './Settings';

// Volgorde exact zoals door gebruiker gevraagd. Elke entry rendert een
// bestaande, gepolijste pagina — geen herontwerp van de inhoud.
// "Mijn landing" is verwijderd op user-verzoek 2026-02-27.
// De vroegere "Integraties" tab is opgesplitst in drie losse top-tabs
// (SMTP, Facturen automatisering, Kiosk PIN) zodat elke integratie
// direct één klik weg is i.p.v. genest in een sub-nav.
const SECTIONS = [
  {
    id: 'abonnement',
    label: 'Mijn abonnement',
    desc: 'Bekijk en wijzig je plan, betalingen en facturen.',
    icon: Crown,
    render: () => <MijnAbonnement />,
  },
  {
    id: 'setup',
    label: 'Setup wizard',
    desc: 'Stapsgewijze configuratie voor nieuwe bedrijven.',
    icon: Sparkles,
    render: () => <SetupWizard />,
  },
  {
    id: 'bedrijf',
    label: 'Bedrijfsgegevens',
    desc: 'Naam, adres, KvK en contactgegevens van je bedrijf.',
    icon: Briefcase,
    render: () => <BusinessInfo />,
  },
  {
    id: 'branding',
    label: 'Branding',
    desc: 'Logo, kleuren en visuele identiteit.',
    icon: Palette,
    render: () => <Branding />,
  },
  {
    id: 'smtp',
    label: 'E-mail (SMTP)',
    desc: 'Verstuur kwitanties en facturen via je eigen SMTP server.',
    icon: Mail,
    render: () => <SettingsPage initialSection="smtp" hideSubNav />,
  },
  {
    id: 'invoicing',
    label: 'Facturen automatisering',
    desc: 'Automatische maand-facturen na grace periode.',
    icon: FileText,
    render: () => <SettingsPage initialSection="invoicing" hideSubNav />,
  },
  {
    id: 'kiosk',
    label: 'Kiosk PIN',
    desc: 'Stel de 4-cijferige toegangs-PIN voor de Kiosk in.',
    icon: KeySquare,
    render: () => <SettingsPage initialSection="kiosk" hideSubNav />,
  },
  {
    id: 'backup',
    label: 'Backup & herstel',
    desc: 'Maak veilige kopieën en herstel data wanneer nodig.',
    icon: Database,
    render: () => <BackupRestore />,
  },
];

export default function InstellingenHub({ initialSection }) {
  const location = useLocation();

  // URL hash → sectie. /admin/instellingen#branding opent direct Branding.
  const hashSection = useMemo(() => {
    const h = (location.hash || '').replace('#', '').trim();
    return SECTIONS.find((s) => s.id === h)?.id || null;
  }, [location.hash]);

  // initialSection is een legacy alias. In de oude opzet mapte 'smtp' /
  // 'invoicing' / 'kiosk' naar de sub-nav van "Integraties"; die zijn nu
  // top-level tabs, dus we mappen ze direct door.
  const legacyMatch = useMemo(() => {
    if (!initialSection) return null;
    const direct = SECTIONS.find((s) => s.id === initialSection);
    if (direct) return { section: direct.id };
    // Legacy: 'integraties' → default naar SMTP tab
    if (initialSection === 'integraties') return { section: 'smtp' };
    return null;
  }, [initialSection]);

  const [active, setActive] = useState(() =>
    hashSection || legacyMatch?.section || 'abonnement',
  );

  useEffect(() => {
    if (hashSection) setActive(hashSection);
  }, [hashSection]);
  useEffect(() => {
    if (legacyMatch?.section) setActive(legacyMatch.section);
  }, [legacyMatch]);

  // Deep-link vanuit andere pagina's — event dispatcher signature blijft:
  //   window.dispatchEvent(new CustomEvent('go-instellingen-section',
  //     { detail: { section } }))
  useEffect(() => {
    const onDeepLink = (ev) => {
      let s = ev?.detail?.section;
      // Legacy alias: sub-sectie van vroegere Integraties → nu top-tab
      const sub = ev?.detail?.integrationsSection;
      if (s === 'integraties' && sub) s = sub;
      else if (s === 'integraties') s = 'smtp';
      if (s) setActive(s);
      if (s && typeof window !== 'undefined') {
        window.history.replaceState(null, '', `${window.location.pathname}#${s}`);
      }
    };
    window.addEventListener('go-instellingen-section', onDeepLink);
    return () => window.removeEventListener('go-instellingen-section', onDeepLink);
  }, []);

  const handleSelect = useCallback((id) => {
    setActive(id);
    // Update hash zonder rerender storm / scroll-jump.
    if (typeof window !== 'undefined') {
      const next = `#${id}`;
      if (window.location.hash !== next) {
        window.history.replaceState(null, '', `${window.location.pathname}${next}`);
      }
    }
  }, []);

  const current = SECTIONS.find((s) => s.id === active) || SECTIONS[0];

  return (
    <div data-testid="instellingen-hub" className="w-full max-w-none">
      {/* HEADER */}
      <div className="mb-5 flex items-start gap-3">
        <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#FF8A3D] to-[#C74600] flex items-center justify-center shadow-[0_8px_18px_-6px_rgba(255,92,0,0.45)] shrink-0">
          <Cog className="w-5 h-5 text-white" strokeWidth={2.4} />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight">Instellingen</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Eén centrale plek voor alle account-, bedrijfs- en integratie-instellingen.
          </p>
        </div>
      </div>

      {/* TOP TAB BAR — horizontaal, scrollbaar op mobile, gouden onderlijn
          onder actieve tab. Ontworpen als brede, luchtige navigatie i.p.v.
          smalle sidebar zodat de content maximaal beschikbaar is. */}
      <nav
        className="mb-6 -mx-3 sm:mx-0 px-3 sm:px-0 overflow-x-auto no-scrollbar border-b border-slate-200 bg-white sticky top-0 z-10"
        data-testid="instellingen-nav"
        aria-label="Instellingen categorieën"
      >
        <div className="flex items-stretch gap-1 min-w-max">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            const isActive = active === s.id;
            return (
              <button
                key={s.id}
                onClick={() => handleSelect(s.id)}
                data-testid={`instellingen-tab-${s.id}`}
                className={`group relative flex items-center gap-2 px-4 py-3 text-sm font-bold whitespace-nowrap transition-colors ${
                  isActive
                    ? 'text-[#FF5C00]'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                  isActive
                    ? 'bg-orange-50 text-[#FF5C00]'
                    : 'bg-slate-100 text-slate-500 group-hover:bg-slate-200'
                }`}>
                  <Icon className="w-3.5 h-3.5" strokeWidth={2.4} />
                </span>
                <span>{s.label}</span>
                {/* Actieve onderlijn — 3px oranje strook */}
                {isActive && (
                  <span className="absolute left-3 right-3 -bottom-px h-[3px] rounded-t bg-gradient-to-r from-[#FF8A3D] to-[#FF5C00]" />
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* CONTENT — full-width wrapper zodat de sub-formulieren volledig
          de breedte kunnen benutten (belangrijk voor bv. de landing-editor
          en integratie-panelen). Iets subtiele card-achtergrond voor
          leesbaarheid maar zonder de content in te sluiten. */}
      <div
        className="min-w-0 w-full"
        data-testid={`instellingen-content-${current.id}`}
      >
        {/* Sectie sub-title — herhaalt wat de tab betekent zodat gebruikers
            altijd weten waar ze zijn, ook na scroll. */}
        <div className="mb-4 flex items-start gap-2">
          <div>
            <h2 className="text-base font-extrabold text-slate-900 tracking-tight">
              {current.label}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 max-w-2xl">{current.desc}</p>
          </div>
        </div>
        {current.render()}
      </div>
    </div>
  );
}
