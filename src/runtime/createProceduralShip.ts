import {
  BoxGeometry,
  ConeGeometry,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PointLight,
  SphereGeometry,
} from 'three'
import type { SceneManifest } from '../config/types.ts'

export interface ShipVisualReferences {
  root: Group
  leftWing: Mesh
  rightWing: Mesh
  exhausts: Mesh[]
}

function standardMaterial(color: string, manifest: SceneManifest): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color,
    metalness: manifest.ship.appearance.metalness,
    roughness: manifest.ship.appearance.roughness,
  })
}

export function createProceduralShip(manifest: SceneManifest): ShipVisualReferences {
  const root = new Group()
  root.name = 'gamexr-procedural-ship'
  root.userData.gamexrRole = 'ship'

  const hullMaterial = standardMaterial(manifest.ship.appearance.hullColor, manifest)
  const accentMaterial = standardMaterial(manifest.ship.appearance.accentColor, manifest)
  const canopyMaterial = new MeshPhysicalMaterial({
    color: manifest.ship.appearance.canopyColor,
    metalness: 0.15,
    roughness: 0.12,
    transmission: 0.18,
    transparent: true,
    opacity: 0.88,
  })
  const exhaustMaterial = new MeshStandardMaterial({
    color: manifest.ship.appearance.exhaustColor,
    emissive: manifest.ship.appearance.exhaustColor,
    emissiveIntensity: 3.5,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
  })

  const hull = new Mesh(new ConeGeometry(0.62, 4.2, 16, 1), hullMaterial)
  hull.rotation.x = -Math.PI / 2
  hull.userData.gamexrRole = 'hull'
  root.add(hull)

  const canopy = new Mesh(new SphereGeometry(0.48, 20, 12), canopyMaterial)
  canopy.scale.set(0.78, 0.42, 1.45)
  canopy.position.set(0, 0.34, -0.45)
  canopy.userData.gamexrRole = 'canopy'
  root.add(canopy)

  const wingGeometry = new BoxGeometry(2.3, 0.09, 1.18)
  const leftWing = new Mesh(wingGeometry, accentMaterial)
  leftWing.position.set(-1.22, -0.05, 0.42)
  leftWing.rotation.y = -0.12
  leftWing.userData.gamexrRole = 'left-wing'
  root.add(leftWing)

  const rightWing = new Mesh(wingGeometry, accentMaterial)
  rightWing.position.set(1.22, -0.05, 0.42)
  rightWing.rotation.y = 0.12
  rightWing.userData.gamexrRole = 'right-wing'
  root.add(rightWing)

  const engineGeometry = new BoxGeometry(0.38, 0.38, 1.25)
  for (const x of [-0.48, 0.48]) {
    const engine = new Mesh(engineGeometry, hullMaterial)
    engine.position.set(x, -0.12, 1.45)
    engine.userData.gamexrRole = 'engine'
    root.add(engine)
  }

  const exhaustGeometry = new ConeGeometry(0.18, 1.35, 12)
  const exhausts = [-0.48, 0.48].map((x) => {
    const exhaust = new Mesh(exhaustGeometry, exhaustMaterial)
    exhaust.rotation.x = Math.PI / 2
    exhaust.position.set(x, -0.12, 2.65)
    exhaust.userData.gamexrRole = 'exhaust'
    root.add(exhaust)
    return exhaust
  })

  const engineLight = new PointLight(manifest.ship.appearance.exhaustColor, 2.2, 8, 2)
  engineLight.position.set(0, -0.1, 2.7)
  root.add(engineLight)

  root.scale.setScalar(manifest.ship.scale)
  return { root, leftWing, rightWing, exhausts }
}
