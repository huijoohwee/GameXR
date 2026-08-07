import assert from 'node:assert/strict'
import test from 'node:test'
import { getDefaultSceneManifest } from '../src/config/manifest.ts'
import { FlightSimulation } from '../src/runtime/FlightSimulation.ts'

const neutral = { throttle: 0, pitch: 0, yaw: 0, roll: 0, brake: 0 }

test('fixed-step throttle accelerates deterministically along ship forward', () => {
  const manifest = getDefaultSceneManifest()
  const first = new FlightSimulation(manifest)
  const second = new FlightSimulation(manifest)
  for (let tick = 0; tick < 120; tick += 1) {
    const controls = { ...neutral, throttle: 1 }
    first.step(1 / 60, controls)
    second.step(1 / 60, controls)
  }
  assert.deepEqual(first.positionTuple, second.positionTuple)
  assert(first.state.position.z < 0)
  assert(first.speed > 0)
  assert(first.speed <= manifest.ship.flight.maxForwardSpeed)
})

test('idle command drives canonical throttle toward zero', () => {
  const simulation = new FlightSimulation(getDefaultSceneManifest())
  for (let tick = 0; tick < 60; tick += 1) simulation.step(1 / 60, { ...neutral, throttle: 1 })
  const beforeThrottle = simulation.canonicalAircraft.throttle
  for (let tick = 0; tick < 30; tick += 1) simulation.step(1 / 60, { ...neutral, brake: 1 })
  assert(simulation.canonicalAircraft.throttle < beforeThrottle)
  assert(simulation.speed >= 0)
})

test('world bounds wrap instead of allowing an unbounded simulation position', () => {
  const manifest = getDefaultSceneManifest()
  manifest.scene.boundsRadius = 20
  manifest.ship.flight.maxForwardSpeed = 500
  manifest.ship.flight.acceleration = 200
  const simulation = new FlightSimulation(manifest)
  for (let tick = 0; tick < 600; tick += 1) simulation.step(1 / 60, { ...neutral, throttle: 1 })
  assert(simulation.state.position.length() <= manifest.scene.boundsRadius)
})

test('bank angle bounds accumulated roll', () => {
  const manifest = getDefaultSceneManifest()
  manifest.ship.flight.bankAngle = 0.2
  const simulation = new FlightSimulation(manifest)
  for (let tick = 0; tick < 240; tick += 1) simulation.step(1 / 60, { ...neutral, roll: 1 })
  assert(Math.abs(simulation.rotationTuple[2]) <= manifest.ship.flight.bankAngle + 1e-6)
})
