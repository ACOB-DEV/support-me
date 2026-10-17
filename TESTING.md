# Testing

This guide covers the test suites and checks run by the repository's GitHub
Actions workflow in [.github/workflows/ci.yml](.github/workflows/ci.yml).
CI runs on pushes to `main` and pull requests targeting `main`; the workflow
does not filter by changed paths, so all jobs run for each pull request.

## Prerequisites

- Node.js 20 and npm for the frontend and backend (the version used by CI).
- Rust stable and `rustup` for the contract workspace. CI installs the
  `wasm32v1-none` target for the contract build.
- Chromium for running the frontend browser tests locally.

Install JavaScript dependencies with `npm ci` from the relevant package
directory. The frontend and backend each have their own `package-lock.json`.

## Frontend

From `frontend/`:

```sh
npm ci
npx tsc --noEmit
npm test
npm run build
```

`npm test` runs Vitest tests in jsdom. To run the Playwright end-to-end suite,
install Chromium once and then run:

```sh
npx playwright install chromium
npm run test:e2e
```

Playwright starts its own Next.js development server with
`npx next dev -p 3000` (see the `webServer` block in
[`frontend/playwright.config.ts`](frontend/playwright.config.ts)). This server
uses plain **HTTP** at `http://localhost:3000`, unlike `npm run dev`, which
serves `https://localhost:3000` with `--experimental-https`. Playwright can
reuse an existing local server on that port when not running in CI, but that
server must answer on `http://localhost:3000`. Stop a running `npm run dev`
(HTTPS) first, or start the app with `npm run dev:http`.
`PLAYWRIGHT_BASE_URL` changes the URL the tests open. The web server is still
started and checked at `http://localhost:3000`. CI installs Chromium with its system
dependencies using `npx playwright install --with-deps chromium` before running
the same `npm run test:e2e` command. `npm run lint` is also available locally;
the current CI workflow does not run the frontend linter.

For errors you see when testing manually against the Stellar testnet (wallet
network, Friendbot funding, trustlines, contract errors), see
[`docs/testnet-troubleshooting.md`](docs/testnet-troubleshooting.md).

## Backend

From `backend/`:

```sh
npm ci
npm test
npm run build
```

`npm test` runs Jest tests, including HTTP route tests using Supertest. The
build runs `prisma generate` followed by the TypeScript compiler. CI supplies
`DATABASE_URL=postgresql://postgres:postgres@localhost:5432/supportme?schema=public`
for this build step.

## Contracts

Run contract unit tests from the repository root:

```sh
cargo test --workspace
```

To also verify the release WASM build performed by CI, install the target if it
is not already available and run:

```sh
rustup target add wasm32v1-none
cargo build --workspace --target wasm32v1-none --release
```

The Cargo workspace includes the donation and creator-registry contracts, as
well as shared contract code.

## What CI Runs

For every pull request targeting `main`, the workflow runs:

- **Contracts:** `cargo test --workspace` and a release build for
  `wasm32v1-none`.
- **Backend:** `npm ci`, `npm run build`, and `npm test` in `backend/`.
- **Frontend:** `npm ci`, `npx tsc --noEmit`, `npm test`, and `npm run build`
  in `frontend/`.
- **Frontend E2E:** install Chromium and run `npm run test:e2e` in
  `frontend/`.
- **Type drift:** if `contracts/common/src/lib.rs` changes, require a changed
  frontend TypeScript file in the same pull request.

## Coverage Expectations

There is currently no configured coverage report or minimum percentage enforced
by CI. The Playwright project covers Chromium only, and its fixtures mock the
wallet and backend boundaries; it does not validate live wallet-provider,
backend deployment, or testnet behavior.

Add or update tests for the behavior a pull request changes. Cover successful
and rejected inputs or operations where relevant, and include important edge
states such as validation failures, authorization failures, empty data, and
network errors. Prefer focused Vitest/Testing Library tests for frontend
interactions, Jest/Supertest tests for backend routes and services, and Rust
unit tests for contract behavior. Use Playwright when a change affects a
complete browser workflow; it complements rather than replaces focused tests.
Do not skip or weaken a test to make a change pass. No fixed coverage
percentage is expected; tests should exercise the new behavior and its
meaningful failure cases.
