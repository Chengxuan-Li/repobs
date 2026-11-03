## What and why

<!-- What changes for the user, and why. -->

## Checks

- [ ] `npm run typecheck`, `npm run lint`, `npm run test`
- [ ] `npm run build`, then `npx playwright test` (end-to-end, synthetic data)
- [ ] `npm run docs:build` (strict)
- [ ] User-visible controls, labels, menus or workflows changed: the tutorial chapter is updated and its screenshots regenerated (`REPOBS_DOCS_SCREENSHOT=1 npx playwright test docs-tutorial`)
- [ ] `docs/development/handoff-status.md` and `CHANGELOG.md` updated
- [ ] No real session content, private paths or credentials in the diff or the screenshots
