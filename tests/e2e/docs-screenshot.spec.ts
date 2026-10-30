import path from 'node:path'
import { expect, test } from '@playwright/test'
// @ts-expect-error -- plain ESM helper shared with the launcher scripts
import { mintPairingToken } from '../../scripts/lib.mjs'
import { readE2EState } from './state.ts'

// Regenerates docs/assets/repobs-overview.png from the real app on synthetic demo data.
// Run alone:  REPOBS_DOCS_SCREENSHOT=1 npx playwright test docs-screenshot
test.skip(!process.env.REPOBS_DOCS_SCREENSHOT, 'documentation screenshot only on request')

test('overview screenshot for the documentation', async ({ page }) => {
  const state = readE2EState(Number(process.env.REPOBS_E2E_PORT ?? 47399))
  await page.setViewportSize({ width: 1360, height: 760 })
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto(`/#pair=${mintPairingToken(state.dataDir) as string}`)
  for (const repoPath of [state.git.repoA, state.git.repoB]) {
    await page.getByRole('button', { name: 'Add repository' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Add repository' })
    await dialog.getByLabel('Local repository path').fill(repoPath)
    await dialog.getByRole('button', { name: 'Add repository' }).click()
    await expect(dialog).toBeHidden()
  }
  // Collapse the bulk-session repository so the screenshot shows the interesting one.
  await page.getByRole('treeitem', { name: 'repo-b repository' }).click()
  await page.keyboard.press('ArrowLeft')
  await page.getByRole('button', { name: 'Overview' }).click()
  await page.getByRole('treeitem', { name: /Review ref grouping/ }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Mark: Flagged' }).click()
  await page.getByRole('button', { name: 'Dismiss' }).click()
  await page.getByRole('button', { name: 'Overview' }).click()
  await expect(page.getByText('Attention queue')).toBeVisible()
  await page.mouse.move(0, 0)
  await page.screenshot({ path: path.resolve('docs/assets/repobs-overview.png') })
})
