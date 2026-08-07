import type { Material, Object3D, Texture } from 'three'

function disposeMaterial(material: Material, disposedTextures: Set<Texture>): void {
  const values = Object.values(material as unknown as Record<string, unknown>)
  for (const value of values) {
    if (value && typeof value === 'object' && 'isTexture' in value && (value as Texture).isTexture) {
      const texture = value as Texture
      if (!disposedTextures.has(texture)) {
        disposedTextures.add(texture)
        texture.dispose()
      }
    }
  }
  material.dispose()
}

export function disposeObject3D(root: Object3D): void {
  const disposedGeometries = new Set<unknown>()
  const disposedMaterials = new Set<Material>()
  const disposedTextures = new Set<Texture>()

  root.traverse((object) => {
    if ('geometry' in object) {
      const geometry = object.geometry as { dispose?: () => void } | undefined
      if (geometry?.dispose && !disposedGeometries.has(geometry)) {
        disposedGeometries.add(geometry)
        geometry.dispose()
      }
    }
    if (!('material' in object)) return
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of materials as Material[]) {
      if (!material || disposedMaterials.has(material)) continue
      disposedMaterials.add(material)
      disposeMaterial(material, disposedTextures)
    }
  })
  root.removeFromParent()
}

export function createSeededRandom(seedText: string): () => number {
  let seed = 2166136261
  for (let index = 0; index < seedText.length; index += 1) {
    seed ^= seedText.charCodeAt(index)
    seed = Math.imul(seed, 16777619)
  }

  return () => {
    seed += 0x6d2b79f5
    let value = seed
    value = Math.imul(value ^ value >>> 15, value | 1)
    value ^= value + Math.imul(value ^ value >>> 7, value | 61)
    return ((value ^ value >>> 14) >>> 0) / 4294967296
  }
}
