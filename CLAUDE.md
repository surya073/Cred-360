# CRED-360 (KeyShare)

Credential/password manager with sharing, built on **Zoho Catalyst** (serverless). Branded "keyShare" in the UI.
Users store encrypted passwords in folders/categories, and share them with users, teams, or external people (token + passphrase links). Roles: Admin, Team Lead, Employee, Intern.

- Catalyst project: `CRED-360` (id `46135000000013072`), org `60073973215`, environment **Development** only, timezone Asia/Kolkata (see `.catalystrc`, `catalyst.json`).
- Hosted at `https://cred-360-60073973215.development.catalystserverless.in/app/`.

## Layout

```
catalyst.json                 Catalyst CLI config: 3 function targets + React client (zcatalyst-cli-plugin-react)
cred-360-client/              React 19 + CRA (react-scripts 5), HashRouter, axios, recharts
  src/pages/                  Dashboard, Passwords, Folders, Categories, Teams, Users, ExternalUsers,
                              ShareManager, ActivityLogs, Settings, PublicShare, Login
  src/components/             Navbar, Sidebar, ShareModal, FolderShareModal, NotificationPanel, TeamChat, GlobalSearch, ...
  src/context/                Auth, Profile, ShareNotif, Navbar, Theme providers
  src/services/api.js         axios wrapper: in-flight dedupe + 30s GET cache, cleared on any write
  src/utils/encryption.js     client-side crypto-js helpers
  src/styles/                 plain CSS per area (theme.css holds tokens; polish.css is the latest overrides)
  src/fullBackend             scratch/reference copy of backend code, not used at runtime
functions/
  cred_360_function/          Advanced I/O (Express): auth, profile, dashboard, categories, passwords,
                              folders, shares (user/team/folder/external), public share verification
  cred_360_people_function/   Advanced I/O (Express): users/roles/invites, teams + members, notifications, activity logs
  cred_360_extras_function/   Advanced I/O (Express): external users, global search, user analytics, cron expiry check
  shared-utils/               constants, encryption, helpers, permissions used by all three functions
```

All functions: Node 18, Express, `zcatalyst-sdk-node`, entry `index.js`. Routes are all under `/api/...`.

## Request routing

The client calls each function at `/server/<function_name>/api/...`. The split matters when adding endpoints:
- `/server/cred_360_function` — passwords, folders, categories, shares, profile, dashboard, auth
- `/server/cred_360_people_function` — users, teams, notifications, activity-logs
- `/server/cred_360_extras_function` — external-users, search, users/:id/analytics, cron

Components hardcode these base paths in a per-file `const API = ...` (no central config).

## Data (Catalyst Data Store, queried with ZCQL)

Tables used: `Passwords`, `PasswordShares`, `Folders`, `Teams`, `TeamMembers`, `Users`, `ExternalUsers`, `Categories`, `ActivityLogs`, `NotificationEvents`.
- Folder shares live in `PasswordShares` with `share_type = 'folder'`, and the folder id is stored in the `password_id` column.
- Share `permissions` is a comma-separated string (`view,edit,delete`); `expiry` is a UTC `YYYY-MM-DD HH:mm:ss` string.
- ZCQL results are wrapped by table name (`row.Passwords || row`); code consistently unwraps this way.
- Booleans may come back as strings (`'false'`); existing code checks both `=== false` and `=== 'false'`.

## Auth, roles, permissions

- Catalyst user management handles login; the client calls `/api/userinfo` (401 means show `Login`) and logs out via `window.catalyst.auth.signOut`.
- Catalyst roles map to app roles via `ROLE_MAP` in `shared-utils/constants.js` (App Administrator→Admin, App User→Employee, TeamLead→Team Lead, Intern→Intern). Role/profile-folder ids in that file are environment-specific.
- Access to shared items goes through `userCanOnPassword` / `userCanOnFolder` in `shared-utils/permissions.js` (owner, direct share, team share, folder share including descendant folders). Reuse these instead of reimplementing checks.
- External shares: token + passphrase, with rate limiting (`checkRateLimit`, `recordFailedAttempt`, `clearAttempts`).
- Secrets are encrypted server-side with AES-256-GCM (`shared-utils/encryption.js`, format `iv:authTag:ciphertext` hex). `decrypt` returns non-matching legacy plaintext unchanged. Requires `ENCRYPTION_KEY` (64 hex chars) env var, which is set only in `cred_360_function/catalyst-config.json`. The people and extras functions have empty `env_variables`, so they cannot encrypt or decrypt unless it is set for them.
- Activity logging is fire-and-forget via `logActivity`; notifications go through `pushNotification`.

## Gotchas

1. **`shared-utils` is copied, not linked.** Functions do `require('shared-utils/...')`, resolved from a copy inside each function's `node_modules/shared-utils/` (gitignored). The root `functions/shared-utils/` is the source of truth, but the copies have drifted (`permissions.js` differs in all three; `helpers.js` in extras). After editing `functions/shared-utils/*`, sync it into all three `node_modules/shared-utils/` folders before serve/deploy. A fresh clone has no copies at all, so they must be created.
2. **Secrets in the repo.** `cred_360_function/catalyst-config.json` contains the real `ENCRYPTION_KEY` and is tracked in git. Don't print it or copy it elsewhere. Prefer moving it out of version control.
3. **SQL built by string interpolation.** ZCQL queries are assembled with template strings (`WHERE x = '${val}'`). Escape or validate any user-supplied value (see `escapeLike` in helpers) when adding queries.
4. Hardcoded environment ids (role ids, `PROFILE_FOLDER_ID`, `APP_URL`) in `shared-utils/constants.js` and at the top of `cred_360_function/index.js` (duplicated there) are Development values. Production will need different ones.
5. `GET` responses on the client are cached for 30s. Pass `{ fresh: true }` for data that must be current, and add new volatile endpoints to `NO_CACHE` in `api.js`.
6. `cred-360-client/build/`, `node_modules/`, `.build/` and `.env*` are gitignored.

## Commands

Run from the repo root unless noted. Catalyst CLI must be logged in (`catalyst login`).

```bash
# Local dev (Catalyst serves functions + client together; Data Store calls hit Development data)
catalyst serve

# Client only
cd cred-360-client && npm install && npm start      # CRA dev server on :3000
cd cred-360-client && npm run build
cd cred-360-client && npm test                      # Jest + Testing Library (only App.test.js exists)

# Install function deps
cd functions/<function_name> && npm install

# Deploy to Development
catalyst deploy                       # everything
catalyst deploy --only functions      # backend only
catalyst deploy --only client         # frontend only
```

Serve locally and test before deploying. Promote to Production only after Development is verified.

## Conventions

- Backend: `'use strict'`, CommonJS, one big Express `index.js` per function, handlers wrapped in try/catch returning JSON `{ message }` / data with proper HTTP status. Common helpers (`getCurrentUser`, `now`, `logActivity`, `mapBy`, `escapeLike`) come from `shared-utils/helpers`.
- Frontend: function components with hooks, `.jsx` for components/pages, axios via `services/api.js` (not raw axios) so caching and invalidation work, global state via context providers in `src/context`, plain CSS files imported in `App.js`.
- There is no linter/formatter config beyond CRA's `react-app` ESLint preset, and no backend tests.
- Don't commit unless asked. The working tree currently has many uncommitted client changes plus untracked `Login.jsx` and `polish.css`.
