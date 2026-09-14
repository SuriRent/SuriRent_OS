import { useState, useMemo } from 'react';
import { FileText, ChevronDown, ChevronRight, Check } from 'lucide-react';
import { fmtMoney, MONTHS_NL } from '../../../../lib/api';
import { fmtAmountWhole } from './helpers';

// =====================================================================
// PaidHistorySection — herbruikbaar overzicht van reeds betaalde maanden
// voor 1 huurder. Toont datum, ontvangstnummer en methode zodra beschikbaar.
// Sorteert nieuwste-eerst, groepeert per jaar en biedt "Toon meer" wanneer
// er meer dan 12 items zijn zodat oude data niet direct de kaart vult.
//
// Jaren zijn STANDAARD INGEKLAPT (collapsed) — admin klikt op een jaar-header
// om de maanden ervoor open te vouwen. Voorkomt lange scroll bij huurders
// met veel betalingsgeschiedenis (bv. 2 jaar × 12 maanden = 24 regels).
// =====================================================================
const INITIAL_LIMIT = 12;

export default function PaidHistorySection({ paidInvoices, currency, testidPrefix = 'paid', variant = 'card' }) {
  const [expanded, setExpanded] = useState(false);
  // Set van jaren die momenteel open zijn (default = leeg = alles ingeklapt).
  const [openYears, setOpenYears] = useState(() => new Set());

  const toggleYear = (year) => {
    setOpenYears((prev) => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year); else next.add(year);
      return next;
    });
  };

  // Sorteer nieuwste eerst (één keer) en houd ook een gelimiteerde variant klaar.
  const sortedAll = useMemo(
    () => [...paidInvoices].sort((a, b) =>
      (b.period_year - a.period_year) || (b.period_month - a.period_month)),
    [paidInvoices],
  );
  const shownFlat = useMemo(
    () => (expanded ? sortedAll : sortedAll.slice(0, INITIAL_LIMIT)),
    [sortedAll, expanded],
  );

  // Groepeer de zichtbare items per jaar zodat elk jaar een header krijgt.
  const shownGrouped = useMemo(() => {
    const map = new Map();
    for (const inv of shownFlat) {
      const y = inv.period_year;
      if (!map.has(y)) map.set(y, []);
      map.get(y).push(inv);
    }
    return [...map.entries()];
  }, [shownFlat]);

  // Volledige groepering (voor de "eerste — laatste jaar"-hint in de header).
  const grouped = useMemo(() => {
    const map = new Map();
    for (const inv of sortedAll) {
      const y = inv.period_year;
      if (!map.has(y)) map.set(y, []);
      map.get(y).push(inv);
    }
    return [...map.entries()];
  }, [sortedAll]);

  if (!paidInvoices.length) return null;

  const total = paidInvoices.reduce((s, i) => s + Number(i.amount || 0), 0);
  const shownCount = shownFlat.length;
  const hasMore = paidInvoices.length > INITIAL_LIMIT;

  const rows = (
    <div className="space-y-3">
      {shownGrouped.map(([year, invs]) => {
        const yearTotal = invs.reduce((s, i) => s + Number(i.amount || 0), 0);
        const isOpen = openYears.has(year);
        return (
          <div key={year} data-testid={`${testidPrefix}-year-${year}`}
            className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            {/* Jaar-header = klikbare toggle. Standaard ingeklapt zodat de
                lijst compact blijft — pas na klik verschijnen de maanden.
                Style + layout gelijk aan de "Openstaande facturen" card
                header voor visuele consistentie. */}
            <button type="button"
              onClick={() => toggleYear(year)}
              data-testid={`${testidPrefix}-year-toggle-${year}`}
              aria-expanded={isOpen}
              className="w-full flex items-center justify-between gap-2 px-4 py-3 hover:bg-slate-50 transition text-left border-b border-slate-100">
              <div className="flex items-center gap-2 min-w-0">
                {isOpen
                  ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                  : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
                <h2 className="text-sm font-black text-slate-900 uppercase tracking-widest">{year}</h2>
              </div>
              <span className="text-[10px] font-bold text-emerald-700 shrink-0 whitespace-nowrap">
                {invs.length} maand{invs.length === 1 ? '' : 'en'} · {fmtMoney(yearTotal, currency)}
              </span>
            </button>
            {isOpen && (
              <div className="divide-y divide-slate-100">
                {invs.map((inv) => (
                  <PaidInvoiceRow key={inv.id} inv={inv} testid={`${testidPrefix}-row-${inv.id}`} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  if (variant === 'inline') {
    // Compacte variant voor gebruik binnen de expand van een tenant-row.
    return (
      <div className="rounded-2xl p-4 bg-emerald-50" data-testid={`${testidPrefix}-inline`}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-bold text-emerald-700">
            Betaalde maanden ({paidInvoices.length}) · {fmtMoney(total, currency)}
          </p>
          <span className="text-[10px] font-bold text-slate-400">
            {shownCount === paidInvoices.length ? 'Alles' : `${shownCount} van ${paidInvoices.length}`}
          </span>
        </div>
        {rows}
        {hasMore && (
          <button type="button" onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
            data-testid={`${testidPrefix}-toggle`}
            className="mt-3 w-full h-9 rounded-xl bg-white border border-emerald-200 text-emerald-700 font-bold text-xs inline-flex items-center justify-center gap-1.5 hover:bg-emerald-50">
            {expanded ? <><ChevronDown className="w-3.5 h-3.5 rotate-180" /> Toon minder</> : <><ChevronDown className="w-3.5 h-3.5" /> Toon alle {paidInvoices.length} betaalde maanden</>}
          </button>
        )}
      </div>
    );
  }

  // Standaard card-variant (voor DetailPage).
  // Elke jaar-groep is nu al een eigen kaart (zie `rows` boven) met exact
  // dezelfde look als de "Openstaande facturen" kaart. We voegen alleen
  // een header-blok toe met totalen + eventuele "Toon meer"-knop.
  return (
    <div className="space-y-3" data-testid={`${testidPrefix}-card`}>
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-4 py-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-black text-slate-900 uppercase tracking-widest">Betalingsgeschiedenis</h2>
            <p className="text-[11px] text-slate-500 font-semibold mt-0.5">
              {paidInvoices.length} maand{paidInvoices.length === 1 ? '' : 'en'} betaald · totaal {fmtMoney(total, currency)}
            </p>
          </div>
          {grouped.length > 1 && (
            <span className="text-[10px] font-bold text-slate-400">
              {grouped[grouped.length - 1][0]} — {grouped[0][0]}
            </span>
          )}
        </div>
      </div>
      {rows}
      {hasMore && (
        <button type="button" onClick={() => setExpanded((v) => !v)}
          data-testid={`${testidPrefix}-toggle`}
          className="w-full h-10 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 font-bold text-sm inline-flex items-center justify-center gap-2 hover:bg-emerald-100">
          {expanded
            ? <><ChevronDown className="w-4 h-4 rotate-180" /> Toon minder</>
            : <><ChevronDown className="w-4 h-4" /> Toon alle {paidInvoices.length} betaalde maanden</>}
        </button>
      )}
    </div>
  );
}

// =====================================================================
// PaidInvoiceRow — één rij in de betalingsgeschiedenis.
// Layout is IDENTIEK aan de openstaande factuur-rij op InvoiceDetailPage:
//   - Regel 1: emerald icoon (Check) + maand+jaar + factuurnr + bedrag rechts
//   - Regel 2: badges (Betaald · methode · datum) + PDF-download knop rechts
// Zo oogt de detailspagina één geheel en herkent de admin instant welke
// rij hij aanraakt.
// =====================================================================
function PaidInvoiceRow({ inv, testid }) {
  const paidDate = inv.paid_at
    ? new Date(inv.paid_at).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' })
    : null;
  const methodLbl = inv.paid_method === 'cash' ? 'Contant'
    : inv.paid_method === 'bank' ? 'Bank'
    : inv.paid_method === 'card' ? 'Kaart'
    : inv.paid_method;
  return (
    <div className="px-4 py-3 hover:bg-slate-50 transition" data-testid={testid}>
      {/* Regel 1: icoon + maand + bedrag rechts */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
          <Check className="w-4 h-4" strokeWidth={3} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-slate-900 text-sm truncate capitalize">
            {MONTHS_NL[inv.period_month - 1]} {inv.period_year}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5 font-mono truncate">{inv.invoice_number}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="font-black text-slate-900 text-sm whitespace-nowrap">
            {inv.currency} {fmtAmountWhole(inv.amount)}
          </p>
          <p className="text-[10px] text-emerald-600">betaald</p>
        </div>
      </div>
      {/* Regel 2: badges + PDF-download */}
      <div className="mt-2 flex items-center justify-between gap-2 pl-12">
        <div className="flex items-center gap-1 flex-wrap min-w-0">
          <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded whitespace-nowrap bg-emerald-100 text-emerald-700">
            Betaald
          </span>
          {methodLbl && (
            <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded whitespace-nowrap bg-slate-100 text-slate-600">
              {methodLbl}
            </span>
          )}
          {paidDate && (
            <span className="text-[10px] text-slate-500 whitespace-nowrap">
              op {paidDate}
            </span>
          )}
          {inv.receipt_number && (
            <span className="text-[10px] font-mono text-slate-400 whitespace-nowrap hidden sm:inline">
              #{inv.receipt_number}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <a href={`${process.env.REACT_APP_BACKEND_URL}/api/invoices/${inv.id}/pdf`}
            target="_blank" rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            data-testid={`${testid}-pdf`}
            title="Download factuur PDF"
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 transition active:scale-95">
            <FileText className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
}
