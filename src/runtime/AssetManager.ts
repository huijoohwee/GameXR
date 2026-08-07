import {
  Box3,
  Group,
  Light,
  Mesh,
  SkinnedMesh,
  Vector3,
  type AnimationClip,
  type Object3D,
} from 'three'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import {
  LocalDatabase,
  MAX_LOCAL_ASSET_BYTES,
  type StoredAsset,
  type StoredAssetMetadata,
} from '../storage/LocalDatabase.ts'

const GLB_MAGIC = 0x46546c67
const GLB_JSON_CHUNK = 0x4e4f534a
const GLB_BINARY_CHUNK = 0x004e4942
const MAX_JSON_BYTES = 2 * 1024 * 1024
const MAX_NODES = 1500
const MAX_TRIANGLES = 250_000
const MAX_LIGHTS = 4
const MAX_ANIMATIONS = 32
const MAX_ANIMATION_SECONDS = 300
const MAX_ACCESSORS = 4096
const MAX_IMAGES = 16
const MAX_IMAGE_BYTES = 4 * 1024 * 1024
const MAX_IMAGE_DIMENSION = 4096
const MAX_IMAGE_PIXELS = 16_777_216
const NORMALIZED_MODEL_SIZE = 4

interface GlbDocument {
  document: Record<string, unknown>
  binaryOffset: number
  binaryLength: number
}

interface ParsedAsset {
  root: Group
  animations: AnimationClip[]
  admission: StoredAsset['admission']
}

export interface ImportedAsset extends ParsedAsset {
  metadata: StoredAssetMetadata
}

function glbDocument(bytes: ArrayBuffer): GlbDocument {
  if (bytes.byteLength < 20) throw new Error('GLB file is too short to contain a valid header and JSON chunk.')
  const view = new DataView(bytes)
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error('Asset is not a binary glTF file.')
  if (view.getUint32(4, true) !== 2) throw new Error('Only glTF 2.0 binary assets are supported.')
  if (view.getUint32(8, true) !== bytes.byteLength) throw new Error('GLB declared byte length does not match the file.')
  const jsonLength = view.getUint32(12, true)
  const jsonType = view.getUint32(16, true)
  if (jsonType !== GLB_JSON_CHUNK || jsonLength <= 0 || jsonLength > MAX_JSON_BYTES || jsonLength + 20 > bytes.byteLength) {
    throw new Error('GLB JSON chunk is missing or malformed.')
  }
  const jsonText = new TextDecoder().decode(new Uint8Array(bytes, 20, jsonLength)).replace(/[\u0000\s]+$/u, '')
  const parsed = JSON.parse(jsonText) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('GLB JSON root must be an object.')
  const binaryHeaderOffset = 20 + jsonLength
  if (binaryHeaderOffset + 8 > bytes.byteLength || view.getUint32(binaryHeaderOffset + 4, true) !== GLB_BINARY_CHUNK) {
    throw new Error('GLB binary chunk is missing or malformed.')
  }
  const binaryLength = view.getUint32(binaryHeaderOffset, true)
  const binaryOffset = binaryHeaderOffset + 8
  if (binaryLength <= 0 || binaryOffset + binaryLength > bytes.byteLength) throw new Error('GLB binary chunk exceeds the file bounds.')
  return { document: parsed as Record<string, unknown>, binaryOffset, binaryLength }
}

function assertNoExternalResources(document: Record<string, unknown>): void {
  for (const collectionName of ['buffers', 'images']) {
    const collection = document[collectionName]
    if (!Array.isArray(collection)) continue
    for (const entry of collection) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
      const uri = (entry as Record<string, unknown>).uri
      if (typeof uri === 'string' && !uri.startsWith('data:')) {
        throw new Error(`External ${collectionName} URI is not allowed; import a self-contained GLB.`)
      }
    }
  }
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
    : []
}

function boundedInteger(value: unknown, name: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    throw new Error(`${name} must be a bounded non-negative integer.`)
  }
  return value as number
}

async function preflightGlb(glb: GlbDocument, bytes: ArrayBuffer): Promise<void> {
  const document = glb.document
  assertNoExternalResources(document)
  const nodes = records(document.nodes)
  if (nodes.length > MAX_NODES) throw new Error(`GLB declares ${nodes.length} nodes; the mobile limit is ${MAX_NODES}.`)
  const animations = records(document.animations)
  if (animations.length > MAX_ANIMATIONS) throw new Error(`GLB declares ${animations.length} clips; the limit is ${MAX_ANIMATIONS}.`)

  const buffers = records(document.buffers)
  if (buffers.length !== 1 || buffers[0]?.uri !== undefined) throw new Error('A self-contained GLB must contain one URI-free binary buffer.')
  const declaredBufferLength = boundedInteger(buffers[0]?.byteLength, 'buffers[0].byteLength', MAX_LOCAL_ASSET_BYTES)
  if (declaredBufferLength > glb.binaryLength) throw new Error('The declared GLB buffer exceeds its binary chunk.')

  const accessors = records(document.accessors)
  if (accessors.length > MAX_ACCESSORS) throw new Error(`GLB declares too many accessors; the limit is ${MAX_ACCESSORS}.`)
  for (const [index, accessor] of accessors.entries()) {
    boundedInteger(accessor.count, `accessors[${index}].count`, 1_000_000)
    if (accessor.sparse !== undefined) throw new Error('Sparse glTF accessors are not admitted on the mobile local runtime.')
  }

  const bufferViews = records(document.bufferViews)
  for (const [index, bufferView] of bufferViews.entries()) {
    if (bufferView.buffer !== 0) throw new Error(`bufferViews[${index}] must reference the GLB binary buffer.`)
    const offset = boundedInteger(bufferView.byteOffset ?? 0, `bufferViews[${index}].byteOffset`, glb.binaryLength)
    const length = boundedInteger(bufferView.byteLength, `bufferViews[${index}].byteLength`, glb.binaryLength)
    if (offset + length > declaredBufferLength) throw new Error(`bufferViews[${index}] exceeds the declared GLB buffer.`)
  }

  let triangleCount = 0
  for (const mesh of records(document.meshes)) {
    for (const primitive of records(mesh.primitives)) {
      if ((primitive.mode ?? 4) !== 4) throw new Error('Only triangle-list glTF mesh primitives are admitted.')
      const attributes = primitive.attributes && typeof primitive.attributes === 'object' && !Array.isArray(primitive.attributes)
        ? primitive.attributes as Record<string, unknown>
        : {}
      const accessorIndex = primitive.indices ?? attributes.POSITION
      const accessor = typeof accessorIndex === 'number' ? accessors[accessorIndex] : undefined
      if (!accessor) throw new Error('Every mesh primitive needs a valid index or POSITION accessor.')
      triangleCount += boundedInteger(accessor.count, 'mesh primitive accessor count', 1_000_000) / 3
      if (triangleCount > MAX_TRIANGLES) throw new Error(`GLB declares more than ${MAX_TRIANGLES} triangles.`)
    }
  }

  const images = records(document.images)
  if (images.length > MAX_IMAGES) throw new Error(`GLB declares ${images.length} images; the limit is ${MAX_IMAGES}.`)
  let totalPixels = 0
  for (const [index, image] of images.entries()) {
    if (image.uri !== undefined) throw new Error('Image data URIs are not admitted; embed images through GLB bufferViews.')
    const bufferViewIndex = boundedInteger(image.bufferView, `images[${index}].bufferView`, bufferViews.length - 1)
    const bufferView = bufferViews[bufferViewIndex]
    if (!bufferView) throw new Error(`images[${index}] references a missing bufferView.`)
    const mimeType = image.mimeType
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(String(mimeType))) {
      throw new Error(`images[${index}] has an unsupported MIME type.`)
    }
    const offset = boundedInteger(bufferView.byteOffset ?? 0, `bufferViews[${bufferViewIndex}].byteOffset`, glb.binaryLength)
    const length = boundedInteger(bufferView.byteLength, `bufferViews[${bufferViewIndex}].byteLength`, MAX_IMAGE_BYTES)
    if (typeof createImageBitmap !== 'function') throw new Error('Safe image-dimension admission is unavailable in this browser.')
    const imageBytes = bytes.slice(glb.binaryOffset + offset, glb.binaryOffset + offset + length)
    const bitmap = await createImageBitmap(new Blob([imageBytes], { type: String(mimeType) }))
    try {
      if (bitmap.width > MAX_IMAGE_DIMENSION || bitmap.height > MAX_IMAGE_DIMENSION) {
        throw new Error(`images[${index}] exceeds the ${MAX_IMAGE_DIMENSION}px texture dimension limit.`)
      }
      totalPixels += bitmap.width * bitmap.height
      if (totalPixels > MAX_IMAGE_PIXELS) throw new Error('GLB decoded textures exceed the mobile pixel budget.')
    } finally {
      bitmap.close()
    }
  }
}

async function digestHex(bytes: ArrayBuffer): Promise<string> {
  if (!crypto.subtle) throw new Error('Secure hashing is unavailable; the asset cannot be admitted safely.')
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

function inspectAndNormalize(gltf: GLTF): ParsedAsset {
  let nodeCount = 0
  let meshCount = 0
  let lightCount = 0
  let triangleCount = 0

  gltf.scene.traverse((object: Object3D) => {
    nodeCount += 1
    if (object instanceof Light) lightCount += 1
    if (!(object instanceof Mesh) && !(object instanceof SkinnedMesh)) return
    meshCount += 1
    const geometry = object.geometry
    const positionCount = geometry.attributes.position?.count ?? 0
    triangleCount += geometry.index ? geometry.index.count / 3 : positionCount / 3
  })

  if (meshCount === 0) throw new Error('GLB contains no renderable mesh.')
  if (nodeCount > MAX_NODES) throw new Error(`GLB has ${nodeCount} nodes; the mobile limit is ${MAX_NODES}.`)
  if (triangleCount > MAX_TRIANGLES) throw new Error(`GLB has ${Math.ceil(triangleCount)} triangles; the mobile limit is ${MAX_TRIANGLES}.`)
  if (lightCount > MAX_LIGHTS) throw new Error(`GLB has ${lightCount} lights; the local limit is ${MAX_LIGHTS}.`)
  if (gltf.animations.length > MAX_ANIMATIONS) throw new Error(`GLB has ${gltf.animations.length} clips; the limit is ${MAX_ANIMATIONS}.`)
  for (const clip of gltf.animations) {
    if (!clip.name || clip.name.length > 100) throw new Error('Every animation clip needs a name of at most 100 characters.')
    if (!Number.isFinite(clip.duration) || clip.duration <= 0 || clip.duration > MAX_ANIMATION_SECONDS) {
      throw new Error(`Animation clip “${clip.name}” has an unsupported duration.`)
    }
  }

  const bounds = new Box3().setFromObject(gltf.scene)
  if (bounds.isEmpty()) throw new Error('GLB bounds are empty.')
  const size = bounds.getSize(new Vector3())
  const center = bounds.getCenter(new Vector3())
  const maximumDimension = Math.max(size.x, size.y, size.z)
  if (!Number.isFinite(maximumDimension) || maximumDimension <= 0 || maximumDimension > 1_000_000) {
    throw new Error('GLB bounds are invalid or unreasonably large.')
  }

  gltf.scene.position.sub(center)
  gltf.scene.scale.multiplyScalar(NORMALIZED_MODEL_SIZE / maximumDimension)
  const root = new Group()
  root.name = 'gamexr-local-glb'
  root.userData.gamexrRole = 'ship'
  root.add(gltf.scene)

  return {
    root,
    animations: [...gltf.animations],
    admission: {
      nodeCount,
      meshCount,
      triangleCount: Math.ceil(triangleCount),
      animationNames: gltf.animations.map((clip) => clip.name),
      normalizedSize: NORMALIZED_MODEL_SIZE,
      source: 'user-local',
      licenseTerms: 'local-use-only-unverified',
      humanReviewStatus: 'unreviewed',
    },
  }
}

export class AssetManager {
  constructor(private readonly database: LocalDatabase) {}

  async importLocalGlb(file: File): Promise<ImportedAsset> {
    if (!file.name.toLowerCase().endsWith('.glb')) throw new Error('Choose a self-contained .glb file.')
    if (file.size <= 0 || file.size > MAX_LOCAL_ASSET_BYTES) {
      throw new Error(`GLB must be between 1 byte and ${MAX_LOCAL_ASSET_BYTES / 1024 / 1024} MB.`)
    }
    const bytes = await file.arrayBuffer()
    await preflightGlb(glbDocument(bytes), bytes)
    const sha256 = await digestHex(bytes)
    const parsed = inspectAndNormalize(await this.parse(bytes))
    const stored: StoredAsset = {
      id: `asset-${sha256.slice(0, 20)}`,
      name: file.name.slice(0, 120),
      mediaType: 'model/gltf-binary',
      byteLength: bytes.byteLength,
      sha256,
      createdAt: new Date().toISOString(),
      admission: parsed.admission,
      bytes,
    }
    await this.database.saveAsset(stored)
    const { bytes: _bytes, ...metadata } = stored
    return { ...parsed, metadata }
  }

  async loadLocalGlb(id: string): Promise<ImportedAsset> {
    const stored = await this.database.getAsset(id)
    if (!stored) throw new Error(`Local asset “${id}” was not found.`)
    await preflightGlb(glbDocument(stored.bytes), stored.bytes)
    const parsed = inspectAndNormalize(await this.parse(stored.bytes))
    const { bytes: _bytes, ...metadata } = stored
    return { ...parsed, metadata }
  }

  private async parse(bytes: ArrayBuffer): Promise<GLTF> {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js')
    return new GLTFLoader().parseAsync(bytes, '')
  }
}
