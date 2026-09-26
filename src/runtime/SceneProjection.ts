import { Scene, type Group } from 'three'
import type { SceneManifest } from '../config/types.ts'
import { AnimationController } from './AnimationController.ts'
import type { AssetManager } from './AssetManager.ts'
import { createProceduralShip } from './createProceduralShip.ts'
import { createWorld, type WorldResources } from './createWorld.ts'
import { disposeObject3D } from './resources.ts'

export interface PreparedScene {
  scene: Scene
  world: WorldResources
  shipRoot: Group
  animation: AnimationController
}

/** Prepare a disposable projection before the source owner commits any persistent bytes. */
export async function prepareScene(manifest: SceneManifest, assets: AssetManager): Promise<PreparedScene> {
  const scene = new Scene()
  const world = createWorld(scene, manifest)
  const animation = new AnimationController(manifest)
  let shipRoot: Group | null = null
  try {
    if (manifest.ship.asset.kind === 'procedural') {
      const ship = createProceduralShip(manifest)
      shipRoot = ship.root
      animation.attachProcedural(ship)
    } else {
      const assetId = manifest.ship.asset.localAssetId
      if (!assetId) throw new Error('A local-glb ship requires a local asset id.')
      const imported = await assets.loadLocalGlb(assetId)
      shipRoot = imported.root
      shipRoot.scale.multiplyScalar(manifest.ship.scale)
      animation.attachImported(imported.root, imported.animations)
    }
    scene.add(shipRoot)
    animation.configure(manifest)
    return { scene, world, shipRoot, animation }
  } catch (error) {
    animation.dispose()
    if (shipRoot) disposeObject3D(shipRoot)
    world.dispose()
    throw error
  }
}

export function disposePreparedScene(prepared: PreparedScene): void {
  prepared.animation.dispose()
  disposeObject3D(prepared.shipRoot)
  prepared.world.dispose()
}
