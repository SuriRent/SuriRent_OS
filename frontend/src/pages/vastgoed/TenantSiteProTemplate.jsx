// Professioneel "Prestige" template voor de tenant-marketingwebsite.
// Alle teksten/afbeeldingen zijn bewerkbaar via <EditableText>/<EditableImage>.
// Gedeelde onderdelen (Over ons, Type-kiezer, Contact, Footer) komen via `shared`
// uit TenantPublicLanding om circulaire imports te vermijden.

import { useEffect, useState } from 'react';
import {
  Phone, ArrowRight, Building2, MapPin, Search, Star, ShieldCheck, Clock, Key,
  Headphones, Home, ChevronRight, Menu, X, Quote,
} from 'lucide-react';
import { EditableText, EditableImage } from '../../lib/landing-editable';

const fmtMoney = (n, c = 'SRD') => {
  try { return `${c} ${new Intl.NumberFormat('nl-NL').format(Math.round(Number(n) || 0))}`; } catch { return `${c} ${n}`; }
};
const colorOf = (company) => company?.branding?.primary_color || '#FF5C00';

function ProHeader({ company }) {
  const primary = colorOf(company);
  const logo = company?.branding?.logo_url || '';
  const [solid, setSolid] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setSolid(window.scrollY > 24);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  const links = [['#aanbod', 'Aanbod'], ['#types', 'Types'], ['#over', 'Over ons'], ['#contact', 'Contact']];
  const loginHref = company?.login_url || `/${company?.slug || ''}/login`;
  return (
    <header className={`fixed top-0 inset-x-0 z-40 transition-all duration-300 ${
      solid || open ? 'bg-white/95 backdrop-blur shadow-sm text-slate-900' : 'bg-transparent text-white'}`}>
      <div className="max-w-[1280px] mx-auto px-5 lg:px-10 h-20 flex items-center justify-between">
        <a href="#top" className="flex items-center gap-3" data-testid="tenant-landing-logo">
          {logo ? (
            <EditableImage path="logo_url" fallback={logo} alt={company?.name} className="w-10 h-10 rounded-xl object-cover" />
          ) : (
            <span className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: primary }}>
              <Building2 className="w-5 h-5 text-white" />
            </span>
          )}
          <EditableText path="brand_name" fallback={company?.name || 'Vastgoed'} as="span"
            className="text-lg md:text-xl font-extrabold tracking-tight" />
        </a>
        <nav className="hidden md:flex items-center gap-8">
          {links.map(([h, l]) => (
            <a key={h} href={h} className="text-sm font-semibold opacity-90 hover:opacity-100">{l}</a>
          ))}
        </nav>
        <div className="hidden md:flex items-center gap-3">
          <a href={loginHref} data-testid="tenant-landing-login"
            className={`h-11 px-5 rounded-full text-sm font-bold border flex items-center ${
              solid ? 'border-slate-300 text-slate-800 hover:bg-slate-50' : 'border-white/50 text-white hover:bg-white/10'}`}>
            Inloggen
          </a>
          <a href="#contact" className="h-11 px-5 rounded-full text-white text-sm font-bold flex items-center gap-2 shadow-lg"
            style={{ backgroundColor: primary }}>
            <Phone className="w-4 h-4" /> <EditableText path="header_cta" fallback="Neem contact op" as="span" />
          </a>
        </div>
        <button type="button" className="md:hidden w-11 h-11 flex items-center justify-center" onClick={() => setOpen(!open)} aria-label="Menu">
          {open ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>
      {open && (
        <div className="md:hidden bg-white text-slate-900 border-t border-slate-100 px-5 py-4 space-y-1">
          {links.map(([h, l]) => (
            <a key={h} href={h} onClick={() => setOpen(false)} className="block py-3 font-bold">{l}</a>
          ))}
          <a href={loginHref} className="block py-3 font-bold" style={{ color: primary }}>Inloggen</a>
        </div>
      )}
    </header>
  );
}

function ProHero({ company, filter, setFilter }) {
  const primary = colorOf(company);
  const tabs = [['all', 'Alle'], ['free', 'Beschikbaar'], ['occupied', 'Bezet']];
  return (
    <section id="top" className="relative min-h-[92vh] flex items-center text-white" data-testid="tenant-hero">
      <div className="absolute inset-0 bg-slate-900">
        <EditableImage path="hero.bg_url" fallback="https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=2000&q=80"
          alt="" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-r from-slate-950/85 via-slate-950/55 to-slate-950/20 pointer-events-none" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-slate-950/60 to-transparent pointer-events-none" />
      </div>
      <div className="relative w-full max-w-[1280px] mx-auto px-5 lg:px-10 pt-32 pb-52">
        <EditableText path="hero.eyebrow" fallback="Premium verhuur in Suriname" as="p"
          className="inline-flex items-center gap-2 text-xs font-bold tracking-[0.25em] uppercase px-4 py-2 rounded-full bg-white/10 backdrop-blur border border-white/20 mb-7" />
        <h1 className="font-extrabold tracking-tight leading-[1.03] max-w-3xl" style={{ fontSize: 'clamp(2.5rem, 6vw, 5rem)' }}>
          <EditableText path="hero.title_line1" fallback={`Welkom bij ${company?.name || ''}`} as="span" />
          <br />
          <EditableText path="hero.title_line2" fallback="uw nieuwe thuis wacht." as="span" style={{ color: primary }} />
        </h1>
        <EditableText path="hero.subtitle"
          fallback="Moderne, comfortabele appartementen voor lange en korte huur. Direct beschikbaar, transparante prijzen en persoonlijke service."
          as="p" multiline className="mt-6 text-base lg:text-xl text-white/80 max-w-xl leading-relaxed" />
        <div className="mt-9 flex flex-wrap gap-3">
          <a href="#aanbod" className="h-14 px-8 rounded-full text-white font-bold flex items-center gap-2 shadow-2xl"
            style={{ backgroundColor: primary }}>
            <EditableText path="hero.cta_primary" fallback="Bekijk het aanbod" as="span" /> <ArrowRight className="w-4 h-4" />
          </a>
          <a href="#contact" className="h-14 px-8 rounded-full font-bold flex items-center border border-white/40 hover:bg-white/10">
            <EditableText path="hero.cta_secondary" fallback="Plan een bezichtiging" as="span" />
          </a>
        </div>
      </div>

      <div className="absolute left-0 right-0 bottom-0 translate-y-1/2 px-5 lg:px-10 z-20" data-testid="tenant-search">
        <div className="max-w-[1100px] mx-auto bg-white text-slate-900 rounded-3xl shadow-2xl p-4 lg:p-5">
          <div className="flex gap-1 mb-3">
            {tabs.map(([k, label]) => (
              <button key={k} type="button" onClick={() => setFilter((f) => ({ ...f, status: k }))}
                className="px-4 h-9 rounded-full text-sm font-bold transition"
                style={filter.status === k ? { backgroundColor: primary, color: '#fff' } : { color: '#64748B' }}>
                {label}
              </button>
            ))}
          </div>
          <div className="grid md:grid-cols-[1.3fr_1fr_auto] gap-3">
            <label className="bg-slate-50 rounded-2xl px-4 py-2.5 flex items-center gap-3">
              <Search className="w-5 h-5 text-slate-400 shrink-0" />
              <span className="block w-full">
                <span className="block text-[11px] font-bold text-slate-500">Zoeken</span>
                <input value={filter.q} onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))}
                  placeholder="Eenheid, adres of type" className="w-full text-sm font-semibold outline-none bg-transparent" />
              </span>
            </label>
            <label className="bg-slate-50 rounded-2xl px-4 py-2.5 block">
              <span className="block text-[11px] font-bold text-slate-500">Maximale prijs per maand</span>
              <input type="number" min="0" value={filter.max} onChange={(e) => setFilter((f) => ({ ...f, max: e.target.value }))}
                placeholder="Geen limiet" className="w-full text-sm font-semibold outline-none bg-transparent" />
            </label>
            <a href="#aanbod" className="h-16 px-8 rounded-2xl text-white font-bold flex items-center justify-center gap-2"
              style={{ backgroundColor: primary }}>
              <Search className="w-4 h-4" /> Zoeken
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

function ProStats({ company, apartments }) {
  const primary = colorOf(company);
  const free = apartments.filter((a) => a.status !== 'occupied').length;
  const stats = [
    { value: free, label: 'Beschikbaar' },
    { value: apartments.length - free, label: 'Verhuurd' },
    { value: '24/7', label: 'Bereikbaar' },
    { value: '100%', label: 'Persoonlijk' },
  ];
  return (
    <section className="bg-white pt-48 md:pt-40 lg:pt-36 pb-6">
      <div className="max-w-[1100px] mx-auto px-5 lg:px-10 grid grid-cols-2 lg:grid-cols-4 gap-6 text-center">
        {stats.map((s) => (
          <div key={s.label}>
            <p className="text-4xl lg:text-5xl font-extrabold tracking-tight" style={{ color: primary }}>{s.value}</p>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mt-2">{s.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

const WHY = [
  { icon: ShieldCheck, title: 'Betrouwbaar & transparant', text: 'Heldere prijzen, duidelijke contracten en geen verborgen kosten.' },
  { icon: Clock, title: 'Snel geregeld', text: 'Direct beschikbare woningen en een korte reactietijd op al uw vragen.' },
  { icon: Key, title: 'Zorgeloos wonen', text: 'Goed onderhouden eenheden, met service wanneer u het nodig heeft.' },
  { icon: Headphones, title: 'Persoonlijke service', text: 'Wij denken met u mee, van eerste bezichtiging tot sleuteloverdracht.' },
];

function ProWhy({ company }) {
  const primary = colorOf(company);
  return (
    <section className="bg-white py-16 lg:py-24">
      <div className="max-w-[1280px] mx-auto px-5 lg:px-10">
        <div className="max-w-2xl mb-12">
          <EditableText path="why.eyebrow" fallback="Waarom wij" as="p" className="text-xs font-black tracking-[0.3em] uppercase mb-3" style={{ color: primary }} />
          <EditableText path="why.title" fallback="Verhuur zoals het hoort te zijn." as="h2"
            className="text-3xl lg:text-5xl font-extrabold tracking-tight text-slate-900 leading-tight" />
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {WHY.map((w, i) => {
            const I = w.icon;
            return (
              <div key={w.title} className="rounded-3xl border border-slate-100 bg-slate-50/60 p-7 hover:bg-white hover:shadow-xl transition">
                <span className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5 text-white" style={{ backgroundColor: primary }}>
                  <I className="w-6 h-6" />
                </span>
                <EditableText path={`why.i${i}.title`} fallback={w.title} as="h3" className="text-lg font-extrabold text-slate-900" />
                <EditableText path={`why.i${i}.text`} fallback={w.text} as="p" multiline className="mt-2 text-sm text-slate-600 leading-relaxed" />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function ProListing({ company, apartments: all, filter }) {
  const primary = colorOf(company);
  const q = (filter?.q || '').trim().toLowerCase();
  const max = Number(filter?.max) || 0;
  const list = all.filter((a) => {
    if (filter?.status === 'free' && a.status === 'occupied') return false;
    if (filter?.status === 'occupied' && a.status !== 'occupied') return false;
    if (max && Number(a.rent_amount) > max) return false;
    if (q && !`${a.number || ''} ${a.address || ''} ${a.description || ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const pick = (apt) => {
    document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' });
    try { window.dispatchEvent(new CustomEvent('tenant-landing-select-apt', { detail: apt })); } catch { /* noop */ }
  };
  return (
    <section id="aanbod" className="bg-slate-50 py-16 lg:py-24">
      <div className="max-w-[1280px] mx-auto px-5 lg:px-10">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-12">
          <div className="max-w-2xl">
            <EditableText path="aanbod.eyebrow" fallback="Ons aanbod" as="p" className="text-xs font-black tracking-[0.3em] uppercase mb-3" style={{ color: primary }} />
            <EditableText path="aanbod.title" fallback="Uitgelichte woningen" as="h2"
              className="text-3xl lg:text-5xl font-extrabold tracking-tight text-slate-900 leading-tight" />
            <EditableText path="aanbod.subtitle" fallback="Alle eenheden zijn klaar voor bewoning. Zie direct wat beschikbaar is." as="p" multiline
              className="mt-4 text-base lg:text-lg text-slate-600" />
          </div>
          <p className="text-sm font-bold text-slate-500">{list.length} resultaten</p>
        </div>
        {list.length === 0 ? (
          <div className="bg-white rounded-3xl border-2 border-dashed border-slate-200 p-16 text-center">
            <Home className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="font-extrabold text-slate-700 text-lg">Geen woningen gevonden</p>
            <p className="text-sm text-slate-500 mt-2">Pas uw zoekopdracht aan of neem contact op voor de wachtlijst.</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
            {list.map((apt) => {
              const occ = apt.status === 'occupied';
              return (
                <article key={apt.id} data-testid={`apt-card-${apt.id}`}
                  className="group bg-white rounded-3xl overflow-hidden shadow-sm hover:shadow-2xl hover:-translate-y-1.5 transition-all duration-300">
                  <div className="relative aspect-[4/3] bg-slate-100 overflow-hidden">
                    {apt.photo_url ? (
                      <img loading="lazy" src={apt.photo_url} alt={apt.number}
                        className={`w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ${occ ? 'grayscale-[40%]' : ''}`} />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center"><Home className="w-16 h-16 text-slate-300" /></div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 to-transparent" />
                    <span className="absolute top-4 left-4 px-3.5 py-1.5 rounded-full text-[11px] font-extrabold uppercase tracking-wider text-white backdrop-blur"
                      style={{ backgroundColor: occ ? 'rgba(71,85,105,.9)' : primary }}>
                      {occ ? 'Verhuurd' : 'Beschikbaar'}
                    </span>
                    <div className="absolute left-4 bottom-4 text-white">
                      <p className="text-2xl font-extrabold leading-none">{fmtMoney(apt.rent_amount, apt.currency)}</p>
                      <p className="text-xs font-semibold text-white/80 mt-1">per maand</p>
                    </div>
                  </div>
                  <div className="p-6">
                    <h3 className="text-xl font-extrabold text-slate-900">Eenheid {apt.number}</h3>
                    {apt.address && (
                      <p className="text-sm text-slate-500 flex items-center gap-1.5 mt-1.5"><MapPin className="w-4 h-4" /> {apt.address}</p>
                    )}
                    {apt.description && <p className="text-sm text-slate-600 mt-3 line-clamp-2">{apt.description}</p>}
                    <button type="button" onClick={() => pick(apt)} disabled={occ}
                      className="mt-5 w-full h-12 rounded-full font-bold text-sm flex items-center justify-center gap-1.5 border-2 transition disabled:opacity-40"
                      style={{ borderColor: primary, color: primary }}>
                      {occ ? 'Momenteel verhuurd' : 'Interesse? Neem contact op'} {!occ && <ChevronRight className="w-4 h-4" />}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

const REVIEWS = [
  { text: 'Snelle en duidelijke communicatie. Binnen een week zat ik in mijn nieuwe appartement.', name: 'Anita R.', role: 'Huurder' },
  { text: 'Altijd bereikbaar en problemen worden direct opgelost. Echt een aanrader.', name: 'Kevin S.', role: 'Huurder' },
  { text: 'Eerlijke prijzen en een net onderhouden complex. Precies wat ik zocht.', name: 'Meryll D.', role: 'Huurder' },
];

function ProReviews({ company }) {
  const primary = colorOf(company);
  return (
    <section className="bg-white py-16 lg:py-24">
      <div className="max-w-[1280px] mx-auto px-5 lg:px-10">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <EditableText path="reviews.eyebrow" fallback="Ervaringen" as="p" className="text-xs font-black tracking-[0.3em] uppercase mb-3" style={{ color: primary }} />
          <EditableText path="reviews.title" fallback="Wat onze huurders zeggen" as="h2"
            className="text-3xl lg:text-5xl font-extrabold tracking-tight text-slate-900 leading-tight" />
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {REVIEWS.map((r, i) => (
            <figure key={r.name} className="rounded-3xl bg-slate-50 p-8 relative">
              <Quote className="w-10 h-10 absolute top-6 right-6 opacity-10" style={{ color: primary }} />
              <div className="flex gap-0.5 mb-4" style={{ color: primary }}>
                {[0, 1, 2, 3, 4].map((s) => <Star key={s} className="w-4 h-4 fill-current" />)}
              </div>
              <EditableText path={`reviews.i${i}.text`} fallback={r.text} as="blockquote" multiline className="text-slate-700 leading-relaxed" />
              <figcaption className="mt-6 flex items-center gap-3">
                <span className="w-11 h-11 rounded-full text-white font-extrabold flex items-center justify-center" style={{ backgroundColor: primary }}>
                  {r.name.charAt(0)}
                </span>
                <span>
                  <EditableText path={`reviews.i${i}.name`} fallback={r.name} as="span" className="block text-sm font-extrabold text-slate-900" />
                  <EditableText path={`reviews.i${i}.role`} fallback={r.role} as="span" className="block text-xs text-slate-500" />
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

function ProCta({ company }) {
  const primary = colorOf(company);
  return (
    <section className="bg-white pb-16 lg:pb-24">
      <div className="max-w-[1280px] mx-auto px-5 lg:px-10">
        <div className="relative rounded-[2rem] overflow-hidden text-white">
          <div className="absolute inset-0 bg-slate-900">
            <EditableImage path="cta.bg_url" fallback="https://images.unsplash.com/photo-1560185007-cde436f6a4d0?w=1800&q=80"
              alt="" className="w-full h-full object-cover opacity-50" />
            <div className="absolute inset-0 pointer-events-none" style={{ background: `linear-gradient(90deg, ${primary}E6, ${primary}40)` }} />
          </div>
          <div className="relative px-8 lg:px-16 py-14 lg:py-20 max-w-2xl">
            <EditableText path="cta.title" fallback="Klaar om te verhuizen?" as="h2" className="text-3xl lg:text-5xl font-extrabold tracking-tight leading-tight" />
            <EditableText path="cta.text" fallback="Laat uw gegevens achter en wij nemen binnen 24 uur contact met u op voor een vrijblijvende bezichtiging."
              as="p" multiline className="mt-4 text-white/90 text-lg" />
            <a href="#contact" className="mt-8 inline-flex h-14 px-8 rounded-full bg-white font-bold items-center gap-2 shadow-xl" style={{ color: primary }}>
              <EditableText path="cta.button" fallback="Plan een bezichtiging" as="span" /> <ArrowRight className="w-4 h-4" />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function ProPage({ company, apartments, filter, setFilter, shared }) {
  const { About, TypesSection, ContactSection, TenantFooter } = shared;
  return (
    <div className="min-h-screen bg-white font-sans antialiased">
      <ProHeader company={company} />
      <ProHero company={company} filter={filter} setFilter={setFilter} />
      <ProStats company={company} apartments={apartments} />
      <ProWhy company={company} />
      <TypesSection company={company} apartments={apartments} setFilter={setFilter} />
      <ProListing company={company} apartments={apartments} filter={filter} />
      <About company={company} />
      <ProReviews company={company} />
      <ProCta company={company} />
      <ContactSection company={company} />
      <TenantFooter company={company} />
    </div>
  );
}
