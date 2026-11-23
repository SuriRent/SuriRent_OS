import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Bell, Building2, ChevronRight, Search } from 'lucide-react';
import { useAuth } from '../../../lib/auth';
import { RENDER } from './InstellingenHub';
import { availableInstellingenSections } from './instellingenSections';

// Full-screen instellingenvenster voor desktop; bezochte onderdelen blijven
// gemount zodat secties wisselen zonder opnieuw laden of flikkeren.
export default function KioskSettingsPage({ id, onBack, user }) {
  const { activeCompany } = useAuth();
  const sections = useMemo(
    () => availableInstellingenSections(activeCompany?.limits),
    [activeCompany?.limits],
  );
  const [sec, setSec] = useState(sections.some((s) => s.id === id) ? id : 'abonnement');
  const [visited, setVisited] = useState(() => new Set([sec]));
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (sections.some((s) => s.id === id)) setSec(id);
    else if (!sections.some((s) => s.id === sec)) setSec('abonnement');
  }, [id, sections, sec]);
  useEffect(() => {
    setVisited((v) => (v.has(sec) ? v : new Set(v).add(sec)));
  }, [sec]);
  const current = sections.find((s) => s.id === sec) || sections[0];
  const Icon = current.icon;
  const filteredSections = sections.filter((section) => (
    `${section.label} ${section.desc}`.toLowerCase().includes(query.trim().toLowerCase())
  ));
  const userName = user?.name || user?.email || 'Gebruiker';
  const initials = userName.split(/\s+/).filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'G';
  const roleLabels = { admin: 'Beheerder', superadmin: 'Superbeheerder', employee: 'Medewerker' };
  const userRole = roleLabels[user?.role] || 'Gebruiker';
  const contentHasHeading = ['bedrijf', 'branding', 'bon', 'backup'].includes(current.id);
  const selectSection = (sectionId) => {
    setSec(sectionId);
    setQuery('');
  };

  return createPortal(
    <div className="fixed inset-0 z-[400] flex flex-col bg-[#F4F6F9]" data-testid="kiosk-settings-panel"
      role="dialog" aria-modal="true" aria-label="Instellingen">
      <header className="flex h-[72px] shrink-0 items-center bg-[#162B45] text-white shadow-sm">
        <div className="flex h-full w-[230px] shrink-0 items-center gap-3 px-5 sm:w-[280px] sm:px-7">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#FF5C00] text-white shadow-sm">
            <Building2 className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-black tracking-tight">SuriRent</h1>
            <p className="truncate text-[11px] font-medium text-slate-300">Kioskbeheer</p>
          </div>
        </div>
        <div className="flex min-w-0 flex-1 items-center px-3 sm:px-6">
          <label className="flex h-10 w-full max-w-[620px] items-center gap-3 rounded-lg border border-white/10 bg-white/10 px-3.5 text-slate-300 transition focus-within:border-white/30 focus-within:bg-white/15">
            <Search className="h-4 w-4 shrink-0" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && filteredSections[0]) selectSection(filteredSections[0].id);
              }}
              placeholder="Zoek in instellingen..."
              aria-label="Zoek in instellingen"
              data-testid="kiosk-settings-search"
              className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-300"
            />
            <kbd className="hidden rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-slate-300 sm:block">Enter</kbd>
          </label>
        </div>
        <div className="flex shrink-0 items-center gap-3 px-3 sm:gap-5 sm:px-6">
          <button type="button" onClick={() => selectSection('notificaties')}
            aria-label="Notificatie-instellingen openen" title="Notificatie-instellingen"
            className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-200 transition hover:bg-white/10 hover:text-white">
            <Bell className="h-5 w-5" />
          </button>
          <span className="hidden h-8 w-px bg-white/15 sm:block" aria-hidden="true" />
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#FF5C00] text-xs font-black text-white">
              {initials}
            </span>
            <div className="hidden min-w-0 md:block">
              <p className="max-w-40 truncate text-sm font-bold text-white">{userName}</p>
              <p className="text-[11px] text-slate-300">{userRole}</p>
            </div>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[230px] shrink-0 flex-col border-r border-slate-200 bg-white sm:w-[280px]"
          data-testid="kiosk-settings-nav">
          <div className="px-4 pb-4 pt-5 sm:px-6">
            <button type="button" onClick={onBack} data-testid="kiosk-settings-exit"
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-[#162B45]">
              <ArrowLeft className="h-4 w-4 shrink-0" /> Terug naar kiosk
            </button>
          </div>
          <div className="px-6 pb-2 pt-3">
            <h2 className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-slate-400">Instellingen</h2>
          </div>
          <nav aria-label="Instellingen" className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-5 sm:px-4">
            {filteredSections.map((s) => {
              const I = s.icon;
              const active = s.id === sec;
              return (
                <button key={s.id} type="button" onClick={() => selectSection(s.id)} data-testid={`kiosk-settings-nav-${s.id}`}
                  aria-current={active ? 'page' : undefined}
                  className={`flex w-full items-center gap-3 rounded-lg border-l-[3px] px-3 py-2.5 text-left text-sm transition-colors ${
                    active
                      ? 'border-[#FF5C00] bg-[#F1F5F9] font-bold text-[#162B45]'
                      : 'border-transparent font-medium text-slate-600 hover:bg-slate-50 hover:text-[#162B45]'
                  }`}>
                  <I className={`h-[17px] w-[17px] shrink-0 ${active ? 'text-[#FF5C00]' : 'text-slate-400'}`} />
                  <span className="truncate">{s.label}</span>
                </button>
              );
            })}
            {filteredSections.length === 0 && (
              <p className="px-3 py-5 text-sm text-slate-500">Geen instellingen gevonden.</p>
            )}
          </nav>
        </aside>

        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-[#F4F6F9] px-5 py-6 sm:px-8 lg:px-10"
          data-testid={`kiosk-settings-${current.id}`}>
          <div className="mx-auto max-w-[1400px]">
            <nav aria-label="Kruimelpad" className="flex items-center gap-2 text-sm text-slate-500">
              <span>Instellingen</span>
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
              <span className="font-semibold text-slate-700">{current.label}</span>
            </nav>
            {!contentHasHeading && (
              <div className="mb-7 mt-5 border-b border-slate-200 pb-5">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-[#162B45] shadow-sm ring-1 ring-slate-200">
                    <Icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="truncate text-2xl font-extrabold tracking-tight text-[#162B45]">{current.label}</h2>
                    <p className="mt-1 text-sm text-slate-500">{current.desc}</p>
                  </div>
                </div>
              </div>
            )}
            {sections.filter((s) => visited.has(s.id)).map((s) => (
              <div key={s.id} className={s.id === sec ? '' : 'hidden'}>{RENDER[s.id]()}</div>
            ))}
          </div>
        </main>
      </div>
    </div>,
    document.body,
  );
}
