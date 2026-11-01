# SuriRent deployment on Coolify

This repository includes a Docker Compose stack for Coolify with three services:

- `web`: the React single-page app, served by Nginx and proxying `/api` requests to the API.
- `app`: the FastAPI backend.
- `database`: MongoDB 7 with persistent storage.

## Deploy

1. Create a Docker Compose resource in Coolify for this repository and select `docker-compose.yml`.
2. Set the required environment variables from `.env.example` in the resource's environment settings. Generate unique secrets; for example, use `openssl rand -hex 32` for `JWT_SECRET`, `PDF_AES_PASSWORD`, and `MONGO_ROOT_PASSWORD`. Use hexadecimal characters for the MongoDB password so it is safe in the connection URI. Keep MongoDB credentials and encryption secrets stable for this database.
3. Configure both public domains on the Coolify `web` service using container port `80`: the marketing hostname (for example, `https://example.com`) and the app hostname (for example, `https://app.example.com`). Do not assign a public domain to the internal `app` API service.
4. Set `APP_PUBLIC_URL` and `APP_PUBLIC_HOST` to the app domain, `CORS_ORIGINS` to both origins separated by a comma, `REACT_APP_MARKETING_HOST` to the marketing hostname without a scheme, and `REACT_APP_APP_URL` to the full app URL. Leave `REACT_APP_BACKEND_URL` empty so each domain uses the same-origin `/api` proxy.
5. Coolify supplies HTTPS and routes both hostnames to Nginx on `web`; Nginx serves the frontend and forwards API and WebSocket traffic internally to `app`.
6. Deploy. MongoDB data is stored in the `mongo_data` volume and survives container replacement.

The API starts with one worker because background jobs and PIN throttling are process-local. The admin account's password is synchronized from `ADMIN_PASSWORD` at each startup; keep that value as the source of truth. The superadmin is created once from `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD`. If you are reusing an existing database with the old seeded superadmin, change its password before exposing the deployment.

Optional third-party integrations (AI, Stripe, push notifications, SMTP) are disabled or unused until configured. Their corresponding variables are present as empty placeholders in `.env.example`; configure only the integrations you use.

## Operations

Use the Coolify resource to redeploy, inspect logs, and restart services. Back up MongoDB regularly; the named volume is persistent storage, not a backup. Before restoring or moving data, back up the `mongo_data` volume using `mongodump` with the configured MongoDB root credentials.

The public health endpoint is `https://<your-domain>/api/health`.
