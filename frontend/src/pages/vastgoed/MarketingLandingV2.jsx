// ABN AMRO-stijl landing — v11 redesign (2026-05-31).
// Dubbele top nav, hero met grote visual + dark greeting card, 8 product cards
// in 4x2 grid. Kleurschema: zwart (#0F0F0F / #1F1F1F) + oranje (#FF5C00).
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { appLink } from '../../lib/env';
import { useAuth } from '../../lib/auth';
import {
  Menu, X, Search, Lock, ChevronRight, ChevronDown, ChevronUp,
  LayoutDashboard, MapPin, Home as HomeIcon, Receipt, FileText, Users,
  Wallet, ScanLine, Building2, MessageCircle, Mail, Phone,
  Star, ArrowRight, Landmark, Download, Smartphone, Apple, Monitor,
  Share2, Plus, Check,
} from 'lucide-react';
import { EditableProvider, EditableText, EditableImage, useLandingContent } from '../../lib/landing-editable';
import StatusPill from '../../components/StatusPill';
import RegisterModal from '../../components/RegisterModal';

const SHOTS = {
  overzicht:     'https://customer-assets.emergentagent.com/job_vastgoed-app/artifacts/7sx9hgg7_1.png',
  locaties:      'https://customer-assets.emergentagent.com/job_vastgoed-app/artifacts/nlo3hnqf_2.png',
  appartementen: 'https://customer-assets.emergentagent.com/job_vastgoed-app/artifacts/sy8hpkqs_3.png',
  betalingen:    'https://customer-assets.emergentagent.com/job_vastgoed-app/artifacts/dwbjqd89_4.png',
  facturen:      'https://customer-assets.emergentagent.com/job_vastgoed-app/artifacts/mfvavq0r_5.png',
  kioskLoc:      'https://customer-assets.emergentagent.com/job_vastgoed-app/artifacts/7eebv0bd_11.png',
  kioskApt:      'https://customer-assets.emergentagent.com/job_vastgoed-app/artifacts/n7efnoh0_12.png',
  kioskOverview: 'https://customer-assets.emergentagent.com/job_vastgoed-app/artifacts/t334vu2t_13.png',
  kioskNumpad:   'https://customer-assets.emergentagent.com/job_vastgoed-app/artifacts/mjshklb8_14.png',
};

// =============================================================================
// Search index — koppelt zoektermen aan secties + product cards
// =============================================================================
const SEARCH_INDEX = [
  { label: 'Beheer Suite · Overzicht', section: 'feature-0',
    terms: ['beheer', 'suite', 'overzicht', 'dashboard', 'kas', 'saldo', 'kpi'] },
  { label: 'Locaties · Multi-vestiging', section: 'feature-1',
    terms: ['locatie', 'locaties', 'vestiging', 'complex', 'groep'] },
  { label: 'Appartementen', section: 'feature-2',
    terms: ['appartement', 'appartementen', 'eenheid', 'unit', 'huis', 'woning', 'qr', 'shelly', 'smart breaker'] },
  { label: 'Betalingen · Kwitanties · OCR', section: 'feature-3',
    terms: ['betaling', 'betalingen', 'kwitantie', 'kwitanties', 'pdf', 'ocr', 'gemini', 'ai'] },
  { label: 'Facturen · 3-bucket logica', section: 'feature-4',
    terms: ['factuur', 'facturen', 'achterstand', 'lopende maand', 'vooruit', 'betalingsregeling', 'regeling'] },
  { label: 'Kiosk PWA · Selfservice', section: 'kiosk',
    terms: ['kiosk', 'pwa', 'selfservice', 'tablet', 'pin', 'huurder portal', 'huurderportaal'] },
  { label: 'Prijzen · Starter · Pro · Enterprise', section: 'pricing',
    terms: ['prijs', 'prijzen', 'kosten', 'tarief', 'starter', 'pro', 'enterprise', 'plan', 'plannen', 'abonnement'] },
  { label: 'Service & FAQ', section: 'faq',
    terms: ['faq', 'vraag', 'vragen', 'service', 'help', 'setup', 'veilig', 'security', 'opzeggen', 'opzegging', 'ios', 'android', 'white-label', 'whitelabel', 'branding'] },
];

function searchIndex(q) {
  const term = (q || '').toLowerCase().trim();
  if (term.length < 2) return [];
  return SEARCH_INDEX.filter((s) =>
    s.label.toLowerCase().includes(term)
    || s.terms.some((t) => t.includes(term) || term.includes(t)),
  ).slice(0, 6);
}

// =============================================================================
// Top header — tier 1 (thin): logo + status indicator + Inloggen button
// =============================================================================
function TopHeader({ onLogin, onRegister }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const navItems = [
    { id: 'home',     label: 'Home' },
    { id: 'features', label: 'Functies' },
    { id: 'kiosk',    label: 'Kiosk PWA' },
    { id: 'pricing',  label: 'Prijzen' },
    { id: 'faq',      label: 'Service & FAQ' },
  ];
  const goTo = (id) => {
    setMobileMenuOpen(false);
    if (id === 'home') { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-100 shadow-[0_1px_0_0_rgba(15,15,15,0.04)]">
      <div className="max-w-[1280px] mx-auto px-5 lg:px-10 h-20 flex items-center justify-between">
        <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="flex items-center gap-2.5 md:gap-3" data-testid="topheader-logo">
          <span className="w-11 h-11 md:w-14 md:h-14 rounded-lg bg-[#FF5C00] p-1.5 md:p-2 shrink-0">
            <EditableImage path="v2.brand.logo_url" fallback="/kiosk-icons/mark-white.png"
              alt="" className="w-full h-full object-contain" />
          </span>
          <span className="text-2xl md:text-3xl font-black tracking-tight text-[#0F0F0F]">
            <EditableText path="v2.brand.name_prefix" fallback="Suri" as="span" />
            <EditableText path="v2.brand.name_suffix" fallback="Rent" as="span" className="text-[#FF5C00]" />
          </span>
        </button>

        <div className="flex items-center gap-3 md:gap-4">
          {/* Status indicator — toont real-time of alle systemen draaien */}
          <div className="hidden sm:block">
            <StatusPill />
          </div>

          <button onClick={onRegister} data-testid="topheader-register"
            className="hidden sm:inline-flex h-11 px-4 md:px-5 rounded-md bg-white hover:bg-orange-50 border-2 border-[#FF5C00] text-[#FF5C00] text-sm font-bold items-center gap-2 transition-colors">
            <EditableText path="v2.brand.cta_register" fallback="Registreren" as="span" />
          </button>

          <button onClick={onLogin} data-testid="topheader-login"
            className="h-11 px-4 md:px-5 rounded-md bg-[#FF5C00] hover:bg-[#C74600] text-white text-sm font-bold flex items-center gap-2 transition-colors shadow-[0_2px_0_0_rgba(0,0,0,0.05)]">
            <Lock className="w-4 h-4" />
            <EditableText path="v2.brand.cta_login" fallback="Inloggen" as="span" />
          </button>

          {/* Mobile hamburger — NAAST de Inloggen knop. Op desktop verborgen
              omdat de SecondaryNav daar de navigatie biedt. */}
          <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            data-testid="topheader-mobile-menu"
            aria-label={mobileMenuOpen ? 'Sluit menu' : 'Open menu'}
            className="md:hidden w-11 h-11 rounded-md border border-slate-200 flex items-center justify-center hover:bg-slate-50 transition-colors">
            {mobileMenuOpen ? <X className="w-5 h-5 text-[#0F0F0F]" /> : <Menu className="w-5 h-5 text-[#0F0F0F]" />}
          </button>
        </div>
      </div>

      {/* Mobile menu drawer — uitvouwbaar onder de top bar.
          Toont nav links + segment selector. Geen zoekbalk (gebruiker
          kan via greeting card zoeken). */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-white border-t border-slate-200" data-testid="topheader-mobile-drawer">
          <div className="px-5 py-4 space-y-1">
            {navItems.map((n) => (
              <button key={n.id} onClick={() => goTo(n.id)}
                data-testid={`mobile-nav-${n.id}`}
                className="w-full text-left px-3 py-3 text-base font-bold text-[#0F0F0F] hover:bg-slate-50 rounded-md transition-colors">
                {n.label}
              </button>
            ))}
            <div className="pt-3 mt-2 border-t border-slate-100">
              <StatusPill />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Secondary nav — Home / Producten / Je situatie / etc.
// =============================================================================
function SecondaryNav() {
  const items = [
    { id: 'home',     label: 'Home',                hasMenu: false },
    { id: 'features', label: 'Functies',            hasMenu: true },
    { id: 'kiosk',    label: 'Kiosk PWA',           hasMenu: false },
    { id: 'pricing',  label: 'Prijzen',             hasMenu: false },
    { id: 'faq',      label: 'Service & FAQ',       hasMenu: false },
  ];
  const goTo = (id) => {
    if (id === 'home') { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return (
    // Desktop only — op mobile zit de nav in TopHeader's hamburger menu.
    <div className="hidden md:block bg-white border-b border-slate-200/80 sticky top-0 z-30">
      <div className="max-w-[1280px] mx-auto px-5 lg:px-10 h-14 flex items-center justify-between">
        <nav className="flex items-center gap-8">
          {items.map((n) => (
            <button key={n.id} onClick={() => goTo(n.id)}
              data-testid={`secnav-${n.id}`}
              className="text-sm font-bold text-[#0F0F0F] hover:text-[#FF5C00] transition-colors flex items-center gap-1">
              {n.label}
              {n.hasMenu && <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          ))}
        </nav>
        <button data-testid="secnav-search"
          className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-slate-50">
          <Search className="w-5 h-5 text-[#0F0F0F]" />
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// Hero — grote ABN-stijl foto banner (vol bleed, lange hoogte) + greeting card
// =============================================================================
function Hero({ onDemo, onWhatsApp }) {
  const [greeting, setGreeting] = useState('Goedenavond');
  const [query, setQuery] = useState('');
  const [showResults, setShowResults] = useState(false);
  useEffect(() => {
    const h = new Date().getHours();
    if (h < 6) setGreeting('Goedenacht');
    else if (h < 12) setGreeting('Goedemorgen');
    else if (h < 18) setGreeting('Goedemiddag');
    else setGreeting('Goedenavond');
  }, []);

  const results = searchIndex(query);
  const goToSection = (id) => {
    setQuery('');
    setShowResults(false);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const onKey = (e) => {
    if (e.key === 'Enter' && results.length > 0) goToSection(results[0].section);
    if (e.key === 'Escape') { setQuery(''); setShowResults(false); }
  };

  return (
    <section className="relative" id="home">
      {/* Compactere hero — kortere full-bleed visual zoals Centraal Beheer.
          De greeting card hangt over de onderrand en steekt uit in de content
          eronder via een negatieve bottom margin (zie LandingPage wrapper). */}
      <div className="relative w-full bg-[#0F0F0F] overflow-hidden"
        style={{ minHeight: 'clamp(440px, 56vh, 620px)' }}
        data-testid="hero-canvas">
        {/* Background screenshot — wide bleed met dark overlay */}
        <div className="absolute inset-0">
          <img src={SHOTS.overzicht} alt="" loading="eager"
            className="w-full h-full object-cover object-left-top opacity-55" />
          {/* Dark cinematic gradient (links donker → rechts deels zichtbaar) */}
          <div className="absolute inset-0"
            style={{
              background:
                'linear-gradient(95deg, rgba(15,15,15,0.95) 0%, rgba(15,15,15,0.82) 30%, rgba(15,15,15,0.55) 55%, rgba(15,15,15,0.65) 100%)',
            }} />
          {/* Warm orange glow accent */}
          <div className="absolute -top-40 -right-20 w-[720px] h-[720px] rounded-full opacity-35 blur-3xl pointer-events-none"
            style={{ background: 'radial-gradient(circle, #FF5C00, transparent 65%)' }} />
          <div className="absolute -bottom-60 -left-40 w-[600px] h-[600px] rounded-full opacity-20 blur-3xl pointer-events-none"
            style={{ background: 'radial-gradient(circle, #FF8A3D, transparent 70%)' }} />
        </div>

        {/* Centered max-width content — kortere padding voor compact gevoel */}
        <div className="relative max-w-[1280px] mx-auto px-5 lg:px-10 py-10 lg:py-14 grid lg:grid-cols-[1.15fr,1fr] gap-8 lg:gap-12 items-center"
          style={{ minHeight: 'clamp(440px, 56vh, 620px)' }}>
          {/* LEFT — massive headline */}
          <div className="text-white relative z-10">
            <EditableText path="v2.hero.eyebrow" fallback="Vastgoed Suite · Suriname 2026"
              as="p"
              className="text-xs lg:text-sm font-black tracking-[0.32em] uppercase text-[#FF8A3D] mb-4 lg:mb-5" />
            <h1 className="font-black tracking-[-0.035em] leading-[0.95] text-white"
              style={{ fontSize: 'clamp(2.25rem, 5.2vw, 4.5rem)' }}
              data-testid="hero-title">
              <EditableText path="v2.hero.title_line1" fallback="Voor als" as="span" />
              <br /><EditableText path="v2.hero.title_line2" fallback="Excel uw vastgoed" as="span" />
              <br /><EditableText path="v2.hero.title_highlight" fallback="niet meer trekt."
                as="span" className="text-[#FF8A3D]" />
            </h1>
            <EditableText path="v2.hero.subtitle"
              fallback="Nu 30% sneller dan handmatig boekhouden — met Kiosk, automatische facturatie en AI-OCR voor betalingen."
              as="p"
              multiline
              className="mt-5 lg:mt-6 text-base lg:text-xl text-white/85 font-medium max-w-xl leading-relaxed" />
            <div className="mt-6 lg:mt-7 flex flex-col sm:flex-row gap-3">
              <button onClick={onDemo} data-testid="hero-cta-action"
                className="inline-flex items-center justify-center gap-2 h-12 lg:h-13 px-6 rounded-md bg-[#FF5C00] hover:bg-[#FF8A3D] text-white text-sm lg:text-base font-black transition-colors shadow-[0_4px_0_0_rgba(0,0,0,0.15)]">
                <EditableText path="v2.hero.cta_primary" fallback="Bekijk de demo" as="span" />
                <ArrowRight className="w-4 h-4" />
              </button>
              <button onClick={onWhatsApp}
                className="inline-flex items-center justify-center gap-2 h-12 lg:h-13 px-6 rounded-md bg-white/10 hover:bg-white/15 border border-white/20 text-white text-sm lg:text-base font-bold backdrop-blur-sm transition-colors">
                <MessageCircle className="w-5 h-5" />
                <EditableText path="v2.hero.cta_secondary" fallback="WhatsApp ons" as="span" />
              </button>
            </div>
          </div>

          {/* RIGHT — floating dark greeting card die UIT de hero steekt
              (negatieve bottom margin op desktop zodat hij over de content
              hangt zoals op de Centraal Beheer referentie). */}
          <div className="flex items-center justify-center lg:justify-end relative z-20 lg:mb-[-110px] xl:mb-[-130px]">
            <div className="relative w-full max-w-[420px]">
              <div className="rounded-2xl bg-[#0F0F0F]/95 border border-white/10 backdrop-blur-sm p-7 lg:p-8 shadow-[0_30px_60px_-20px_rgba(0,0,0,0.6)]"
                data-testid="greeting-card">
                <h2 className="text-2xl lg:text-[28px] font-black tracking-tight text-white leading-tight">
                  {greeting},
                </h2>
                <EditableText path="v2.greeting.subtitle" fallback="Waarmee kunnen we u vooruit helpen?"
                  as="p" className="mt-2 text-base lg:text-lg text-white/70 font-medium" />
                <div className="mt-6 relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 z-10" />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => { setQuery(e.target.value); setShowResults(true); }}
                    onFocus={() => setShowResults(true)}
                    onBlur={() => setTimeout(() => setShowResults(false), 180)}
                    onKeyDown={onKey}
                    placeholder="Zoek functies, prijzen, FAQ…"
                    data-testid="greeting-search"
                    className="w-full h-12 pl-11 pr-4 rounded-lg bg-white text-[#0F0F0F] text-sm font-medium placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-[#FF5C00]"
                  />
                  {showResults && results.length > 0 && (
                    <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 bg-white rounded-lg shadow-[0_20px_40px_-12px_rgba(0,0,0,0.4)] border border-slate-200 overflow-hidden max-h-72 overflow-y-auto"
                      data-testid="greeting-search-results">
                      {results.map((r) => (
                        <button key={r.section}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => goToSection(r.section)}
                          data-testid={`search-result-${r.section}`}
                          className="w-full text-left px-4 py-3 flex items-center justify-between hover:bg-orange-50 border-b border-slate-100 last:border-b-0 transition-colors">
                          <span className="text-sm font-bold text-[#0F0F0F]">{r.label}</span>
                          <ChevronRight className="w-4 h-4 text-[#FF5C00] shrink-0" />
                        </button>
                      ))}
                    </div>
                  )}
                  {showResults && query.length >= 2 && results.length === 0 && (
                    <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 bg-white rounded-lg shadow-lg border border-slate-200 px-4 py-3">
                      <p className="text-sm text-slate-500">
                        Geen resultaten voor "<span className="font-bold text-[#0F0F0F]">{query}</span>"
                      </p>
                    </div>
                  )}
                </div>
                <button onClick={onWhatsApp} data-testid="greeting-whatsapp"
                  className="mt-5 w-full text-left text-sm font-bold text-[#FF8A3D] hover:text-orange-300 flex items-center gap-2 transition-colors">
                  <MessageCircle className="w-4 h-4" />
                  <EditableText path="v2.greeting.whatsapp_label" fallback="Liever direct chatten? WhatsApp ons" as="span" />
                </button>
                {/* Quick-pill suggestions */}
                <div className="mt-5 pt-5 border-t border-white/10">
                  <EditableText path="v2.greeting.popular_label" fallback="Veelgezocht"
                    as="p" className="text-[10px] font-bold tracking-[0.18em] uppercase text-white/40 mb-3" />
                  <div className="flex flex-wrap gap-2">
                    {[
                      { label: 'Prijzen', section: 'pricing' },
                      { label: 'Kiosk PWA', section: 'kiosk' },
                      { label: 'OCR / AI', section: 'feature-3' },
                      { label: 'FAQ', section: 'faq' },
                    ].map((p) => (
                      <button key={p.label} onClick={() => goToSection(p.section)}
                        data-testid={`quicksearch-${p.section}`}
                        className="px-3 py-1.5 rounded-full bg-white/10 hover:bg-[#FF5C00] hover:text-white border border-white/20 text-xs font-bold text-white/80 transition-colors">
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// =============================================================================
// Product cards — 4x2 grid van quick-access modules
// =============================================================================
function ProductGrid({ onDemo, onLogin }) {
  const items = [
    { Icon: Lock,             labelPath: 'v2.product.cards.0.label', descPath: 'v2.product.cards.0.desc',
      labelFallback: 'Inloggen',          descFallback: 'Beheer toegang',        action: onLogin },
    { Icon: Building2,        labelPath: 'v2.product.cards.1.label', descPath: 'v2.product.cards.1.desc',
      labelFallback: 'Demo proberen',     descFallback: 'Direct testen',         action: onDemo },
    { Icon: LayoutDashboard,  labelPath: 'v2.product.cards.2.label', descPath: 'v2.product.cards.2.desc',
      labelFallback: 'Beheer Suite',      descFallback: 'Volledig dashboard',    target: 'feature-0' },
    { Icon: ScanLine,         labelPath: 'v2.product.cards.3.label', descPath: 'v2.product.cards.3.desc',
      labelFallback: 'Kiosk PWA',         descFallback: 'Selfservice terminal',  target: 'kiosk' },
    { Icon: MapPin,           labelPath: 'v2.product.cards.4.label', descPath: 'v2.product.cards.4.desc',
      labelFallback: 'Locaties',          descFallback: 'Multi-vestiging',       target: 'feature-1' },
    { Icon: HomeIcon,         labelPath: 'v2.product.cards.5.label', descPath: 'v2.product.cards.5.desc',
      labelFallback: 'Appartementen',     descFallback: 'Eenheidbeheer',         target: 'feature-2' },
    { Icon: Receipt,          labelPath: 'v2.product.cards.6.label', descPath: 'v2.product.cards.6.desc',
      labelFallback: 'Betalingen',        descFallback: 'Kwitanties + OCR',      target: 'feature-3' },
    { Icon: FileText,         labelPath: 'v2.product.cards.7.label', descPath: 'v2.product.cards.7.desc',
      labelFallback: 'Facturen',          descFallback: '3-bucket logica',       target: 'feature-4' },
  ];
  const handle = (item) => {
    if (item.action) item.action();
    else if (item.target) document.getElementById(item.target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return (
    <section className="bg-slate-50 py-10 lg:py-14 lg:pt-[50px] xl:pt-[50px]">
      <div className="max-w-[1280px] mx-auto px-5 lg:px-10">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 lg:gap-4">
          {items.map((it) => (
            <button key={it.labelPath} onClick={() => handle(it)}
              data-testid={`product-card-${it.labelFallback.toLowerCase().replace(/\s+/g, '-')}`}
              className="group relative bg-white rounded-xl p-5 lg:p-6 flex items-center gap-3 lg:gap-4 hover:shadow-[0_18px_36px_-15px_rgba(15,15,15,0.18)] hover:-translate-y-0.5 transition-all text-left">
              <span className="w-12 h-12 rounded-xl bg-orange-50 flex items-center justify-center shrink-0 group-hover:bg-[#FF5C00] transition-colors">
                <it.Icon className="w-6 h-6 text-[#FF5C00] group-hover:text-white transition-colors" strokeWidth={2} />
              </span>
              <div className="flex-1 min-w-0">
                <EditableText path={it.labelPath} fallback={it.labelFallback} as="p"
                  className="text-base lg:text-lg font-black text-[#0F0F0F] leading-tight" />
                <EditableText path={it.descPath} fallback={it.descFallback} as="p"
                  className="text-xs text-slate-500 mt-0.5" />
              </div>
              <ChevronRight className="w-5 h-5 text-[#0F0F0F] group-hover:text-[#FF5C00] group-hover:translate-x-0.5 transition-all shrink-0" />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

// =============================================================================
// Features rows — alternerende editorial layout
// =============================================================================
const FEATURE_ROWS = [
  { id: 'feature-0', eyebrow: 'Beheer Suite',
    title: 'Eén dashboard. Alle vastgoed-data.',
    desc: 'Realtime kas saldo, openstaande facturen, achterstand en activiteit in één strak overzicht. Multi-currency voor SRD, EUR en USD.',
    bullets: ['Live kas saldo per valuta', 'Achterstand & openstaand overzicht', 'Quick actions binnen handbereik'],
    img: SHOTS.overzicht },
  { id: 'feature-1', eyebrow: 'Locaties',
    title: 'Groepeer per vestiging of complex.',
    desc: 'Beheer meerdere locaties tegelijkertijd. Foto en adres per vestiging, drill-down naar individuele units.',
    bullets: ['Onbeperkt locaties per bedrijf', 'Foto + adres per locatie', 'Drill-down naar units'],
    img: SHOTS.locaties },
  { id: 'feature-2', eyebrow: 'Appartementen',
    title: 'Eenheidbeheer in detail.',
    desc: 'Per appartement: huurder, maandhuur, status, foto en QR code. Smart breaker integratie via Shelly.',
    bullets: ['Huurder · huur · status per unit', 'QR code per appartement', 'Smart breaker integratie'],
    img: SHOTS.appartementen },
  { id: 'feature-3', eyebrow: 'Betalingen',
    title: 'Kwitanties · OCR · WhatsApp.',
    desc: 'Elke betaling automatisch geboekt met PDF, e-mail-bevestiging en audit log. Gemini AI OCR voor bankafschriften.',
    bullets: ['PDF kwitantie per betaling', 'Gemini AI OCR upload', 'WhatsApp + e-mail verzending'],
    img: SHOTS.betalingen },
  { id: 'feature-4', eyebrow: 'Facturen',
    title: '3-bucket factuur logica.',
    desc: 'Automatische scheiding van achterstand, lopende maand en vooruit. Met betalingsregelingen en PDF kwitanties per termijn.',
    bullets: ['Achterstand · lopend · vooruit', 'Auto-generate maandelijks', 'Betalingsregelingen ondersteund'],
    img: SHOTS.facturen },
];

function FeatureRows() {
  return (
    <section id="features" className="bg-white py-16 lg:py-24">
      <div className="max-w-[1280px] mx-auto px-5 lg:px-10">
        <div className="max-w-2xl mb-12 lg:mb-16">
          <EditableText path="v2.features.eyebrow" fallback="Functies" as="p"
            className="text-xs font-black tracking-[0.3em] uppercase text-[#FF5C00] mb-3" />
          <EditableText path="v2.features.title" fallback="Alles wat uw vastgoed nodig heeft."
            as="h2"
            className="text-3xl lg:text-5xl font-black tracking-tight text-[#0F0F0F] leading-tight" />
        </div>
        <div className="space-y-16 lg:space-y-24">
          {FEATURE_ROWS.map((f, i) => {
            const reverse = i % 2 === 1;
            return (
              <div key={f.id} id={f.id}
                data-testid={`feature-row-${i}`}
                className={`grid lg:grid-cols-2 gap-10 lg:gap-14 items-center ${reverse ? 'lg:grid-flow-dense' : ''}`}>
                <div className={reverse ? 'lg:col-start-2' : ''}>
                  <EditableText path={`v2.features.rows.${i}.eyebrow`} fallback={f.eyebrow}
                    as="p" className="text-xs font-black tracking-[0.3em] uppercase text-[#FF5C00] mb-3" />
                  <EditableText path={`v2.features.rows.${i}.title`} fallback={f.title}
                    as="h3" className="text-2xl lg:text-4xl font-black tracking-tight text-[#0F0F0F] leading-tight" />
                  <EditableText path={`v2.features.rows.${i}.desc`} fallback={f.desc}
                    as="p" multiline
                    className="mt-4 text-base lg:text-lg text-slate-600 leading-relaxed max-w-lg" />
                  <ul className="mt-6 space-y-2.5">
                    {f.bullets.map((b, bi) => (
                      <li key={bi} className="flex items-start gap-3 text-sm text-[#0F0F0F] font-semibold">
                        <span className="w-6 h-6 rounded-md bg-[#FF5C00] flex items-center justify-center shrink-0 mt-0.5">
                          <ChevronRight className="w-3.5 h-3.5 text-white" strokeWidth={3} />
                        </span>
                        <EditableText path={`v2.features.rows.${i}.bullets.${bi}`} fallback={b} as="span" />
                      </li>
                    ))}
                  </ul>
                </div>
                <div className={reverse ? 'lg:col-start-1 lg:row-start-1' : ''}>
                  <div className="rounded-2xl overflow-hidden bg-white border border-slate-200 shadow-[0_30px_60px_-20px_rgba(15,15,15,0.18)]">
                    <div className="h-9 bg-slate-50 border-b border-slate-200 flex items-center px-4 gap-1.5">
                      <span className="w-3 h-3 rounded-full bg-[#FF5F57]" />
                      <span className="w-3 h-3 rounded-full bg-[#FEBC2E]" />
                      <span className="w-3 h-3 rounded-full bg-[#28C840]" />
                    </div>
                    <EditableImage path={`v2.features.rows.${i}.img`} fallback={f.img}
                      alt={f.title} className="w-full block" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// =============================================================================
// Kiosk PWA — donker met 4 tablet screenshots
// =============================================================================
function KioskSection() {
  const tablets = [
    { num: '01', src: SHOTS.kioskLoc,      label: 'Locatie kiezen',     desc: 'Tik uw complex aan.' },
    { num: '02', src: SHOTS.kioskApt,      label: 'Appartement kiezen', desc: 'Selecteer de juiste unit.' },
    { num: '03', src: SHOTS.kioskOverview, label: 'Bedrag bekijken',    desc: 'Overzicht van openstaand.' },
    { num: '04', src: SHOTS.kioskNumpad,   label: 'Betalen',            desc: 'Touchscreen numpad.' },
  ];
  return (
    <section id="kiosk" className="bg-[#0F0F0F] text-white py-16 lg:py-24">
      <div className="max-w-[1280px] mx-auto px-5 lg:px-10">
        <div className="grid lg:grid-cols-2 gap-8 mb-12 items-end">
          <div>
            <EditableText path="v2.kiosk.eyebrow" fallback="Kiosk PWA" as="p"
              className="text-xs font-black tracking-[0.3em] uppercase text-[#FF8A3D] mb-3" />
            <h2 className="text-3xl lg:text-5xl font-black tracking-tight leading-tight">
              <EditableText path="v2.kiosk.title_line1" fallback="Selfservice in" as="span" />
              <span className="block text-[#FF5C00]">
                <EditableText path="v2.kiosk.title_highlight" fallback="vier tikken." as="span" />
              </span>
            </h2>
          </div>
          <EditableText path="v2.kiosk.subtitle"
            fallback="Werkt op tablet, telefoon én desktop. Installeer in 1 tik — geen App Store nodig. Achterstand, lopende maand en boetes met groot lettertype voor elke huurder."
            as="p" multiline
            className="text-base lg:text-lg text-white/70 leading-relaxed max-w-lg" />
        </div>
        <div className="grid sm:grid-cols-2 gap-6 lg:gap-8">
          {tablets.map((t, i) => (
            <div key={t.num} data-testid={`kiosk-step-${i}`} className="bg-[#1F1F1F] rounded-2xl p-5 lg:p-6">
              <div className="flex items-baseline gap-3 mb-4">
                <span className="text-2xl font-black tracking-tighter text-[#FF5C00]">{t.num}</span>
                <span className="text-[10px] font-bold tracking-[0.22em] uppercase text-white/40">/ STEP</span>
              </div>
              <div className="rounded-xl overflow-hidden bg-black aspect-[1920/950]">
                <EditableImage path={`v2.kiosk.steps.${i}.img`} fallback={t.src}
                  alt={t.label} className="w-full h-full object-cover object-top" />
              </div>
              <div className="mt-4">
                <EditableText path={`v2.kiosk.steps.${i}.label`} fallback={t.label}
                  as="p" className="text-lg font-black text-white" />
                <EditableText path={`v2.kiosk.steps.${i}.desc`} fallback={t.desc}
                  as="p" className="text-sm text-white/60 mt-1" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// =============================================================================
// Pricing
// =============================================================================
// =============================================================================
// Pricing — fetched dynamisch via /api/billing/plans (PLAN_PRICES in backend)
// =============================================================================

// Statische config voor enterprise (niet in PLAN_PRICES, blijft "Custom") + UI metadata
// die niet vanuit backend komt (highlight, cta, descriptions als backend ze niet geeft).
const PLAN_UI_META = {
  starter:      { highlight: false, cta: 'Start trial' },
  professional: { highlight: true,  cta: 'Demo aanvragen' },
  lifetime:     { highlight: false, cta: 'Contact' },
  enterprise:   { highlight: false, cta: 'Contact',
    name: 'Enterprise', price: 'Custom', sub: 'op aanvraag',
    desc: 'Voor grote portfolios met aangepaste integraties.',
    features: ['Onbeperkt huurders', 'Custom integraties', 'Shelly smart breakers', 'Dedicated server', 'SLA + 24/7 support'],
    limits: null,
  },
};

// Human-readable labels + volgorde voor de limieten & features op de pricing-kaart.
// Hidden voor Enterprise (limits: null).
const LIMIT_LABELS = [
  { key: 'max_apartments', label: 'appartementen' },
  { key: 'max_tenants',    label: 'huurders' },
  { key: 'max_locations',  label: 'locaties' },
  { key: 'max_employees',  label: 'medewerkers' },
];
const FEATURE_LABELS = [
  { key: 'allow_kiosk',    label: 'Kiosk terminal' },
  { key: 'allow_ocr',      label: 'AI-OCR (Gemini)' },
  { key: 'allow_shelly',   label: 'Shelly stroombeheer' },
  { key: 'allow_branding', label: 'White-label branding' },
  { key: 'allow_backup',   label: 'Backup & Herstel' },
];
const fmtLimit = (v) => (v === -1 || v == null ? '∞' : new Intl.NumberFormat('nl-NL').format(v));

function formatAmount(n) {
  try {
    return new Intl.NumberFormat('nl-NL').format(Math.round(Number(n) || 0));
  } catch {
    return String(n);
  }
}

function PricingSection({ onDemo, onWhatsApp }) {
  const [plans, setPlans] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const backend = (typeof process !== 'undefined' && process.env?.REACT_APP_BACKEND_URL) || '';
        const res = await fetch(`${backend}/api/billing/plans`);
        if (!res.ok) throw new Error('bad status');
        const data = await res.json();
        if (cancelled) return;
        // Transform backend plans → UI shape. Enterprise wordt als laatste toegevoegd.
        const out = data.map((p) => {
          const ui = PLAN_UI_META[p.id] || {};
          return {
            id: p.id,
            name: p.name,
            price: formatAmount(p.amount),
            sub: `${p.currency} / maand`,
            desc: p.description || '',
            features: p.features || [],
            limits: p.limits || {},
            cta: ui.cta || 'Demo aanvragen',
            highlight: !!ui.highlight,
          };
        });
        // Voeg enterprise toe — niet in backend PLAN_PRICES.
        out.push(PLAN_UI_META.enterprise);
        setPlans(out);
      } catch {
        // Fallback op de oorspronkelijke hardcoded plans als de backend niet bereikbaar is.
        setPlans([
          { name: 'Starter', price: '3.000', sub: 'SRD / maand',
            desc: 'Voor kleinere vastgoedbeheerders.',
            features: ['Onbeperkt appartementen', 'Online betalen', 'WhatsApp & E-mail'],
            cta: 'Start trial' },
          { name: 'Professional', price: '5.000', sub: 'SRD / maand', highlight: true,
            desc: 'Met Kiosk terminal en alle functies.',
            features: ['Alles uit Starter', 'Kiosk terminal', 'Shelly stroombeheer', 'Prioriteit support'],
            cta: 'Demo aanvragen' },
          PLAN_UI_META.enterprise,
        ]);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!loaded) {
    return (
      <section id="pricing" className="bg-slate-50 py-16 lg:py-24">
        <div className="max-w-[1280px] mx-auto px-5 lg:px-10">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <p className="text-xs font-black tracking-[0.3em] uppercase text-[#FF5C00] mb-3">Prijzen</p>
            <h2 className="text-3xl lg:text-5xl font-black tracking-tight text-[#0F0F0F] leading-tight">
              Eerlijk geprijsd voor elk vastgoedbedrijf.
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-2xl bg-white border border-slate-200 p-7 h-[420px] animate-pulse">
                <div className="h-4 w-24 bg-slate-200 rounded mb-4" />
                <div className="h-12 w-32 bg-slate-200 rounded mb-3" />
                <div className="h-3 w-full bg-slate-100 rounded" />
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section id="pricing" className="bg-slate-50 py-16 lg:py-24">
      <div className="max-w-[1280px] mx-auto px-5 lg:px-10">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <EditableText path="v2.pricing.eyebrow" fallback="Prijzen" as="p"
            className="text-xs font-black tracking-[0.3em] uppercase text-[#FF5C00] mb-3" />
          <EditableText path="v2.pricing.title" fallback="Eerlijk geprijsd voor elk vastgoedbedrijf."
            as="h2"
            className="text-3xl lg:text-5xl font-black tracking-tight text-[#0F0F0F] leading-tight" />
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          {plans.map((p) => (
            <div key={p.name}
              data-testid={`plan-${p.name.toLowerCase()}`}
              className={`relative rounded-2xl p-7 transition-all ${
                p.highlight
                  ? 'bg-[#0F0F0F] text-white shadow-[0_30px_60px_-20px_rgba(15,15,15,0.4)] md:-translate-y-3'
                  : 'bg-white border border-slate-200 hover:border-[#FF5C00] hover:shadow-[0_18px_36px_-15px_rgba(255,92,0,0.2)]'
              }`}>
              {p.highlight && (
                <div className="absolute top-0 right-7 -translate-y-1/2 px-3 py-1 rounded-md text-[10px] font-black tracking-widest uppercase bg-[#FF5C00] text-white">
                  Aanbevolen
                </div>
              )}
              <p className={`text-sm font-black tracking-wider uppercase mb-4 ${p.highlight ? 'text-[#FF8A3D]' : 'text-[#FF5C00]'}`}>
                {p.name}
              </p>
              <div className="flex items-baseline gap-1.5">
                <span className={`text-5xl lg:text-6xl font-black tracking-tighter ${p.highlight ? 'text-white' : 'text-[#0F0F0F]'}`}>
                  {p.price === 'Custom' ? 'Custom' : p.price}
                </span>
                {p.price !== 'Custom' && (
                  <span className={`text-sm font-bold ${p.highlight ? 'text-white/50' : 'text-slate-500'}`}>
                    {p.sub}
                  </span>
                )}
              </div>
              <p className={`mt-3 text-sm leading-relaxed ${p.highlight ? 'text-white/70' : 'text-slate-600'}`}>
                {p.desc}
              </p>
              <button onClick={p.name === 'Enterprise' ? onWhatsApp : onDemo}
                data-testid={`plan-cta-${p.name.toLowerCase()}`}
                className={`mt-6 w-full h-12 rounded-md text-sm font-black transition-colors flex items-center justify-center gap-2 ${
                  p.highlight
                    ? 'bg-[#FF5C00] hover:bg-[#FF8A3D] text-white'
                    : 'bg-[#0F0F0F] hover:bg-[#FF5C00] text-white'
                }`}>
                {p.cta} <ArrowRight className="w-4 h-4" />
              </button>
              <ul className={`mt-6 space-y-2.5 pt-6 border-t ${p.highlight ? 'border-white/10' : 'border-slate-100'}`}>
                {p.features.map((f) => (
                  <li key={f} className={`text-sm flex items-start gap-2.5 ${p.highlight ? 'text-white/85' : 'text-[#0F0F0F]'}`}>
                    <ChevronRight className={`w-4 h-4 mt-0.5 shrink-0 ${p.highlight ? 'text-[#FF8A3D]' : 'text-[#FF5C00]'}`} strokeWidth={3} />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              {/* Limieten & Functies — direct zichtbaar op elke plan-kaart zodat
                  bezoekers per pakket zien hoeveel appartementen/huurders/etc.
                  ze mogen aanmaken en welke premium-modules erbij zitten. */}
              {p.limits && Object.keys(p.limits).length > 0 && (
                <div className={`mt-5 pt-4 border-t ${p.highlight ? 'border-white/10' : 'border-slate-100'}`}
                  data-testid={`plan-limits-${p.id}`}>
                  <p className={`text-[10px] font-black tracking-widest uppercase mb-2 ${p.highlight ? 'text-white/50' : 'text-slate-400'}`}>
                    Limieten
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {LIMIT_LABELS.map((f) => (
                      <div key={f.key} className={`flex items-baseline justify-between gap-2 rounded px-2 py-1 ${p.highlight ? 'bg-white/5' : 'bg-slate-50'}`}>
                        <span className={`text-[11px] ${p.highlight ? 'text-white/60' : 'text-slate-500'}`}>
                          {f.label}
                        </span>
                        <span className={`text-sm font-black font-mono tabular-nums ${p.highlight ? 'text-white' : 'text-slate-900'}`}>
                          {fmtLimit(p.limits[f.key])}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className={`text-[10px] font-black tracking-widest uppercase mt-4 mb-2 ${p.highlight ? 'text-white/50' : 'text-slate-400'}`}>
                    Modules
                  </p>
                  <div className="grid grid-cols-1 gap-1">
                    {FEATURE_LABELS.map((f) => {
                      const on = !!p.limits[f.key];
                      return (
                        <div key={f.key} className={`flex items-center gap-2 text-[12px] ${on
                          ? (p.highlight ? 'text-white/90' : 'text-slate-800')
                          : (p.highlight ? 'text-white/30 line-through' : 'text-slate-300 line-through')}`}>
                          {on ? (
                            <span className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${p.highlight ? 'bg-emerald-500 text-white' : 'bg-emerald-500 text-white'}`}>
                              <Check className="w-2.5 h-2.5" strokeWidth={4} />
                            </span>
                          ) : (
                            <span className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${p.highlight ? 'bg-white/10 text-white/30' : 'bg-slate-200 text-slate-400'}`}>
                              <X className="w-2.5 h-2.5" strokeWidth={4} />
                            </span>
                          )}
                          <span>{f.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// =============================================================================
// FAQ
// =============================================================================
const FAQS = [
  { q: 'Hoe lang duurt het om mijn vastgoedbedrijf op te zetten?',
    a: 'Met onze Setup Wizard bent u binnen 30 minuten live: locaties, appartementen, huurders en eerste facturen — allemaal stap voor stap.' },
  { q: 'Werkt het systeem op iPhone en Android?',
    a: 'Ja. Het is een PWA — installeer hem direct via Safari (iOS) of Chrome (Android). Geen App Store nodig.' },
  { q: 'Kan ik mijn eigen huisstijl gebruiken?',
    a: 'Volledig white-label. Upload uw logo en kies uw kleur — uw huurders zien alleen úw bedrijf.' },
  { q: 'Hoe veilig is mijn data?',
    a: 'Multi-tenant isolatie op database-niveau, bcrypt + JWT auth, goedkeuringsworkflow voor betalingen, audit log van elke wijziging.' },
  { q: 'Kan ik later opzeggen?',
    a: 'Maandelijks opzegbaar. Geen lock-in. U kunt al uw data exporteren wanneer u maar wilt.' },
];

function FAQSection() {
  const [open, setOpen] = useState(0);
  return (
    <section id="faq" className="bg-white py-16 lg:py-24">
      <div className="max-w-3xl mx-auto px-5 lg:px-10">
        <div className="text-center mb-10">
          <EditableText path="v2.faq.eyebrow" fallback="Service & FAQ" as="p"
            className="text-xs font-black tracking-[0.3em] uppercase text-[#FF5C00] mb-3" />
          <EditableText path="v2.faq.title" fallback="Antwoorden op uw vragen." as="h2"
            className="text-3xl lg:text-5xl font-black tracking-tight text-[#0F0F0F] leading-tight" />
        </div>
        <div className="border-t border-slate-200">
          {FAQS.map((f, i) => {
            const isOpen = open === i;
            return (
              <div key={f.q || `faq-${i}`} className="border-b border-slate-200">
                <button onClick={() => setOpen(isOpen ? -1 : i)}
                  data-testid={`faq-${i}`}
                  className="w-full text-left py-5 flex items-start justify-between gap-4 hover:text-[#FF5C00] transition-colors">
                  <EditableText path={`v2.faq.items.${i}.q`} fallback={f.q}
                    as="p" className="text-base lg:text-lg font-black text-[#0F0F0F]" />
                  {isOpen ? <ChevronUp className="w-5 h-5 text-[#FF5C00] shrink-0" />
                          : <ChevronDown className="w-5 h-5 text-[#0F0F0F] shrink-0" />}
                </button>
                {isOpen && (
                  <div className="pb-5">
                    <EditableText path={`v2.faq.items.${i}.a`} fallback={f.a}
                      as="p" multiline className="text-sm text-slate-600 leading-relaxed" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// =============================================================================
// PersistentInstallBanner — slide-down sticky bovenaan de marketing landing
// die verschijnt zodra `beforeinstallprompt` capturet is (Chrome/Edge/Android)
// of op iOS Safari. Werkt exact als Chrome's eigen "install app"-strip.
// Dismissible via ✕ (7 dagen niet meer tonen via localStorage).
// =============================================================================
const INSTALL_DISMISS_KEY = 'install_banner_dismissed_at';

function PersistentInstallBanner({ deferredPrompt, platform, installed, onInstall }) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      const at = parseInt(localStorage.getItem(INSTALL_DISMISS_KEY) || '0', 10);
      if (!at) return false;
      const days = (Date.now() - at) / 86_400_000;
      return days < 7;
    } catch { return false; }
  });

  if (installed || dismissed) return null;
  // Toon alleen als er echt een prompt beschikbaar is OF iOS Safari.
  const canInstall = !!deferredPrompt || platform === 'ios';
  if (!canInstall) return null;

  const handleDismiss = () => {
    try { localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now())); } catch { /* noop */ }
    setDismissed(true);
  };

  return (
    <div className="sticky top-0 z-50 bg-[#FF5C00] text-white shadow-lg"
      data-testid="install-banner-sticky">
      <div className="max-w-[1280px] mx-auto px-4 sm:px-6 py-2.5 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-white/15 flex items-center justify-center shrink-0">
          <Download className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs sm:text-sm font-black leading-tight">
            Installeer SuriRent als app
          </p>
          <p className="text-[10px] sm:text-xs text-white/85 leading-tight truncate">
            {platform === 'ios' ? 'Voeg toe aan je beginscherm — direct openen zonder browser.' : 'Één tik → direct op je startscherm.'}
          </p>
        </div>
        <button onClick={onInstall} data-testid="install-banner-btn"
          className="shrink-0 inline-flex items-center gap-1.5 px-3 sm:px-4 py-1.5 sm:py-2 rounded-full bg-white text-[#FF5C00] font-black text-xs hover:bg-white/90 transition-all">
          Installeer <ArrowRight className="w-3 h-3" />
        </button>
        <button onClick={handleDismiss} data-testid="install-banner-close"
          aria-label="Verberg installatie-banner"
          className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-white/70 hover:bg-white/10 hover:text-white">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// InstallPwaSection — download-de-app knop met OS-detectie
// =============================================================================
// Op Chrome/Edge/Android capturet `beforeinstallprompt` een event dat we
// on-demand kunnen triggeren (deferred prompt). iOS Safari ondersteunt dit
// NIET — daar tonen we een uitleg-modal met de "Deel → Voeg toe aan
// beginscherm"-stappen. Desktop Safari en Firefox tonen dezelfde uitleg
// (via URL of extensie). We detecteren:
//   - iOS Safari → uitleg-modal met share-icon
//   - Android/Chrome/Edge desktop → native prompt indien beschikbaar
//   - Rest → fallback-uitleg
// =============================================================================
function detectPlatform() {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
  if (isIOS) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Windows|Macintosh|Linux/.test(ua)) return 'desktop';
  return 'unknown';
}

function isStandalone() {
  try {
    return window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
  } catch { return false; }
}

// Gedeelde install-state — gebruikt door zowel de sticky banner bovenaan
// als de "Download de app"-sectie onderaan. Zo werkt beide met dezelfde
// `beforeinstallprompt`-event en delen ze de installed-state.
function usePwaInstall() {
  const [platform] = useState(detectPlatform);
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [installed, setInstalled] = useState(isStandalone);
  const [showIosModal, setShowIosModal] = useState(false);

  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setDeferredPrompt(e); };
    const onInstalled = () => { setInstalled(true); setDeferredPrompt(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (installed) return;
    if (platform === 'ios') { setShowIosModal(true); return; }
    if (deferredPrompt) {
      try {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') setInstalled(true);
      } catch { /* noop */ }
      setDeferredPrompt(null);
      return;
    }
    // Geen prompt beschikbaar én niet iOS → toon iOS-stijl uitleg
    // (Deel/menu → toevoegen). Voor Chrome zonder engagement-triggering
    // is dit de vriendelijkste ervaring.
    setShowIosModal(true);
  }, [installed, platform, deferredPrompt]);

  return { platform, deferredPrompt, installed, install, showIosModal, setShowIosModal };
}

function InstallPwaSection({ install, installed, platform, showIosModal, setShowIosModal }) {
  const label = installed ? 'App is geïnstalleerd' : (
    platform === 'ios' ? 'Installeer op iPhone / iPad' :
    platform === 'android' ? 'Installeer op Android' :
    platform === 'desktop' ? 'Installeer op je computer' :
    'Download de app'
  );

  return (
    <section id="download" className="bg-[#0F0F0F] text-white py-16 lg:py-24">
      <div className="max-w-[1280px] mx-auto px-5 lg:px-10">
        <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
          <div>
            <p className="text-xs font-black tracking-[0.24em] uppercase text-[#FF8A3D] mb-3">
              <EditableText path="v2.install.eyebrow" fallback="Progressive Web App" as="span" />
            </p>
            <h2 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[1.05] mb-5">
              <EditableText path="v2.install.title_line1" fallback="Installeer" as="span" />
              <br /><EditableText path="v2.install.title_highlight" fallback="op je toestel"
                as="span" className="text-[#FF5C00]" />
            </h2>
            <EditableText path="v2.install.subtitle"
              fallback="Direct vanuit je startscherm — geen App Store, geen Play Store. Werkt op iPhone, Android, Mac en Windows als een native app."
              as="p" multiline
              className="text-base sm:text-lg text-white/70 leading-relaxed max-w-lg" />

            <div className="mt-8 flex flex-col sm:flex-row items-start gap-3">
              <button onClick={install}
                data-testid="marketing-install-pwa-btn"
                disabled={installed}
                className="group inline-flex items-center gap-2.5 px-6 py-4 rounded-full bg-[#FF5C00] hover:bg-[#E64F00] disabled:bg-emerald-600 disabled:cursor-default text-white font-black text-sm shadow-[0_10px_40px_-10px_rgba(255,92,0,0.6)] transition-all">
                <Download className="w-4 h-4" />
                <span>{label}</span>
                {!installed && <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />}
              </button>
              <a href="/assistent"
                data-testid="marketing-assistent-pwa-link"
                className="inline-flex items-center gap-2 px-5 py-4 rounded-full bg-white/10 hover:bg-white/15 text-white font-bold text-sm border border-white/20 transition-all">
                <span>Of installeer de AI-Assistent</span>
                <ArrowRight className="w-4 h-4" />
              </a>
            </div>

            <div className="mt-8 grid grid-cols-3 gap-3 max-w-md">
              {[
                { icon: Apple, label: 'iPhone', sub: 'iOS 16+' },
                { icon: Smartphone, label: 'Android', sub: 'Chrome' },
                { icon: Monitor, label: 'Desktop', sub: 'Chrome / Edge' },
              ].map((p) => (
                <div key={p.label}
                  className="rounded-2xl bg-white/[0.04] border border-white/10 p-3 flex flex-col items-center text-center gap-1.5">
                  <p.icon className="w-5 h-5 text-[#FF8A3D]" />
                  <p className="text-xs font-black text-white">{p.label}</p>
                  <p className="text-[10px] text-white/50">{p.sub}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Rechts — mockup / benefits */}
          <div className="rounded-3xl bg-gradient-to-br from-[#1F1F1F] to-[#0F0F0F] border border-white/10 p-6 lg:p-8 shadow-2xl">
            <p className="text-xs font-black tracking-[0.22em] uppercase text-white/50 mb-4">Waarom installeren?</p>
            <ul className="space-y-4">
              {[
                { t: 'Direct openen', d: 'Één tik vanaf je startscherm — geen browser meer nodig.' },
                { t: 'Werkt offline', d: 'Bekijk facturen, betalingen en huurders ook zonder internet.' },
                { t: 'Push meldingen', d: 'Krijg direct bericht bij nieuwe betalingen en achterstanden.' },
                { t: 'Native gevoel', d: 'Volledig scherm, geen adresbalk, snelle transities.' },
              ].map((f, i) => (
                <li key={i} className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[#FF5C00]/20 text-[#FF8A3D] flex items-center justify-center shrink-0 font-black text-sm">
                    {i + 1}
                  </div>
                  <div>
                    <p className="text-sm font-black text-white">{f.t}</p>
                    <p className="text-xs text-white/60 leading-relaxed mt-0.5">{f.d}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Uitleg-modal — verschijnt bij iOS Safari of wanneer de browser
          (nog) geen native install-prompt kon vuren (bv. desktop Safari
          / Firefox / Chrome zonder engagement-heuristic). We hergebruiken
          één modal met platform-slimme inhoud i.p.v. twee verschillende. */}
      {showIosModal && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/70 p-4"
          onClick={() => setShowIosModal(false)}
          data-testid="ios-install-modal">
          <div onClick={(e) => e.stopPropagation()}
            className="bg-white text-slate-900 rounded-3xl w-full max-w-md p-6 shadow-2xl">
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-xl font-black">
                {platform === 'ios' ? 'Installeer op iPhone / iPad' : 'Installeer via je browser-menu'}
              </h3>
              <button onClick={() => setShowIosModal(false)}
                data-testid="ios-install-close"
                className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>
            {platform === 'ios' ? (
              <ol className="space-y-3 text-sm">
                <li className="flex items-start gap-3">
                  <span className="w-6 h-6 rounded-full bg-[#FF5C00] text-white flex items-center justify-center font-black text-xs shrink-0">1</span>
                  <span>Tik op de <Share2 className="w-4 h-4 inline mx-1 text-[#FF5C00]" /> <strong>Deel-knop</strong> onderaan Safari.</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-6 h-6 rounded-full bg-[#FF5C00] text-white flex items-center justify-center font-black text-xs shrink-0">2</span>
                  <span>Kies <strong>&quot;Zet op beginscherm&quot;</strong> <Plus className="w-4 h-4 inline mx-1 text-[#FF5C00]" /> uit de lijst.</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-6 h-6 rounded-full bg-[#FF5C00] text-white flex items-center justify-center font-black text-xs shrink-0">3</span>
                  <span>Tik rechtsboven op <strong>&quot;Voeg toe&quot;</strong>. De app verschijnt tussen je andere apps.</span>
                </li>
              </ol>
            ) : (
              <ol className="space-y-3 text-sm">
                <li className="flex items-start gap-3">
                  <span className="w-6 h-6 rounded-full bg-[#FF5C00] text-white flex items-center justify-center font-black text-xs shrink-0">1</span>
                  <span>Open het <strong>browser-menu</strong> (⋮ of ⋯ rechtsboven in Chrome/Edge).</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-6 h-6 rounded-full bg-[#FF5C00] text-white flex items-center justify-center font-black text-xs shrink-0">2</span>
                  <span>Kies <strong>&quot;App installeren&quot;</strong> of <strong>&quot;Installeer SuriRent&quot;</strong>.</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-6 h-6 rounded-full bg-[#FF5C00] text-white flex items-center justify-center font-black text-xs shrink-0">3</span>
                  <span>Bevestig <strong>&quot;Installeren&quot;</strong>. De app verschijnt tussen je programma&apos;s.</span>
                </li>
                <li className="mt-2 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600">
                  <strong className="block text-slate-900 mb-1">Zie je geen installeer-optie?</strong>
                  Blader een paar seconden door de pagina en kom terug — sommige browsers wachten tot je actief bent voordat installeren beschikbaar wordt.
                </li>
              </ol>
            )}
            {platform === 'ios' && (
              <div className="mt-5 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600">
                <strong className="block text-slate-900 mb-1">Let op:</strong>
                Dit werkt alleen in <strong>Safari</strong>, niet in Chrome of andere browsers op iOS.
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// =============================================================================
// Footer
// =============================================================================
function Footer({ onLogin }) {
  return (
    <footer className="bg-[#0F0F0F] text-white/60">
      <div className="max-w-[1280px] mx-auto px-5 lg:px-10 py-12 lg:py-16">
        <div className="grid md:grid-cols-4 gap-8 lg:gap-10">
          <div className="md:col-span-2">
            <div className="flex items-center gap-2.5 mb-4">
              <span className="w-9 h-9 rounded-lg bg-[#FF5C00] p-1.5">
                <EditableImage path="v2.brand.logo_url" fallback="/kiosk-icons/mark-white.png"
                  alt="" className="w-full h-full object-contain" />
              </span>
              <span className="text-base font-black text-white">
                <EditableText path="v2.brand.name_prefix" fallback="Suri" as="span" />
                <EditableText path="v2.brand.name_suffix" fallback="Rent" as="span" className="text-[#FF5C00]" />
              </span>
            </div>
            <EditableText path="v2.footer.tagline"
              fallback="Het volledige vastgoedplatform voor Surinaamse verhuurders. White-label SaaS met Kiosk, automatische facturatie en AI-OCR."
              as="p" multiline
              className="text-sm leading-relaxed max-w-md" />
            <div className="mt-5 flex items-center gap-1">
              {[0,1,2,3,4].map((i) => <Star key={i} className="w-4 h-4 fill-[#FF8A3D] text-[#FF8A3D]" />)}
              <EditableText path="v2.footer.rating_label" fallback="5.0 · Surinaams gebouwd"
                as="span" className="ml-2 text-xs font-bold text-white/70" />
            </div>
          </div>
          <div>
            <p className="text-xs font-black tracking-[0.22em] uppercase text-white mb-4">Product</p>
            <ul className="space-y-2.5 text-sm">
              <li><a href="#features" className="hover:text-[#FF5C00] transition-colors">Functies</a></li>
              <li><a href="#kiosk" className="hover:text-[#FF5C00] transition-colors">Kiosk PWA</a></li>
              <li><a href="#pricing" className="hover:text-[#FF5C00] transition-colors">Prijzen</a></li>
              <li><a href="#faq" className="hover:text-[#FF5C00] transition-colors">FAQ</a></li>
            </ul>
          </div>
          <div>
            <p className="text-xs font-black tracking-[0.22em] uppercase text-white mb-4">Contact</p>
            <ul className="space-y-2.5 text-sm">
              <li className="flex items-center gap-2"><Mail className="w-4 h-4 text-[#FF8A3D]" />
                <EditableText path="v2.footer.email" fallback="info@surirent.sr" as="span" />
              </li>
              <li className="flex items-center gap-2"><Phone className="w-4 h-4 text-[#FF8A3D]" />
                <EditableText path="v2.footer.phone" fallback="+597 XXX XXX" as="span" />
              </li>
              <li className="flex items-start gap-2"><Users className="w-4 h-4 text-[#FF8A3D] mt-0.5 shrink-0" />
                <EditableText path="v2.footer.address"
                  fallback="Kewalbansingweg 7, Paramaribo Suriname — South America"
                  as="span" multiline />
              </li>
              <li className="flex items-center gap-2"><Landmark className="w-4 h-4 text-[#FF8A3D]" />
                <span className="text-[10px] font-black uppercase tracking-widest text-white/50 mr-1">KKF</span>
                <EditableText path="v2.footer.kkf_number" fallback="173157" as="span" className="font-mono" />
              </li>
              <li className="pt-2">
                <button onClick={onLogin} data-testid="footer-login"
                  className="text-[#FF8A3D] hover:text-orange-300 font-bold">
                  Beheerder inloggen →
                </button>
              </li>
            </ul>
          </div>
        </div>
        <div className="mt-12 pt-8 border-t border-white/10 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs text-white/40">© {new Date().getFullYear()} SuriRent. Alle rechten voorbehouden.</p>
            <div className="flex items-center gap-2" data-testid="footer-payment-logos">
              <span className="text-[10px] font-semibold text-white/30 uppercase tracking-wider mr-1">Betaal met</span>
              <span className="inline-flex items-center bg-white rounded-md px-2 py-1 shadow-sm">
                <img
                  src="/payment-logos/mope.webp"
                  alt="Betaal met MOPÉ"
                  className="h-5 w-auto object-contain"
                  data-testid="footer-logo-mope"
                  loading="lazy"
                />
              </span>
              <span className="inline-flex items-center bg-white rounded-md px-2 py-1 shadow-sm">
                <img
                  src="/payment-logos/uni5pay.webp"
                  alt="Uni5Pay"
                  className="h-5 w-auto object-contain"
                  data-testid="footer-logo-uni5pay"
                  loading="lazy"
                />
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-semibold text-white/40">Alle systemen operationeel</span>
          </div>
        </div>
      </div>
    </footer>
  );
}

// =============================================================================
// Main export
// =============================================================================
export default function MarketingLandingV2() {
  const navigate = useNavigate();
  const { refresh: refreshAuth } = useAuth();
  const pwaInstall = usePwaInstall();

  // Edit mode wordt geactiveerd via ?edit=1 (alleen wanneer pagina in iframe
  // staat van de LiveLandingEditor superadmin tool).
  const editMode = (() => {
    try {
      const p = new URLSearchParams(window.location.search);
      return p.get('edit') === '1';
    } catch { return false; }
  })();

  const { content: initialContent, loading: contentLoading, hasInstantContent } = useLandingContent(editMode);
  // Toon niets op de eerste render als we geen cache/inline content hebben
  // en de API nog laadt — voorkomt "oude/fallback tekst → juiste tekst"
  // flicker bij een cold visit.
  const showSkeleton = !editMode && !hasInstantContent && contentLoading;

  useEffect(() => {
    document.body.style.backgroundColor = '#FFFFFF';
    return () => { document.body.style.backgroundColor = ''; };
  }, []);

  useEffect(() => {
    if (editMode) return undefined;
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('landing') === '1') return undefined;
      const isStandalone =
        window.matchMedia?.('(display-mode: standalone)').matches
        || window.navigator.standalone === true
        || params.get('source') === 'pwa';
      if (isStandalone) {
        const target = appLink('/login');
        if (target.startsWith('http')) window.location.replace(target);
        else navigate(target, { replace: true });
      }
    } catch { /* ignore */ }
    return undefined;
  }, [navigate, editMode]);

  const onLogin = () => {
    if (editMode) return; // disable navigation while editing
    const t = appLink('/login');
    if (t.startsWith('http')) window.location.href = t;
    else navigate(t);
  };

  const onRegister = () => {
    if (editMode) return;
    setRegisterOpen(true);
  };

  const [registerOpen, setRegisterOpen] = useState(false);

  // Auto-open de register popup wanneer iemand binnenkomt via een link
  // met ?register=1 (bijvoorbeeld via een oude bookmark naar /login?register=1
  // die door LoginPage wordt geredirect naar /?register=1).
  useEffect(() => {
    if (editMode) return;
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('register') === '1') {
        setRegisterOpen(true);
        // Maak de URL schoon zodat reload de modal niet opnieuw forceert.
        params.delete('register');
        const search = params.toString();
        window.history.replaceState({}, '', `${window.location.pathname}${search ? `?${search}` : ''}`);
      }
    } catch { /* ignore */ }
  }, [editMode]);

  // Demo launcher — logt direct in op de demo en navigeert naar het juiste doel
  // (admin / huurder kiosk / klantenscherm / huurportaal). Slaat token op
  // zodat de doelroute meteen authenticated is.
  const launchDemo = useCallback(async (target = '/admin') => {
    if (editMode) return;
    try {
      const backend = process.env.REACT_APP_BACKEND_URL || '';
      const res = await fetch(`${backend}/api/auth/demo-login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data?.token) {
        try {
          localStorage.setItem('admin_token', data.token);
          // Sla de demo-slug op — zodat branded routes blijven werken, maar
          // logout het netjes opruimt. We taggen 'm óók als demo zodat de
          // logout-flow weet dat hij naar landing moet ipv naar PIN.
          if (data.company?.slug) {
            localStorage.setItem('pwa_company_slug', data.company.slug);
          }
          localStorage.setItem('is_demo_session', '1');
        } catch { /* noop */ }
      }
      // Navigeer naar het doel — gebruik window.location voor cross-route
      // hard nav (sommige doelen zitten onder app subdomain in productie).
      const t = appLink(target);
      if (t.startsWith('http')) {
        // Cross-domain: cookie is al gezet op app-domein, target laadt fresh.
        window.location.href = t;
      } else {
        // Same-origin (preview/hybrid): ververs AuthProvider ZODAT `user`
        // niet null is als <Protected> straks matcht. Zonder deze refresh
        // ziet Protected user=null en flitst /login kort in beeld.
        try { await refreshAuth(); } catch { /* niet fataal */ }
        navigate(t, { replace: true });
      }
    } catch (e) {
      // Fallback: ga naar /login met demo intent zodat gebruiker handmatig kan inloggen
      const t = appLink('/login?demo=1');
      if (t.startsWith('http')) window.location.href = t;
      else navigate(t);
    }
  }, [editMode, navigate, refreshAuth]);

  const onDemo = () => launchDemo('/admin');
  const onWhatsApp = () => {
    if (editMode) return;
    window.open('https://wa.me/597XXXXXXX?text=Ik%20wil%20graag%20een%20demo%20van%20SuriRent', '_blank');
  };

  // Patches doorsturen naar parent (LiveLandingEditor) zodat hij ze kan opslaan.
  const onPatch = useCallback((patch) => {
    try {
      window.parent?.postMessage({ type: 'landing-edit-patch', ...patch }, '*');
    } catch { /* no-op */ }
  }, []);

  // Signaleer parent dat we klaar zijn — handig om edit-bar te tonen pas
  // wanneer de iframe daadwerkelijk gerenderd is. Specifieke origin
  // gebruiken (parent is altijd same-origin admin) om data-leakage naar
  // kwaadaardige iframe-luisteraars te voorkomen.
  useEffect(() => {
    if (!editMode) return;
    try {
      const target = window.location.origin;
      window.parent?.postMessage({ type: 'landing-edit-ready' }, target);
    } catch (err) { console.error('landing-edit-ready postMessage failed', err); }
  }, [editMode]);

  // Bij een cold visit (geen inline injectie én geen verse cache) tonen
  // we heel kort een neutrale skeleton in plaats van de hardcoded fallback
  // teksten. Zodra de API-content binnen is (~100-400ms) fade-in naar
  // de echte landing — zonder "wrong text flash".
  if (showSkeleton) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center" data-testid="marketing-skeleton">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-[#FF5C00] flex items-center justify-center shadow-lg animate-pulse">
            <img loading="lazy" src="/kiosk-icons/mark-white.png" alt="SuriRent" className="w-9 h-9" />
          </div>
          <div className="h-2 w-24 rounded-full bg-orange-100 overflow-hidden">
            <div className="h-full bg-[#FF5C00] w-1/2 animate-[loader_1.2s_ease-in-out_infinite]" />
          </div>
        </div>
        <style>{`@keyframes loader { 0%{transform:translateX(-100%)} 50%{transform:translateX(0)} 100%{transform:translateX(200%)} }`}</style>
      </div>
    );
  }

  return (
    <EditableProvider editMode={editMode} initialContent={initialContent} onPatch={onPatch}>
      <div className="min-h-screen bg-white text-[#0F0F0F] antialiased selection:bg-[#FF5C00] selection:text-white">
        {editMode && (
          <div className="bg-orange-500 text-white text-center py-1.5 text-xs font-extrabold tracking-wider uppercase z-50 sticky top-0"
            data-testid="edit-mode-banner">
            ✏️ Bewerk modus actief — klik op een tekst om te bewerken
          </div>
        )}
        {!editMode && (
          <PersistentInstallBanner
            deferredPrompt={pwaInstall.deferredPrompt}
            platform={pwaInstall.platform}
            installed={pwaInstall.installed}
            onInstall={pwaInstall.install} />
        )}
        <TopHeader onLogin={onLogin} onRegister={onRegister} />
        <SecondaryNav />
        <Hero onDemo={onDemo} onWhatsApp={onWhatsApp} />
        <ProductGrid onDemo={onDemo} onLogin={onLogin} />
        <FeatureRows />
        <KioskSection />
        <PricingSection onDemo={onDemo} onWhatsApp={onWhatsApp} />
        <FAQSection />
        <InstallPwaSection
          install={pwaInstall.install}
          installed={pwaInstall.installed}
          platform={pwaInstall.platform}
          showIosModal={pwaInstall.showIosModal}
          setShowIosModal={pwaInstall.setShowIosModal} />
        <Footer onLogin={onLogin} />
      </div>
      <RegisterModal open={registerOpen} onClose={() => setRegisterOpen(false)} />
    </EditableProvider>
  );
}
