import { useEffect, useState } from 'react';
import { RENDER } from './InstellingenHub';
import { INSTELLINGEN_SECTIONS } from './instellingenSections';

// Vaste Instellingen-pagina voor de desktop kiosk: links de inhoud, rechts alle
// onderdelen. Wisselen gebeurt lokaal (geen navigatie) en bezochte onderdelen
// blijven gemount, zodat er niets opnieuw laadt of flikkert.
export default function KioskSettingsPage({ id, onBack }) {
  const [sec, setSec] = useState(INSTELLINGEN_SECTIONS.some((s) => s.id === id) ? id : 'abonnement');
  const [visited, setVisited] = useState(() => new Set([sec]));
  useEffect(() => {
    if (INSTELLINGEN_SECTIONS.some((s) => s.id === id)) setSec(id);
  }, [id]);
  useEffect(() => {
    setVisited((v) => (v.has(sec) ? v : new Set(v).add(sec)));
  }, [sec]);
  const current = INSTELLINGEN_SECTIONS.find((s) => s.id === sec);
  const Icon = current.icon;

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
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {INSTELLINGEN_SECTIONS.filter((s) => visited.has(s.id)).map((s) => (
              <div key={s.id} className={s.id === sec ? '' : 'hidden'}>{RENDER[s.id]()}</div>
            ))}
          </div>
        </section>
        <aside className="flex min-h-0 flex-[2] flex-col overflow-y-auto rounded-2xl bg-white p-6" data-testid="kiosk-settings-nav">
          <h2 className="mb-4 text-2xl font-black tracking-tight text-slate-900">Instellingen</h2>
          <div className="space-y-1">
            {INSTELLINGEN_SECTIONS.map((s) => {
              const I = s.icon;
              const active = s.id === sec;
              return (
                <button key={s.id} type="button" onClick={() => setSec(s.id)} data-testid={`kiosk-settings-nav-${s.id}`}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-bold transition-colors ${active ? 'bg-[#FF5C00] text-white' : 'text-slate-700 hover:bg-orange-50 hover:text-[#FF5C00]'}`}>
                  <I className="h-4 w-4 shrink-0" />
                  <span className="truncate">{s.label}</span>
                </button>
              );
            })}
          </div>
          <button type="button" onClick={onBack} data-testid="kiosk-settings-exit"
            className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-100 text-sm font-bold text-slate-700 hover:bg-slate-200">
            Terug naar kiosk
          </button>
        </aside>
      </div>
    </div>
  );
}
