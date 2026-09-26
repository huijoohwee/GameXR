import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { resolve, sep, extname } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

async function open(page: Page) {
  await page.goto('/gamexr/')
  await expect(page.locator('html')).toHaveAttribute('data-gamexr-runtime', 'idle')
}
async function review(page: Page, scale?: string) {
  await page.getByRole('button', { name: 'Review scene', exact: true }).click()
  await expect(page.locator('#review-scale')).not.toHaveValue('')
  if (scale) {
    await page.getByLabel('Saved scale', { exact: true }).fill(scale)
    await page.getByRole('button', { name: 'Preview change', exact: true }).click()
    await expect(page.locator('#accept-scene-review')).toBeEnabled()
  }
}
async function saved(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('gamexr-local-v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    const tx = db.transaction(['scenes', 'meta', 'assets'], 'readonly')
    const reads = ['scenes', 'meta', 'assets'].map(name => new Promise(resolve => { const r = tx.objectStore(name).getAll(); r.onsuccess = () => resolve(r.result) }))
    const result = await Promise.all(reads); db.close(); return result
  })
}
async function accept(page: Page, count: number) {
  await page.getByRole('button', { name: 'Accept reviewed change', exact: true }).click()
  await expect(page.locator('#scene-review-history')).toContainText(`${count} saved receipt(s)`)
}

test('first value uses four local actions; preview/cancel do not write; accepted history survives reload and undo', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  const started = Date.now(); await open(page)
  const initial = await saved(page)
  const pose = await page.evaluate(() => window.gameXR.inspect().runtime.position)
  await review(page, '2') // open, fill, preview
  expect(await saved(page)).toEqual(initial)
  expect(await page.evaluate(() => window.gameXR.inspect().runtime.position)).toEqual(pose)
  await page.getByRole('button', { name: 'Cancel preview', exact: true }).click()
  expect(await saved(page)).toEqual(initial)
  await page.getByRole('button', { name: 'Preview change', exact: true }).click()
  await accept(page, 1)
  expect(Date.now() - started).toBeLessThan(300_000)
  await expect(page.locator('#review-scale')).toHaveValue('2')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('review-accepted.png'), fullPage: true })
  await page.reload(); await expect(page.locator('#app')).toHaveAttribute('aria-busy', 'false'); await review(page)
  await expect(page.locator('#review-scale')).toHaveValue('2')
  await page.getByRole('button', { name: 'Review undo', exact: true }).click()
  await accept(page, 2)
  await expect(page.locator('#review-scale')).toHaveValue('1')
  expect(errors).toEqual([])
  await info.attach('first-value', { body: JSON.stringify({ source: 'default installed scene; local UI; no host injection', firstValueActions: 4, previewCancelExtraActions: 2, elapsedMs: Date.now() - started, humanSession: false }), contentType: 'application/json' })
})

test('two tabs share one conditional writer; losing approval and an aborted transaction retain exact stored bytes', async ({ page, context }) => {
  await open(page)
  const other = await context.newPage(); await open(other)
  await review(page, '2'); await review(other, '3')
  await accept(page, 1)
  const winner = await saved(page)
  await other.getByRole('button', { name: 'Accept reviewed change', exact: true }).click()
  await expect(other.locator('#scene-review-status')).toContainText(/saved scene|saved source|another view|active profile/i)
  expect(await saved(other)).toEqual(winner)
  await other.getByRole('button', { name: 'Recover saved scene', exact: true }).click()
  await expect(other.locator('#review-scale')).toHaveValue('2')
  await other.getByLabel('Saved scale', { exact: true }).fill('4')
  await other.getByRole('button', { name: 'Preview change', exact: true }).click()
  await other.evaluate(() => {
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function(value, key) {
      if (this.name === 'meta' && String(value?.key).startsWith('scene-review:')) {
        IDBObjectStore.prototype.put = put
        throw new DOMException('Injected receipt write failure', 'QuotaExceededError')
      }
      return put.call(this, value, key)
    }
  })
  await other.getByRole('button', { name: 'Accept reviewed change', exact: true }).click()
  await expect(other.locator('#scene-review-status')).toContainText(/quota|failure/i)
  expect(await saved(other)).toEqual(winner)
})

test('agent preview requires current owner binding and cannot accept or bypass saved-scene review', async ({ page }) => {
  await open(page); const before = await saved(page)
  const result = await page.evaluate(async () => {
    const inspect = window.gameXR.tools.find(t => t.name === 'gamexr.inspect_runtime')!
    const view = await inspect.execute({}) as any
    const source = { schema: view.review.source.schema, sourceKind: view.review.source.sourceKind, sourceToken: view.review.source.token }
    const control = window.gameXR.control
    const invalid = await Promise.all([
      control({ operation: 'preview-scene-edit', source: { ...source, sourceKind: 'graph-workspace' }, edit: { scale: 2 } }),
      control({ operation: 'preview-scene-edit', source, edit: { scale: 2 }, approved: true }),
      control({ operation: 'apply-manifest-patch', patch: { ship: { scale: 2 } } }),
      control({ operation: 'animation-time-scale', timeScale: 2 }),
      control({ operation: 'accept-scene-edit', approved: true }),
    ])
    const preview = await control({ operation: 'preview-scene-edit', source, edit: { scale: 2 } })
    return { invalid, preview, source }
  })
  for (const invalid of result.invalid as any[]) expect(invalid.status).toBe('blocked')
  expect((result.preview as any).review.status).toBe('preview')
  expect(await saved(page)).toEqual(before)
  await review(page); await expect(page.locator('#scene-review-diff')).toContainText('scale: 1 → 2')
  await accept(page, 1)
  await page.reload(); await expect(page.locator('#app')).toHaveAttribute('aria-busy', 'false'); await review(page)
  const stale = await page.evaluate(source => window.gameXR.control({ operation: 'preview-scene-edit', source, edit: { scale: 3 } }), result.source)
  expect((stale as any).status).toBe('blocked')
})

test('export/import round trip retains undo history and rejects partial imports before writes', async ({ page }) => {
  await open(page); await review(page, '2'); await accept(page, 1)
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export scene and history', exact: true }).click()
  const downloaded = await downloadEvent; const bytes = await readFile((await downloaded.path())!)
  const parsed = JSON.parse(bytes.toString())
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.locator('#open-config').click()
  const before = await saved(page)
  await page.locator('#manifest-file').setInputFiles({ name: 'partial.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...parsed, review: null })) })
  await expect(page.locator('#validation-output')).toContainText('complete history')
  expect(await saved(page)).toEqual(before)
  await page.locator('#manifest-file').setInputFiles({ name: 'review.json', mimeType: 'application/json', buffer: bytes })
  await expect(page.locator('#validation-output')).toContainText('Import staged')
  expect(await saved(page)).toEqual(before)
  await page.locator('#apply-manifest').click()
  await expect(page.locator('#validation-output')).toContainText('saved locally')
  await page.locator('#close-config').click(); await page.reload(); await expect(page.locator('#app')).toHaveAttribute('aria-busy', 'false'); await review(page)
  await expect(page.locator('#scene-review-history')).toContainText('imported operator identity unverified')
  await page.getByRole('button', { name: 'Review undo', exact: true }).click(); await accept(page, 2)
  await expect(page.locator('#review-scale')).toHaveValue('1')
})

test('installed offline cold reload supports local review, cancellation, persistence and undo', async ({ page, context }) => {
  // Real origin outage also works in WebKit, whose offline emulation rejects navigation before the worker.
  const root = resolve('dist'), mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' }
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://local').pathname)
      const file = resolve(root, `.${pathname.endsWith('/') ? pathname + 'index.html' : pathname}`)
      if (!file.startsWith(root + sep)) { response.writeHead(403).end(); return }
      const bytes = await readFile(file)
      response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }).end(bytes)
    } catch { response.writeHead(404).end() }
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing disposable origin')
  const url = `http://127.0.0.1:${address.port}/gamexr/`
  const stop = async () => { if (server.listening) { server.closeAllConnections(); await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done())) } }
  try {
    await page.goto(url)
    await expect(page.locator('#offline-status')).toHaveText('Offline shell ready')
    await page.reload(); await expect(page.locator('#app')).toHaveAttribute('aria-busy', 'false')
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
    await stop()
    await page.reload({ waitUntil: 'domcontentloaded' }); await review(page, '2'); await accept(page, 1)
    await page.reload({ waitUntil: 'domcontentloaded' }); await review(page)
    await expect(page.locator('#review-scale')).toHaveValue('2')
    await page.getByRole('button', { name: 'Review undo', exact: true }).click()
    await page.getByRole('button', { name: 'Cancel preview', exact: true }).click()
    await expect(page.locator('#scene-review-history')).toContainText('1 saved receipt(s)')
    await page.getByRole('button', { name: 'Review undo', exact: true }).click(); await accept(page, 2)
    await expect(page.locator('#review-scale')).toHaveValue('1')
    const fresh = await context.newPage(); await fresh.goto(url, { waitUntil: 'domcontentloaded' }); await review(fresh)
    await expect(fresh.locator('#scene-review-history')).toContainText('2 saved receipt(s)')
    await fresh.close()
  } finally { await stop() }
})
