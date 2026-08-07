import './styles.css'
import { getDefaultSceneManifest, validateSceneManifest } from './config/manifest.ts'
import type { SceneManifest } from './config/types.ts'
import { installWebMcpBridge } from './mcp/WebMcpBridge.ts'
import { GAME_XR_WEB_MCP_TOOLS } from './mcp/contracts.ts'
import { GameRuntime } from './runtime/GameRuntime.ts'
import { LocalDatabase } from './storage/LocalDatabase.ts'
import { AppController } from './ui/AppController.ts'
import { renderShell } from './ui/shell.ts'

const SERVICE_WORKER_READY_TIMEOUT_MILLISECONDS = 15_000

async function loadInitialManifest(database: LocalDatabase): Promise<{ manifest: SceneManifest; warning?: string }> {
  const activeSceneId = await database.getActiveSceneId()
  if (activeSceneId) {
    const stored = await database.getScene(activeSceneId)
    if (stored) {
      const validation = validateSceneManifest(stored)
      if (validation.ok) return { manifest: validation.value }
      return {
        manifest: getDefaultSceneManifest(),
        warning: `Saved scene “${activeSceneId}” failed validation and was preserved without activation.`,
      }
    }
  }
  const manifest = getDefaultSceneManifest()
  await database.saveScene(manifest)
  return { manifest }
}

async function registerOfflineShell(): Promise<void> {
  const output = document.getElementById('offline-status')
  const updateConnectivity = () => {
    if (!output) return
    output.textContent = navigator.onLine ? 'Online · local runtime' : 'Offline · local runtime'
  }
  window.addEventListener('online', updateConnectivity)
  window.addEventListener('offline', updateConnectivity)
  updateConnectivity()

  if (!__GAME_XR_SERVICE_WORKER_ENABLED__) {
    if (import.meta.env.PROD && output) output.textContent = 'Online · local runtime · Apex cache disabled'
    return
  }
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  try {
    await navigator.serviceWorker.register(`${__GAME_XR_BASE_PATH__}sw.js`, { scope: __GAME_XR_BASE_PATH__ })
    let timeout = 0
    try {
      await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<never>((_, reject) => {
          timeout = window.setTimeout(
            () => reject(new Error('The verified offline cache did not become ready in time.')),
            SERVICE_WORKER_READY_TIMEOUT_MILLISECONDS,
          )
        }),
      ])
    } finally {
      window.clearTimeout(timeout)
    }
    if (output) output.textContent = 'Offline shell ready'
  } catch (error) {
    if (output) output.textContent = error instanceof Error ? `Offline shell blocked: ${error.message}` : 'Offline shell blocked'
  }
}

async function boot(): Promise<void> {
  const root = document.getElementById('app')
  if (!root) throw new Error('GameXR application root is missing.')
  const canvas = renderShell(root)
  const database = new LocalDatabase()
  const { manifest, warning } = await loadInitialManifest(database)
  const runtime = new GameRuntime(canvas, manifest, database)
  await runtime.initialize()
  const controller = new AppController(runtime, database)
  await controller.initialize()
  const bridge = installWebMcpBridge(runtime)
  const controlTool = bridge.tools.find((tool) => tool.name === GAME_XR_WEB_MCP_TOOLS.control)
  if (!controlTool) throw new Error('GameXR control tool was not installed.')

  window.gameXR = {
    version: __GAME_XR_VERSION__,
    basePath: __GAME_XR_BASE_PATH__,
    tools: bridge.tools,
    inspect: () => ({ runtime: runtime.inspect(), manifest: runtime.manifest }),
    control: (input) => controlTool.execute(input),
  }
  document.documentElement.dataset.gamexrVersion = __GAME_XR_VERSION__
  if (warning) {
    const status = document.getElementById('stage-status')
    if (status) status.textContent = warning
  }
  await registerOfflineShell()

  window.addEventListener('pagehide', (event) => {
    if (event.persisted) return
    controller.dispose()
    bridge.dispose()
    void runtime.dispose()
  }, { once: true })
}

void boot().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'GameXR failed to start.'
  document.documentElement.dataset.gamexrRuntime = 'blocked'
  const status = document.getElementById('stage-status')
  if (status) status.textContent = message
  else document.body.textContent = message
  console.error('[GameXR] startup blocked:', error)
})
