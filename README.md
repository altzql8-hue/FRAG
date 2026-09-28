# FRAG Control

FRAG Control is a production-oriented administrator dashboard for the license records used by the supplied Android/Lua client. It uses Firebase Realtime Database as the source of truth and keeps an indexed SQLite projection on the server for fast search, filters, sorting, and numbered pagination.

The Lua client in `lua/main.lua` is the compatible integration version. It calls the protected FRAG API, while the API reads and writes Firebase records with the schema the original client expects:

```text
keys/{key}
  type
  status              active | frozen | expired | banned | disabled
  expiresAt           milliseconds since epoch; 0 means lifetime
  maxDevices
  hwids               object of device slots to identifiers
  usageCount
  lastUsed
```

`banned` is retained for compatibility with the original Lua status check. Administrator-only labels, notes, tags, history, audit events, sessions, and credentials are stored below `frag/` and are never returned by `/api/license/authenticate`.

## Requirements

- Node.js 22.13 or newer (the native `node:sqlite` module is used for the server index)
- A Firebase Realtime Database instance at the URL supplied by the original Lua file: `https://test-key-system-default-rtdb.asia-southeast1.firebasedatabase.app`
- A Firebase service account or Application Default Credentials available to the server process

The service account is never placed in the frontend, `.env`, ZIP, browser storage, or source map.

## Local setup

```powershell
Copy-Item .env.example .env
# Set GOOGLE_APPLICATION_CREDENTIALS to an absolute path outside this project.
npm ci
npm run build
npm start
```

Open `http://localhost:3000`. Initialize the first administrator against the configured Firebase instance with:

```powershell
npm run init-admin
```

The requested initial values are supported (`ZQL`, `ZQLPASS`, `5050`), but the initializer prompts without echoing the password or PIN. The values are stored as Argon2id hashes. The first login requires both credentials to be changed. If an admin already exists, initialization refuses to overwrite it.

For development with the Firebase emulator:

```powershell
npm run emulator
$env:FIREBASE_DATABASE_EMULATOR_HOST='127.0.0.1:9000'
$env:FIREBASE_PROJECT_ID='demo-frag'
$env:APP_ORIGIN='http://localhost:3000'
$env:PORT='3000'
npm start
```

The emulator database rules deny anonymous reads and writes. The test suite uses an isolated in-memory store for most tests and the emulator for Firebase transaction/rules tests.

## Production configuration

Set at least:

```text
NODE_ENV=production
APP_ORIGIN=https://your-domain.example
PORT=3000
FIREBASE_DATABASE_URL=https://test-key-system-default-rtdb.asia-southeast1.firebasedatabase.app
FIREBASE_PROJECT_ID=test-key-system
GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/firebase-service-account.json
TRUST_PROXY_HOPS=1
```

Put the service account in a secret mount or workload identity. Do not put it in the frontend or commit it. The production server rejects an emulator configuration and rejects an HTTP `APP_ORIGIN`.

The included Firebase rules intentionally deny direct client access. The server uses the Firebase Admin SDK, so it is the only component that performs privileged writes. The Lua integration must use the API URL configured in `lua/main.lua`; do not restore the old unauthenticated direct REST calls.

## Deployment

The project includes `Dockerfile`, `.dockerignore`, and `render.yaml`. A container build runs `npm ci`, builds the Vite frontend, and starts the server. Mount a persistent volume for `DATA_DIR` or use a shared/managed SQLite projection when running multiple instances. Firebase remains authoritative; the projection can be rebuilt by restarting the server.

For a normal VPS:

```bash
npm ci --omit=dev
npm run build
NODE_ENV=production npm start
```

Place the process behind HTTPS. Set a single server instance per `DATA_DIR`; the lock file prevents two processes from writing the same projection. For horizontal scaling, provide a shared search projection and route Firebase child updates to each instance.

## API surface

The main routes are:

```text
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/session
GET  /api/keys?page=1&limit=25&search=&status=&type=&sort=&direction=
POST /api/keys
POST /api/keys/batch
GET  /api/keys/:key
PATCH /api/keys/:key
POST /api/keys/:key/actions
POST /api/keys/bulk
GET  /api/analytics
GET  /api/devices
GET  /api/audit
GET  /api/login-activity
GET  /api/settings
PUT  /api/settings
POST /api/license/authenticate  # Lua client integration
```

Cookie sessions are HttpOnly, SameSite strict, and Secure in production. State-changing browser requests require an Origin check and CSRF token. Authentication and license endpoints have server-side rate limits. All sensitive changes write an audit record.

## Validation

```powershell
npm run build
npm test
npm run test:firebase
node -e "const fs=require('fs');require('luaparse').parse(fs.readFileSync('lua/main.lua','utf8'));console.log('Lua syntax passed')"
```

The tests cover hashed credentials, rate limiting, CSRF, session invalidation, Firebase rules, concurrent device claims, duplicate prevention, lifetime and expiration behavior, Lua-compatible public responses, editing conflicts, device reset, archiving, batch operations, bulk operations, XSS-safe rendering data, formula-safe exports, analytics, and 10,000-key pagination/filter/sort behavior.

## Backups and recovery

Back up Firebase using the Firebase console or an authenticated Admin SDK export. The local SQLite projection is disposable and is excluded from the deliverable. Never include password hashes, session tokens, service credentials, or private notes in public exports.

## Security notes

- The original `main(2).lua` is preserved in `docs/original-main.lua.txt` for reference; the deployable compatible version is `lua/main.lua`.
- Do not expose Firebase Admin credentials or enable anonymous Firebase rules.
- Permanent key deletion is only possible after archiving and exact-key confirmation. Audit records remain append-only from the normal UI.
- Public Lua authentication responses contain only license compatibility fields and current device count. Private administrator metadata is excluded.
