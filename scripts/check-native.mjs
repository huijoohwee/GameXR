import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const projectRoot = resolve(import.meta.dirname, '..')
const nativeRoot = resolve(projectRoot, 'native')
const visionSimulatorTriple = 'arm64-apple-xros2.0-simulator'
const proof = {
  schema: 'gamexr.native-check/v1',
  result: 'running',
  physicalDeviceExecution: {
    iOS: 'not-attempted',
    visionOS: 'not-attempted',
  },
  checks: [],
}

function run(command, arguments_, cwd = projectRoot) {
  process.stdout.write(`native check: ${command} ${arguments_.join(' ')}\n`)
  const result = spawnSync(command, arguments_, { cwd, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? 'unknown'}.`)
  }
}

function capture(command, arguments_, cwd = projectRoot) {
  const result = spawnSync(command, arguments_, { cwd, encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? 'unknown'}: ${result.stderr.trim()}`)
  }
  return result.stdout
}

function recordCheck(check, failure, command, arguments_, cwd = projectRoot) {
  try {
    run(command, arguments_, cwd)
    proof.checks.push(check)
  } catch (error) {
    proof.checks.push({
      ...check,
      availability: 'available',
      ...failure,
      outcome: 'failed',
    })
    throw error
  }
}

function simulatorId(runtimeName, preferredName, sdkVersion) {
  const simulatorList = JSON.parse(capture('xcrun', ['simctl', 'list', 'devices', 'available', '--json']))
  const runtimeVersion = `${runtimeName}-${sdkVersion.replaceAll('.', '-')}`
  const runtimes = Object.entries(simulatorList.devices ?? {})
    .filter(([runtime]) => runtime.includes(runtimeName))
    .sort(([left], [right]) => {
      const leftExact = left.includes(runtimeVersion)
      const rightExact = right.includes(runtimeVersion)
      if (leftExact !== rightExact) return leftExact ? -1 : 1
      return right.localeCompare(left, undefined, { numeric: true })
    })

  for (const [, devices] of runtimes) {
    if (!Array.isArray(devices)) continue
    const preferred = devices.find((device) => device.isAvailable !== false && device.name?.includes(preferredName))
      ?? devices.find((device) => device.isAvailable !== false)
    if (preferred?.udid) return preferred.udid
  }
  throw new Error(`No available ${runtimeName} simulator was found. Install a stable simulator runtime in Xcode.`)
}

function nativeVisionSimulatorDestination() {
  const destinations = capture('xcodebuild', [
    '-scheme', 'GameXRNative',
    '-sdk', 'xrsimulator',
    '-showdestinations',
  ], nativeRoot)
  const candidates = destinations.split('\n').filter((line) => (
    line.includes('platform:visionOS Simulator')
    && line.includes('name:Apple Vision Pro')
    && !line.includes('error:')
  ))
  const nativeCandidate = candidates.find((line) => !/variant:\s*Designed for/i.test(line))
  const destinationId = nativeCandidate?.match(/\bid:([^,}]+)/)?.[1]?.trim()

  if (!destinationId || destinationId.includes('placeholder')) {
    return {
      availability: 'unavailable',
      reason: candidates.some((line) => /variant:\s*Designed for/i.test(line))
        ? 'only-designed-for-ipad-iphone-destinations'
        : 'no-native-apple-vision-pro-destination',
    }
  }

  const simulatorList = JSON.parse(capture('xcrun', ['simctl', 'list', 'devices', 'available', '--json']))
  const isAvailableNativeDevice = Object.entries(simulatorList.devices ?? {}).some(([runtime, devices]) => (
    runtime.includes('xrOS-')
    && Array.isArray(devices)
    && devices.some((device) => (
      device.udid === destinationId
      && device.isAvailable !== false
      && device.name?.includes('Apple Vision Pro')
    ))
  ))

  if (!isAvailableNativeDevice) {
    return {
      availability: 'unavailable',
      reason: 'native-destination-not-available-in-simctl',
    }
  }

  return { availability: 'available', destinationId }
}

function writeProof() {
  process.stdout.write(`${JSON.stringify(proof)}\n`)
}

if (process.platform !== 'darwin') {
  proof.result = 'unavailable'
  proof.checks.push({
    id: 'apple-native-toolchain',
    platform: 'Apple',
    destinationKind: 'host',
    availability: 'unavailable',
    compilation: 'not-run',
    execution: 'not-run',
    outcome: 'unavailable',
    reason: 'requires-macos-and-xcode',
  })
  writeProof()
  throw new Error('GameXR native verification requires macOS with Xcode and the stable iOS/visionOS simulator runtimes.')
}

const temporaryRoot = await mkdtemp(join(tmpdir(), 'gamexr-native-check-'))
try {
  recordCheck({
    id: 'swift-package-tests',
    platform: 'Swift',
    destinationKind: 'host',
    availability: 'available',
    compilation: 'passed',
    execution: 'passed',
    outcome: 'executed',
  }, {
    compilation: 'unknown',
    execution: 'unknown',
  }, 'swift', ['test', '--package-path', 'native'])

  const iOSSimulatorId = simulatorId(
    'iOS',
    'iPhone',
    capture('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-version']).trim(),
  )
  recordCheck({
    id: 'ios-simulator-tests',
    platform: 'iOS',
    destinationKind: 'simulator',
    destinationId: iOSSimulatorId,
    availability: 'available',
    compilation: 'passed',
    execution: 'passed',
    outcome: 'executed',
  }, {
    compilation: 'unknown',
    execution: 'unknown',
  }, 'xcodebuild', [
    '-quiet', '-scheme', 'GameXRNative',
    '-destination', `id=${iOSSimulatorId}`,
    '-derivedDataPath', resolve(temporaryRoot, 'ios'),
    'CODE_SIGNING_ALLOWED=NO', 'test',
  ], nativeRoot)

  recordCheck({
    id: 'visionos-xrsimulator-compile',
    platform: 'visionOS',
    destinationKind: 'xrsimulator-cross-compile',
    targetTriple: visionSimulatorTriple,
    availability: 'available',
    compilation: 'passed',
    execution: 'not-run',
    outcome: 'compiled',
  }, {
    compilation: 'failed',
    execution: 'not-run',
  }, 'swift', [
    'build',
    '--package-path', 'native',
    '--scratch-path', resolve(temporaryRoot, 'visionos-build'),
    '--triple', visionSimulatorTriple,
    '--sdk', capture('xcrun', ['--sdk', 'xrsimulator', '--show-sdk-path']).trim(),
  ])

  const visionSimulator = nativeVisionSimulatorDestination()
  if (visionSimulator.availability === 'available') {
    recordCheck({
      id: 'visionos-native-simulator-tests',
      platform: 'visionOS',
      destinationKind: 'native-simulator',
      destinationId: visionSimulator.destinationId,
      availability: 'available',
      compilation: 'passed',
      execution: 'passed',
      outcome: 'executed',
    }, {
      compilation: 'unknown',
      execution: 'unknown',
    }, 'xcodebuild', [
      '-quiet', '-scheme', 'GameXRNative',
      '-sdk', 'xrsimulator',
      '-destination', `id=${visionSimulator.destinationId}`,
      '-derivedDataPath', resolve(temporaryRoot, 'visionos-tests'),
      'CODE_SIGNING_ALLOWED=NO', 'test',
    ], nativeRoot)
  } else {
    proof.checks.push({
      id: 'visionos-native-simulator-tests',
      platform: 'visionOS',
      destinationKind: 'native-simulator',
      availability: 'unavailable',
      compilation: 'not-run',
      execution: 'not-run',
      outcome: 'unavailable',
      reason: visionSimulator.reason,
    })
  }

  proof.result = 'passed'
  process.stdout.write('native check passed: Swift and iOS Simulator tests; visionOS xrsimulator compile gate\n')
} catch (error) {
  proof.result = 'failed'
  proof.error = error instanceof Error ? error.message : String(error)
  throw error
} finally {
  try {
    await rm(temporaryRoot, { recursive: true, force: true })
  } finally {
    writeProof()
  }
}
