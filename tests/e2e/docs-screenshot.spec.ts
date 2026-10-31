import path from 'node:path'
import { expect, test } from '@playwright/test'
// @ts-expect-error -- plain ESM helper shared with the launcher scripts
import { mintPairingToken } from '../../scripts/lib.mjs'
import { readE2EState } from './state.ts'

// Regenerates docs/assets/repobs-overview.png from the real app on synthetic demo data.
// Run alone:  REPOBS_DOCS_SCREENSHOT=1 npx playwright test docs-screenshot
test.skip(!process.env.REPOBS_DOCS_SCREENSHOT, 'documentation screenshot only on request')

test('dashboard screenshot for the documentation', async ({ page }) => {
  const state = readE2EState(Number(process.env.REPOBS_E2E_PORT ?? 47399))
  await page.setViewportSize({ width: 1440, height: 860 })
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto(`/#pair=${mintPairingToken(state.dataDir) as string}`)
  await page.getByRole('button', { name: 'Add repositories' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Add repositories' })
  await expect(dialog.getByRole('list', { name: 'Repositories to add' }).getByRole('checkbox')).toHaveCount(2)
  await dialog.getByLabel('Select all').check()
  await dialog.getByRole('button', { name: 'Add 2 repositories' }).click()
  await expect(dialog).toBeHidden()
  // Collapse the bulk-session repository so the screenshot shows the interesting one.
  await page.getByRole('button', { name: 'Collapse repo-b' }).click()
  const card = page.getByRole('listitem', { name: /^Review ref grouping/ })
  await card.getByRole('button', { name: /change review state/ }).click()
  await page.getByRole('menuitemradio', { name: 'Flagged' }).click()
  await page.getByRole('button', { name: 'Legend' }).click()
  await page.getByRole('listitem', { name: /^Tighten status parser/ }).getByText('Tighten status parser', { exact: true }).click()
  await expect(page.getByRole('complementary', { name: 'Details panel' }).getByLabel('Review state')).toBeVisible()
  await page.mouse.move(0, 0)
  await expect(page.getByRole('dialog', { name: 'Agent details' })).toBeHidden()
  await page.getByLabel(/^Branches and agents\. Use the arrow keys/).evaluate((el) => (el.scrollTop = 0))
  // Temporary-folder paths contain the local user name: mask them in the published image.
  await page.screenshot({
    path: path.resolve('docs/assets/repobs-overview.png'),
    maskColor: '#cfd8e5',
    mask: [page.locator('header span.mono[title]'), page.getByText(/^(Worktree|Working directory)$/).locator('xpath=following-sibling::dd[1]')],
  })
})
