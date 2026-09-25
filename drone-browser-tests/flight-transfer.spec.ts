import { expect, test } from '@playwright/test'

const path = JSON.stringify({ schema: 'agentic-drone-flight-path/v2', sourceUrl: 'https://graph.test/?kgDoc=flight.py',
  model: 'kinematic', physicalAircraft: false, tickRate: 60, coordinateFrame: 'local-xz-altitude-m-heading-deg',
  sourceDigest: 'a'.repeat(64), sceneDigest: 'b'.repeat(64),
  samples: Array.from({ length: 121 }, (_, i) => [i, 0, 0, 0, Math.min(i, 120 - i) / 60]) })

test('paste and phone link open the same review without connecting; invalid replacement clears the old path', async ({ page, context }) => {
  await page.goto('/gamexr/?drone=1')
  await page.getByText('Paste flight path', { exact: true }).click()
  await page.getByLabel('Flight path JSON', { exact: true }).fill(path)
  await page.getByRole('button', { name: 'Review pasted path' }).click()
  await expect(page.locator('[data-path-summary]')).toContainText('Ready for review · 2.0 s · 121 samples')
  await expect(page.getByRole('button', { name: 'Run flight path' })).toBeDisabled()
  await expect(page.locator('#drone-status')).toHaveText('Disconnected')
  await expect(page.getByRole('button', { name: 'Enable bench control', exact: true })).toBeDisabled()
  await page.getByText('Share flight with iPhone', { exact: true }).click()
  const pair = 'a'.repeat(64)
  await page.getByLabel('Phone GameXR or pairing link', { exact: true }).fill('https://192.168.0.2:4196/gamexr/#pair=' + pair)
  await page.getByRole('button', { name: 'Create phone link' }).click()
  await expect(page.locator('[data-path-share-status]')).toContainText('Ready to copy')
  const url = new URL(await page.getByLabel('Phone flight link', { exact: true }).inputValue())
  // Browser compression / review proof; TLS pairing itself is covered by the native gateway test.
  const phone = await context.newPage()
  await phone.goto('/gamexr/' + url.search + url.hash)
  await expect(phone.locator('[data-path-summary]')).toContainText('Ready for review · 2.0 s · 121 samples')
  expect(new URL(phone.url()).hash).toBe('#pair=' + pair)
  await expect(phone.getByRole('link', { name: /Open source in Graph/u })).toHaveAttribute('href', 'https://graph.test/?kgDoc=flight.py')
  await expect(phone.getByRole('button', { name: 'Run flight path' })).toBeDisabled()
  const size = await phone.locator('.drone-panel').evaluate(e => ({ scroll: e.scrollWidth, width: e.clientWidth }))
  expect(size.scroll).toBeLessThanOrEqual(size.width + 1)
  await phone.close()
  await page.getByLabel('Flight path JSON', { exact: true }).fill('{}')
  await page.getByRole('button', { name: 'Review pasted path' }).click()
  await expect(page.getByRole('button', { name: 'Create phone link' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Run flight path' })).toBeDisabled()
  await expect(page.getByRole('link', { name: /Open source in Graph/u })).toBeHidden()
})

test('one-shot browser handoff ignores foreign messages and replay, imports for review only', async ({ page, context, baseURL }) => {
  const channel = 'a'.repeat(32), origin = 'http://graph.example.test'
  const destination = `${baseURL}/gamexr/?drone=1#flightChannel=${channel}&flightOrigin=${encodeURIComponent(origin)}`
  await context.route(origin + '/send', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><button id="open">Open</button><button id="send">Send</button><p id="reply"></p><script>
    let target; const data = ${JSON.stringify({ protocol: 'agentic-drone-flight-handoff/v1', channel, kind: 'path', text: path })};
    document.querySelector('#open').onclick = () => target = window.open(${JSON.stringify(destination)}, '_blank');
    document.querySelector('#send').onclick = () => target.postMessage(data, ${JSON.stringify(baseURL)});
    onmessage = e => { if (e.source === target) document.querySelector('#reply').textContent = e.data.kind; };
    </script>` }))
  await page.goto(origin + '/send')
  const popup = page.waitForEvent('popup'); await page.getByText('Open', { exact: true }).click(); const game = await popup
  await expect(page.locator('#reply')).toHaveText('ready')
  await game.evaluate(({ text, channel }) => window.postMessage({ protocol: 'agentic-drone-flight-handoff/v1', channel, kind: 'path', text }, location.origin), { text: path, channel })
  await expect(game.locator('[data-path-summary]')).toContainText('Waiting for the flight path')
  await page.getByText('Send', { exact: true }).click()
  await expect(page.locator('#reply')).toHaveText('accepted')
  await expect(game.locator('[data-path-summary]')).toContainText('Ready for review · 2.0 s')
  await expect(game.getByRole('button', { name: 'Run flight path' })).toBeDisabled()
  await game.getByText('Paste flight path', { exact: true }).click()
  await game.getByLabel('Flight path JSON', { exact: true }).fill('{}')
  await game.getByRole('button', { name: 'Review pasted path' }).click()
  await page.getByText('Send', { exact: true }).click()
  await expect(game.locator('[data-path-summary]')).toContainText('Unsupported or missing')
  await expect(game.getByRole('button', { name: 'Run flight path' })).toBeDisabled()
  await game.close()
})
