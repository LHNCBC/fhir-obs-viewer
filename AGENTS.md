# AGENTS.md

## What this repo is
- Two deliverables share logic: an Angular UI (`src/app/`) and a Node CLI
  autoconfig tool (`autoconfig-src/`).
- The UI queries FHIR servers to define cohorts, then pull cohort data.
- The CLI generates server-specific `settings.json5` and definitions CSV files.

## Big-picture architecture (read these first)
- App startup: `src/app/app.module.ts` uses `provideAppInitializer` to load
  `conf/settings.json5` through `SettingsService` before routes render.
- `FhirBackendService.init()` is called from
  `src/app/modules/home/home.component.ts` so token callback routes do not run
  full backend initialization.
- Runtime flow centers on `FhirBackendService`
  (`src/app/shared/fhir-backend/fhir-backend.service.ts`), which wraps
  `FhirBatchQuery` (`src/app/shared/fhir-backend/fhir-batch-query.js`).
- UI workflow is a wizard in `src/app/modules/stepper/stepper.component.ts`
  (settings -> action -> research-study/select-records/browse-public-data ->
  cohort -> pull data) driven by backend connection status and cohort mode.
- Auth paths are route-based: SMART launch in `src/app/modules/launch/`,
  OAuth2 callback in `src/app/modules/oauth2-token-callback/`, and RAS callback
  in `src/app/modules/ras-token-callback/`.
- The autoconfig CLI intentionally reuses browser query logic by importing
  `FhirBatchQuery` from `src/` (`autoconfig-src/autoconfig.js`).

## Build/test workflows that matter
- Install + dev server:
  - `npm install`
  - `npm start`
- Fast UI checks: `npm run unit` and `npm run lint`.
- Full test run: `npm test` (autoconfig + unit + Cypress).
- Autoconfig-specific checks:
  - `npm run test-autoconfig`
  - `node autoconfig-src/autoconfig-harness.js` (offline fixture validation)
- Build output:
  - `npm run build` writes UI to `public/` and also runs build-autoconfig.
  - `npm run build-autoconfig` bundles CLI into `autoconfig-build/`.

## Project-specific patterns and conventions
- Do not edit generated artifacts in `public/` or `autoconfig-build/`.
- Avoid reading or searching within `.idea/` unless the user explicitly asks for it.
- Focus discovery and edits on `src/`, `autoconfig-src/`, `test/`, and
  `webpack/` by default.
- Definitions pipeline: XLSX -> CSV/settings happens in
  `webpack/extra-webpack.config.js` during Angular build.
- XLSX files in `src/conf/xlsx/` are source-of-truth for definitions; build
  generates `src/conf/csv/` and updates `src/conf/settings.json5`.
- Autoconfig copies generated CSV templates into `autoconfig-build/conf/csv/`
  for a relocatable bundle.
- `autoconfig-src/build-autoconfig.js` also stages
  `autoconfig-build/conf/settings-initial.json5` and
  `autoconfig-build/conf/build-info.json`; `autoconfig-src/autoconfig.js`
  prefers these bundled files at runtime.
- Autoconfig filtering is dual-source by design: capability support plus live
  data checks (`generateDefinitionsCsv` in `autoconfig-src/autoconfig.js`).
- Preserve combined params (e.g. `code,medication`) and polymorphic `[x]`
  column handling (`autoconfig-src/definitions-generator.js`).
- Save generated planning prompts under `plans/` using
  `plan-<camelCaseName>.prompt.md` filenames.
- Ensure that all added or updated JavaScript/TypeScript functions are
  accompanied by correct JSDoc comments.
- Keep edits narrow and style-consistent (quote style, import style, async
  patterns, line lengths near 80 where practical).
- Blank lines: keep two between declarations; for JSDoc, keep two above the
  block and none between the block and its declaration.
- In test files (e.g. *.spec.ts and *.cy.ts), keep two blank lines before and
  after describe(...) blocks and between it(...) blocks; inside each
  describe(...), keep one blank line before the first it(...) and after the last
  it(...).

## Integration points and gotchas
- URL query params (`server`, `isSmart`, `prev-version`, `ras`) alter behavior;
  many components read them via shared utils.
- `ToastrInterceptor` (`src/app/shared/http-interceptors/toastr-interceptor.ts`)
  displays HTTP errors unless request context sets `HIDE_ERRORS`.
- `npm run autoconfig` runs the built bundle with
  `NODE_TLS_REJECT_UNAUTHORIZED=0`; this is intentional for some FHIR endpoints.
- If terminal `node`/`npm` is missing, source repo `bashrc` then rerun command:
  `source ./bashrc`.

