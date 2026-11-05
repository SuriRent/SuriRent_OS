import { useEffect, useState } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, Check, Loader2, MousePointer2, Sparkles, X } from 'lucide-react';

const TOUR_STEPS = [
  {
    title: 'Mijn abonnement',
    description: 'Bekijk je huidige plan, betaalgegevens en abonnementsfacturen. Kies hier een ander plan als je wilt uitbreiden.',
    route: { type: 'settings', id: 'abonnement' },
    target: 'kiosk-popup-inst-abonnement-title',
  },
  {
    title: 'Bedrijfsgegevens',
    description: 'Werk hier de bedrijfsnaam, het adres en de contactgegevens bij. Deze gegevens worden onder andere op documenten gebruikt.',
    route: { type: 'settings', id: 'bedrijf' },
    target: 'kiosk-popup-inst-bedrijf-title',
  },
  {
    title: 'Branding',
    description: 'Voeg je logo toe en pas de uitstraling van je klantportaal aan, zodat huurders je bedrijf herkennen.',
    route: { type: 'settings', id: 'branding' },
    target: 'kiosk-popup-inst-branding-title',
  },
  {
    title: 'E-mail (SMTP)',
    description: 'Vul de e-mailserver van je bedrijf in en sla de instellingen op. Gebruik daarna Test verbinding om te controleren of e-mail werkt.',
    route: { type: 'settings', id: 'smtp' },
    target: 'kiosk-popup-inst-smtp-title',
  },
  {
    title: 'Facturen automatisering',
    description: 'Bepaal of maandfacturen automatisch worden aangemaakt en stel in wanneer ze gegenereerd en betaald moeten worden.',
    route: { type: 'settings', id: 'invoicing' },
    target: 'kiosk-popup-inst-invoicing-title',
  },
  {
    title: 'Bon & afdrukken',
    description: 'Kies het papierformaat en de lettergrootte voor kwitanties. Sla de wijzigingen op om ze bij het afdrukken te gebruiken.',
    route: { type: 'settings', id: 'bon' },
    target: 'kiosk-popup-inst-bon-title',
  },
  {
    title: 'Bon printer',
    description: 'Koppel of selecteer een printer voor kwitanties. De beschikbare verbindingsmethode hangt af van je apparaat.',
    route: { type: 'settings', id: 'bon-printer' },
    target: 'kiosk-popup-inst-bon-printer-title',
  },
  {
    title: 'Kiosk apparaten',
    description: 'Beheer de printerhardware die voor je kiosks beschikbaar is en controleer de verbinding van een apparaat.',
    route: { type: 'settings', id: 'kiosk-apparaten' },
    target: 'kiosk-popup-inst-kiosk-apparaten-title',
  },
  {
    title: 'Backup & herstel',
    description: 'Maak een reservekopie van je gegevens en gebruik herstel alleen wanneer je bewust een eerdere back-up wilt terugzetten.',
    route: { type: 'settings', id: 'backup' },
    target: 'kiosk-popup-inst-backup-title',
  },
  {
    title: 'Beheer',
    description: 'In dit menu open je alle beheeronderdelen. Na de rondleiding kun je hem hier opnieuw starten.',
    route: { type: 'admin-menu' },
    target: 'kiosk-admin-menu-title',
  },
  {
    title: 'Snelle toevoeging onderaan',
    description: 'De onderste balk geeft snelle acties. Op een telefoon tik je op de grote plus; op een computer staan de acties direct in de balk. De tour wijst hier de plus of de balk aan.',
    route: { type: 'home' },
    target: { desktop: 'kiosk-bottom-bar', mobile: 'kiosk-mobile-bottom-bar', smallMobile: 'kiosk-mobile-fab' },
  },
  {
    title: 'Snel toevoegen openen',
    description: 'Tik op de plus om het menu Snel toevoegen te openen. Hier staan veelgebruikte acties bij elkaar, zodat je niet eerst een beheerscherm hoeft op te zoeken.',
    route: { type: 'quick-sheet' },
    target: 'kiosk-add-sheet-title',
  },
  {
    title: 'Nieuwe huurder via Snel toevoegen',
    description: 'Dit opent het snelle huurdersformulier. Vul minimaal de naam in en koppel zo nodig meteen het appartement. Sla pas op als de gegevens gecontroleerd zijn.',
    route: { type: 'quick-action', key: 'tenant' },
    target: 'add-tenant-name',
  },
  {
    title: 'Nieuw appartement via Snel toevoegen',
    description: 'Vul het huisnummer, de huurprijs en de valuta in. Kies de locatie zodat je het appartement later makkelijk terugvindt.',
    route: { type: 'quick-action', key: 'apartment' },
    target: 'add-apartment-number',
  },
  {
    title: 'Nieuwe locatie via Snel toevoegen',
    description: 'Maak een groep voor appartementen aan. Geef de locatie een herkenbare naam en vul eventueel het adres in.',
    route: { type: 'quick-action', key: 'location' },
    target: 'add-location-name',
  },
  {
    title: 'Nieuw contract via Snel toevoegen',
    description: 'Kies de huurder en het appartement en controleer de startdatum, einddatum en betaalafspraken voordat je opslaat.',
    route: { type: 'quick-action', key: 'contract' },
    target: 'add-contract-tenant',
  },
  {
    title: 'Nieuwe factuur via Snel toevoegen',
    description: 'Gebruik dit formulier om een factuur voor een huurder en periode aan te maken. Controleer de selectie voordat je de factuur opslaat.',
    route: { type: 'quick-action', key: 'invoice' },
    target: 'add-invoice-title',
  },
  {
    title: 'Betalingen inzien via Snel toevoegen',
    description: 'Opent de lijst met recente betalingen. Controleer per regel de huurder, het bedrag en de status.',
    route: { type: 'quick-action', key: 'payments' },
    target: 'payments-viewer-title',
  },
  {
    title: 'Onderhoud via Snel toevoegen',
    description: 'Kies het appartement en beschrijf het probleem. Voeg prioriteit en eventuele kosten toe om de melding vast te leggen.',
    route: { type: 'quick-action', key: 'maintenance' },
    target: 'add-maintenance-title',
  },
  {
    title: 'NFC-tag via Snel toevoegen',
    description: 'Opent het scherm om een NFC-tag aan een huurder of appartement te koppelen. Controleer de gekozen koppeling voordat je opslaat.',
    route: { type: 'quick-action', key: 'nfc' },
    target: 'nfc-link-modal',
  },
  {
    title: 'Kasgeld via Snel toevoegen',
    description: 'Opent kasgeld. Gebruik Nieuwe mutatie om een inkomsten- of uitgavenbedrag, omschrijving en categorie te registreren.',
    route: { type: 'quick-action', key: 'kasgeld' },
    target: 'kasgeld-new-btn',
  },
  {
    title: 'Beheerder via Snel toevoegen',
    description: 'Opent het beheermenu met de beheerpagina’s. Kies daar bijvoorbeeld Locaties, Huurders of Instellingen.',
    route: { type: 'quick-action', key: 'admin' },
    target: 'kiosk-admin-menu',
  },
  {
    title: 'Uitloggen via Snel toevoegen',
    description: 'Deze knop meldt de kioskgebruiker af. De rondleiding voert de actie niet uit, zodat je sessie open blijft.',
    route: { type: 'quick-sheet' },
    target: 'kiosk-tile-exit',
  },
  {
    title: 'Bonnen en printers via Snel toevoegen',
    description: 'In dit blok zie je de bonnenstatus en, afhankelijk van het apparaat, opties voor een printer. Koppelen of scannen start je zelf wanneer je er klaar voor bent.',
    route: { type: 'quick-sheet' },
    target: 'kiosk-sheet-live-actions',
  },
  {
    title: 'Scan ID via Snel toevoegen',
    description: 'Opent de camera om een identiteitsbewijs te scannen en huurdersgegevens over te nemen. De tour start de camera niet automatisch; tik zelf op Scan ID als je toestemming geeft.',
    route: { type: 'quick-sheet' },
    target: 'kiosk-sheet-scan-id',
  },
  {
    title: 'Weergave aanpassen via Snel toevoegen',
    description: 'Met deze knop wissel je tussen de witte en oranje kioskweergave. De knop verandert de weergave direct wanneer je erop tikt.',
    route: { type: 'quick-sheet' },
    target: 'kiosk-sheet-theme-toggle',
  },
  {
    title: 'Locaties',
    description: 'Groepeer je panden per locatie. Maak een locatie aan en vul de naam en het adres in.',
    route: { type: 'page', id: 'locaties' },
    target: 'kiosk-popup-locaties-title',
  },
  {
    title: 'Appartementen',
    description: 'Registreer elke verhuureenheid met huisnummer, huurprijs en locatie. Vanuit de lijst kun je gegevens later aanpassen.',
    route: { type: 'page', id: 'appartementen' },
    target: 'kiosk-popup-appartementen-title',
  },
  {
    title: 'Huurders',
    description: 'Maak een huurder aan of open een bestaand dossier. Koppel de huurder aan het juiste appartement om de huuradministratie te starten.',
    route: { type: 'page', id: 'huurders' },
    target: 'kiosk-popup-huurders-title',
  },
  {
    title: 'Contracten',
    description: 'Bewaar en beheer de huurovereenkomsten. Controleer huurder, appartement, looptijd en ondertekeningsstatus.',
    route: { type: 'page', id: 'contracten' },
    target: 'kiosk-popup-contracten-title',
  },
  {
    title: 'Betalingen',
    description: 'Bekijk ontvangen en openstaande betalingen. Open een betaling voor de details en gebruik de beschikbare acties om deze te verwerken.',
    route: { type: 'page', id: 'betalingen' },
    target: 'kiosk-popup-betalingen-title',
  },
  {
    title: 'Betalingsregelingen',
    description: 'Volg afspraken waarbij een huurder een openstaand bedrag in termijnen betaalt. Bekijk de voortgang en de volgende vervaldatum.',
    route: { type: 'page', id: 'regelingen' },
    target: 'kiosk-payment-plans',
  },
  {
    title: 'Facturen',
    description: 'Bekijk en beheer huur- en andere facturen. Gebruik de zoek- en filtermogelijkheden om een factuur of huurder terug te vinden.',
    route: { type: 'page', id: 'facturen' },
    target: 'invoices-modal-title',
  },
  {
    title: 'Onderhoud',
    description: 'Registreer onderhoudsmeldingen, wijs ze toe en volg de status totdat het werk is afgerond.',
    route: { type: 'page', id: 'onderhoud' },
    target: 'kiosk-popup-onderhoud-title',
  },
  {
    title: 'Werknemers',
    description: 'Voeg teamleden toe en beheer hun toegang. Geef ieder teamlid alleen de rechten die bij de werkzaamheden passen.',
    route: { type: 'page', id: 'werknemers' },
    target: 'kiosk-popup-werknemers-title',
  },
  {
    title: 'Notificaties',
    description: 'Bekijk meldingen over gebeurtenissen in de administratie en open een melding om naar het bijbehorende onderdeel te gaan.',
    route: { type: 'page', id: 'notificaties' },
    target: 'kiosk-popup-notificaties-title',
  },
  {
    title: 'Borg',
    description: 'Volg borgbetalingen en terugbetalingen per huurder. Controleer de status voordat je een borg afrondt.',
    route: { type: 'page', id: 'borg' },
    target: 'kiosk-popup-borg-title',
  },
  {
    title: 'NFC-tag',
    description: 'Koppel een NFC-tag aan een huurder of appartement. Scan de tag en controleer de gegevens voordat je de koppeling opslaat.',
    route: { type: 'nfc' },
    target: 'nfc-link-modal',
  },
  {
    title: 'Kasgeld',
    description: 'Registreer contante inkomsten en uitgaven, kies de categorie en datum en controleer het saldo per valuta.',
    route: { type: 'cash' },
    target: 'kasgeld-new-btn',
  },
  {
    title: 'Zoek huurder',
    description: 'Zoek een huurder op naam of appartement. Selecteer een resultaat om direct het bijbehorende overzicht te openen.',
    route: { type: 'search' },
    target: 'tenant-search-input',
  },
];

function getTargetRect(target) {
  const selector = resolveTarget(target);
  const element = document.querySelector(`[data-testid="${selector}"]`);
  if (!element) return null;
  const { top, right, bottom, left, width, height } = element.getBoundingClientRect();
  if (!width || !height) return null;
  return { top, right, bottom, left, width, height };
}

function resolveTarget(target) {
  if (typeof target === 'string') return target;
  if (window.innerWidth < 390) return target.smallMobile || target.mobile || target.desktop;
  if (window.innerWidth < 768) return target.mobile || target.desktop;
  return target.desktop || target.mobile;
}

export default function KioskFeatureTour({ promptOpen, active, onStart, onSkip, onFinish }) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState(null);
  const [targetUnavailable, setTargetUnavailable] = useState(false);
  const current = TOUR_STEPS[index];

  useEffect(() => {
    if (!active) return undefined;
    const step = TOUR_STEPS[index];
    setRect(null);
    setTargetUnavailable(false);
    window.dispatchEvent(new CustomEvent('kiosk-tour-navigate', { detail: step.route }));

    const updateRect = () => {
      const next = getTargetRect(step.target);
      if (next) setTargetUnavailable(false);
      setRect((currentRect) => {
        if (!next || !currentRect) return next;
        return Object.keys(next).every((key) => next[key] === currentRect[key]) ? currentRect : next;
      });
    };
    updateRect();
    const interval = window.setInterval(updateRect, 250);
    const timeout = window.setTimeout(() => {
      if (!getTargetRect(step.target)) setTargetUnavailable(true);
    }, 5000);
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
    };
  }, [active, index]);

  useEffect(() => {
    if (active) setIndex(0);
    const resetTour = () => setIndex(0);
    window.addEventListener('kiosk-tour-start', resetTour);
    return () => window.removeEventListener('kiosk-tour-start', resetTour);
  }, [active]);

  const startTour = () => {
    setIndex(0);
    onStart();
  };

  if (promptOpen) {
    return (
      <div className="fixed inset-0 z-[300] bg-slate-950/55 flex items-center justify-center p-4" data-testid="kiosk-tour-prompt">
        <div className="w-full max-w-lg rounded-3xl bg-white p-6 sm:p-8 shadow-2xl">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-100 text-[#FF5C00]">
            <Sparkles className="h-7 w-7" />
          </div>
          <h2 className="text-center text-2xl font-black text-slate-900">Rondleiding door Kiosk Beheer</h2>
          <p className="mt-3 text-center text-sm leading-6 text-slate-600">
            Ontdek stap voor stap alle beheerfuncties en waarvoor je ze gebruikt. Je kunt op elk moment doorgaan, teruggaan of de rondleiding overslaan.
          </p>
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button type="button" onClick={startTour} data-testid="kiosk-tour-start"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[#FF5C00] px-4 font-black text-white hover:bg-[#E05200]">
              <Sparkles className="h-4 w-4" /> Rondleiding starten
            </button>
            <button type="button" onClick={onSkip} data-testid="kiosk-tour-skip"
              className="h-12 rounded-xl bg-slate-100 px-4 font-bold text-slate-700 hover:bg-slate-200">
              Overslaan
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!active) return null;

  const moveTo = (nextIndex) => {
    if (nextIndex < 0) return;
    if (nextIndex >= TOUR_STEPS.length) {
      onFinish();
      return;
    }
    setIndex(nextIndex);
  };

  const calloutStyle = rect && rect.top + rect.height / 2 > window.innerHeight * 0.55
    ? { top: 'calc(env(safe-area-inset-top, 0px) + 12px)' }
    : { bottom: 'calc(env(safe-area-inset-bottom, 0px) + 76px)' };
  const pointerLeft = rect && Math.max(8, Math.min(
    rect.right < window.innerWidth - 48 ? rect.right + 4 : rect.left - 44,
    window.innerWidth - 44,
  ));
  const pointerTop = rect && Math.max(8, Math.min(
    rect.top + Math.min(rect.height / 2, 28) - 18,
    window.innerHeight - 44,
  ));

  return (
    <div className="pointer-events-none fixed inset-0 z-[300]" data-testid="kiosk-feature-tour">
      {rect && (
        <div
          aria-hidden="true"
          className="fixed rounded-xl border-2 border-[#FF8A3D] shadow-[0_0_0_9999px_rgba(15,23,42,0.42)] transition-all duration-200"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
          }}
        />
      )}
      {rect && (
        <div aria-hidden="true" className="fixed flex h-9 w-9 items-center justify-center rounded-full bg-[#FF5C00] text-white shadow-lg ring-4 ring-white/90 animate-bounce"
          style={{ left: pointerLeft, top: pointerTop }}>
          <MousePointer2 className="h-5 w-5" />
        </div>
      )}
      <section style={calloutStyle}
        className="pointer-events-auto fixed inset-x-3 mx-auto w-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_16px_50px_-12px_rgba(11,27,63,0.42)] sm:inset-x-auto sm:right-6 sm:w-[min(30rem,calc(100vw-3rem))] sm:p-5"
        role="dialog" aria-modal="false" aria-labelledby="kiosk-tour-title">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-[#C74600]">
              Stap {index + 1} van {TOUR_STEPS.length}
            </p>
            <h2 id="kiosk-tour-title" className="mt-1 text-xl font-black text-slate-900">{current.title}</h2>
          </div>
          <button type="button" onClick={onSkip} data-testid="kiosk-tour-close" aria-label="Rondleiding overslaan"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-2 text-sm leading-6 text-slate-600">{current.description}</p>
        {!rect && (
          <p role={targetUnavailable ? 'alert' : 'status'}
            className={`mt-3 flex items-start gap-2 rounded-xl px-3 py-2 text-xs font-semibold ${targetUnavailable ? 'bg-amber-50 text-amber-800' : 'bg-orange-50 text-[#9A3412]'}`}>
            {targetUnavailable ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />}
            {targetUnavailable
              ? 'Dit onderdeel is niet zichtbaar geworden. Gebruik Terug of Volgende om verder te gaan.'
              : 'Het scherm wordt geopend…'}
          </p>
        )}
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-[#FF5C00] transition-all"
            style={{ width: `${((index + 1) / TOUR_STEPS.length) * 100}%` }} />
        </div>
        <div className="mt-4 flex items-center justify-between gap-2">
          <button type="button" onClick={() => moveTo(index - 1)} disabled={index === 0} data-testid="kiosk-tour-previous"
            className="inline-flex h-10 items-center gap-1 rounded-xl px-3 text-sm font-bold text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40">
            <ArrowLeft className="h-4 w-4" /> Terug
          </button>
          <button type="button" onClick={onSkip} data-testid="kiosk-tour-skip-active"
            className="h-10 rounded-xl px-3 text-sm font-bold text-slate-500 hover:bg-slate-100">
            Overslaan
          </button>
          <button type="button" onClick={() => moveTo(index + 1)} data-testid="kiosk-tour-next"
            className="inline-flex h-10 items-center gap-1 rounded-xl bg-slate-900 px-4 text-sm font-black text-white hover:bg-slate-700">
            {index === TOUR_STEPS.length - 1 ? <><Check className="h-4 w-4" /> Afronden</> : <>Volgende <ArrowRight className="h-4 w-4" /></>}
          </button>
        </div>
      </section>
    </div>
  );
}
