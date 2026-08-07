import { createWebMcpTools, type GameRuntimeControlSurface, type WebMcpTool } from './contracts.ts'

interface ModelContextLike {
  tools?: WebMcpTool[]
  provideContext?: (context: { tools: WebMcpTool[] }) => void
  registerTool?: (tool: WebMcpTool, options?: { signal?: AbortSignal }) => void
}

type NavigatorWithModelContext = Navigator & { modelContext?: ModelContextLike }
type DocumentWithModelContext = Document & { modelContext?: ModelContextLike }

function createFallbackModelContext(tools: WebMcpTool[]): ModelContextLike {
  const registered = [...tools]
  return {
    tools: registered,
    provideContext(context) {
      registered.splice(0, registered.length, ...context.tools)
    },
    registerTool(tool, options) {
      if (options?.signal?.aborted) return
      const priorIndex = registered.findIndex((candidate) => candidate.name === tool.name)
      if (priorIndex >= 0) registered.splice(priorIndex, 1, tool)
      else registered.push(tool)
      options?.signal?.addEventListener('abort', () => {
        const index = registered.findIndex((candidate) => candidate.name === tool.name)
        if (index >= 0) registered.splice(index, 1)
      }, { once: true })
    },
  }
}

export function installWebMcpBridge(runtime: GameRuntimeControlSurface): { tools: WebMcpTool[]; dispose: () => void } {
  const tools = createWebMcpTools(runtime)
  const navigatorObject = navigator as NavigatorWithModelContext
  const documentObject = document as DocumentWithModelContext
  const controllers: AbortController[] = []
  let context = navigatorObject.modelContext ?? documentObject.modelContext
  let state = 'native'

  if (!context) {
    context = createFallbackModelContext(tools)
    Object.defineProperty(navigatorObject, 'modelContext', { configurable: true, writable: true, value: context })
    Object.defineProperty(documentObject, 'modelContext', { configurable: true, writable: true, value: context })
    state = 'fallback-readable'
  } else if (typeof context.provideContext === 'function') {
    context.provideContext({ tools })
  } else if (typeof context.registerTool === 'function') {
    for (const tool of tools) {
      const controller = new AbortController()
      controllers.push(controller)
      context.registerTool(tool, { signal: controller.signal })
    }
  } else {
    context.tools = [...tools]
    state = 'host-readable'
  }

  document.documentElement.dataset.gamexrWebmcp = state
  document.documentElement.dataset.gamexrWebmcpTools = tools.map((tool) => tool.name).join(',')

  return {
    tools,
    dispose: () => {
      for (const controller of controllers) controller.abort()
      if (state === 'fallback-readable') {
        Reflect.deleteProperty(navigatorObject, 'modelContext')
        Reflect.deleteProperty(documentObject, 'modelContext')
      }
      delete document.documentElement.dataset.gamexrWebmcp
      delete document.documentElement.dataset.gamexrWebmcpTools
    },
  }
}
