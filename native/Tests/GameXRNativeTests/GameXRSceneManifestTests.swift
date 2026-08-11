import Foundation
import KnowgrphSpatialCore
import Testing
@testable import GameXRNative
#if canImport(RealityKit)
import RealityKit
#endif
#if canImport(UIKit)
import UIKit
#endif

@Test func sharedDefaultManifestDecodesAndValidates() throws {
    let data = try defaultManifestData()
    let manifest = try GameXRSceneManifest.decode(data)
    #expect(manifest.schema == "gamexr-scene/v1")
    #expect(manifest.scene.asteroidCount == 32)
    #expect(manifest.ship.asset.kind == .procedural)
    #expect(try GameXRSceneManifest.decode(manifest.encoded()) == manifest)
}

#if canImport(RealityKit) && (os(iOS) || os(visionOS))
@Test @MainActor func coordinatorExcludesPausedShipFromCanonicalFlightSystem() throws {
    let manifest = try GameXRSceneManifest.decode(defaultManifestData())
    let coordinator = GameXRNativeCoordinator(manifest: manifest, presentation: .spatial)
    defer { coordinator.dispose() }
    let ship = try #require(coordinator.rootEntity.findEntity(named: "gamexr-ship"))

    #expect(coordinator.isFlightSystemActive == false)
    let initialTelemetry = coordinator.flightTelemetrySummary
    coordinator.setControls(throttle: 1, pitch: 0.2, yaw: -0.3, roll: 0.4)
    coordinator.play()
    #expect(coordinator.isFlightSystemActive == true)
    let input = try #require(coordinator.flightControlInputSnapshot)
    let state = try #require(coordinator.flightStateSnapshot)
    let profile = try #require(coordinator.flightProfileSnapshot)
    #expect(input.throttleDelta == 1)
    #expect(abs(input.pitch - 0.148_936_170_212_765_98) < 0.000_001)
    #expect(abs(input.yaw + 0.255_319_148_936_170_2) < 0.000_001)
    #expect(abs(input.roll - 0.361_702_127_659_574_5) < 0.000_001)
    let tickedState = try integrateFlightModel(
        previous: state,
        inputValue: input,
        stepSeconds: flightSimFixedStepSeconds,
        profile: profile
    )
    #expect(tickedState != state)
    coordinator.pause()
    #expect(coordinator.isFlightSystemActive == false)
    ship.position = [4, 5, 6]
    coordinator.reset()
    #expect(ship.position == SIMD3<Float>(0, 0, 0))
    #expect(coordinator.flightStateSnapshot?.position == SpatialVector3.zero)
    #expect(coordinator.flightTelemetrySummary == initialTelemetry)
}

@Test @MainActor func coordinatorBrakeMomentarilyOverridesPersistedThrottleTarget() throws {
    let manifest = try GameXRSceneManifest.decode(defaultManifestData())
    let coordinator = GameXRNativeCoordinator(manifest: manifest, presentation: .spatial)
    defer { coordinator.dispose() }

    coordinator.setControls(throttle: 1)
    coordinator.play()
    #expect(coordinator.flightControlInputSnapshot?.throttleDelta == 1)

    coordinator.setBrake(1)
    #expect(coordinator.throttle == 1)
    #expect(coordinator.flightControlInputSnapshot?.throttleDelta == 0)

    coordinator.setBrake(0)
    #expect(coordinator.throttle == 1)
    #expect(coordinator.flightControlInputSnapshot?.throttleDelta == 1)
}
#endif

#if canImport(RealityKit) && os(visionOS)
@Test @MainActor func immersiveWorldProjectionIsCompleteDeterministicAndSingular() throws {
    let manifest = try GameXRSceneManifest.decode(defaultManifestData())
    let first = GameXRNativeCoordinator(manifest: manifest, presentation: .immersiveSpace)
    let second = GameXRNativeCoordinator(manifest: manifest, presentation: .immersiveSpace)
    defer { first.dispose(); second.dispose() }
    let alternateSeed = try GameXRWorldEntityBuilder.build(
        from: manifest.scene,
        animation: manifest.animation,
        seed: "alternate-seed"
    )

    #expect(first.worldProjectionError == nil)
    #expect(first.worldInventory.starCount == manifest.scene.starCount)
    #expect(first.worldInventory.asteroidCount == manifest.scene.asteroidCount)
    #expect(first.worldInventory.hasPlanet == manifest.scene.planet.enabled)
    #expect(first.worldInventory.placementDigest == second.worldInventory.placementDigest)
    #expect(first.worldInventory.placementDigest == 14_237_543_821_781_407_139)
    #expect(first.worldInventory.placementDigest != alternateSeed.inventory.placementDigest)
    #expect(first.rootEntity.findEntity(named: "gamexr-world") != nil)
    #expect(first.rootEntity.findEntity(named: "gamexr-stars") != nil)
    #expect(first.rootEntity.findEntity(named: "gamexr-asteroids") != nil)
    #expect(first.rootEntity.findEntity(named: "gamexr-planet") != nil)
    #expect(first.rootEntity.findEntity(named: "gamexr-key-light") != nil)
    #expect(first.rootEntity.findEntity(named: "gamexr-ship") != nil)

    try first.apply(manifest)
    #expect(first.rootEntity.children.filter { $0.name == "gamexr-world" }.count == 1)
    #expect(first.rootEntity.children.filter { $0.name == "gamexr-ship" }.count == 1)

    var zeroFixture = try defaultManifestObject()
    zeroFixture = try setting(0, at: ["scene", "starCount"], in: zeroFixture)
    zeroFixture = try setting(0, at: ["scene", "asteroidCount"], in: zeroFixture)
    zeroFixture = try setting(0, at: ["scene", "lighting", "keyIntensity"], in: zeroFixture)
    let zeroManifest = try GameXRSceneManifest.decode(JSONSerialization.data(withJSONObject: zeroFixture))
    let zeroWorld = try GameXRWorldEntityBuilder.build(
        from: zeroManifest.scene,
        animation: zeroManifest.animation,
        seed: zeroManifest.id
    )
    let zeroStars = try #require(zeroWorld.entity.findEntity(named: "gamexr-stars"))
    let zeroAsteroids = try #require(zeroWorld.entity.findEntity(named: "gamexr-asteroids"))
    let zeroKeyLight = try #require(zeroWorld.entity.findEntity(named: "gamexr-key-light"))
    let zeroKeyLightComponent = try #require(zeroKeyLight.components[DirectionalLightComponent.self])
    #expect(!(zeroStars is ModelEntity))
    #expect(!(zeroAsteroids is ModelEntity))
    #expect(zeroKeyLightComponent.intensity == 0)

    var orbitFixture = try defaultManifestObject()
    orbitFixture = try setting("orbit", at: ["scene", "environment"], in: orbitFixture)
    let orbitManifest = try GameXRSceneManifest.decode(JSONSerialization.data(withJSONObject: orbitFixture))
    let orbitCoordinator = GameXRNativeCoordinator(manifest: orbitManifest, presentation: .immersiveSpace)
    defer { orbitCoordinator.dispose() }
    let orbitFailure = try #require(orbitCoordinator.worldProjectionError)
    #expect(orbitFailure.contains("orbit environment"))
    #expect(orbitCoordinator.projectionState == .failed(orbitFailure))
    #expect(orbitCoordinator.rootEntity.children.isEmpty)
    #expect(orbitCoordinator.rootEntity.findEntity(named: "gamexr-world") == nil)

    var assetFixture = try defaultManifestObject()
    assetFixture = try setting("local-glb", at: ["ship", "asset", "kind"], in: assetFixture)
    assetFixture = try setting("ship-local", at: ["ship", "asset", "localAssetId"], in: assetFixture)
    let assetManifest = try GameXRSceneManifest.decode(JSONSerialization.data(withJSONObject: assetFixture))
    do {
        try first.apply(assetManifest)
        Issue.record("Expected native local-glb projection to fail closed")
    } catch {
        #expect(error.localizedDescription.contains("local-glb asset kind"))
    }
    #expect(first.manifest == manifest)
}

@Test @MainActor func nativeImmersiveProjectionMatchesBrowserVisualGolden() throws {
    let fixture = try crossRuntimeParityFixture()
    let manifest = try GameXRSceneManifest.decode(defaultManifestData())
    let coordinator = GameXRNativeCoordinator(manifest: manifest, presentation: .immersiveSpace)
    defer { coordinator.dispose() }
    let world = try #require(coordinator.rootEntity.findEntity(named: "gamexr-world"))

    #expect(fixture.schema == "gamexr-cross-runtime-parity/v1")
    #expect(fixture.manifestId == manifest.id)
    #expect(coordinator.worldProjectionError == nil)
    #expect(coordinator.worldInventory.starCount == fixture.world.stars.count)
    #expect(coordinator.worldInventory.asteroidCount == fixture.world.asteroids.count)
    #expect(coordinator.worldInventory.hasPlanet)
    let expectedDigest = try #require(UInt64(fixture.world.placementDigest))
    #expect(coordinator.worldInventory.placementDigest == expectedDigest)

    let background = try #require(world.findEntity(named: fixture.world.nativeBackgroundName))
    let stars = try #require(world.findEntity(named: fixture.world.stars.nativeName))
    let asteroidField = try #require(world.findEntity(named: fixture.world.asteroids.nativeFieldName))
    let planet = try #require(world.findEntity(named: fixture.world.planet.nativeName))
    let ambient = try #require(world.findEntity(named: fixture.world.ambientLight.nativeName))
    let key = try #require(world.findEntity(named: fixture.world.keyLight.nativeName))
    #expect(background.components[ModelComponent.self] != nil)
    #expect(stars.components[ModelComponent.self] != nil)
    #expect(ambient.components[ModelComponent.self] == nil)
    let fog = try #require(world.components[GameXRFogMetadataComponent.self])
    #expect(fog.color == manifest.scene.fogColor)
    #expect(abs(fog.density - Float(manifest.scene.fogDensity)) < 0.000_01)
    let ambientMetadata = try #require(ambient.components[GameXRAmbientLightMetadataComponent.self])
    #expect(ambient.components[ImageBasedLightComponent.self] != nil)
    #expect(ambientMetadata.color == fixture.world.ambientLight.color)
    #expect(abs(ambientMetadata.intensity - Float(fixture.world.ambientLight.intensity)) < 0.000_01)
    let backgroundMaterial = try firstMaterial(on: background, as: UnlitMaterial.self)
    expectColor(backgroundMaterial.color.tint, equals: manifest.scene.backgroundColor)
    expectVector(
        try meshExtents(on: background),
        equals: [Double(fixture.world.boundsRadius * 2), Double(fixture.world.boundsRadius * 2), Double(fixture.world.boundsRadius * 2)]
    )
    let starMetadata = try #require(stars.components[GameXRSourcePrimitiveMetadataComponent.self])
    #expect(starMetadata.primitive.rawValue == "points")
    #expect(starMetadata.instanceCount == fixture.world.stars.count)
    #expect(abs((starMetadata.pointSize ?? 0) - Float(fixture.world.stars.diameter)) < 0.000_01)
    let asteroidMetadata = try #require(asteroidField.components[GameXRSourcePrimitiveMetadataComponent.self])
    #expect(asteroidMetadata.primitive.rawValue == "icosahedronDetailOne")
    #expect(asteroidMetadata.instanceCount == fixture.world.asteroids.count)

    let asteroids = asteroidField.children.sorted { $0.name < $1.name }
    #expect(asteroids.count == fixture.world.asteroids.count)
    for index in 0..<fixture.world.asteroids.count {
        let entity = try #require(asteroidField.findEntity(
            named: "\(fixture.world.asteroids.nativeNamePrefix)\(index)"
        ))
        #expect(entity.components[ModelComponent.self] != nil)
        #expect(entity.components[ImageBasedLightReceiverComponent.self] != nil)
    }
    for sample in fixture.world.asteroids.samples {
        let entity = try #require(asteroidField.findEntity(
            named: "\(fixture.world.asteroids.nativeNamePrefix)\(sample.index)"
        ))
        expectVector(entity.position, equals: sample.position, accuracy: 0.000_02)
        expectVector(entity.scale, equals: sample.scale, accuracy: 0.000_02)
        expectQuaternion(entity.orientation, equals: sample.quaternion, accuracy: 0.000_02)
    }

    expectVector(planet.position, equals: fixture.world.planet.position)
    #expect(planet.components[ImageBasedLightReceiverComponent.self] != nil)
    let planetMetadata = try #require(planet.components[GameXRSourcePrimitiveMetadataComponent.self])
    #expect(planetMetadata.primitive.rawValue == "sphere32x20")
    #expect(planetMetadata.instanceCount == 1)
    expectVector(
        try meshExtents(on: planet),
        equals: [fixture.world.planet.radius * 2, fixture.world.planet.radius * 2, fixture.world.planet.radius * 2]
    )
    let planetMeshCounts = try meshCounts(on: planet)
    #expect(planetMeshCounts.vertices == fixture.world.planet.browserVertexCount)
    #expect(planetMeshCounts.indices == fixture.world.planet.browserIndexCount)
    let planetMaterial = try firstMaterial(on: planet, as: PhysicallyBasedMaterial.self)
    expectColor(planetMaterial.baseColor.tint, equals: fixture.world.planet.baseColor)
    expectColor(planetMaterial.emissiveColor.color, equals: fixture.world.planet.emissiveColor)
    #expect(abs(planetMaterial.emissiveIntensity - Float(fixture.world.planet.emissiveIntensity)) < 0.000_01)
    #expect(abs(planetMaterial.roughness.scale - Float(fixture.world.planet.roughness)) < 0.000_01)
    #expect(abs(planetMaterial.metallic.scale - Float(fixture.world.planet.metalness)) < 0.000_01)

    let starMaterial = try firstMaterial(on: stars, as: UnlitMaterial.self)
    expectColor(starMaterial.color.tint, equals: fixture.world.stars.color)
    let asteroidMaterial = try firstMaterial(on: asteroids[0], as: PhysicallyBasedMaterial.self)
    let asteroidMeshCounts = try meshCounts(on: asteroids[0])
    #expect(asteroidMeshCounts.indices == fixture.world.asteroids.triangleCornerCount)
    expectColor(asteroidMaterial.baseColor.tint, equals: fixture.world.asteroids.color)
    #expect(abs(asteroidMaterial.roughness.scale - Float(fixture.world.asteroids.roughness)) < 0.000_01)
    #expect(abs(asteroidMaterial.metallic.scale - Float(fixture.world.asteroids.metalness)) < 0.000_01)

    let keyComponent = try #require(key.components[DirectionalLightComponent.self])
    #expect(key.components[PointLightComponent.self] == nil)
    expectColor(keyComponent.color, equals: fixture.world.keyLight.color)
    #expect(abs(keyComponent.intensity - Float(try #require(fixture.world.keyLight.nativeIntensityLux))) < 0.000_1)
    expectVector(key.position, equals: try #require(fixture.world.keyLight.position))
}

@Test @MainActor func nativeProceduralShipMatchesBrowserPartsAndLightGolden() throws {
    let fixture = try crossRuntimeParityFixture()
    let manifest = try GameXRSceneManifest.decode(defaultManifestData())
    let coordinator = GameXRNativeCoordinator(manifest: manifest, presentation: .immersiveSpace)
    defer { coordinator.dispose() }
    let ship = try #require(coordinator.rootEntity.findEntity(named: fixture.ship.nativeRootName))
    #expect(ship.scale == SIMD3<Float>(repeating: Float(fixture.ship.scale)))

    for part in fixture.ship.parts {
        let entity = try #require(ship.findEntity(named: part.nativeName))
        #expect(entity.components[ModelComponent.self] != nil)
        expectVector(try meshExtents(on: entity), equals: expectedMeshExtents(for: part))
        expectVector(entity.position, equals: part.position)
        expectVector(entity.scale, equals: part.scale)
        let expectedOrientation = eulerXYZQuaternion(part.eulerXYZ)
        #expect(abs(simd_dot(entity.orientation.vector, expectedOrientation.vector)) > 0.999_999)
        let material = try firstMaterial(on: entity, as: PhysicallyBasedMaterial.self)
        expectColor(material.baseColor.tint, equals: part.material.color)
        #expect(abs(material.roughness.scale - Float(part.material.roughness)) < 0.000_01)
        #expect(abs(material.metallic.scale - Float(part.material.metalness)) < 0.000_01)
        if let opacity = part.material.opacity { expectOpacity(material, equals: Float(opacity)) }
        if let emissiveColor = part.material.emissiveColor {
            expectColor(material.emissiveColor.color, equals: emissiveColor)
            #expect(abs(material.emissiveIntensity - Float(part.material.emissiveIntensity ?? 0)) < 0.000_01)
            #expect(material.writesDepth == false)
        }
    }

    let light = try #require(ship.findEntity(named: fixture.ship.engineLight.nativeName))
    let lightComponent = try #require(light.components[PointLightComponent.self])
    expectVector(light.position, equals: fixture.ship.engineLight.position)
    expectColor(lightComponent.color, equals: fixture.ship.engineLight.color)
    #expect(abs(lightComponent.intensity - Float(fixture.ship.engineLight.nativeIntensityLumens)) < 0.000_1)
    #expect(abs(lightComponent.attenuationRadius - Float(fixture.ship.engineLight.distance)) < 0.000_01)
    #expect(abs(lightComponent.attenuationFalloffExponent - Float(fixture.ship.engineLight.decay)) < 0.000_01)

    coordinator.setControls(throttle: Float(fixture.ship.animation.throttle))
    coordinator.play()
    coordinator.synchronizeFrame(deltaSeconds: fixture.ship.animation.deltaSeconds)
    for name in ["gamexr-left-exhaust", "gamexr-right-exhaust"] {
        let exhaust = try #require(ship.findEntity(named: name))
        expectVector(exhaust.scale, equals: [1, fixture.ship.animation.exhaustScale, 1])
    }
    let leftWing = try #require(ship.findEntity(named: "gamexr-left-wing"))
    let rightWing = try #require(ship.findEntity(named: "gamexr-right-wing"))
    let expectedLeft = simd_quatf(angle: -0.12, axis: [0, 1, 0])
        * simd_quatf(angle: Float(fixture.ship.animation.leftWingFlex), axis: [0, 0, 1])
    let expectedRight = simd_quatf(angle: 0.12, axis: [0, 1, 0])
        * simd_quatf(angle: Float(fixture.ship.animation.rightWingFlex), axis: [0, 0, 1])
    #expect(abs(simd_dot(leftWing.orientation.vector, expectedLeft.vector)) > 0.999_999)
    #expect(abs(simd_dot(rightWing.orientation.vector, expectedRight.vector)) > 0.999_999)
    let world = try #require(coordinator.rootEntity.findEntity(named: "gamexr-world"))
    let planet = try #require(world.findEntity(named: fixture.world.planet.nativeName))
    let asteroidField = try #require(world.findEntity(named: fixture.world.asteroids.nativeFieldName))
    let planetRotation = try #require(planet.components[GameXRRotationMetadataComponent.self])
    let asteroidRotation = try #require(asteroidField.components[GameXRRotationMetadataComponent.self])
    #expect(planetRotation.runtimeRunning)
    #expect(asteroidRotation.runtimeRunning)
    #expect(abs(
        Double(planetRotation.radiansPerSecond * planetRotation.timeScale)
            * fixture.ship.animation.deltaSeconds - fixture.ship.animation.planetRotationDelta
    ) < 0.000_001)
    #expect(abs(
        Double(asteroidRotation.radiansPerSecond * asteroidRotation.timeScale)
            * fixture.ship.animation.deltaSeconds - fixture.ship.animation.asteroidRotationDelta
    ) < 0.000_001)
}

@Test @MainActor func nativeFlightExecutesBrowserGoldenControlTrace() throws {
    let fixture = try crossRuntimeParityFixture()
    let manifest = try GameXRSceneManifest.decode(defaultManifestData())
    let coordinator = GameXRNativeCoordinator(manifest: manifest, presentation: .immersiveSpace)
    defer { coordinator.dispose() }
    let profile = try #require(coordinator.flightProfileSnapshot)
    var state = try #require(coordinator.flightStateSnapshot)
    #expect(abs(fixture.flight.fixedStepSeconds - flightSimFixedStepSeconds) < 1e-15)

    for segment in fixture.flight.segments {
        for _ in 0..<segment.ticks {
            let requestedThrottle = segment.input.brake > 0
                ? 0
                : min(1, max(0, segment.input.throttle))
            state = try integrateFlightModel(
                previous: state,
                inputValue: FlightSimTickInput(
                    pitch: segment.input.pitch,
                    roll: segment.input.roll,
                    yaw: segment.input.yaw,
                    throttleDelta: requestedThrottle - state.throttle
                ),
                stepSeconds: fixture.flight.fixedStepSeconds,
                profile: profile
            )
        }
        expectState(state, equals: segment.expected, accuracy: 1e-9)
    }
}
#endif

#if canImport(AVFAudio)
@Test func nativeAudioProjectionMatchesBrowserGoldenSamples() throws {
    let fixture = try crossRuntimeParityFixture()
    let manifest = try GameXRSceneManifest.decode(defaultManifestData())
    for sample in fixture.audio.samples {
        let actual = GameXRNativeAudioTargetProjection.project(
            configuration: manifest.audio,
            throttle: sample.throttle,
            speed: sample.speed
        )
        #expect(sample.waveform == "sawtooth")
        #expect(abs(actual.frequency - sample.frequency) < 0.000_000_1)
        #expect(abs(actual.gain - sample.gain) < 0.000_000_1)
        #expect(abs(actual.cutoff - sample.lowPassFrequency) < 0.000_000_1)
        #expect(abs(actual.qualityFactor - sample.filterQ) < 0.000_000_1)
    }
}
#endif

@Test func decoderRejectsUnknownAndMissingObjectFields() throws {
    let fixture = try defaultManifestObject()
    let unknownField = try setting(true, at: ["scene", "unsupported"], in: fixture)
    expectManifestError(try JSONSerialization.data(withJSONObject: unknownField), containing: "manifest.scene.unsupported is not supported")

    let missingNullableField = try setting(nil, at: ["ship", "asset", "localAssetId"], in: fixture)
    expectManifestError(try JSONSerialization.data(withJSONObject: missingNullableField), containing: "manifest.ship.asset.localAssetId is required")
}

@Test func decoderRejectsMalformedVectorsColorsAndRanges() throws {
    let fixture = try defaultManifestObject()

    let shortVector = try setting([0, 1], at: ["ship", "position"], in: fixture)
    expectManifestError(try JSONSerialization.data(withJSONObject: shortVector), containing: "ship.position must contain exactly three numbers")

    let invalidColor = try setting("orange", at: ["ship", "appearance", "exhaustColor"], in: fixture)
    expectManifestError(try JSONSerialization.data(withJSONObject: invalidColor), containing: "ship.appearance.exhaustColor must be a six-digit hexadecimal color")

    let outOfRange = try setting(500, at: ["scene", "asteroidCount"], in: fixture)
    expectManifestError(try JSONSerialization.data(withJSONObject: outOfRange), containing: "scene.asteroidCount must be from 0 through 128")

    let unsupportedChaseHeight = try setting(0, at: ["camera", "chaseHeight"], in: fixture)
    expectManifestError(
        try JSONSerialization.data(withJSONObject: unsupportedChaseHeight),
        containing: "camera.chaseHeight must be a finite number from 0.1 through 40.0"
    )
}

@Test func decoderRejectsAssetKindRelationshipMismatch() throws {
    let fixture = try defaultManifestObject()
    let localAssetWithoutIdentifier = try setting("local-glb", at: ["ship", "asset", "kind"], in: fixture)
    expectManifestError(try JSONSerialization.data(withJSONObject: localAssetWithoutIdentifier), containing: "local-glb assets require localAssetId")
}

@Test func programmaticValidationRejectsNonFiniteNumbers() throws {
    let manifest = try GameXRSceneManifest.decode(defaultManifestData())
    let invalidScene = SceneConfiguration(
        environment: manifest.scene.environment,
        backgroundColor: manifest.scene.backgroundColor,
        fogColor: manifest.scene.fogColor,
        fogDensity: .infinity,
        boundsRadius: manifest.scene.boundsRadius,
        starCount: manifest.scene.starCount,
        asteroidCount: manifest.scene.asteroidCount,
        asteroidFieldRadius: manifest.scene.asteroidFieldRadius,
        planet: manifest.scene.planet,
        lighting: manifest.scene.lighting
    )
    let invalidManifest = GameXRSceneManifest(
        schemaURL: manifest.schemaURL,
        schema: manifest.schema,
        id: manifest.id,
        name: manifest.name,
        scene: invalidScene,
        ship: manifest.ship,
        camera: manifest.camera,
        motion: manifest.motion,
        animation: manifest.animation,
        audio: manifest.audio,
        performance: manifest.performance
    )

    do {
        try invalidManifest.validate()
        Issue.record("Expected a non-finite number validation failure")
    } catch GameXRManifestError.invalid(let issues) {
        #expect(issues.contains { $0.contains("scene.fogDensity must be a finite number") })
    } catch {
        Issue.record("Unexpected error: \(error)")
    }
}

@Test func appleSpatialInputMatchesBrowserConformanceVectors() {
    let portrait = AppleSpatialInputFilter.mapDeviceOrientationDeltaToScreen(
        betaDeltaDegrees: 30,
        gammaDeltaDegrees: 8,
        screenAngleDegrees: 0
    )
    #expect(portrait == ScreenOrientationAxes(pitchDegrees: 30, rollDegrees: 8))

    let landscape = AppleSpatialInputFilter.mapDeviceOrientationDeltaToScreen(
        betaDeltaDegrees: 30,
        gammaDeltaDegrees: 8,
        screenAngleDegrees: 90
    )
    #expect(abs(landscape.pitchDegrees - 8) < 0.000_000_001)
    #expect(abs(landscape.rollDegrees + 30) < 0.000_000_001)
    #expect(AppleSpatialInputFilter.shortestAngleDeltaDegrees(359) == -1)

    var filter = AppleSpatialInputFilter()
    let calibrated = filter.project(
        AppleSpatialInputSample(
            betaDegrees: 10,
            gammaDegrees: 3,
            screenAngleDegrees: 0,
            timestampMilliseconds: 0
        ),
        profile: .default
    )
    #expect(calibrated.calibratedNow)
    #expect(calibrated.axes == AppleSpatialInputAxes())
    let steered = filter.project(
        AppleSpatialInputSample(
            betaDegrees: 45,
            gammaDegrees: 3,
            screenAngleDegrees: 0,
            timestampMilliseconds: 16
        ),
        profile: .default
    )
    #expect(steered.axes.pitch > 0 && steered.axes.pitch < 1)
}

@Test func appleSpatialInputRejectsNonFiniteSamplesWithoutCalibration() {
    var filter = AppleSpatialInputFilter()
    let projection = filter.project(
        AppleSpatialInputSample(
            betaDegrees: .nan,
            gammaDegrees: 0,
            screenAngleDegrees: 0,
            timestampMilliseconds: 1_000
        ),
        profile: .default
    )
    #expect(projection.calibratedNow == false)
    #expect(projection.axes == AppleSpatialInputAxes())
}

private enum FixtureError: Error {
    case expectedObject(String)
}

private func defaultManifestData() throws -> Data {
    let testFile = URL(fileURLWithPath: #filePath)
    let repositoryRoot = testFile
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
    return try Data(contentsOf: repositoryRoot.appending(path: "shared/default-scene.json"))
}

private func defaultManifestObject() throws -> [String: Any] {
    guard let object = try JSONSerialization.jsonObject(with: defaultManifestData()) as? [String: Any] else {
        throw FixtureError.expectedObject("manifest")
    }
    return object
}

private func setting(_ value: Any?, at path: [String], in object: [String: Any]) throws -> [String: Any] {
    guard let key = path.first else { return object }
    var result = object
    if path.count == 1 {
        result[key] = value
        return result
    }
    guard let child = object[key] as? [String: Any] else {
        throw FixtureError.expectedObject(path.dropLast().joined(separator: "."))
    }
    result[key] = try setting(value, at: Array(path.dropFirst()), in: child)
    return result
}

private func expectManifestError(_ data: Data, containing expectedIssue: String) {
    do {
        _ = try GameXRSceneManifest.decode(data)
        Issue.record("Expected manifest validation to fail")
    } catch GameXRManifestError.invalid(let issues) {
        #expect(issues.contains(expectedIssue))
    } catch {
        Issue.record("Unexpected error: \(error)")
    }
}
