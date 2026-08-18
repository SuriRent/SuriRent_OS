# Emergent Google Auth — Testing Playbook

## Overview
The app uses Emergent-managed Google OAuth as an ALTERNATIVE login (existing JWT email/password stays working). Users signing in via Google get a `session_token` (7-day) stored as httpOnly cookie + a user record in `users` collection.

## Test Session Setup
```
mongosh --eval "
use('vastgoed_kiosk');   // ← app db name
var userId = 'test-user-' + Date.now();
var sessionToken = 'test_session_' + Date.now();
db.users.insertOne({
  user_id: userId,
  email: 'test.google.' + Date.now() + '@example.com',
  name: 'Test Google User',
  picture: 'https://via.placeholder.com/150',
  role: 'admin',
  auth_provider: 'google',
  created_at: new Date()
});
db.user_sessions.insertOne({
  user_id: userId,
  session_token: sessionToken,
  expires_at: new Date(Date.now() + 7*24*60*60*1000),
  created_at: new Date()
});
print('Session token: ' + sessionToken);
"
```

## Testing
1. `curl "$BACKEND/api/auth/me" -H "Authorization: Bearer $TOKEN"` should return the user
2. Browser: set `session_token` cookie, navigate to `/admin` — should NOT redirect to login

## Endpoints
- `POST /api/auth/google/callback` — body `{session_id}` → sets cookie, returns user
- `GET /api/auth/me` — cookie OR Bearer → user JSON
- `POST /api/auth/logout` — clears cookie + deletes session row

## Frontend
- Login page has "Doorgaan met Google" button → redirects to `https://auth.emergentagent.com/?redirect=${origin}/auth/callback`
- `AuthCallback` component reads `useLocation().hash` for `session_id`, POSTs to backend, redirects to `/admin`
- AuthProvider skips `/auth/me` when `window.location.hash` includes `session_id=`

## Test Credentials
Test Google accounts should be listed in `/app/memory/test_credentials.md`.
