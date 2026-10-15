# Contributing to SupportMe

Thank you for your interest in contributing to SupportMe. This project is built to support creator tipping and donations across a Next.js frontend, an Express + Prisma backend, and Soroban smart contracts on Stellar.

## How to Contribute

1. Fork the repository.
2. Create a descriptive branch name, e.g. `feature/creator-dashboard` or `fix/api-validation`.
3. Make small, focused changes.
4. Add or update documentation when you add features — and tick the README Roadmap checklist when a roadmap item ships.
5. Run the affected test suites (see [`TESTING.md`](TESTING.md)); CI runs the frontend, backend, and contract suites on every pull request.
6. Commit with clear messages.
7. Open a pull request with a summary and motivation.

## Repository Structure

- `frontend/` — Next.js client for public pages, the creator dashboard, and donation flows.
- `backend/` — Express API with Prisma and PostgreSQL support.
- `contracts/` — Soroban smart contracts (`donation`, `creator-registry`) in a Cargo workspace. Deployed testnet addresses are listed in the README; contract tests run in CI on every pull request.
- `anchor/` — Local SEP-24 test anchor for the fiat cash-out flow; see [`anchor/README.md`](anchor/README.md).
- `docs/` — Architecture, API, authentication, security, and runbook documentation.
- `docs/design/` — Handoff-ready UI/UX specs (donation widget, profile themes, empty states, …). New UI areas start here before implementation.
- `TESTING.md` — What CI runs and how to run each suite locally.

## Development Setup

### Backend

See [`backend/docs/CONFIGURATION.md`](backend/docs/CONFIGURATION.md) for the
backend environment variables grouped by service, including defaults and
local, staging, and production guidance.

```bash
cd backend
npm install
cp .env.example .env
# update DATABASE_URL in .env
npm run prisma:generate
npm run dev
```

### Frontend

```bash
cd frontend
npm install
# create frontend/.env.local with required env vars
npm run dev
```

### Auth providers (optional)

Wallet sign-in only needs `JWT_SECRET`. To exercise the Twitter/X OAuth and
magic-link flows locally, add the relevant variables to `backend/.env` and
restart the server:

- **Twitter/X OAuth**: `TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET`, and
  `TWITTER_REDIRECT_URI`. Register an app at
  [developer.x.com](https://developer.x.com) and set its callback URL to
  `http://localhost:3000/auth/twitter/callback` (localhost is allowed over HTTP
  for development).
- **Magic link**: `RESEND_API_KEY` (plus optional `EMAIL_FROM` and `APP_URL`).
  If `RESEND_API_KEY` is unset, the magic link is printed to the backend log
  instead of being emailed — the quickest way to test the flow locally.

Both methods are optional: the app runs without them, and the endpoints return
`503` when a provider is unconfigured. See
[`docs/authentication.md`](docs/authentication.md) for the full setup steps,
required environment variables, and curl walkthroughs.

## What We Want

- Clean, well-documented APIs
- Stable database schema and migrations
- Accessible frontend flows
- A small, well-tested contract surface — new on-chain logic should be justified
- Tests and validation for new features

## Best Practices

- Keep user flows simple and reliable.
- Prefer explicit API responses and error handling.
- Keep architecture documentation updated.
- Keep the README Roadmap checklist accurate as features ship.
- Design new UI areas (widgets, themes, …) in `docs/design/` before implementing them.
- Avoid adding contract complexity unless it is required by the feature.

## Reporting Issues

If you find a bug or want to propose a feature, open an issue with:
- Summary of the problem or feature
- Steps to reproduce / expected behavior
- Any relevant screenshots or logs
