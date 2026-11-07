import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, X } from 'lucide-react';
import { useWhitePageBehindModal } from '../lib/ios-status-bar';

const SECTIONS = [
  {
    id: 'start',
    title: '1. Beginnen en veilig werken',
    steps: [
      ['Kies de juiste omgeving', 'De medewerkerskiosk is voor het dagelijkse werk aan de balie. Kiosk Beheer is voor de administratie en instellingen. Het huurdersportaal is voor huurders zelf. Gebruik nooit de inloggegevens van een andere rol.'],
      ['Meld je aan met je eigen toegang', 'Open de kiosk en gebruik de PIN of aanmeldmethode die voor jouw account is ingesteld. Deel je PIN niet. Gebruik Uitloggen zodra je klaar bent op een gedeeld apparaat.'],
      ['Controleer de verbinding', 'De kiosk heeft internet nodig om actuele huurders-, factuur- en betaalgegevens op te halen. Bij een foutmelding: controleer wifi/internet en probeer opnieuw voordat je gegevens invoert.'],
      ['Bescherm persoonsgegevens', 'Laat geen huurdergegevens zichtbaar achter voor de volgende bezoeker. Maak geen foto of kopie van identiteitsgegevens buiten de daarvoor bedoelde functies en volg het privacybeleid van je organisatie.'],
    ],
  },
  {
    id: 'setup',
    title: '2. Eerste inrichting in Kiosk Beheer',
    steps: [
      ['Vul de bedrijfsgegevens in', 'Open Instellingen en controleer bedrijfsnaam, adres en minimaal één contactgegeven. Deze informatie kan op facturen, bonnen en berichten worden getoond.'],
      ['Maak een locatie aan', 'Voeg een herkenbaar gebouw, complex of vestiging toe. Vul het adres in zodat medewerkers de juiste groep appartementen kunnen kiezen.'],
      ['Voeg appartementen toe', 'Vul per woning het appartementnummer, de huurprijs, valuta en locatie in. Controleer het bedrag en de koppeling voordat je opslaat.'],
      ['Stel borg in', 'Ga naar Instellingen → Borg of gebruik de stap Borg instellingen in de setupwizard. Kies het aantal maanden huur als standaardbedrag. De borg kan bij registratie waar nodig worden aangepast.'],
      ['Voeg huurders toe en koppel ze', 'Maak de huurder aan of open een bestaande huurder en koppel die aan het juiste appartement. Controleer naam, telefoon, e-mail en de woningkoppeling.'],
      ['Leg contractgegevens vast', 'Koppel het contract aan de juiste huurder en woning. Controleer huurprijs, ingangsdatum, einddatum en afspraken aan de hand van de ondertekende overeenkomst.'],
      ['Stel facturen in', 'Bij Facturen automatisering configureer je of facturen automatisch worden aangemaakt en wanneer de betaaltermijn verloopt. Controleer de periode- en datuminstellingen voordat automatisering wordt ingeschakeld.'],
      ['Stel e-mail en bonprinter in', 'Vul SMTP-gegevens alleen in als je e-mail vanuit het systeem wilt versturen en test de verbinding. Configureer bonformaat en printer en maak een testafdruk voordat je de kiosk in gebruik neemt.'],
      ['Maak medewerkersaccounts aan', 'Open Werknemers, voeg medewerkers toe en wijs alleen de benodigde rol toe. Stel persoonlijke toegang in en deel die veilig. Beheerdersrechten zijn alleen voor mensen die instellingen en administratie moeten beheren.'],
    ],
  },
  {
    id: 'daily',
    title: '3. Een betaling ontvangen in de medewerkerskiosk',
    steps: [
      ['Open de juiste huurder of woning', 'Kies indien gevraagd eerst de locatie en daarna het appartement. Je kunt ook zoeken of een gekoppelde NFC-tag gebruiken als dat op het apparaat is ingesteld.'],
      ['Controleer de identiteit en koppeling', 'Vergelijk de naam van de huurder met het appartement. Als de woning leeg lijkt, een andere huurder toont of de gegevens niet kloppen, stop dan en vraag Kiosk Beheer om de koppeling te controleren.'],
      ['Bekijk het betaaloverzicht', 'Controleer openstaande maanden, facturen, termijnen en het saldo. Let op de periode: een betaling voor de ene maand mag niet per ongeluk aan een andere maand worden gekoppeld.'],
      ['Kies wat de huurder betaalt', 'Tik op Betalen en selecteer de bedoelde openstaande factuur of termijn. Controleer de periode, het openstaande bedrag en de valuta.'],
      ['Verwerk een deelbetaling zorgvuldig', 'Voer alleen het bedrag in dat daadwerkelijk is ontvangen. Controleer dat de betaling als deelbetaling wordt geregistreerd en dat het resterende saldo zichtbaar blijft.'],
      ['Verwerk een vooruitbetaling zorgvuldig', 'Kies vooruitbetaling alleen als het geld bedoeld is voor een toekomstige huurperiode. Controleer de beoogde periode en volg in Beheer of het krediet later correct wordt verrekend.'],
      ['Kies de juiste betaalmethode', 'Selecteer de methode die overeenkomt met de ontvangst: bijvoorbeeld contant, bankbetaling of een beschikbare online betaalmethode. Bied geen online methode aan als die niet is ingericht.'],
      ['Controleer vóór bevestigen', 'Lees huurder, appartement, periode, bedrag, valuta en betaalmethode nog één keer na. Bevestig pas nadat het ontvangen bedrag is gecontroleerd.'],
      ['Geef de bon aan de huurder', 'Na succesvolle registratie verschijnt de betaalbevestiging. Toon of print de bon. Als je een bon deelt via WhatsApp, gebruik de deelknop; bij ondersteuning wordt de JPG als bestand gedeeld.'],
      ['Rond de sessie af', 'Kies Volgende huurder of keer terug naar het startscherm. Controleer dat er geen betaling- of huurdergegevens van de vorige bezoeker open blijven staan.'],
    ],
  },
  {
    id: 'admin',
    title: '4. Kiosk Beheer: dagelijkse administratie',
    steps: [
      ['Overzicht', 'Gebruik het dashboard om snel de belangrijkste aantallen en aandachtspunten te bekijken. Open een melding of module voor details; beschouw een dashboardtotaal niet als vervanging voor controle van individuele boekingen.'],
      ['Locaties en appartementen', 'Gebruik Locaties om gebouwen te beheren en Appartementen om woningnummers, huur, valuta en bezetting te controleren. Pas wijzigingen direct aan als een woning verhuist of van huurprijs verandert.'],
      ['Huurders', 'Controleer contactgegevens, toegewezen appartement en dossier. Werk wijzigingen bij in het huurderprofiel zodat berichten en betalingen bij de juiste persoon terechtkomen.'],
      ['Betalingen', 'Zoek de betaling en controleer status, bedrag, methode, huurder en periode. Verwerk alleen werkelijk ontvangen betalingen. Controleer betalingen die ter goedkeuring wachten voordat je ze definitief goedkeurt.'],
      ['Facturen', 'Controleer factuurnummer, huurder, woning, periode, totaal, betaald bedrag en resterend bedrag. Openstaande facturen blijven facturen; gebruik de JPG-bon om ze via WhatsApp te delen en controleer de factuurgegevens vóór verzending.'],
      ['Betalingsregelingen', 'Leg alleen een regeling vast die met de huurder is afgesproken. Controleer termijnbedragen en vervaldata en werk de regeling bij als de afspraak verandert.'],
      ['Borg', 'Registreer borgontvangst bij de juiste huurder en controleer bedrag en valuta. Bij vertrek controleer je openstaande huur, inhoudingen en terugbetaling volgens de gemaakte afspraken.'],
      ['Kasgeld', 'Registreer kasontvangsten en uitgaven met een duidelijke omschrijving en categorie. Vergelijk de geregistreerde stand regelmatig met de werkelijke kas.'],
      ['Onderhoud', 'Registreer het probleem bij het juiste appartement, beschrijf wat er aan de hand is en werk status, verantwoordelijke en kosten bij totdat het werk is afgerond.'],
      ['Notificaties', 'Controleer meldingen regelmatig. Open de gerelateerde module om de onderliggende betaling, factuur of taak te bekijken en handel op basis van de actuele gegevens.'],
    ],
  },
  {
    id: 'sharing',
    title: '5. Bonnen, facturen en delen',
    steps: [
      ['Bon als JPG delen', 'Gebruik de deelknop bij de bon. Op telefoons die bestandsdeling ondersteunen kun je WhatsApp kiezen en de JPG als bijlage versturen. Volg het deelvenster en controleer de ontvanger voordat je verstuurt.'],
      ['Als bestandsdeling niet wordt aangeboden', 'De kiosk downloadt de JPG en opent de chat met de huurder. Voeg de gedownloade afbeelding in WhatsApp handmatig als bijlage toe en controleer dat de juiste bon is gekozen. De WhatsApp-link zelf verstuurt geen afbeelding.'],
      ['Openstaande factuur delen', 'De openstaande factuur heeft een eigen bonafbeelding. Controleer huurder, periode en resterend bedrag en voeg de JPG-bon in WhatsApp toe. Een PDF kan beschikbaar blijven als documentweergave; gebruik die niet als vervanging van de JPG wanneer om de bon wordt gevraagd.'],
      ['E-mail versturen', 'Controleer het e-mailadres en de berichttekst voordat je verstuurt. Bij een verzendfout controleer je het adres en SMTP-status in Instellingen; meld de fout aan de beheerder als je geen toegang tot die instellingen hebt.'],
      ['Printer werkt niet', 'Controleer eerst of de printer aan staat, papier heeft en verbonden is. Controleer daarna printerselectie en apparaatstatus bij Instellingen/Kiosk apparaten. Probeer opnieuw nadat de verbinding is hersteld.'],
    ],
  },
  {
    id: 'tenant',
    title: '6. Huurdersportaal en huurdershulp',
    steps: [
      ['Gebruik het juiste portaal', 'Het huurdersportaal is een andere omgeving dan Kiosk Beheer en de medewerkerskiosk. Geef huurders alleen hun eigen portaaladres en inlogmethode.'],
      ['Controleer saldo vóór betaling', 'Help de huurder zo nodig de juiste woning, openstaande factuur en periode te controleren. Bij onjuiste gegevens laat je de huurder niet betalen totdat Beheer de gegevens heeft nagekeken.'],
      ['Bewijs van bankbetaling indienen', 'De huurder kan in het portaal een betaling melden en een bewijs uploaden als die functie beschikbaar is. Een melding is niet altijd direct definitief verwerkt; Beheer controleert en verwerkt de betaling.'],
      ['Onderhoud melden', 'Laat de huurder de woning en het probleem duidelijk beschrijven en zo nodig een foto toevoegen. Controleer daarna de melding in Onderhoud en houd de voortgang bij.'],
    ],
  },
  {
    id: 'troubleshoot',
    title: '7. Problemen oplossen en afsluiten',
    steps: [
      ['Betaling staat niet in de geschiedenis', 'Controleer eerst of de bevestiging is getoond en of internet werkte. Dien dezelfde betaling niet meteen opnieuw in; zoek in Betalingen om dubbele registratie te voorkomen.'],
      ['Saldo of factuur lijkt niet te kloppen', 'Controleer periode, bedrag, valuta, deelbetalingen, factuurkoppeling en status. Noteer het factuurnummer en laat een beheerder de toewijzingen controleren; pas bedragen niet op goed geluk aan.'],
      ['Bon of factuur geeft een fout', 'Controleer de internetverbinding en probeer één keer opnieuw. Noteer het factuurnummer, huurder en de foutmelding voor de beheerder. Gebruik geen link als vervanging voor een JPG-bijlage als de ontvanger de bon als afbeelding nodig heeft.'],
      ['Scherm loopt vast of PDF sluit de kiosk niet', 'Gebruik de terugknop in de viewer of sluit de viewer met de zichtbare knop. Keer daarna terug naar de kiosk. Als dat niet lukt, laad de kiosk opnieuw en meld het aan Beheer; registreer geen betaling opnieuw voordat de geschiedenis is gecontroleerd.'],
      ['NFC of ID-scan werkt niet', 'Controleer of NFC aan staat en de tag aan de juiste huurder of woning gekoppeld is. Geef de browser/camera toestemming voor ID-scan. Voer de gegevens handmatig in als alternatief en sla pas op na controle.'],
      ['Kiosk afsluiten', 'Gebruik Uit op een gedeeld apparaat om de sessie veilig af te sluiten. Laat de kiosk niet ingelogd achter en bewaar PINs niet op papier naast het apparaat.'],
      ['Wanneer escaleer je naar Beheer?', 'Escaleren bij verkeerde huurder/woning, dubbele of ontbrekende betaling, onbekende status, foutieve factuurbedragen, printer- of deelproblemen die blijven terugkomen en iedere vermoedelijke privacy- of beveiligingsfout.'],
    ],
  },
];

export default function KioskManual({ onClose }) {
  useWhitePageBehindModal(767);
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return createPortal((
    <div className="fixed inset-0 z-[150] flex items-stretch justify-center bg-[#F7F8FA] md:items-center md:p-6 md:bg-[#0B1B3F]/60 md:backdrop-blur-sm"
      data-testid="kiosk-manual-overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="kiosk-manual-title"
        className="flex h-full w-full max-w-5xl flex-col overflow-hidden bg-[#F7F8FA] md:h-auto md:max-h-[96dvh] md:rounded-3xl md:shadow-2xl">
        <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 pb-3 sm:px-6"
          style={{ paddingTop: 'max(var(--kiosk-sat), 12px)' }}>
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-100 text-[#FF5C00]">
              <BookOpen className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-[#C74600]">SuriRent · Kiosk</p>
              <h2 id="kiosk-manual-title" className="text-lg font-black text-[#0B1B3F]">Complete handleiding A tot Z</h2>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Handleiding sluiten" data-testid="kiosk-manual-close"
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-600 hover:bg-orange-100 hover:text-[#C74600]">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
          <p className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-950">
            Deze handleiding is bedoeld voor kioskmedewerkers en beheerders. Volg bij betalingen altijd de gegevens op het scherm en de afspraken van je organisatie. Controleer bij twijfel eerst; registreer of verstuur niets op basis van een aanname.
          </p>
          <nav aria-label="Inhoud handleiding" className="flex gap-2 overflow-x-auto pb-1">
            {SECTIONS.map((section) => (
              <a key={section.id} href={`#kiosk-manual-${section.id}`}
                className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:border-orange-300 hover:text-[#C74600]">
                {section.title}
              </a>
            ))}
          </nav>
          {SECTIONS.map((section) => (
            <section id={`kiosk-manual-${section.id}`} key={section.id} className="scroll-mt-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
              <h3 className="text-lg font-black text-[#0B1B3F]">{section.title}</h3>
              <ol className="mt-4 space-y-3">
                {section.steps.map(([title, detail], index) => (
                  <li key={title} className="flex gap-3 rounded-xl bg-slate-50 p-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-orange-100 text-xs font-black text-[#C74600]">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <div>
                      <h4 className="text-sm font-black text-slate-900">{title}</h4>
                      <p className="mt-1 text-sm leading-6 text-slate-600">{detail}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
        <footer className="shrink-0 border-t border-slate-200 bg-white px-4 py-3 text-right sm:px-6">
          <button type="button" onClick={onClose} data-testid="kiosk-manual-done"
            className="h-11 rounded-xl bg-[#FF5C00] px-5 text-sm font-black text-white hover:bg-[#E65300]">
            Terug naar de kiosk
          </button>
        </footer>
      </section>
    </div>
  ), document.body);
}
