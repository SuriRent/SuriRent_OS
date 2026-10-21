import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, Building2, Loader2, Check, Clock as ClockIcon } from 'lucide-react';
import { fetchKioskSelect, readKioskSelectCache } from '../lib/kiosk-cache';

const STATUS = {
  paid: { label: 'Betaald', cls: 'bg-emerald-600', Icon: Check },
  partial: { label: 'Gedeeltelijk', cls: 'bg-amber-500', Icon: ClockIcon },
  unpaid: { label: 'Niet betaald', cls: 'bg-red-500', Icon: X },
};

function StatusBadge({ status, testId }) {
  const s = STATUS[status] || STATUS.unpaid;
  return (
    <span data-testid={testId}
      className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold text-white shrink-0 ${s.cls}`}>
      <s.Icon className="w-3.5 h-3.5" strokeWidth={3} /> {s.label}
    </span>
  );
}

function ResultRow({ a, onPick }) {
  return (
    <button type="button" onClick={() => onPick(a)} data-testid={`tenant-search-result-${a.number}`}
      className="w-full flex items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-orange-50 active:scale-[0.99] transition-colors">
      <span className="w-11 h-11 rounded-full bg-orange-50 flex items-center justify-center shrink-0">
        <Building2 className="w-5 h-5 text-orange-500" />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block font-bold text-slate-900 truncate">{a.tenant_name}</span>
        <span className="block text-sm text-slate-500 truncate">Appt. {a.number}</span>
      </span>
      <StatusBadge status={a.pay_status} testId={`tenant-search-status-${a.number}`} />
    </button>
  );
}

export function KioskTenantSearch({ onClose, onPick }) {
  const [items, setItems] = useState(() => readKioskSelectCache()?.apartments || null);
  const [q, setQ] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    fetchKioskSelect().then((d) => setItems(d.apartments)).catch(() => setItems((v) => v || []));
  }, []);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (items || [])
      .filter((a) => a.status === 'occupied' && a.tenant_id)
      .filter((a) => !term || `${a.tenant_name || ''} ${a.number || ''}`.toLowerCase().includes(term))
      .sort((x, y) => String(x.tenant_name || '').localeCompare(String(y.tenant_name || '')));
  }, [items, q]);

  return (
    <div className="fixed inset-0 z-[120] bg-black/50 backdrop-blur-sm flex items-start justify-center p-4 pt-[10vh]"
      onClick={onClose} data-testid="tenant-search-modal">
      <div className="w-full max-w-xl bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[70vh]"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
          <Search className="w-5 h-5 text-slate-400 shrink-0" />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Zoek op naam of appartement…" data-testid="tenant-search-input"
            className="flex-1 min-w-0 text-lg font-semibold text-slate-900 outline-none placeholder:text-slate-400" />
          <button type="button" onClick={onClose} data-testid="tenant-search-close" aria-label="Sluiten"
            className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-2" data-testid="tenant-search-results">
          {items === null && <Loader2 className="w-6 h-6 text-orange-500 animate-spin mx-auto my-8" />}
          {items !== null && results.map((a) => <ResultRow key={a.id} a={a} onPick={onPick} />)}
          {items !== null && results.length === 0 && (
            <p className="text-center text-slate-500 font-semibold py-8" data-testid="tenant-search-empty">Geen huurder gevonden</p>
          )}
        </div>
      </div>
    </div>
  );
}
