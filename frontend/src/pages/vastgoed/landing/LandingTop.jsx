// Landing (v3) — header, hero met laptop/telefoon-mockups en functiekaarten.
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowRight, ChevronDown, ChevronRight, Download, Lock, Menu, User, X, ShieldCheck, Cloud, Headphones,
  Users, CreditCard, BarChart3, Receipt, UserCheck, Tablet, Smartphone, ClipboardList, LayoutDashboard,
  FileText, BookOpen, Settings, Bell, Home as HomeIcon, Wallet, AlertCircle, MoreHorizontal,
} from 'lucide-react';
import { EditableText, EditableImage } from '../../../lib/landing-editable';
import StatusPill from '../../../components/StatusPill';

export const NAVY = '#0B1B3F';
const ORANGE = '#FF5C00';
const HERO_BG = 'https://static.prod-images.emergentagent.com/jobs/112f335e-34a5-41f6-964a-ace72b419b81/images/1fa6bb1bb7a7e25e40033b14ab2a139b4e1bd6c79ca079680347d5553f2f07f4.jpeg';
const APK_URL = `${process.env.REACT_APP_BACKEND_URL}/api/public/apk/download`;

export const goToSection = (id) => {
  if (id === 'home') { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  if (id.startsWith('feature-')) {
    window.location.assign(`/functies#${id}`);
    return;
  }
  const el = document.getElementById(id);
  if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 136, behavior: 'smooth' });
};
const SPY = ['home', 'features', 'kiosk', 'pricing', 'faq'];

const NAV = [
  { id: 'home', label: 'Home' },
  { id: 'features', label: 'Functies', menu: true },
  { id: 'kiosk', label: 'Kiosk PWA' },
  { id: 'pricing', label: 'Prijzen' },
  { id: 'faq', label: 'Service & FAQ' },
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
  return (
    <button onClick={() => (location.pathname === '/' ? goToSection('home') : navigate('/'))} className="flex items-center gap-2.5 shrink-0" data-testid="topheader-logo">
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

function FeaturesMenu({ onPick }) {
  return (
    <div className="absolute left-0 top-full pt-3 z-50" data-testid="nav-features-menu">
      <div className="w-[520px] grid grid-cols-2 gap-1 p-3 rounded-2xl bg-white border border-slate-100 shadow-[0_24px_48px_-16px_rgba(11,27,63,0.25)]">
        {FEATURES.map((f) => (
          <button key={f.title} onClick={() => onPick(f.target)} data-testid={`nav-feature-${f.title.toLowerCase().replace(/\s+/g, '-')}`}
            className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-orange-50 text-left transition-colors">
            <span className="w-9 h-9 rounded-lg bg-orange-50 flex items-center justify-center shrink-0"><f.Icon className="w-4.5 h-4.5 text-[#FF5C00]" /></span>
            <span className="text-sm font-bold" style={{ color: NAVY }}>{f.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function LandingHeader({ onLogin, onRegister }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [active, setActive] = useState('home');
  const pick = (id) => {
    setOpen(false);
    setMenu(false);
    if (id === 'features') navigate('/functies');
    else if (id === 'home') navigate('/');
    else navigate(id.startsWith('feature-') ? `/functies#${id}` : `/#${id}`);
  };
  useEffect(() => {
    if (location.pathname === '/functies') {
      setActive('features');
      return undefined;
    }
    const onScroll = () => {
      let cur = 'home';
      SPY.forEach((id) => { const el = document.getElementById(id); if (el && el.getBoundingClientRect().top <= 136) cur = id; });
      setActive(cur);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [location.pathname, location.hash]);
  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-100" data-testid="landing-header">
      <div className="max-w-[1440px] mx-auto px-5 lg:px-10 2xl:px-[120px] h-[76px] flex items-center justify-between gap-6">
        <Logo />
        <div className="flex items-center gap-3 lg:gap-4">
          <div className="hidden lg:block"><StatusPill /></div>
          <button onClick={onLogin} data-testid="topheader-login"
            className="hidden sm:inline-flex h-[44px] px-7 rounded-xl border border-slate-300 bg-white hover:border-[#FF5C00] text-[15px] font-bold items-center gap-2.5 transition-colors" style={{ color: NAVY }}>
            <Lock className="w-4 h-4" /><EditableText path="v2.brand.cta_login" fallback="Inloggen" as="span" />
          </button>
          <button onClick={() => onRegister()} data-testid="topheader-register"
            className="hidden sm:inline-flex h-[44px] px-7 rounded-xl bg-[#FF5C00] hover:bg-[#E65300] text-white text-[15px] font-bold items-center gap-2.5 shadow-[0_8px_18px_-8px_rgba(255,92,0,0.8)] transition-colors">
            <User className="w-5 h-5" /><EditableText path="v2.brand.cta_register" fallback="Registreren" as="span" />
          </button>
          <button onClick={() => setOpen(!open)} data-testid="topheader-mobile-menu" aria-label={open ? 'Sluit menu' : 'Open menu'}
            className="xl:hidden w-11 h-11 rounded-xl border border-slate-200 flex items-center justify-center">
            {open ? <X className="w-5 h-5" style={{ color: NAVY }} /> : <Menu className="w-5 h-5" style={{ color: NAVY }} />}
          </button>
        </div>
      </div>
      <nav className="hidden xl:block h-[52px] border-t border-slate-50">
        <div className="max-w-[1440px] mx-auto px-5 lg:px-10 2xl:px-[120px] h-full flex items-center justify-start gap-6 2xl:gap-9">
          {NAV.map((n) => (
            <div key={n.id} className="relative h-full" onMouseEnter={() => n.menu && setMenu(true)} onMouseLeave={() => n.menu && setMenu(false)}>
              <button onClick={() => (n.menu ? navigate('/functies') : pick(n.id))} data-testid={`secnav-${n.id}`}
                className={`relative h-full flex items-center gap-1 text-[15px] font-bold whitespace-nowrap transition-colors ${active === n.id ? 'text-[#FF5C00]' : 'hover:text-[#FF5C00]'}`}
                style={active === n.id ? undefined : { color: NAVY }}>
                {n.label}{n.menu && <ChevronDown className={`w-4 h-4 transition-transform ${menu ? 'rotate-180' : ''}`} />}
                {active === n.id && <span className="absolute left-0 right-0 bottom-[6px] h-[2px] rounded-full bg-[#FF5C00]" />}
              </button>
              {n.menu && menu && <FeaturesMenu onPick={pick} />}
            </div>
          ))}
        </div>
      </nav>
      {open && (
        <div className="xl:hidden bg-white border-t border-slate-100 px-5 py-4 space-y-1" data-testid="topheader-mobile-drawer">
          {NAV.map((n) => (
            <button key={n.id} onClick={() => pick(n.id)} data-testid={`mobile-nav-${n.id}`}
              className={`w-full text-left px-3 py-3 text-base font-bold rounded-xl hover:bg-orange-50 ${active === n.id ? 'text-[#FF5C00]' : ''}`}
              style={active === n.id ? undefined : { color: NAVY }}>{n.label}</button>
          ))}
          <div className="grid grid-cols-2 gap-2 pt-3">
            <button onClick={onLogin} data-testid="mobile-login" className="h-11 rounded-xl border border-slate-300 font-bold inline-flex items-center justify-center gap-2" style={{ color: NAVY }}><Lock className="w-4 h-4" /> Inloggen</button>
            <button onClick={() => { setOpen(false); onRegister(); }} data-testid="mobile-register" className="h-11 rounded-xl bg-[#FF5C00] text-white font-bold inline-flex items-center justify-center gap-2"><User className="w-4 h-4" /> Registreren</button>
          </div>
          <div className="pt-3"><StatusPill /></div>
        </div>
      )}
    </header>
  );
}

// ---------------- Mockups ----------------
const SIDEBAR = [[LayoutDashboard, 'Dashboard'], [Users, 'Huurders'], [Wallet, 'Betalingen'], [FileText, 'Contracten'], [BookOpen, 'Boekhouding'], [BarChart3, 'Rapporten'], [Settings, 'Instellingen']];
const KPIS = [['Totaal huurders', '12', '+1 deze maand', 'text-emerald-600'], ['Ontvangen betalingen', 'SRD 78.500', '+12% deze maand', 'text-emerald-600'], ['Openstaand saldo', 'SRD 25.750', '-8% deze maand', 'text-red-500'], ['Actieve contracten', '11', '100%', 'text-emerald-600']];
const PAYS = [['J. Ramautar', 'Huis 7A', 'SRD 7.000', '25 apr 2026', true], ['S. Gonesh', 'Huis 7B', 'SRD 6.000', '24 apr 2026', true], ['L. Soekhlal', 'Huis 7C', 'SRD 7.000', '24 apr 2026', true], ['M. Kanhai', 'Huis 7D', 'SRD 6.000', '23 apr 2026', false]];

function LaptopMockup() {
  return (
    <div className="w-[600px]" data-testid="hero-laptop">
      <div className="rounded-t-[22px] bg-[#111827] p-[10px] pb-[12px] shadow-[0_40px_80px_-30px_rgba(11,27,63,0.55)]">
        <div className="rounded-[6px] overflow-hidden bg-white flex h-[340px]">
          <div className="w-[128px] bg-[#0E1A33] px-2.5 py-3 shrink-0">
            <div className="flex items-center gap-1.5 mb-4 px-1">
              <span className="w-5 h-5 rounded-md bg-[#FF5C00] p-[3px]"><img src="/kiosk-icons/mark-white.png" alt="" className="w-full h-full" /></span>
              <span className="text-[12px] font-black text-white">Suri<span className="text-[#FF5C00]">Rent</span></span>
            </div>
            {SIDEBAR.map(([I, l], i) => (
              <div key={l} className={`flex items-center gap-2 px-2 h-[24px] rounded-md mb-[3px] text-[8px] font-semibold ${i === 0 ? 'bg-[#FF5C00] text-white' : 'text-white/70'}`}>
                <I className="w-3 h-3" />{l}
              </div>
            ))}
          </div>
          <div className="flex-1 min-w-0 px-3.5 py-2.5 bg-[#F8FAFC]">
            <div className="flex items-center justify-between text-[7px] text-slate-400">
              <span>☰</span>
              <div className="flex items-center gap-3"><span className="px-2 py-0.5 rounded bg-white border border-slate-100">Vandaag</span><Bell className="w-2.5 h-2.5" /><span className="w-3.5 h-3.5 rounded-full bg-slate-300" /></div>
            </div>
            <div className="text-[13px] font-black mt-1.5" style={{ color: NAVY }}>Dashboard</div>
            <div className="text-[6.5px] text-slate-400">Overzicht van je vastgoed en huurders.</div>
            <div className="grid grid-cols-4 gap-1.5 mt-2.5">
              {KPIS.map(([l, v, d, c]) => (
                <div key={l} className="rounded-md bg-white border border-slate-100 px-2 py-1.5">
                  <div className="text-[5.5px] text-slate-400">{l}</div>
                  <div className="text-[9px] font-black mt-1" style={{ color: NAVY }}>{v}</div>
                  <div className={`text-[5.5px] mt-1 ${c}`}>{d}</div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-[1fr,108px] gap-1.5 mt-2">
              <div className="rounded-md bg-white border border-slate-100 p-2">
                <div className="text-[7.5px] font-bold mb-1.5" style={{ color: NAVY }}>Recente betalingen</div>
                <div className="grid grid-cols-[1.2fr,1fr,1fr,1fr,0.9fr] text-[5.5px] text-slate-400 pb-1 border-b border-slate-100">
                  <span>Huurder</span><span>Appartement</span><span>Bedrag</span><span>Datum</span><span>Status</span>
                </div>
                {PAYS.map(([n, a, b, d, ok]) => (
                  <div key={n} className="grid grid-cols-[1.2fr,1fr,1fr,1fr,0.9fr] items-center text-[6px] text-slate-600 h-[20px] border-b border-slate-50">
                    <span>{n}</span><span>{a}</span><span>{b}</span><span>{d}</span>
                    <span className={`px-1 py-[1px] rounded text-[5px] w-fit ${ok ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}>{ok ? 'Ontvangen' : 'Achterstand'}</span>
                  </div>
                ))}
              </div>
              <div className="rounded-md bg-white border border-slate-100 p-2 flex flex-col items-center">
                <div className="text-[7.5px] font-bold self-start" style={{ color: NAVY }}>Huurachterstand</div>
                <svg viewBox="0 0 36 36" className="w-[62px] h-[62px] mt-2">
                  <circle cx="18" cy="18" r="15" fill="none" stroke="#F1F5F9" strokeWidth="3" />
                  <circle cx="18" cy="18" r="15" fill="none" stroke={ORANGE} strokeWidth="3" strokeDasharray="70 100" strokeLinecap="round" transform="rotate(-90 18 18)" />
                  <circle cx="18" cy="18" r="15" fill="none" stroke="#B91C1C" strokeWidth="3" strokeDasharray="14 100" strokeDashoffset="-72" strokeLinecap="round" transform="rotate(-90 18 18)" />
                  <text x="18" y="18" textAnchor="middle" fontSize="7" fontWeight="900" fill={NAVY}>2</text>
                  <text x="18" y="23" textAnchor="middle" fontSize="2.6" fontWeight="700" fill={NAVY}>Huurders</text>
                </svg>
                <div className="mt-auto text-[5.5px] font-bold" style={{ color: NAVY }}>Bekijk details →</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="h-[14px] mx-[-36px] rounded-b-[14px] bg-gradient-to-b from-[#E5E7EB] to-[#9CA3AF] relative">
        <span className="absolute left-1/2 -translate-x-1/2 top-0 w-[90px] h-[5px] rounded-b-md bg-[#9CA3AF]" />
      </div>
    </div>
  );
}

const PHONE_CARDS = [['Mijn huurders', '12', Users, 'text-[#FF5C00]'], ['Betalingen', '8', Wallet, 'text-[#FF5C00]'], ['Achterstand', '2', AlertCircle, 'text-[#FF5C00]'], ['Rapporten', 'Bekijk', FileText, 'text-blue-600']];

function PhoneMockup() {
  return (
    <div className="w-[150px] rounded-[26px] bg-[#111827] p-[6px] shadow-[0_30px_60px_-20px_rgba(11,27,63,0.6)]" data-testid="hero-phone">
      <div className="rounded-[21px] bg-white overflow-hidden h-[318px] flex flex-col relative">
        <div className="h-[18px] flex items-center justify-between px-3 text-[6px] font-bold" style={{ color: NAVY }}>
          <span>9:41</span><span className="w-[46px] h-[11px] rounded-full bg-[#111827] absolute left-1/2 -translate-x-1/2 top-[4px]" /><span>●●</span>
        </div>
        <div className="flex items-center justify-between px-2.5 py-1.5">
          <span className="flex items-center gap-1"><span className="w-3.5 h-3.5 rounded bg-[#FF5C00] p-[2px]"><img src="/kiosk-icons/mark-white.png" alt="" className="w-full h-full" /></span>
            <span className="text-[8px] font-black" style={{ color: NAVY }}>Suri<span className="text-[#FF5C00]">Rent</span></span></span>
          <Bell className="w-2.5 h-2.5 text-slate-500" />
        </div>
        <div className="px-2.5 text-[7px] font-black" style={{ color: NAVY }}>Goedemorgen, beheerder</div>
        <div className="flex-1 px-2.5 pt-2 space-y-1.5">
          {PHONE_CARDS.map(([l, v, I, c]) => (
            <div key={l} className="rounded-lg border border-slate-100 bg-white px-2 py-2 flex items-center justify-between shadow-[0_2px_6px_-3px_rgba(11,27,63,0.15)]">
              <div><div className="text-[5.5px] text-slate-400">{l}</div><div className={`text-[8px] font-black mt-1 ${v === 'Bekijk' ? 'text-[5.5px] font-semibold text-slate-400' : ''}`} style={{ color: v === 'Bekijk' ? undefined : NAVY }}>{v}</div></div>
              <span className="w-5 h-5 rounded-md bg-orange-50 flex items-center justify-center"><I className={`w-3 h-3 ${c}`} /></span>
            </div>
          ))}
        </div>
        <div className="h-[28px] border-t border-slate-100 grid grid-cols-4 text-[4.5px] text-slate-400">
          {[[HomeIcon, 'Home'], [Users, 'Huurders'], [Wallet, 'Betalingen'], [MoreHorizontal, 'Meer']].map(([I, l], i) => (
            <div key={l} className={`flex flex-col items-center justify-center gap-[2px] ${i === 0 ? 'text-[#FF5C00]' : ''}`}><I className="w-2.5 h-2.5" />{l}</div>
          ))}
        </div>
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
        <div className="absolute left-[30px] top-[20px]"><LaptopMockup /></div>
        <div className="absolute right-0 top-[100px]"><PhoneMockup /></div>
      </div>
    </div>
  );
}

function ApkCard({ rel }) {
  const v = rel ? `v${rel.version}` : 'Gratis';
  const mb = rel ? `${(rel.size / 1024 / 1024).toFixed(0)} MB` : 'App';
  const link = rel ? { href: APK_URL, download: true } : { href: '#download', onClick: (e) => { e.preventDefault(); goToSection('download'); } };
  return (
    <a {...link} data-testid="hero-apk-download"
      className="inline-flex items-center h-[56px] sm:whitespace-nowrap rounded-xl bg-white border border-slate-200 hover:border-[#FF5C00] shadow-[0_6px_16px_-10px_rgba(11,27,63,0.3)] transition-colors">
      <span className="flex-1 flex items-center gap-2.5 px-4 sm:px-5 text-[14px] sm:text-[15px] font-bold" style={{ color: NAVY }}>
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill={NAVY} aria-hidden="true"><path d="M17.6 9.48l1.84-3.18a.38.38 0 10-.66-.38l-1.86 3.22a11.4 11.4 0 00-9.84 0L5.22 5.92a.38.38 0 10-.66.38L6.4 9.48A10.8 10.8 0 001 18h22a10.8 10.8 0 00-5.4-8.52zM7 15.25a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5zm10 0a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5z" /></svg>
        Download de Android-app <Download className="w-4 h-4" />
      </span>
      <span className="h-8 w-px bg-slate-200" />
      <span className="px-4 leading-tight">
        <span className="block text-[12px] font-bold" style={{ color: NAVY }}>{v}</span>
        {mb && <span className="block text-[11px] text-slate-400">{mb}</span>}
      </span>
    </a>
  );
}

const TRUST = [[ShieldCheck, 'Veilig & betrouwbaar', 'Jouw gegevens zijn goed beschermd'], [Cloud, 'Altijd en overal', 'Toegang via web en mobiel'], [Headphones, 'Nederlandse support', 'Wij staan voor je klaar']];

export function LandingHero({ onDemo, apk }) {
  return (
    <section id="home" className="relative overflow-hidden bg-[#FBF8F5]" data-testid="hero-canvas">
      <img src={HERO_BG} alt="" className="absolute inset-y-0 right-0 h-full w-full lg:w-[72%] object-cover object-right opacity-40 lg:opacity-100" />
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
                <div className="min-w-0"><div className="text-[13px] font-bold" style={{ color: NAVY }}>{t}</div><div className="text-[11px] text-slate-400">{s}</div></div>
              </div>
            ))}
          </div>
        </div>
        <DeviceStage />
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
                <span className="block text-[17px] font-black" style={{ color: NAVY }}>{f.title}</span>
                <span className="block mt-2 text-[13px] text-slate-500 leading-relaxed">{f.desc}</span>
              </span>
              <ChevronRight className="w-5 h-5 mt-3 shrink-0 group-hover:text-[#FF5C00] group-hover:translate-x-0.5 transition-transform" style={{ color: NAVY }} />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
