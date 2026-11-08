// "Villa" template voor de tenant-marketingwebsite: donkere cinematische hero,
// zwevende glas-header, locatie-ticker, warme aanbod-sectie met filterbalk en
// een donkere "Onze belofte"-sectie. Alles bewerkbaar via <EditableText>/<EditableImage>.
// Gedeelde onderdelen komen via `shared` uit TenantPublicLanding (geen circulaire import).

import { useEffect } from 'react';
import { ArrowRight, Building2, MapPin, Search, Home, RotateCcw } from 'lucide-react';
import { EditableText, EditableImage } from '../../lib/landing-editable';

const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap';
const BODY = { fontFamily: "'Outfit', system-ui, sans-serif" };
const HEAD = { fontFamily: "'Plus Jakarta Sans', 'Outfit', system-ui, sans-serif" };
const DARK = '#0F1115';
const WARM = '#F8F6F2';

const fmtMoney = (n, c = 'SRD') => {
  try { return `${c} ${new Intl.NumberFormat('nl-NL').format(Math.round(Number(n) || 0))}`; } catch { return `${c} ${n}`; }
};
const colorOf = (company) => company?.branding?.primary_color || '#FF5C00';

function VillaHeader({ company }) {
  const primary = colorOf(company);
  const logo = company?.branding?.logo_url || '';
  const loginHref = company?.login_url || `/${company?.slug || ''}/login`;
  const initials = (company?.name || 'V').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return (
    <header className="fixed top-4 inset-x-4 z-40">
      <div className="max-w-[1100px] mx-auto h-[72px] px-4 pl-3 rounded-full bg-white/85 backdrop-blur-xl shadow-[0_8px_30px_rgba(0,0,0,.12)] flex items-center justify-between">
        <a href="#top" className="flex items-center gap-3" data-testid="tenant-landing-logo">
          {logo ? (
            <EditableImage path="logo_url" fallback={logo} alt={company?.name} className="w-11 h-11 rounded-full object-cover" />
          ) : (
            <span className="w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-sm" style={{ backgroundColor: DARK }}>
              {initials || <Building2 className="w-5 h-5" />}
            </span>
          )}
          <span className="leading-tight">
            <EditableText path="brand_name" fallback={company?.name || 'Vastgoed'} as="span"
              className="block text-[15px] font-bold text-[#121519]" style={HEAD} />
            <EditableText path="brand_tagline" fallback="VASTGOED" as="span"
              className="block text-[10px] font-semibold tracking-[0.28em] text-slate-500" />
          </span>
        </a>
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600">
          <a href="#aanbod" className="hover:text-slate-900">Woningen</a>
          <a href="#types" className="hover:text-slate-900">Types</a>
          <a href="#belofte" className="hover:text-slate-900">Over ons</a>
          <a href="#contact" className="hover:text-slate-900">Contact</a>
        </nav>
        <nav className="flex items-center gap-1.5">
          <a href={loginHref} data-testid="tenant-landing-login"
            className="h-[42px] px-4 rounded-full text-sm font-semibold text-[#121519] hover:bg-black/5 flex items-center">Inloggen</a>
          <a href="#aanbod" className="h-[42px] px-5 rounded-full text-sm font-semibold text-white flex items-center shadow-lg"
            style={{ backgroundColor: primary }}>
            <EditableText path="header_cta" fallback="Bekijk aanbod" as="span" />
          </a>
        </nav>
      </div>
    </header>
  );
}

function VillaHero({ company }) {
  const primary = colorOf(company);
  const loginHref = company?.login_url || `/${company?.slug || ''}/login`;
  const ticker = ['PARAMARIBO', 'WANICA', 'NOORD', 'COMMEWIJNE', 'KWALITEIT & VERTROUWEN', (company?.name || '').toUpperCase()].filter(Boolean);
  return (
    <section id="top" className="relative text-white overflow-hidden" style={{ backgroundColor: DARK }} data-testid="tenant-hero">
      <div className="absolute inset-0">
        <EditableImage path="hero.bg_url" fallback="https://images.unsplash.com/photo-1721815693498-cc28507c0ba2?w=2200&q=80"
          alt="" className="w-full h-full object-cover opacity-70" />
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: `linear-gradient(180deg, ${DARK}99 0%, ${DARK}55 40%, ${DARK} 100%)` }} />
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: `radial-gradient(ellipse at 20% 80%, ${primary}33, transparent 55%)` }} />
      </div>
      <div className="relative max-w-[1280px] mx-auto px-5 lg:px-10 pt-44 lg:pt-52 pb-28 lg:pb-36 min-h-[88vh] flex flex-col justify-end">
        <EditableText path="hero.eyebrow" fallback="Premium vastgoedverhuur" as="p"
          className="self-start inline-flex items-center gap-2.5 text-[11px] font-semibold tracking-[0.22em] uppercase px-4 py-2 rounded-full bg-white/10 backdrop-blur border border-white/15 mb-8" />
        <h1 className="font-extrabold tracking-tight leading-[0.98] max-w-4xl" style={{ ...HEAD, fontSize: 'clamp(2.6rem, 7.5vw, 6.2rem)' }}>
          <EditableText path="hero.title_line1" fallback="Exclusieve woningen" as="span" />
          <br />
          <EditableText path="hero.title_line2" fallback="te huur in Suriname" as="span" style={{ color: primary }} />
        </h1>
        <EditableText path="hero.subtitle"
          fallback={`${company?.name || 'Wij'} beheert en verhuurt zorgvuldig geselecteerde woningen in Paramaribo en omgeving.`}
          as="p" multiline className="mt-6 text-base lg:text-xl text-white/75 max-w-xl leading-relaxed font-light" />
        <div className="mt-10 flex flex-wrap gap-3">
          <a href="#aanbod" className="h-14 px-8 rounded-full text-white font-semibold flex items-center gap-2 shadow-2xl"
            style={{ backgroundColor: primary }}>
            <EditableText path="hero.cta_primary" fallback="Bekijk het aanbod" as="span" /> <ArrowRight className="w-4 h-4" />
          </a>
          <a href={loginHref} className="h-14 px-8 rounded-full font-semibold flex items-center border border-white/30 hover:bg-white/10 backdrop-blur">
            <EditableText path="hero.cta_secondary" fallback="Huurder? Log hier in" as="span" />
          </a>
        </div>
      </div>
      <div className="relative border-y border-white/10 bg-black/30 backdrop-blur py-4 overflow-hidden">
        <div className="flex gap-12 whitespace-nowrap w-max text-xs font-semibold tracking-[0.3em] text-white/60"
          style={{ animation: 'villa-marquee 40s linear infinite' }}>
          {[...ticker, ...ticker, ...ticker, ...ticker].map((t, i) => (
            <span key={`${t}-${i}`} className="flex items-center gap-12">{t}<span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: primary }} /></span>
          ))}
        </div>
      </div>
      <style>{'@keyframes villa-marquee{from{transform:translateX(0)}to{transform:translateX(-50%)}}'}</style>
    </section>
  );
}

function VillaListing({ company, apartments: all, filter, setFilter }) {
  const primary = colorOf(company);
  const q = (filter?.q || '').trim().toLowerCase();
  const max = Number(filter?.max) || 0;
  const min = Number(filter?.min) || 0;
  const list = all.filter((a) => {
    if (filter?.status === 'free' && a.status === 'occupied') return false;
    if (filter?.status === 'occupied' && a.status !== 'occupied') return false;
    if (max && Number(a.rent_amount) > max) return false;
    if (min && Number(a.rent_amount) < min) return false;
    if (q && !`${a.number || ''} ${a.address || ''} ${a.description || ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const pick = (apt) => {
    document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' });
    try { window.dispatchEvent(new CustomEvent('tenant-landing-select-apt', { detail: apt })); } catch { /* noop */ }
  };
  const field = 'h-[46px] rounded-xl px-3 text-sm outline-none text-[#121519] w-24';
  const pills = [['all', 'Alle'], ['free', 'Beschikbaar'], ['occupied', 'Verhuurd']];
  return (
    <section id="aanbod" className="py-20 lg:py-28" style={{ backgroundColor: WARM }}>
      <div className="max-w-[1280px] mx-auto px-5 lg:px-10">
        <EditableText path="aanbod.eyebrow" fallback="Actueel aanbod" as="p" className="text-xs font-semibold tracking-[0.3em] uppercase mb-3" style={{ color: primary }} />
        <div className="flex flex-wrap items-end justify-between gap-6 mb-10">
          <EditableText path="aanbod.title" fallback="Beschikbare woningen" as="h2"
            className="text-3xl lg:text-5xl font-bold tracking-tight text-[#121519]" style={HEAD} />
          <div className="bg-white rounded-2xl p-2 shadow-sm flex flex-wrap items-center gap-2 w-full lg:w-auto" data-testid="tenant-search">
            <label className="flex items-center gap-2 px-3 flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-slate-400" />
              <input value={filter.q} onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))}
                placeholder="Zoek op adres of titel..." className="w-full h-[46px] text-sm outline-none bg-transparent" />
            </label>
            <input type="number" min="0" placeholder="Min" value={filter.min || ''} className={field} style={{ backgroundColor: WARM }}
              onChange={(e) => setFilter((f) => ({ ...f, min: e.target.value }))} />
            <input type="number" min="0" placeholder="Max" value={filter.max || ''} className={field} style={{ backgroundColor: WARM }}
              onChange={(e) => setFilter((f) => ({ ...f, max: e.target.value }))} />
            <button type="button" onClick={() => setFilter({ status: 'all', q: '', max: '', min: '' })}
              className="h-11 px-4 rounded-xl text-sm font-semibold flex items-center gap-1.5" style={{ color: primary }}>
              <RotateCcw className="w-3.5 h-3.5" /> Reset
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 mb-8">
          {pills.map(([k, label]) => (
            <button key={k} type="button" onClick={() => setFilter((f) => ({ ...f, status: k }))}
              className="h-10 px-5 rounded-full text-sm font-semibold transition"
              style={filter.status === k ? { backgroundColor: DARK, color: '#fff' } : { backgroundColor: '#fff', color: '#525866' }}>
              {label}
            </button>
          ))}
          <span className="ml-2 text-sm text-slate-500">{list.length} {list.length === 1 ? 'woning' : 'woningen'} gevonden</span>
        </div>

        {list.length === 0 ? (
          <div className="bg-white rounded-3xl p-16 text-center">
            <Home className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="font-bold text-slate-700 text-lg" style={HEAD}>0 woningen gevonden</p>
            <p className="text-sm text-slate-500 mt-2">Pas uw filters aan of neem contact op voor de wachtlijst.</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
            {list.map((apt) => {
              const occ = apt.status === 'occupied';
              return (
                <article key={apt.id} data-testid={`apt-card-${apt.id}`}
                  className="group bg-white rounded-[28px] overflow-hidden shadow-[0_2px_20px_rgba(0,0,0,.05)] hover:shadow-[0_20px_50px_rgba(0,0,0,.14)] hover:-translate-y-1.5 transition-all duration-500">
                  <div className="relative aspect-[4/3] bg-slate-100 overflow-hidden">
                    {apt.photo_url ? (
                      <img loading="lazy" src={apt.photo_url} alt={apt.number}
                        className={`w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ${occ ? 'grayscale-[50%]' : ''}`} />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center"><Home className="w-14 h-14 text-slate-300" /></div>
                    )}
                    <span className="absolute top-4 left-4 px-3.5 py-1.5 rounded-full text-[11px] font-semibold uppercase tracking-[0.14em] text-white backdrop-blur-md"
                      style={{ backgroundColor: occ ? 'rgba(82,88,102,.85)' : `${primary}E6` }}>
                      {occ ? 'Verhuurd' : 'Beschikbaar'}
                    </span>
                  </div>
                  <div className="p-6">
                    <h3 className="text-xl font-bold text-[#121519]" style={HEAD}>{apt.number}</h3>
                    {apt.address && <p className="text-sm text-slate-500 flex items-center gap-1.5 mt-1.5"><MapPin className="w-4 h-4" /> {apt.address}</p>}
                    {apt.description && <p className="text-sm text-slate-600 mt-3 line-clamp-2 font-light">{apt.description}</p>}
                    <div className="mt-5 pt-5 border-t border-slate-100 flex items-center justify-between">
                      <p className="text-[#121519]">
                        <span className="text-xl font-bold" style={HEAD}>{fmtMoney(apt.rent_amount, apt.currency)}</span>
                        <span className="text-xs text-slate-500"> /mnd</span>
                      </p>
                      <button type="button" onClick={() => pick(apt)} disabled={occ}
                        className="h-10 px-4 rounded-full text-sm font-semibold flex items-center gap-1.5 hover:bg-black/5 disabled:opacity-40"
                        style={{ color: primary }}>
                        Bekijk details <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
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

const PROMISE = [
  { title: 'Zorgvuldig geselecteerd', text: 'Elke woning in ons aanbod wordt persoonlijk bezocht en gecontroleerd voordat deze online komt. Wat u ziet, is wat u krijgt.' },
  { title: 'Eerlijke prijzen', text: 'Transparante huurprijzen zonder verborgen kosten. De prijs op de website is de prijs in het contract.' },
  { title: 'Digitaal beheerd', text: 'Contracten, facturen en betalingen lopen volledig digitaal. Snel, veilig en overzichtelijk.' },
];

function VillaPromise({ company }) {
  const primary = colorOf(company);
  return (
    <section id="belofte" className="text-white py-20 lg:py-28" style={{ backgroundColor: DARK }}>
      <div className="max-w-[1280px] mx-auto px-5 lg:px-10">
        <EditableText path="promise.eyebrow" fallback="Onze belofte" as="p" className="text-xs font-semibold tracking-[0.3em] uppercase mb-4" style={{ color: primary }} />
        <EditableText path="promise.title" fallback="Huren zonder zorgen, zoals het hoort." as="h2"
          className="text-3xl lg:text-6xl font-bold tracking-tight leading-[1.05] max-w-3xl mb-14" style={HEAD} />
        <div className="grid md:grid-cols-3 gap-5">
          {PROMISE.map((p, i) => (
            <div key={p.title} className="rounded-[28px] border border-white/10 bg-white/[0.03] p-8 hover:bg-white/[0.06] transition">
              <p className="text-5xl font-extrabold mb-8" style={{ ...HEAD, color: primary }}>{String(i + 1).padStart(2, '0')}</p>
              <EditableText path={`promise.i${i}.title`} fallback={p.title} as="h3" className="text-xl font-bold" style={HEAD} />
              <EditableText path={`promise.i${i}.text`} fallback={p.text} as="p" multiline className="mt-3 text-white/65 leading-relaxed font-light" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function ProPage({ company, apartments, filter, setFilter, shared }) {
  const { About, TypesSection, ContactSection, TenantFooter } = shared;
  useEffect(() => {
    if (document.getElementById('villa-fonts')) return;
    const l = document.createElement('link');
    l.id = 'villa-fonts'; l.rel = 'stylesheet'; l.href = FONT_HREF;
    document.head.appendChild(l);
  }, []);
  return (
    <div className="min-h-screen bg-white antialiased" style={BODY}>
      <VillaHeader company={company} />
      <VillaHero company={company} />
      <VillaListing company={company} apartments={apartments} filter={filter} setFilter={setFilter} />
      <TypesSection company={company} apartments={apartments} setFilter={setFilter} />
      <VillaPromise company={company} />
      <About company={company} />
      <ContactSection company={company} />
      <TenantFooter company={company} />
    </div>
  );
}
