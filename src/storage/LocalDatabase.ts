import type { SceneManifest } from '../config/types.ts'
import { enforceSpatialBudget, refuse, spatialValuesEqual } from '@agentic-graph/spatial-review'

const DATABASE_NAME = 'gamexr-local-v1'
const DATABASE_VERSION = 1
const SCENE_STORE = 'scenes'
const ASSET_STORE = 'assets'
const META_STORE = 'meta'
const ACTIVE_SCENE_KEY = 'active-scene-id'
const SCENE_REVISION_KEY = 'scene-write-revision'
const reviewKey = (id: string) => `scene-review:${id}`

export interface SceneSnapshot {
  sceneId: string
  scene: SceneManifest | null
  activeSceneId: string | null
  revision: string
  review: unknown
}

export const MAX_LOCAL_ASSET_BYTES = 15 * 1024 * 1024

export interface StoredAsset {
  id: string
  name: string
  mediaType: 'model/gltf-binary'
  byteLength: number
  sha256: string
  createdAt: string
  admission: {
    nodeCount: number
    meshCount: number
    triangleCount: number
    animationNames: string[]
    normalizedSize: number
    source: 'user-local'
    licenseTerms: 'local-use-only-unverified'
    humanReviewStatus: 'unreviewed'
  }
  bytes: ArrayBuffer
}

export type StoredAssetMetadata = Omit<StoredAsset, 'bytes'>

interface MetadataEntry {
  key: string
  value: unknown
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true })
    request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB request failed.')), { once: true })
  })
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true })
    transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('IndexedDB transaction was aborted.')), { once: true })
    transaction.addEventListener('error', () => reject(transaction.error ?? new Error('IndexedDB transaction failed.')), { once: true })
  })
}

function openDatabase(): Promise<IDBDatabase> {
  if (!('indexedDB' in globalThis)) return Promise.reject(new Error('IndexedDB is unavailable in this browser.'))
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)

  request.addEventListener('upgradeneeded', () => {
    const database = request.result
    if (!database.objectStoreNames.contains(SCENE_STORE)) database.createObjectStore(SCENE_STORE, { keyPath: 'id' })
    if (!database.objectStoreNames.contains(ASSET_STORE)) database.createObjectStore(ASSET_STORE, { keyPath: 'id' })
    if (!database.objectStoreNames.contains(META_STORE)) database.createObjectStore(META_STORE, { keyPath: 'key' })
  })

  return requestResult(request)
}

function describeStorageError(error: unknown): Error {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return new Error('Local storage quota is exhausted. Export or remove a saved scene or asset, then retry.')
  }
  return error instanceof Error ? error : new Error('The local database operation failed.')
}

export class LocalDatabase {
  private databasePromise: Promise<IDBDatabase> | null = null

  private database(): Promise<IDBDatabase> {
    this.databasePromise ??= openDatabase()
    return this.databasePromise
  }

  async getActiveSceneId(): Promise<string | null> {
    const database = await this.database()
    const transaction = database.transaction(META_STORE, 'readonly')
    const complete = transactionComplete(transaction)
    const entry = await requestResult(transaction.objectStore(META_STORE).get(ACTIVE_SCENE_KEY)) as MetadataEntry | undefined
    await complete
    return typeof entry?.value === 'string' ? entry.value : null
  }

  async getSceneSnapshot(sceneId: string): Promise<SceneSnapshot> {
    const database = await this.database()
    const transaction = database.transaction([SCENE_STORE, META_STORE], 'readonly')
    const complete = transactionComplete(transaction)
    const meta = transaction.objectStore(META_STORE)
    const [scene, active, revision, review] = await Promise.all([
      requestResult(transaction.objectStore(SCENE_STORE).get(sceneId)), requestResult(meta.get(ACTIVE_SCENE_KEY)),
      requestResult(meta.get(SCENE_REVISION_KEY)), requestResult(meta.get(reviewKey(sceneId))),
    ])
    await complete
    return structuredClone({ sceneId, scene: scene ?? null, activeSceneId: active?.value ?? null,
      revision: revision?.value ?? 'legacy', review: review?.value ?? null }) as SceneSnapshot
  }

  async getScene(id: string): Promise<SceneManifest | null> {
    const database = await this.database()
    const transaction = database.transaction(SCENE_STORE, 'readonly')
    const complete = transactionComplete(transaction)
    const scene = await requestResult(transaction.objectStore(SCENE_STORE).get(id)) as SceneManifest | undefined
    await complete
    return scene ? structuredClone(scene) : null
  }

  async listScenes(): Promise<SceneManifest[]> {
    const database = await this.database()
    const transaction = database.transaction(SCENE_STORE, 'readonly')
    const complete = transactionComplete(transaction)
    const scenes = await requestResult(transaction.objectStore(SCENE_STORE).getAll()) as SceneManifest[]
    await complete
    return scenes.map((scene) => structuredClone(scene)).sort((left, right) => left.name.localeCompare(right.name))
  }

  async saveScene(scene: SceneManifest, makeActive = true, expected?: SceneSnapshot, review?: unknown, check: () => void = () => {}): Promise<string> {
    const candidate = structuredClone(scene), captured = expected && structuredClone(expected)
    const history = review === undefined ? undefined : structuredClone(review)
    enforceSpatialBudget({ scene: candidate, review: history ?? null })
    try {
      const database = await this.database()
      const transaction = database.transaction([SCENE_STORE, META_STORE], 'readwrite')
      const complete = transactionComplete(transaction)
      const scenes = transaction.objectStore(SCENE_STORE), meta = transaction.objectStore(META_STORE)
      const revision = crypto.randomUUID()
      try {
        // Only IndexedDB requests are awaited inside this transaction; no digest or asset work can close it early.
        const [stored, active, priorRevision, target] = await Promise.all([
          requestResult(scenes.get(captured?.sceneId ?? candidate.id)), requestResult(meta.get(ACTIVE_SCENE_KEY)),
          requestResult(meta.get(SCENE_REVISION_KEY)), requestResult(scenes.get(candidate.id)),
        ])
        check()
        if (captured) {
          if ((active?.value ?? null) !== captured.activeSceneId || (priorRevision?.value ?? 'legacy') !== captured.revision
            || !spatialValuesEqual(stored ?? null, captured.scene)) refuse('stale-source', 'The saved scene or active profile changed. Reload before editing.')
          if (candidate.id !== captured.sceneId && target && !spatialValuesEqual(target, candidate)) refuse('conflict', 'An existing target profile has different bytes. Load that profile before replacing it.')
        } else if (stored || active?.value) {
          if (history === undefined && active?.value === candidate.id && spatialValuesEqual(stored, candidate)) {
            await complete
            return priorRevision?.value ?? 'legacy'
          }
          refuse('stale-source', 'Replacing a saved scene requires an expected persisted identity.')
        }
        scenes.put(candidate)
        if (makeActive) meta.put({ key: ACTIVE_SCENE_KEY, value: candidate.id } satisfies MetadataEntry)
        if (history !== undefined) meta.put({ key: reviewKey(candidate.id), value: history } satisfies MetadataEntry)
        meta.put({ key: SCENE_REVISION_KEY, value: revision } satisfies MetadataEntry)
      } catch (error) {
        transaction.abort()
        await complete.catch(() => undefined)
        throw error
      }
      await complete
      return revision
    } catch (error) {
      throw describeStorageError(error)
    }
  }

  async deleteScene(id: string): Promise<void> {
    const database = await this.database()
    const transaction = database.transaction([SCENE_STORE, META_STORE], 'readwrite')
    const complete = transactionComplete(transaction)
    transaction.objectStore(SCENE_STORE).delete(id)
    const metaStore = transaction.objectStore(META_STORE)
    metaStore.delete(reviewKey(id))
    metaStore.put({ key: SCENE_REVISION_KEY, value: crypto.randomUUID() } satisfies MetadataEntry)
    const active = await requestResult(metaStore.get(ACTIVE_SCENE_KEY)) as MetadataEntry | undefined
    if (active?.value === id) metaStore.delete(ACTIVE_SCENE_KEY)
    await complete
  }

  async saveAsset(asset: StoredAsset): Promise<void> {
    try {
      const database = await this.database()
      const transaction = database.transaction(ASSET_STORE, 'readwrite')
      transaction.objectStore(ASSET_STORE).put(asset)
      await transactionComplete(transaction)
    } catch (error) {
      throw describeStorageError(error)
    }
  }

  async getAsset(id: string): Promise<StoredAsset | null> {
    const database = await this.database()
    const transaction = database.transaction(ASSET_STORE, 'readonly')
    const complete = transactionComplete(transaction)
    const asset = await requestResult(transaction.objectStore(ASSET_STORE).get(id)) as StoredAsset | undefined
    await complete
    return asset ?? null
  }

  async listAssets(): Promise<StoredAssetMetadata[]> {
    const database = await this.database()
    const transaction = database.transaction(ASSET_STORE, 'readonly')
    const complete = transactionComplete(transaction)
    const assets = await requestResult(transaction.objectStore(ASSET_STORE).getAll()) as StoredAsset[]
    await complete
    return assets.map(({ bytes: _bytes, ...metadata }) => metadata).sort((left, right) => left.name.localeCompare(right.name))
  }

  async deleteAsset(id: string): Promise<void> {
    const database = await this.database()
    const transaction = database.transaction(ASSET_STORE, 'readwrite')
    transaction.objectStore(ASSET_STORE).delete(id)
    await transactionComplete(transaction)
  }

  close(): void {
    void this.databasePromise?.then((database) => database.close())
    this.databasePromise = null
  }
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  if (await navigator.storage.persisted()) return true
  return navigator.storage.persist()
}

export async function getStorageEstimate(): Promise<StorageEstimate | null> {
  return navigator.storage?.estimate ? navigator.storage.estimate() : null
}
