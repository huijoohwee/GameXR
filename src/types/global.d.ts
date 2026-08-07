import type { RuntimeTelemetry, SceneManifest } from '../config/types.ts'
import type { WebMcpTool } from '../mcp/contracts.ts'

declare global {
  interface Window {
    gameXR: {
      version: string
      basePath: string
      tools: WebMcpTool[]
      inspect: () => { runtime: RuntimeTelemetry; manifest: SceneManifest }
      control: (input: unknown) => Promise<unknown>
    }
  }
}

export {}
