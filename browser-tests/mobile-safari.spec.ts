import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { expect, test, type Page } from '@playwright/test'

type MotionPermission = 'granted' | 'denied'

async function installMotionHarness(page: Page, permission: MotionPermission): Promise<void> {
  await page.addInitScript(({ permission }) => {
    const orientationTarget = new EventTarget()
    Object.defineProperty(globalThis, '__gamexrScreenAngle', {
      configurable: true,
      value: 0,
      writable: true,
    })
    Object.defineProperty(screen, 'orientation', {
      configurable: true,
      value: {
        get angle() { return Number(globalThis.__gamexrScreenAngle ?? 0) },
        addEventListener: orientationTarget.addEventListener.bind(orientationTarget),
        removeEventListener: orientationTarget.removeEventListener.bind(orientationTarget),
        dispatchEvent: orientationTarget.dispatchEvent.bind(orientationTarget),
      },
    })
    class MockDeviceOrientationEvent extends Event {
      static requestPermission = () => Promise.resolve(permission)
      readonly alpha: number | null
      readonly beta: number | null
      readonly gamma: number | null
      readonly absolute: boolean

      constructor(type: string, init: DeviceOrientationEventInit = {}) {
        super(type)
        this.alpha = init.alpha ?? null
        this.beta = init.beta ?? null
        this.gamma = init.gamma ?? null
        this.absolute = init.absolute ?? false
      }
    }
    Object.defineProperty(globalThis, 'DeviceOrientationEvent', {
      configurable: true,
      value: MockDeviceOrientationEvent,
    })
  }, { permission })
}

async function dispatchOrientation(page: Page, beta: number, gamma: number): Promise<void> {
  await page.evaluate(({ beta, gamma }) => {
    globalThis.dispatchEvent(new DeviceOrientationEvent('deviceorientation', {
      alpha: 0,
      beta,
      gamma,
      absolute: false,
    }))
  }, { beta, gamma })
}

async function availableLoopbackPort(): Promise<number> {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('A loopback preview port could not be allocated.')
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()))
  return address.port
}

async function startDisposablePreview(): Promise<{ url: string; process: ChildProcess }> {
  const port = await availableLoopbackPort()
  const child = spawn(process.execPath, [
    resolve('node_modules/vite/bin/vite.js'),
    'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort',
  ], { cwd: process.cwd(), stdio: 'ignore' })
  const url = `http://127.0.0.1:${port}/gamexr/`
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Disposable preview exited with code ${child.exitCode}.`)
    try {
      if ((await fetch(url)).ok) return { url, process: child }
    } catch {}
    await delay(50)
  }
  child.kill('SIGTERM')
  throw new Error('Disposable preview did not become ready.')
}

async function stopDisposablePreview(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([once(child, 'exit'), delay(5_000)])
  if (child.exitCode === null) {
    child.kill('SIGKILL')
    await once(child, 'exit')
  }
}

test('mobile WebKit renders the configurable local flight surface without overflow', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.goto('/gamexr/')

  await expect(page.locator('#app')).toHaveAttribute('aria-busy', 'false')
  await expect(page.locator('#game-canvas')).toBeVisible()
  await expect(page.locator('#motion-control')).toHaveText('Enable Motion')
  await expect(page.locator('#offline-status')).toHaveText('Offline shell ready')
  await expect.poll(() => page.evaluate(() => document.body.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  expect(pageErrors).toEqual([])
})

test('mobile WebKit keeps denied sensor permission recoverable', async ({ page }) => {
  await installMotionHarness(page, 'denied')
  await page.goto('/gamexr/')
  await page.locator('#launch-flight').click()
  await expect(page.locator('#launch-card')).toBeHidden()
  await page.locator('#motion-control').click()

  await expect(page.locator('#motion-control')).toHaveAttribute('data-state', 'denied')
  await expect(page.locator('#motion-control')).toHaveText('Retry Motion')
  await expect(page.locator('#motion-recenter')).toBeHidden()
})

test('mobile WebKit calibrates, recenters, and recalibrates after rotation', async ({ page }) => {
  await installMotionHarness(page, 'granted')
  await page.goto('/gamexr/')
  await page.locator('#launch-flight').click()
  await expect(page.locator('#launch-card')).toBeHidden()
  await page.locator('#motion-control').click()
  await expect(page.locator('#motion-control')).toHaveAttribute('data-state', 'calibrating')

  await dispatchOrientation(page, 12, 3)
  await expect(page.locator('#motion-control')).toHaveAttribute('data-state', 'running')
  await expect(page.locator('#motion-recenter')).toBeVisible()

  await page.locator('#motion-recenter').click()
  await expect(page.locator('#motion-control')).toHaveAttribute('data-state', 'calibrating')
  await dispatchOrientation(page, 20, 4)
  await expect(page.locator('#motion-control')).toHaveAttribute('data-state', 'running')

  await page.evaluate(() => {
    globalThis.__gamexrScreenAngle = 90
    screen.orientation.dispatchEvent(new Event('change'))
  })
  await expect(page.locator('#motion-control')).toHaveAttribute('data-state', 'calibrating')
  await dispatchOrientation(page, 20, 4)
  await expect(page.locator('#motion-control')).toHaveAttribute('data-state', 'running')
})

test('mobile WebKit device orientation moves flight and the shared chase-camera projection', async ({ page }) => {
  await installMotionHarness(page, 'granted')
  await page.goto('/gamexr/')
  await page.locator('#launch-flight').click()
  await page.locator('#motion-control').click()
  await dispatchOrientation(page, 10, 2)
  await expect(page.locator('#motion-control')).toHaveAttribute('data-state', 'running')
  const initial = await page.evaluate(() => window.gameXR.inspect().runtime)

  await dispatchOrientation(page, 55, 24)
  await expect.poll(async () => {
    const current = await page.evaluate(() => window.gameXR.inspect().runtime)
    const rotationDelta = current.rotation.reduce(
      (sum, component, index) => sum + Math.abs(component - initial.rotation[index]!),
      0,
    )
    const cameraDelta = current.camera.position.reduce(
      (sum, component, index) => sum + Math.abs(component - initial.camera.position[index]!),
      0,
    )
    return { flightResponded: rotationDelta > 0.01, cameraFollowed: cameraDelta > 0.01 }
  }).toEqual({ flightResponded: true, cameraFollowed: true })
})

test('installed mobile WebKit service worker boots reload and fresh navigation offline', async ({ page, context }) => {
  test.skip(Boolean(process.env.GAME_XR_E2E_URL), 'The origin-outage harness is a local WebKit proof.')
  const preview = await startDisposablePreview()
  await page.goto(preview.url)
  await expect(page.locator('#offline-status')).toHaveText('Offline shell ready')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).some(name => name.startsWith('gamexr-shell-')))).toBe(true)
  await page.reload()
  await expect(page.locator('#app')).toHaveAttribute('aria-busy', 'false')
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
  const scriptPath = await page.locator('script[type="module"]').getAttribute('src')
  expect(scriptPath).toBeTruthy()

  try {
    const cached = await page.evaluate(async ({ scriptPath }) => {
      const [shell, script] = await Promise.all([
        caches.match(new URL('/gamexr/index.html', document.URL)),
        caches.match(new URL(scriptPath, document.URL)),
      ])
      return {
        shellStatus: shell?.status ?? 0,
        shellText: await shell?.text() ?? '',
        scriptStatus: script?.status ?? 0,
        scriptText: await script?.text() ?? '',
      }
    }, { scriptPath: scriptPath! })
    expect(cached.shellStatus).toBe(200)
    expect(cached.shellText).toContain('<title>GameXR — Spatial flight, under your control</title>')
    expect(cached.scriptStatus).toBe(200)
    expect(cached.scriptText.length).toBeGreaterThan(50_000)

    await stopDisposablePreview(preview.process)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.locator('#app')).toHaveAttribute('aria-busy', 'false')
    await expect(page.locator('#game-canvas')).toBeVisible()

    const freshPage = await context.newPage()
    try {
      await freshPage.goto(preview.url, { waitUntil: 'domcontentloaded' })
      await expect(freshPage.locator('#app')).toHaveAttribute('aria-busy', 'false')
      await expect(freshPage.locator('#game-canvas')).toBeVisible()
    } finally {
      await freshPage.close()
    }
  } finally {
    await stopDisposablePreview(preview.process)
  }
})
