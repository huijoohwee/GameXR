import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

const pathBytes = process.env.GRAPH_FLIGHT_PATH_FILE ? readFileSync(process.env.GRAPH_FLIGHT_PATH_FILE)
  : Buffer.from(JSON.stringify({ schema: 'agentic-drone-flight-path/v2', sourceUrl: 'https://example.test/graph/?kgDoc=flight.py', model: 'kinematic', physicalAircraft: false,
    tickRate: 60, coordinateFrame: 'local-xz-altitude-m-heading-deg', sourceDigest: 'a'.repeat(64), sceneDigest: 'b'.repeat(64),
    samples: Array.from({ length: 181 }, (_, i) => [i, 0, 0, 0, Math.min(i, 180 - i) / 60]) }))

test('mobile imports reviewed Graph path and observes receiver-accepted takeoff and landing', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await page.goto('/gamexr/'); await page.getByRole('button', { name: 'Drone', exact: true }).click()
  await page.getByLabel('Import Graph flight path').setInputFiles({ name: 'flight.json', mimeType: 'application/json', buffer: pathBytes })
  await expect(page.locator('[data-path-summary]')).toContainText('Ready for review')
  const imported = JSON.parse(pathBytes.toString())
  if (imported.sourceUrl) await expect(page.getByRole('link', { name: /Open source in Graph/u })).toHaveAttribute('href', imported.sourceUrl)
  if (process.env.GAME_XR_GRAPH_CANVAS_ROOT) {
    const frame = page.frameLocator('iframe[title="Graph drone Canvas"]')
    await expect(frame.locator('canvas')).toBeVisible({ timeout: 15000 })
    await expect(frame.locator('[data-graph-canvas-pose]')).toHaveAttribute('data-graph-canvas-pose', '[0,0,0,0,0]')
    // Wrong-channel messages cannot repaint the observation.
    await page.evaluate(() => document.querySelector<HTMLIFrameElement>('iframe[title="Graph drone Canvas"]')!.contentWindow!.postMessage(
      { protocol: 'agentic-graph/learning-canvas/v1', kind: 'pose', channel: 'wrong', pose: [10, 8, 0, 0, 3] }, location.origin))
    await expect(frame.locator('[data-graph-canvas-pose]')).toHaveAttribute('data-graph-canvas-pose', '[0,0,0,0,0]')
  } else await expect(page.locator('[data-graph-preview]')).toContainText('Graph Canvas unavailable')
  await expect(page.getByRole('button', { name: 'Run flight path' })).toBeDisabled()
  await page.getByRole('button', { name: 'Connect receiver' }).click()
  await expect(page.getByRole('button', { name: 'Run flight path' })).toBeEnabled()
  await expect(page.locator('.drone-panel')).toHaveAttribute('data-control', 'inhibited')
  await page.getByRole('button', { name: 'Run flight path' }).click()
  await expect(page.locator('[data-path-position]')).toContainText('airborne')
  await expect(page.locator('#drone-throttle')).toBeDisabled()
  await expect(page.locator('[data-path-summary]')).toContainText('receiver acknowledged landing', { timeout: 15000 })
  await expect(page.locator('[data-path-position]')).toContainText('altitude 0.00 m · landed')
  await expect(page.locator('.drone-panel')).toHaveAttribute('data-control', 'inhibited')
  if (process.env.GAME_XR_GRAPH_CANVAS_ROOT) await expect(page.frameLocator('iframe[title="Graph drone Canvas"]').locator('[data-graph-canvas-pose]'))
    .toHaveAttribute('data-graph-canvas-pose', JSON.stringify(imported.samples.at(-1)))
  await page.screenshot({ path: test.info().outputPath('phone-flight-path-landed.png') })
  const size = await page.locator('.drone-panel').evaluate(e => ({ scroll: e.scrollWidth, width: e.clientWidth }))
  expect(size.scroll).toBeLessThanOrEqual(size.width + 1)
  expect(errors).toEqual([])
})

test('Stop and focus loss discard active path; malformed replacement cannot run', async ({ page }) => {
  await page.goto('/gamexr/'); await page.getByRole('button', { name: 'Drone', exact: true }).click()
  await page.getByLabel('Import Graph flight path').setInputFiles({ name: 'flight.json', mimeType: 'application/json', buffer: pathBytes })
  await page.getByRole('button', { name: 'Connect receiver' }).click()
  for (const stop of ['button', 'blur']) {
    await page.getByRole('button', { name: 'Run flight path' }).click()
    await expect(page.locator('[data-path-position]')).toContainText('airborne')
    if (stop === 'button') await page.getByRole('button', { name: 'Disable control', exact: true }).click()
    else await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await expect(page.locator('.drone-panel')).toHaveAttribute('data-control', 'inhibited')
    await expect(page.getByRole('button', { name: 'Run flight path' })).toBeEnabled()
  }
  await page.getByLabel('Import Graph flight path').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{}') })
  await expect(page.locator('[data-path-summary]')).toContainText('Unsupported or missing')
  await expect(page.getByRole('button', { name: 'Run flight path' })).toBeDisabled()
})
