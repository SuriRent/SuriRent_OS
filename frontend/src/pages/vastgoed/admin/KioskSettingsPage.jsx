import { RENDER } from './InstellingenHub';
import { INSTELLINGEN_SECTIONS } from './instellingenSections';

// Desktop kiosk-layout voor de Instellingen-onderdelen: zelfde opzet als
// "Bon & afdrukken" (oranje achtergrond, twee witte panelen).
export default function KioskSettingsPage({ id, onBack }) {
  const current = INSTELLINGEN_SECTIONS.find((s) => s.id === id) || INSTELLINGEN_SECTIONS[1];
  const Icon = current.icon;
  const go = (sid) => window.dispatchEvent(new CustomEvent('kiosk-nav', { detail: `admin:inst-${sid}` }));

  return (
    <div className="h-full w-full bg-[#FF5C00] flex flex-col" style={{ paddingLeft: '1.5vw', paddingRight: '1.5vw' }} data-testid="kiosk-settings-panel">
      <div className="flex-1 min-h-0 flex gap-3 py-3 overflow-hidden">
        <section className="flex min-h-0 min-w-0 flex-[3] flex-col overflow-hidden rounded-2xl bg-white p-5" data-testid={`kiosk-settings-${current.id}`}>
          <div className="mb-3 flex items-center justify-between gap-3 shrink-0">
            <div className="min-w-0">
              <h1 className="truncate text-xl font-black tracking-tight text-slate-900">{current.label}</h1>
              <p className="text-xs font-semibold text-slate-500">{current.desc}</p>
            </div>
            <Icon className="h-5 w-5 shrink-0 text-[#FF5C00]" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1" key={current.id}>
            {RENDER[current.id]()}
          </div>
        </section>
        <aside className="flex min-h-0 flex-[2] flex-col overflow-y-auto rounded-2xl bg-white p-6" data-testid="kiosk-settings-nav">
          <h2 className="mb-4 text-2xl font-black tracking-tight text-slate-900">Instellingen</h2>
          <div className="space-y-1">
            {INSTELLINGEN_SECTIONS.map((s) => {
              const I = s.icon;
              const active = s.id === current.id;
              return (
                <button key={s.id} type="button" onClick={() => go(s.id)} data-testid={`kiosk-settings-nav-${s.id}`}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-bold transition-colors ${active ? 'bg-[#FF5C00] text-white' : 'text-slate-700 hover:bg-orange-50 hover:text-[#FF5C00]'}`}>
                  <I className="h-4 w-4 shrink-0" />
                  <span className="truncate">{s.label}</span>
                </button>
              );
            })}
          </div>
          <button type="button" onClick={onBack} data-testid="kiosk-settings-exit"
            className="mt-auto inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-100 text-sm font-bold text-slate-700 hover:bg-slate-200">
            Terug naar kiosk
          </button>
        </aside>
      </div>
    </div>
  );
}
