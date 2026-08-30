# Repository Guidelines

## Project Structure & Module Organization

This is a Vue 3 + TypeScript uni-app client. Under `src/`, route views are in `pages/<feature>/`, reusable UI in `components/`, shared logic in `composables/`, API/mock behavior in `services/`, and domain interfaces in `types/`. Global SCSS is in `styles/theme.scss` and `uni.scss`; bundled assets belong in `static/`. Routes and platform metadata live in `pages.json` and `manifest.json`. Tests sit in `src/services/__tests__/`; product and PDA notes are in `docs/`. Treat `dist/` and `node_modules/` as generated.

## Build, Test, and Development Commands

- `npm ci` installs the exact dependency versions from `package-lock.json`.
- `npm run dev:h5` starts the H5 development server with hot reload.
- `npm run build:h5` creates the production H5 bundle under `dist/build/h5/`.
- `npm test` runs the complete Vitest suite once.
- `npm run typecheck` validates Vue and TypeScript files without emitting output.

Run tests and type checking before opening a pull request. Use HBuilderX for Android/App-Plus packaging and device-specific PDA validation.

## Coding Style & Naming Conventions

Use two-space indentation, semicolons, and single quotes in TypeScript. Keep TypeScript strict and prefer explicit domain types over `any`. Vue components use `<script setup lang="ts">`; component filenames are PascalCase (`ScanInput.vue`), composables start with `use` (`usePdaScanner.ts`), and exported types use PascalCase. Keep page filenames lowercase where routes do (`pages/scan/index.vue`). No formatter or linter is configured, so preserve surrounding style and rely on `vue-tsc`.

## Testing Guidelines

Vitest runs in `jsdom` and discovers `src/**/*.test.ts`. Name suites after their module, for example `services/__tests__/scanAdapter.test.ts`. Cover success, failure, state reset, and input-normalization paths for service changes. No coverage threshold is configured; every behavior change should still include a focused regression test.

## Commit & Pull Request Guidelines

This checkout contains no Git history, so no repository-specific commit convention can be verified. Use short, imperative Conventional Commits such as `feat(scan): support keyboard wedge input` or `fix(auth): clear stale user state`. Pull requests should explain the user impact, link the issue, list validation commands, and include H5 or device screenshots for UI changes. Note every tested target (H5, Android/App-Plus, WeChat) and any PDA hardware assumptions.

## Security & Configuration

Do not commit production credentials, signing files, device identifiers, or vendor PDA secrets. The credentials in `src/services/auth.ts` are demo-only. Keep platform permissions in `manifest.json` minimal and document new native capabilities in `docs/`.
