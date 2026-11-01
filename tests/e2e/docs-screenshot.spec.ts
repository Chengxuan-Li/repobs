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
  await page.setViewportSize({ width: 1440, height: 800 })
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto(`/#pair=${mintPairingToken(state.dataDir) as string}`)
  await page.getByRole('button', { name: 'Add repositories' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Add repositories' })
  await expect(dialog.getByRole('list', { name: 'Repositories to add' }).getByRole('checkbox')).toHaveCount(2)
  await dialog.getByLabel('Select all').check()
  await dialog.getByRole('button', { name: 'Add 2 repositories' }).click()
  await expect(dialog).toBeHidden()
  // Collapse the bulk-session repository so the screenshot shows the interesting one.
  await page.getByRole('button', { name: 'Collapse storefront-web' }).click()
  // A few review states, so their colours show.
  for (const [agent, state] of [
    ['Review ref grouping', 'Flagged'],
    ['Resolve merge plan', 'Complete'],
    ['Document worktree states', 'Reviewed'],
  ]) {
    await page.getByRole('listitem', { name: new RegExp(`^${agent}`) }).getByRole('button', { name: /change review state/ }).click()
    await page.getByRole('menuitemradio', { name: state, exact: true }).click()
  }
  // The dashboard alone: no side panels, no legend.
  const toolbar = page.getByRole('toolbar', { name: 'Workbench commands' })
  for (const panel of ['Repositories panel', 'Details panel']) {
    const toggle = toolbar.getByRole('button', { name: panel })
    if ((await toggle.getAttribute('aria-pressed')) === 'true') await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  }
  await expect(page.getByRole('complementary', { name: 'Repositories panel' })).toBeHidden()
  await expect(page.getByRole('complementary', { name: 'Details panel' })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Hide legend' })).toBeHidden()
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.mouse.move(0, 0)
  await expect(page.getByRole('dialog', { name: 'Agent details' })).toBeHidden()
  await page.getByLabel(/^Branches and agents\. Use the arrow keys/).evaluate((el) => (el.scrollTop = 0))
  // Temporary-folder paths contain the local user name: show a neutral path in the published image instead.
  const paths = page.locator('header span.mono[title]')
  await expect(paths).toHaveCount(2)
  await paths.evaluateAll((els) =>
    els.forEach((el) => {
      const name = el.closest('[aria-label$=" repository"]')?.getAttribute('aria-label')?.replace(/ repository$/, '') ?? 'project'
      el.textContent = `C:\\src\\${name}`
      el.setAttribute('title', el.textContent)
    }),
  )
  await page.screenshot({ path: path.resolve('docs/assets/repobs-overview.png') })
})
