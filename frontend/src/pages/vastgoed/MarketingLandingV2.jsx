// ABN AMRO-stijl landing — v11 redesign (2026-05-31).
// Dubbele top nav, hero met grote visual + dark greeting card, 8 product cards
// in 4x2 grid. Kleurschema: zwart (#0B1B3F / #13254D) + oranje (#FF5C00).
import { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { appLink } from '../../lib/env';
import { useAuth } from '../../lib/auth';
import {
  Menu, X, Lock, ChevronRight, ChevronDown, ChevronUp,
  LayoutDashboard, MapPin, Home as HomeIcon, Receipt, FileText, Users,
  Wallet, ScanLine, Building2, MessageCircle, Mail, Phone,
  Star, ArrowRight, Landmark, Download, Smartphone, Apple, Monitor,
  Share2, Plus, Check,
} from 'lucide-react';
import { EditableProvider, EditableText, EditableImage, useLandingContent } from '../../lib/landing-editable';
import StatusPill from '../../components/StatusPill';
import RegisterModal from '../../components/RegisterModal';
import { useHidePwaSplash } from '../../lib/use-hide-pwa-splash';
import { LandingHeader, LandingHero, LandingFeatures } from './landing/LandingTop';
import { KioskShowcase, PriceAdvisor } from './landing/KioskPricing';

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
    <a href={APK_URL} download data-testid={testid} className={cls}>
      <Download className="w-5 h-5" />
      <span>Download de Android-app</span>
      <span className={`text-xs font-bold ${variant === 'footer' ? 'text-white/40' : 'text-slate-500'}`}>v{rel.version} · {mb}</span>
    </a>
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
      <section className="relative overflow-hidden bg-[#0B1B3F] text-white">
        <div className="absolute -right-32 -top-40 h-[520px] w-[520px] rounded-full bg-[#FF5C00]/20 blur-3xl" />
        <div className="relative mx-auto grid max-w-[1440px] items-center gap-10 px-5 py-14 sm:px-8 lg:grid-cols-[0.8fr,1.2fr] lg:gap-14 lg:px-10 lg:py-20 2xl:px-[120px]">
          <div className="relative z-10">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-bold text-white/75">
              <span className="h-2 w-2 rounded-full bg-[#FF8A3D]" /> SuriRent functies
            </div>
            <h1 className="mt-6 text-4xl font-black leading-[1.08] tracking-tight sm:text-5xl lg:text-[56px]">
              Meer overzicht.<br /><span className="text-[#FF8A3D]">Minder handwerk.</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-white/70 sm:text-lg">
              Van locaties en huurders tot betalingen en facturen: ontdek hoe SuriRent je verhuurbeheer samenbrengt.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <button onClick={onRegister} className="inline-flex h-12 items-center gap-2 rounded-xl bg-[#FF5C00] px-6 text-sm font-black text-white transition-colors hover:bg-[#E65300]">
                Start gratis <ArrowRight className="h-4 w-4" />
              </button>
              <button onClick={onDemo} className="inline-flex h-12 items-center rounded-xl border border-white/20 px-6 text-sm font-bold text-white transition-colors hover:bg-white/10">
                Bekijk de demo
              </button>
            </div>
            <div className="mt-9 flex flex-wrap gap-x-6 gap-y-2 text-xs font-semibold text-white/55">
              <span className="flex items-center gap-2"><Check className="h-4 w-4 text-[#FF8A3D]" /> Vastgoed op één plek</span>
              <span className="flex items-center gap-2"><Check className="h-4 w-4 text-[#FF8A3D]" /> Web en mobiel</span>
            </div>
          </div>
          <div className="relative min-w-0 lg:pl-4">
            <div className="absolute -inset-4 rounded-[28px] bg-gradient-to-br from-[#FF5C00]/25 to-transparent blur-xl" />
            <div className="relative overflow-hidden rounded-2xl border border-white/15 bg-white shadow-[0_32px_80px_-32px_rgba(0,0,0,0.65)]">
              <div className="flex h-10 items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-4">
                <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
                <span className="ml-3 h-4 flex-1 rounded bg-white" />
              </div>
              <EditableImage path="v2.features.rows.0.img" fallback={FEATURE_ROWS[0].img}
                alt="SuriRent dashboard met vastgoedoverzicht" className="block aspect-[16/10] w-full object-cover object-top" />
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-slate-100 bg-white">
        <div className="mx-auto grid max-w-[1440px] gap-3 px-5 py-8 sm:grid-cols-3 sm:px-8 lg:px-10 2xl:px-[120px]">
          {[
            ['01', 'Beheer je locaties en woningen'],
            ['02', 'Volg huur en betalingen'],
            ['03', 'Houd facturen en acties bij'],
          ].map(([number, label]) => (
            <a key={number} href={`#feature-${Number(number) - 1}`}
              className="group flex items-center gap-4 rounded-xl p-3 transition-colors hover:bg-slate-50">
              <span className="text-xs font-black tracking-widest text-[#FF5C00]">{number}</span>
              <span className="text-sm font-bold text-[#0B1B3F] group-hover:text-[#FF5C00]">{label}</span>
              <ChevronRight className="ml-auto h-4 w-4 text-slate-300 transition-transform group-hover:translate-x-1 group-hover:text-[#FF5C00]" />
            </a>
          ))}
        </div>
      </section>

      {FEATURE_ROWS.map((feature, index) => {
        const Icon = feature.icon;
        const reverse = index % 2 === 1;
        return (
          <section key={feature.id} id={feature.id}
            className={index % 2 === 0 ? 'scroll-mt-36 bg-[#F8FAFC]' : 'scroll-mt-36 bg-white'}
            data-testid={`feature-detail-${index}`}>
            <div className={`mx-auto grid max-w-[1440px] items-center gap-9 px-5 py-14 sm:px-8 lg:grid-cols-2 lg:gap-16 lg:px-10 lg:py-20 2xl:px-[120px] ${reverse ? 'lg:[&>*:first-child]:order-2' : ''}`}>
              <div>
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-50 text-[#FF5C00]">
                  <Icon className="h-6 w-6" strokeWidth={1.9} />
                </div>
                <p className="mt-6 text-xs font-black uppercase tracking-[0.22em] text-[#FF5C00]">
                  {String(index + 1).padStart(2, '0')} · {feature.eyebrow}
                </p>
                <EditableText path={`v2.features.rows.${index}.title`} fallback={feature.title}
                  as="h2" className="mt-3 max-w-xl text-3xl font-black leading-tight tracking-tight text-[#0B1B3F] lg:text-4xl" />
                <EditableText path={`v2.features.rows.${index}.desc`} fallback={feature.desc}
                  as="p" multiline className="mt-4 max-w-xl text-base leading-relaxed text-slate-600" />
                <ul className="mt-6 space-y-3">
                  {feature.bullets.map((bullet, bulletIndex) => (
                    <li key={bulletIndex} className="flex items-start gap-3 text-sm font-semibold leading-relaxed text-[#0B1B3F]">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50">
                        <Check className="h-3 w-3 text-emerald-600" strokeWidth={3} />
                      </span>
                      <EditableText path={`v2.features.rows.${index}.bullets.${bulletIndex}`} fallback={bullet} as="span" />
                    </li>
                  ))}
                </ul>
              </div>
              <div className="min-w-0">
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_28px_64px_-32px_rgba(11,27,63,0.32)]">
                  <div className="flex h-9 items-center gap-1.5 border-b border-slate-100 bg-white px-3">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
                    <span className="ml-3 h-4 flex-1 rounded bg-slate-50" />
                  </div>
                  <EditableImage path={`v2.features.rows.${index}.img`} fallback={feature.img}
                    alt={feature.title} className="block aspect-[16/10] w-full object-cover object-top" />
                </div>
              </div>
            </div>
          </section>
        );
      })}

      <section className="bg-[#0B1B3F] px-5 py-14 text-white sm:px-8 lg:px-10 lg:py-16 2xl:px-[120px]">
        <div className="mx-auto flex max-w-[1200px] flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-[#FF8A3D]">Klaar voor meer overzicht?</p>
            <h2 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">Breng je vastgoedbeheer samen in SuriRent.</h2>
          </div>
          <button onClick={onRegister} className="inline-flex h-12 shrink-0 items-center gap-2 rounded-xl bg-[#FF5C00] px-6 text-sm font-black text-white transition-colors hover:bg-[#E65300]">
            Maak je account aan <ArrowRight className="h-4 w-4" />
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

function PricingSection({ onDemo, onWhatsApp, onRegister }) {
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
            <p className="text-xs font-black tracking-[0.3em] uppercase text-[#FF5C00] mb-3">Prijzen</p>
            <h2 className="text-3xl lg:text-5xl font-black tracking-tight text-[#0B1B3F] leading-tight">
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
                  Aanbevolen
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
              <p className={`mt-3 text-sm leading-relaxed ${p.highlight ? 'text-white/70' : 'text-slate-600'}`}>
                {p.desc}
              </p>
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
                {p.cta} <ArrowRight className="w-4 h-4" />
              </button>
              <ul className={`mt-6 space-y-2.5 pt-6 border-t ${p.highlight ? 'border-white/10' : 'border-slate-100'}`}>
                {p.features.map((f) => (
                  <li key={f} className={`text-sm flex items-start gap-2.5 ${p.highlight ? 'text-white/85' : 'text-[#0B1B3F]'}`}>
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
      {showEnterprise && (
        <EnterpriseLeadModal onClose={() => setShowEnterprise(false)} />
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
function EnterpriseLeadModal({ onClose }) {
  const [form, setForm] = useState({
    name: '', company: '', email: '', phone: '',
    apartments: '', tenants: '', locations: '', employees: '', message: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

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
            <h3 className="text-2xl font-black text-slate-900 mb-2">Aanvraag ontvangen</h3>
            <p className="text-sm text-slate-600 mb-6">
              Bedankt! We nemen binnen 1 werkdag contact op met een pakket-op-maat voor uw portfolio.
            </p>
            <button onClick={onClose} data-testid="enterprise-success-close"
              className="h-11 px-6 rounded-lg bg-[#0B1B3F] hover:bg-[#FF5C00] text-white font-black">
              Sluiten
            </button>
          </div>
        ) : (
          <div className="p-6">
            <p className="text-xs font-black tracking-[0.3em] uppercase text-[#FF5C00] mb-2">Enterprise · Custom</p>
            <h3 className="text-2xl font-black text-slate-900 mb-1">Vraag uw pakket-op-maat aan</h3>
            <p className="text-sm text-slate-500 mb-5">
              Vul uw gewenste quota in — wij bellen u binnen 1 werkdag met een voorstel.
            </p>
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label="Naam *"><input value={form.name} onChange={(e) => set('name', e.target.value)} data-testid="ent-input-name" className={INPUT_CLS} /></FormField>
                <FormField label="Bedrijf *"><input value={form.company} onChange={(e) => set('company', e.target.value)} data-testid="ent-input-company" className={INPUT_CLS} /></FormField>
                <FormField label="E-mail *"><input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} data-testid="ent-input-email" className={INPUT_CLS} /></FormField>
                <FormField label="Telefoon"><input value={form.phone} onChange={(e) => set('phone', e.target.value)} data-testid="ent-input-phone" className={INPUT_CLS} placeholder="+597 …" /></FormField>
              </div>
              <div className="pt-2">
                <p className="text-[11px] font-black uppercase tracking-widest text-slate-500 mb-2">Gewenste limieten (optioneel)</p>
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Appartementen"><input type="number" min="0" value={form.apartments} onChange={(e) => set('apartments', e.target.value)} data-testid="ent-input-apartments" className={INPUT_CLS} placeholder="bv. 1000" /></FormField>
                  <FormField label="Huurders"><input type="number" min="0" value={form.tenants} onChange={(e) => set('tenants', e.target.value)} data-testid="ent-input-tenants" className={INPUT_CLS} placeholder="bv. 1500" /></FormField>
                  <FormField label="Locaties"><input type="number" min="0" value={form.locations} onChange={(e) => set('locations', e.target.value)} data-testid="ent-input-locations" className={INPUT_CLS} placeholder="bv. 20" /></FormField>
                  <FormField label="Medewerkers"><input type="number" min="0" value={form.employees} onChange={(e) => set('employees', e.target.value)} data-testid="ent-input-employees" className={INPUT_CLS} placeholder="bv. 50" /></FormField>
                </div>
              </div>
              <FormField label="Boodschap / vereisten"><textarea rows={3} value={form.message} onChange={(e) => set('message', e.target.value)} data-testid="ent-input-message" className={INPUT_CLS + ' resize-none'} placeholder="Bijvoorbeeld: SLA-eisen, integraties, tijdlijn…" /></FormField>
              {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2" data-testid="ent-error">{error}</p>}
              <div className="flex gap-2 pt-2">
                <button onClick={onClose} data-testid="ent-cancel" className="flex-1 h-11 rounded-lg border-2 border-slate-200 text-slate-700 font-black hover:bg-slate-50">Annuleren</button>
                <button onClick={submit} disabled={submitting} data-testid="ent-submit" className="flex-1 h-11 rounded-lg bg-[#0B1B3F] hover:bg-[#FF5C00] text-white font-black inline-flex items-center justify-center gap-2 disabled:opacity-50">
                  {submitting ? 'Versturen…' : (<>Verstuur aanvraag <ArrowRight className="w-4 h-4" /></>)}
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
          <EditableText path="v2.faq.eyebrow" fallback="Service & FAQ" as="p"
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

function ContactPage() {
  const [form, setForm] = useState({ name: '', email: '', phone: '', message: '' });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const submit = async (event) => {
    event.preventDefault();
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
      <section className="relative overflow-hidden bg-[#0B1B3F] text-white">
        <div className="absolute -right-36 -top-40 h-[520px] w-[520px] rounded-full bg-[#FF5C00]/20 blur-3xl" />
        <div className="relative mx-auto max-w-[1440px] px-5 py-16 sm:px-8 lg:px-10 lg:py-24 2xl:px-[120px]">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-[#FF8A3D]">Contact</p>
          <h1 className="mt-4 max-w-3xl text-4xl font-black tracking-tight sm:text-5xl lg:text-6xl">We helpen je graag verder.</h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-white/70 sm:text-lg">
            Vraag een demo aan, stel je vraag of ontdek wat SuriRent voor jouw verhuurbeheer kan betekenen.
          </p>
        </div>
      </section>

      <section className="bg-[#F8FAFC] py-12 sm:py-16 lg:py-20">
        <div className="mx-auto grid max-w-[1440px] gap-8 px-5 sm:px-8 lg:grid-cols-[0.8fr,1.2fr] lg:gap-12 lg:px-10 2xl:px-[120px]">
          <div className="space-y-6">
            <div className="rounded-2xl bg-white p-6 shadow-[0_20px_50px_-36px_rgba(11,27,63,0.35)] sm:p-8">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-50 text-[#FF5C00]"><Mail className="h-5 w-5" /></span>
              <h2 className="mt-5 text-xl font-black text-[#0B1B3F]">Neem contact op</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">Stuur ons een bericht. We nemen zo snel mogelijk contact met je op.</p>
              <a href="mailto:info@surirent.sr" className="mt-5 inline-flex font-bold text-[#FF5C00] hover:underline">info@surirent.sr</a>
            </div>
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_20px_50px_-36px_rgba(11,27,63,0.35)]">
              <iframe
                title="Kaart van Paramaribo, Suriname"
                src="https://maps.google.com/maps?q=Paramaribo%2C%20Suriname&z=12&output=embed"
                className="h-64 w-full border-0 sm:h-72"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                allowFullScreen
              />
              <div className="flex items-center justify-between gap-4 p-4">
                <p className="flex items-center gap-2 text-sm font-bold text-[#0B1B3F]"><MapPin className="h-4 w-4 text-[#FF5C00]" />Paramaribo, Suriname</p>
                <a href="https://maps.google.com/?q=Paramaribo%2C%20Suriname" target="_blank" rel="noreferrer"
                  className="shrink-0 text-xs font-bold text-[#FF5C00] hover:underline">Open kaart</a>
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-[0_20px_50px_-36px_rgba(11,27,63,0.35)] sm:p-8 lg:p-10">
            {submitted ? (
              <div className="flex min-h-[360px] flex-col items-center justify-center text-center" data-testid="contact-success">
                <span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><Check className="h-8 w-8" strokeWidth={3} /></span>
                <h2 className="mt-5 text-2xl font-black text-[#0B1B3F]">Bedankt voor je bericht!</h2>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-500">Je bericht is verstuurd. We nemen zo snel mogelijk contact met je op.</p>
              </div>
            ) : (
              <>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-[#FF5C00]">Stuur een bericht</p>
                <h2 className="mt-2 text-2xl font-black text-[#0B1B3F] sm:text-3xl">Waar kunnen we je mee helpen?</h2>
                <form onSubmit={submit} className="mt-7 space-y-5" data-testid="contact-form">
                  <div className="grid gap-5 sm:grid-cols-2">
                    <label className="block text-sm font-bold text-slate-700">Naam
                      <input required maxLength={120} value={form.name} onChange={(event) => update('name', event.target.value)}
                        className={`${INPUT_CLS} mt-2`} autoComplete="name" data-testid="contact-name" />
                    </label>
                    <label className="block text-sm font-bold text-slate-700">E-mailadres
                      <input required type="email" maxLength={160} value={form.email} onChange={(event) => update('email', event.target.value)}
                        className={`${INPUT_CLS} mt-2`} autoComplete="email" data-testid="contact-email" />
                    </label>
                  </div>
                  <label className="block text-sm font-bold text-slate-700">Telefoonnummer <span className="font-normal text-slate-400">(optioneel)</span>
                    <input type="tel" maxLength={40} value={form.phone} onChange={(event) => update('phone', event.target.value)}
                      className={`${INPUT_CLS} mt-2`} autoComplete="tel" data-testid="contact-phone" />
                  </label>
                  <label className="block text-sm font-bold text-slate-700">Bericht
                    <textarea required rows={5} maxLength={3000} value={form.message} onChange={(event) => update('message', event.target.value)}
                      className={`${INPUT_CLS} mt-2 h-auto resize-y py-3`} data-testid="contact-message" />
                  </label>
                  {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" data-testid="contact-error">{error}</p>}
                  <button type="submit" disabled={submitting}
                    className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#FF5C00] px-6 text-sm font-black text-white transition-colors hover:bg-[#E65300] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                    data-testid="contact-submit">
                    {submitting ? 'Versturen…' : 'Verstuur bericht'} <ArrowRight className="h-4 w-4" />
                  </button>
                </form>
              </>
            )}
          </div>
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
          <div className="rounded-3xl bg-gradient-to-br from-[#13254D] to-[#0B1B3F] border border-white/10 p-6 lg:p-8 shadow-2xl">
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
            <p className="text-xs font-black tracking-[0.22em] uppercase text-white mb-4">Product</p>
            <ul className="space-y-2.5 text-sm">
              <li><a href="/functies" className="hover:text-[#FF5C00] transition-colors">Functies</a></li>
              <li><a href="/#kiosk" className="hover:text-[#FF5C00] transition-colors">Kiosk</a></li>
              <li><a href="/#pricing" className="hover:text-[#FF5C00] transition-colors">Prijzen</a></li>
              <li><a href="/#faq" className="hover:text-[#FF5C00] transition-colors">FAQ</a></li>
              <li><a href="/contact" className="hover:text-[#FF5C00] transition-colors">Contact</a></li>
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
                  fallback="Paramaribo, Suriname — South America"
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
              {apk && <li className="pt-1"><ApkDownloadButton rel={apk} variant="footer" testid="footer-apk-download" /></li>}
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
  useHidePwaSplash();
  const navigate = useNavigate();
  const location = useLocation();
  const { refresh: refreshAuth } = useAuth();
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
      <div className="min-h-screen bg-white text-[#0B1B3F] antialiased selection:bg-[#FF5C00] selection:text-white">
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
        {showContactPage ? (
          <>
            <ContactPage />
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
            <PricingSection onDemo={onDemo} onWhatsApp={onWhatsApp} onRegister={onRegister} />
            <FAQSection />
            <InstallPwaSection
              install={pwaInstall.install}
              installed={pwaInstall.installed}
              platform={pwaInstall.platform}
              showIosModal={pwaInstall.showIosModal}
              setShowIosModal={pwaInstall.setShowIosModal} />
            <Footer onLogin={onLogin} apk={apk} />
          </>
        )}
      </div>
      <RegisterModal open={registerOpen} onClose={() => setRegisterOpen(false)} initialPlan={registerPlan} />
    </EditableProvider>
  );
}
