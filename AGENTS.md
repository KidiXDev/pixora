# Repository Guidelines

## Project Structure & Module Organization
Pixora is a Wails v3 desktop app with a Go backend and React frontend. Entry points live in `main.go` and `internal/`, with backend domains split into `internal/config`, `internal/db`, `internal/parser`, and `internal/services`. The UI lives in `frontend/src` with pages, stores, hooks, and shared components under `frontend/src/components`. Generated Wails bindings are in `frontend/bindings` and should be treated as generated output. Static assets live in `assets/` and `frontend/public/`. Plugin and extension docs live in `docs/`, while runtime parser plugins are loaded from `plugins/`.

## Build, Test, and Development Commands
- `wails3 dev`: runs the Wails desktop app in development mode with Vite on port `9245`.
- `wails3 build`: builds the native app for the current OS.
- `npm --prefix frontend run build`: type-checks and builds the frontend bundle.
- `go test ./...`: runs Go unit tests, including parser coverage in `internal/parser`.
- `pytest backend/node/pixorabridge/tests`: runs tests for the Python bridge package.
- `wails3 generate bindings -ts`: generates Wails bindings for the frontend.

## Coding Style & Naming Conventions
Follow existing language defaults: Go code should stay `gofmt`-formatted with package-focused files and camelCase identifiers; exported names use PascalCase. Frontend files use kebab-case names such as `home-page.tsx`, while React components and types use PascalCase. TypeScript uses 2-space indentation and ESLint via `frontend/eslint.config.mjs`; unused variables should be prefixed with `_`. Use Prettier for frontend formatting when touching TS, TSX, or CSS.

## Testing Guidelines
Place Go tests next to the code as `*_test.go`. Keep tests deterministic and table-driven where possible. Python tests live under `backend/node/pixorabridge/tests` and use `test_*.py`. Run the relevant test set before opening a PR; add coverage for parser, service, or store behavior when changing logic.

## Commit & Pull Request Guidelines
Recent history follows Conventional Commit style, mainly `feat: ...`; use the same pattern for `fix:`, `refactor:`, and `docs:` commits. Keep messages imperative and focused on one change. PRs should include a short description, linked issue when applicable, test notes, and screenshots or recordings for visible UI changes.

## Agent-Specific Notes
Do not hand-edit `frontend/bindings`. Keep plugin-facing changes aligned with the docs in `docs/plugin-*.md`, and avoid committing local build output from `bin/`, `frontend/dist`, or cache directories. after every change in go code, run `wails3 generate bindings -ts` to generate Wails bindings for the frontend.
