// Merkheader voor betaalpagina's: SuriRent huis-icoon + naam (of bedrijfslogo).
export function CheckoutBrandHeader({ name, logoUrl, testid = 'checkout-brand' }) {
  const label = name || 'SuriRent';
  const isSuri = !name || /^surirent$/i.test(label);
  return (
    <div className="flex items-center gap-3 mb-5" data-testid={testid}>
      {logoUrl ? (
        <div className="w-12 h-12 rounded-2xl bg-white p-1.5 shadow-lg shrink-0 overflow-hidden">
          <img src={logoUrl} alt={label} className="w-full h-full object-contain" />
        </div>
      ) : (
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#FF8A3D] to-[#C74600] p-2 shadow-[0_8px_18px_-6px_rgba(0,0,0,0.35)] ring-2 ring-white/70 shrink-0">
          <img src="/kiosk-icons/mark-white.png" alt="SuriRent" className="w-full h-full object-contain" />
        </div>
      )}
      <div className="min-w-0">
        <p className="text-xl font-black tracking-tight leading-none truncate text-white">
          {isSuri ? <>Suri<span className="text-slate-900">Rent</span></> : label}
        </p>
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/75 mt-1">Veilig betalen</p>
      </div>
    </div>
  );
}
