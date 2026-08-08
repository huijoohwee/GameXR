import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  AmbientLight,
  BoxGeometry,
  Color,
  ConeGeometry,
  DirectionalLight,
  FogExp2,
  InstancedMesh,
  IcosahedronGeometry,
  Matrix4,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PointLight,
  Points,
  PointsMaterial,
  Quaternion,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three'
import { getDefaultSceneManifest } from '../src/config/manifest.ts'
import { AnimationController } from '../src/runtime/AnimationController.ts'
import { FlightSimulation } from '../src/runtime/FlightSimulation.ts'
import { createProceduralShip } from '../src/runtime/createProceduralShip.ts'
import { createWorld } from '../src/runtime/createWorld.ts'
import { projectEngineAudioTargets } from '../src/runtime/engineAudioProjection.ts'
import {
  projectProceduralShipAnimation,
  projectProceduralWorldAnimationDelta,
} from '../src/runtime/proceduralAnimationProjection.ts'

const fixture = JSON.parse(await readFile(
  new URL('./fixtures/gamexr-cross-runtime-parity.v1.json', import.meta.url),
  'utf8',
))
const accuracy = 1e-6

function close(actual: number, expected: number, message: string): void {
  assert(Math.abs(actual - expected) <= accuracy, `${message}: ${actual} != ${expected}`)
}

function vector(actual: readonly number[], expected: readonly number[], message: string): void {
  assert.equal(actual.length, expected.length, `${message} arity`)
  actual.forEach((value, index) => close(value, expected[index]!, `${message}[${index}]`))
}

function hex(color: { getHexString(): string }): string {
  return `#${color.getHexString()}`
}

class PlacementHasher {
  private state = 14_695_981_039_346_656_037n

  integer(value: number): void { this.uint64(BigInt.asUintN(64, BigInt(value))) }

  float(value: number): void {
    const scaled = Math.fround(value) * 10_000
    const quantized = Math.sign(scaled) * Math.round(Math.abs(scaled))
    this.uint64(BigInt.asUintN(64, BigInt(quantized)))
  }

  private uint64(value: bigint): void {
    for (let shift = 0n; shift < 64n; shift += 8n) {
      this.state = (this.state ^ ((value >> shift) & 0xffn)) * 1_099_511_628_211n
      this.state = BigInt.asUintN(64, this.state)
    }
  }

  get decimal(): string { return this.state.toString() }
}

test('browser default world matches the fixed cross-runtime visual contract', () => {
  const manifest = getDefaultSceneManifest()
  const scene = new Scene()
  const world = createWorld(scene, manifest)
  assert.equal(fixture.schema, 'gamexr-cross-runtime-parity/v1')
  assert.equal(manifest.id, fixture.manifestId)
  assert(scene.background instanceof Color)
  assert(scene.fog instanceof FogExp2)
  assert.equal(hex(scene.background), fixture.world.backgroundColor)
  assert.equal(hex(scene.fog.color), fixture.world.fogColor)
  close(scene.fog.density, fixture.world.fogDensity, 'fog density')

  const ambient = world.root.children.find((entity): entity is AmbientLight => entity instanceof AmbientLight)
  const key = world.root.children.find((entity): entity is DirectionalLight => entity instanceof DirectionalLight)
  const stars = world.root.children.find((entity): entity is Points => entity instanceof Points)
  const asteroidMesh = world.asteroidField.children[0]
  assert(ambient && key && stars && asteroidMesh instanceof InstancedMesh)
  assert(stars.material instanceof PointsMaterial)
  assert(asteroidMesh.geometry instanceof IcosahedronGeometry)
  assert(asteroidMesh.material instanceof MeshStandardMaterial)
  const starPositions = stars.geometry.getAttribute('position')
  assert(starPositions)
  assert.equal(hex(ambient.color), fixture.world.ambientLight.color)
  close(ambient.intensity, fixture.world.ambientLight.intensity, 'ambient intensity')
  assert.equal(hex(key.color), fixture.world.keyLight.color)
  close(key.intensity, fixture.world.keyLight.intensity, 'key intensity')
  vector(key.position.toArray(), fixture.world.keyLight.position, 'key position')
  assert.equal(stars.geometry.type, fixture.world.stars.browserGeometry)
  assert.equal(starPositions.count, fixture.world.stars.browserVertexCount)
  assert.equal(hex(stars.material.color), fixture.world.stars.color)
  close(stars.material.size, fixture.world.stars.diameter, 'star point diameter')
  assert.equal(asteroidMesh.count, fixture.world.asteroids.count)
  assert.equal(asteroidMesh.geometry.type, fixture.world.asteroids.browserGeometry)
  const asteroidPositions = asteroidMesh.geometry.getAttribute('position')
  assert(asteroidPositions)
  assert.equal(asteroidPositions.count, fixture.world.asteroids.triangleCornerCount)
  close(asteroidMesh.geometry.parameters.radius, fixture.world.asteroids.radius, 'asteroid radius')
  assert.equal(asteroidMesh.geometry.parameters.detail, fixture.world.asteroids.detail)
  assert.equal(hex(asteroidMesh.material.color), fixture.world.asteroids.color)
  close(asteroidMesh.material.roughness, fixture.world.asteroids.roughness, 'asteroid roughness')
  close(asteroidMesh.material.metalness, fixture.world.asteroids.metalness, 'asteroid metalness')

  const placementHasher = new PlacementHasher()
  placementHasher.integer(2)
  placementHasher.integer(starPositions.count)
  for (const value of starPositions.array) placementHasher.float(value)
  placementHasher.integer(3)
  placementHasher.integer(asteroidMesh.count)
  const digestMatrix = new Matrix4()
  const digestPosition = new Vector3()
  const digestOrientation = new Quaternion()
  const digestScale = new Vector3()
  for (let index = 0; index < asteroidMesh.count; index += 1) {
    asteroidMesh.getMatrixAt(index, digestMatrix)
    digestMatrix.decompose(digestPosition, digestOrientation, digestScale)
    for (const value of digestPosition.toArray()) placementHasher.float(value)
    const canonicalOrientation = digestOrientation.w < 0
      ? digestOrientation.toArray().map((value) => -value)
      : digestOrientation.toArray()
    for (const value of canonicalOrientation) placementHasher.float(value)
    for (const value of digestScale.toArray()) placementHasher.float(value)
  }

  for (const sample of fixture.world.asteroids.samples) {
    const matrix = new Matrix4()
    const position = new Vector3()
    const orientation = new Quaternion()
    const scale = new Vector3()
    asteroidMesh.getMatrixAt(sample.index, matrix)
    matrix.decompose(position, orientation, scale)
    vector(position.toArray(), sample.position, `asteroid ${sample.index} position`)
    vector(orientation.toArray(), sample.quaternion, `asteroid ${sample.index} orientation`)
    vector(scale.toArray(), sample.scale, `asteroid ${sample.index} scale`)
  }

  assert(world.planet)
  assert(world.planet.geometry instanceof SphereGeometry)
  assert(world.planet.material instanceof MeshStandardMaterial)
  const planetPositions = world.planet.geometry.getAttribute('position')
  assert(planetPositions)
  assert.equal(world.planet.geometry.type, fixture.world.planet.browserGeometry)
  assert.equal(planetPositions.count, fixture.world.planet.browserVertexCount)
  assert.equal(world.planet.geometry.index!.count, fixture.world.planet.browserIndexCount)
  close(world.planet.geometry.parameters.radius, fixture.world.planet.radius, 'planet radius')
  assert.equal(world.planet.geometry.parameters.widthSegments, fixture.world.planet.widthSegments)
  assert.equal(world.planet.geometry.parameters.heightSegments, fixture.world.planet.heightSegments)
  vector(world.planet.position.toArray(), fixture.world.planet.position, 'planet position')
  assert.equal(hex(world.planet.material.color), fixture.world.planet.baseColor)
  assert.equal(hex(world.planet.material.emissive), fixture.world.planet.emissiveColor)
  close(world.planet.material.emissiveIntensity, fixture.world.planet.emissiveIntensity, 'planet emission')
  close(world.planet.material.roughness, fixture.world.planet.roughness, 'planet roughness')
  close(world.planet.material.metalness, fixture.world.planet.metalness, 'planet metalness')
  placementHasher.integer(4)
  for (const value of world.planet.position.toArray()) placementHasher.float(value)
  placementHasher.float(fixture.world.planet.radius)
  placementHasher.integer(5)
  for (const value of key.position.toArray()) placementHasher.float(value)
  assert.equal(placementHasher.decimal, fixture.world.placementDigest)
  world.dispose()
})

test('browser procedural ship matches the fixed cross-runtime parts contract', () => {
  const manifest = getDefaultSceneManifest()
  const ship = createProceduralShip(manifest)
  vector(ship.root.scale.toArray(), [fixture.ship.scale, fixture.ship.scale, fixture.ship.scale], 'ship root scale')
  const roleGroups = new Map<string, Mesh[]>()
  ship.root.traverse((entity) => {
    if (!(entity instanceof Mesh)) return
    const role = String(entity.userData.gamexrRole ?? '')
    roleGroups.set(role, [...(roleGroups.get(role) ?? []), entity])
  })
  const roleOffsets = new Map<string, number>()
  for (const expected of fixture.ship.parts) {
    const offset = roleOffsets.get(expected.browserRole) ?? 0
    const actual = roleGroups.get(expected.browserRole)?.[offset]
    assert(actual, `missing browser ship role ${expected.browserRole}[${offset}]`)
    roleOffsets.set(expected.browserRole, offset + 1)
    vector(actual.position.toArray(), expected.position, `${expected.id} position`)
    vector([actual.rotation.x, actual.rotation.y, actual.rotation.z], expected.eulerXYZ, `${expected.id} rotation`)
    vector(actual.scale.toArray(), expected.scale, `${expected.id} scale`)
    if (expected.geometry === 'box') {
      assert(actual.geometry instanceof BoxGeometry, `${expected.id} browser geometry`)
      const parameters = actual.geometry.parameters
      vector(
        [parameters.width, parameters.height, parameters.depth],
        expected.dimensions,
        `${expected.id} geometry`,
      )
    } else if (expected.geometry === 'cone') {
      assert(actual.geometry instanceof ConeGeometry, `${expected.id} browser geometry`)
      const parameters = actual.geometry.parameters
      vector(
        [parameters.radius, parameters.height, parameters.radialSegments],
        expected.dimensions,
        `${expected.id} geometry`,
      )
    } else if (expected.geometry === 'sphere') {
      assert(actual.geometry instanceof SphereGeometry, `${expected.id} browser geometry`)
      const parameters = actual.geometry.parameters
      vector(
        [parameters.radius, parameters.widthSegments, parameters.heightSegments],
        expected.dimensions,
        `${expected.id} geometry`,
      )
    } else {
      assert.fail(`unsupported fixture geometry ${expected.geometry}`)
    }
    assert(actual.material instanceof MeshStandardMaterial, `${expected.id} browser material`)
    const material = actual.material
    assert.equal(hex(material.color), expected.material.color)
    close(material.roughness, expected.material.roughness, `${expected.id} roughness`)
    close(material.metalness, expected.material.metalness, `${expected.id} metalness`)
    if (expected.material.opacity !== undefined) {
      close(material.opacity, expected.material.opacity, `${expected.id} opacity`)
    }
    if (expected.material.transmission !== undefined) {
      assert(material instanceof MeshPhysicalMaterial, `${expected.id} physical material`)
      close(material.transmission, expected.material.transmission, `${expected.id} transmission`)
    }
    if (expected.material.emissiveColor !== undefined) {
      assert.equal(hex(material.emissive), expected.material.emissiveColor)
      close(material.emissiveIntensity, expected.material.emissiveIntensity, `${expected.id} emission`)
      assert.equal(material.depthWrite, false, `${expected.id} depth write`)
    }
  }
  assert.equal([...roleGroups.values()].reduce((count, group) => count + group.length, 0), fixture.ship.parts.length)
  for (const [role, group] of roleGroups) assert.equal(group.length, roleOffsets.get(role), `${role} role count`)
  const engineLight = ship.root.children.find((entity): entity is PointLight => entity instanceof PointLight)
  assert(engineLight, 'missing browser engine light')
  vector(engineLight.position.toArray(), fixture.ship.engineLight.position, 'engine light position')
  assert.equal(hex(engineLight.color), fixture.ship.engineLight.color)
  close(engineLight.intensity, fixture.ship.engineLight.intensity, 'engine light intensity')
  close(engineLight.distance, fixture.ship.engineLight.distance, 'engine light distance')
  close(engineLight.decay, fixture.ship.engineLight.decay, 'engine light decay')

  const animation = new AnimationController(manifest)
  animation.attachProcedural(ship)
  animation.update(fixture.ship.animation.deltaSeconds, fixture.ship.animation.throttle)
  for (const exhaust of ship.exhausts) {
    vector(exhaust.scale.toArray(), [1, fixture.ship.animation.exhaustScale, 1], 'animated exhaust scale')
  }
  close(ship.leftWing.rotation.z, fixture.ship.animation.leftWingFlex, 'left wing animation')
  close(ship.rightWing.rotation.z, fixture.ship.animation.rightWingFlex, 'right wing animation')
  const shipTargets = projectProceduralShipAnimation(
    manifest.animation,
    fixture.ship.animation.deltaSeconds,
    fixture.ship.animation.throttle,
  )
  close(shipTargets.exhaustScaleY, fixture.ship.animation.exhaustScale, 'projected exhaust animation')
  close(shipTargets.leftWingRotationZ, fixture.ship.animation.leftWingFlex, 'projected left wing animation')
  close(shipTargets.rightWingRotationZ, fixture.ship.animation.rightWingFlex, 'projected right wing animation')
  const worldTargets = projectProceduralWorldAnimationDelta(
    manifest.scene,
    manifest.animation,
    fixture.ship.animation.deltaSeconds,
  )
  close(worldTargets.planetYaw, fixture.ship.animation.planetRotationDelta, 'projected planet animation')
  close(worldTargets.asteroidFieldYaw, fixture.ship.animation.asteroidRotationDelta, 'projected asteroid animation')
  animation.dispose()
})

test('browser flight executes the shared deterministic cross-runtime control trace', () => {
  const simulation = new FlightSimulation(getDefaultSceneManifest())
  close(fixture.flight.fixedStepSeconds, 1 / 60, 'fixed step')
  for (const [segmentIndex, segment] of fixture.flight.segments.entries()) {
    for (let tick = 0; tick < segment.ticks; tick += 1) {
      simulation.step(fixture.flight.fixedStepSeconds, segment.input)
    }
    const actual = simulation.canonicalAircraft
    vector(actual.position, segment.expected.position, `segment ${segmentIndex} position`)
    vector(actual.velocity, segment.expected.velocity, `segment ${segmentIndex} velocity`)
    close(actual.pitch, segment.expected.pitch, `segment ${segmentIndex} pitch`)
    close(actual.yaw, segment.expected.yaw, `segment ${segmentIndex} yaw`)
    close(actual.roll, segment.expected.roll, `segment ${segmentIndex} roll`)
    close(actual.throttle, segment.expected.throttle, `segment ${segmentIndex} throttle`)
  }
})

test('browser engine audio projection matches fixed cross-runtime target samples', () => {
  const audio = getDefaultSceneManifest().audio
  for (const [index, sample] of fixture.audio.samples.entries()) {
    const actual = projectEngineAudioTargets(audio, sample.throttle, sample.speed)
    assert.equal(actual.waveform, sample.waveform, `audio sample ${index} waveform`)
    close(actual.frequency, sample.frequency, `audio sample ${index} frequency`)
    close(actual.gain, sample.gain, `audio sample ${index} gain`)
    close(actual.lowPassFrequency, sample.lowPassFrequency, `audio sample ${index} low pass`)
    close(actual.filterQ, sample.filterQ, `audio sample ${index} Q`)
  }
})
