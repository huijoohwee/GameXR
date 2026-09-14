import { expect, test, type Page } from '@playwright/test'

async function openBench(page: Page) {
  await page.goto('/gamexr/')
  await page.getByRole('button', { name: 'Drone', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Drone bench' })).toBeVisible()
  await page.getByRole('button', { name: 'Connect receiver' }).click()
  await expect(page.getByRole('button', { name: 'Enable bench control' })).toBeEnabled()
}
async function enable(page: Page) {
  await page.getByRole('button', { name: 'Enable bench control' }).click()
  await expect(page.locator('.drone-panel')).toHaveAttribute('data-control', 'enabled')
}
async function expectInhibited(page: Page) {
  for (const axis of ['roll', 'pitch', 'yaw', 'throttle']) await expect(page.locator(`#drone-${axis}`)).toBeDisabled()
}
async function setAxis(page: Page, axis: string, value: string) {
  // Native range controls are exercised through input events; no private controller access.
  await page.locator(`#drone-${axis}`).evaluate((input: HTMLInputElement, value) => {
    input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}

test('mobile panel maps independent axes through UDP and displays honest telemetry', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await openBench(page)
  await expect(page.locator('#offline-status')).toHaveText('Offline shell ready')
  await expect(page.getByText('Simulated receiver · No motor outputs', { exact: true })).toBeVisible()
  await expect(page.getByText('Unavailable in simulated receiver', { exact: true })).toBeVisible()
  await expectInhibited(page)
  await enable(page)
  await setAxis(page, 'roll', '1')
  await setAxis(page, 'throttle', '0.5')
  await expect(page.locator('#drone-setpoint')).toHaveText('roll 1.00 · pitch 0.00 · yaw 0.00 · throttle 0.50')
  await setAxis(page, 'pitch', '-0.53')
  await setAxis(page, 'yaw', '0.53')
  await expect(page.locator('#drone-setpoint')).toHaveText('roll 1.00 · pitch -0.50 · yaw 0.50 · throttle 0.50')
  await expect.poll(async () => Number(await page.locator('#drone-sequence').textContent())).toBeGreaterThan(5)
  const width = await page.locator('.drone-panel').evaluate(element => ({ scroll: element.scrollWidth, client: element.clientWidth }))
  expect(width.scroll).toBeLessThanOrEqual(width.client + 1)
  await page.getByRole('button', { name: 'Disable control', exact: true }).click()
  await expectInhibited(page)
  await expect(page.locator('#drone-throttle')).toHaveValue('0')
  await expect(page.locator('#drone-setpoint')).toHaveText('roll 0.00 · pitch 0.00 · yaw 0.00 · throttle 0.00')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export session log' }).click()
  expect((await download).suggestedFilename()).toBe('gamexr-drone-bench-session.json')
  expect(errors).toEqual([])
})

test('focus loss, cancelled input and page lifecycle reset throttle and require enable', async ({ page }) => {
  await openBench(page)
  for (const event of ['blur', 'pointercancel', 'pagehide', 'gamepaddisconnected']) {
    await enable(page)
    await setAxis(page, 'throttle', '0.75')
    await expect(page.locator('#drone-setpoint')).toContainText('throttle 0.75')
    await page.evaluate(event => {
      if (event === 'pointercancel') document.querySelector('.drone-panel')!.dispatchEvent(new Event(event))
      else if (event === 'pagehide') window.dispatchEvent(new PageTransitionEvent(event, { persisted: true }))
      else window.dispatchEvent(new Event(event))
    }, event)
    await expectInhibited(page)
    await expect(page.locator('#drone-throttle')).toHaveValue('0')
    await expect(page.getByRole('button', { name: 'Enable bench control' })).toBeEnabled()
  }
})

test('game API does not change drone commands; closing and reopening has no authority', async ({ page }) => {
  await openBench(page)
  await enable(page)
  await setAxis(page, 'throttle', '0.25')
  await page.evaluate(async () => {
    await window.gameXR.control({ operation: 'set-controls', throttle: 1, pitch: 1, roll: 1, yaw: 1 })
  })
  await expect(page.locator('#drone-setpoint')).toHaveText('roll 0.00 · pitch 0.00 · yaw 0.00 · throttle 0.25')
  await page.getByRole('button', { name: 'Close drone bench' }).click()
  await page.getByRole('button', { name: 'Drone', exact: true }).click()
  await expect(page.locator('#drone-status')).toHaveText('Disconnected')
  await expectInhibited(page)
  await expect(page.locator('#drone-throttle')).toHaveValue('0')
  await page.getByRole('button', { name: 'Connect receiver' }).click()
  await expect(page.getByRole('button', { name: 'Enable bench control' })).toBeEnabled()
  await expectInhibited(page)
})

test('browser event-loop stall expires authority without automatically restoring it', async ({ page }) => {
  await openBench(page)
  await enable(page)
  await setAxis(page, 'throttle', '0.5')
  await expect(page.locator('#drone-setpoint')).toContainText('throttle 0.50')
  await page.evaluate(() => { const end = performance.now() + 650; while (performance.now() < end) { /* injected stall */ } })
  await expectInhibited(page)
  await expect(page.locator('#drone-throttle')).toHaveValue('0')
  await expect(page.getByRole('button', { name: 'Enable bench control' })).toBeEnabled()
})
