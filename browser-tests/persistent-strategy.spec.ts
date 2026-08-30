import { expect, test, type Page } from '@playwright/test'
import {
  GAME_OS_INDEXED_DB_NAME,
  GAME_OS_INDEXED_DB_STORE,
  GAME_OS_INDEXED_DB_VERSION,
} from 'grph-shared/game-os/index'
import { GAME_XR_WORLD_LEASE_TTL_MILLISECONDS } from '../src/ui/PersistentStrategyController.ts'

async function openStrategyPanel(page: Page): Promise<void> {
  await page.locator('#open-strategy').click()
  await expect(page.locator('#strategy-panel')).toBeVisible()
}

async function setGameOsTestNow(page: Page, value: number): Promise<void> {
  await page.evaluate((next) => {
    const scope = globalThis as typeof globalThis & { setGameOsTestNow?: (time: number) => void }
    if (!scope.setGameOsTestNow) throw new Error('Game OS test clock is missing.')
    scope.setGameOsTestNow(next)
  }, value)
}

async function gameOsEnvelopeBytes(page: Page, worldId: string): Promise<string | null> {
  return page.evaluate(async ({ databaseName, storeName, version, worldId }) => {
    const request = indexedDB.open(databaseName, version)
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.addEventListener('success', () => resolve(request.result), { once: true })
      request.addEventListener('error', () => reject(request.error), { once: true })
    })
    try {
      const transaction = database.transaction(storeName, 'readonly')
      const value = await new Promise<unknown>((resolve, reject) => {
        const read = transaction.objectStore(storeName).get(worldId)
        read.addEventListener('success', () => resolve(read.result), { once: true })
        read.addEventListener('error', () => reject(read.error), { once: true })
      })
      return value ? JSON.stringify((value as { value?: unknown }).value ?? value) : null
    } finally {
      database.close()
    }
  }, {
    databaseName: GAME_OS_INDEXED_DB_NAME,
    storeName: GAME_OS_INDEXED_DB_STORE,
    version: GAME_OS_INDEXED_DB_VERSION,
    worldId,
  })
}

async function corruptGameOsEnvelope(page: Page, worldId: string): Promise<void> {
  await page.evaluate(async ({ databaseName, storeName, version, worldId }) => {
    const request = indexedDB.open(databaseName, version)
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.addEventListener('success', () => resolve(request.result), { once: true })
      request.addEventListener('error', () => reject(request.error), { once: true })
    })
    try {
      const transaction = database.transaction(storeName, 'readwrite')
      const store = transaction.objectStore(storeName)
      const current = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const read = store.get(worldId)
        read.addEventListener('success', () => resolve(read.result as Record<string, unknown>), { once: true })
        read.addEventListener('error', () => reject(read.error), { once: true })
      })
      const revision = String(current.revision ?? '')
      store.put({
        ...current,
        revision,
        value: { schema: 'truncated', worldId, revision },
      })
      await new Promise<void>((resolve, reject) => {
        transaction.addEventListener('complete', () => resolve(), { once: true })
        transaction.addEventListener('abort', () => reject(transaction.error), { once: true })
        transaction.addEventListener('error', () => reject(transaction.error), { once: true })
      })
    } finally {
      database.close()
    }
  }, {
    databaseName: GAME_OS_INDEXED_DB_NAME,
    storeName: GAME_OS_INDEXED_DB_STORE,
    version: GAME_OS_INDEXED_DB_VERSION,
    worldId,
  })
}

test('persistent strategy world commits, arbitrates tabs, restores, and inspects with zero play egress', async ({ page, context }) => {
  const secondPage = await context.newPage()
  const outboundPlayRequests: string[] = []
  try {
    await Promise.all([page, secondPage].map(target => target.addInitScript(() => {
      let now = 1_000_000
      const scope = globalThis as typeof globalThis & { setGameOsTestNow?: (time: number) => void }
      scope.setGameOsTestNow = value => { now = value }
      Date.now = () => now
    })))
    await Promise.all([page.goto('/gamexr/'), secondPage.goto('/gamexr/')])
    await Promise.all([
      expect(page.locator('#app')).toHaveAttribute('aria-busy', 'false'),
      expect(secondPage.locator('#app')).toHaveAttribute('aria-busy', 'false'),
      expect(page.locator('#offline-status')).toHaveText('Offline shell ready'),
      expect(secondPage.locator('#offline-status')).toHaveText('Offline shell ready'),
    ])
    page.on('request', request => outboundPlayRequests.push(request.url()))
    secondPage.on('request', request => outboundPlayRequests.push(request.url()))

    await Promise.all([openStrategyPanel(page), openStrategyPanel(secondPage)])
    await page.locator('#strategy-world-id').fill(' padded-world')
    await page.locator('#strategy-open').click()
    await expect(page.locator('#strategy-status')).toContainText('World action blocked')
    expect(await gameOsEnvelopeBytes(page, ' padded-world')).toBeNull()
    expect(await gameOsEnvelopeBytes(page, 'padded-world')).toBeNull()
    await page.locator('#strategy-world-id').fill('padded-seed-world')
    await page.locator('#strategy-seed').fill(' padded-seed')
    await page.locator('#strategy-open').click()
    await expect(page.locator('#strategy-status')).toContainText('World action blocked')
    expect(await gameOsEnvelopeBytes(page, 'padded-seed-world')).toBeNull()
    await page.locator('#strategy-world-id').fill(' padded-reset')
    await page.locator('#strategy-seed').fill('reset-seed')
    await page.locator('#strategy-reset').click()
    await expect(page.locator('#strategy-status')).toContainText('World action blocked')
    expect(await gameOsEnvelopeBytes(page, ' padded-reset')).toBeNull()
    expect(await gameOsEnvelopeBytes(page, 'padded-reset')).toBeNull()
    await page.locator('#strategy-world-id').fill('padded-reset-seed-world')
    await page.locator('#strategy-seed').fill(' padded-reset-seed')
    await page.locator('#strategy-reset').click()
    await expect(page.locator('#strategy-status')).toContainText('World action blocked')
    expect(await gameOsEnvelopeBytes(page, 'padded-reset-seed-world')).toBeNull()
    await page.locator('#strategy-seed').fill('gamexr-offline')

    const raceWorldId = `race-${Date.now()}`
    await Promise.all([
      page.locator('#strategy-world-id').fill(raceWorldId),
      secondPage.locator('#strategy-world-id').fill(raceWorldId),
    ])
    await Promise.all([
      page.locator('#strategy-open').click(),
      secondPage.locator('#strategy-open').click(),
    ])
    await expect.poll(async () => Number(await page.locator('#strategy-live').isVisible())
      + Number(await secondPage.locator('#strategy-live').isVisible())).toBe(1)
    const raceWinner = await page.locator('#strategy-live').isVisible() ? page : secondPage
    const raceLoser = raceWinner === page ? secondPage : page
    await expect(raceLoser.locator('#strategy-status')).toContainText('World action blocked')
    const bytesAfterRace = await gameOsEnvelopeBytes(page, raceWorldId)
    expect(bytesAfterRace).not.toBeNull()
    await raceLoser.locator('#strategy-open').click()
    await expect(raceLoser.locator('#strategy-status')).toContainText('World action blocked')
    expect(await gameOsEnvelopeBytes(page, raceWorldId)).toBe(bytesAfterRace)
    await raceWinner.locator('#strategy-close').click()
    await expect(raceWinner.locator('#strategy-live')).toBeHidden()

    const corruptWorldId = `corrupt-${Date.now()}`
    await page.locator('#strategy-world-id').fill(corruptWorldId)
    await page.locator('#strategy-open').click()
    await expect(page.locator('#strategy-live')).toBeVisible()
    await page.locator('#strategy-close').click()
    await corruptGameOsEnvelope(page, corruptWorldId)
    const corruptBytes = await gameOsEnvelopeBytes(page, corruptWorldId)
    await page.locator('#strategy-open').click()
    await expect(page.locator('#strategy-status')).toContainText('World action blocked')
    await expect(page.locator('#strategy-live')).toBeHidden()
    expect(await gameOsEnvelopeBytes(page, corruptWorldId)).toBe(corruptBytes)
    await page.locator('#strategy-reset').click()
    await expect(page.locator('#strategy-status')).toContainText('reset explicitly')
    expect(await gameOsEnvelopeBytes(page, corruptWorldId)).not.toBe(corruptBytes)
    await page.locator('#strategy-open').click()
    await expect(page.locator('#strategy-live')).toBeVisible()
    await expect(page.locator('#strategy-tick')).toHaveText('0')
    await page.locator('#strategy-move').click()
    await expect(page.locator('#strategy-tick')).toHaveText('1')
    await page.locator('#strategy-reset').click()
    await expect(page.locator('#strategy-live')).toBeVisible()
    await expect(page.locator('#strategy-tick')).toHaveText('0')
    await expect(page.locator('#strategy-status')).toContainText('ready to continue')
    await expect(page.locator('#strategy-move')).toBeEnabled()
    await page.locator('#strategy-close').click()

    await Promise.all([
      page.locator('#strategy-world-id').fill('local-frontier'),
      secondPage.locator('#strategy-world-id').fill('local-frontier'),
    ])

    const takeoverWorldId = `takeover-${Date.now()}`
    await Promise.all([setGameOsTestNow(page, 2_000_000), setGameOsTestNow(secondPage, 2_000_000)])
    await page.evaluate(async ({ worldId }) => {
      const tool = window.gameXR.tools.find(candidate => candidate.name === 'agenticgraph.control_local_world')
      if (!tool) throw new Error('Game OS control tool is missing.')
      await tool.execute({
        operation: 'resume', playerActionConfirmed: true, worldId,
        seed: 'takeover-seed',
      })
    }, { worldId: takeoverWorldId })
    await expect(page.locator('#strategy-live')).toBeVisible()
    expect(GAME_XR_WORLD_LEASE_TTL_MILLISECONDS).toBeLessThan(3 * 60_000)
    await setGameOsTestNow(secondPage, 2_000_000 + GAME_XR_WORLD_LEASE_TTL_MILLISECONDS + 1)
    await secondPage.evaluate(async ({ worldId }) => {
      const tool = window.gameXR.tools.find(candidate => candidate.name === 'agenticgraph.control_local_world')
      if (!tool) throw new Error('Game OS control tool is missing.')
      await tool.execute({
        operation: 'resume', playerActionConfirmed: true, worldId,
        seed: 'takeover-seed',
      })
    }, { worldId: takeoverWorldId })
    await expect(secondPage.locator('#strategy-live')).toBeVisible()
    const staleToolError = await page.evaluate(async ({ worldId }) => {
      const tool = window.gameXR.tools.find(candidate => candidate.name === 'agenticgraph.control_local_world')
      if (!tool) throw new Error('Game OS control tool is missing.')
      try {
        await tool.execute({ operation: 'commit', playerActionConfirmed: true, worldId })
        return null
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    }, { worldId: takeoverWorldId })
    expect(staleToolError).toMatch(/lease|changed/u)
    await expect(page.locator('#strategy-live')).toBeHidden()
    await expect(page.locator('#strategy-status')).toContainText('local writer session was closed')
    await secondPage.evaluate(async ({ worldId }) => {
      const tool = window.gameXR.tools.find(candidate => candidate.name === 'agenticgraph.control_local_world')
      if (!tool) throw new Error('Game OS control tool is missing.')
      await tool.execute({ operation: 'close', playerActionConfirmed: true, worldId })
    }, { worldId: takeoverWorldId })
    await expect(secondPage.locator('#strategy-live')).toBeHidden()
    await Promise.all([setGameOsTestNow(page, 3_000_000), setGameOsTestNow(secondPage, 3_000_000)])

    const initialPosition = await page.evaluate(() => window.gameXR.inspect().runtime.position)
    await page.evaluate(async () => {
      await window.gameXR.control({ operation: 'set-controls', throttle: 1 })
      await window.gameXR.control({ operation: 'start' })
    })
    await expect.poll(async () => page.evaluate((initial) => {
      const current = window.gameXR.inspect().runtime.position
      return current.some((value, index) => Math.abs(value - initial[index]!) > 0.1)
    }, initialPosition)).toBe(true)
    await page.evaluate(() => window.gameXR.control({ operation: 'pause' }))

    await openStrategyPanel(page)
    await page.locator('#strategy-open').click()
    await expect(page.locator('#strategy-live')).toBeVisible()
    await expect(page.locator('canvas')).toHaveAttribute('data-gamexr-persistent-strategy', 'visible')
    await expect(page.locator('canvas')).toHaveAttribute('data-gamexr-persistent-strategy-anchor', 'camera')
    await page.locator('#strategy-layout-radius').evaluate((input: HTMLInputElement) => {
      input.value = '6'
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await expect(page.locator('canvas')).toHaveAttribute('data-gamexr-persistent-strategy-layout-radius', '6')
    await page.evaluate(() => window.gameXR.control({
      operation: 'strategy-visuals',
      strategyVisuals: { layoutRadius: 5, unitScale: 1.25 },
    }))
    await expect(page.locator('canvas')).toHaveAttribute('data-gamexr-persistent-strategy-layout-radius', '5')
    await expect(page.locator('#strategy-layout-radius')).toHaveValue('5')
    await expect(page.locator('#strategy-tick')).toHaveText('0')
    await expect(page.locator('.strategy-territory')).toHaveCount(6)
    const factionControls = await page.evaluate(() => {
      const liveFactionIds = new Set([
        ...[...document.querySelectorAll<HTMLElement>('.strategy-territory')]
          .map(card => card.dataset.owner)
          .filter((factionId): factionId is string => Boolean(factionId && factionId !== 'neutral')),
        ...[...document.querySelectorAll<HTMLOptionElement>('#strategy-unit option')]
          .map(option => option.dataset.factionId)
          .filter((factionId): factionId is string => Boolean(factionId)),
      ])
      const controlFactionIds = [...document.querySelectorAll<HTMLInputElement>('#strategy-faction-colors input')]
        .map(input => input.dataset.factionId)
        .filter((factionId): factionId is string => Boolean(factionId))
      const selectedFactionId = (document.querySelector('#strategy-unit') as HTMLSelectElement | null)
        ?.selectedOptions[0]?.dataset.factionId
      return {
        liveFactionIds: [...liveFactionIds].sort(),
        controlFactionIds: controlFactionIds.sort(),
        selectedFactionId,
        supplyLabel: document.querySelector('#strategy-supply-label')?.textContent,
      }
    })
    expect(factionControls.controlFactionIds).toEqual(factionControls.liveFactionIds)
    expect(factionControls.supplyLabel).toBe(factionControls.selectedFactionId)
    const wrongWorldErrors = await page.evaluate(async () => {
      const tool = window.gameXR.tools.find(candidate => candidate.name === 'agenticgraph.control_local_world')
      if (!tool) throw new Error('Game OS control tool is missing.')
      const invokeAndCapture = async (input: Record<string, unknown>): Promise<string | null> => {
        try {
          await tool.execute(input)
          return null
        } catch (error) {
          return error instanceof Error ? error.message : String(error)
        }
      }
      return Promise.all([
        invokeAndCapture({
          operation: 'commit', playerActionConfirmed: true, worldId: 'other-frontier',
        }),
        invokeAndCapture({
          operation: 'resume', playerActionConfirmed: true, worldId: 'other-frontier', seed: 'other-seed',
        }),
      ])
    })
    expect(wrongWorldErrors[0]).toMatch(/not open/u)
    expect(wrongWorldErrors[1]).toMatch(/already owns/u)
    await expect(page.locator('#strategy-live')).toBeVisible()
    await expect(page.locator('#strategy-tick')).toHaveText('0')
    await page.evaluate(async () => {
      const unitId = (document.querySelector('#strategy-unit') as HTMLSelectElement | null)?.value
      const targetTerritoryId = (document.querySelector('#strategy-target') as HTMLSelectElement | null)?.value
      if (!unitId || !targetTerritoryId) throw new Error('Strategy order controls are not ready.')
      const factionId = (document.querySelector('#strategy-unit') as HTMLSelectElement | null)
        ?.selectedOptions[0]?.dataset.factionId
      if (!factionId) throw new Error(`Strategy faction metadata is missing for ${unitId}.`)
      const tool = window.gameXR.tools.find(candidate => candidate.name === 'agenticgraph.control_local_world')
      if (!tool) throw new Error('Game OS control tool is missing.')
      await tool.execute({
        operation: 'order',
        playerActionConfirmed: true,
        worldId: 'local-frontier',
        orders: [{
          type: 'move-unit', sequence: 1, factionId, unitId, targetTerritoryId,
        }],
      })
    })
    await page.locator('#strategy-close').click()
    await expect(page.locator('#strategy-live')).toBeHidden()
    const queuedStatus = await page.evaluate(async () => {
      const tool = window.gameXR.tools.find(candidate => candidate.name === 'agenticgraph.inspect_game_os')
      if (!tool) throw new Error('Game OS inspection tool is missing.')
      return tool.execute({ view: 'world_continuity', worldId: 'local-frontier' })
    }) as { entries: Array<{ pendingOrderCount: number; restoredTick: number }> }
    expect(queuedStatus.entries[0]).toMatchObject({ pendingOrderCount: 1, restoredTick: 0 })
    await page.locator('#strategy-open').click()
    await expect(page.locator('#strategy-live')).toBeVisible()
    await expect(page.locator('#strategy-tick')).toHaveText('0')
    await page.locator('#strategy-move').click()
    await expect(page.locator('#strategy-live')).toBeVisible()
    await expect(page.locator('#strategy-tick')).toHaveText('0')
    await expect(page.locator('#strategy-status')).toContainText('externally accepted orders')
    await page.evaluate(async () => {
      const tool = window.gameXR.tools.find(candidate => candidate.name === 'agenticgraph.control_local_world')
      if (!tool) throw new Error('Game OS control tool is missing.')
      await tool.execute({
        operation: 'commit', playerActionConfirmed: true, worldId: 'local-frontier',
      })
    })
    await expect(page.locator('#strategy-tick')).toHaveText('1')
    await page.locator('#strategy-move').click()
    await expect(page.locator('#strategy-tick')).toHaveText('2')
    await expect(page.locator('#strategy-status')).toContainText('No network or model call was made')
    const committedDigest = await page.locator('#strategy-digest').textContent()
    expect(committedDigest).toMatch(/^fnv1a32:[0-9a-f]{8}$/u)

    const toolNames = await page.evaluate(() => window.gameXR.tools.map(tool => tool.name))
    expect(toolNames).toEqual([
      'gamexr.inspect_runtime',
      'gamexr.control_runtime',
      'agenticgraph.inspect_game_os',
      'agenticgraph.control_local_world',
    ])
    const bytesBeforeStatus = await gameOsEnvelopeBytes(page, 'local-frontier')
    const status = await page.evaluate(async () => {
      const tool = window.gameXR.tools.find(candidate => candidate.name === 'agenticgraph.inspect_game_os')
      if (!tool) throw new Error('Game OS inspection tool is missing.')
      return tool.execute({ view: 'world_continuity', worldId: 'local-frontier' })
    }) as { entries: Array<{ restoredTick: number }>; costRecord: { estimated_cost_usd: number } }
    expect(status.entries[0]?.restoredTick).toBe(2)
    expect(status.costRecord.estimated_cost_usd).toBe(0)
    expect(await gameOsEnvelopeBytes(page, 'local-frontier')).toBe(bytesBeforeStatus)

    await openStrategyPanel(secondPage)
    await secondPage.locator('#strategy-open').click()
    await expect(secondPage.locator('#strategy-status')).toContainText('World action blocked')
    await expect(secondPage.locator('#strategy-live')).toBeHidden()
    expect(await gameOsEnvelopeBytes(page, 'local-frontier')).toBe(bytesBeforeStatus)

    await page.locator('#strategy-close').click()
    await expect(page.locator('#strategy-live')).toBeHidden()
    await secondPage.locator('#strategy-open').click()
    await expect(secondPage.locator('#strategy-live')).toBeVisible()
    await expect(secondPage.locator('#strategy-tick')).toHaveText('2')
    await expect(secondPage.locator('#strategy-digest')).toHaveText(committedDigest ?? '')
    await secondPage.locator('#strategy-close').click()
    expect(outboundPlayRequests).toEqual([])
  } finally {
    await secondPage.close()
  }
})
