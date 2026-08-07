import type { SceneManifest } from '../config/types.ts'

const DATABASE_NAME = 'gamexr-local-v1'
const DATABASE_VERSION = 1
const SCENE_STORE = 'scenes'
const ASSET_STORE = 'assets'
const META_STORE = 'meta'
const ACTIVE_SCENE_KEY = 'active-scene-id'

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
  value: string
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
    return entry?.value ?? null
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

  async saveScene(scene: SceneManifest, makeActive = true): Promise<void> {
    try {
      const database = await this.database()
      const stores = makeActive ? [SCENE_STORE, META_STORE] : [SCENE_STORE]
      const transaction = database.transaction(stores, 'readwrite')
      transaction.objectStore(SCENE_STORE).put(structuredClone(scene))
      if (makeActive) {
        transaction.objectStore(META_STORE).put({ key: ACTIVE_SCENE_KEY, value: scene.id } satisfies MetadataEntry)
      }
      await transactionComplete(transaction)
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
