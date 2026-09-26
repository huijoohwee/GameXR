import { test, expect } from '@playwright/test'
declare global {
  interface Window { cameraFixture: { calls: number; stops: number; mode: 'denied' | 'pending' | 'grant';
    constraints: MediaStreamConstraints | null; grant: (() => void) | null } }
}
test('phone camera is opt-in, local, race-safe and layered with honest IMU provenance', async ({ page }) => {
  await page.addInitScript(() => {
    window.cameraFixture = { calls: 0, stops: 0, mode: 'denied', constraints: null, grant: null }
    HTMLMediaElement.prototype.play = async () => {}
    // Replace the native wrapper itself so WebKit cannot escape the fixture.
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async (constraints: MediaStreamConstraints) => {
      const fixture = window.cameraFixture
      fixture.calls++; fixture.constraints = constraints
      if (fixture.mode === 'denied') throw new DOMException('denied', 'NotAllowedError')
      const stream = new MediaStream()
      const track = Object.assign(new EventTarget(), { stop: () => { fixture.stops++ } }) as unknown as MediaStreamTrack
      stream.getTracks = () => [track]; stream.getVideoTracks = () => [track]
      if (fixture.mode === 'pending') await new Promise<void>(resolve => { fixture.grant = resolve })
      return stream
    } } })
  })
  await page.goto('/gamexr/?diagnostics=1')
  const panel = page.getByRole('dialog', { name: 'USB diagnostics' })
  await expect(panel).toBeVisible()
  expect(await page.evaluate(() => window.cameraFixture.calls)).toBe(0)
  await panel.getByRole('button', { name: 'Start camera', exact: true }).click()
  await expect(panel.locator('[data-camera-status]')).toContainText('permission denied')
  await page.evaluate(() => { window.cameraFixture.mode = 'pending' })
  await panel.getByRole('button', { name: 'Start camera', exact: true }).click()
  await expect.poll(() => page.evaluate(() => ({ calls: window.cameraFixture.calls, mode: window.cameraFixture.mode }))).toEqual({ calls: 2, mode: 'pending' })
  await expect(panel.locator('[data-camera-status]')).toHaveText('Waiting for camera permission')
  await panel.getByRole('button', { name: 'Stop camera', exact: true }).click()
  await page.evaluate(() => window.cameraFixture.grant!())
  await expect.poll(() => page.evaluate(() => window.cameraFixture.stops)).toBe(1)
  await expect(panel.locator('[data-camera-status]')).toHaveText('Camera off')
  await page.evaluate(() => { window.cameraFixture.mode = 'grant' })
  await panel.getByRole('button', { name: 'Start camera', exact: true }).click()
  await expect(panel.locator('[data-camera-status]')).toContainText('Camera on · local preview only')
  expect(await page.evaluate(() => window.cameraFixture.constraints?.audio)).toBe(false)
  await panel.getByRole('button', { name: 'Start capture', exact: true }).click()
  await expect(panel.locator('[data-camera-source]')).toContainText('RECORDED REPLAY · fresh · observation only')
  await expect(panel.locator('[data-camera-reading]')).toContainText('m/s²')
  await panel.getByRole('button', { name: 'Stop', exact: true }).click()
  await expect(panel.locator('[data-camera-reading]')).toHaveText('No current IMU sample')
  await panel.getByRole('button', { name: 'Close diagnostics' }).click()
  await expect.poll(() => page.evaluate(() => window.cameraFixture.stops)).toBe(2)
})
