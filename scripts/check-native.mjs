import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const projectRoot = resolve(import.meta.dirname, '..')
const nativeRoot = resolve(projectRoot, 'native')
const visionHostProjectRelativePath = 'native/App/GameXRVisionApp.xcodeproj'
const visionHostProject = resolve(projectRoot, visionHostProjectRelativePath)
const visionHostScheme = 'GameXRVisionApp'
const visionHostInfoPlist = resolve(projectRoot, 'native/App/Info.plist')
const visionHostAppSource = resolve(projectRoot, 'native/App/Sources/GameXRVisionApp.swift')
const visionHostViewSource = resolve(projectRoot, 'native/App/Sources/GameXRHostView.swift')
const visionSimulatorTriple = 'arm64-apple-xros2.0-simulator'
const simulatorStateWaitArray = new Int32Array(new SharedArrayBuffer(4))
const proof = {
  schema: 'gamexr.native-check/v1',
  result: 'running',
  toolchain: null,
  physicalDeviceExecution: { iOS: 'not-attempted', visionOS: 'not-attempted' },
  checks: [],
}

function run(command, arguments_, cwd = projectRoot) {
  process.stdout.write(`native check: ${command} ${arguments_.join(' ')}\n`)
  const result = spawnSync(command, arguments_, { cwd, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status ?? 'unknown'}.`)
}

function capture(command, arguments_, cwd = projectRoot) {
  const result = spawnSync(command, arguments_, { cwd, encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status ?? 'unknown'}: ${result.stderr.trim()}`)
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

function activeToolchain() {
  const [xcodeVersionLine, xcodeBuildLine] = capture('xcodebuild', ['-version']).trim().split('\n')
  return {
    developerDirectory: process.env.DEVELOPER_DIR || capture('xcode-select', ['-p']).trim(),
    xcodeVersion: xcodeVersionLine?.replace(/^Xcode\s+/u, '') || 'unknown',
    xcodeBuild: xcodeBuildLine?.replace(/^Build version\s+/u, '') || 'unknown',
    swiftVersion: capture('xcrun', ['swift', '--version']).trim().split('\n')[0],
    iOSSDKVersion: capture('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-version']).trim(),
    iOSSDKBuild: capture('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-build-version']).trim(),
    iOSRuntimeIdentifier: 'not-selected',
    iOSRuntimeBuild: 'not-selected',
    visionOSSDKVersion: capture('xcrun', ['--sdk', 'xrsimulator', '--show-sdk-version']).trim(),
    visionOSSDKBuild: capture('xcrun', ['--sdk', 'xrsimulator', '--show-sdk-build-version']).trim(),
    visionOSRuntimeIdentifier: 'not-selected',
    visionOSRuntimeBuild: 'not-selected',
  }
}

function requireExpectedValue(environmentVariable, label, actual) {
  const expected = process.env[environmentVariable]?.trim()
  if (expected && actual !== expected) {
    throw new Error(`${label} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)} from ${environmentVariable}.`)
  }
}

function requirePlistValue(plistPath, keyPath, expected) {
  const actual = capture('plutil', ['-extract', keyPath, 'raw', '-o', '-', plistPath]).trim()
  if (actual !== expected) {
    throw new Error(`${plistPath} ${keyPath} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}.`)
  }
}

function verifyImmersiveLaunchPlist(plistPath) {
  run('plutil', ['-lint', plistPath])
  const sceneManifest = JSON.parse(capture('plutil', ['-extract', 'UIApplicationSceneManifest', 'json', '-o', '-', plistPath]))
  if (sceneManifest.UIApplicationSupportsMultipleScenes !== true) {
    throw new Error(`${plistPath} must enable UIApplicationSupportsMultipleScenes.`)
  }

  const sceneConfigurations = sceneManifest.UISceneConfigurations
  const immersiveConfigurations = sceneConfigurations?.UISceneSessionRoleImmersiveSpaceApplication
  const recoveryWindowConfigurations = sceneConfigurations?.UIWindowSceneSessionRoleApplication
  if (!Array.isArray(immersiveConfigurations) || immersiveConfigurations.length !== 1) {
    throw new Error(`${plistPath} must declare exactly one immersive-space scene configuration.`)
  }
  if (!Array.isArray(recoveryWindowConfigurations) || recoveryWindowConfigurations.length !== 0) {
    throw new Error(`${plistPath} must declare an empty recovery-window scene configuration array.`)
  }

  requirePlistValue(plistPath, 'UIApplicationSceneManifest.UIApplicationPreferredDefaultSceneSessionRole', 'UISceneSessionRoleImmersiveSpaceApplication')
  requirePlistValue(plistPath, 'UIApplicationSceneManifest.UISceneConfigurations.UISceneSessionRoleImmersiveSpaceApplication.0.UISceneInitialImmersionStyle', 'UIImmersionStyleFull')
}

async function verifyImmersiveLaunchSource() {
  verifyImmersiveLaunchPlist(visionHostInfoPlist)
  const [appSource, hostSource] = await Promise.all([readFile(visionHostAppSource, 'utf8'), readFile(visionHostViewSource, 'utf8')])
  const immersiveIndex = appSource.indexOf('ImmersiveSpace(')
  const windowIndex = appSource.indexOf('WindowGroup(')
  if (immersiveIndex < 0 || windowIndex < 0 || immersiveIndex >= windowIndex) {
    throw new Error('GameXRVisionApp must declare ImmersiveSpace before its recovery WindowGroup.')
  }
  if (/Enter Full (?:Scene|Screen)|gamexr-native-enter-full-scene/u.test(`${appSource}\n${hostSource}`)) {
    throw new Error('GameXR native source still exposes the retired manual immersive-entry gate.')
  }
}

function simulatorDestination({
  runtimePlatform,
  deviceName,
  exactDeviceName,
  sdkVersion,
  destinationEnvironmentVariable,
}) {
  const runtimeList = JSON.parse(capture('xcrun', ['simctl', 'list', 'runtimes', '--json']))
  const matchingRuntimes = (runtimeList.runtimes ?? []).filter((runtime) => (
    runtime.platform === runtimePlatform
    && runtime.version === sdkVersion
    && runtime.isAvailable !== false
  ))
  if (matchingRuntimes.length !== 1) {
    throw new Error(
      `Expected exactly one available ${runtimePlatform} ${sdkVersion} runtime; found ${matchingRuntimes.length}.`,
    )
  }

  const runtime = matchingRuntimes[0]
  if (!runtime.identifier || !runtime.buildversion) {
    throw new Error(`The ${runtimePlatform} ${sdkVersion} runtime is missing identifier or build metadata.`)
  }

  const simulatorList = JSON.parse(capture('xcrun', ['simctl', 'list', 'devices', 'available', '--json']))
  const runtimeDevices = simulatorList.devices?.[runtime.identifier]
  if (!Array.isArray(runtimeDevices)) {
    throw new Error(`No device inventory exists for exact runtime ${runtime.identifier}.`)
  }

  const requestedDestinationId = process.env[destinationEnvironmentVariable]?.trim()
  const matchesDeviceType = (candidate) => (
    candidate.isAvailable !== false
    && candidate.udid
    && (exactDeviceName ? candidate.name === deviceName : candidate.name?.startsWith(deviceName))
  )
  const device = requestedDestinationId
    ? runtimeDevices.find((candidate) => (
        candidate.udid === requestedDestinationId && matchesDeviceType(candidate)
      ))
    : runtimeDevices.find(matchesDeviceType)
  if (!device) {
    const requestedDetail = requestedDestinationId
      ? ` requested by ${destinationEnvironmentVariable}=${requestedDestinationId}`
      : ''
    throw new Error(
      `No available ${deviceName} simulator${requestedDetail} exists in exact runtime ${runtime.identifier}.`,
    )
  }
  if (!['Booted', 'Shutdown'].includes(device.state)) {
    throw new Error(`Simulator ${device.udid} must start in Booted or Shutdown, not ${device.state}.`)
  }

  return {
    availability: 'available',
    destinationId: device.udid,
    deviceName: device.name,
    initialState: device.state,
    runtimeBuild: runtime.buildversion,
    runtimeIdentifier: runtime.identifier,
    sdkVersion,
  }
}

function simulatorDevice(destination) {
  const simulatorList = JSON.parse(capture('xcrun', ['simctl', 'list', 'devices', 'available', '--json']))
  const runtimeDevices = simulatorList.devices?.[destination.runtimeIdentifier]
  const device = Array.isArray(runtimeDevices)
    ? runtimeDevices.find((candidate) => candidate.udid === destination.destinationId)
    : null
  if (!device || device.isAvailable === false) {
    throw new Error(`Simulator ${destination.destinationId} is unavailable in ${destination.runtimeIdentifier}.`)
  }
  return device
}

function ensureSimulatorBooted(destination) {
  const device = simulatorDevice(destination)
  if (device.state === 'Shutdown') {
    run('xcrun', ['simctl', 'boot', destination.destinationId])
  } else if (device.state !== 'Booted') {
    throw new Error(`Simulator ${destination.destinationId} cannot start from transient state ${device.state}.`)
  }
  run('xcrun', ['simctl', 'bootstatus', destination.destinationId, '-b'])
  waitForSimulatorState(destination, 'Booted')
}

function waitForSimulatorState(destination, expectedState) {
  const deadline = Date.now() + 30_000
  let actualState = simulatorDevice(destination).state
  while (actualState !== expectedState && Date.now() < deadline) {
    Atomics.wait(simulatorStateWaitArray, 0, 0, 250)
    actualState = simulatorDevice(destination).state
  }
  if (actualState !== expectedState) {
    throw new Error(`Simulator ${destination.destinationId} ended in ${actualState}, expected ${expectedState}.`)
  }
}

function restoreSimulatorBootState(destination) {
  const expectedState = destination.initialState
  let actualState = simulatorDevice(destination).state
  if (expectedState === 'Shutdown') {
    if (actualState === 'Booting') {
      run('xcrun', ['simctl', 'bootstatus', destination.destinationId, '-b'])
      actualState = 'Booted'
    }
    if (actualState === 'Booted') run('xcrun', ['simctl', 'shutdown', destination.destinationId])
    else if (!['Shutdown', 'Shutting Down'].includes(actualState)) throw new Error(`Simulator ${destination.destinationId} cannot restore from ${actualState}.`)
  } else if (expectedState === 'Booted') {
    if (actualState === 'Shutting Down') {
      waitForSimulatorState(destination, 'Shutdown')
      actualState = 'Shutdown'
    }
    if (actualState === 'Shutdown') run('xcrun', ['simctl', 'boot', destination.destinationId])
    else if (!['Booted', 'Booting'].includes(actualState)) {
      throw new Error(`Simulator ${destination.destinationId} cannot restore from ${actualState}.`)
    }
    run('xcrun', ['simctl', 'bootstatus', destination.destinationId, '-b'])
  } else {
    throw new Error(`Simulator ${destination.destinationId} has unsupported initial state ${expectedState}.`)
  }
  waitForSimulatorState(destination, expectedState)
}

function visionHostBuildSettings(destination, derivedDataPath) {
  const result = JSON.parse(capture('xcodebuild', [
    '-project', visionHostProject,
    '-scheme', visionHostScheme,
    '-configuration', 'Debug',
    '-sdk', 'xrsimulator',
    '-destination', `id=${destination.destinationId}`,
    '-derivedDataPath', derivedDataPath,
    '-showBuildSettings',
    '-json',
  ]))
  const matchingTargets = result.filter((entry) => entry.target === visionHostScheme)
  if (matchingTargets.length !== 1 || !matchingTargets[0].buildSettings) {
    throw new Error(
      `Expected one ${visionHostScheme} build-settings result; found ${matchingTargets.length}.`,
    )
  }
  return matchingTargets[0].buildSettings
}

async function sha256File(filePath) {
  const content = await readFile(filePath)
  return createHash('sha256').update(content).digest('hex')
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
  throw new Error('GameXR native verification requires macOS with Xcode and matching iOS/visionOS simulator runtimes.')
}

const temporaryRoot = await mkdtemp(join(tmpdir(), 'gamexr-native-check-'))
const simulatorDestinationsToRestore = []
let executionError = null
try {
  proof.toolchain = activeToolchain()
  requireExpectedValue('GAME_XR_EXPECTED_XCODE_BUILD', 'Xcode build', proof.toolchain.xcodeBuild)
  requireExpectedValue(
    'GAME_XR_EXPECTED_VISIONOS_SDK_BUILD',
    'visionOS Simulator SDK build',
    proof.toolchain.visionOSSDKBuild,
  )

  try {
    await verifyImmersiveLaunchSource()
    proof.checks.push({
      id: 'visionos-default-immersive-launch-source',
      platform: 'visionOS',
      destinationKind: 'source-contract',
      availability: 'available',
      compilation: 'not-run',
      execution: 'passed',
      outcome: 'verified',
    })
  } catch (error) {
    proof.checks.push({
      id: 'visionos-default-immersive-launch-source',
      platform: 'visionOS',
      destinationKind: 'source-contract',
      availability: 'available',
      compilation: 'not-run',
      execution: 'failed',
      outcome: 'failed',
    })
    throw error
  }

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
  }, 'xcrun', [
    'swift', 'test',
    '--package-path', 'native',
    '--scratch-path', resolve(temporaryRoot, 'swift-host'),
  ])

  const iOSSimulator = simulatorDestination({
    runtimePlatform: 'iOS',
    deviceName: 'iPhone',
    exactDeviceName: false,
    sdkVersion: proof.toolchain.iOSSDKVersion,
    destinationEnvironmentVariable: 'GAME_XR_IOS_SIMULATOR_UDID',
  })
  simulatorDestinationsToRestore.push(iOSSimulator)
  proof.toolchain.iOSRuntimeIdentifier = iOSSimulator.runtimeIdentifier
  proof.toolchain.iOSRuntimeBuild = iOSSimulator.runtimeBuild
  ensureSimulatorBooted(iOSSimulator)
  recordCheck({
    id: 'ios-simulator-tests',
    platform: 'iOS',
    destinationKind: 'simulator',
    destinationId: iOSSimulator.destinationId,
    deviceName: iOSSimulator.deviceName,
    sdkVersion: iOSSimulator.sdkVersion,
    runtimeIdentifier: iOSSimulator.runtimeIdentifier,
    runtimeBuild: iOSSimulator.runtimeBuild,
    availability: 'available',
    compilation: 'passed',
    execution: 'passed',
    outcome: 'executed',
  }, {
    compilation: 'unknown',
    execution: 'unknown',
  }, 'xcodebuild', [
    '-quiet', '-scheme', 'GameXRNative',
    '-destination', `id=${iOSSimulator.destinationId}`,
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
  }, 'xcrun', [
    'swift', 'build',
    '--package-path', 'native',
    '--scratch-path', resolve(temporaryRoot, 'visionos-build'),
    '--triple', visionSimulatorTriple,
    '--sdk', capture('xcrun', ['--sdk', 'xrsimulator', '--show-sdk-path']).trim(),
  ])

  let visionHostSimulator
  try {
    visionHostSimulator = simulatorDestination({
      runtimePlatform: 'xrOS',
      deviceName: 'Apple Vision Pro',
      exactDeviceName: true,
      sdkVersion: proof.toolchain.visionOSSDKVersion,
      destinationEnvironmentVariable: 'GAME_XR_VISIONOS_SIMULATOR_UDID',
    })
  } catch (error) {
    proof.checks.push({
      id: 'visionos-host-ui-tests',
      platform: 'visionOS',
      destinationKind: 'application-host-simulator',
      project: visionHostProjectRelativePath,
      scheme: visionHostScheme,
      availability: 'unknown',
      compilation: 'not-run',
      execution: 'not-run',
      outcome: 'failed',
      reason: 'destination-discovery-failed',
    })
    throw error
  }
  simulatorDestinationsToRestore.push(visionHostSimulator)
  proof.toolchain.visionOSRuntimeIdentifier = visionHostSimulator.runtimeIdentifier
  proof.toolchain.visionOSRuntimeBuild = visionHostSimulator.runtimeBuild
  requireExpectedValue(
    'GAME_XR_EXPECTED_VISIONOS_RUNTIME_BUILD',
    'visionOS Simulator runtime build',
    visionHostSimulator.runtimeBuild,
  )
  ensureSimulatorBooted(visionHostSimulator)

  recordCheck({
    id: 'visionos-simulator-tests',
    platform: 'visionOS',
    destinationKind: 'simulator',
    destinationId: visionHostSimulator.destinationId,
    deviceName: visionHostSimulator.deviceName,
    sdkVersion: visionHostSimulator.sdkVersion,
    runtimeIdentifier: visionHostSimulator.runtimeIdentifier,
    runtimeBuild: visionHostSimulator.runtimeBuild,
    availability: 'available',
    compilation: 'passed',
    execution: 'passed',
    outcome: 'executed',
  }, {
    compilation: 'unknown',
    execution: 'unknown',
  }, 'xcodebuild', [
    '-quiet', '-scheme', 'GameXRNative',
    '-destination', `id=${visionHostSimulator.destinationId}`,
    '-derivedDataPath', resolve(temporaryRoot, 'visionos'),
    'CODE_SIGNING_ALLOWED=NO', 'test',
  ], nativeRoot)

  const visionHostDerivedData = resolve(temporaryRoot, 'visionos-host-ui-tests')
  recordCheck({
    id: 'visionos-host-ui-tests',
    platform: 'visionOS',
    destinationKind: 'application-host-simulator',
    project: visionHostProjectRelativePath,
    scheme: visionHostScheme,
    sdkVersion: visionHostSimulator.sdkVersion,
    runtimeIdentifier: visionHostSimulator.runtimeIdentifier,
    runtimeBuild: visionHostSimulator.runtimeBuild,
    destinationId: visionHostSimulator.destinationId,
    deviceName: visionHostSimulator.deviceName,
    availability: 'available',
    compilation: 'passed',
    execution: 'passed',
    outcome: 'executed',
  }, {
    compilation: 'unknown',
    execution: 'unknown',
  }, 'xcodebuild', [
    '-quiet',
    '-project', visionHostProject,
    '-scheme', visionHostScheme,
    '-configuration', 'Debug',
    '-sdk', 'xrsimulator',
    '-destination', `id=${visionHostSimulator.destinationId}`,
    '-derivedDataPath', visionHostDerivedData,
    '-only-testing:GameXRVisionAppUITests',
    'test',
  ])

  try {
    const buildSettings = visionHostBuildSettings(visionHostSimulator, visionHostDerivedData)
    const requiredBuildSettings = [
      'CONFIGURATION_BUILD_DIR',
      'FULL_PRODUCT_NAME',
      'INFOPLIST_FILE',
      'PRODUCT_BUNDLE_IDENTIFIER',
      'SRCROOT',
    ]
    for (const key of requiredBuildSettings) {
      if (!buildSettings[key]) {
        throw new Error(`${visionHostScheme} build settings are missing ${key}.`)
      }
    }

    const configuredInfoPlist = resolve(buildSettings.SRCROOT, buildSettings.INFOPLIST_FILE)
    if (configuredInfoPlist !== visionHostInfoPlist) {
      throw new Error(
        `${visionHostScheme} resolves INFOPLIST_FILE to ${configuredInfoPlist}, expected ${visionHostInfoPlist}.`,
      )
    }

    const builtApp = resolve(buildSettings.CONFIGURATION_BUILD_DIR, buildSettings.FULL_PRODUCT_NAME)
    const builtInfoPlist = resolve(builtApp, 'Info.plist')
    verifyImmersiveLaunchPlist(builtInfoPlist)
    const builtBundleIdentifier = capture('plutil', [
      '-extract', 'CFBundleIdentifier', 'raw', '-o', '-', builtInfoPlist,
    ]).trim()
    if (builtBundleIdentifier !== buildSettings.PRODUCT_BUNDLE_IDENTIFIER) {
      throw new Error(
        `Built CFBundleIdentifier ${builtBundleIdentifier} does not match PRODUCT_BUNDLE_IDENTIFIER `
        + `${buildSettings.PRODUCT_BUNDLE_IDENTIFIER}.`,
      )
    }

    ensureSimulatorBooted(visionHostSimulator)
    const installedApp = capture('xcrun', [
      'simctl', 'get_app_container', visionHostSimulator.destinationId,
      builtBundleIdentifier, 'app',
    ]).trim()
    const installedInfoPlist = resolve(installedApp, 'Info.plist')
    verifyImmersiveLaunchPlist(installedInfoPlist)
    requirePlistValue(installedInfoPlist, 'CFBundleIdentifier', builtBundleIdentifier)
    const [builtInfoPlistSHA256, installedInfoPlistSHA256] = await Promise.all([
      sha256File(builtInfoPlist),
      sha256File(installedInfoPlist),
    ])
    if (builtInfoPlistSHA256 !== installedInfoPlistSHA256) {
      throw new Error(
        `Installed Info.plist digest ${installedInfoPlistSHA256} does not match built artifact `
        + `${builtInfoPlistSHA256}.`,
      )
    }

    proof.checks.push({
      id: 'visionos-default-immersive-launch-bundle',
      platform: 'visionOS',
      destinationKind: 'built-and-installed-application',
      destinationId: visionHostSimulator.destinationId,
      runtimeIdentifier: visionHostSimulator.runtimeIdentifier,
      runtimeBuild: visionHostSimulator.runtimeBuild,
      target: visionHostScheme,
      sourceInfoPlist: configuredInfoPlist,
      bundleIdentifier: builtBundleIdentifier,
      builtInfoPlistSHA256,
      installedInfoPlistSHA256,
      availability: 'available',
      compilation: 'passed',
      execution: 'passed',
      outcome: 'verified',
    })
  } catch (error) {
    proof.checks.push({
      id: 'visionos-default-immersive-launch-bundle',
      platform: 'visionOS',
      destinationKind: 'built-and-installed-application',
      destinationId: visionHostSimulator.destinationId,
      availability: 'available',
      compilation: 'unknown',
      execution: 'failed',
      outcome: 'failed',
    })
    throw error
  }

  proof.result = 'passed'
  process.stdout.write('native check passed: Swift, iOS, and visionOS Simulator tests; visionOS host UI-test gates\n')
} catch (error) {
  executionError = error
  proof.result = 'failed'
  proof.error = error instanceof Error ? error.message : String(error)
  throw error
} finally {
  let restorationError = null
  for (const destination of simulatorDestinationsToRestore.toReversed()) {
    try {
      restoreSimulatorBootState(destination)
    } catch (error) {
      restorationError ??= error
    }
  }
  if (restorationError) {
    const message = restorationError instanceof Error ? restorationError.message : String(restorationError)
    proof.result = 'failed'
    proof.error = proof.error ? `${proof.error} Simulator state restoration also failed: ${message}` : `Simulator state restoration failed: ${message}`
  }
  try {
    await rm(temporaryRoot, { recursive: true, force: true })
  } finally {
    writeProof()
  }
  if (restorationError && !executionError) throw restorationError
}
