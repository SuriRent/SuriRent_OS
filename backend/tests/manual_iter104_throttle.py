# Iteration 104 manual: company-wide kiosk throttle (kiosk-co) with spoofed IP headers. Restart backend after running!
import os
import requests

API = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api"
SLUG = "my-awesome-rentals-bv"
codes = []
for i in range(34):
    ip = f"10.9.{i}.{i+1}"
    r = requests.post(f"{API}/auth/kiosk-pin", json={"pin": f"{9000+i:04d}", "company_slug": SLUG},
                      headers={"X-Forwarded-For": ip})
    codes.append(r.status_code)
print("codes:", codes)
print("first 429 at attempt:", codes.index(429) + 1 if 429 in codes else None)
# Valid employee PIN during lockout (DoS check)
r = requests.post(f"{API}/auth/kiosk-pin", json={"pin": "4321", "company_slug": SLUG}, headers={"X-Forwarded-For": "10.200.0.1"})
print("valid employee pin during company lock:", r.status_code, r.text[:120])
