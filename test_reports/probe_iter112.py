import json, requests
BASE = open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0].rstrip("/")
API = f"{BASE}/api"
ctx = json.load(open("/tmp/iter112_ctx.json"))
kh = {"Authorization": f"Bearer {ctx['kiosk_token']}"}
d = requests.get(f"{API}/kiosk/apartments", headers=kh).json()
apts = d if isinstance(d, list) else d.get("apartments") or d.get("items") or d
print(type(d), (list(d.keys()) if isinstance(d, dict) else len(d)))
for a in (apts if isinstance(apts, list) else [])[:40]:
    tid = a.get("tenant_id") or (a.get("tenant") or {}).get("id")
    if not tid:
        continue
    ov = requests.get(f"{API}/kiosk/tenants/{tid}/overview", headers=kh).json()
    invs = ov.get("open_invoices") or []
    s = sum(float(i.get("outstanding") or 0) for i in invs)
    print(a.get("number"), tid[:8], ov.get("tenant", {}).get("name"), "total_due", ov.get("total_due"), "inv_sum", s, "n", len(invs), ov.get("balance", {}).get("currency"))
ov = requests.get(f"{API}/kiosk/tenants/a7af3866"[:0] + f"{API}/kiosk/tenants/" + [a for a in apts if a.get("number")=="HUIS 1A"][0]["tenant_id"] + "/overview", headers=kh).json()
print({k: (v if not isinstance(v,(list,dict)) else type(v).__name__) for k,v in ov.items()})
print(json.dumps(ov.get("balance"))[:600])
print(json.dumps(ov.get("open_invoices"))[:900])
