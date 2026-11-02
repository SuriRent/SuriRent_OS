// Kiosk-onderdeel (licht) met nagebouwde tablet + prijsvergelijker voor de landing.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Building2, Delete, Minus, Plus, Sparkles } from 'lucide-react';
import { EditableText, EditableImage } from '../../../lib/landing-editable';
import { NAVY } from './LandingTop';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', 'del'];

function TabletMockup() {
  return (
    <div className="w-[560px] rounded-[30px] bg-[#111827] p-[14px] shadow-[0_40px_80px_-30px_rgba(11,27,63,0.55)]" data-testid="kiosk-tablet">
      <div className="rounded-[18px] overflow-hidden bg-[#FF5C00] h-[360px] flex">
        <div className="flex-1 bg-white rounded-r-[22px] p-4 flex flex-col">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <span className="w-6 h-6 rounded-md bg-[#FF5C00] p-[4px]"><EditableImage path="v2.brand.logo_url" fallback="/kiosk-icons/mark-white.png" alt="" className="w-full h-full" /></span>
              <span className="text-[12px] font-black" style={{ color: NAVY }}>
                <EditableText path="v2.brand.name_prefix" fallback="Suri" as="span" label="Merk · Voorvoegsel" />
                <EditableText path="v2.brand.name_suffix" fallback="Rent" as="span" label="Merk · Achtervoegsel" className="text-[#FF5C00]" />
                <EditableText path="marketing.kiosk_mockup.brand_suffix" fallback=" Kiosk" label="Startpagina · Kiosk mock-up merk" />
              </span>
            </span>
            <EditableText path="marketing.kiosk_mockup.tenant" fallback="Huis 7A · J. Ramautar" as="span" label="Startpagina · Kiosk mock-up huurder" className="text-[8px] font-bold text-slate-400" />
          </div>
          <EditableText path="marketing.kiosk_mockup.outstanding" fallback="Openstaand" as="div" label="Startpagina · Kiosk mock-up openstaand" className="mt-3 text-[9px] font-bold uppercase tracking-wide text-slate-400" />
          <div className="grid grid-cols-3 gap-1.5 mt-1.5">
            {[['Achterstand', 'SRD 2.500', 'text-red-600'], ['Lopende maand', 'SRD 7.000', 'text-[#FF5C00]'], ['Boete', 'SRD 0', 'text-slate-500']].map(([l, v, c], i) => (
              <div key={l} className="rounded-lg bg-slate-50 px-2 py-1.5">
                <EditableText path={`marketing.kiosk_mockup.summary.${i}.label`} fallback={l} as="div" label={`Startpagina · Kiosk mock-up samenvatting ${i + 1}`} className="text-[6.5px] font-bold uppercase tracking-wide text-slate-400" />
                <EditableText path={`marketing.kiosk_mockup.summary.${i}.amount`} fallback={v} as="div" label={`Startpagina · Kiosk mock-up bedrag ${i + 1}`} className={`text-[11px] font-black ${c}`} />
              </div>
            ))}
          </div>
          <div className="mt-3 space-y-1.5">
            {[['Huur april 2026', 'SRD 7.000', 'Open'], ['Huur maart 2026', 'SRD 2.500', 'Achterstand']].map(([t, a, s], i) => (
              <div key={t} className="rounded-lg border border-slate-200 px-2.5 py-2 flex items-center justify-between">
                <div><EditableText path={`marketing.kiosk_mockup.payments.${i}.title`} fallback={t} as="div" label={`Startpagina · Kiosk mock-up betaling ${i + 1}`} className="text-[9px] font-black" style={{ color: NAVY }} /><EditableText path={`marketing.kiosk_mockup.payments.${i}.property`} fallback="Huis 7A" as="div" label={`Startpagina · Kiosk mock-up woning ${i + 1}`} className="text-[7px] text-slate-400" /></div>
                <div className="text-right"><EditableText path={`marketing.kiosk_mockup.payments.${i}.amount`} fallback={a} as="div" label={`Startpagina · Kiosk mock-up betaling bedrag ${i + 1}`} className="text-[9px] font-black" style={{ color: NAVY }} />
                  <EditableText path={`marketing.kiosk_mockup.payments.${i}.status`} fallback={s} as="div" label={`Startpagina · Kiosk mock-up status ${i + 1}`} className={`text-[6.5px] font-bold uppercase ${s === 'Open' ? 'text-[#FF5C00]' : 'text-red-600'}`} /></div>
              </div>
            ))}
          </div>
          <EditableText path="marketing.kiosk_mockup.pay_button" fallback="Betaal SRD 9.500" as="div" label="Startpagina · Kiosk mock-up betaalactie" className="mt-auto h-9 rounded-xl bg-[#FF5C00] text-white text-[10px] font-black flex items-center justify-center" />
        </div>
        <div className="w-[190px] p-3 flex flex-col">
          <div className="rounded-xl bg-white/15 px-3 py-2 text-right">
            <EditableText path="marketing.kiosk_mockup.amount_label" fallback="Bedrag" as="div" label="Startpagina · Kiosk mock-up bedraglabel" className="text-[7px] font-bold uppercase tracking-wide text-white/70" />
            <EditableText path="marketing.kiosk_mockup.keypad_amount" fallback="9.500" as="div" label="Startpagina · Kiosk mock-up toetsenbordbedrag" className="text-[20px] font-black text-white leading-tight" />
          </div>
          <div className="grid grid-cols-3 gap-1.5 mt-2 flex-1">
            {KEYS.map((k) => (
              <div key={k} className="rounded-lg bg-white/90 flex items-center justify-center text-[13px] font-black" style={{ color: NAVY }}>
                {k === 'del' ? <Delete className="w-3.5 h-3.5" /> : k}
              </div>
            ))}
          </div>
          <EditableText path="marketing.kiosk_mockup.confirm" fallback="Bevestigen" as="div" label="Startpagina · Kiosk mock-up bevestigen" className="mt-2 h-8 rounded-lg bg-[#0B1B3F] text-white text-[9px] font-black flex items-center justify-center" />
        </div>
      </div>
    </div>
  );
}

function TabletStage() {
  const ref = useRef(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setScale(Math.min(1.1, e.contentRect.width / 560)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="w-full relative" style={{ height: 390 * scale }} data-testid="kiosk-tablet-stage">
      <div className="absolute left-1/2 top-0 origin-top" style={{ width: 560, transform: `translateX(-50%) scale(${scale})` }}>
        <TabletMockup />
      </div>
    </div>
  );
}

export function KioskShowcase({ steps }) {
  return (
    <section id="kiosk" className="relative bg-[#FBF8F5] py-16 lg:py-24 overflow-hidden" data-testid="kiosk-section">
      <div className="absolute -top-32 -right-32 w-[520px] h-[520px] rounded-full opacity-25 blur-3xl pointer-events-none" style={{ background: 'radial-gradient(circle, #FF8A3D, transparent 65%)' }} />
      <div className="relative max-w-[1440px] mx-auto px-5 lg:px-10 2xl:px-[120px]">
        <div className="grid lg:grid-cols-[minmax(0,1fr),minmax(0,1.05fr)] gap-10 items-center">
          <div>
            <EditableText path="v2.kiosk.eyebrow" fallback="Kiosk PWA" as="p" label="Startpagina · Kiosk label"
              className="inline-block px-3.5 py-1.5 rounded-md bg-[#FCE9DC] text-[12px] font-black tracking-[0.14em] uppercase text-[#E65300]" />
            <h2 className="mt-5 text-4xl lg:text-[52px] font-black tracking-[-0.03em] leading-[1.05]" style={{ color: NAVY }}>
              <EditableText path="v2.kiosk.title_line1" fallback="Selfservice in" as="span" label="Startpagina · Kiosktitel" />
              <span className="block text-[#FF5C00]"><EditableText path="v2.kiosk.title_highlight" fallback="vier tikken." as="span" label="Startpagina · Kiosktitel accent" /></span>
            </h2>
            <EditableText path="v2.kiosk.subtitle" multiline as="p"
              fallback="Werkt op tablet, telefoon én desktop. Installeer in 1 tik — geen App Store nodig. Achterstand, lopende maand en boetes met groot lettertype voor elke huurder."
              label="Startpagina · Kiosk toelichting"
              className="mt-5 text-lg font-semibold text-slate-500 max-w-[520px] leading-snug" />
          </div>
          <TabletStage />
        </div>
        <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {steps.map((t, i) => (
            <div key={t.num} data-testid={`kiosk-step-${i}`}
              className="group bg-white rounded-xl p-4 shadow-[0_8px_24px_-14px_rgba(11,27,63,0.18)] hover:-translate-y-0.5 hover:shadow-[0_18px_36px_-16px_rgba(11,27,63,0.28)] transition-[transform,box-shadow]">
              <div className="rounded-lg overflow-hidden bg-slate-100 aspect-[16/9]">
                <EditableImage path={`v2.kiosk.steps.${i}.img`} fallback={t.src} alt={t.label} label={`Startpagina · Kiosk afbeelding ${i + 1}`} className="w-full h-full object-cover object-top" />
              </div>
              <div className="mt-4 flex items-start gap-3">
                <span className="w-10 h-10 rounded-xl bg-orange-50 text-[#FF5C00] text-sm font-black flex items-center justify-center shrink-0">{t.num}</span>
                <div className="min-w-0">
                  <EditableText path={`v2.kiosk.steps.${i}.label`} fallback={t.label} as="p" label={`Startpagina · Kiosk stap ${i + 1}`} className="text-[17px] font-black" style={{ color: NAVY }} />
                  <EditableText path={`v2.kiosk.steps.${i}.desc`} fallback={t.desc} as="p" label={`Startpagina · Kiosk stap ${i + 1} toelichting`} className="text-[13px] text-slate-500 mt-0.5" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// Kiest het goedkoopste betaalde pakket met genoeg appartementen; anders Enterprise.
export function pickPlan(plans, n) {
  const paid = plans.filter((p) => p.id && p.id !== 'lifetime' && p.id !== 'enterprise' && Number(p.amount) > 0)
    .sort((a, b) => Number(a.amount) - Number(b.amount));
  return paid.find((p) => { const m = p.limits?.max_apartments; return m === -1 || m == null || m >= n; }) || null;
}

export function PriceAdvisor({ plans, onChoose, onEnterprise }) {
  const [raw, setRaw] = useState('25');
  const n = Math.max(1, Math.min(100000, parseInt(raw, 10) || 1));
  const plan = useMemo(() => pickPlan(plans, n), [plans, n]);
  const set = (v) => setRaw(String(Math.max(1, Math.round(v) || 1)));
  const max = plan?.limits?.max_apartments;
  return (
    <div className="max-w-4xl mx-auto mb-12 rounded-2xl bg-white p-5 sm:p-7 shadow-[0_18px_40px_-20px_rgba(11,27,63,0.25)] grid md:grid-cols-[1.1fr,1fr] gap-6 items-center" data-testid="price-advisor">
      <div>
        <p className="text-[12px] font-black tracking-[0.08em] uppercase text-[#FF5C00] flex items-center gap-1.5"><Sparkles className="w-4 h-4" /> <EditableText path="marketing.pricing.advisor.eyebrow" fallback="Prijsvergelijker" as="span" label="Prijzen · Vergelijkerlabel" /></p>
        <EditableText path="marketing.pricing.advisor.question" fallback="Hoeveel appartementen beheert u?" as="p" label="Prijzen · Vergelijkervraag" className="mt-1.5 text-xl font-black" style={{ color: NAVY }} />
        <div className="mt-4 flex items-center gap-2">
          <button type="button" onClick={() => set(n - 1)} data-testid="price-advisor-minus" aria-label="Minder"
            className="w-12 h-12 rounded-xl bg-slate-100 hover:bg-orange-50 flex items-center justify-center" style={{ color: NAVY }}><Minus className="w-5 h-5" /></button>
          <label className="flex-1 h-12 rounded-xl border border-slate-200 focus-within:border-[#FF5C00] flex items-center gap-2 px-3">
            <Building2 className="w-5 h-5 text-slate-400" />
            <input type="number" inputMode="numeric" min={1} value={raw} onChange={(e) => setRaw(e.target.value.replace(/[^0-9]/g, ''))} onBlur={() => setRaw(String(n))} data-testid="price-advisor-input"
              className="w-full bg-transparent outline-none text-lg font-black tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" style={{ color: NAVY }} />
            <EditableText path="marketing.pricing.advisor.unit" fallback="appt." as="span" label="Prijzen · Eenheid appartementen" className="text-sm font-semibold text-slate-400" />
          </label>
          <button type="button" onClick={() => set(n + 1)} data-testid="price-advisor-plus" aria-label="Meer"
            className="w-12 h-12 rounded-xl bg-slate-100 hover:bg-orange-50 flex items-center justify-center" style={{ color: NAVY }}><Plus className="w-5 h-5" /></button>
        </div>
        <input type="range" min={1} max={750} value={Math.min(n, 750)} onChange={(e) => set(parseInt(e.target.value, 10))} data-testid="price-advisor-range"
          className="mt-4 w-full accent-[#FF5C00]" />
        <div className="flex justify-between text-[11px] font-semibold text-slate-400"><span>1</span><span>250</span><span>500</span><span>750+</span></div>
      </div>
      <div className="rounded-xl bg-[#FBF8F5] p-5" data-testid="price-advisor-result">
        <EditableText path="marketing.pricing.advisor.result_label" fallback="Ons advies" as="p" label="Prijzen · Advieslabel" className="text-[11px] font-bold uppercase tracking-wide text-slate-400" />
        {plan ? (
          <>
            <p className="mt-1 text-2xl font-black" style={{ color: NAVY }} data-testid="price-advisor-plan">{plan.name}</p>
            <p className="mt-1 flex items-baseline gap-1.5">
              <span className="text-4xl font-black tracking-tight text-[#FF5C00]" data-testid="price-advisor-price">{plan.price}</span>
              <span className="text-sm font-bold text-slate-500">{plan.sub}</span>
            </p>
            <EditableText path="marketing.pricing.advisor.limit_description" fallback={max === -1 || max == null ? 'Onbeperkt appartementen' : `Tot ${new Intl.NumberFormat('nl-NL').format(max)} appartementen`}
              as="p" label="Prijzen · Limiettoelichting" className="mt-1 text-xs text-slate-500" />
            <button type="button" onClick={() => onChoose(plan.id)} data-testid="price-advisor-cta"
              className="mt-4 w-full h-12 rounded-xl bg-[#FF5C00] hover:bg-[#E65300] text-white text-sm font-black inline-flex items-center justify-center gap-2">
              <EditableText path="marketing.pricing.advisor.choose_button" fallback={`Kies ${plan.name}`} as="span" label="Prijzen · Adviesknop" /> <ArrowRight className="w-4 h-4" /></button>
          </>
        ) : (
          <>
            <EditableText path="marketing.pricing.advisor.enterprise_name" fallback="Enterprise" as="p" label="Prijzen · Maatwerkpakket" className="mt-1 text-2xl font-black" style={{ color: NAVY }} data-testid="price-advisor-plan" />
            <EditableText path="marketing.pricing.advisor.custom_price" fallback="Op maat" as="p" label="Prijzen · Maatwerkprijs" className="mt-1 text-4xl font-black tracking-tight text-[#FF5C00]" data-testid="price-advisor-price" />
            <EditableText path="marketing.pricing.advisor.enterprise_description" fallback={`Voor ${new Intl.NumberFormat('nl-NL').format(n)} appartementen maken wij een offerte op maat.`}
              as="p" multiline label="Prijzen · Maatwerkomschrijving" className="mt-1 text-xs text-slate-500" />
            <button type="button" onClick={onEnterprise} data-testid="price-advisor-cta"
              className="mt-4 w-full h-12 rounded-xl bg-[#0B1B3F] hover:bg-[#FF5C00] text-white text-sm font-black inline-flex items-center justify-center gap-2">
              <EditableText path="marketing.pricing.advisor.enterprise_button" fallback="Vraag offerte aan" as="span" label="Prijzen · Offerteknop" /> <ArrowRight className="w-4 h-4" /></button>
          </>
        )}
      </div>
    </div>
  );
}
