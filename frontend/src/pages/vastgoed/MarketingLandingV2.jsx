// ABN AMRO-stijl landing — v11 redesign (2026-05-31).
// Dubbele top nav, hero met grote visual + dark greeting card, 8 product cards
// in 4x2 grid. Kleurschema: zwart (#0B1B3F / #13254D) + oranje (#FF5C00).
import { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { appLink } from '../../lib/env';
import {
  Menu, X, Lock, ChevronRight, ChevronDown, ChevronUp,
  LayoutDashboard, MapPin, Home as HomeIcon, Receipt, FileText, Users,
  Wallet, ScanLine, Building2, MessageCircle, Mail, Phone,
  Star, ArrowRight, Landmark, Download, Smartphone, Apple, Monitor,
  Check, Target, Handshake, ShieldCheck,
} from 'lucide-react';
import { EditableProvider, EditableText, EditableImage, EditableLink, getPath, useEditable, useLandingContent } from '../../lib/landing-editable';
import StatusPill from '../../components/StatusPill';
import RegisterModal from '../../components/RegisterModal';
import { useHidePwaSplash } from '../../lib/use-hide-pwa-splash';
import { LandingHeader, LandingHero, LandingFeatures } from './landing/LandingTop';
import { KioskShowcase, PriceAdvisor } from './landing/KioskPricing';
import Handleiding from '../marketing/Handleiding';

const APK_URL = `${process.env.REACT_APP_BACKEND_URL}/api/public/apk/download`;

// Nieuwste APK-release (superadmin upload); null = geen knop tonen.
function useLatestApk() {
  const [rel, setRel] = useState(null);
  useEffect(() => {
    fetch(`${process.env.REACT_APP_BACKEND_URL}/api/public/apk/latest`)
      .then((r) => r.json()).then((d) => setRel(d?.release || null)).catch(() => {});
  }, []);
  return rel;
}

function ApkDownloadButton({ rel, variant, testid }) {
  if (!rel) return null;
  const mb = `${(rel.size / 1024 / 1024).toFixed(0)} MB`;
  const cls = variant === 'footer'
    ? 'inline-flex items-center gap-2 text-[#FF8A3D] hover:text-orange-300 font-bold'
    : 'inline-flex items-center justify-center gap-2 h-12 lg:h-13 px-6 rounded-md bg-white hover:bg-orange-50 text-[#0B1B3F] text-sm lg:text-base font-black transition-colors';
  return (
    <EditableLink path={`marketing.download.${variant || 'primary'}.href`} href={APK_URL} download label="Marketing · Androiddownloadlink" data-testid={testid} className={cls}>
      <Download className="w-5 h-5" />
      <EditableText path={`marketing.download.${variant || 'primary'}.label`} fallback="Download de Android-app" as="span" label="Marketing · Androiddownload knop" />
      <span className={`text-xs font-bold ${variant === 'footer' ? 'text-white/40' : 'text-slate-500'}`}>v{rel.version} · {mb}</span>
    </EditableLink>
  );
}

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
// Feature details page
// =============================================================================
const FEATURE_ROWS = [
  { id: 'feature-0', icon: LayoutDashboard, eyebrow: 'Beheer Suite',
    title: 'Eén dashboard. Alle vastgoed-data.',
    desc: 'Realtime kas saldo, openstaande facturen, achterstand en activiteit in één strak overzicht. Multi-currency voor SRD, EUR en USD.',
    bullets: ['Live kas saldo per valuta', 'Achterstand & openstaand overzicht', 'Quick actions binnen handbereik'],
    img: SHOTS.overzicht },
  { id: 'feature-1', icon: MapPin, eyebrow: 'Locaties',
    title: 'Groepeer per vestiging of complex.',
    desc: 'Beheer meerdere locaties tegelijkertijd. Foto en adres per vestiging, drill-down naar individuele units.',
    bullets: ['Onbeperkt locaties per bedrijf', 'Foto + adres per locatie', 'Drill-down naar units'],
    img: SHOTS.locaties },
  { id: 'feature-2', icon: HomeIcon, eyebrow: 'Appartementen',
    title: 'Eenheidbeheer in detail.',
    desc: 'Per appartement: huurder, maandhuur, status, foto en QR code. Smart breaker integratie via Shelly.',
    bullets: ['Huurder · huur · status per unit', 'QR code per appartement', 'Smart breaker integratie'],
    img: SHOTS.appartementen },
  { id: 'feature-3', icon: Receipt, eyebrow: 'Betalingen',
    title: 'Kwitanties · OCR · WhatsApp.',
    desc: 'Elke betaling automatisch geboekt met PDF, e-mail-bevestiging en audit log. Gemini AI OCR voor bankafschriften.',
    bullets: ['PDF kwitantie per betaling', 'Gemini AI OCR upload', 'WhatsApp + e-mail verzending'],
    img: SHOTS.betalingen },
  { id: 'feature-4', icon: FileText, eyebrow: 'Facturen',
    title: '3-bucket factuur logica.',
    desc: 'Automatische scheiding van achterstand, lopende maand en vooruit. Met betalingsregelingen en PDF kwitanties per termijn.',
    bullets: ['Achterstand · lopend · vooruit', 'Auto-generate maandelijks', 'Betalingsregelingen ondersteund'],
    img: SHOTS.facturen },
];

function FeatureDetailsPage({ onDemo, onRegister }) {
  const location = useLocation();

  useEffect(() => {
    if (!location.hash) return undefined;
    const timer = setTimeout(() => {
      const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (target) window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - 136, behavior: 'smooth' });
    }, 100);
    return () => clearTimeout(timer);
  }, [location.hash]);

  return (
    <main data-testid="feature-details-page">
      <section className="relative isolate overflow-hidden bg-[#FBF8F5]">
        <div className="absolute -right-40 -top-56 -z-10 h-[620px] w-[620px] rounded-full bg-[#FF5C00]/10 blur-3xl" />
        <div className="absolute -bottom-56 left-1/4 -z-10 h-[460px] w-[460px] rounded-full bg-[#E8EEF8]/80 blur-3xl" />
        <div className="relative mx-auto grid max-w-[1440px] items-center gap-12 px-5 py-16 sm:px-8 lg:grid-cols-[0.85fr,1.15fr] lg:gap-16 lg:px-10 lg:py-24 2xl:px-[120px]">
          <div className="relative z-10">
            <div className="inline-flex items-center gap-2 rounded-full border border-orange-200 bg-white/80 px-3.5 py-2 text-xs font-black text-[#E65300] shadow-sm">
              <span className="h-2 w-2 rounded-full bg-[#FF5C00]" /> <EditableText path="marketing.features.hero.eyebrow" fallback="Het SuriRent platform" as="span" label="Functies · Intro label" />
            </div>
            <h1 className="mt-6 text-4xl font-black leading-[1.04] tracking-[-0.04em] text-[#0B1B3F] sm:text-5xl lg:text-[60px]">
              <EditableText path="marketing.features.hero.title" fallback="Verhuurbeheer," as="span" label="Functies · Titel" /><br />
              <EditableText path="marketing.features.hero.title_accent" fallback="eindelijk eenvoudig." as="span" label="Functies · Titel accent" className="text-[#FF5C00]" />
            </h1>
            <EditableText path="marketing.features.hero.description"
              fallback="Van locaties en huurders tot betalingen en facturen: alles wat je nodig hebt voor overzichtelijk vastgoedbeheer, samengebracht op één plek."
              as="p" multiline label="Functies · Introductie"
              className="mt-5 max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg" />
            <div className="mt-8 flex flex-wrap gap-3">
              <button onClick={onRegister} className="inline-flex h-12 items-center gap-2 rounded-xl bg-[#FF5C00] px-6 text-sm font-black text-white shadow-[0_12px_24px_-10px_rgba(255,92,0,0.8)] transition-colors hover:bg-[#E65300]">
                <EditableText path="marketing.features.hero.register_cta" fallback="Start gratis" as="span" label="Functies · Registratieknop" /> <ArrowRight className="h-4 w-4" />
              </button>
              <button onClick={onDemo} className="inline-flex h-12 items-center rounded-xl border border-slate-200 bg-white px-6 text-sm font-bold text-[#0B1B3F] transition-colors hover:border-orange-200 hover:text-[#FF5C00]">
                <EditableText path="marketing.features.hero.demo_cta" fallback="Bekijk de demo" as="span" label="Functies · Demoknop" />
              </button>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-xs font-bold text-slate-600">
              <span className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-600" /> <EditableText path="marketing.features.hero.trust.0" fallback="Alles op één plek" as="span" label="Functies · Voordeel 1" /></span>
              <span className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-600" /> <EditableText path="marketing.features.hero.trust.1" fallback="Werkt op elk scherm" as="span" label="Functies · Voordeel 2" /></span>
            </div>
          </div>
          <div className="relative min-w-0 lg:pl-4">
            <div className="absolute -inset-5 rounded-[32px] bg-gradient-to-br from-[#FF5C00]/20 via-white/0 to-[#0B1B3F]/10 blur-2xl" />
            <div className="relative rotate-[1deg] overflow-hidden rounded-[24px] border border-white bg-white p-2 shadow-[0_38px_90px_-40px_rgba(11,27,63,0.4)] sm:p-3">
              <div className="flex h-10 items-center gap-1.5 rounded-t-xl border-b border-slate-100 bg-slate-50 px-4">
                <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
                <EditableText path="marketing.features.hero.preview_caption" fallback="app.surirent.sr · Dashboard" as="span" label="Functies · Dashboard voorbeeld"
                  className="ml-3 flex h-5 max-w-xs flex-1 items-center rounded-md border border-slate-100 bg-white px-3 text-[9px] font-medium text-slate-400" />
              </div>
              <EditableImage path="v2.features.rows.0.img" fallback={FEATURE_ROWS[0].img}
                alt="SuriRent dashboard met vastgoedoverzicht" className="block aspect-[16/10] w-full rounded-b-xl object-cover object-top" />
            </div>
            <div className="absolute -bottom-5 -left-2 flex items-center gap-3 rounded-2xl border border-white bg-white/95 p-3.5 shadow-[0_18px_42px_-22px_rgba(11,27,63,0.35)] backdrop-blur sm:-left-5 sm:p-4">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50"><Check className="h-5 w-5 text-emerald-600" /></span>
              <span>
                <EditableText path="marketing.features.hero.card_title" fallback="Meer grip op je verhuur" as="span" label="Functies · Voorbeeldkaart titel" className="block text-xs font-black text-[#0B1B3F]" />
                <EditableText path="marketing.features.hero.card_description" fallback="Van administratie tot betaling" as="span" label="Functies · Voorbeeldkaart toelichting" className="mt-0.5 block text-[11px] text-slate-500" />
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-slate-100 bg-white">
        <div className="mx-auto grid max-w-[1440px] gap-3 px-5 py-7 sm:grid-cols-3 sm:px-8 lg:px-10 2xl:px-[120px]">
          {[
            ['feature-1', MapPin, 'Locaties en woningen'],
            ['feature-3', Wallet, 'Huur en betalingen'],
            ['feature-4', FileText, 'Facturen en administratie'],
          ].map(([target, Icon, label], index) => (
            <EditableLink key={label} path={`marketing.features.shortcuts.${index}.href`} href={`#${target}`} label={`Functies · Snelkoppeling ${index + 1}`}
              className="group flex items-center gap-3 rounded-2xl border border-slate-100 bg-[#FBF8F5]/50 p-4 transition-all hover:-translate-y-0.5 hover:border-orange-100 hover:bg-orange-50/60">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-[#FF5C00] shadow-sm"><Icon className="h-5 w-5" /></span>
              <EditableText path={`marketing.features.shortcuts.${index}.label`} fallback={label} as="span" label={`Functies · Snelkoppeling ${index + 1}`} className="text-sm font-bold text-[#0B1B3F] group-hover:text-[#FF5C00]" />
              <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-slate-300 transition-transform group-hover:translate-x-1 group-hover:text-[#FF5C00]" />
            </EditableLink>
          ))}
        </div>
      </section>

      {FEATURE_ROWS.map((feature, index) => {
        const Icon = feature.icon;
        const reverse = index % 2 === 1;
        return (
          <section key={feature.id} id={feature.id}
            className={index % 2 === 0 ? 'scroll-mt-36 bg-[#FBF8F5]' : 'scroll-mt-36 bg-white'}
            data-testid={`feature-detail-${index}`}>
            <div className={`mx-auto grid max-w-[1440px] items-center gap-10 px-5 py-16 sm:px-8 lg:grid-cols-2 lg:gap-20 lg:px-10 lg:py-24 2xl:px-[120px] ${reverse ? 'lg:[&>*:first-child]:order-2' : ''}`}>
              <div>
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-orange-100 bg-white text-[#FF5C00] shadow-[0_12px_24px_-18px_rgba(255,92,0,0.7)]">
                  <Icon className="h-6 w-6" strokeWidth={1.9} />
                </div>
                <p className="mt-6 text-xs font-black uppercase tracking-[0.22em] text-[#FF5C00]">
                  {String(index + 1).padStart(2, '0')} · <EditableText path={`v2.features.rows.${index}.eyebrow`} fallback={feature.eyebrow} as="span" label={`Functies · Sectie ${index + 1} label`} />
                </p>
                <EditableText path={`v2.features.rows.${index}.title`} fallback={feature.title}
                as="h2" label={`Functies · Sectie ${index + 1} titel`} className="mt-3 max-w-xl text-3xl font-black leading-[1.08] tracking-tight text-[#0B1B3F] lg:text-[42px]" />
                <EditableText path={`v2.features.rows.${index}.desc`} fallback={feature.desc}
                as="p" multiline label={`Functies · Sectie ${index + 1} toelichting`} className="mt-4 max-w-xl text-base leading-relaxed text-slate-600" />
                <ul className="mt-6 space-y-3">
                  {feature.bullets.map((bullet, bulletIndex) => (
                    <li key={bulletIndex} className="flex items-start gap-3 text-sm font-semibold leading-relaxed text-[#0B1B3F]">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50">
                        <Check className="h-3 w-3 text-emerald-600" strokeWidth={3} />
                      </span>
                      <EditableText path={`v2.features.rows.${index}.bullets.${bulletIndex}`} fallback={bullet} as="span" label={`Functies · Sectie ${index + 1} voordeel ${bulletIndex + 1}`} />
                    </li>
                  ))}
                </ul>
              </div>
              <div className="min-w-0">
                <div className="overflow-hidden rounded-[24px] border border-slate-200/80 bg-white p-2 shadow-[0_32px_72px_-36px_rgba(11,27,63,0.32)] sm:p-3">
                  <div className="flex h-9 items-center gap-1.5 border-b border-slate-100 bg-white px-3">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
                    <span className="ml-3 h-4 flex-1 rounded bg-slate-50" />
                  </div>
                  <EditableImage path={`v2.features.rows.${index}.img`} fallback={feature.img}
                    alt={feature.title} label={`Functies · Sectie ${index + 1} afbeelding`} className="block aspect-[16/10] w-full rounded-b-xl object-cover object-top" />
                </div>
              </div>
            </div>
          </section>
        );
      })}

      <section className="bg-[#0B1B3F] px-5 py-14 text-white sm:px-8 lg:px-10 lg:py-16 2xl:px-[120px]">
        <div className="mx-auto flex max-w-[1200px] flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
          <div>
            <EditableText path="marketing.features.cta.eyebrow" fallback="Klaar voor meer overzicht?" as="p" label="Functies · CTA label" className="text-xs font-black uppercase tracking-[0.2em] text-[#FF8A3D]" />
            <EditableText path="marketing.features.cta.title" fallback="Breng je vastgoedbeheer samen in SuriRent." as="h2" label="Functies · CTA titel" className="mt-2 text-2xl font-black tracking-tight sm:text-3xl" />
          </div>
          <button onClick={onRegister} className="inline-flex h-12 shrink-0 items-center gap-2 rounded-xl bg-[#FF5C00] px-6 text-sm font-black text-white transition-colors hover:bg-[#E65300]">
            <EditableText path="marketing.features.cta.button" fallback="Maak je account aan" as="span" label="Functies · CTA knop" /> <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </section>
    </main>
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
  return <KioskShowcase steps={tablets} />;
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
  starter:      { highlight: false, cta: 'Kies Starter' },
  professional: { highlight: true,  cta: 'Kies Professional' },
  lifetime:     { highlight: false, cta: 'Kies Lifetime' },
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

function PricingSection({ onDemo, onWhatsApp, onRegister, editMode }) {
  const [plans, setPlans] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [showEnterprise, setShowEnterprise] = useState(false);

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
            amount: p.amount,
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
            <EditableText path="v2.pricing.eyebrow" fallback="Prijzen" as="p" label="Prijzen · Label" className="text-xs font-black tracking-[0.3em] uppercase text-[#FF5C00] mb-3" />
            <EditableText path="v2.pricing.title" fallback="Eerlijk geprijsd voor elk vastgoedbedrijf." as="h2" label="Prijzen · Titel"
              className="text-3xl lg:text-5xl font-black tracking-tight text-[#0B1B3F] leading-tight" />
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
            className="text-3xl lg:text-5xl font-black tracking-tight text-[#0B1B3F] leading-tight" />
        </div>
        <PriceAdvisor plans={plans} onChoose={(id) => (onRegister ? onRegister(id) : onDemo())} onEnterprise={() => setShowEnterprise(true)} />
        <div className="grid md:grid-cols-3 gap-4">
          {plans.map((p) => (
            <div key={p.name}
              data-testid={`plan-${p.name.toLowerCase()}`}
              className={`relative rounded-2xl p-7 transition-all ${
                p.highlight
                  ? 'bg-[#0B1B3F] text-white shadow-[0_30px_60px_-20px_rgba(15,15,15,0.4)] md:-translate-y-3'
                  : 'bg-white border border-slate-200 hover:border-[#FF5C00] hover:shadow-[0_18px_36px_-15px_rgba(255,92,0,0.2)]'
              }`}>
              {p.highlight && (
                <div className="absolute top-0 right-7 -translate-y-1/2 px-3 py-1 rounded-md text-[10px] font-black tracking-widest uppercase bg-[#FF5C00] text-white">
                  <EditableText path={`marketing.pricing.plans.${p.id || p.name}.badge`} fallback="Aanbevolen" as="span" label={`Prijzen · ${p.name} label`} />
                </div>
              )}
              <p className={`text-sm font-black tracking-wider uppercase mb-4 ${p.highlight ? 'text-[#FF8A3D]' : 'text-[#FF5C00]'}`}>
                {p.name}
              </p>
              <div className="flex items-baseline gap-1.5">
                <span className={`text-5xl lg:text-6xl font-black tracking-tighter ${p.highlight ? 'text-white' : 'text-[#0B1B3F]'}`}>
                  {p.price === 'Custom' ? 'Op maat' : p.price}
                </span>
                {p.price !== 'Custom' && (
                  <span className={`text-sm font-bold ${p.highlight ? 'text-white/50' : 'text-slate-500'}`}>
                    {p.sub}
                  </span>
                )}
              </div>
              <EditableText path={`marketing.pricing.plans.${p.id || p.name}.description`} fallback={p.desc} as="p" multiline label={`Prijzen · ${p.name} omschrijving`}
                className={`mt-3 text-sm leading-relaxed ${p.highlight ? 'text-white/70' : 'text-slate-600'}`} />
              <button onClick={() => {
                  if (p.name === 'Enterprise') { setShowEnterprise(true); return; }
                  // Bezoeker koos een concreet plan → open register-wizard
                  // met dat plan voorgeselecteerd. Fallback op name als id
                  // ontbreekt (hardcoded fallback-plans zonder id).
                  const planId = (p.id || p.name || '').toString().toLowerCase();
                  if (onRegister) onRegister(planId); else onDemo();
                }}
                data-testid={`plan-cta-${(p.id || p.name).toString().toLowerCase()}`}
                className={`mt-6 w-full h-12 rounded-md text-sm font-black transition-colors flex items-center justify-center gap-2 ${
                  p.highlight
                    ? 'bg-[#FF5C00] hover:bg-[#FF8A3D] text-white'
                    : 'bg-[#0B1B3F] hover:bg-[#FF5C00] text-white'
                }`}>
                <EditableText path={`marketing.pricing.plans.${p.id || p.name}.cta`} fallback={p.cta} as="span" label={`Prijzen · ${p.name} knop`} /> <ArrowRight className="w-4 h-4" />
              </button>
              <ul className={`mt-6 space-y-2.5 pt-6 border-t ${p.highlight ? 'border-white/10' : 'border-slate-100'}`}>
                {p.features.map((f, index) => (
                  <li key={`${p.id || p.name}-${index}`} className={`text-sm flex items-start gap-2.5 ${p.highlight ? 'text-white/85' : 'text-[#0B1B3F]'}`}>
                    <ChevronRight className={`w-4 h-4 mt-0.5 shrink-0 ${p.highlight ? 'text-[#FF8A3D]' : 'text-[#FF5C00]'}`} strokeWidth={3} />
                    <EditableText path={`marketing.pricing.plans.${p.id || p.name}.features.${index}`} fallback={f} as="span" label={`Prijzen · ${p.name} voordeel ${index + 1}`} />
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
                    <EditableText path="marketing.pricing.limits_heading" fallback="Limieten" as="span" label="Prijzen · Limietenkop" />
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {LIMIT_LABELS.map((f, index) => (
                      <div key={f.key} className={`flex items-baseline justify-between gap-2 rounded px-2 py-1 ${p.highlight ? 'bg-white/5' : 'bg-slate-50'}`}>
                        <span className={`text-[11px] ${p.highlight ? 'text-white/60' : 'text-slate-500'}`}>
                          <EditableText path={`marketing.pricing.limit_labels.${index}`} fallback={f.label} as="span" label={`Prijzen · Limietlabel ${index + 1}`} />
                        </span>
                        <span className={`text-sm font-black font-mono tabular-nums ${p.highlight ? 'text-white' : 'text-slate-900'}`}>
                          {fmtLimit(p.limits[f.key])}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className={`text-[10px] font-black tracking-widest uppercase mt-4 mb-2 ${p.highlight ? 'text-white/50' : 'text-slate-400'}`}>
                    <EditableText path="marketing.pricing.modules_heading" fallback="Modules" as="span" label="Prijzen · Moduleskop" />
                  </p>
                  <div className="grid grid-cols-1 gap-1">
                    {FEATURE_LABELS.map((f, featureIndex) => {
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
                          <EditableText path={`marketing.pricing.feature_labels.${featureIndex}`} fallback={f.label} as="span" label={`Prijzen · Functielabel ${featureIndex + 1}`} />
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
      {showEnterprise && (
        <EnterpriseLeadModal onClose={() => setShowEnterprise(false)} editMode={editMode} />
      )}
    </section>
  );
}

// =====================================================================
// EnterpriseLeadModal — contact-formulier voor Custom / Enterprise plan.
// Bezoekers vullen bedrijfsgegevens + gewenste quota in; POST'ed naar
// /api/public/enterprise-lead. Superadmin krijgt een e-mail én de lead
// verschijnt in `enterprise_leads` collectie voor opvolging.
// =====================================================================
function EnterpriseLeadModal({ onClose, editMode }) {
  const { content } = useEditable();
  const [form, setForm] = useState({
    name: '', company: '', email: '', phone: '',
    apartments: '', tenants: '', locations: '', employees: '', message: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const text = (path, fallback) => getPath(content, path, fallback);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async () => {
    if (!form.name.trim() || !form.company.trim() || !form.email.trim()) {
      setError('Vul minimaal naam, bedrijf en e-mail in.');
      return;
    }
    if (editMode) return;
    setSubmitting(true); setError('');
    try {
      const backend = (typeof process !== 'undefined' && process.env?.REACT_APP_BACKEND_URL) || '';
      const payload = {
        name: form.name, company: form.company, email: form.email, phone: form.phone,
        message: form.message,
        apartments: form.apartments ? parseInt(form.apartments, 10) : null,
        tenants: form.tenants ? parseInt(form.tenants, 10) : null,
        locations: form.locations ? parseInt(form.locations, 10) : null,
        employees: form.employees ? parseInt(form.employees, 10) : null,
      };
      const res = await fetch(`${backend}/api/public/enterprise-lead`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.detail || 'Aanvraag mislukt');
      }
      setDone(true);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose} data-testid="enterprise-modal">
      <div onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl max-h-[92vh] overflow-y-auto">
        <button onClick={onClose} data-testid="enterprise-close"
          className="absolute top-3 right-3 w-9 h-9 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center z-10">
          <X className="w-5 h-5" />
        </button>
        {done ? (
          <div className="p-8 text-center" data-testid="enterprise-success">
            <div className="w-16 h-16 rounded-full bg-emerald-500 text-white flex items-center justify-center mx-auto mb-4">
              <Check className="w-8 h-8" strokeWidth={3} />
            </div>
            <EditableText path="marketing.enterprise_modal.success_title" fallback="Aanvraag ontvangen" as="h3" label="Enterprise-aanvraag · Bevestigingstitel" className="text-2xl font-black text-slate-900 mb-2" />
            <EditableText path="marketing.enterprise_modal.success_message" fallback="Bedankt! We nemen binnen 1 werkdag contact op met een pakket-op-maat voor uw portfolio."
              as="p" multiline label="Enterprise-aanvraag · Bevestigingstekst" className="text-sm text-slate-600 mb-6" />
            <button onClick={onClose} data-testid="enterprise-success-close"
              className="h-11 px-6 rounded-lg bg-[#0B1B3F] hover:bg-[#FF5C00] text-white font-black">
              <EditableText path="marketing.enterprise_modal.close" fallback="Sluiten" as="span" label="Enterprise-aanvraag · Sluitknop" />
            </button>
          </div>
        ) : (
          <div className="p-6">
            <EditableText path="marketing.enterprise_modal.eyebrow" fallback="Enterprise · Custom" as="p" label="Enterprise-aanvraag · Label" className="text-xs font-black tracking-[0.3em] uppercase text-[#FF5C00] mb-2" />
            <EditableText path="marketing.enterprise_modal.title" fallback="Vraag uw pakket-op-maat aan" as="h3" label="Enterprise-aanvraag · Titel" className="text-2xl font-black text-slate-900 mb-1" />
            <EditableText path="marketing.enterprise_modal.description" fallback="Vul uw gewenste quota in — wij bellen u binnen 1 werkdag met een voorstel."
              as="p" multiline label="Enterprise-aanvraag · Toelichting" className="text-sm text-slate-500 mb-5" />
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label={<EditableText path="marketing.enterprise_modal.fields.name" fallback="Naam *" as="span" label="Enterprise-aanvraag · Naamveld" />}><input value={form.name} onChange={(e) => set('name', e.target.value)} data-testid="ent-input-name" className={INPUT_CLS} /></FormField>
                <FormField label={<EditableText path="marketing.enterprise_modal.fields.company" fallback="Bedrijf *" as="span" label="Enterprise-aanvraag · Bedrijfsveld" />}><input value={form.company} onChange={(e) => set('company', e.target.value)} data-testid="ent-input-company" className={INPUT_CLS} /></FormField>
                <FormField label={<EditableText path="marketing.enterprise_modal.fields.email" fallback="E-mail *" as="span" label="Enterprise-aanvraag · E-mailveld" />}><input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} data-testid="ent-input-email" className={INPUT_CLS} /></FormField>
                <FormField label={<EditableText path="marketing.enterprise_modal.fields.phone" fallback="Telefoon" as="span" label="Enterprise-aanvraag · Telefoonveld" />}><input value={form.phone} onChange={(e) => set('phone', e.target.value)} data-testid="ent-input-phone" className={INPUT_CLS} placeholder={text('marketing.enterprise_modal.placeholders.phone', '+597 …')} /></FormField>
              </div>
              <div className="pt-2">
                <EditableText path="marketing.enterprise_modal.limits_heading" fallback="Gewenste limieten (optioneel)" as="p" label="Enterprise-aanvraag · Limietenkop" className="text-[11px] font-black uppercase tracking-widest text-slate-500 mb-2" />
                <div className="grid grid-cols-2 gap-3">
                  <FormField label={<EditableText path="marketing.enterprise_modal.fields.apartments" fallback="Appartementen" as="span" label="Enterprise-aanvraag · Appartementenveld" />}><input type="number" min="0" value={form.apartments} onChange={(e) => set('apartments', e.target.value)} data-testid="ent-input-apartments" className={INPUT_CLS} placeholder={text('marketing.enterprise_modal.placeholders.apartments', 'bv. 1000')} /></FormField>
                  <FormField label={<EditableText path="marketing.enterprise_modal.fields.tenants" fallback="Huurders" as="span" label="Enterprise-aanvraag · Huurdersveld" />}><input type="number" min="0" value={form.tenants} onChange={(e) => set('tenants', e.target.value)} data-testid="ent-input-tenants" className={INPUT_CLS} placeholder={text('marketing.enterprise_modal.placeholders.tenants', 'bv. 1500')} /></FormField>
                  <FormField label={<EditableText path="marketing.enterprise_modal.fields.locations" fallback="Locaties" as="span" label="Enterprise-aanvraag · Locatiesveld" />}><input type="number" min="0" value={form.locations} onChange={(e) => set('locations', e.target.value)} data-testid="ent-input-locations" className={INPUT_CLS} placeholder={text('marketing.enterprise_modal.placeholders.locations', 'bv. 20')} /></FormField>
                  <FormField label={<EditableText path="marketing.enterprise_modal.fields.employees" fallback="Medewerkers" as="span" label="Enterprise-aanvraag · Medewerkersveld" />}><input type="number" min="0" value={form.employees} onChange={(e) => set('employees', e.target.value)} data-testid="ent-input-employees" className={INPUT_CLS} placeholder={text('marketing.enterprise_modal.placeholders.employees', 'bv. 50')} /></FormField>
                </div>
              </div>
              <FormField label={<EditableText path="marketing.enterprise_modal.fields.message" fallback="Boodschap / vereisten" as="span" label="Enterprise-aanvraag · Berichtveld" />}><textarea rows={3} value={form.message} onChange={(e) => set('message', e.target.value)} data-testid="ent-input-message" className={INPUT_CLS + ' resize-none'} placeholder={text('marketing.enterprise_modal.placeholders.message', 'Bijvoorbeeld: SLA-eisen, integraties, tijdlijn…')} /></FormField>
              {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2" data-testid="ent-error">{error}</p>}
              <div className="flex gap-2 pt-2">
                <button onClick={onClose} data-testid="ent-cancel" className="flex-1 h-11 rounded-lg border-2 border-slate-200 text-slate-700 font-black hover:bg-slate-50"><EditableText path="marketing.enterprise_modal.cancel" fallback="Annuleren" as="span" label="Enterprise-aanvraag · Annuleerknop" /></button>
                <button onClick={submit} disabled={submitting || editMode} data-testid="ent-submit" className="flex-1 h-11 rounded-lg bg-[#0B1B3F] hover:bg-[#FF5C00] text-white font-black inline-flex items-center justify-center gap-2 disabled:opacity-50">
                  <EditableText path="marketing.enterprise_modal.submit" fallback={submitting ? 'Versturen…' : 'Verstuur aanvraag'} as="span" label="Enterprise-aanvraag · Verstuurknop" /> {!submitting && <ArrowRight className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const INPUT_CLS = 'w-full h-10 px-3 rounded-lg border-2 border-slate-200 focus:border-[#FF5C00] outline-none text-sm';

function FormField({ label, children }) {
  return (
    <label className="block">
      <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 block mb-1">{label}</span>
      {children}
    </label>
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
          <EditableText path="v2.faq.eyebrow" fallback="FAQ" as="p"
            className="text-xs font-black tracking-[0.3em] uppercase text-[#FF5C00] mb-3" />
          <EditableText path="v2.faq.title" fallback="Antwoorden op uw vragen." as="h2"
            className="text-3xl lg:text-5xl font-black tracking-tight text-[#0B1B3F] leading-tight" />
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
                    as="p" className="text-base lg:text-lg font-black text-[#0B1B3F]" />
                  {isOpen ? <ChevronUp className="w-5 h-5 text-[#FF5C00] shrink-0" />
                          : <ChevronDown className="w-5 h-5 text-[#0B1B3F] shrink-0" />}
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

function ContactPage({ editMode }) {
  const [form, setForm] = useState({ name: '', email: '', phone: '', message: '' });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const submit = async (event) => {
    event.preventDefault();
    if (editMode) return;
    setSubmitting(true);
    setError('');
    try {
      const backend = process.env.REACT_APP_BACKEND_URL || '';
      const response = await fetch(`${backend}/api/public/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.detail || 'Je bericht kon niet worden verzonden. Probeer het opnieuw.');
      }
      setSubmitted(true);
    } catch (submitError) {
      setError(submitError.message || 'Je bericht kon niet worden verzonden. Probeer het opnieuw.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main data-testid="contact-page">
      <section className="relative isolate overflow-hidden bg-[#FBF8F5]">
        <div className="absolute -right-36 -top-40 -z-10 h-[520px] w-[520px] rounded-full bg-[#FF5C00]/10 blur-3xl" />
        <div className="mx-auto grid max-w-[1440px] items-center gap-8 px-5 py-14 sm:px-8 lg:grid-cols-[1fr,auto] lg:px-10 lg:py-20 2xl:px-[120px]">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-orange-200 bg-white/80 px-3.5 py-2 text-xs font-black uppercase tracking-[0.16em] text-[#E65300]">
              <span className="h-2 w-2 rounded-full bg-[#FF5C00]" />               <EditableText path="marketing.contact.eyebrow" fallback="Contact" as="span" label="Contact · Label" />
            </p>
            <h1 className="mt-5 max-w-3xl text-4xl font-black leading-[1.05] tracking-[-0.04em] text-[#0B1B3F] sm:text-5xl lg:text-6xl">
              <EditableText path="marketing.contact.title" fallback="Een vraag?" as="span" label="Contact · Titel" />{' '}
              <EditableText path="marketing.contact.title_accent" fallback="We denken met je mee." as="span" label="Contact · Titel accent" className="text-[#FF5C00]" />
            </h1>
            <EditableText path="marketing.contact.intro" fallback="Vraag een demo aan, stel je vraag of ontdek hoe SuriRent jouw verhuurbeheer makkelijker maakt."
              as="p" multiline label="Contact · Introductie" className="mt-5 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg" />
          </div>
          <EditableLink path="marketing.contact.email_href" href="mailto:info@surirent.sr" label="Contact · E-mailadreslink"
            className="group flex items-center gap-4 rounded-2xl border border-white bg-white/85 p-4 shadow-[0_22px_55px_-35px_rgba(11,27,63,0.35)] transition-transform hover:-translate-y-1 sm:p-5">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-50 text-[#FF5C00]"><Mail className="h-5 w-5" /></span>
            <span>
              <EditableText path="marketing.contact.email_label" fallback="Mail ons rechtstreeks" as="span" label="Contact · E-mail label" className="block text-xs font-bold text-slate-500" />
              <EditableText path="marketing.contact.email" fallback="info@surirent.sr" as="span" label="Contact · E-mailadres" className="mt-1 block text-sm font-black text-[#0B1B3F] group-hover:text-[#FF5C00]" />
            </span>
            <ArrowRight className="ml-3 h-4 w-4 text-slate-300 transition-transform group-hover:translate-x-1 group-hover:text-[#FF5C00]" />
          </EditableLink>
        </div>
      </section>

      <section className="bg-white py-12 sm:py-16 lg:py-20">
        <div className="mx-auto grid max-w-[1440px] items-start gap-8 px-5 sm:px-8 lg:grid-cols-[0.95fr,1.05fr] lg:gap-10 lg:px-10 2xl:px-[120px]">
          <div className="space-y-6">
            <div className="rounded-[24px] border border-slate-100 bg-[#F8FAFC] p-2 shadow-[0_24px_60px_-40px_rgba(11,27,63,0.36)]">
              <div className="relative overflow-hidden rounded-[18px]">
                <iframe
                  title="Kaart van Paramaribo, Suriname"
                  src={'https://maps.google.com/maps?q=Paramaribo%2C%20Suriname&z=12&output=embed'}
                  className="h-72 w-full border-0 sm:h-[360px]"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  allowFullScreen
                />
                <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-3 rounded-xl border border-white/70 bg-white/95 p-3 shadow-lg backdrop-blur">
                  <p className="flex items-center gap-2 text-sm font-black text-[#0B1B3F]"><MapPin className="h-4 w-4 text-[#FF5C00]" /><EditableText path="marketing.contact.location" fallback="Paramaribo, Suriname" as="span" label="Contact · Locatie" /></p>
                  <EditableLink path="marketing.contact.map_href" href="https://maps.google.com/?q=Paramaribo%2C%20Suriname" label="Contact · Kaartlink" target="_blank" rel="noreferrer"
                    className="shrink-0 rounded-lg bg-orange-50 px-3 py-2 text-xs font-black text-[#E65300] transition-colors hover:bg-orange-100"><EditableText path="marketing.contact.map_label" fallback="Open kaart" as="span" label="Contact · Kaartknop" /></EditableLink>
                </div>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50 text-[#FF5C00]"><MessageCircle className="h-4 w-4" /></span>
                <span>
                  <EditableText path="marketing.contact.support_label" fallback="We reageren persoonlijk" as="span" label="Contact · Supportlabel" className="block text-xs font-bold text-slate-500" />
                  <EditableText path="marketing.contact.support_value" fallback="Snel en betrokken" as="span" label="Contact · Supportbelofte" className="mt-1 block text-sm font-black text-[#0B1B3F]" />
                </span>
              </div>
              <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"><Check className="h-4 w-4" /></span>
                <span>
                  <EditableText path="marketing.contact.region_label" fallback="Waar je ook bent" as="span" label="Contact · Regiolabel" className="block text-xs font-bold text-slate-500" />
                  <EditableText path="marketing.contact.region_value" fallback="Support in Suriname" as="span" label="Contact · Regiobelofte" className="mt-1 block text-sm font-black text-[#0B1B3F]" />
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-[24px] border border-slate-100 bg-white p-6 shadow-[0_24px_60px_-40px_rgba(11,27,63,0.36)] sm:p-8 lg:p-10">
            {submitted ? (
              <div className="flex min-h-[360px] flex-col items-center justify-center text-center" data-testid="contact-success">
                <span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><Check className="h-8 w-8" strokeWidth={3} /></span>
                <EditableText path="marketing.contact.success_title" fallback="Bedankt voor je bericht!" as="h2" label="Contact · Bevestigingstitel" className="mt-5 text-2xl font-black text-[#0B1B3F]" />
                <EditableText path="marketing.contact.success_message" fallback="Je bericht is verstuurd. We nemen zo snel mogelijk contact met je op." as="p" multiline label="Contact · Bevestigingstekst" className="mt-2 max-w-md text-sm leading-relaxed text-slate-500" />
              </div>
            ) : (
              <>
                <EditableText path="marketing.contact.form_label" fallback="Stuur een bericht" as="p" label="Contact · Formulierlabel" className="inline-flex rounded-full bg-orange-50 px-3 py-1.5 text-xs font-black uppercase tracking-[0.16em] text-[#E65300]" />
                <EditableText path="marketing.contact.form_title" fallback="Waar kunnen we je mee helpen?" as="h2" label="Contact · Formuliertitel" className="mt-2 text-2xl font-black text-[#0B1B3F] sm:text-3xl" />
                <EditableText path="marketing.contact.form_intro" fallback="Vul het formulier in. We komen zo snel mogelijk bij je terug." as="p" multiline label="Contact · Formulierintro" className="mt-2 text-sm leading-relaxed text-slate-500" />
                <form onSubmit={submit} className="mt-7 space-y-5" data-testid="contact-form">
                  <div className="grid gap-5 sm:grid-cols-2">
                    <label className="block text-sm font-bold text-slate-700"><EditableText path="marketing.contact.fields.name" fallback="Naam" as="span" label="Contactformulier · Naamveld" />
                      <input required maxLength={120} value={form.name} onChange={(event) => update('name', event.target.value)}
                        className={`${INPUT_CLS} mt-2`} autoComplete="name" data-testid="contact-name" />
                    </label>
                    <label className="block text-sm font-bold text-slate-700"><EditableText path="marketing.contact.fields.email" fallback="E-mailadres" as="span" label="Contactformulier · E-mailveld" />
                      <input required type="email" maxLength={160} value={form.email} onChange={(event) => update('email', event.target.value)}
                        className={`${INPUT_CLS} mt-2`} autoComplete="email" data-testid="contact-email" />
                    </label>
                  </div>
                  <label className="block text-sm font-bold text-slate-700"><EditableText path="marketing.contact.fields.phone" fallback="Telefoonnummer" as="span" label="Contactformulier · Telefoonveld" /> <span className="font-normal text-slate-400"><EditableText path="marketing.contact.fields.optional" fallback="(optioneel)" as="span" label="Contactformulier · Optioneel label" /></span>
                    <input type="tel" maxLength={40} value={form.phone} onChange={(event) => update('phone', event.target.value)}
                      className={`${INPUT_CLS} mt-2`} autoComplete="tel" data-testid="contact-phone" />
                  </label>
                  <label className="block text-sm font-bold text-slate-700"><EditableText path="marketing.contact.fields.message" fallback="Bericht" as="span" label="Contactformulier · Berichtveld" />
                    <textarea required rows={5} maxLength={3000} value={form.message} onChange={(event) => update('message', event.target.value)}
                      className={`${INPUT_CLS} mt-2 h-auto resize-y py-3`} data-testid="contact-message" />
                  </label>
                  {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" data-testid="contact-error">{error}</p>}
                  <button type="submit" disabled={submitting || editMode}
                    className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#FF5C00] px-6 text-sm font-black text-white transition-colors hover:bg-[#E65300] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                    data-testid="contact-submit">
                    <EditableText path="marketing.contact.submit" fallback={submitting ? 'Versturen…' : 'Verstuur bericht'} as="span" label="Contactformulier · Verstuurknop" /> <ArrowRight className="h-4 w-4" />
                  </button>
                </form>
              </>
            )}
            <div className="sr-only" aria-hidden="true">
              <EditableText path="marketing.contact.success_title" fallback="Bedankt voor je bericht!" label="Contact · Bevestigingstitel" />
              <EditableText path="marketing.contact.success_message" fallback="Je bericht is verstuurd. We nemen zo snel mogelijk contact met je op."
                multiline label="Contact · Bevestigingstekst" />
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function AboutPage({ onDemo, onRegister }) {
  const principles = [
    {
      icon: Target,
      title: 'Praktisch',
      description: 'We richten ons op dagelijkse taken die verhuurders echt tijd kosten: administratie, betalingen en overzicht.',
    },
    {
      icon: ShieldCheck,
      title: 'Overzichtelijk',
      description: 'Belangrijke informatie over vastgoed, huurders en betalingen staat samen op één plek.',
    },
    {
      icon: Handshake,
      title: 'Dichtbij',
      description: 'SuriRent is ontwikkeld met de praktijk van verhuur en vastgoedbeheer in Suriname als uitgangspunt.',
    },
  ];

  const capabilities = [
    ['Vastgoed organiseren', 'Breng locaties, gebouwen en verhuureenheden overzichtelijk samen.'],
    ['Huurders en afspraken beheren', 'Bewaar contactgegevens en beheer contractinformatie op één plek.'],
    ['Betalingen volgen', 'Houd ontvangen en openstaande betalingen duidelijk bij.'],
  ];

  return (
    <main className="overflow-hidden bg-[#F8F9FC]" data-testid="about-page">
      <section className="relative isolate">
        <div className="absolute -right-36 -top-40 -z-10 h-[520px] w-[520px] rounded-full bg-[#FF5C00]/10 blur-3xl" />
        <div className="mx-auto grid max-w-[1440px] items-center gap-12 px-5 py-16 sm:px-8 lg:grid-cols-[1.05fr,0.95fr] lg:px-10 lg:py-24 2xl:px-[120px]">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-orange-200 bg-white/80 px-3.5 py-2 text-xs font-black uppercase tracking-[0.16em] text-[#E65300]">
              <span className="h-2 w-2 rounded-full bg-[#FF5C00]" /> <EditableText path="marketing.about.eyebrow" fallback="Over SuriRent" as="span" label="Over ons · Label" />
            </p>
            <h1 className="mt-6 max-w-3xl text-4xl font-black leading-[1.04] tracking-[-0.045em] text-[#0B1B3F] sm:text-5xl lg:text-6xl">
              <EditableText path="marketing.about.title" fallback="Verhuren met meer" as="span" label="Over ons · Titel" />{' '}
              <EditableText path="marketing.about.title_accent" fallback="overzicht" as="span" label="Over ons · Titelaccent" className="text-[#FF5C00]" />{' '}
              <EditableText path="marketing.about.title_post" fallback="en rust." as="span" label="Over ons · Titel vervolg" />
            </h1>
            <EditableText path="marketing.about.intro" fallback="SuriRent helpt verhuurders en vastgoedbeheerders in Suriname om hun dagelijkse beheer eenvoudiger te organiseren — van vastgoed en huurders tot contracten en betalingen."
              as="p" multiline label="Over ons · Introductie" className="mt-6 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg sm:leading-8" />
            <div className="mt-8 flex flex-wrap gap-3">
              <button type="button" onClick={onDemo}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[#FF5C00] px-6 text-sm font-black text-white shadow-lg shadow-orange-200 transition hover:bg-[#E65300]"
                data-testid="about-demo">
                <EditableText path="marketing.about.demo_cta" fallback="Bekijk de demo" as="span" label="Over ons · Demoknop" /> <ArrowRight className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => onRegister()}
                className="inline-flex h-12 items-center justify-center rounded-xl border border-slate-200 bg-white px-6 text-sm font-bold text-[#0B1B3F] transition hover:border-orange-300 hover:text-[#E65300]"
                data-testid="about-register">
                <EditableText path="marketing.about.register_cta" fallback="Start met SuriRent" as="span" label="Over ons · Registratieknop" />
              </button>
            </div>
          </div>
          <div className="relative mx-auto w-full max-w-[520px]">
            <div className="absolute -inset-4 rounded-[34px] bg-gradient-to-br from-orange-200/70 via-white to-blue-100/80 blur-sm" />
            <div className="relative overflow-hidden rounded-[28px] border border-white bg-white p-5 shadow-[0_30px_90px_-40px_rgba(11,27,63,0.38)] sm:p-7">
              <div className="flex items-center justify-between border-b border-slate-100 pb-5">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#FF5C00] text-white">
                    <Building2 className="h-5 w-5" />
                  </span>
                  <div>
                    <EditableText path="marketing.about.mockup.title" fallback="Vastgoedbeheer" as="p" label="Over ons · Mockup titel" className="text-sm font-black text-[#0B1B3F]" />
                    <EditableText path="marketing.about.mockup.subtitle" fallback="Alles op één plek" as="p" label="Over ons · Mockup subtitel" className="mt-0.5 text-xs text-slate-500" />
                  </div>
                </div>
                <EditableText path="marketing.about.mockup.badge" fallback="Overzicht" as="span" label="Over ons · Mockup badge" className="rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-bold text-emerald-700" />
              </div>
              <div className="space-y-3 py-5">
                {[
                  [Building2, 'Locaties en woningen', 'Geordend per verhuureenheid'],
                  [Users, 'Huurders en contracten', 'Gegevens en afspraken bij elkaar'],
                  [Wallet, 'Betalingen', 'Inzicht in ontvangen en openstaand'],
                ].map(([Icon, title, description], index) => (
                  <div key={title} className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50/80 p-3.5">
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${index === 0 ? 'bg-orange-100 text-[#E65300]' : index === 1 ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'}`}>
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="min-w-0">
                      <EditableText path={`marketing.about.mockup.items.${index}.title`} fallback={title} as="span" label={`Over ons · Mockup item ${index + 1}`} className="block text-sm font-extrabold text-[#0B1B3F]" />
                      <EditableText path={`marketing.about.mockup.items.${index}.description`} fallback={description} as="span" label={`Over ons · Mockup toelichting ${index + 1}`} className="mt-0.5 block text-xs text-slate-500" />
                    </span>
                    <Check className="ml-auto h-4 w-4 shrink-0 text-emerald-600" />
                  </div>
                ))}
              </div>
              <div className="rounded-2xl bg-[#0B1B3F] px-5 py-4 text-white">
                <EditableText path="marketing.about.mockup.brand" fallback="SuriRent" as="p" label="Over ons · Mockup merk" className="text-xs font-bold uppercase tracking-[0.14em] text-white/55" />
                <EditableText path="marketing.about.mockup.callout" fallback="Meer grip op verhuurbeheer." as="p" label="Over ons · Mockup boodschap" className="mt-1 text-lg font-black" />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white px-5 py-16 sm:px-8 lg:px-10 lg:py-20 2xl:px-[120px]">
        <div className="mx-auto max-w-[1200px]">
          <div className="max-w-3xl">
            <EditableText path="marketing.about.why.eyebrow" fallback="Waarom SuriRent" as="p" label="Over ons · Waarom label" className="text-xs font-black uppercase tracking-[0.18em] text-[#E65300]" />
            <EditableText path="marketing.about.why.title" fallback="Gebouwd voor het dagelijkse beheer." as="h2" label="Over ons · Waarom titel" className="mt-3 text-3xl font-black tracking-tight text-[#0B1B3F] sm:text-4xl" />
            <EditableText path="marketing.about.why.description" fallback="Verhuuradministratie groeit al snel uit tot losse lijstjes, berichten en documenten. SuriRent brengt die werkzaamheden samen in een digitale omgeving die je dagelijks kunt gebruiken."
              as="p" multiline label="Over ons · Waarom toelichting" className="mt-4 text-base leading-7 text-slate-600" />
          </div>
          <div className="mt-9 grid gap-4 md:grid-cols-3">
            {principles.map(({ icon: Icon, title, description }, index) => (
              <article key={title} className="rounded-3xl border border-slate-200 bg-[#F8F9FC] p-6 sm:p-7" data-testid={`about-principle-${index + 1}`}>
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 text-[#E65300]"><Icon className="h-6 w-6" /></span>
                <EditableText path={`marketing.about.principles.${index}.title`} fallback={title} as="h3" label={`Over ons · Principe ${index + 1}`} className="mt-5 text-lg font-black text-[#0B1B3F]" />
                <EditableText path={`marketing.about.principles.${index}.description`} fallback={description} as="p" multiline label={`Over ons · Principe ${index + 1} toelichting`} className="mt-2 text-sm leading-6 text-slate-600" />
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="px-5 py-16 sm:px-8 lg:px-10 lg:py-20 2xl:px-[120px]">
        <div className="mx-auto grid max-w-[1200px] gap-10 lg:grid-cols-[0.8fr,1.2fr] lg:items-start">
          <div>
            <EditableText path="marketing.about.platform.eyebrow" fallback="Eén platform" as="p" label="Over ons · Platformlabel" className="text-xs font-black uppercase tracking-[0.18em] text-[#E65300]" />
            <EditableText path="marketing.about.platform.title" fallback="Van losse administratie naar helder overzicht." as="h2" label="Over ons · Platformtitel" className="mt-3 text-3xl font-black tracking-tight text-[#0B1B3F] sm:text-4xl" />
            <EditableText path="marketing.about.platform.description" fallback="Of je nu enkele woningen verhuurt of meerdere locaties beheert: SuriRent geeft je een centrale plek om je verhuurwerkzaamheden bij te houden."
              as="p" multiline label="Over ons · Platformtoelichting" className="mt-4 text-base leading-7 text-slate-600" />
          </div>
          <div className="space-y-3">
            {capabilities.map(([title, description], index) => (
              <article key={title} className="flex gap-4 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#0B1B3F] text-sm font-black text-white">0{index + 1}</span>
                <div>
                  <EditableText path={`marketing.about.capabilities.${index}.title`} fallback={title} as="h3" label={`Over ons · Mogelijkheid ${index + 1}`} className="font-black text-[#0B1B3F]" />
                  <EditableText path={`marketing.about.capabilities.${index}.description`} fallback={description} as="p" multiline label={`Over ons · Mogelijkheid ${index + 1} toelichting`} className="mt-1.5 text-sm leading-6 text-slate-600" />
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="px-5 pb-16 sm:px-8 lg:px-10 lg:pb-20 2xl:px-[120px]">
        <div className="mx-auto flex max-w-[1200px] flex-col items-start justify-between gap-6 rounded-[28px] bg-[#0B1B3F] p-7 text-white sm:p-10 lg:flex-row lg:items-center">
          <div>
            <EditableText path="marketing.about.cta.eyebrow" fallback="SuriRent voor verhuurders" as="p" label="Over ons · CTA label" className="text-xs font-black uppercase tracking-[0.18em] text-[#FF8A3D]" />
            <EditableText path="marketing.about.cta.title" fallback="Klaar om je verhuurbeheer overzichtelijker te maken?" as="h2" label="Over ons · CTA titel" className="mt-3 max-w-2xl text-2xl font-black tracking-tight sm:text-3xl" />
            <EditableText path="marketing.about.cta.description" fallback="Ontdek hoe het platform werkt of maak je eigen account aan." as="p" multiline label="Over ons · CTA toelichting" className="mt-3 max-w-2xl text-sm leading-6 text-white/70" />
          </div>
          <div className="flex shrink-0 flex-wrap gap-3">
            <button type="button" onClick={onDemo} className="inline-flex h-12 items-center gap-2 rounded-xl bg-[#FF5C00] px-5 text-sm font-black text-white transition hover:bg-[#E65300]">
              <EditableText path="marketing.about.cta.demo_button" fallback="Bekijk de demo" as="span" label="Over ons · CTA demoknop" /> <ArrowRight className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => onRegister()} className="inline-flex h-12 items-center rounded-xl border border-white/25 px-5 text-sm font-bold text-white transition hover:bg-white/10">
              <EditableText path="marketing.about.cta.register_button" fallback="Registreren" as="span" label="Over ons · CTA registratieknop" />
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

const LEGAL_CONTENT = {
  '/algemene-voorwaarden': {
    eyebrow: 'Juridische informatie',
    title: 'Algemene voorwaarden',
    intro: 'Deze conceptvoorwaarden beschrijven op hoofdlijnen het gebruik van SuriRent. Laat de inhoud controleren en aanvullen voordat je deze als bindende voorwaarden publiceert.',
    sections: [
      ['1. Gebruik van SuriRent', 'SuriRent biedt hulpmiddelen voor vastgoed- en huurbeheer. Je bent zelf verantwoordelijk voor het aanmaken en beheren van je account, het beveiligen van je inloggegevens en het correct gebruik van de functies.'],
      ['2. Account en gegevens', 'Houd je accountgegevens actueel en geef alleen personen toegang die bevoegd zijn om namens jouw organisatie te handelen. Je blijft verantwoordelijk voor de gegevens die jij of je gebruikers invoeren en voor de benodigde rechten en toestemmingen daarvoor.'],
      ['3. Abonnement en betaling', 'De gekozen abonnementsvorm, inbegrepen functies, eventuele gebruikslimieten en prijzen worden bij het aanbod of in je account vermeld. Betalings- en abonnementsafspraken moeten vóór publicatie worden afgestemd op het actuele aanbod van SuriRent.'],
      ['4. Beschikbaarheid en onderhoud', 'We streven naar een goed werkende dienst. Onderhoud, updates, storingen bij externe dienstverleners of omstandigheden buiten onze invloed kunnen de beschikbaarheid tijdelijk beïnvloeden. Maak waar nodig eigen exports en back-ups van belangrijke gegevens.'],
      ['5. Zorgvuldig gebruik', 'Gebruik SuriRent niet voor onrechtmatige activiteiten, het schenden van rechten van anderen of het verstoren van de dienst. We kunnen passende maatregelen nemen bij misbruik of een beveiligingsrisico, met inachtneming van toepasselijke afspraken en wetgeving.'],
      ['6. Intellectuele eigendom', 'De software, vormgeving en merkmiddelen van SuriRent blijven beschermd door de toepasselijke intellectuele-eigendomsrechten. Je krijgt alleen het gebruiksrecht dat nodig is om de dienst volgens je abonnement te gebruiken.'],
      ['7. Aansprakelijkheid en beëindiging', 'Afspraken over aansprakelijkheid, opzegtermijnen, gegevens na beëindiging en eventuele restitutie moeten worden afgestemd op het daadwerkelijke product en toepasselijk recht. Neem hiervoor contact op met SuriRent.'],
      ['8. Wijzigingen en contact', 'De definitieve voorwaarden moeten aangeven hoe wijzigingen worden aangekondigd en wanneer zij ingaan. Vragen over deze concepttekst kun je sturen naar info@surirent.sr.'],
    ],
  },
  '/privacy': {
    eyebrow: 'Juridische informatie',
    title: 'Privacyverklaring',
    intro: 'Deze conceptverklaring legt in algemene zin uit welke persoonsgegevens bij gebruik van SuriRent kunnen worden verwerkt. Controleer en vul haar aan op basis van de werkelijke gegevensstromen en toepasselijke privacywetgeving.',
    sections: [
      ['1. Wie is verantwoordelijk?', 'Deze concepttekst noemt SuriRent als contactpunt voor vragen over privacy. Vul vóór publicatie de volledige juridische naam, het vestigingsadres en de juiste contactgegevens in van de organisatie die verantwoordelijk is voor de verwerking.'],
      ['2. Welke gegevens kunnen worden verwerkt?', 'Afhankelijk van je gebruik kan SuriRent account- en contactgegevens, technische loggegevens en de gegevens die een organisatie invoert over locaties, woningen, huurders, contracten, facturen en betalingen verwerken. Dien geen gegevens in die niet nodig zijn voor het gebruik van de dienst.'],
      ['3. Waarvoor gebruiken we gegevens?', 'Gegevens kunnen nodig zijn om accounts en de dienst te beheren, functies uit te voeren, ondersteuning te bieden, beveiliging te bewaken en wettelijke verplichtingen na te komen. De precieze doelen, rechtsgronden en bewaartermijnen moeten vóór publicatie worden bevestigd.'],
      ['4. Gegevens van huurders en andere betrokkenen', 'Organisaties die SuriRent gebruiken blijven verantwoordelijk voor het bepalen welke gegevens zij invoeren en voor het informeren van hun huurders, medewerkers en andere betrokkenen. De rolverdeling tussen SuriRent en deze organisaties moet contractueel en juridisch worden vastgelegd.'],
      ['5. Delen en doorgifte', 'Voor hosting, e-mail, betalingen en andere functies kunnen dienstverleners worden ingezet. Vermeld in de definitieve verklaring welke partijen dit zijn, waar gegevens worden verwerkt en welke passende afspraken voor eventuele internationale doorgifte gelden.'],
      ['6. Beveiliging en bewaartermijn', 'Er worden passende technische en organisatorische maatregelen nagestreefd om gegevens te beschermen. Beschrijf hier de daadwerkelijk toegepaste maatregelen en bewaartermijnen; verwijder of anonimiseer gegevens wanneer ze niet langer nodig zijn, volgens de definitieve bewaarbeleidsregels.'],
      ['7. Jouw privacyrechten', 'Afhankelijk van de toepasselijke wetgeving kunnen betrokkenen rechten hebben met betrekking tot hun persoonsgegevens. De definitieve verklaring moet uitleggen hoe verzoeken kunnen worden ingediend en hoe daarop wordt gereageerd.'],
      ['8. Contact en updates', 'Voor privacyvragen kun je contact opnemen via info@surirent.sr. Voeg hier vóór publicatie de juiste contactpersoon, eventuele toezichthouderinformatie en de datum van de laatste wijziging toe.'],
    ],
  },
};

function LegalPage({ pathname }) {
  const content = LEGAL_CONTENT[pathname];
  if (!content) return null;

  return (
    <main className="bg-white" data-testid={`legal-page-${pathname.slice(1)}`}>
      <section className="relative isolate overflow-hidden bg-[#FBF8F5]">
        <div className="absolute -right-36 -top-40 -z-10 h-[520px] w-[520px] rounded-full bg-[#FF5C00]/10 blur-3xl" />
        <div className="mx-auto max-w-[1440px] px-5 py-14 sm:px-8 lg:px-10 lg:py-20 2xl:px-[120px]">
          <p className="inline-flex items-center gap-2 rounded-full border border-orange-200 bg-white/80 px-3.5 py-2 text-xs font-black uppercase tracking-[0.16em] text-[#E65300]">
            <span className="h-2 w-2 rounded-full bg-[#FF5C00]" />
            <EditableText path={`marketing.legal.${pathname.slice(1)}.eyebrow`} fallback={content.eyebrow} as="span" label={`${content.title} · Label`} />
          </p>
          <h1 className="mt-5 max-w-4xl text-4xl font-black leading-[1.05] tracking-[-0.04em] text-[#0B1B3F] sm:text-5xl lg:text-6xl">
            <EditableText path={`marketing.legal.${pathname.slice(1)}.title`} fallback={content.title} as="span" label={`${content.title} · Titel`} />
          </h1>
          <EditableText path={`marketing.legal.${pathname.slice(1)}.intro`} fallback={content.intro} as="p" multiline label={`${content.title} · Introductie`}
            className="mt-5 max-w-3xl text-base leading-relaxed text-slate-600 sm:text-lg" />
        </div>
      </section>
      <section className="bg-white px-5 py-12 sm:px-8 sm:py-16 lg:px-10 lg:py-20 2xl:px-[120px]">
        <div className="mx-auto max-w-4xl">
          <div className="mb-8 flex items-start gap-3 rounded-2xl border border-orange-200 bg-orange-50/70 p-4 text-sm leading-relaxed text-[#7C3514]">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white font-black text-[#FF5C00]">!</span>
            <p><strong><EditableText path="marketing.legal.notice_title" fallback="Concepttekst:" as="span" label="Juridische pagina · Waarschuwingstitel" /></strong>{' '}
              <EditableText path="marketing.legal.notice" fallback="deze informatie is een startpunt en is niet juridisch beoordeeld. Vul ontbrekende gegevens aan en laat de tekst controleren voordat je deze als definitief beleid gebruikt."
                as="span" multiline label="Juridische pagina · Waarschuwing" /></p>
          </div>
          <div className="divide-y divide-slate-100 rounded-[24px] border border-slate-100 bg-white px-5 shadow-[0_24px_60px_-40px_rgba(11,27,63,0.3)] sm:px-8">
            {content.sections.map(([heading, body], index) => (
              <article key={heading} className="py-6 sm:py-7">
                <EditableText path={`marketing.legal.${pathname.slice(1)}.sections.${index}.heading`} fallback={heading} as="h2"
                  label={`${content.title} · Onderdeel ${index + 1}`} className="text-lg font-black tracking-tight text-[#0B1B3F] sm:text-xl" />
                <EditableText path={`marketing.legal.${pathname.slice(1)}.sections.${index}.body`} fallback={body} as="p" multiline
                  label={`${content.title} · Onderdeel ${index + 1} tekst`} className="mt-2 text-sm leading-7 text-slate-600 sm:text-base" />
              </article>
            ))}
          </div>
          <EditableText path="marketing.legal.footnote" fallback="Concept voor beoordeling — geen juridisch advies." as="p" label="Juridische pagina · Voetnoot" className="mt-6 text-xs text-slate-400" />
        </div>
      </section>
    </main>
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
            <EditableText path="marketing.install.banner.title" fallback="Installeer SuriRent als app" as="span" label="Installatiebanner · Titel" />
          </p>
          <p className="text-[10px] sm:text-xs text-white/85 leading-tight truncate">
            <EditableText path={`marketing.install.banner.description.${platform}`} fallback={platform === 'ios' ? 'Voeg toe aan je beginscherm — direct openen zonder browser.' : 'Één tik → direct op je startscherm.'}
              as="span" label="Installatiebanner · Toelichting" />
          </p>
        </div>
        <button onClick={onInstall} data-testid="install-banner-btn"
          className="shrink-0 inline-flex items-center gap-1.5 px-3 sm:px-4 py-1.5 sm:py-2 rounded-full bg-white text-[#FF5C00] font-black text-xs hover:bg-white/90 transition-all">
          <EditableText path="marketing.install.banner.button" fallback="Installeer" as="span" label="Installatiebanner · Knop" /> <ArrowRight className="w-3 h-3" />
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

function InstallPwaSection({ install, installed, platform, showIosModal, setShowIosModal, editMode }) {
  const label = installed ? 'App is geïnstalleerd' : (
    platform === 'ios' ? 'Installeer op iPhone / iPad' :
    platform === 'android' ? 'Installeer op Android' :
    platform === 'desktop' ? 'Installeer op je computer' :
    'Download de app'
  );

  return (
    <section id="download" className="bg-[#0B1B3F] text-white py-16 lg:py-24">
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
              <button onClick={editMode ? () => setShowIosModal(true) : install}
                data-testid="marketing-install-pwa-btn"
                disabled={installed && !editMode}
                className="group inline-flex items-center gap-2.5 px-6 py-4 rounded-full bg-[#FF5C00] hover:bg-[#E64F00] disabled:bg-emerald-600 disabled:cursor-default text-white font-black text-sm shadow-[0_10px_40px_-10px_rgba(255,92,0,0.6)] transition-all">
                <Download className="w-4 h-4" />
                <EditableText path={installed ? 'marketing.install.installed_label' : 'marketing.install.button_label'} fallback={label} as="span" label="Installatie · Knop" />
                {!installed && <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />}
              </button>
              <EditableLink path="marketing.install.assistant_href" href="/assistent" label="Installatie · Assistentlink"
                data-testid="marketing-assistent-pwa-link"
                className="inline-flex items-center gap-2 px-5 py-4 rounded-full bg-white/10 hover:bg-white/15 text-white font-bold text-sm border border-white/20 transition-all">
                <EditableText path="marketing.install.assistant_link" fallback="Of installeer de AI-Assistent" as="span" label="Installatie · Assistentlink" />
                <ArrowRight className="w-4 h-4" />
              </EditableLink>
            </div>

            <div className="mt-8 grid grid-cols-3 gap-3 max-w-md">
              {[
                { icon: Apple, label: 'iPhone', sub: 'iOS 16+' },
                { icon: Smartphone, label: 'Android', sub: 'Chrome' },
                { icon: Monitor, label: 'Desktop', sub: 'Chrome / Edge' },
              ].map((p, index) => (
                <div key={p.label}
                  className="rounded-2xl bg-white/[0.04] border border-white/10 p-3 flex flex-col items-center text-center gap-1.5">
                  <p.icon className="w-5 h-5 text-[#FF8A3D]" />
                  <EditableText path={`marketing.install.platforms.${index}.label`} fallback={p.label} as="p" label={`Installatie · Platform ${index + 1}`} className="text-xs font-black text-white" />
                  <EditableText path={`marketing.install.platforms.${index}.requirement`} fallback={p.sub} as="p" label={`Installatie · Browservereiste ${index + 1}`} className="text-[10px] text-white/50" />
                </div>
              ))}
            </div>
          </div>

          {/* Rechts — mockup / benefits */}
          <div className="rounded-3xl bg-gradient-to-br from-[#13254D] to-[#0B1B3F] border border-white/10 p-6 lg:p-8 shadow-2xl">
            <EditableText path="marketing.install.benefits.heading" fallback="Waarom installeren?" as="p" label="Installatie · Voordelenkop" className="text-xs font-black tracking-[0.22em] uppercase text-white/50 mb-4" />
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
                    <EditableText path={`marketing.install.benefits.items.${i}.title`} fallback={f.t} as="p" label={`Installatie · Voordeel ${i + 1}`} className="text-sm font-black text-white" />
                    <EditableText path={`marketing.install.benefits.items.${i}.description`} fallback={f.d} as="p" multiline label={`Installatie · Voordeel ${i + 1} toelichting`} className="text-xs text-white/60 leading-relaxed mt-0.5" />
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
              <EditableText path={`marketing.install.modal.heading.${platform}`} fallback={platform === 'ios' ? 'Installeer op iPhone / iPad' : 'Installeer via je browser-menu'}
                as="h3" label="Installatie · Instructietitel" className="text-xl font-black" />
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
                  <EditableText path="marketing.install.modal.ios_steps.0" fallback="Tik op de Deel-knop onderaan Safari." as="span" label="Installatie · iPhone stap 1" />
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-6 h-6 rounded-full bg-[#FF5C00] text-white flex items-center justify-center font-black text-xs shrink-0">2</span>
                  <EditableText path="marketing.install.modal.ios_steps.1" fallback="Kies “Zet op beginscherm” uit de lijst." as="span" label="Installatie · iPhone stap 2" />
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-6 h-6 rounded-full bg-[#FF5C00] text-white flex items-center justify-center font-black text-xs shrink-0">3</span>
                  <EditableText path="marketing.install.modal.ios_steps.2" fallback="Tik rechtsboven op “Voeg toe”. De app verschijnt tussen je andere apps." as="span" label="Installatie · iPhone stap 3" />
                </li>
              </ol>
            ) : (
              <ol className="space-y-3 text-sm">
                <li className="flex items-start gap-3">
                  <span className="w-6 h-6 rounded-full bg-[#FF5C00] text-white flex items-center justify-center font-black text-xs shrink-0">1</span>
                  <EditableText path="marketing.install.modal.browser_steps.0" fallback="Open het browser-menu (⋮ of ⋯ rechtsboven in Chrome/Edge)." as="span" label="Installatie · Browserstap 1" />
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-6 h-6 rounded-full bg-[#FF5C00] text-white flex items-center justify-center font-black text-xs shrink-0">2</span>
                  <EditableText path="marketing.install.modal.browser_steps.1" fallback="Kies “App installeren” of “Installeer SuriRent”." as="span" label="Installatie · Browserstap 2" />
                </li>
                <li className="flex items-start gap-3">
                  <span className="w-6 h-6 rounded-full bg-[#FF5C00] text-white flex items-center justify-center font-black text-xs shrink-0">3</span>
                  <EditableText path="marketing.install.modal.browser_steps.2" fallback="Bevestig “Installeren”. De app verschijnt tussen je programma's." as="span" label="Installatie · Browserstap 3" />
                </li>
                <li className="mt-2 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600">
                  <EditableText path="marketing.install.modal.browser_tip_title" fallback="Zie je geen installeer-optie?" as="strong" label="Installatie · Browser tip" className="block text-slate-900 mb-1" />
                  <EditableText path="marketing.install.modal.browser_tip" fallback="Blader een paar seconden door de pagina en kom terug — sommige browsers wachten tot je actief bent voordat installeren beschikbaar wordt."
                    as="span" multiline label="Installatie · Browser tip uitleg" />
                </li>
              </ol>
            )}
            {platform === 'ios' && (
              <div className="mt-5 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600">
                <EditableText path="marketing.install.modal.ios_tip_title" fallback="Let op:" as="strong" label="Installatie · iPhone tip" className="block text-slate-900 mb-1" />
                <EditableText path="marketing.install.modal.ios_tip" fallback="Dit werkt alleen in Safari, niet in Chrome of andere browsers op iOS."
                  as="span" multiline label="Installatie · iPhone tip uitleg" />
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
function Footer({ onLogin, apk }) {
  return (
    <footer className="bg-[#0B1B3F] text-white/60">
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
            <EditableText path="marketing.footer.product_heading" fallback="Product" as="p" label="Footer · Productkop" className="text-xs font-black tracking-[0.22em] uppercase text-white mb-4" />
            <ul className="space-y-2.5 text-sm">
              {[
                ['Functies', '/functies'], ['Kiosk', '/#kiosk'], ['Prijzen', '/#pricing'],
                ['FAQ', '/#faq'], ['Contact', '/contact'],
              ].map(([label, href], index) => (
                <li key={href}>
                  <EditableLink path={`marketing.footer.product_links.${index}.href`} href={href} label={`Footer · Productlink ${index + 1}`}
                    className="hover:text-[#FF5C00] transition-colors">
                    <EditableText path={`marketing.footer.product_links.${index}.label`} fallback={label} as="span" label={`Footer · Productlink ${index + 1}`} />
                  </EditableLink>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <EditableText path="marketing.footer.contact_heading" fallback="Contact" as="p" label="Footer · Contactkop" className="text-xs font-black tracking-[0.22em] uppercase text-white mb-4" />
            <ul className="space-y-2.5 text-sm">
              <li className="flex items-center gap-2"><Mail className="w-4 h-4 text-[#FF8A3D]" />
                <EditableLink path="marketing.footer.email_href" href="mailto:info@surirent.sr" label="Footer · E-maillink" className="hover:text-white">
                  <EditableText path="v2.footer.email" fallback="info@surirent.sr" as="span" label="Footer · E-mailadres" />
                </EditableLink>
              </li>
              <li className="flex items-center gap-2"><Phone className="w-4 h-4 text-[#FF8A3D]" />
                <EditableLink path="marketing.footer.phone_href" href="tel:+5970000000" label="Footer · Telefoonlink" className="hover:text-white">
                  <EditableText path="v2.footer.phone" fallback="+597 XXX XXX" as="span" label="Footer · Telefoonnummer" />
                </EditableLink>
              </li>
              <li className="flex items-start gap-2"><Users className="w-4 h-4 text-[#FF8A3D] mt-0.5 shrink-0" />
                <EditableText path="v2.footer.address"
                  fallback="Paramaribo, Suriname — South America"
                  as="span" multiline />
              </li>
              <li className="flex items-center gap-2"><Landmark className="w-4 h-4 text-[#FF8A3D]" />
                <EditableText path="marketing.footer.registry_label" fallback="KKF" as="span" label="Footer · Registratielabel" className="text-[10px] font-black uppercase tracking-widest text-white/50 mr-1" />
                <EditableText path="v2.footer.kkf_number" fallback="173157" as="span" className="font-mono" />
              </li>
              <li className="pt-2">
                <button onClick={onLogin} data-testid="footer-login"
                  className="text-[#FF8A3D] hover:text-orange-300 font-bold">
                  <EditableText path="marketing.footer.login_button" fallback="Beheerder inloggen →" as="span" label="Footer · Beheerder inloggen" />
                </button>
              </li>
              {apk && <li className="pt-1"><ApkDownloadButton rel={apk} variant="footer" testid="footer-apk-download" /></li>}
            </ul>
          </div>
        </div>
        <div className="mt-12 pt-8 border-t border-white/10 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <EditableText path="marketing.footer.copyright" fallback="SuriRent. Alle rechten voorbehouden." as="p" label="Footer · Copyright" className="text-xs text-white/40">
              {`© ${new Date().getFullYear()} SuriRent. Alle rechten voorbehouden.`}
            </EditableText>
            <div className="flex items-center gap-2" data-testid="footer-payment-logos">
              <EditableText path="marketing.footer.payment_label" fallback="Betaal met" as="span" label="Footer · Betaalmethodenlabel" className="text-[10px] font-semibold text-white/30 uppercase tracking-wider mr-1" />
              <span className="inline-flex items-center bg-white rounded-md px-2 py-1 shadow-sm">
                <EditableImage path="marketing.footer.payment_logos.mope" fallback="/payment-logos/mope.webp" alt="MOPÉ"
                  label="Footer · MOPÉ logo" className="h-5 w-auto object-contain" data-testid="footer-logo-mope" />
              </span>
              <span className="inline-flex items-center bg-white rounded-md px-2 py-1 shadow-sm">
                <EditableImage path="marketing.footer.payment_logos.uni5pay" fallback="/payment-logos/uni5pay.webp" alt="Uni5Pay"
                  label="Footer · Uni5Pay logo" className="h-5 w-auto object-contain" data-testid="footer-logo-uni5pay" />
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <EditableText path="marketing.footer.status" fallback="Alle systemen operationeel" as="span" label="Footer · Platformstatus" className="text-xs font-semibold text-white/40" />
          </div>
        </div>
      </div>
    </footer>
  );
}

const SEO_DEFAULTS = {
  '/': {
    title: 'SuriRent | Vastgoedbeheer en verhuursoftware',
    description: 'Beheer woningen, huurders, contracten, facturen en betalingen met SuriRent, het vastgoedbeheerplatform voor verhuurders in Suriname.',
  },
  '/functies': {
    title: 'Functies | SuriRent vastgoedbeheer',
    description: 'Ontdek de functies van SuriRent voor vastgoed, huurders, contracten, facturen, betalingen en kioskbeheer.',
  },
  '/contact': {
    title: 'Contact | SuriRent',
    description: 'Neem contact op met SuriRent voor vragen, ondersteuning of een demonstratie van het vastgoedbeheerplatform.',
  },
  '/over-ons': {
    title: 'Over ons | SuriRent',
    description: 'Lees meer over SuriRent en onze aanpak voor overzichtelijk vastgoed- en verhuurbeheer in Suriname.',
  },
  '/handleiding': {
    title: 'Handleiding | SuriRent',
    description: 'Bekijk de SuriRent-handleiding voor de inrichting, medewerkerskiosk, huurdersportaal en het beheer.',
  },
  '/algemene-voorwaarden': {
    title: 'Algemene voorwaarden | SuriRent',
    description: 'Bekijk de algemene voorwaarden voor het gebruik van SuriRent.',
  },
  '/privacy': {
    title: 'Privacyverklaring | SuriRent',
    description: 'Lees hoe persoonsgegevens bij het gebruik van SuriRent kunnen worden verwerkt.',
  },
};

function MarketingSeo({ pathname }) {
  const { content } = useEditable();
  const pageKey = ({
    '/': 'home',
    '/functies': 'features',
    '/contact': 'contact',
    '/over-ons': 'about',
    '/handleiding': 'manual',
    '/algemene-voorwaarden': 'terms',
    '/privacy': 'privacy',
  })[pathname] || 'home';
  const fallback = SEO_DEFAULTS[pathname] || SEO_DEFAULTS['/'];
  const title = content?.marketing?.seo?.[pageKey]?.title || fallback.title;
  const description = content?.marketing?.seo?.[pageKey]?.description || fallback.description;

  useEffect(() => {
    document.title = title;
    let meta = document.querySelector('meta[name="description"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'description');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', description);
  }, [description, title]);

  return (
    <div className="sr-only" aria-hidden="true">
      <EditableText path={`marketing.seo.${pageKey}.title`} fallback={fallback.title} label={`${pageKey} · SEO-titel`} />
      <EditableText path={`marketing.seo.${pageKey}.description`} fallback={fallback.description} label={`${pageKey} · SEO-omschrijving`} />
    </div>
  );
}

// =============================================================================
// Main export
// =============================================================================
export default function MarketingLandingV2() {
  useHidePwaSplash();
  const navigate = useNavigate();
  const location = useLocation();
  const pwaInstall = usePwaInstall();
  const apk = useLatestApk();

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
  const showFeatureDetails = location.pathname === '/functies';
  const showContactPage = location.pathname === '/contact';
  const showAboutPage = location.pathname === '/over-ons';
  const showManualPage = location.pathname === '/handleiding';
  const showLegalPage = Boolean(LEGAL_CONTENT[location.pathname]);

  useEffect(() => {
    document.body.style.backgroundColor = '#FFFFFF';
    return () => { document.body.style.backgroundColor = ''; };
  }, []);

  useEffect(() => {
    if (['/functies', '/contact', '/over-ons', '/handleiding', '/algemene-voorwaarden', '/privacy'].includes(location.pathname)) {
      window.scrollTo(0, 0);
    }
  }, [location.pathname]);

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

  const onRegister = (planId) => {
    if (editMode) return;
    setRegisterPlan(planId || null);
    setRegisterOpen(true);
  };

  const [registerOpen, setRegisterOpen] = useState(false);
  // Wanneer bezoeker op een plan-CTA klikt (Start trial / Demo aanvragen)
  // dragen we de plan-id door naar de register-wizard zodat het pakket
  // meteen voorgeselecteerd staat op stap 4.
  const [registerPlan, setRegisterPlan] = useState(null);

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

  const launchDemo = useCallback(() => {
    if (editMode) return;
    window.location.assign(appLink('/kiosk?demo=1'));
  }, [editMode]);

  const onDemo = launchDemo;
  const onWhatsApp = () => {
    if (editMode) return;
    window.open('https://wa.me/597XXXXXXX?text=Ik%20wil%20graag%20een%20demo%20van%20SuriRent', '_blank');
  };

  // Patches doorsturen naar parent (LiveLandingEditor) zodat hij ze kan opslaan.
  const onPatch = useCallback((patch) => {
    try {
      window.parent?.postMessage({ type: 'landing-edit-patch', ...patch }, window.location.origin);
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
  }, [editMode, location.pathname]);

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
      <div className="min-h-screen bg-white text-[#0B1B3F] antialiased selection:bg-[#FF5C00] selection:text-white">
        <MarketingSeo pathname={location.pathname} />
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
        <LandingHeader onLogin={onLogin} onRegister={onRegister} />
        {showManualPage ? (
          <>
            <Handleiding onDemo={onDemo} />
            <Footer onLogin={onLogin} apk={apk} />
          </>
        ) : showAboutPage ? (
          <>
            <AboutPage onDemo={onDemo} onRegister={() => onRegister()} />
            <Footer onLogin={onLogin} apk={apk} />
          </>
        ) : showLegalPage ? (
          <>
            <LegalPage pathname={location.pathname} />
            <Footer onLogin={onLogin} apk={apk} />
          </>
        ) : showContactPage ? (
          <>
            <ContactPage editMode={editMode} />
            <Footer onLogin={onLogin} apk={apk} />
          </>
        ) : showFeatureDetails ? (
          <>
            <FeatureDetailsPage onDemo={onDemo} onRegister={() => onRegister()} />
            <Footer onLogin={onLogin} apk={apk} />
          </>
        ) : (
          <>
            <LandingHero onDemo={onDemo} apk={apk} />
            <LandingFeatures />
            <KioskSection />
            <PricingSection onDemo={onDemo} onWhatsApp={onWhatsApp} onRegister={onRegister} editMode={editMode} />
            <FAQSection />
            <InstallPwaSection
              install={pwaInstall.install}
              installed={pwaInstall.installed}
              platform={pwaInstall.platform}
              showIosModal={pwaInstall.showIosModal}
              setShowIosModal={pwaInstall.setShowIosModal}
              editMode={editMode} />
            <Footer onLogin={onLogin} apk={apk} />
          </>
        )}
      </div>
      <RegisterModal open={registerOpen} onClose={() => setRegisterOpen(false)} initialPlan={registerPlan} />
    </EditableProvider>
  );
}
