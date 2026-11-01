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
  await expect(dialog.getByRole('list', { name: 'Repositories to add' }).getByRole('checkbox')).toHaveCount(2, { timeout: 15_000 })
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

  // Feature pictures for the landing page (design/docs-ui-spec.md, 0.7), from the same demo: whole windows at 16:9, so
  // every picture has the same aspect ratio.
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.getByLabel(/^Branches and agents\. Use the arrow keys/).evaluate((el) => (el.scrollTop = 0))
  const shot = (name: string) => page.screenshot({ path: path.resolve(`docs/assets/feature-${name}.png`) })

  // 1. The timeline: the repositories' branches, commits and agents.
  await shot('timeline')

  // 2. An agent: its card on the timeline and its details, with the plan it keeps.
  const toolbar2 = page.getByRole('toolbar', { name: 'Workbench commands' })
  await toolbar2.getByRole('button', { name: 'Details panel' }).click()
  await page.getByRole('listitem', { name: /^Tighten status parser/ }).getByText('Tighten status parser', { exact: true }).click()
  const panel = page.getByRole('complementary', { name: 'Details panel' })
  await expect(panel.getByRole('region', { name: 'Agent plan' })).toBeVisible()
  await panel.getByText(/^(Worktree|Working directory)$/).locator('xpath=following-sibling::dd[1]').evaluateAll((els) =>
    els.forEach((el) => {
      el.textContent = 'C:\\src\\git-status-kit'
      el.setAttribute('title', el.textContent)
    }),
  )
  // One item of your own, so the checklist below shows both parts: the agent's plan, then yours.
  await panel.getByLabel('New checklist item').fill('Review the detached HEAD handling')
  await panel.getByLabel('New checklist item').press('Enter')
  await expect(panel.getByRole('list', { name: 'Checklist' })).toContainText('Review the detached HEAD handling')
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.mouse.move(0, 0)
  await expect(page.getByRole('dialog', { name: 'Agent details' })).toBeHidden()
  // Adding the item scrolled the panel to its input: back to the agent's name and status.
  await panel.evaluate((el) => [el, ...el.querySelectorAll('*')].forEach((e) => (e.scrollTop = 0)))
  await shot('agent')

  // 3. Your review: the checklist of an agent, its plan first and your items after.
  await toolbar2.getByRole('button', { name: 'Details panel' }).click()
  await expect(panel).toBeHidden()
  const pill = page.getByRole('listitem', { name: /^Tighten status parser/ }).first().getByRole('button', { name: /^Checklist of Tighten status parser/ })
  await pill.click()
  const dialog2 = page.getByRole('dialog', { name: 'Checklist of Tighten status parser' })
  await expect(dialog2.getByRole('region', { name: 'Your items' })).toBeVisible()
  // Rest the pointer on the list (opened by a click, it stays) so the row's agent card closes.
  await dialog2.hover()
  await expect(page.getByRole('dialog', { name: 'Agent details' })).toBeHidden()
  await shot('review')
  await page.keyboard.press('Escape')
})
