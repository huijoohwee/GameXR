import Foundation
import Testing
@testable import GameXRNative

@Test func sharedDefaultManifestDecodesAndValidates() throws {
    let data = try defaultManifestData()
    let manifest = try GameXRSceneManifest.decode(data)
    #expect(manifest.schema == "gamexr-scene/v1")
    #expect(manifest.scene.asteroidCount == 32)
    #expect(manifest.ship.asset.kind == .procedural)
    #expect(try GameXRSceneManifest.decode(manifest.encoded()) == manifest)
}

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
    let portrait = AppleSpatialInputFilter.mapToScreen(
        betaDeltaDegrees: 30,
        gammaDeltaDegrees: 8,
        screenAngleDegrees: 0
    )
    #expect(portrait == AppleSpatialInputAxes(pitch: 30, roll: 8))

    let landscape = AppleSpatialInputFilter.mapToScreen(
        betaDeltaDegrees: 30,
        gammaDeltaDegrees: 8,
        screenAngleDegrees: 90
    )
    #expect(abs(landscape.pitch - 8) < 0.000_000_001)
    #expect(abs(landscape.roll + 30) < 0.000_000_001)
    #expect(AppleSpatialInputFilter.shortestAngleDelta(359) == -1)

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
