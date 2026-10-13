# RCA — Production APK upload fails with axios "Network Error"

**Deployment:** vastgoed-app (`app.surirent.sr` / https://vastgoed-app.emergent.host)
**Active run:** 99ded4d7-3fb2-46ac-a0d0-7fb58c68b5ca · template `fastapi_react_mongo_shadcn_base_image` · **frontend_type = cloudflare** (so `/api/*` is proxied Browser → Cloudflare edge/worker → K8s nginx:8080 → backend:8001)
**Tier:** tier_1 (Launch) — not relevant (no OOM/throttle involved)

## Symptom
Superadmin → SaaS Instellingen → Android-app (APK) upload always fails with axios **"Network Error"**. Chunked flow: `/init` → PUT `.../chunk/{index}` (4 MB raw `application/octet-stream`) → `/complete`.

## What the evidence shows
- **The APK is ~93.5 MB** (`apk_uploads.size = 98,094,852`), i.e. **~24 chunks** at the 4 MB (`chunk_size = 4194304`) returned by `/init`.
- **14** `apk_uploads` init records exist (repeated retries), all for the same ~93.5 MB file (v1.0.22).
- Backend logs (last 12h) show **many `POST /api/superadmin/apk/upload/init → 200`**, but only **TWO** `PUT .../chunk/0 → 200` ever reached the backend, and **ZERO** `/complete` calls.
- `apk_chunks` collection holds exactly **2** documents — both `index: 0` (upload_ids `a755f12e…` and `15516666…`, matching the 2 logged 200s). **No upload ever got past chunk 0.**
- **No backend errors** for any of these endpoints. The rare chunk that reached the backend was accepted (200).

### Conclusion on where it breaks
The PUT chunk request is being **dropped/reset at the Cloudflare edge/worker layer, before it reaches the pod**, for essentially every attempt:
- **nginx is NOT the limiter** — `client_max_body_size 100M` (confirmed in the GCS nginx.conf override) and `proxy_read_timeout 86400s`; a 4 MB body passes nginx fine, and the backend returns 200 on the chunks that did arrive.
- Because the edge rejection/reset carries **no CORS headers**, the browser cannot read a status (e.g. 413) and surfaces it to axios as **"Network Error"** — exactly the symptom reported, and exactly the mechanism the reporter hypothesised in (1).
- `/init` (POST, small JSON) and `GET /api/superadmin/apk` work cleanly; the break is specific to the **large raw `application/octet-stream` PUT body**.

**Limitation / honesty:** The deployer toolset has **no Cloudflare visibility** (cannot read worker code, edge request-body limit, or SSL/KV). So the *exact* edge limit value cannot be read from here — it is **attributed**, not directly measured. What IS measured: nginx=100M, backend=200 on arrival, chunk_size=4,194,304, APK=98,094,852 B. Note 4 MB is well under Cloudflare's standard 100 MB plan body cap, so a simple static body-size 413 is not the obvious explanation — a worker body-forwarding/buffering constraint or an edge timeout on the slow upload (superadmin is in Suriname, likely limited uplink) is equally plausible. Both live in the Cloudflare path, which is a Platform-owned component.

## Answers to the 4 specific questions
1. **Ingress/proxy body-size limit / 413 without CORS?** nginx allows 100 MB (not the cause). The rejection is upstream at the **Cloudflare edge/worker** and arrives **without CORS headers**, which is why axios reports "Network Error" rather than a readable 413. Exact edge value is not inspectable from the deployer toolset → Platform must confirm.
2. **Timeout on `/complete`?** `/complete` **never executed** (0 calls) because uploads die at chunk 0, so its 600 s object-storage `requests.put` could not be exercised. nginx would not cut it (86400 s), but Cloudflare's ~100 s origin-response timeout is a *future* risk once chunking is fixed and the backend assembles ~93 MB and pushes to object storage — flag for follow-up, not the current cause.
3. **Backend logs:** `/init` → repeated 200s; chunk → only 2× `chunk/0` 200; `/complete` → none. No tracebacks/5xx. Confirms the failure is **before the backend**.
4. **`EMERGENT_LLM_KEY` / `INTEGRATION_PROXY_URL` in prod:** **both present and non-empty** on the active run. object-storage `/init` path was never reached (because `/complete` never ran), so it could not be end-to-end verified — but the credentials it needs exist.

## Exact failing request
`PUT https://app.surirent.sr/api/superadmin/apk/upload/{upload_id}/chunk/{index}` with a 4,194,304-byte `application/octet-stream` body — dropped at the Cloudflare layer, no response/CORS headers → axios "Network Error". Reproduced by data pattern (14 inits, 2 chunk-0s, 0 completes), not by edge inspection.

## Recommended fixes
### Code (E1 can do now — fastest mitigation)
- **Lower the chunk size** returned by `/init` from 4 MB to e.g. **1 MB (1048576) or 512 KB**, and have the frontend honour the returned `chunk_size` (it already reads it). Smaller bodies are far more likely to survive the edge path. Verify in production against the ~93.5 MB APK that chunks `1..N` now reach the backend and `apk_chunks` fills.
- **Better long-term:** replace the "stream 93 MB through the `/api/*` worker into Mongo" design with a **direct/presigned upload to object storage from the browser**, bypassing the Cloudflare `/api` worker for the large payload entirely. Also pre-empt the `/complete` timeout risk (item 2) by keeping the final object-storage push off the synchronous request path.

### Platform (escalation — authoritative answer on the limit)
- Emergent platform should **confirm the Cloudflare `/api/*` proxy request-body limit (and/or worker body-forwarding behaviour and edge timeout) for this deployment**, and report the exact value / raise it if it is below 4 MB. This is the component that is dropping the PUT without CORS headers; it is not inspectable or changeable from the deployer toolset or the app source.
