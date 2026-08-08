import Foundation
import KnowgrphSpatialCore
import Testing
#if canImport(RealityKit)
import RealityKit
#endif
#if canImport(UIKit)
import UIKit
#endif
@testable import GameXRNative

struct CrossRuntimeParityFixture: Decodable {
    let schema: String
    let manifestId: String
    let world: World
    let ship: Ship
    let flight: Flight
    let audio: Audio

    struct World: Decodable {
        let nativeBackgroundName: String
        let boundsRadius: Double
        let stars: Stars
        let asteroids: Asteroids
        let planet: Planet
        let ambientLight: Light
        let keyLight: Light
        let placementDigest: String
    }

    struct Stars: Decodable {
        let nativeName: String
        let count: Int
        let color: String
        let diameter: Double
    }
    struct Asteroids: Decodable {
        let nativeFieldName: String
        let nativeNamePrefix: String
        let count: Int
            let triangleCornerCount: Int
        let color: String
        let roughness: Double
        let metalness: Double
        let samples: [TransformSample]
    }
    struct Planet: Decodable {
        let nativeName: String
        let radius: Double
        let position: [Double]
        let browserVertexCount: Int
        let browserIndexCount: Int
        let baseColor: String
        let emissiveColor: String
        let emissiveIntensity: Double
        let roughness: Double
        let metalness: Double
    }
    struct Light: Decodable {
        let nativeName: String
        let color: String
        let intensity: Double
        let nativeIntensityLux: Double?
        let position: [Double]?
    }
    struct TransformSample: Decodable {
        let index: Int
        let position: [Double]
        let quaternion: [Double]
        let scale: [Double]
    }
    struct Ship: Decodable {
        let nativeRootName: String
        let scale: Double
        let parts: [Part]
        let engineLight: EngineLight
        let animation: Animation
    }
    struct Part: Decodable {
        let nativeName: String
        let geometry: String
        let dimensions: [Double]
        let position: [Double]
        let eulerXYZ: [Double]
        let scale: [Double]
        let material: Material
    }
    struct Material: Decodable {
        let color: String
        let roughness: Double
        let metalness: Double
        let emissiveColor: String?
        let emissiveIntensity: Double?
        let opacity: Double?
        let transmission: Double?
    }
    struct EngineLight: Decodable {
        let nativeName: String
        let color: String
        let intensity: Double
        let nativeIntensityLumens: Double
        let distance: Double
        let decay: Double
        let position: [Double]
    }
    struct Animation: Decodable {
        let deltaSeconds: Double
        let throttle: Double
        let exhaustScale: Double
        let leftWingFlex: Double
        let rightWingFlex: Double
        let planetRotationDelta: Double
        let asteroidRotationDelta: Double
    }
    struct Flight: Decodable { let fixedStepSeconds: Double; let segments: [Segment] }
    struct Segment: Decodable { let ticks: Int; let input: ControlInput; let expected: AircraftState }
    struct ControlInput: Decodable {
        let throttle: Double
        let pitch: Double
        let yaw: Double
        let roll: Double
        let brake: Double
    }
    struct AircraftState: Decodable {
        let position: [Double]
        let velocity: [Double]
        let pitch: Double
        let yaw: Double
        let roll: Double
        let throttle: Double
    }
    struct Audio: Decodable { let samples: [AudioSample] }
    struct AudioSample: Decodable {
        let throttle: Double
        let speed: Double
        let waveform: String
        let frequency: Double
        let gain: Double
        let lowPassFrequency: Double
        let filterQ: Double
    }
}

func crossRuntimeParityFixture() throws -> CrossRuntimeParityFixture {
    let testFile = URL(fileURLWithPath: #filePath)
    let repositoryRoot = testFile
        .deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent()
    let fixtureURL = repositoryRoot.appending(path: "tests/fixtures/gamexr-cross-runtime-parity.v1.json")
    return try JSONDecoder().decode(CrossRuntimeParityFixture.self, from: Data(contentsOf: fixtureURL))
}

#if canImport(RealityKit) && canImport(UIKit) && os(visionOS)
@MainActor
func firstMaterial<MaterialType>(on entity: Entity, as type: MaterialType.Type) throws -> MaterialType {
    let model = try #require(entity.components[ModelComponent.self])
    return try #require(model.materials.first as? MaterialType)
}

@MainActor
func meshExtents(on entity: Entity) throws -> SIMD3<Float> {
    let model = try #require(entity.components[ModelComponent.self])
    return model.mesh.bounds.extents
}

@MainActor
func meshCounts(on entity: Entity) throws -> (vertices: Int, indices: Int) {
    let modelComponent = try #require(entity.components[ModelComponent.self])
    let contents = modelComponent.mesh.contents
    var vertices = 0
    var indices = 0
    for model in contents.models {
        for part in model.parts {
            vertices += part.positions.count
            indices += part.triangleIndices?.count ?? 0
        }
    }
    return (vertices, indices)
}

func expectedMeshExtents(for part: CrossRuntimeParityFixture.Part) -> [Double] {
    switch part.geometry {
    case "box": return part.dimensions
    case "cone": return [part.dimensions[0] * 2, part.dimensions[1], part.dimensions[0] * 2]
    case "sphere": return Array(repeating: part.dimensions[0] * 2, count: 3)
    default:
        Issue.record("Unsupported cross-runtime fixture geometry: \(part.geometry)")
        return []
    }
}

func expectOpacity(_ material: PhysicallyBasedMaterial, equals expected: Float) {
    switch material.blending {
    case .transparent(let opacity): #expect(abs(opacity.scale - expected) < 0.000_01)
    case .opaque: Issue.record("Expected transparent PBR material with opacity \(expected)")
    @unknown default: Issue.record("Unknown PBR blending mode")
    }
}

func expectVector(_ actual: SIMD3<Float>, equals expected: [Double], accuracy: Float = 0.000_01) {
    #expect(expected.count == 3)
    for index in 0..<3 { #expect(abs(actual[index] - Float(expected[index])) <= accuracy) }
}

func expectQuaternion(_ actual: simd_quatf, equals expected: [Double], accuracy: Float) {
    #expect(expected.count == 4)
    let expectedValue = simd_quatf(vector: SIMD4<Float>(expected.map(Float.init)))
    #expect(abs(simd_dot(actual.vector, expectedValue.vector)) >= 1 - accuracy)
}

func eulerXYZQuaternion(_ values: [Double]) -> simd_quatf {
    simd_quatf(angle: Float(values[0]), axis: [1, 0, 0])
        * simd_quatf(angle: Float(values[1]), axis: [0, 1, 0])
        * simd_quatf(angle: Float(values[2]), axis: [0, 0, 1])
}

func expectColor(_ actual: UIColor, equals hex: String) {
    let expected = UIColor(gameXRHex: hex)
    var actualRGBA = (CGFloat.zero, CGFloat.zero, CGFloat.zero, CGFloat.zero)
    var expectedRGBA = (CGFloat.zero, CGFloat.zero, CGFloat.zero, CGFloat.zero)
    #expect(actual.getRed(&actualRGBA.0, green: &actualRGBA.1, blue: &actualRGBA.2, alpha: &actualRGBA.3))
    #expect(expected.getRed(&expectedRGBA.0, green: &expectedRGBA.1, blue: &expectedRGBA.2, alpha: &expectedRGBA.3))
    #expect(abs(actualRGBA.0 - expectedRGBA.0) < 0.000_01)
    #expect(abs(actualRGBA.1 - expectedRGBA.1) < 0.000_01)
    #expect(abs(actualRGBA.2 - expectedRGBA.2) < 0.000_01)
    #expect(abs(actualRGBA.3 - expectedRGBA.3) < 0.000_01)
}

func expectState(
    _ actual: FlightSimAircraftState,
    equals expected: CrossRuntimeParityFixture.AircraftState,
    accuracy: Double
) {
    #expect(abs(actual.position.x - expected.position[0]) <= accuracy)
    #expect(abs(actual.position.y - expected.position[1]) <= accuracy)
    #expect(abs(actual.position.z - expected.position[2]) <= accuracy)
    #expect(abs(actual.velocity.x - expected.velocity[0]) <= accuracy)
    #expect(abs(actual.velocity.y - expected.velocity[1]) <= accuracy)
    #expect(abs(actual.velocity.z - expected.velocity[2]) <= accuracy)
    #expect(abs(actual.pitch - expected.pitch) <= accuracy)
    #expect(abs(actual.yaw - expected.yaw) <= accuracy)
    #expect(abs(actual.roll - expected.roll) <= accuracy)
    #expect(abs(actual.throttle - expected.throttle) <= accuracy)
}
#endif
