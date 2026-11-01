# SuriRent

**Slim huurbeheer. Meer controle.**

SuriRent is een webapplicatie voor vastgoed- en huurbeheer. De repository bevat een React-frontend, een FastAPI-backend en een MongoDB-database. De applicatie biedt onder meer beheer voor bedrijven, appartementen, huurders, betalingen en facturen, plus een kiosk- en huurdersportaal. De frontend en API worden op hetzelfde domein aangeboden.

## Inhoud

- [Architectuur](#architectuur)
- [Deployen met Coolify](#deployen-met-coolify)
- [Omgevingsvariabelen](#omgevingsvariabelen)
- [Lokale ontwikkeling](#lokale-ontwikkeling)
- [Beheer en onderhoud](#beheer-en-onderhoud)
- [Mappenstructuur](#mappenstructuur)

## Architectuur

De Coolify-deployment gebruikt de services uit `docker-compose.yml`:

| Service | Functie |
| --- | --- |
| `web` | React Single-Page Application, gebouwd met Node.js en geserveerd door Nginx op containerpoort `80`. Zowel het marketingdomein als het app-domein wijzen naar deze service. Nginx routeert `/api/`-verkeer en WebSockets door naar de backend en ondersteunt frontend-routes. |
| `app` | FastAPI-backend op poort `8000`, gestart met één Uvicorn-worker. |
| `database` | MongoDB 7. Data staat in de persistente Docker-volume `mongo_data`. |

Alleen `web` hoeft publiek bereikbaar te zijn. Coolify verzorgt HTTPS en routeert beide domeinen naar containerpoort `80`; de API (`app`) en database blijven intern op het Compose-netwerk. De React-app toont de marketingwebsite op `REACT_APP_MARKETING_HOST` en de inlog-/beheerapp op `REACT_APP_APP_URL`. Nginx geeft `/api/` intern door aan `app`. De backend-healthcheck gebruikt `/api/health`; Nginx geeft die route publiek door als `/api/health`.

## Deployen met Coolify

1. Maak in Coolify een **Docker Compose**-resource aan voor deze repository en gebruik `docker-compose.yml`.
2. Stel de vereiste variabelen uit `.env.example` in via de environment-instellingen van de resource. Gebruik unieke, sterke wachtwoorden en geheimen. Genereer bijvoorbeeld secrets met `openssl rand -hex 32`.
3. Configureer **beide** publieke HTTPS-domeinen op de `web`-service, met containerpoort `80`: het marketingdomein en het app-domein. Verwijder het publieke domein van de `app`-service; die service is alleen de interne API.
4. Stel `APP_PUBLIC_URL` en `APP_PUBLIC_HOST` in op het app-domein. Zet in `CORS_ORIGINS` beide origins, gescheiden door een komma. Stel `REACT_APP_MARKETING_HOST` in op de marketing-hostname zonder schema en `REACT_APP_APP_URL` op de volledige app-URL.
5. Laat `REACT_APP_BACKEND_URL` leeg voor API-verkeer via dezelfde origin. De Nginx-proxy op `web` stuurt `/api/` door naar de interne API. De waarden met `REACT_APP_` worden tijdens de Docker-imagebuild ingebakken; voer na wijziging een nieuwe build/deploy uit.
6. Deploy de resource.

Gebruik voor `MONGO_ROOT_PASSWORD` een hexadecimaal wachtwoord, zodat het veilig in de MongoDB-connection-URI kan worden gebruikt. Houd MongoDB-inloggegevens en encryptiesecrets stabiel voor een bestaande database: veranderen van de MongoDB-wachtwoorden zonder de database mee te werken maakt de verbinding stuk; veranderen van de encryptiesleutel kan opgeslagen integratiegegevens onleesbaar maken.

De backend draait bewust met één worker: achtergrondtaken en PIN-throttling gebruiken proceslokale status. Meerdere workers zouden die status per worker opsplitsen.

### Initiële accounts en bestaande databases

- Bij de eerste start maakt de backend een adminaccount aan met `ADMIN_EMAIL` en `ADMIN_PASSWORD`. Bij volgende starts wordt het wachtwoord van dat account opnieuw gelijkgezet aan `ADMIN_PASSWORD`; houd deze variabele daarom bij als bron van waarheid.
- De superadmin wordt alleen aangemaakt als `SUPERADMIN_EMAIL` nog niet bestaat. Een bestaand account wordt niet automatisch bijgewerkt als de variabelen wijzigen. Wijzig bij gebruik van een bestaande database het eerder standaard aangemaakte superadmin-wachtwoord voordat de deployment publiek bereikbaar wordt.
- De standaard databasenaam is `vastgoed_kiosk`; die naam staat ook in `.env.example`.
- De Compose-configuratie schakelt het opnieuw instellen van de demo-PIN en de periodieke demo-reset uit.

### Omgevingsvariabelen

Vul placeholders met eigen waarden in voordat je deployt. Zet geen productiegeheimen in Git.

| Variabele | Vereist | Doel |
| --- | --- | --- |
| `MONGO_ROOT_USERNAME` | Ja | MongoDB root-gebruikersnaam, gebruikt door de backend-connection-URI. |
| `MONGO_ROOT_PASSWORD` | Ja | MongoDB root-wachtwoord; gebruik hexadecimale tekens. |
| `DB_NAME` | Nee | Databasenaam; standaard `vastgoed_kiosk`. |
| `JWT_SECRET` | Ja | Geheim voor ondertekening van authenticatietokens. |
| `PDF_AES_PASSWORD` | Ja | Geheim voor PDF-beveiliging. |
| `SETTINGS_ENCRYPTION_KEY` | Nee | Sleutel voor encryptie van opgeslagen integratie-instellingen. Leeg gebruikt de backend de JWT-secret als basis. |
| `ADMIN_EMAIL` | Ja | E-mailadres voor het initiële adminaccount. |
| `ADMIN_PASSWORD` | Ja | Wachtwoord van het adminaccount; dit wordt bij elke backendstart toegepast. |
| `SUPERADMIN_EMAIL` | Ja | E-mailadres voor het initiële superadminaccount. |
| `SUPERADMIN_PASSWORD` | Ja | Wachtwoord dat wordt gebruikt wanneer het superadminaccount voor het eerst wordt aangemaakt. |
| `APP_PUBLIC_URL` | Ja | Publieke URL van de app, inclusief `https://`. |
| `APP_PUBLIC_HOST` | Nee | Publieke hostname zonder schema, gebruikt voor host-/domeinfuncties. |
| `CORS_ORIGINS` | Ja | Toegestane frontend-origin(s), zoals `https://rent.example.com`. |
| `REACT_APP_BACKEND_URL` | Nee | Frontend API-origin tijdens de build; leeg gebruikt same-origin `/api`-verkeer. |
| `REACT_APP_MARKETING_HOST` | Ja bij gescheiden domeinen | Marketing-hostname zonder `https://` of afsluitende slash; bepaalt waar de marketingwebsite wordt getoond. |
| `REACT_APP_APP_URL` | Ja bij gescheiden domeinen | Volledige publieke app-URL; marketinglinks naar aanmelden/inloggen verwijzen hiernaartoe. |
| `EMERGENT_LLM_KEY` | Nee | Optionele AI-, spraak- en gerelateerde Emergent-integraties. |
| `INTEGRATION_PROXY_URL` | Nee | Optionele basis-URL voor de object-storage-integratie. |
| `STRIPE_PUBLISHABLE_KEY` | Nee | Optionele Stripe publishable key. |
| `STRIPE_SECRET_KEY` | Nee | Optionele Stripe secret key. |
| `STRIPE_WEBHOOK_SECRET` | Nee | Optioneel Stripe-webhookgeheim. |
| `VAPID_PUBLIC_KEY` | Nee | Optionele publieke sleutel voor webpush. |
| `VAPID_PRIVATE_KEY_B64` | Nee | Optionele base64-gecodeerde VAPID-private key. |
| `VAPID_CONTACT` | Nee | Optioneel contactadres voor webpush, bijvoorbeeld `mailto:admin@example.com`. |
| `PLATFORM_SMTP_HOST` | Nee | SMTP-server voor platformmails. |
| `PLATFORM_SMTP_PORT` | Nee | SMTP-poort; standaard `587`. |
| `PLATFORM_SMTP_USERNAME` | Nee | SMTP-gebruikersnaam. |
| `PLATFORM_SMTP_PASSWORD` | Nee | SMTP-wachtwoord. |
| `PLATFORM_SMTP_TLS` | Nee | Gebruik TLS voor platform-SMTP; standaard `true`. |
| `PLATFORM_FROM_NAME` | Nee | Afzendernaam voor platformmails; standaard `SuriRent`. |
| `PLATFORM_FROM_EMAIL` | Nee | Afzenderadres voor platformmails. |

Optionele integraties zijn niet bruikbaar totdat ze correct zijn geconfigureerd. Instellingen voor klantgebonden e-mail- en andere integraties kunnen daarnaast in de applicatie worden ingesteld.

## Lokale ontwikkeling

### Met Docker Compose

1. Kopieer `.env.example` naar `.env` en vervang de placeholderwaarden door lokale waarden.
2. Omdat de standaard Compose-configuratie geen hostpoorten publiceert, maak je voor lokale browsertoegang een `docker-compose.local.yml` met deze inhoud:

   ```yaml
   services:
     web:
       ports:
         - "8080:80"
   ```

3. Start de stack met de lokale port mapping:

   ```sh
   docker compose -f docker-compose.yml -f docker-compose.local.yml up --build
   ```

4. Open `http://localhost:8080`. De API-healthcheck is beschikbaar op `http://localhost:8080/api/health`.
5. Stop de services met `docker compose -f docker-compose.yml -f docker-compose.local.yml down`. De databasevolume blijft behouden. Om ook de databasegegevens te verwijderen, voeg je bewust `--volumes` toe.

De Compose-stack vereist dezelfde secrets en URL-variabelen als de Coolify-deployment. Gebruik voor lokale ontwikkeling `APP_PUBLIC_URL=http://localhost:8080`, `CORS_ORIGINS=http://localhost:8080` en laat `REACT_APP_BACKEND_URL`, `REACT_APP_MARKETING_HOST` en `REACT_APP_APP_URL` leeg. Publiceer in Coolify geen hostpoort; laat Coolify naar de interne webpoort `80` routeren.

### Frontend en backend afzonderlijk

- Frontend: Node.js 22 en npm. In `frontend/`: `npm install`, daarna `npm start` voor de ontwikkelserver of `npm run build` voor een productiebuild.
- Backend: Python 3.11. Installeer `backend/requirements.txt` en start vanuit `backend/` met `uvicorn server:app --reload --host 0.0.0.0 --port 8000`.
- De backend vereist ten minste `MONGO_URL`, `DB_NAME` en `JWT_SECRET`; voor functies voor PDF-beveiliging stel je ook `PDF_AES_PASSWORD` in. Voor afzonderlijke frontendontwikkeling stel je `REACT_APP_BACKEND_URL` in op de backend-origin.

## Beheer en onderhoud

- Gebruik Coolify om services te deployen, opnieuw te starten en logs te bekijken.
- MongoDB-data staat in `mongo_data` en blijft bestaan wanneer containers opnieuw worden aangemaakt. Deze volume is **geen back-up**; maak regelmatig afzonderlijke databaseback-ups en test herstel.
- De applicatie-healthcheck staat op `https://<jouw-domein>/api/health`.
- De Nginx-configuratie staat in `frontend/nginx.conf`; de multi-stage Docker-build staat in `Dockerfile`.
- Voer voor backendtests vanuit `backend/` `pytest` uit. Sommige integratie- en regressietests vereisen een bereikbare testdatabase en aanvullende omgevingsvariabelen.

## Mappenstructuur

```text
.
├── backend/             FastAPI-app, routes, services en tests
├── frontend/            React-app en Nginx-configuratie
├── Dockerfile           Multi-stage frontend- en backend-images
├── docker-compose.yml   Coolify-/Docker Compose-services
├── .env.example         Voorbeeld van deployment-omgevingsvariabelen
└── DEPLOYMENT.md        Beknopte Coolify-deployhandleiding
```
