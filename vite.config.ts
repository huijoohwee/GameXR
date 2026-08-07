import { defineConfig, loadEnv } from 'vite'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const GAME_BASE_PATH = '/gamexr/'
const PRECACHE_STATIC_FILES = [
  ['manifest.webmanifest', 'manifest'],
  ['icons/gamexr.svg', 'icon'],
  ['.well-known/runtime-readiness.json', 'readiness'],
  ['llms.txt', 'agent-discovery'],
  ['sw.js', 'service-worker'],
  ['schemas/default-scene.json', 'contract'],
  ['schemas/gamexr.scene.schema.json', 'contract'],
  ['schemas/apple-spatial-input.schema.json', 'contract'],
] as const

function contentBytes(source: string | Uint8Array): Uint8Array {
  return typeof source === 'string' ? new TextEncoder().encode(source) : source
}

function sha256(source: string | Uint8Array): string {
  return createHash('sha256').update(contentBytes(source)).digest('hex')
}

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), 'VITE_')
  const apex = mode === 'apex' || environment.VITE_APEX_ROOT_ALIAS === '1'
  const base = apex ? '/' : environment.VITE_BASE_PATH || GAME_BASE_PATH
  const serviceWorkerEnabled = base !== '/'

  return {
    base,
    plugins: [
      {
        name: 'gamexr-shared-contracts',
        generateBundle() {
          for (const filename of [
            'default-scene.json',
            'gamexr.scene.schema.json',
            'apple-spatial-input.schema.json',
          ]) {
            this.emitFile({
              type: 'asset',
              fileName: `schemas/${filename}`,
              source: readFileSync(resolve(import.meta.dirname, 'shared', filename), 'utf8'),
            })
          }
        },
      },
      {
        name: 'gamexr-precache-manifest',
        enforce: 'post',
        writeBundle: {
          order: 'post',
          handler(options, bundle) {
            if (!options.dir) throw new Error('GameXR requires a directory build output.')
            const outputDirectory = resolve(options.dir)
            const entries = new Map<string, { path: string; bytes: number; sha256: string; kind: string }>()
            const addEntry = (path: string, kind: string) => {
              const bytes = readFileSync(resolve(outputDirectory, path))
              entries.set(path, { path, bytes: bytes.byteLength, sha256: sha256(bytes), kind })
            }

            for (const output of Object.values(bundle)) {
              if (output.fileName === 'index.html') {
                addEntry(output.fileName, 'document')
                continue
              }
              if (!/\.(?:css|js)$/u.test(output.fileName)) continue
              const kind = output.fileName.endsWith('.css')
                ? 'style'
                : output.type === 'chunk' && output.isDynamicEntry ? 'dynamic-script' : 'script'
              addEntry(output.fileName, kind)
            }

            for (const [outputPath, kind] of PRECACHE_STATIC_FILES) {
              addEntry(outputPath, kind)
            }

            const sortedEntries = [...entries.values()].sort((left, right) => left.path.localeCompare(right.path))
            const digestInput = [base, ...sortedEntries.map((entry) => `${entry.path}\0${entry.bytes}\0${entry.sha256}`)].join('\n')
            const manifest = {
              schema: 'gamexr-precache/v1',
              basePath: base,
              serviceWorkerRegistrationEnabled: serviceWorkerEnabled,
              buildDigest: sha256(digestInput),
              entries: sortedEntries,
            }
            writeFileSync(
              resolve(outputDirectory, 'precache-manifest.json'),
              `${JSON.stringify(manifest, null, 2)}\n`,
            )
          },
        },
      },
    ],
    resolve: {
      alias: [{
        find: /^three$/,
        replacement: resolve(import.meta.dirname, 'node_modules', 'three', 'src', 'Three.js'),
      }],
    },
    appType: 'spa',
    build: {
      target: ['es2022', 'safari18'],
      outDir: apex ? 'dist/apex' : 'dist/gamexr',
      assetsDir: 'assets',
      emptyOutDir: true,
      sourcemap: false,
      reportCompressedSize: true,
      chunkSizeWarningLimit: 500,
      rolldownOptions: {
        output: {
          manualChunks(moduleId) {
            if (moduleId.includes('/node_modules/three/src/renderers/')) return 'three-renderer'
            if (moduleId.includes('/node_modules/three/src/animation/')) return 'three-animation'
            if (moduleId.includes('/node_modules/three/src/loaders/') || moduleId.includes('/node_modules/three/src/textures/')) return 'three-assets'
            if (moduleId.includes('/node_modules/three/src/')) return 'three-core'
            return null
          },
        },
      },
    },
    define: {
      __GAME_XR_BASE_PATH__: JSON.stringify(base),
      __GAME_XR_SERVICE_WORKER_ENABLED__: JSON.stringify(serviceWorkerEnabled),
      __GAME_XR_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
    },
    server: {
      host: '127.0.0.1',
    },
    preview: {
      host: '127.0.0.1',
    },
  }
})
