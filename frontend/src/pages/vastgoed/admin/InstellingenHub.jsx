import { useState, useEffect, useMemo, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Crown, Paintbrush, Sparkles, Briefcase, Palette, Database,
  Plug, Settings as Cog,
} from 'lucide-react';
import MijnAbonnement from './MijnAbonnement';
import MijnLanding from './MijnLanding';
import SetupWizard from './SetupWizard';
import BusinessInfo from './BusinessInfo';
import Branding from './Branding';
import BackupRestore from './BackupRestore';
import SettingsPage from './Settings';

// Volgorde exact zoals door gebruiker gevraagd. Elke entry rendert een
// bestaande, gepolijste pagina — geen herontwerp van de inhoud.
const SECTIONS = [
  {
    id: 'abonnement',
    label: 'Mijn abonnement',
    desc: 'Bekijk en wijzig je plan, betalingen en facturen.',
    icon: Crown,
    render: () => <MijnAbonnement />,
  },
  {
    id: 'landing',
    label: 'Mijn landing',
    desc: 'Pas je publieke landing-pagina en marketing-content aan.',
    icon: Paintbrush,
    render: () => <MijnLanding />,
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
    id: 'integraties',
    label: 'Integraties',
    desc: 'SMTP, Twilio, Uni5Pay, Shelly, Domein en Kiosk-PIN.',
    icon: Plug,
    // initialSection laat we open — SettingsPage heeft zijn eigen sub-nav.
    render: (extra) => <SettingsPage initialSection={extra?.integrationsSection || undefined} />,
  },
  {
    id: 'backup',
    label: 'Backup & herstel',
    desc: 'Maak veilige kopieën en herstel data wanneer nodig.',
    icon: Database,
    render: () => <BackupRestore />,
  },
];

export default function InstellingenHub({ initialSection, integrationsSection }) {
  const location = useLocation();

  // URL hash → sectie. /admin/instellingen#branding opent direct Branding.
  const hashSection = useMemo(() => {
    const h = (location.hash || '').replace('#', '').trim();
    return SECTIONS.find((s) => s.id === h)?.id || null;
  }, [location.hash]);

  // initialSection is een legacy alias (mapt op SettingsPage sectie-namen
  // zoals 'smtp'). Als er een match is in onze hoofd-secties pakken we
  // die, anders openen we Integraties met de juiste sub-sectie.
  const legacyMatch = useMemo(() => {
    if (!initialSection) return null;
    const direct = SECTIONS.find((s) => s.id === initialSection);
    if (direct) return { section: direct.id };
    // Integraties sub-sectie (smtp / twilio / mope / uni5pay / shelly / invoicing / domain / kiosk).
    const integrationIds = ['smtp', 'twilio', 'mope', 'uni5pay', 'shelly', 'invoicing', 'domain', 'kiosk'];
    if (integrationIds.includes(initialSection)) {
      return { section: 'integraties', integrationsSection: initialSection };
    }
    return null;
  }, [initialSection]);

  const [active, setActive] = useState(() =>
    hashSection || legacyMatch?.section || 'abonnement',
  );
  const [intSection, setIntSection] = useState(
    () => legacyMatch?.integrationsSection || integrationsSection || null,
  );

  useEffect(() => {
    if (hashSection) setActive(hashSection);
  }, [hashSection]);
  useEffect(() => {
    if (legacyMatch?.section) {
      setActive(legacyMatch.section);
      if (legacyMatch.integrationsSection) setIntSection(legacyMatch.integrationsSection);
    }
  }, [legacyMatch]);

  // Deep-link vanuit andere pagina's (bv. MijnLanding "Configureer eigen
  // domein" knop). Dispatcher: window.dispatchEvent(new CustomEvent(
  //   'go-instellingen-section', { detail: { section, integrationsSection } }))
  useEffect(() => {
    const onDeepLink = (ev) => {
      const s = ev?.detail?.section;
      const sub = ev?.detail?.integrationsSection;
      if (s) setActive(s);
      if (sub) setIntSection(sub);
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
    // Reset integraties sub-sectie wanneer je naar een andere hoofd-tab
    // gaat, anders blijft een oude deep-link plakken.
    if (id !== 'integraties') setIntSection(null);
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
        {current.render({ integrationsSection: intSection })}
      </div>
    </div>
  );
}
