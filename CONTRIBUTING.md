# Contributing

Read [AGENTS.md](AGENTS.md) first — it applies to human and AI contributors alike — and the [foundation decision](docs/decisions/0001-product-foundation.md).

## Setup

```powershell
npm ci
npm run build
npm run dev          # backend (watch) + Vite dev UI
```

## Before you open a pull request

```powershell
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run build
npm run test:e2e
npm run docs:build   # needs: python -m pip install -r requirements-docs.txt
```

## Ground rules

- Keep Git access read-only. New Git commands need a product decision and an allowlist test (`apps/server/src/git/exec.ts`, `tests/git/exec.test.ts`).
- Spawn processes only with argv arrays and `shell: false` (`platform/process.ts`).
- Every user-facing status needs evidence and confidence; prefer *unknown* over false certainty.
- Use synthetic fixtures (`fixtures/`, `scripts/demo.ts`). Never commit real session histories, repository snapshots, databases or screenshots of real data.
- Change shared shapes in `packages/contracts` and regenerate `docs/api.md` with `npm run docs:api`.
- Record notable decisions as ADRs in `docs/decisions/` and update `docs/development/handoff-status.md`.
- Small, focused commits; no force pushes or history rewrites on shared branches.
