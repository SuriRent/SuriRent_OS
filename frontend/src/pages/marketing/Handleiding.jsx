import { ArrowRight, BookOpen, CheckCircle2, CircleHelp, ShieldCheck } from 'lucide-react';
import { appLink } from '../../lib/env';

const SECTIONS = [
  ['start', 'Begin hier'],
  ['inrichten', 'Eerste inrichting'],
  ['kiosk', 'Medewerkerskiosk'],
  ['huurdersportaal', 'Huurdersportaal'],
  ['beheer', 'Kiosk Beheer'],
  ['instellingen', 'Instellingen'],
  ['problemen', 'Problemen oplossen'],
];

const ADMIN_MODULES = [
  ['Overzicht', 'Begin hier voor de belangrijkste aantallen en financiële stand. Gebruik het dashboard als dagelijkse controle en open vanuit een melding de bijbehorende beheerpagina.'],
  ['Locaties', 'Maak een locatie aan met een herkenbare naam en voeg optioneel adres en foto toe. Koppel appartementen eraan zodat medewerkers op de kiosk eerst het juiste gebouw kunnen kiezen.'],
  ['Appartementen', 'Maak per verhuureenheid een appartement aan. Vul nummer, huurprijs en valuta in, koppel de locatie en controleer of de gegevens juist zijn voordat je huurders laat betalen. Vanuit een appartement kun je ook een printbare QR-plaat als PDF openen.'],
  ['Huurders', 'Voeg een huurder toe of open een bestaande huurder om contactgegevens en appartementkoppeling te controleren. Vanuit de huurderacties kun je ook portaltoegang beheren; koppel NFC alleen nadat je de kaart/tag aan de juiste huurder hebt toegewezen.'],
  ['Contracten', 'Registreer contractgegevens en koppel de juiste huurder en verhuureenheid. Controleer huurprijs, looptijd en afspraken aan de hand van de overeenkomst die je met de huurder hebt gesloten.'],
  ['Betalingen', 'Zoek betalingen en controleer bedrag, valuta, methode en periode. Gebruik handmatige registratie alleen als de betaling daadwerkelijk is ontvangen. Controleer daarnaast of er betalingen zijn die op goedkeuring wachten.'],
  ['Facturen', 'Bekijk, maak of beheer facturen vanuit de facturenpagina. Controleer huurder, bedrag, periode en vervaldatum; automatische aanmaak en herinneringen stel je apart in bij Facturen automatisering.'],
  ['Betalingsregelingen', 'Leg een afgesproken betaling in termijnen vast en volg de termijnen in deze pagina. Controleer bij ontvangst welke termijn bij de betaling hoort.'],
  ['Borg', 'Bekijk de borgstatus per huurder en registreer borgbetalingen volgens de gemaakte afspraken. Als de borg nog openstaat, kan het systeem huurbetaling blokkeren totdat de borg is voldaan.'],
  ['Onderhoud', 'Registreer een onderhoudspunt bij de juiste woning, houd de voortgang bij en werk de melding bij zodra de klus is opgepakt of afgerond.'],
  ['Kasgeld', 'Gebruik de kaspagina om kasbewegingen bij te houden en controleer de stand met de werkelijke kas. Registreer geen kasontvangst voordat het bedrag is gecontroleerd.'],
  ['Werknemers', 'Maak een account aan, kies de passende rol en stel een persoonlijke kiosk-PIN van vier cijfers in. Geef alleen de benodigde toegang en deel de PIN veilig met de medewerker.'],
  ['Notificaties', 'Controleer meldingen regelmatig op openstaande taken, betalingsstatus en andere aandachtspunten. Open de melding om de bijbehorende informatie te bekijken.'],
  ['Instellingen', 'Beheer bedrijfsgegevens en branding, e-mail, factuurautomatisering, Stripe, bonnen en printers, kiosk-apparaten en backup/herstel. Wijzig alleen de opties die je organisatie gebruikt.'],
];

function StepCard({ number, title, children }) {
  return (
    <article className="flex gap-4 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-sm font-black text-[#E65300]">{number}</span>
      <div className="min-w-0">
        <h3 className="font-black text-[#0B1B3F]">{title}</h3>
        <div className="mt-2 text-sm leading-6 text-slate-600">{children}</div>
      </div>
    </article>
  );
}

function InfoCard({ title, children, tone = 'orange' }) {
  const styles = tone === 'blue'
    ? 'border-blue-200 bg-blue-50 text-blue-950'
    : 'border-orange-200 bg-orange-50 text-[#71310F]';
  return (
    <aside className={`rounded-2xl border p-5 ${styles}`}>
      <h3 className="font-black">{title}</h3>
      <div className="mt-2 text-sm leading-6 opacity-90">{children}</div>
    </aside>
  );
}

export default function Handleiding({ onDemo }) {
  return (
    <main className="bg-[#F8F9FC] text-[#0B1B3F]" data-testid="manual-page">
      <section className="relative isolate overflow-hidden bg-white">
        <div className="absolute -right-32 -top-40 -z-10 h-[520px] w-[520px] rounded-full bg-[#FF5C00]/10 blur-3xl" />
        <div className="mx-auto max-w-[1200px] px-5 py-14 sm:px-8 sm:py-20 lg:px-10 lg:py-24">
          <p className="inline-flex items-center gap-2 rounded-full border border-orange-200 bg-orange-50 px-3.5 py-2 text-xs font-black uppercase tracking-[0.16em] text-[#E65300]">
            <BookOpen className="h-4 w-4" /> SuriRent handleiding
          </p>
          <h1 className="mt-5 max-w-4xl text-4xl font-black leading-[1.05] tracking-[-0.045em] sm:text-5xl lg:text-6xl">
            Van eerste inrichting tot <span className="text-[#FF5C00]">dagelijks kioskgebruik.</span>
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-7 text-slate-600 sm:text-lg sm:leading-8">
            Deze gids legt stap voor stap uit hoe je SuriRent klaarzet, de medewerkerskiosk gebruikt en huurders zelfstandig laat betalen via het huurdersportaal.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <button type="button" onClick={onDemo} data-testid="manual-demo"
              className="inline-flex h-12 items-center gap-2 rounded-xl bg-[#FF5C00] px-5 text-sm font-black text-white transition hover:bg-[#E65300]">
              Bekijk de demo <ArrowRight className="h-4 w-4" />
            </button>
            <a href="#inrichten" className="inline-flex h-12 items-center rounded-xl border border-slate-200 bg-white px-5 text-sm font-bold text-[#0B1B3F] transition hover:border-orange-300">
              Start met inrichten
            </a>
          </div>
          <nav aria-label="Inhoud van de handleiding" className="mt-10 flex flex-wrap gap-2">
            {SECTIONS.map(([id, label]) => (
              <a key={id} href={`#${id}`} className="rounded-full border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-600 transition hover:border-orange-300 hover:text-[#E65300]">
                {label}
              </a>
            ))}
          </nav>
        </div>
      </section>

      <div className="mx-auto max-w-[1200px] space-y-5 px-5 py-10 sm:px-8 sm:py-14 lg:px-10">
        <section id="start" className="scroll-mt-36">
          <div className="mb-5">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#E65300]">Eerst het onderscheid</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Twee manieren om de kiosk te gebruiken.</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <article className="rounded-3xl bg-[#0B1B3F] p-6 text-white sm:p-7">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-[#FF8A3D]">Voor personeel</p>
              <h3 className="mt-2 text-xl font-black">Medewerkerskiosk · /kiosk</h3>
              <p className="mt-3 text-sm leading-6 text-white/75">Een medewerker of beheerder zoekt een locatie, appartement of huurder, bekijkt het financiële overzicht en registreert een ontvangen betaling.</p>
            </article>
            <article className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-7">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-[#E65300]">Voor huurders</p>
              <h3 className="mt-2 text-xl font-black">Huurdersportaal · /kiosk/huurder</h3>
              <p className="mt-3 text-sm leading-6 text-slate-600">Een huurder meldt zich aan met de methode die op het portaal beschikbaar is, controleert het saldo en kan een betaling met bankbewijs ter controle indienen.</p>
            </article>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <InfoCard title="Wie mag beheren?" tone="blue">
              De beheerder heeft toegang tot het beheermenu. Medewerkers zien alleen de onderdelen die bij hun account horen. Deel geen beheer-PIN met huurders.
            </InfoCard>
            <InfoCard title="PIN’s zijn niet hetzelfde">
              De kiosk-login-PIN voor personeel, de persoonlijke inlog-PIN en eventuele portaltoegang voor huurders zijn verschillende gegevens. Deel PIN’s alleen met de bedoelde gebruiker.
            </InfoCard>
          </div>
        </section>

        <section id="inrichten" className="scroll-mt-36 pt-10">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#E65300]">A tot Z · eerste keer</p>
          <h2 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Richt je beheer in deze volgorde in.</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
            Log in met je beheeraccount en gebruik de Setup Wizard als die verschijnt. Je kunt later onderdelen aanpassen via de zijbalk en Instellingen.
            {' '}<a href={appLink('/login?view=admin')} className="font-bold text-[#E65300] underline decoration-orange-300 underline-offset-4">Naar beheerlogin</a>
          </p>
          <div className="mt-6 grid gap-3">
            <StepCard number="01" title="Vul je bedrijfsgegevens in">
              Controleer de bedrijfsnaam, het adres en de contactgegevens. Voeg de juiste bankgegevens toe als die voor je betalingen nodig zijn.
            </StepCard>
            <StepCard number="02" title="Stel je uitstraling in">
              Voeg via <strong>Branding</strong> je logo en kleuren toe zodat je bedrijfsomgeving en communicatie herkenbaar zijn.
            </StepCard>
            <StepCard number="03" title="Maak locaties aan">
              Voeg eerst de gebouwen, complexen of vestigingen toe. Locaties helpen om appartementen te groeperen; je kunt adres en foto toevoegen.
            </StepCard>
            <StepCard number="04" title="Voeg appartementen toe">
              Vul per verhuureenheid het nummer, de huurprijs en de juiste valuta in. Koppel het appartement aan de juiste locatie. Controleer deze gegevens zorgvuldig: ze bepalen wat de kiosk toont.
            </StepCard>
            <StepCard number="05" title="Voeg huurders toe en koppel ze">
              Registreer de huurder met de beschikbare contactgegevens en wijs het juiste appartement toe. Controleer de koppeling voordat je de kiosk in gebruik neemt.
            </StepCard>
            <StepCard number="06" title="Leg afspraken vast">
              Gebruik <strong>Contracten</strong> voor huurafspraken. Registreer borg waar van toepassing; een openstaande borg kan eerst voldaan moeten worden voordat huurbetaling kan doorgaan.
            </StepCard>
            <StepCard number="07" title="Maak medewerkers aan">
              Ga naar <strong>Werknemers</strong>, maak een account aan, kies de passende rol en stel een persoonlijke kiosk-PIN van vier cijfers in. Als je ook e-mail en wachtwoord instelt, gebruikt de medewerker die bij de eerste login; daarna kan die persoon op dat apparaat de PIN gebruiken. Geef de PIN veilig aan de medewerker.
            </StepCard>
            <StepCard number="08" title="Kies je betaal- en ontvangstinstellingen">
              Contante registratie en bankoverschrijving zijn beschikbaar in de medewerkerskiosk. Stel Stripe alleen in als je creditcard/iDEAL wilt aanbieden. Configureer e-mail, factuurautomatisering en printers alleen als je die functies nodig hebt.
            </StepCard>
            <StepCard number="09" title="Open en controleer de kiosk">
              Open <strong>/kiosk</strong> op het toestel dat medewerkers gebruiken. Meld je aan met de juiste PIN en controleer of locaties, appartementen en huurders kloppen. Gebruik de afgesproken browser; als het apparaat dit ondersteunt kun je de app aan het startscherm toevoegen.
            </StepCard>
            <StepCard number="10" title="Test de toegang en eventuele QR/NFC">
              Test de medewerker-PIN op het kiosktoestel. Als je NFC-tags gebruikt, koppel en test elke tag bij de juiste huurder of woning. Voor een printbare QR-plaat open je de QR-plaatoptie bij het appartement, kies je een formaat, download je de PDF en controleer je de afdruk.
            </StepCard>
          </div>
          <div className="mt-4">
            <InfoCard title="Niet alles is verplicht">
              Voor de basis heb je correcte bedrijfsgegevens, minimaal één appartement en een huurder nodig. SMTP, automatische facturen, online kaartbetalingen en bonprinters zijn optionele aanvullingen.
            </InfoCard>
          </div>
        </section>

        <section id="kiosk" className="scroll-mt-36 pt-10">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#E65300]">Voor medewerkers</p>
          <h2 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Een betaling registreren in de kiosk.</h2>
          <div className="mt-6 grid gap-3">
            <StepCard number="01" title="Meld je aan">
              Open <strong>/kiosk</strong> en voer je viercijferige PIN in. De beheerder-PIN en medewerkers-PIN geven verschillende toegangsrechten.
            </StepCard>
            <StepCard number="02" title="Zoek de juiste woning of huurder">
              Kies zo nodig eerst een locatie en daarna het appartement. Gebruik zoeken of een gekoppelde NFC-tag als dat op jouw apparaat is ingericht.
            </StepCard>
            <StepCard number="03" title="Controleer het financiële overzicht">
              Controleer de naam van de huurder, het appartement, het openstaande saldo en de relevante factuurperiode. Klopt de informatie niet, registreer dan nog geen betaling en vraag de beheerder om de gegevens te controleren.
            </StepCard>
            <StepCard number="04" title="Kies het te betalen bedrag">
              Tik op <strong>Betalen</strong>, selecteer de openstaande factuur of termijn en controleer bedrag en omschrijving. Controleer extra goed bij een deelbetaling of vooruitbetaling.
            </StepCard>
            <StepCard number="05" title="Kies de betaalmethode">
              Kies de methode die overeenkomt met de betaling die je daadwerkelijk hebt ontvangen. Creditcard/iDEAL verschijnt alleen als de online betaalintegratie is ingesteld.
            </StepCard>
            <StepCard number="06" title="Bevestig en geef de kwitantie">
              Controleer huurder, appartement, bedrag en betaalmethode nogmaals en bevestig. De kiosk toont daarna de kwitantie en het resterende saldo. Print of deel de kwitantie als de beschikbare opties en printer dat ondersteunen.
            </StepCard>
            <StepCard number="07" title="Rond af voor de volgende huurder">
              Kies <strong>Volgende huurder</strong> of wacht tot het scherm terugkeert. Op de kiosk kun je met de thema-knop wisselen tussen de witte en oranje weergave. Gebruik <strong>Uit</strong> om de kiosksessie op een gedeeld toestel veilig af te sluiten.
            </StepCard>
          </div>
        </section>

        <section id="huurdersportaal" className="scroll-mt-36 pt-10">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#E65300]">Voor huurders</p>
          <h2 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Een betaling aanmelden via het huurdersportaal.</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">Het huurdersportaal is een andere omgeving dan de medewerkerskiosk. De beschikbare betaal- en aanmeldopties kunnen afhangen van de bedrijfsinrichting.</p>
          <div className="mt-6 grid gap-3">
            <StepCard number="01" title="Open het huurdersportaal">
              Ga naar <strong>/kiosk/huurder</strong> of open de link die de verhuurder heeft verstrekt. Meld je aan met de methode die op het scherm wordt getoond. Als NFC wordt gevraagd, gebruik dan de aan jou gekoppelde kaart/tag of volg de instructie van je verhuurder.
            </StepCard>
            <StepCard number="02" title="Controleer je saldo">
              Controleer in het financiële overzicht je naam, appartement, openstaande posten en factuurperiode. Neem bij onjuiste gegevens contact op met de beheerder voordat je betaalt.
            </StepCard>
            <StepCard number="03" title="Selecteer wat je wilt betalen">
              Kies de factuur of termijn die je wilt voldoen en controleer het bedrag en de periode voordat je verdergaat.
            </StepCard>
            <StepCard number="04" title="Maak de bankoverschrijving">
              Volg de getoonde betaalinstructies en kies de juiste bank/land-optie. Gebruik de gegevens op het scherm en bewaar je betalingsbewijs.
            </StepCard>
            <StepCard number="05" title="Upload het betalingsbewijs">
              Voeg het gevraagde bewijs toe (PDF, JPG of PNG; maximaal 5 MB) en controleer de samenvatting. Verstuur de betaling ter controle.
            </StepCard>
            <StepCard number="06" title="Bewaar de bevestiging">
              Wacht op de bevestiging in het portaal. Een aangemelde betaling is niet altijd meteen als definitief verwerkt zichtbaar; controle en verwerking kunnen nodig zijn. Je kunt eerdere betalingen terugvinden in de betalingsgeschiedenis.
            </StepCard>
          </div>
          <div className="mt-4">
            <InfoCard title="Aanmelden kan per portaal verschillen" tone="blue">
              Beheer kan portaltoegang voor een huurder instellen, maar het portaal kan ook om een NFC-tag vragen. Volg de aanmeldmethode die daadwerkelijk op het scherm staat en vraag de beheerder om hulp als die niet werkt.
            </InfoCard>
          </div>
        </section>

        <section id="beheer" className="scroll-mt-36 pt-10">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#E65300]">Voor beheerders</p>
          <h2 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Kiosk Beheer: wat vind je waar?</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">Open Beheer vanuit het dashboard of het beheermenu in de kiosk. De beschikbare pagina’s hangen af van je rol; een boekhouder heeft bijvoorbeeld minder menu’s dan een beheerder.</p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {ADMIN_MODULES.map(([title, description], index) => (
              <article key={title} className="flex gap-3 rounded-2xl border border-slate-200 bg-white p-5" data-testid={`manual-admin-module-${index + 1}`}>
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#FF5C00]" />
                <div>
                  <h3 className="font-black text-[#0B1B3F]">{title}</h3>
                  <p className="mt-1.5 text-sm leading-6 text-slate-600">{description}</p>
                </div>
              </article>
            ))}
          </div>
          <div className="mt-4">
            <InfoCard title="Betalingen van medewerkers">
              Controleer regelmatig het onderdeel <strong>Betalingen</strong>, waaronder eventuele betalingen die op goedkeuring wachten. De beschikbare goedkeuringsstappen kunnen afhangen van de gebruikersrol en de manier waarop de betaling is ingediend.
            </InfoCard>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <InfoCard title="Beheerder" tone="blue">
              Voor de volledige inrichting en het beheren van gebruikers en instellingen.
            </InfoCard>
            <InfoCard title="Boekhouder" tone="blue">
              Voor financiële werkzaamheden; niet alle beheer- en instellingsmenu’s zijn beschikbaar.
            </InfoCard>
            <InfoCard title="Kioskmedewerker" tone="blue">
              Voor werkzaamheden aan de balie en betalingen in de kiosk. Geef deze rol geen beheerdersgegevens.
            </InfoCard>
          </div>
        </section>

        <section id="instellingen" className="scroll-mt-36 pt-10">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#E65300]">Optioneel, maar handig</p>
          <h2 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Koppel functies die jouw organisatie nodig heeft.</h2>
          <div className="mt-6 grid gap-3 md:grid-cols-2">
            <StepCard number="01" title="E-mail (SMTP)">
              Configureer SMTP als facturen of kwitanties via je eigen e-mailadres moeten worden verstuurd. Vul de servergegevens in en gebruik <strong>Test verbinding</strong>.
            </StepCard>
            <StepCard number="02" title="Facturen automatisering">
              Schakel dit alleen in als je facturen automatisch wilt laten aanmaken of herinneringen wilt gebruiken. Stel de factuur- en betaaltermijnen zorgvuldig in.
            </StepCard>
            <StepCard number="03" title="Stripe betalingen">
              Configureer Stripe als je huurders online met creditcard of iDEAL wilt laten betalen. Test de integratie voordat je deze betaalmethode aan huurders aanbiedt.
            </StepCard>
            <StepCard number="04" title="Bon en printer">
              Kies het bonformaat en configureer de bonprinter onder Instellingen. Bekijk bij <strong>Kiosk apparaten</strong> of gekoppelde printers online zijn en gebruik de diagnose als dat nodig is.
            </StepCard>
            <StepCard number="05" title="Backup en herstel">
              Gebruik de backupinstellingen voor een veilige kopie en volg de herstelprocedure wanneer je gegevens moet terugzetten.
            </StepCard>
            <StepCard number="06" title="NFC en QR">
              Koppel een NFC-tag aan de juiste huurder of woning voordat je deze in gebruik neemt en test hem op het doelapparaat. Een QR-plaat is een printbare PDF die je vanuit het appartement opent; kies daar het passende formaat en test de afdruk.
            </StepCard>
          </div>
        </section>

        <section id="problemen" className="scroll-mt-36 pt-10">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#E65300]">Snelle hulp</p>
          <h2 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Veelvoorkomende controles.</h2>
          <div className="mt-6 grid gap-3">
            <StepCard number="?" title="Ik zie geen locatie of appartement">
              Controleer of de locatie en verhuureenheid zijn aangemaakt en of het appartement aan de juiste locatie is gekoppeld. Appartementen zonder locatie kunnen onder <strong>Overige</strong> staan.
            </StepCard>
            <StepCard number="?" title="De huurder of het saldo klopt niet">
              Controleer in Beheer de huurder-appartementkoppeling, huurprijs, valuta, contract- en factuurperiode en eventuele borgstatus.
            </StepCard>
            <StepCard number="?" title="De huurder kan niet aanmelden">
              Controleer of de gebruikte kaart/tag aan de juiste huurder is gekoppeld en of het portaal onder de juiste bedrijfslink wordt geopend. Laat de huurder geen beheerder-PIN gebruiken.
            </StepCard>
            <StepCard number="?" title="Een betaling of kwitantie is niet zichtbaar">
              Controleer de betalingsgeschiedenis en Beheer → Betalingen. Kijk of de betaling nog ter controle staat en controleer de verbinding, e-mail- en printerinstellingen indien van toepassing.
            </StepCard>
            <StepCard number="?" title="De printer werkt niet">
              Controleer stroom en netwerk/bluetooth, de geselecteerde printer bij Instellingen en de online-status onder Kiosk apparaten. Probeer daarna opnieuw met een kleine testbon.
            </StepCard>
          </div>
          <div className="mt-4">
            <InfoCard title="Veilig gebruik" tone="blue">
              Houd wachtwoorden en PIN’s privé, controleer bedragen vóór bevestiging en meld je af op gedeelde kiosktoestellen. Upload of deel alleen betalingsbewijzen van de bedoelde betaling.
            </InfoCard>
          </div>
        </section>

        <section className="scroll-mt-36 pt-10">
          <div className="flex flex-col gap-5 rounded-3xl bg-[#0B1B3F] p-7 text-white sm:p-9 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-[#FF8A3D]"><CircleHelp className="h-4 w-4" /> Hulp nodig?</p>
              <h2 className="mt-2 text-2xl font-black sm:text-3xl">Kom je er niet uit?</h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-white/70">Neem contact op met je SuriRent-beheerder of stuur ons een bericht voor hulp met de inrichting.</p>
            </div>
            <a href="/contact" className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#FF5C00] px-5 text-sm font-black text-white transition hover:bg-[#E65300]">
              Contact opnemen <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </section>
      </div>
      <div className="mx-auto max-w-[1200px] px-5 pb-10 sm:px-8 lg:px-10">
        <p className="flex items-start gap-2 text-xs leading-5 text-slate-500">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          De exacte opties kunnen verschillen per accountrol, abonnement, ingestelde betaalmethoden en aangesloten apparaten. Volg altijd de actuele instructies op het scherm.
        </p>
      </div>
    </main>
  );
}
