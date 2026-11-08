// "Villa" template: 1-op-1 nagebouwd naar de referentiesite (Kewal Bansing Vastgoed):
// glas-navbar, fullscreen hero, marquee, woningen met sticky filterbalk,
// donkere "Onze belofte" en footer. Teksten/afbeeldingen zijn bewerkbaar.
// `shared` wordt niet meer gebruikt maar blijft in de signatuur voor compatibiliteit.

import { useEffect, useState } from 'react';
import {
  ArrowDown, ArrowUpRight, Asterisk, BadgeCheck, HandHeart, Home, KeyRound, MapPin,
  Phone, RotateCcw, Search, ShieldCheck, X, CheckCircle2, Loader2,
} from 'lucide-react';
import { EditableText, EditableImage, useEditable } from '../../lib/landing-editable';

const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Plus+Jakarta+Sans:wght@500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap';
const BODY = { fontFamily: "'Outfit', system-ui, sans-serif" };
const DISPLAY = { fontFamily: "'Plus Jakarta Sans', 'Outfit', system-ui, sans-serif" };
const MONO = { fontFamily: "'JetBrains Mono', ui-monospace, monospace" };
const ORANGE = '#FF5C00';

const fmtMoney = (n, c = 'SRD') => {
  try { return `${c} ${new Intl.NumberFormat('nl-NL').format(Math.round(Number(n) || 0))}`; } catch { return `${c} ${n}`; }
};

function Navbar({ company }) {
  const { editMode } = useEditable();
  const [solid, setSolid] = useState(false);
  useEffect(() => {
    const on = () => setSolid(window.scrollY > 40);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  const logo = company?.branding?.logo_url || '';
  const loginHref = company?.login_url || `/${company?.slug || ''}/login`;
  const initials = (company?.name || 'V').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const go = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  return (
    <header className={`fixed ${editMode ? 'top-8' : 'top-0'} inset-x-0 z-50 backdrop-blur-xl transition-colors duration-300 ${
      solid ? 'bg-white/85 border-b border-stone-200/80' : 'bg-[#0F1115]/30 border-b border-white/10'}`}>
      <div className="max-w-7xl mx-auto px-5 sm:px-8 h-[72px] flex items-center justify-between">
        <a className="flex items-center gap-3 group" href="#top" data-testid="tenant-landing-logo">
          {logo ? (
            <EditableImage path="logo_url" fallback={logo} alt={company?.name} className="w-10 h-10 rounded-xl object-cover" />
          ) : (
            <span className="w-10 h-10 rounded-xl bg-[#FF5C00] flex items-center justify-center font-extrabold text-white text-sm tracking-tight transition-transform duration-300 group-hover:rotate-6" style={DISPLAY}>
              {initials}
            </span>
          )}
          <span className="leading-tight">
            <EditableText path="brand_name" fallback={company?.name || 'Vastgoed'} as="span"
              className={`block font-bold text-[15px] tracking-tight ${solid ? 'text-[#121519]' : 'text-white'}`} style={DISPLAY} />
            <EditableText path="brand_tagline" fallback="Vastgoed" as="span"
              className="block text-[10px] font-semibold uppercase tracking-[0.28em] text-[#FF5C00]" />
          </span>
        </a>
        <nav className="flex items-center gap-6">
          <button type="button" onClick={() => go('woningen')}
            className={`hidden sm:block text-sm font-medium transition-colors duration-200 hover:text-[#FF5C00] ${solid ? 'text-[#525866]' : 'text-white/80'}`}>
            Woningen
          </button>
          <a href={loginHref} data-testid="tenant-landing-login"
            className={`text-sm font-semibold px-5 py-2.5 rounded-full border transition-all duration-150 active:scale-95 hover:border-[#FF5C00] hover:text-[#FF5C00] ${
              solid ? 'border-stone-300 text-[#121519]' : 'border-white/30 text-white'}`}>
            Inloggen
          </a>
          <button type="button" onClick={() => go('woningen')}
            className="text-sm font-semibold px-5 py-2.5 rounded-full bg-[#FF5C00] text-white hover:bg-[#E05200] active:scale-95 transition-all duration-150">
            <EditableText path="header_cta" fallback="Bekijk aanbod" as="span" />
          </button>
        </nav>
      </div>
    </header>
  );
}

function Hero({ company, free }) {
  const loginHref = company?.login_url || `/${company?.slug || ''}/login`;
  return (
    <section id="top" className="relative min-h-[100svh] flex items-end overflow-hidden bg-[#0F1115]" data-testid="tenant-hero">
      <div className="absolute inset-0">
        <EditableImage path="hero.bg_url" fallback="https://images.unsplash.com/photo-1721815693498-cc28507c0ba2?w=2200&q=85"
          alt="" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0F1115] via-[#0F1115]/60 to-[#0F1115]/30 pointer-events-none" />
      </div>
      <div className="relative z-10 max-w-7xl mx-auto px-5 sm:px-8 pb-24 pt-40 w-full">
        <div className="flex flex-wrap items-center gap-3 mb-8">
          <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-white/20 bg-white/10 backdrop-blur-md text-white/90 text-xs font-semibold uppercase tracking-widest">
            <ShieldCheck className="w-3.5 h-3.5 text-[#FF5C00]" />
            <EditableText path="hero.eyebrow" fallback="Aangedreven door SuriRent N.V." as="span" />
          </span>
          <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-white/20 bg-white/10 backdrop-blur-md text-white/90 text-xs font-semibold uppercase tracking-widest">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> Live · SuriRent API
          </span>
        </div>
        <h1 className="font-extrabold tracking-tight leading-[1.06] text-4xl sm:text-5xl lg:text-6xl text-white max-w-4xl" style={DISPLAY}>
          <EditableText path="hero.title_line1" fallback="Exclusieve woningen te" as="span" />{' '}
          <EditableText path="hero.title_accent" fallback="huur" as="span" style={{ color: ORANGE }} />{' '}
          <EditableText path="hero.title_line2" fallback="in Suriname" as="span" />
        </h1>
        <p className="mt-6 text-base sm:text-lg text-white/70 max-w-xl leading-relaxed">
          <EditableText path="hero.subtitle"
            fallback={`${company?.name || 'Wij'} beheert en verhuurt zorgvuldig geselecteerde woningen in Paramaribo en omgeving.`} as="span" />
          {' '}<span className="text-white font-semibold">Momenteel {free} {free === 1 ? 'woning' : 'woningen'} beschikbaar.</span>
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-4">
          <button type="button" onClick={() => document.getElementById('woningen')?.scrollIntoView({ behavior: 'smooth' })}
            className="inline-flex items-center gap-3 px-8 py-4 rounded-full bg-[#FF5C00] text-white font-semibold hover:bg-[#E05200] active:scale-95 transition-all duration-150">
            <EditableText path="hero.cta_primary" fallback="Bekijk het aanbod" as="span" />
            <ArrowDown className="w-4 h-4 animate-bounce" />
          </button>
          <a href={loginHref}
            className="inline-flex items-center gap-2 px-8 py-4 rounded-full border border-white/30 text-white font-semibold hover:border-[#FF5C00] hover:text-[#FF5C00] active:scale-95 transition-all duration-150">
            <EditableText path="hero.cta_secondary" fallback="Huurder? Log in via SuriRent" as="span" />
          </a>
        </div>
      </div>
    </section>
  );
}

function Marquee({ company }) {
  const items = ['Paramaribo', 'Wanica', 'Noord', company?.name || 'Vastgoed', 'Live via de SuriRent API', 'Kwaliteit & vertrouwen', 'Commewijne'];
  const row = (k) => (
    <div key={k} className="flex items-center shrink-0">
      {items.map((t) => (
        <span key={`${k}-${t}`} className="flex items-center">
          <span className="text-sm sm:text-base font-semibold uppercase tracking-[0.3em] text-white/60 px-6" style={DISPLAY}>{t}</span>
          <Asterisk className="w-4 h-4 text-[#FF5C00] shrink-0" />
        </span>
      ))}
    </div>
  );
  return (
    <div className="bg-[#0F1115] border-y border-white/10 py-5 overflow-hidden select-none">
      <div className="flex w-max items-center" style={{ animation: 'villa-marquee 35s linear infinite' }}>
        {row('a')}{row('b')}
      </div>
      <style>{'@keyframes villa-marquee{from{transform:translateX(0)}to{transform:translateX(-50%)}}'}</style>
    </div>
  );
}

function DetailModal({ apt, company, onClose }) {
  const [form, setForm] = useState({ name: '', phone: '', email: '', message: `Ik heb interesse in ${apt.number || 'deze woning'}.` });
  const [state, setState] = useState('idle');
  const phone = company?.contact_phone || '';
  const submit = async (e) => {
    e.preventDefault();
    if (!form.name || !form.phone) return;
    setState('sending');
    try {
      const res = await fetch(`${process.env.REACT_APP_BACKEND_URL || ''}/api/public/landing-lead`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: company?.id, apartment_id: apt.id, ...form }),
      });
      setState(res.ok ? 'sent' : 'error');
    } catch { setState('error'); }
  };
  const input = 'w-full px-4 py-3 rounded-xl bg-[#F8F6F2] border border-transparent focus:border-[#FF5C00] outline-none text-sm text-[#121519]';
  return (
    <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-6" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-3xl rounded-t-3xl sm:rounded-3xl overflow-hidden max-h-[92vh] overflow-y-auto grid sm:grid-cols-2" onClick={(e) => e.stopPropagation()}>
        <div className="relative min-h-[220px] bg-stone-100">
          {apt.photo_url ? <img src={apt.photo_url} alt={apt.number} className="absolute inset-0 w-full h-full object-cover" />
            : <div className="absolute inset-0 flex items-center justify-center"><Home className="w-12 h-12 text-stone-300" /></div>}
        </div>
        <div className="p-6 sm:p-8">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-2xl font-bold text-[#121519]" style={DISPLAY}>{apt.number}</h3>
            <button type="button" onClick={onClose} className="w-9 h-9 rounded-full hover:bg-stone-100 flex items-center justify-center" aria-label="Sluiten"><X className="w-5 h-5" /></button>
          </div>
          {apt.address && <p className="mt-2 flex items-center gap-1.5 text-sm text-[#525866]"><MapPin className="w-4 h-4 text-[#FF5C00]" />{apt.address}</p>}
          <p className="mt-4"><span className="text-2xl font-extrabold text-[#121519]" style={DISPLAY}>{fmtMoney(apt.rent_amount, apt.currency)}</span><span className="block text-xs text-[#8C95A6]">per maand</span></p>
          {apt.description && <p className="mt-4 text-sm text-[#525866] leading-relaxed">{apt.description}</p>}
          {state === 'sent' ? (
            <div className="mt-6 text-center py-6" data-testid="lead-sent">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
              <p className="mt-2 font-bold text-[#121519]">Bedankt! Wij nemen snel contact op.</p>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-6 space-y-3" data-testid="lead-form">
              <input className={input} placeholder="Uw naam *" required value={form.name} data-testid="lead-name" onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <div className="grid grid-cols-2 gap-3">
                <input className={input} placeholder="Telefoon *" type="tel" required value={form.phone} data-testid="lead-phone" onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                <input className={input} placeholder="E-mail" type="email" value={form.email} data-testid="lead-email" onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <textarea className={input} rows={3} value={form.message} data-testid="lead-message" onChange={(e) => setForm({ ...form, message: e.target.value })} />
              {state === 'error' && <p className="text-sm text-red-600">Verzenden mislukt. Probeer het later opnieuw.</p>}
              <button type="submit" disabled={state === 'sending'} data-testid="lead-submit"
                className="w-full px-6 py-3.5 rounded-full bg-[#FF5C00] text-white font-semibold hover:bg-[#E05200] disabled:opacity-50 flex items-center justify-center gap-2">
                {state === 'sending' && <Loader2 className="w-4 h-4 animate-spin" />} Neem contact op
              </button>
              {phone && <a href={`tel:${phone}`} className="flex items-center justify-center gap-2 text-sm font-semibold text-[#FF5C00]"><Phone className="w-4 h-4" />{phone}</a>}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function Listing({ company, apartments, filter, setFilter }) {
  const [sel, setSel] = useState(null);
  const q = (filter?.q || '').trim().toLowerCase();
  const max = Number(filter?.max) || 0;
  const min = Number(filter?.min) || 0;
  const list = apartments.filter((a) => {
    if (a.status === 'occupied') return false;
    if (max && Number(a.rent_amount) > max) return false;
    if (min && Number(a.rent_amount) < min) return false;
    if (q && !`${a.number || ''} ${a.address || ''} ${a.description || ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const num = 'w-24 px-3 py-3 rounded-xl bg-[#F8F6F2] border border-transparent focus:border-[#FF5C00] outline-none text-sm text-[#121519] transition-colors duration-200';
  return (
    <main id="woningen" className="max-w-7xl mx-auto px-5 sm:px-8 py-16 sm:py-24 scroll-mt-20">
      <div className="mb-10">
        <EditableText path="aanbod.eyebrow" fallback="Actueel aanbod" as="p" className="text-xs font-semibold uppercase tracking-[0.3em] text-[#FF5C00] mb-3" />
        <EditableText path="aanbod.title" fallback="Beschikbare woningen" as="h2"
          className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-[#121519]" style={DISPLAY} />
      </div>
      <div className="sticky top-[84px] z-30 backdrop-blur-md bg-white/90 shadow-xl rounded-2xl border border-stone-200/80 p-4" data-testid="tenant-search">
        <div className="flex flex-col lg:flex-row lg:items-center gap-4">
          <label className="flex items-center gap-3 flex-1 px-4 py-3 rounded-xl bg-[#F8F6F2] border border-transparent focus-within:border-[#FF5C00] transition-colors duration-200">
            <Search className="w-4 h-4 text-[#8C95A6] shrink-0" />
            <input placeholder="Zoek op adres of titel..." className="w-full bg-transparent outline-none text-sm text-[#121519] placeholder:text-[#8C95A6]"
              type="text" value={filter.q} onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))} />
          </label>
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold uppercase tracking-widest text-[#8C95A6] whitespace-nowrap">Huurprijs p/m</span>
            <input min="0" placeholder="Min" className={num} type="number" value={filter.min || ''} onChange={(e) => setFilter((f) => ({ ...f, min: e.target.value }))} />
            <span className="text-[#8C95A6]">—</span>
            <input min="0" placeholder="Max" className={num} type="number" value={filter.max || ''} onChange={(e) => setFilter((f) => ({ ...f, max: e.target.value }))} />
            <button type="button" onClick={() => setFilter({ status: 'all', q: '', max: '', min: '' })}
              className="inline-flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold text-[#FF5C00] hover:bg-[#FFF3EC] active:scale-95 transition-all duration-150">
              <RotateCcw className="w-4 h-4" />Reset
            </button>
          </div>
        </div>
        <p className="mt-3 px-1 text-xs text-[#8C95A6]">{list.length} {list.length === 1 ? 'woning' : 'woningen'} gevonden</p>
      </div>

      <div className="mt-10">
        {list.length === 0 ? (
          <div className="bg-white rounded-2xl border border-stone-200/80 p-16 text-center">
            <Home className="w-10 h-10 text-stone-300 mx-auto mb-3" />
            <p className="font-bold text-[#121519]" style={DISPLAY}>0 woningen gevonden</p>
            <p className="text-sm text-[#8C95A6] mt-1">Pas uw filters aan.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
            {list.map((apt) => (
              <article key={apt.id} data-testid={`apt-card-${apt.id}`}
                className="group bg-white rounded-2xl border border-stone-200/80 overflow-hidden hover:border-[#FF5C00] hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
                <button type="button" onClick={() => setSel(apt)} className="block relative aspect-[4/3] overflow-hidden w-full text-left bg-stone-100">
                  {apt.photo_url ? (
                    <img loading="lazy" src={apt.photo_url} alt={apt.number}
                      className="w-full h-full object-cover scale-100 group-hover:scale-105 transition-transform duration-500 ease-out" />
                  ) : (
                    <span className="absolute inset-0 flex items-center justify-center"><Home className="w-12 h-12 text-stone-300" /></span>
                  )}
                  <span className="absolute top-4 left-4 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/90 backdrop-blur-sm text-[11px] font-semibold uppercase tracking-widest text-emerald-600">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />Beschikbaar
                  </span>
                </button>
                <div className="p-6">
                  <h3 className="text-xl font-bold tracking-tight text-[#121519]" style={DISPLAY}>{apt.number}</h3>
                  {apt.address && (
                    <p className="mt-2 flex items-center gap-1.5 text-sm text-[#525866]">
                      <MapPin className="w-4 h-4 text-[#FF5C00] shrink-0" />{apt.address}
                    </p>
                  )}
                  <div className="mt-5 flex items-end justify-between gap-3">
                    <p className="leading-tight">
                      <span className="text-2xl font-extrabold text-[#121519]" style={DISPLAY}>{fmtMoney(apt.rent_amount, apt.currency)}</span>
                      <span className="block text-xs text-[#8C95A6] mt-0.5">per maand</span>
                    </p>
                    <button type="button" onClick={() => setSel(apt)}
                      className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full text-sm font-semibold text-[#FF5C00] border border-[#FF5C00]/40 hover:bg-[#FF5C00] hover:text-white active:scale-95 transition-all duration-150">
                      Bekijk details<ArrowUpRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
      {sel && <DetailModal apt={sel} company={company} onClose={() => setSel(null)} />}
    </main>
  );
}

const PROMISE = [
  { icon: BadgeCheck, title: 'Zorgvuldig geselecteerd', text: 'Elke woning in ons aanbod wordt persoonlijk bezocht en gecontroleerd voordat deze online komt. Wat u ziet, is wat u krijgt.' },
  { icon: HandHeart, title: 'Eerlijke prijzen', text: 'Transparante huurprijzen zonder verborgen kosten. De prijs op de website is de prijs in het contract.' },
  { icon: KeyRound, title: 'Digitaal beheerd via SuriRent', text: 'Contracten, facturen en betalingen lopen volledig digitaal via het SuriRent platform. Snel, veilig en overzichtelijk.' },
];

function Promise() {
  return (
    <section className="bg-[#0F1115] py-20 sm:py-28">
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <EditableText path="promise.eyebrow" fallback="Onze belofte" as="p" className="text-xs font-semibold uppercase tracking-[0.3em] text-[#FF5C00] mb-4" />
        <EditableText path="promise.title" fallback="Huren zonder zorgen, zoals het hoort." as="h2"
          className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-white max-w-2xl mb-16" style={DISPLAY} />
        <div className="grid md:grid-cols-3 gap-10 md:gap-8">
          {PROMISE.map((p, i) => {
            const I = p.icon;
            return (
              <div key={p.title} className="border-t border-white/15 pt-8">
                <div className="flex items-center justify-between mb-6">
                  <span className="text-sm text-[#FF5C00]" style={MONO}>{String(i + 1).padStart(2, '0')}</span>
                  <I className="w-6 h-6 text-white/40" />
                </div>
                <EditableText path={`promise.i${i}.title`} fallback={p.title} as="h3" className="text-xl font-bold text-white mb-3" style={DISPLAY} />
                <EditableText path={`promise.i${i}.text`} fallback={p.text} as="p" multiline className="text-sm text-white/60 leading-relaxed" />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Footer({ company }) {
  const logo = company?.branding?.logo_url || '';
  const initials = (company?.name || 'V').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const loginHref = company?.login_url || `/${company?.slug || ''}/login`;
  const host = typeof window !== 'undefined' ? window.location.hostname.replace(/^www\./, '') : '';
  return (
    <footer className="bg-[#0F1115] border-t border-white/10 py-12" data-testid="tenant-footer">
      <div className="max-w-7xl mx-auto px-5 sm:px-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-8">
        <div className="flex items-center gap-3">
          {logo ? <img src={logo} alt="" className="w-10 h-10 rounded-xl object-cover" />
            : <span className="w-10 h-10 rounded-xl bg-[#FF5C00] flex items-center justify-center font-extrabold text-white text-sm" style={DISPLAY}>{initials}</span>}
          <div>
            <p className="font-bold text-white text-[15px]" style={DISPLAY}>{company?.name}</p>
            <EditableText path="footer.tagline" fallback="Exclusieve woningen te huur in Suriname" as="p" className="text-xs text-white/50" />
          </div>
        </div>
        <div className="text-sm text-white/50 space-y-1 sm:text-right">
          <p>Aangedreven door <span className="text-[#FF5C00] font-semibold">SuriRent N.V.</span></p>
          <a className="inline-block text-white/70 hover:text-[#FF5C00] transition-colors duration-200" href={loginHref}>Huurder login · SuriRent dashboard</a>
          <p>© {new Date().getFullYear()} {company?.name}{host && !/localhost|surirent/.test(host) ? ` · ${host}` : ''}</p>
          <a className="inline-block text-white/70 hover:text-[#FF5C00] transition-colors duration-200" href="#top">Terug naar boven</a>
        </div>
      </div>
    </footer>
  );
}

export default function ProPage({ company, apartments, filter, setFilter }) {
  useEffect(() => {
    if (document.getElementById('villa-fonts')) return;
    const l = document.createElement('link');
    l.id = 'villa-fonts'; l.rel = 'stylesheet'; l.href = FONT_HREF;
    document.head.appendChild(l);
  }, []);
  const free = apartments.filter((a) => a.status !== 'occupied').length;
  return (
    <div className="bg-[#FAF8F5] min-h-screen antialiased" style={BODY}>
      <Navbar company={company} />
      <Hero company={company} free={free} />
      <Marquee company={company} />
      <Listing company={company} apartments={apartments} filter={filter} setFilter={setFilter} />
      <Promise />
      <Footer company={company} />
    </div>
  );
}
