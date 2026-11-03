# Mobile app (apps/mobile)

Mobile-specific details. Architecture, the mobile-to-web API relationship, auth, Git workflow, database rules and security rules are in the root `CLAUDE.md`. Backend changes mobile needs are web code, so they go through `staging` (see the root Git workflow). If the task touches the API or other web code, read `apps/web/CLAUDE.md` before making changes.

Expo SDK 56, React Native 0.85, expo-router (file routes in `app/`), NativeWind 4, zustand. Plain JavaScript. Use the Expo SDK 56 docs.

## Running and verifying

- Needs a development build (Mapbox, Apple sign-in and other native modules), not Expo Go. Start Metro with `npm run dev:mobile` from the root. Build and install the native app with `npm run ios` or `npm run android` inside `apps/mobile`.
- There is no lint, typecheck or build script, and the `test` script points at a folder that does not exist. Verify changes on a dev build, and say plainly what you could not check.
- Do not run `eas build`, `eas submit` or `eas credentials` unless the user asks.
- `apps/mobile/.env.local` is gitignored (names are in `.env.example`, all `EXPO_PUBLIC_*`). A phone cannot reach `localhost`: to test against local web, use the computer's LAN IP.

## Conventions

- Relative imports, no `@/` alias. Shared code comes from `@proximity/*` packages.
- NativeWind `className` for styling, and inline `style` only for dynamic values. Raw colour values live in `src/theme/tokens.js`.
- UI source of truth: `design-system/MASTER.md`, with page overrides in `design-system/pages/`.
- Components are `PascalCase.js`, lib and hooks are `camelCase.js` (hooks as `useX`), routes are kebab-case, stores are `xStore.js` in `src/store`.
- Add endpoints in `packages/api-client/src/resources/` and call them through `src/lib/apiClient.js`.
- Tokens live in SecureStore only, via `src/lib/secureStorage.js` (keys may contain only letters, digits, `.`, `-`, `_`). Never log one-time link tokens (`src/lib/linkTokens.js`).

## Build environments

- **Verified in the repo** (`eas.json`, `app.config.js`): profiles are `development` (dev client, internal), `preview` (internal), `testflight` (extends `preview`, store distribution, auto-increment) and `production` (auto-increment). `development`, `preview` and `production` each use the Expo environment of the same name. `testflight` extends `preview` and uses the `preview` environment.
  - For `preview`, `testflight` and `production` builds, `app.config.js` throws unless the API and Supabase URLs are public https hosts and the Supabase key is not a secret/service-role key. It also requires the Google client IDs and a `pk.` Mapbox token, and rejects `EXPO_PUBLIC_TEST_EMAIL_TO`.
  - It cannot tell staging from production, so a wrong Expo value would still pass.

**Policy** (intended, not verified): the purpose of a build decides its backend, not how it is distributed. Pick the profile by purpose: `testflight` or `preview` for testing, and `production` only for a build meant for release.

| Build | EAS profile | API | Database | Status |
|---|---|---|---|---|
| Local dev build | `development` | staging (default in each developer's `.env.local`) | dev | Verified in the local file, per developer |
| Testing, including internal TestFlight beta | `preview`, `testflight` | staging | dev | **Policy** |
| App Store release | `production` | production | production | **Policy** |

- **Unverified**: the values in the Expo-hosted `development`, `preview` and `production` environments are not in the repo and were not checked. Do not claim they match the policy above. Ask the user to check Expo when it matters.
- **Inferred, not tested**: a build's API URL and `EXPO_PUBLIC_SUPABASE_URL` should point at the same environment, because the API mints the chat realtime token for its own Supabase project. A mismatch would likely break chat.
- The staging host gets special handling for universal links (`src/lib/linkDomains.js`), and `.easignore` keeps local `.env*` files out of cloud builds.

## Releases

- Every change ships as a new binary (no OTA updates, see the root file). Build numbers are remote (`appVersionSource: remote`), and `submit.production` is empty in `eas.json`.
- Release steps beyond what `eas.json` shows are not documented in the repo. Do not assume them.

## Gotchas

- The root `postinstall` copies three Expo config plugins into `apps/mobile/node_modules`. Do not remove it.
- The `react-native-css-interop` pin (root `overrides`) and the custom resolver in `metro.config.js` are load-bearing: without them every `className` silently stops working.
- `android/` is a gitignored prebuild and there is no `ios/`, so native configuration lives in `app.config.js`.
- iOS simulators cannot receive push notifications.
- Universal links: the reset-password and verify-email paths are advertised by the web AASA route only when the web env sets `APP_LINKS_AUTH_PATHS`. A code comment says to keep it off on prod until a build that handles them ships.
