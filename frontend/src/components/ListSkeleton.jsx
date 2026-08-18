// Gedeelde skeleton-placeholder voor lijstschermen (Huurders, Appartementen,
// Contracten, ...). Voorkomt de "flash of empty state" tijdens de eerste
// fetch. Gebruikt de standaard row-hoogte en pulserende bg-slate-100 blokken.
export function ListSkeleton({ rows = 5, testid = 'list-skeleton' }) {
  return (
    <div className="space-y-2" data-testid={testid}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={`sk-${i}`} className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 flex items-center gap-3 animate-pulse">
          <div className="w-11 h-11 rounded-xl bg-slate-100 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="h-3.5 rounded bg-slate-100 w-1/3 mb-2" />
            <div className="h-2.5 rounded bg-slate-100 w-1/2" />
          </div>
          <div className="h-6 w-16 rounded-full bg-slate-100 shrink-0" />
        </div>
      ))}
    </div>
  );
}

export default ListSkeleton;
