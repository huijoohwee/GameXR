import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Euler,
  FogExp2,
  GridHelper,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Quaternion,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three'
import type { SceneManifest } from '../config/types.ts'
import { createSeededRandom, disposeObject3D } from './resources.ts'

export interface WorldResources {
  root: Group
  planet: Mesh | null
  asteroidField: Group
  dispose: () => void
}

function createStars(manifest: SceneManifest, random: () => number): Points | null {
  if (manifest.scene.starCount === 0) return null
  const positions = new Float32Array(manifest.scene.starCount * 3)
  const minimumRadius = Math.max(24, manifest.scene.asteroidFieldRadius * 0.7)
  const maximumRadius = manifest.scene.boundsRadius * 0.95
  const direction = new Vector3()

  for (let index = 0; index < manifest.scene.starCount; index += 1) {
    direction.set(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1).normalize()
    direction.multiplyScalar(minimumRadius + random() * (maximumRadius - minimumRadius))
    positions[index * 3] = direction.x
    positions[index * 3 + 1] = direction.y
    positions[index * 3 + 2] = direction.z
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  return new Points(geometry, new PointsMaterial({ color: '#d7e9ff', size: 0.12, sizeAttenuation: true }))
}

function createAsteroids(manifest: SceneManifest, random: () => number): Group {
  const group = new Group()
  group.name = 'gamexr-asteroid-field'
  if (manifest.scene.asteroidCount === 0) return group

  const geometry = new IcosahedronGeometry(1, 1)
  const material = new MeshStandardMaterial({ color: '#596273', roughness: 0.94, metalness: 0.06 })
  const mesh = new InstancedMesh(geometry, material, manifest.scene.asteroidCount)
  const matrix = new Matrix4()
  const position = new Vector3()
  const rotation = new Quaternion()
  const scale = new Vector3()

  for (let index = 0; index < manifest.scene.asteroidCount; index += 1) {
    const angle = random() * Math.PI * 2
    const distance = manifest.scene.asteroidFieldRadius * (0.45 + random() * 0.55)
    position.set(Math.cos(angle) * distance, (random() - 0.5) * distance * 0.45, Math.sin(angle) * distance)
    const size = 0.25 + random() * 1.8
    scale.set(size, size * (0.65 + random() * 0.7), size * (0.65 + random() * 0.7))
    rotation.setFromEuler(new Euler(random() * Math.PI, random() * Math.PI, random() * Math.PI))
    matrix.compose(position, rotation, scale)
    mesh.setMatrixAt(index, matrix)
  }
  mesh.instanceMatrix.needsUpdate = true
  mesh.userData.gamexrRole = 'asteroids'
  group.add(mesh)
  return group
}

function createHangarFloor(manifest: SceneManifest): Group {
  const group = new Group()
  group.name = 'gamexr-hangar'
  if (manifest.scene.environment !== 'hangar') return group
  const floor = new Mesh(
    new PlaneGeometry(70, 70),
    new MeshStandardMaterial({ color: '#111a29', roughness: 0.8, metalness: 0.35 }),
  )
  floor.rotation.x = -Math.PI / 2
  floor.position.y = -3
  group.add(floor)
  const grid = new GridHelper(70, 35, '#58dbcf', '#23334d')
  grid.position.y = -2.98
  group.add(grid)
  return group
}

function createOrbitGuide(manifest: SceneManifest): Group {
  const group = new Group()
  group.name = 'gamexr-orbit-guide'
  if (manifest.scene.environment !== 'orbit') return group
  const radius = Math.max(8, Math.min(40, manifest.scene.asteroidFieldRadius * 0.3))
  const ring = new Mesh(
    new TorusGeometry(radius, 0.035, 6, 128),
    new MeshBasicMaterial({ color: manifest.scene.lighting.keyColor, transparent: true, opacity: 0.3 }),
  )
  ring.rotation.x = Math.PI / 2
  ring.userData.gamexrRole = 'orbit-guide'
  group.add(ring)
  return group
}

export function createWorld(scene: Scene, manifest: SceneManifest): WorldResources {
  scene.background = new Color(manifest.scene.backgroundColor)
  scene.fog = new FogExp2(manifest.scene.fogColor, manifest.scene.fogDensity)
  const root = new Group()
  root.name = 'gamexr-world'
  const random = createSeededRandom(manifest.id)

  const ambient = new AmbientLight('#b9d4ff', manifest.scene.lighting.ambientIntensity)
  const key = new DirectionalLight(manifest.scene.lighting.keyColor, manifest.scene.lighting.keyIntensity)
  key.position.fromArray(manifest.scene.lighting.keyPosition)
  root.add(ambient, key)

  const stars = createStars(manifest, random)
  if (stars) root.add(stars)

  const asteroidField = createAsteroids(manifest, random)
  root.add(asteroidField)

  let planet: Mesh | null = null
  if (manifest.scene.planet.enabled) {
    planet = new Mesh(
      new SphereGeometry(manifest.scene.planet.radius, 32, 20),
      new MeshStandardMaterial({
        color: manifest.scene.planet.baseColor,
        emissive: manifest.scene.planet.emissiveColor,
        emissiveIntensity: 0.8,
        roughness: 0.84,
      }),
    )
    planet.position.fromArray(manifest.scene.planet.position)
    planet.userData.gamexrRole = 'planet'
    root.add(planet)
  }

  root.add(createHangarFloor(manifest))
  root.add(createOrbitGuide(manifest))
  scene.add(root)
  return { root, planet, asteroidField, dispose: () => disposeObject3D(root) }
}
