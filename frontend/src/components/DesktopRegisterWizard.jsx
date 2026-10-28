// Desktop-registratie (zelfde logica als mobiel) in split-layout met NL/EN.
import { useEffect, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Building2, MapPin, Info, Loader2, Eye, EyeOff, Check, Globe, X, ChevronDown,
  Home as HomeIcon, CreditCard, FileText, Tablet, ShieldCheck, Cloud, Headphones, User, Phone, Mail, Lock, Package,
} from 'lucide-react';
import { useRegisterWizard } from './MobileAuthShell';
import PasswordStrength from './PasswordStrength';

const NAVY = '#0B1B3F';
const SIDE_BG = 'https://static.prod-images.emergentagent.com/jobs/112f335e-34a5-41f6-964a-ace72b419b81/images/8fd0820e710c9c08a218c561eeb2f6ed295804eb31b14dc848100e36f54ed61f.jpeg';

const T = {
  nl: {
    close: 'Sluiten', prev: 'Vorige', next: 'Volgende', create: 'Account aanmaken', stepOf: (a, b) => `Stap ${a} van ${b}`,
    steps: ['Bedrijf', 'Persoon', 'Account', 'Pakket'],
    titles: ['Hoe heet je bedrijf?', 'Hoe mogen we je noemen?', 'Maak je account aan', 'Kies je pakket'],
    subs: ['Vul de bedrijfsgegevens in om je SuriRent-account aan te maken.', 'Wie is de contactpersoon van het bedrijf?', 'Hiermee log je straks in op SuriRent.', 'Kies je land en het pakket dat bij je past. 14 dagen gratis proberen.'],
    google: 'Snel registreren met Google', or: 'OF',
    company: 'Bedrijfsnaam', companyPh: 'Bijv. Demo Vastgoed N.V.', companyHint: 'Vul de volledige bedrijfsnaam in.',
    address: 'Adres', optional: '(optioneel)', addressPh: 'Straat, huisnummer, plaats', addressHint: 'Je kunt het adres later nog toevoegen.',
    name: 'Voor- en achternaam', namePh: 'Bijv. Anita Sewdas', nameHint: 'Deze naam zie je terug in je account.',
    phone: 'Telefoon', phonePh: 'Bijv. +597 8801001', phoneHint: 'Voor support en WhatsApp-meldingen.',
    email: 'E-mailadres', emailPh: 'naam@bedrijf.sr', emailHint: 'Hier ontvang je bevestigingen.',
    password: 'Wachtwoord', passwordPh: 'Minimaal 6 tekens', country: 'Land & valuta', plan: 'Pakket', perMonth: '/m',
    free: 'VRIJ', taken: 'BEZET', chosen: 'U koos', welcomeAt: 'Welkom bij', tagline: 'De complete huurbeheer oplossing voor vastgoed in Suriname.',
    feats: ['Beheer huurders en contracten', 'Automatiseer huurbetalingen & kwitanties', 'Genereer loonstroken en boekhouding', 'Selfservice kiosk terminal en PWA app'],
    script: ['Slimmer beheren.', 'Makkelijker verhuren.'], brandSub: ['Verhuur', 'Beheer', 'Financiën'], rights: 'Alle rechten voorbehouden.',
    trust: [['Veilig en betrouwbaar', 'Jouw gegevens zijn goed beschermd'], ['Altijd en overal', 'Toegang via web en mobiel'], ['Nederlandse support', 'Wij staan voor je klaar']],
    successT: 'Welkom!', successS: 'Je eigen vastgoed-omgeving is aangemaakt en klaar voor gebruik. 14 dagen gratis proberen.', toDash: 'Naar mijn dashboard',
    countries: { SR: 'Suriname', NL: 'Nederland' },
  },
  en: {
    close: 'Close', prev: 'Back', next: 'Next', create: 'Create account', stepOf: (a, b) => `Step ${a} of ${b}`,
    steps: ['Company', 'Person', 'Account', 'Plan'],
    titles: ['What is your company called?', 'What should we call you?', 'Create your account', 'Choose your plan'],
    subs: ['Enter your company details to create your SuriRent account.', 'Who is the contact person of the company?', 'You will use this to sign in to SuriRent.', 'Choose your country and the plan that suits you. 14-day free trial.'],
    google: 'Quick sign-up with Google', or: 'OR',
    company: 'Company name', companyPh: 'E.g. Demo Real Estate Ltd.', companyHint: 'Enter the full company name.',
    address: 'Address', optional: '(optional)', addressPh: 'Street, number, city', addressHint: 'You can add the address later.',
    name: 'Full name', namePh: 'E.g. Anita Sewdas', nameHint: 'This name is shown in your account.',
    phone: 'Phone', phonePh: 'E.g. +597 8801001', phoneHint: 'For support and WhatsApp notifications.',
    email: 'Email address', emailPh: 'name@company.com', emailHint: 'Confirmations are sent here.',
    password: 'Password', passwordPh: 'At least 6 characters', country: 'Country & currency', plan: 'Plan', perMonth: '/mo',
    free: 'AVAILABLE', taken: 'TAKEN', chosen: 'You chose', welcomeAt: 'Welcome to', tagline: 'The complete rental management solution for real estate in Suriname.',
    feats: ['Manage tenants and contracts', 'Automate rent payments & receipts', 'Generate payslips and accounting', 'Self-service kiosk terminal and PWA app'],
    script: ['Smarter managing.', 'Easier renting.'], brandSub: ['Rental', 'Management', 'Finance'], rights: 'All rights reserved.',
    trust: [['Safe and reliable', 'Your data is well protected'], ['Always and everywhere', 'Access via web and mobile'], ['Local support', 'We are here for you']],
    successT: 'Welcome!', successS: 'Your own real-estate environment has been created and is ready to use. 14-day free trial.', toDash: 'Go to my dashboard',
    countries: { SR: 'Suriname', NL: 'Netherlands' },
  },
};

const STEP_ICONS = [Building2, User, Lock, Package];
const FEAT_ICONS = [HomeIcon, CreditCard, FileText, Tablet];

function Flag({ lang }) {
  if (lang === 'nl') {
    return <span className="w-6 h-6 rounded-full overflow-hidden flex flex-col shadow-inner shrink-0"><span className="flex-1 bg-[#AE1C28]" /><span className="flex-1 bg-white" /><span className="flex-1 bg-[#21468B]" /></span>;
  }
  return (
    <span className="w-6 h-6 rounded-full overflow-hidden relative bg-[#012169] shrink-0">
      <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[6px] bg-white" /><span className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[6px] bg-white" />
      <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[3px] bg-[#C8102E]" /><span className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[3px] bg-[#C8102E]" />
    </span>
  );
}

function LangSwitch({ lang, setLang }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} data-testid="register-lang-toggle"
        className="h-12 px-4 rounded-2xl bg-white shadow-[0_6px_18px_-10px_rgba(11,27,63,0.35)] flex items-center gap-2.5 text-sm font-bold" style={{ color: NAVY }}>
        <Flag lang={lang} />{lang.toUpperCase()}<ChevronDown className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-40 rounded-xl bg-white shadow-[0_18px_40px_-16px_rgba(11,27,63,0.35)] p-1.5 z-10" data-testid="register-lang-menu">
          {[['nl', 'Nederlands'], ['en', 'English']].map(([c, l]) => (
            <button key={c} type="button" onClick={() => { setLang(c); setOpen(false); }} data-testid={`register-lang-${c}`}
              className={`w-full h-10 px-2.5 rounded-lg flex items-center gap-2.5 text-sm font-bold hover:bg-orange-50 ${lang === c ? 'text-[#FF5C00]' : ''}`} style={lang === c ? undefined : { color: NAVY }}>
              <Flag lang={c} />{l}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ icon: Icon, label, required, optional, hint, children }) {
  return (
    <div>
      <div className="flex items-center gap-2.5 mb-2.5 text-[15px] font-bold" style={{ color: NAVY }}>
        <Icon className="w-5 h-5" />{label}{required && <span className="text-[#FF5C00]">*</span>}
        {optional && <span className="font-medium text-slate-400">{optional}</span>}
      </div>
      {children}
      {hint && <p className="mt-2.5 flex items-center gap-2 text-[12px] text-slate-500"><Info className="w-4 h-4 text-slate-400" />{hint}</p>}
    </div>
  );
}

const INPUT = 'w-full h-14 pl-12 pr-4 rounded-xl border border-slate-200 bg-white text-[15px] font-medium text-slate-900 placeholder:text-slate-400 outline-none focus:border-[#FF5C00] focus:ring-4 focus:ring-orange-100 transition-[border-color,box-shadow]';

function IconInput({ icon: Icon, right, ...props }) {
  return (
    <div className="relative">
      <Icon className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
      <input {...props} className={INPUT} />
      {right}
    </div>
  );
}

function Stepper({ step, labels }) {
  return (
    <div className="grid grid-cols-4" data-testid="register-stepper">
      {labels.map((l, i) => (
        <div key={l} className="relative flex flex-col items-center" data-testid={`register-stepper-${i}`}>
          {i < labels.length - 1 && <span className={`absolute top-[18px] left-[calc(50%+26px)] right-[calc(-50%+26px)] h-[2px] rounded ${i < step ? 'bg-[#FF5C00]' : 'bg-slate-200'}`} />}
          <span className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-black ${i <= step ? 'bg-[#FF5C00] text-white shadow-[0_6px_14px_-6px_rgba(255,92,0,0.8)]' : 'bg-white text-slate-700 shadow-[0_2px_8px_-2px_rgba(11,27,63,0.2)]'}`}>
            {i < step ? <Check className="w-4 h-4" strokeWidth={3} /> : i + 1}
          </span>
          <span className={`mt-2.5 text-[14px] ${i === step ? 'font-bold text-[#FF5C00]' : 'text-slate-500'}`}>{l}</span>
        </div>
      ))}
    </div>
  );
}

function SidePanel({ t }) {
  return (
    <aside className="relative w-[420px] xl:w-[460px] shrink-0 overflow-hidden text-white flex flex-col px-14 pt-24 pb-10" data-testid="register-side">
      <img src={SIDE_BG} alt="" className="absolute inset-0 w-full h-full object-cover" />
      <div className="absolute inset-0" style={{ background: 'linear-gradient(160deg, rgba(11,27,63,0.97) 0%, rgba(11,27,63,0.88) 45%, rgba(11,27,63,0.55) 100%)' }} />
      <div className="absolute -top-20 -left-20 w-40 h-40 bg-[#FF5C00] rotate-45" />
      <div className="absolute -bottom-24 -right-10 w-[380px] h-[200px] rounded-[50%] bg-gradient-to-r from-[#FF5C00] to-[#FF8A3D] opacity-90 blur-[2px]" />
      <div className="relative flex-1 flex flex-col">
        <div>
          <div className="flex items-center gap-3">
            <span className="w-14 h-14 rounded-2xl bg-[#FF5C00] p-2.5 shadow-lg ring-2 ring-white/90"><img src="/kiosk-icons/mark-white.png" alt="" className="w-full h-full" /></span>
            <span className="text-[34px] font-black tracking-tight">Suri<span className="text-[#FF8A3D]">Rent</span></span>
          </div>
          <p className="mt-2 text-[13px] font-bold tracking-[0.12em] text-white/85">{t.brandSub.join('  ·  ')}</p>
        </div>
        <p className="mt-10 text-2xl font-bold">{t.welcomeAt}</p>
        <p className="text-5xl font-black tracking-tight">Suri<span className="text-[#FF8A3D]">Rent</span></p>
        <p className="mt-4 text-[15px] text-white/85 leading-relaxed max-w-[300px]">{t.tagline}</p>
        <div className="mt-8 space-y-4">
          {t.feats.map((f, i) => {
            const I = FEAT_ICONS[i];
            return (
              <div key={f} className="flex items-center gap-4">
                <span className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#FF8A3D] to-[#FF5C00] flex items-center justify-center shrink-0 shadow-lg"><I className="w-5 h-5" /></span>
                <span className="text-[14px] text-white/90 max-w-[190px] leading-snug">{f}</span>
              </div>
            );
          })}
        </div>
        <div className="mt-8 -rotate-[8deg] origin-left text-[#FF8A3D] text-[30px] leading-[1.15]" style={{ fontFamily: "'Caveat', cursive", fontWeight: 600 }}>
          <div>{t.script[0]}</div><div className="pl-2">{t.script[1]}</div>
        </div>
        <p className="mt-auto pt-8 text-[11px] text-white/70"><b className="text-white">SuriRent</b> &nbsp;© {new Date().getFullYear()}. {t.rights}</p>
      </div>
    </aside>
  );
}

export default function DesktopRegisterWizard({ onClose, initialPlan }) {
  const w = useRegisterWizard({ onClose, initialPlan });
  const [lang, setLangState] = useState(() => { try { return localStorage.getItem('register_lang') || 'nl'; } catch { return 'nl'; } });
  const setLang = (l) => { setLangState(l); try { localStorage.setItem('register_lang', l); } catch { /* ignore */ } };
  const t = T[lang];
  useEffect(() => {
    if (document.getElementById('caveat-font')) return;
    const l = document.createElement('link');
    l.id = 'caveat-font'; l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Caveat:wght@600&display=swap';
    document.head.appendChild(l);
  }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Enter' && e.target?.tagName === 'INPUT') w.next(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const StepIcon = STEP_ICONS[w.step];
  const google = () => {
    const redirectUrl = window.location.origin + '/auth/callback';
    window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
  };
  const money = (p) => ((p.currency || 'SRD').toUpperCase() === 'EUR'
    ? `€${Number(p.amount).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `${p.currency} ${Number(p.amount).toLocaleString('nl-NL')}`);

  return (
    <div className="fixed inset-0 z-[200] flex bg-[#F4F6FA] overflow-hidden" data-testid="register-desktop">
      <SidePanel t={t} />
      <main className="relative flex-1 min-w-0 overflow-y-auto">
        <div className="absolute -bottom-24 -right-24 w-72 h-72 bg-gradient-to-tr from-[#FF5C00] to-[#FFB37A] rounded-full opacity-80 blur-sm pointer-events-none" />
        <div className="relative max-w-[1160px] mx-auto px-8 xl:px-12 py-7 min-h-full flex flex-col">
          <div className="flex items-center justify-between">
            <button type="button" onClick={w.prev} data-testid="register-back"
              className="h-12 px-5 rounded-2xl bg-white shadow-[0_6px_18px_-10px_rgba(11,27,63,0.35)] flex items-center gap-2.5 text-sm font-bold" style={{ color: NAVY }}>
              <ArrowLeft className="w-4 h-4" />{w.step === 0 ? t.close : t.prev}
            </button>
            <div className="flex items-center gap-3 select-none">
              <span className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#FF8A3D] to-[#FF5C00] p-2.5 shadow-[0_10px_22px_-10px_rgba(255,92,0,0.9)]"><img src="/kiosk-icons/mark-white.png" alt="" className="w-full h-full" /></span>
              <span className="text-[40px] font-black tracking-tight" style={{ color: NAVY }}>Suri<span className="text-[#FF5C00]">Rent</span></span>
            </div>
            <div className="flex items-center gap-3">
              <LangSwitch lang={lang} setLang={setLang} />
              <button type="button" onClick={onClose} data-testid="register-close" aria-label={t.close}
                className="w-12 h-12 rounded-full bg-white shadow-[0_6px_18px_-10px_rgba(11,27,63,0.35)] flex items-center justify-center" style={{ color: NAVY }}><X className="w-5 h-5" /></button>
            </div>
          </div>

          {w.success ? (
            <div className="mt-6 rounded-3xl bg-white shadow-[0_30px_70px_-35px_rgba(11,27,63,0.35)] px-12 py-16 text-center" data-testid="register-success">
              <div className="w-20 h-20 rounded-full bg-emerald-50 mx-auto flex items-center justify-center"><Check className="w-11 h-11 text-emerald-500" strokeWidth={3} /></div>
              <h2 className="mt-5 text-4xl font-black" style={{ color: NAVY }}>{t.successT}</h2>
              <p className="mt-2 text-lg font-bold text-[#FF5C00]">{w.companyName}</p>
              <p className="mt-2 text-slate-500 max-w-md mx-auto">{t.successS}</p>
              <button type="button" onClick={w.goToPortal} data-testid="register-success-continue"
                className="mt-8 h-14 px-10 rounded-2xl bg-gradient-to-r from-[#FF8A3D] to-[#FF5C00] text-white text-base font-black inline-flex items-center gap-2.5 shadow-[0_14px_28px_-12px_rgba(255,92,0,0.9)]">
                {t.toDash}<ArrowRight className="w-5 h-5" /></button>
            </div>
          ) : (
            <div className="mt-6 rounded-3xl bg-white shadow-[0_30px_70px_-35px_rgba(11,27,63,0.35)] px-10 xl:px-14 pt-9 pb-10" data-testid="register-card">
              <Stepper step={w.step} labels={t.steps} />
              <div className="mt-10 flex items-start gap-5">
                <span className="w-[72px] h-[72px] rounded-full bg-gradient-to-br from-orange-50 to-orange-100 flex items-center justify-center shrink-0 shadow-[0_10px_24px_-14px_rgba(255,92,0,0.7)]">
                  <StepIcon className="w-8 h-8 text-[#FF5C00]" />
                </span>
                <div className="min-w-0">
                  <span className="inline-block px-2.5 py-1 rounded-md bg-orange-50 text-[13px] font-bold text-[#FF5C00]" data-testid="register-step-label">{t.stepOf(w.step + 1, 4)}</span>
                  <h1 className="mt-1.5 text-[34px] font-black tracking-tight leading-tight" style={{ color: NAVY }} data-testid="register-title">{t.titles[w.step]}</h1>
                  <p className="mt-1 text-[16px] text-slate-500">{t.subs[w.step]}</p>
                </div>
                {w.chosenPlanName && w.step !== 3 && (
                  <span className="ml-auto shrink-0 px-3 py-1.5 rounded-full bg-orange-50 text-[11px] font-black tracking-[0.14em] uppercase text-[#FF5C00]" data-testid="chosen-plan-badge">
                    {t.chosen}: {w.chosenPlanName}
                  </span>
                )}
              </div>

              {w.error && <div className="mt-6 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-bold" data-testid="register-error">{w.error}</div>}

              <div className="mt-7 space-y-6">
                {w.step === 0 && (
                  <>
                    <button type="button" onClick={google} data-testid="register-google-btn"
                      className="w-full h-16 rounded-2xl border border-slate-200 bg-slate-50/60 hover:border-[#FF5C00] flex items-center justify-center gap-3.5 text-[16px] font-bold transition-colors" style={{ color: NAVY }}>
                      <svg width="24" height="24" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" /><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" /><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" /><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" /></svg>
                      {t.google}<ArrowRight className="w-5 h-5" />
                    </button>
                    <div className="flex items-center gap-4"><span className="flex-1 h-px bg-slate-200" /><span className="text-[13px] font-semibold text-slate-500">{t.or}</span><span className="flex-1 h-px bg-slate-200" /></div>
                    <div className="grid grid-cols-2 gap-8">
                      <Field icon={Building2} label={t.company} required hint={t.companyHint}>
                        <IconInput icon={Building2} value={w.companyName} onChange={(e) => w.setCompanyName(e.target.value)} placeholder={t.companyPh} data-testid="register-company" autoFocus />
                        {w.portalPreview.slug && (
                          <div className={`mt-2.5 flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold ${w.slugStatus === 'taken' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`} data-testid="register-slug-preview">
                            <Globe className="w-3.5 h-3.5 shrink-0" />
                            <span className="font-mono truncate flex-1">{w.portalPreview.host || 'app.surirent.sr'}/{w.portalPreview.slug}</span>
                            {w.slugStatus === 'checking' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                            {w.slugStatus === 'available' && <span>✓ {t.free}</span>}
                            {w.slugStatus === 'taken' && <span>✗ {t.taken}</span>}
                          </div>
                        )}
                      </Field>
                      <Field icon={MapPin} label={t.address} optional={t.optional} hint={t.addressHint}>
                        <IconInput icon={MapPin} value={w.address} onChange={(e) => w.setAddress(e.target.value)} placeholder={t.addressPh} data-testid="register-address" />
                      </Field>
                    </div>
                  </>
                )}
                {w.step === 1 && (
                  <div className="grid grid-cols-2 gap-8">
                    <Field icon={User} label={t.name} required hint={t.nameHint}>
                      <IconInput icon={User} value={w.name} onChange={(e) => w.setName(e.target.value)} placeholder={t.namePh} data-testid="register-name" autoFocus />
                    </Field>
                    <Field icon={Phone} label={t.phone} optional={t.optional} hint={t.phoneHint}>
                      <IconInput icon={Phone} type="tel" value={w.telefoon} onChange={(e) => w.setTelefoon(e.target.value)} placeholder={t.phonePh} data-testid="register-phone" />
                    </Field>
                  </div>
                )}
                {w.step === 2 && (
                  <div className="grid grid-cols-2 gap-8">
                    <Field icon={Mail} label={t.email} required hint={t.emailHint}>
                      <IconInput icon={Mail} type="email" autoComplete="email" value={w.email} onChange={(e) => w.setEmail(e.target.value)} placeholder={t.emailPh} data-testid="register-email" autoFocus />
                    </Field>
                    <Field icon={Lock} label={t.password} required>
                      <IconInput icon={Lock} type={w.showPw ? 'text' : 'password'} autoComplete="new-password" minLength={6} value={w.password}
                        onChange={(e) => w.setPassword(e.target.value)} placeholder={t.passwordPh} data-testid="register-password"
                        right={<button type="button" onClick={() => w.setShowPw((s) => !s)} data-testid="register-password-toggle" className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">{w.showPw ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}</button>} />
                      <div className="mt-2.5"><PasswordStrength password={w.password} /></div>
                    </Field>
                  </div>
                )}
                {w.step === 3 && (
                  <div className="grid grid-cols-[260px,1fr] gap-8">
                    <Field icon={Globe} label={t.country} required>
                      <div className="space-y-2.5">
                        {[['SR', 'SRD'], ['NL', 'EUR']].map(([c, cur]) => (
                          <button key={c} type="button" onClick={() => w.setCountry(c)} data-testid={`register-country-${c.toLowerCase()}`}
                            className={`w-full h-14 px-4 rounded-xl border-2 flex items-center justify-between text-left transition-colors ${w.country === c ? 'border-[#FF5C00] bg-orange-50' : 'border-slate-200 hover:border-orange-300'}`}>
                            <span className="font-bold" style={{ color: NAVY }}>{t.countries[c]}</span><span className="text-xs font-bold text-slate-400">{cur}</span>
                          </button>
                        ))}
                      </div>
                    </Field>
                    <Field icon={Package} label={t.plan} required>
                      {w.plans.length === 0 ? <div className="h-28 flex items-center justify-center"><Loader2 className="w-6 h-6 text-[#FF5C00] animate-spin" /></div> : (
                        <div className="grid grid-cols-2 gap-2.5">
                          {w.plans.map((p) => {
                            const sel = w.plan === p.id;
                            return (
                              <button key={p.id} type="button" onClick={() => w.setPlan(p.id)} data-testid={`register-plan-${p.id}`}
                                className={`text-left rounded-xl border-2 px-4 py-3 transition-colors ${sel ? 'border-[#FF5C00] bg-orange-50' : 'border-slate-200 hover:border-orange-300'}`}>
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-black" style={{ color: NAVY }}>{p.name}</span>
                                  {sel && <Check className="w-4 h-4 text-[#FF5C00]" strokeWidth={3} />}
                                </div>
                                <div className="mt-0.5 text-xs text-slate-500 truncate">{p.description}</div>
                                <div className="mt-1.5 text-lg font-black text-[#FF5C00]">{money(p)}<span className="text-xs font-semibold text-slate-400 ml-1">{t.perMonth}</span></div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </Field>
                  </div>
                )}
              </div>

              <div className="mt-10 flex items-center justify-between gap-4">
                <button type="button" onClick={w.prev} data-testid="register-prev"
                  className="h-14 w-48 rounded-2xl border border-slate-200 bg-white hover:border-[#FF5C00] flex items-center justify-center gap-3 text-[16px] font-bold transition-colors" style={{ color: NAVY }}>
                  <ArrowLeft className="w-5 h-5" />{w.step === 0 ? t.close : t.prev}
                </button>
                <button type="button" onClick={w.next} disabled={!w.stepValid || w.loading} data-testid="register-next"
                  className="h-14 w-[440px] max-w-[55%] rounded-2xl bg-gradient-to-r from-[#FF8A3D] to-[#FF5C00] text-white text-[16px] font-black flex items-center justify-center gap-3 shadow-[0_14px_28px_-12px_rgba(255,92,0,0.9)] disabled:opacity-50 transition-opacity">
                  {w.loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <>{w.step < 3 ? t.next : t.create}<ArrowRight className="w-5 h-5" /></>}
                </button>
              </div>
            </div>
          )}

          <div className="mt-8 grid grid-cols-3 max-w-[920px] mx-auto w-full" data-testid="register-trust">
            {t.trust.map(([a, b], i) => {
              const I = [ShieldCheck, Cloud, Headphones][i];
              return (
                <div key={a} className={`flex items-center gap-4 px-6 ${i ? 'border-l border-slate-300' : ''}`}>
                  <I className="w-10 h-10 shrink-0" style={{ color: NAVY }} strokeWidth={1.7} />
                  <div><div className="text-[13px] font-bold" style={{ color: NAVY }}>{a}</div><div className="text-[12px] text-slate-500">{b}</div></div>
                </div>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
}
