// Landing (v3) — header, hero met laptop/telefoon-mockups en functiekaarten.
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowRight, ChevronRight, Download, Lock, Menu, User, X, ShieldCheck, Cloud, Headphones,
  Users, CreditCard, BarChart3, Receipt, UserCheck, Tablet, Smartphone, ClipboardList,
  FileText, Bell, Home as HomeIcon, MapPin, Wallet,
} from 'lucide-react';
import { EditableText, EditableImage, EditableLink, getPath, useEditable } from '../../../lib/landing-editable';
import { translateMarketingText } from '../../../lib/marketing-language';
import StatusPill from '../../../components/StatusPill';

export const NAVY = '#0B1B3F';
const HERO_BG = 'https://static.prod-images.emergentagent.com/jobs/112f335e-34a5-41f6-964a-ace72b419b81/images/1fa6bb1bb7a7e25e40033b14ab2a139b4e1bd6c79ca079680347d5553f2f07f4.jpeg';
const APK_URL = `${process.env.REACT_APP_BACKEND_URL}/api/public/apk/download`;

export const goToSection = (id) => {
  if (id === 'home') { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  if (id.startsWith('feature-')) {
    const params = new URLSearchParams(window.location.search);
    const editing = params.get('edit') === '1';
    window.location.assign(`/functies${editing ? '?edit=1&landing=1' : ''}#${id}`);
    return;
  }
  const el = document.getElementById(id);
  if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 136, behavior: 'smooth' });
};
const SPY = ['home', 'features', 'kiosk', 'pricing', 'faq'];

const NAV = [
  { id: 'home', label: 'Home', href: '/' },
  { id: 'features', label: 'Functies', href: '/functies' },
  { id: 'kiosk', label: 'Kiosk', href: '/#kiosk' },
  { id: 'pricing', label: 'Prijzen', href: '/#pricing' },
  { id: 'faq', label: 'FAQ', href: '/#faq' },
  { id: 'handleiding', label: 'Handleiding', href: '/handleiding' },
  { id: 'contact', label: 'Contact', href: '/contact' },
  { id: 'over-ons', label: 'Over ons', href: '/over-ons' },
];

export const FEATURES = [
  { Icon: Users, title: 'Huurdersbeheer', desc: 'Beheer huurders, contracten en gegevens.', target: 'feature-2' },
  { Icon: CreditCard, title: 'Betalingen', desc: 'Automatiseer huurbetalingen en volg achterstanden.', target: 'feature-3' },
  { Icon: BarChart3, title: 'Boekhouding', desc: 'Inkomsten, uitgaven en belastingoverzicht.', target: 'feature-0' },
  { Icon: Receipt, title: 'Kwitanties', desc: 'Digitale betalingsbewijzen met QR en handtekening.', target: 'feature-4' },
  { Icon: UserCheck, title: 'Loonstroken', desc: 'Verwerk en verstuur loonstroken eenvoudig.', target: 'feature-0' },
  { Icon: Tablet, title: 'Kiosk PWA', desc: 'Selfservice huurbetalingen via kiosk of app.', target: 'kiosk' },
  { Icon: Smartphone, title: 'PWA app', desc: 'Beheer je vastgoed op elk moment, overal.', target: 'download' },
  { Icon: ClipboardList, title: 'Rapportage', desc: 'Inzicht in prestaties en financiële overzichten.', target: 'feature-1' },
];

function Logo() {
  const navigate = useNavigate();
  const location = useLocation();
  const { editMode } = useEditable();
  return (
    <button onClick={() => (location.pathname === '/' ? goToSection('home') : navigate(editMode ? '/?edit=1&landing=1' : '/'))} className="flex items-center gap-2.5 shrink-0" data-testid="topheader-logo">
      <span className="w-12 h-12 rounded-xl bg-[#FF5C00] p-2 shrink-0 shadow-[0_6px_14px_-6px_rgba(255,92,0,0.7)]">
        <EditableImage path="v2.brand.logo_url" fallback="/kiosk-icons/mark-white.png" alt="" className="w-full h-full object-contain" />
      </span>
      <span className="text-[28px] lg:text-[32px] font-black tracking-tight leading-none" style={{ color: NAVY }}>
        <EditableText path="v2.brand.name_prefix" fallback="Suri" as="span" />
        <EditableText path="v2.brand.name_suffix" fallback="Rent" as="span" className="text-[#FF5C00]" />
      </span>
    </button>
  );
}

export function LandingHeader({ onLogin, onRegister }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { editMode, language } = useEditable();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState('home');
  const pick = (event) => {
    event.preventDefault();
    setOpen(false);
    const target = new URL(event.currentTarget.href, window.location.origin);
    if (editMode) {
      target.searchParams.set('edit', '1');
      target.searchParams.set('landing', '1');
    }
    navigate(`${target.pathname}${target.search}${target.hash}`);
  };
  useEffect(() => {
    const pageNavigation = {
      '/functies': 'features',
      '/handleiding': 'handleiding',
      '/contact': 'contact',
      '/over-ons': 'over-ons',
    };
    if (pageNavigation[location.pathname]) {
      setActive(pageNavigation[location.pathname]);
      return undefined;
    }
    const onScroll = () => {
      let cur = 'home';
      SPY.forEach((id) => { const el = document.getElementById(id); if (el && el.getBoundingClientRect().top <= 136) cur = id; });
      setActive(cur);
    };
    const timer = location.hash ? setTimeout(() => {
      const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
      if (target) window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - 136, behavior: 'smooth' });
      onScroll();
    }, 100) : null;
    if (!location.hash) onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('scroll', onScroll);
    };
  }, [location.pathname, location.hash]);
  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-100" data-testid="landing-header">
      <div className="max-w-[1440px] mx-auto px-5 lg:px-10 2xl:px-[120px] h-[76px] flex items-center justify-between gap-6">
        <Logo />
        <div className="flex items-center gap-2 sm:gap-3 lg:gap-4">
          <div className="hidden lg:block"><StatusPill /></div>
          <button onClick={onLogin} data-testid="topheader-login"
            className="hidden sm:inline-flex h-[44px] px-7 rounded-xl border border-slate-300 bg-white hover:border-[#FF5C00] text-[15px] font-bold items-center gap-2.5 transition-colors" style={{ color: NAVY }}>
            <Lock className="w-4 h-4" /><EditableText path="v2.brand.cta_login" fallback="Inloggen" as="span" />
          </button>
          <button onClick={() => onRegister()} data-testid="topheader-register"
            className="hidden sm:inline-flex h-[44px] px-7 rounded-xl bg-[#FF5C00] hover:bg-[#E65300] text-white text-[15px] font-bold items-center gap-2.5 shadow-[0_8px_18px_-8px_rgba(255,92,0,0.8)] transition-colors">
            <User className="w-5 h-5" /><EditableText path="v2.brand.cta_register" fallback="Registreren" as="span" />
          </button>
          <button onClick={() => setOpen(!open)} data-testid="topheader-mobile-menu" aria-label={translateMarketingText(open ? 'Sluit menu' : 'Open menu', language)}
            className="xl:hidden w-11 h-11 rounded-xl border border-slate-200 flex items-center justify-center">
            {open ? <X className="w-5 h-5" style={{ color: NAVY }} /> : <Menu className="w-5 h-5" style={{ color: NAVY }} />}
          </button>
        </div>
      </div>
      <nav className="hidden xl:block h-[52px] border-t border-slate-50">
        <div className="max-w-[1440px] mx-auto px-5 lg:px-10 2xl:px-[120px] h-full flex items-center justify-start gap-6 2xl:gap-9">
          {NAV.map((n, i) => (
            <div key={n.id} className="relative h-full">
              <EditableLink path={`v3.nav.items.${i}.href`} href={n.href} label={`Navigatie · ${n.label}`}
                onClick={pick} data-testid={`secnav-${n.id}`}
                className={`relative h-full flex items-center gap-1 text-[15px] font-bold whitespace-nowrap transition-colors ${active === n.id ? 'text-[#FF5C00]' : 'hover:text-[#FF5C00]'}`}
                style={active === n.id ? undefined : { color: NAVY }}>
                <EditableText path={`v3.nav.items.${i}.label`} fallback={n.label} as="span" label={`Navigatie · ${n.label}`} />
                {active === n.id && <span className="absolute left-0 right-0 bottom-[6px] h-[2px] rounded-full bg-[#FF5C00]" />}
              </EditableLink>
            </div>
          ))}
        </div>
      </nav>
      {open && (
        <div className="xl:hidden max-h-[calc(100dvh-76px)] overflow-y-auto overscroll-contain bg-white border-t border-slate-100 px-5 py-4 space-y-1" data-testid="topheader-mobile-drawer">
          {NAV.map((n, i) => (
            <EditableLink key={n.id} path={`v3.nav.items.${i}.href`} href={n.href} label={`Navigatie · ${n.label}`}
              onClick={pick} data-testid={`mobile-nav-${n.id}`}
              className={`flex w-full text-left px-3 py-3 text-base font-bold rounded-xl hover:bg-orange-50 ${active === n.id ? 'text-[#FF5C00]' : ''}`}
              style={active === n.id ? undefined : { color: NAVY }}>
              <EditableText path={`v3.nav.items.${i}.label`} fallback={n.label} as="span" label={`Navigatie · ${n.label}`} />
            </EditableLink>
          ))}
          <div className="grid grid-cols-2 gap-2 pt-3">
            <button onClick={onLogin} data-testid="mobile-login" className="h-11 rounded-xl border border-slate-300 font-bold inline-flex items-center justify-center gap-2" style={{ color: NAVY }}><Lock className="w-4 h-4" /><EditableText path="v2.brand.cta_login" fallback="Inloggen" as="span" /></button>
            <button onClick={() => { setOpen(false); onRegister(); }} data-testid="mobile-register" className="h-11 rounded-xl bg-[#FF5C00] text-white font-bold inline-flex items-center justify-center gap-2"><User className="w-4 h-4" /><EditableText path="v2.brand.cta_register" fallback="Registreren" as="span" /></button>
          </div>
          <div className="pt-3"><StatusPill /></div>
        </div>
      )}
    </header>
  );
}

// ---------------- Mockups ----------------
const MOCK_APARTMENTS = [
  ['HUIS 7A', 'Asha Ramdjan', 'Gedeeltelijk', 'partial'],
  ['HUIS 7B', 'Rakesh Soerodimedjo', 'Niet betaald', 'unpaid'],
  ['HUIS 7C', 'Naomi Pengel', 'Niet betaald', 'unpaid'],
  ['HUIS 7D', 'Jason Misiedjan', 'Niet betaald', 'unpaid'],
  ['HUIS 7E', 'Shalini Jharap', 'Niet betaald', 'unpaid'],
  ['HUIS 7F', 'Marvin Abrahams', 'Niet betaald', 'unpaid'],
  ['HUIS 7G', 'Priya Soekhlal', 'Niet betaald', 'unpaid'],
  ['HUIS 7H', 'Kevin Mungra', 'Niet betaald', 'unpaid'],
  ['HUIS 7I', 'Amina Veldwijk', 'Betaald', 'paid'],
  ['HUIS 7J', 'Rohan Jagesar', 'Betaald', 'paid'],
];
const MOCK_NAV = [[MapPin, 'Locaties'], [HomeIcon, 'Appartementen'], [Users, 'Huurders'], [FileText, 'Facturen'], [Wallet, 'Kasgeld']];

function ApartmentCard({ apartment, index, compact = false }) {
  const [unit, tenant, status, statusType] = apartment;
  const statusClass = statusType === 'paid'
    ? 'bg-emerald-600 text-white'
    : statusType === 'partial' ? 'bg-amber-500 text-white' : 'bg-red-500 text-white';
  return (
    <div className={`flex min-w-0 flex-col items-center justify-center overflow-hidden rounded-lg bg-white text-center shadow-[0_2px_8px_-5px_rgba(11,27,63,0.3)] ${compact ? 'gap-[2px] px-1 py-1' : 'gap-[3px] px-1.5 py-1.5'}`}>
      <span className={`flex shrink-0 items-center justify-center rounded-full bg-orange-50 text-[#FF5C00] ${compact ? 'h-[17px] w-[17px]' : 'h-[27px] w-[27px]'}`}>
        <HomeIcon className={compact ? 'h-[10px] w-[10px]' : 'h-[15px] w-[15px]'} strokeWidth={2.2} />
      </span>
      <EditableText path={`marketing.home.mockup.apartments.${index}.unit`} fallback={unit} as="div"
        label={`Startpagina · Mockup woning ${index + 1}`} className={`max-w-full truncate font-black leading-none ${compact ? 'text-[6px]' : 'text-[9px]'}`} style={{ color: NAVY }} />
      <div className={`flex max-w-full items-center justify-center gap-0.5 ${compact ? 'text-[5px]' : 'text-[7px]'} text-slate-600`}>
        <Users className={compact ? 'h-[7px] w-[7px] shrink-0' : 'h-[9px] w-[9px] shrink-0'} />
        <EditableText path={`marketing.home.mockup.apartments.${index}.tenant`} fallback={tenant} as="span"
          label={`Startpagina · Mockup huurder ${index + 1}`} className="truncate" />
      </div>
      <EditableText path={`marketing.home.mockup.apartments.${index}.status`} fallback={status} as="span"
        label={`Startpagina · Mockup betaalstatus ${index + 1}`}
        className={`max-w-full truncate rounded-full font-extrabold leading-none ${statusClass} ${compact ? 'px-1 py-[2px] text-[4px]' : 'px-1.5 py-[3px] text-[6px]'}`} />
    </div>
  );
}

function BrandMark({ compact = false }) {
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-lg bg-white/15 ${compact ? 'h-[18px] w-[18px]' : 'h-[22px] w-[22px]'}`}>
      <EditableImage path="v2.brand.logo_url" fallback="/kiosk-icons/mark-white.png" alt="" className={compact ? 'h-3 w-3' : 'h-4 w-4'} />
    </span>
  );
}

function LaptopMockup() {
  return (
    <div className="w-[600px]" data-testid="hero-laptop">
      <div className="rounded-t-[22px] bg-[#111827] p-[10px] pb-[12px] shadow-[0_40px_80px_-30px_rgba(11,27,63,0.55)]">
          <div className="flex h-full flex-col bg-[#F04F00]">
            <header className="flex h-[34px] shrink-0 items-center justify-between bg-[#FF5C00] px-2.5 text-white">
              <div className="flex min-w-0 items-center gap-1.5">
                <Menu className="h-3.5 w-3.5 shrink-0" />
                <BrandMark />
                <span className="truncate text-[9px] font-black">
                  <EditableText path="marketing.home.mockup.app_title" fallback="SuriRent Appartementen" as="span" label="Startpagina · Mockup applicatienaam" />
                </span>
              </div>
              <div className="mx-2 flex min-w-0 items-center gap-1 text-[7px] font-semibold">
                <MapPin className="h-3 w-3 shrink-0" />
                <EditableText path="marketing.home.mockup.location" fallback="Kewalbansingweg, #7, Paramaribo" as="span" label="Startpagina · Mockup locatie" className="truncate" />
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="rounded-full bg-white px-2 py-1 text-[6px] font-bold text-[#E65300]"><EditableText path="marketing.home.mockup.search_label" fallback="Zoek huurder" as="span" label="Startpagina · Mockup zoekknop" /></span>
                <Bell className="h-3 w-3" />
              </div>
            </header>
            <main className="min-h-0 flex-1 overflow-hidden p-2">
              <div className="grid h-full grid-cols-5 grid-rows-2 gap-1.5">
                {MOCK_APARTMENTS.map((apartment, index) => (
                  <ApartmentCard key={apartment[0]} apartment={apartment} index={index} />
                ))}
              </div>
            </main>
            <footer className="grid h-[30px] shrink-0 grid-cols-5 gap-[2px] bg-[#FF6A16] px-1 py-0.5">
              {MOCK_NAV.map(([Icon, label], index) => (
                <div key={label} className={`flex min-w-0 flex-col items-center justify-center gap-[1px] rounded-md text-white ${index === 1 ? 'bg-white/15' : ''}`}>
                  <Icon className="h-3 w-3" />
                  <EditableText path={`marketing.home.mockup.desktop_nav.${index}`} fallback={label} as="span" label={`Startpagina · Mockup desktopnavigatie ${index + 1}`} className="truncate text-[5px] font-bold" />
                </div>
              ))}
            </footer>
          </div>
        </div>
      <div className="h-[14px] mx-[-36px] rounded-b-[14px] bg-gradient-to-b from-[#E5E7EB] to-[#9CA3AF] relative">
        <span className="absolute left-1/2 -translate-x-1/2 top-0 w-[90px] h-[5px] rounded-b-md bg-[#9CA3AF]" />
      </div>
    </div>
  );
}

function PhoneMockup() {
  return (
    <div className="w-[150px] rounded-[26px] bg-[#111827] p-[6px] shadow-[0_30px_60px_-20px_rgba(11,27,63,0.6)]" data-testid="hero-phone">
      <div className="rounded-[21px] bg-white overflow-hidden h-[318px] flex flex-col">
        <div className="relative flex h-[18px] shrink-0 items-center justify-between bg-[#FF5C00] px-2.5 text-[6px] font-bold text-white">
          <span>9:41</span>
          <span className="absolute left-1/2 top-[3px] h-[9px] w-[38px] -translate-x-1/2 rounded-full bg-[#111827]" />
          <span>● ● ●</span>
        </div>
        <header className="flex h-[28px] shrink-0 items-center justify-between bg-[#FF5C00] px-2 text-white">
          <div className="flex min-w-0 items-center gap-1">
            <BrandMark compact />
            <span className="truncate text-[7px] font-black"><EditableText path="marketing.home.mockup.app_title" fallback="SuriRent Appartementen" as="span" label="Startpagina · Mockup applicatienaam" /></span>
          </div>
          <Bell className="h-3 w-3 shrink-0" />
        </header>
        <div className="flex h-[25px] shrink-0 items-center bg-[#E95100] px-2 text-[7px] font-bold text-white">
          <EditableText path="marketing.home.mockup.location" fallback="Kewalbansingweg, #7" as="span" label="Startpagina · Mockup locatie" className="truncate" />
        </div>
        <main className="min-h-0 flex-1 overflow-hidden bg-[#F04F00] p-1.5">
          <div className="grid h-full grid-cols-2 grid-rows-4 gap-1">
            {[0, 1, 2, 3, 4, 5, 8, 9].map((index) => (
              <ApartmentCard key={MOCK_APARTMENTS[index][0]} apartment={MOCK_APARTMENTS[index]} index={index} compact />
            ))}
          </div>
        </main>
        <footer className="grid h-[27px] shrink-0 grid-cols-4 bg-[#FF6A16] px-1 text-white">
          {[[HomeIcon, 'Terug'], [Users, 'Huurders'], [Wallet, 'Kasgeld'], [ChevronRight, 'Volgende']].map(([Icon, label], index) => (
            <div key={label} className={`flex min-w-0 flex-col items-center justify-center gap-[1px] ${index === 1 ? 'font-bold' : 'text-white/75'}`}>
              <Icon className="h-3 w-3" />
              <EditableText path={`marketing.home.mockup.phone_nav.${index}`} fallback={label} as="span" label={`Startpagina · Mockup telefoonnavigatie ${index + 1}`} className="truncate text-[5px]" />
            </div>
          ))}
        </footer>
      </div>
    </div>
  );
}

// Schaalt de vaste mockup-compositie mee met de beschikbare breedte.
function DeviceStage() {
  const ref = useRef(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setScale(Math.min(1.25, e.contentRect.width / 700)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="w-full relative" style={{ height: 440 * scale }} data-testid="hero-devices">
      <div className="absolute left-0 top-0 origin-top-left" style={{ width: 700, height: 440, transform: `scale(${scale})` }}>
        <div className="absolute left-[30px] top-[20px]">
          <LaptopMockup />
        </div>
        <div className="absolute right-0 top-[100px] z-[15]">
          <PhoneMockup />
        </div>
      </div>
    </div>
  );
}

function HeroVisual() {
  return <div className="relative w-full"><DeviceStage /></div>;
}

function ApkCard({ rel }) {
  const v = rel ? `v${rel.version}` : 'Gratis';
  const mb = rel ? `${(rel.size / 1024 / 1024).toFixed(0)} MB` : 'App';
  const link = rel ? { href: APK_URL, download: true } : { href: '#download', onClick: (e) => { e.preventDefault(); goToSection('download'); } };
  return (
    <EditableLink path="marketing.download.hero.href" href={link.href} download={link.download} onClick={link.onClick}
      label="Startpagina · Androiddownloadlink" data-testid="hero-apk-download"
      className="inline-flex items-center h-[56px] sm:whitespace-nowrap rounded-xl bg-white border border-slate-200 hover:border-[#FF5C00] shadow-[0_6px_16px_-10px_rgba(11,27,63,0.3)] transition-colors">
      <span className="flex-1 flex items-center gap-2.5 px-4 sm:px-5 text-[14px] sm:text-[15px] font-bold" style={{ color: NAVY }}>
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill={NAVY} aria-hidden="true"><path d="M17.6 9.48l1.84-3.18a.38.38 0 10-.66-.38l-1.86 3.22a11.4 11.4 0 00-9.84 0L5.22 5.92a.38.38 0 10-.66.38L6.4 9.48A10.8 10.8 0 001 18h22a10.8 10.8 0 00-5.4-8.52zM7 15.25a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5zm10 0a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5z" /></svg>
        <EditableText path="marketing.download.hero.label" fallback="Download de Android-app" as="span" label="Startpagina · Androiddownload knop" /> <Download className="w-4 h-4" />
      </span>
      <span className="h-8 w-px bg-slate-200" />
      <span className="px-4 leading-tight">
        <span className="block text-[12px] font-bold" style={{ color: NAVY }}>{v}</span>
        {mb && <span className="block text-[11px] text-slate-400">{mb}</span>}
      </span>
    </EditableLink>
  );
}

const TRUST = [[ShieldCheck, 'Veilig & betrouwbaar', 'Jouw gegevens zijn goed beschermd'], [Cloud, 'Altijd en overal', 'Toegang via web en mobiel'], [Headphones, 'Nederlandse support', 'Wij staan voor je klaar']];

export function LandingHero({ onDemo, apk }) {
  return (
    <section id="home" className="relative overflow-hidden bg-[#FBF8F5]" data-testid="hero-canvas">
      <EditableImage path="v3.hero.background" fallback={HERO_BG} alt=""
        label="Startpagina · Achtergrondafbeelding"
        className="absolute inset-y-0 right-0 h-full w-full lg:w-[72%] object-cover object-right opacity-40 lg:opacity-100" />
      <div className="absolute inset-0 bg-gradient-to-r from-[#FBF8F5] via-[#FBF8F5]/90 lg:via-[#FBF8F5]/60 to-transparent" />
      <div className="relative max-w-[1440px] mx-auto px-5 lg:px-10 2xl:px-[120px] pt-10 lg:pt-12 pb-12 lg:pb-14 grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,640px),minmax(0,1fr)] gap-8 xl:gap-12 items-center">
        <div>
          <EditableText path="v3.hero.eyebrow" fallback="Vastgoed Suite · Suriname 2026" as="p"
            className="inline-block px-3.5 py-1.5 rounded-md bg-[#FCE9DC] text-[12px] font-black tracking-[0.14em] uppercase text-[#E65300]" />
          <h1 className="mt-5 font-black tracking-[-0.035em] leading-[1.02]" style={{ color: NAVY, fontSize: 'clamp(2.5rem, 4.6vw, 4.1rem)' }} data-testid="hero-title">
            <EditableText path="v3.hero.title_line1" fallback="Beheer al uw" as="span" />
            <br /><EditableText path="v3.hero.title_highlight" fallback="appartementen." as="span" className="text-[#FF5C00]" />
            <br /><EditableText path="v3.hero.title_line3" fallback="Snel, overzichtelijk." as="span" />
          </h1>
          <EditableText path="v3.hero.subtitle" multiline as="p"
            fallback="Huuradministratie, betalingen, contracten, herinneringen en rapportage – allemaal in één systeem."
            className="mt-6 text-lg lg:text-[19px] font-semibold text-slate-500 max-w-[480px] leading-snug" />
          <div className="mt-7 flex flex-col sm:flex-row gap-4">
            <button onClick={onDemo} data-testid="hero-cta-action"
              className="inline-flex items-center justify-center gap-3 h-[56px] px-10 xl:px-12 whitespace-nowrap rounded-xl bg-[#FF5C00] hover:bg-[#E65300] text-white text-[17px] font-black shadow-[0_12px_24px_-10px_rgba(255,92,0,0.8)] transition-colors">
              <EditableText path="v3.hero.cta_primary" fallback="Bekijk de demo" as="span" /><ArrowRight className="w-5 h-5" />
            </button>
            <ApkCard rel={apk} />
          </div>
          <div className="mt-9 grid sm:grid-cols-3 gap-y-4">
            {TRUST.map(([I, t, s], i) => (
              <div key={t} className={`flex items-center gap-3 pr-3 ${i ? 'sm:pl-4 sm:border-l border-slate-200' : ''}`} data-testid={`hero-trust-${i}`}>
                <I className="w-9 h-9 shrink-0 text-[#FF5C00]" strokeWidth={1.8} />
                <div className="min-w-0">
                  <EditableText path={`v3.hero.trust.${i}.title`} fallback={t} as="div" label={`Startpagina · Vertrouwen ${i + 1}`} className="text-[13px] font-bold" style={{ color: NAVY }} />
                  <EditableText path={`v3.hero.trust.${i}.desc`} fallback={s} as="div" label={`Startpagina · Vertrouwen ${i + 1} toelichting`} className="text-[11px] text-slate-400" />
                </div>
              </div>
            ))}
          </div>
        </div>
        <HeroVisual />
      </div>
    </section>
  );
}

export function LandingFeatures() {
  return (
    <section id="features" className="bg-[#F8FAFC] py-8 lg:py-10" data-testid="landing-features">
      <div className="max-w-[1440px] mx-auto px-5 lg:px-10 2xl:px-[120px]">
        <div className="text-center max-w-3xl mx-auto">
          <EditableText path="v3.features.eyebrow" fallback="Onze functies" as="p" className="text-[12px] font-black tracking-[0.08em] uppercase text-[#FF5C00]" />
          <EditableText path="v3.features.title" fallback="Alles wat je nodig hebt voor slim huurbeheer" as="h2"
            className="mt-2 text-3xl lg:text-[34px] font-black tracking-[-0.02em]" style={{ color: NAVY }} />
          <EditableText path="v3.features.subtitle" multiline as="p"
            fallback="SuriRent is de complete oplossing voor verhuurders in Suriname. Of je nu 5 of 50+ appartementen beheert, wij maken het eenvoudig, efficiënt en overzichtelijk."
            className="mt-3 text-[15px] text-slate-500 leading-relaxed" />
        </div>
        <div className="mt-8 grid sm:grid-cols-2 xl:grid-cols-4 gap-5">
          {FEATURES.map((f) => (
            <button key={f.title} onClick={() => goToSection(f.target)} data-testid={`product-card-${f.title.toLowerCase().replace(/\s+/g, '-')}`}
              className="group bg-white rounded-xl px-5 py-6 flex items-start gap-4 text-left shadow-[0_8px_24px_-14px_rgba(11,27,63,0.18)] hover:-translate-y-0.5 hover:shadow-[0_18px_36px_-16px_rgba(11,27,63,0.28)] transition-[transform,box-shadow]">
              <span className="w-12 h-12 rounded-xl bg-orange-50 flex items-center justify-center shrink-0"><f.Icon className="w-6 h-6 text-[#FF5C00]" strokeWidth={1.9} /></span>
              <span className="flex-1 min-w-0">
                <EditableText path={`v3.features.items.${f.target}.title`} fallback={f.title} as="span" label={`Functiekaart · ${f.title}`} className="block text-[17px] font-black" style={{ color: NAVY }} />
                <EditableText path={`v3.features.items.${f.target}.desc`} fallback={f.desc} as="span" label={`Functiekaart · ${f.title} toelichting`} className="block mt-2 text-[13px] text-slate-500 leading-relaxed" />
              </span>
              <ChevronRight className="w-5 h-5 mt-3 shrink-0 group-hover:text-[#FF5C00] group-hover:translate-x-0.5 transition-transform" style={{ color: NAVY }} />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
