import Foundation
import KnowgrphSpatialCore

public struct GameXRSceneManifest: Codable, Equatable, Sendable {
    public let schemaURL: String?
    public let schema: String
    public let id: String
    public let name: String
    public let scene: SceneConfiguration
    public let ship: ShipConfiguration
    public let camera: CameraConfiguration
    public let motion: MotionConfiguration
    public let animation: AnimationConfiguration
    public let audio: AudioConfiguration
    public let performance: PerformanceConfiguration

    enum CodingKeys: String, CodingKey {
        case schemaURL = "$schema"
        case schema, id, name, scene, ship, camera, motion, animation, audio, performance
    }

    public static func decode(_ data: Data) throws -> Self {
        try ManifestJSONStructure.validate(data)
        let manifest = try JSONDecoder().decode(Self.self, from: data)
        try manifest.validate()
        return manifest
    }

    public func encoded() throws -> Data {
        try validate()
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(self)
    }

    public func validate() throws {
        var issues: [String] = []
        if schema != "gamexr-scene/v1" { issues.append("schema must equal gamexr-scene/v1") }
        if id.range(of: "^[a-z0-9]+(?:[._-][a-z0-9]+)*$", options: .regularExpression) == nil || id.count > 64 {
            issues.append("id has an invalid format")
        }
        if name.isEmpty || name.count > 80 { issues.append("name must contain 1 through 80 characters") }

        validateColor(scene.backgroundColor, at: "scene.backgroundColor", issues: &issues)
        validateColor(scene.fogColor, at: "scene.fogColor", issues: &issues)
        validateNumber(scene.fogDensity, at: "scene.fogDensity", range: 0...0.03, issues: &issues)
        validateNumber(scene.boundsRadius, at: "scene.boundsRadius", range: 20...1000, issues: &issues)
        validateInteger(scene.starCount, at: "scene.starCount", range: 0...4000, issues: &issues)
        validateInteger(scene.asteroidCount, at: "scene.asteroidCount", range: 0...128, issues: &issues)
        validateNumber(scene.asteroidFieldRadius, at: "scene.asteroidFieldRadius", range: 10...400, issues: &issues)
        validateNumber(scene.planet.radius, at: "scene.planet.radius", range: 0.5...100, issues: &issues)
        validateVector3(scene.planet.position, at: "scene.planet.position", issues: &issues)
        validateColor(scene.planet.baseColor, at: "scene.planet.baseColor", issues: &issues)
        validateColor(scene.planet.emissiveColor, at: "scene.planet.emissiveColor", issues: &issues)
        validateNumber(scene.planet.rotationSpeed, at: "scene.planet.rotationSpeed", range: -2...2, issues: &issues)
        validateNumber(scene.lighting.ambientIntensity, at: "scene.lighting.ambientIntensity", range: 0...10, issues: &issues)
        validateNumber(scene.lighting.keyIntensity, at: "scene.lighting.keyIntensity", range: 0...20, issues: &issues)
        validateColor(scene.lighting.keyColor, at: "scene.lighting.keyColor", issues: &issues)
        validateVector3(scene.lighting.keyPosition, at: "scene.lighting.keyPosition", issues: &issues)

        validateVector3(ship.position, at: "ship.position", issues: &issues)
        validateVector3(ship.rotation, at: "ship.rotation", issues: &issues)
        validateNumber(ship.scale, at: "ship.scale", range: 0.01...20, issues: &issues)
        validateColor(ship.appearance.hullColor, at: "ship.appearance.hullColor", issues: &issues)
        validateColor(ship.appearance.accentColor, at: "ship.appearance.accentColor", issues: &issues)
        validateColor(ship.appearance.canopyColor, at: "ship.appearance.canopyColor", issues: &issues)
        validateColor(ship.appearance.exhaustColor, at: "ship.appearance.exhaustColor", issues: &issues)
        validateNumber(ship.appearance.metalness, at: "ship.appearance.metalness", range: 0...1, issues: &issues)
        validateNumber(ship.appearance.roughness, at: "ship.appearance.roughness", range: 0...1, issues: &issues)
        validateNumber(ship.flight.acceleration, at: "ship.flight.acceleration", range: 0...200, issues: &issues)
        validateNumber(ship.flight.drag, at: "ship.flight.drag", range: 0...20, issues: &issues)
        validateNumber(ship.flight.maxForwardSpeed, at: "ship.flight.maxForwardSpeed", range: 1...500, issues: &issues)
        validateNumber(ship.flight.pitchRate, at: "ship.flight.pitchRate", range: 0...10, issues: &issues)
        validateNumber(ship.flight.yawRate, at: "ship.flight.yawRate", range: 0...10, issues: &issues)
        validateNumber(ship.flight.rollRate, at: "ship.flight.rollRate", range: 0...10, issues: &issues)
        validateNumber(ship.flight.bankAngle, at: "ship.flight.bankAngle", range: 0...1.57, issues: &issues)
        validateNumber(ship.flight.lateralAssist, at: "ship.flight.lateralAssist", range: 0...30, issues: &issues)

        validateNumber(camera.fieldOfView, at: "camera.fieldOfView", range: 30...100, issues: &issues)
        validateNumber(camera.near, at: "camera.near", range: 0.01...10, issues: &issues)
        validateNumber(camera.far, at: "camera.far", range: 50...5000, issues: &issues)
        if camera.far <= camera.near { issues.append("camera.far must be greater than camera.near") }
        validateNumber(camera.chaseDistance, at: "camera.chaseDistance", range: 2...80, issues: &issues)
        validateNumber(camera.chaseHeight, at: "camera.chaseHeight", range: 0.1...40, issues: &issues)
        validateNumber(camera.lookAhead, at: "camera.lookAhead", range: 0...100, issues: &issues)
        validateNumber(camera.damping, at: "camera.damping", range: 0.1...30, issues: &issues)

        if ship.asset.kind == .procedural && ship.asset.localAssetId != nil {
            issues.append("procedural assets cannot carry localAssetId")
        }
        if ship.asset.kind == .localGLB && ship.asset.localAssetId == nil {
            issues.append("local-glb assets require localAssetId")
        }
        if let localAssetId = ship.asset.localAssetId,
           localAssetId.range(of: "^[a-z0-9]+(?:[._-][a-z0-9]+)*$", options: .regularExpression) == nil
            || localAssetId.count > 64 {
            issues.append("ship.asset.localAssetId has an invalid format")
        }

        validateNumber(motion.sensitivity, at: "motion.sensitivity", range: 0.1...4, issues: &issues)
        validateNumber(motion.deadZone, at: "motion.deadZone", range: 0...0.5, issues: &issues)
        if motion.deviceOrientation.schema != AppleSpatialInputProfile.schemaIdentifier {
            issues.append("motion.deviceOrientation.schema must equal \(AppleSpatialInputProfile.schemaIdentifier)")
        }
        validateNumber(motion.deviceOrientation.controlRangeDegrees, at: "motion.deviceOrientation.controlRangeDegrees", range: 5...90, issues: &issues)
        validateNumber(motion.deviceOrientation.jitterThresholdDegrees, at: "motion.deviceOrientation.jitterThresholdDegrees", range: 0...5, issues: &issues)
        validateNumber(motion.deviceOrientation.settledAxisThreshold, at: "motion.deviceOrientation.settledAxisThreshold", range: 0...0.1, issues: &issues)
        validateNumber(motion.deviceOrientation.smoothingRatePerSecond, at: "motion.deviceOrientation.smoothingRatePerSecond", range: 1...60, issues: &issues)
        validateNumber(motion.deviceOrientation.calibrationTimeoutMilliseconds, at: "motion.deviceOrientation.calibrationTimeoutMilliseconds", range: 250...10_000, issues: &issues)
        validateNumber(animation.timeScale, at: "animation.timeScale", range: 0...4, issues: &issues)
        validateNumber(animation.exhaustPulseSpeed, at: "animation.exhaustPulseSpeed", range: 0...30, issues: &issues)
        validateNumber(animation.exhaustPulseAmount, at: "animation.exhaustPulseAmount", range: 0...1, issues: &issues)
        validateNumber(animation.wingFlexAmount, at: "animation.wingFlexAmount", range: 0...0.5, issues: &issues)
        validateNumber(animation.asteroidDriftSpeed, at: "animation.asteroidDriftSpeed", range: -3...3, issues: &issues)
        if let importedClip = animation.importedClip, importedClip.isEmpty || importedClip.count > 100 {
            issues.append("animation.importedClip must contain 1 through 100 characters when present")
        }
        validateNumber(audio.masterGain, at: "audio.masterGain", range: 0...1, issues: &issues)
        validateNumber(audio.engineBaseFrequency, at: "audio.engineBaseFrequency", range: 20...300, issues: &issues)
        validateNumber(audio.engineThrottleRange, at: "audio.engineThrottleRange", range: 0...1000, issues: &issues)
        if ![30, 60, 90, 120].contains(performance.targetFramesPerSecond) {
            issues.append("targetFramesPerSecond must be 30, 60, 90, or 120")
        }
        validateNumber(performance.maxPixelRatio, at: "performance.maxPixelRatio", range: 0.75...2, issues: &issues)
        if performance.maxSimulationCatchUpSteps < 1 || performance.maxSimulationCatchUpSteps > 5 {
            issues.append("maxSimulationCatchUpSteps must be 1 through 5")
        }
        if !issues.isEmpty { throw GameXRManifestError.invalid(issues) }
    }

    private func validateNumber(
        _ value: Double,
        at path: String,
        range: ClosedRange<Double>,
        issues: inout [String]
    ) {
        if !value.isFinite || !range.contains(value) {
            issues.append("\(path) must be a finite number from \(range.lowerBound) through \(range.upperBound)")
        }
    }

    private func validateInteger(
        _ value: Int,
        at path: String,
        range: ClosedRange<Int>,
        issues: inout [String]
    ) {
        if !range.contains(value) { issues.append("\(path) must be from \(range.lowerBound) through \(range.upperBound)") }
    }

    private func validateVector3(_ value: [Double], at path: String, issues: inout [String]) {
        guard value.count == 3 else {
            issues.append("\(path) must contain exactly three numbers")
            return
        }
        for (index, component) in value.enumerated() {
            validateNumber(component, at: "\(path)[\(index)]", range: -1000...1000, issues: &issues)
        }
    }

    private func validateColor(_ value: String, at path: String, issues: inout [String]) {
        if value.range(of: "^#[0-9A-Fa-f]{6}$", options: .regularExpression) == nil {
            issues.append("\(path) must be a six-digit hexadecimal color")
        }
    }
}

public enum GameXRManifestError: Error, Equatable, Sendable {
    case invalid([String])
}

private enum ManifestJSONStructure {
    private struct Rule {
        let path: [String]
        let allowed: Set<String>
        let required: Set<String>

        init(_ path: String, _ keys: [String], optional: Set<String> = []) {
            self.path = path.isEmpty ? [] : path.split(separator: ".").map(String.init)
            allowed = Set(keys)
            required = allowed.subtracting(optional)
        }
    }

    private static let rules = [
        Rule("", ["$schema", "schema", "id", "name", "scene", "ship", "camera", "motion", "animation", "audio", "performance"], optional: ["$schema"]),
        Rule("scene", ["environment", "backgroundColor", "fogColor", "fogDensity", "boundsRadius", "starCount", "asteroidCount", "asteroidFieldRadius", "planet", "lighting"]),
        Rule("scene.planet", ["enabled", "radius", "position", "baseColor", "emissiveColor", "rotationSpeed"]),
        Rule("scene.lighting", ["ambientIntensity", "keyIntensity", "keyColor", "keyPosition"]),
        Rule("ship", ["asset", "position", "rotation", "scale", "appearance", "flight"]),
        Rule("ship.asset", ["kind", "localAssetId"]),
        Rule("ship.appearance", ["hullColor", "accentColor", "canopyColor", "exhaustColor", "metalness", "roughness"]),
        Rule("ship.flight", ["acceleration", "drag", "maxForwardSpeed", "pitchRate", "yawRate", "rollRate", "bankAngle", "lateralAssist"]),
        Rule("camera", ["fieldOfView", "near", "far", "chaseDistance", "chaseHeight", "lookAhead", "damping"]),
        Rule("motion", ["keyboardEnabled", "touchEnabled", "deviceMotionEnabled", "deviceOrientation", "invertPitch", "sensitivity", "deadZone", "hapticsEnabled"]),
        Rule("motion.deviceOrientation", ["schema", "controlRangeDegrees", "jitterThresholdDegrees", "settledAxisThreshold", "smoothingRatePerSecond", "calibrationTimeoutMilliseconds"]),
        Rule("animation", ["playing", "timeScale", "exhaustPulseSpeed", "exhaustPulseAmount", "wingFlexAmount", "asteroidDriftSpeed", "importedClip", "importedClipLoop"]),
        Rule("audio", ["enabled", "masterGain", "engineBaseFrequency", "engineThrottleRange"]),
        Rule("performance", ["targetFramesPerSecond", "maxPixelRatio", "maxSimulationCatchUpSteps", "dynamicResolution"]),
    ]

    static func validate(_ data: Data) throws {
        guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        var issues: [String] = []
        for rule in rules {
            guard let object = object(at: rule.path, in: root) else { continue }
            let actual = Set(object.keys)
            for key in actual.subtracting(rule.allowed).sorted() {
                issues.append("\(displayPath(rule.path)).\(key) is not supported")
            }
            for key in rule.required.subtracting(actual).sorted() {
                issues.append("\(displayPath(rule.path)).\(key) is required")
            }
        }
        if !issues.isEmpty { throw GameXRManifestError.invalid(issues) }
    }

    private static func object(at path: [String], in root: [String: Any]) -> [String: Any]? {
        var value: Any = root
        for key in path {
            guard let object = value as? [String: Any], let next = object[key] else { return nil }
            value = next
        }
        return value as? [String: Any]
    }

    private static func displayPath(_ path: [String]) -> String {
        path.isEmpty ? "manifest" : "manifest.\(path.joined(separator: "."))"
    }
}

public struct SceneConfiguration: Codable, Equatable, Sendable {
    public enum Environment: String, Codable, Sendable { case deepSpace = "deep-space", orbit, hangar }
    public let environment: Environment
    public let backgroundColor: String
    public let fogColor: String
    public let fogDensity: Double
    public let boundsRadius: Double
    public let starCount: Int
    public let asteroidCount: Int
    public let asteroidFieldRadius: Double
    public let planet: PlanetConfiguration
    public let lighting: LightingConfiguration
}

public struct PlanetConfiguration: Codable, Equatable, Sendable {
    public let enabled: Bool
    public let radius: Double
    public let position: [Double]
    public let baseColor: String
    public let emissiveColor: String
    public let rotationSpeed: Double
}

public struct LightingConfiguration: Codable, Equatable, Sendable {
    public let ambientIntensity: Double
    public let keyIntensity: Double
    public let keyColor: String
    public let keyPosition: [Double]
}

public struct ShipConfiguration: Codable, Equatable, Sendable {
    public let asset: AssetConfiguration
    public let position: [Double]
    public let rotation: [Double]
    public let scale: Double
    public let appearance: AppearanceConfiguration
    public let flight: FlightConfiguration
}

public struct AssetConfiguration: Codable, Equatable, Sendable {
    public enum Kind: String, Codable, Sendable { case procedural, localGLB = "local-glb" }
    public let kind: Kind
    public let localAssetId: String?

    enum CodingKeys: String, CodingKey { case kind, localAssetId }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(kind, forKey: .kind)
        if let localAssetId {
            try container.encode(localAssetId, forKey: .localAssetId)
        } else {
            try container.encodeNil(forKey: .localAssetId)
        }
    }
}

public struct AppearanceConfiguration: Codable, Equatable, Sendable {
    public let hullColor: String
    public let accentColor: String
    public let canopyColor: String
    public let exhaustColor: String
    public let metalness: Double
    public let roughness: Double
}

public struct FlightConfiguration: Codable, Equatable, Sendable {
    public let acceleration: Double
    public let drag: Double
    public let maxForwardSpeed: Double
    public let pitchRate: Double
    public let yawRate: Double
    public let rollRate: Double
    public let bankAngle: Double
    public let lateralAssist: Double
}

public struct CameraConfiguration: Codable, Equatable, Sendable {
    public let fieldOfView: Double
    public let near: Double
    public let far: Double
    public let chaseDistance: Double
    public let chaseHeight: Double
    public let lookAhead: Double
    public let damping: Double
}

public struct MotionConfiguration: Codable, Equatable, Sendable {
    public let keyboardEnabled: Bool
    public let touchEnabled: Bool
    public let deviceMotionEnabled: Bool
    public let deviceOrientation: AppleSpatialInputProfile
    public let invertPitch: Bool
    public let sensitivity: Double
    public let deadZone: Double
    public let hapticsEnabled: Bool
}

public struct AnimationConfiguration: Codable, Equatable, Sendable {
    public let playing: Bool
    public let timeScale: Double
    public let exhaustPulseSpeed: Double
    public let exhaustPulseAmount: Double
    public let wingFlexAmount: Double
    public let asteroidDriftSpeed: Double
    public let importedClip: String?
    public let importedClipLoop: Bool

    enum CodingKeys: String, CodingKey {
        case playing, timeScale, exhaustPulseSpeed, exhaustPulseAmount, wingFlexAmount
        case asteroidDriftSpeed, importedClip, importedClipLoop
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(playing, forKey: .playing)
        try container.encode(timeScale, forKey: .timeScale)
        try container.encode(exhaustPulseSpeed, forKey: .exhaustPulseSpeed)
        try container.encode(exhaustPulseAmount, forKey: .exhaustPulseAmount)
        try container.encode(wingFlexAmount, forKey: .wingFlexAmount)
        try container.encode(asteroidDriftSpeed, forKey: .asteroidDriftSpeed)
        if let importedClip {
            try container.encode(importedClip, forKey: .importedClip)
        } else {
            try container.encodeNil(forKey: .importedClip)
        }
        try container.encode(importedClipLoop, forKey: .importedClipLoop)
    }
}

public struct AudioConfiguration: Codable, Equatable, Sendable {
    public let enabled: Bool
    public let masterGain: Double
    public let engineBaseFrequency: Double
    public let engineThrottleRange: Double
}

public struct PerformanceConfiguration: Codable, Equatable, Sendable {
    public let targetFramesPerSecond: Int
    public let maxPixelRatio: Double
    public let maxSimulationCatchUpSteps: Int
    public let dynamicResolution: Bool
}
