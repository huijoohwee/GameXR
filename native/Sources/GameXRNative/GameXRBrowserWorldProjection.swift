#if canImport(RealityKit) && canImport(UIKit) && os(visionOS)
import RealityKit
import UIKit

struct GameXRBrowserAsteroidLayout: Equatable, Sendable {
    let position: SIMD3<Float>
    let eulerXYZ: SIMD3<Float>
    let orientation: simd_quatf
    let scale: SIMD3<Float>
}

struct GameXRBrowserSeededRandom {
    private var state: UInt32 = 2_166_136_261

    init(seed: String) {
        for codeUnit in seed.utf16 {
            state ^= UInt32(codeUnit)
            state = state &* 16_777_619
        }
    }

    mutating func next() -> Double {
        state &+= 0x6D2B79F5
        var value = state
        value = (value ^ (value >> 15)) &* (value | 1)
        value ^= value &+ ((value ^ (value >> 7)) &* (value | 61))
        return Double(value ^ (value >> 14)) / 4_294_967_296
    }
}

@MainActor
enum GameXRBrowserWorldProjection {
    static let starColor = "#d7e9ff"
    static let starPointSize: Float = 0.12
    static let asteroidColor = "#596273"
    static let asteroidRoughness: Float = 0.94
    static let asteroidMetalness: Float = 0.06
    static let ambientColor = "#b9d4ff"
    static let planetEmissiveIntensity: Float = 0.8
    static let planetRoughness: Float = 0.84

    static func starCenters(
        count: Int,
        asteroidFieldRadius: Double,
        boundsRadius: Double,
        random: inout GameXRBrowserSeededRandom
    ) -> [SIMD3<Float>] {
        let minimumRadius = max(24, asteroidFieldRadius * 0.7)
        let maximumRadius = boundsRadius * 0.95
        var centers: [SIMD3<Float>] = []
        centers.reserveCapacity(count)

        for _ in 0..<count {
            var direction = SIMD3<Double>(
                random.next() * 2 - 1,
                random.next() * 2 - 1,
                random.next() * 2 - 1
            )
            let magnitude = simd_length(direction)
            if magnitude > 0 { direction /= magnitude }
            let distance = minimumRadius + random.next() * (maximumRadius - minimumRadius)
            centers.append(SIMD3<Float>(direction * distance))
        }
        return centers
    }

    static func asteroidLayouts(
        count: Int,
        fieldRadius: Double,
        random: inout GameXRBrowserSeededRandom
    ) -> [GameXRBrowserAsteroidLayout] {
        var layouts: [GameXRBrowserAsteroidLayout] = []
        layouts.reserveCapacity(count)
        for _ in 0..<count {
            let angle = random.next() * Double.pi * 2
            let distance = fieldRadius * (0.45 + random.next() * 0.55)
            let position = SIMD3<Float>(
                Float(cos(angle) * distance),
                Float((random.next() - 0.5) * distance * 0.45),
                Float(sin(angle) * distance)
            )
            let size = random.next() * 1.8 + 0.25
            let scale = SIMD3<Float>(
                Float(size),
                Float(size * (0.65 + random.next() * 0.7)),
                Float(size * (0.65 + random.next() * 0.7))
            )
            let rotation = SIMD3<Double>(
                random.next() * Double.pi,
                random.next() * Double.pi,
                random.next() * Double.pi
            )
            layouts.append(.init(
                position: position,
                eulerXYZ: SIMD3<Float>(rotation),
                orientation: quaternionXYZ(rotation),
                scale: scale
            ))
        }
        return layouts
    }

    static func starProxyMesh(centers: [SIMD3<Float>]) throws -> MeshResource {
        let radius = starPointSize / 2
        let unitVertices: [SIMD3<Float>] = [
            [radius, 0, 0], [-radius, 0, 0], [0, radius, 0],
            [0, -radius, 0], [0, 0, radius], [0, 0, -radius],
        ]
        let unitIndices: [UInt32] = [
            0, 2, 4, 4, 2, 1, 1, 2, 5, 5, 2, 0,
            4, 3, 0, 1, 3, 4, 5, 3, 1, 0, 3, 5,
        ]
        var positions: [SIMD3<Float>] = []
        var indices: [UInt32] = []
        positions.reserveCapacity(centers.count * unitVertices.count)
        indices.reserveCapacity(centers.count * unitIndices.count)
        for center in centers {
            let base = UInt32(positions.count)
            positions.append(contentsOf: unitVertices.map { center + $0 })
            indices.append(contentsOf: unitIndices.map { base + $0 })
        }
        return try mesh(name: "gamexr-star-point-proxy", positions: positions, indices: indices)
    }

    static func asteroidMesh() throws -> MeshResource {
        let goldenRatio = (1 + sqrt(5.0)) / 2
        let vertices: [SIMD3<Double>] = [
            [-1, goldenRatio, 0], [1, goldenRatio, 0], [-1, -goldenRatio, 0], [1, -goldenRatio, 0],
            [0, -1, goldenRatio], [0, 1, goldenRatio], [0, -1, -goldenRatio], [0, 1, -goldenRatio],
            [goldenRatio, 0, -1], [goldenRatio, 0, 1], [-goldenRatio, 0, -1], [-goldenRatio, 0, 1],
        ]
        let baseIndices = [
            0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11,
            1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
            3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9,
            4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
        ]
        var positions: [SIMD3<Float>] = []
        positions.reserveCapacity(240)
        for face in stride(from: 0, to: baseIndices.count, by: 3) {
            appendDetailOneFace(
                vertices[baseIndices[face]],
                vertices[baseIndices[face + 1]],
                vertices[baseIndices[face + 2]],
                to: &positions
            )
        }
        let normals = positions.map { simd_normalize($0) }
        let indices = positions.indices.map(UInt32.init)
        return try mesh(
            name: "gamexr-icosahedron-detail-1",
            positions: positions,
            normals: normals,
            indices: indices
        )
    }

    static func planetMesh(radius: Double) throws -> MeshResource {
        let widthSegments = 32
        let heightSegments = 20
        var positions: [SIMD3<Float>] = []
        var normals: [SIMD3<Float>] = []
        var indices: [UInt32] = []
        positions.reserveCapacity((widthSegments + 1) * (heightSegments + 1))
        normals.reserveCapacity(positions.capacity)

        for yIndex in 0...heightSegments {
            let theta = Double(yIndex) / Double(heightSegments) * Double.pi
            let y = radius * cos(theta)
            let ringRadius = sqrt(max(0, radius * radius - y * y))
            for xIndex in 0...widthSegments {
                let phi = Double(xIndex) / Double(widthSegments) * Double.pi * 2
                let position = SIMD3<Float>(
                    Float(-ringRadius * cos(phi)),
                    Float(y),
                    Float(ringRadius * sin(phi))
                )
                positions.append(position)
                normals.append(simd_normalize(position))
            }
        }
        for yIndex in 0..<heightSegments {
            for xIndex in 0..<widthSegments {
                let row = widthSegments + 1
                let a = UInt32(yIndex * row + xIndex + 1)
                let b = UInt32(yIndex * row + xIndex)
                let c = UInt32((yIndex + 1) * row + xIndex)
                let d = UInt32((yIndex + 1) * row + xIndex + 1)
                if yIndex != 0 { indices.append(contentsOf: [a, b, d]) }
                if yIndex != heightSegments - 1 { indices.append(contentsOf: [b, c, d]) }
            }
        }
        return try mesh(name: "gamexr-sphere-32x20", positions: positions, normals: normals, indices: indices)
    }

    private static func appendDetailOneFace(
        _ a: SIMD3<Double>,
        _ b: SIMD3<Double>,
        _ c: SIMD3<Double>,
        to positions: inout [SIMD3<Float>]
    ) {
        let midpointAB = (a + b) / 2
        let midpointAC = (a + c) / 2
        let midpointBC = (b + c) / 2
        let triangles = [
            midpointAB, midpointAC, a,
            midpointAB, midpointBC, midpointAC,
            b, midpointBC, midpointAB,
            midpointBC, c, midpointAC,
        ]
        positions.append(contentsOf: triangles.map { SIMD3<Float>(simd_normalize($0)) })
    }

    private static func quaternionXYZ(_ euler: SIMD3<Double>) -> simd_quatf {
        let x = euler.x / 2, y = euler.y / 2, z = euler.z / 2
        let c1 = cos(x), c2 = cos(y), c3 = cos(z)
        let s1 = sin(x), s2 = sin(y), s3 = sin(z)
        return simd_quatf(
            ix: Float(s1 * c2 * c3 + c1 * s2 * s3),
            iy: Float(c1 * s2 * c3 - s1 * c2 * s3),
            iz: Float(c1 * c2 * s3 + s1 * s2 * c3),
            r: Float(c1 * c2 * c3 - s1 * s2 * s3)
        )
    }

    private static func mesh(
        name: String,
        positions: [SIMD3<Float>],
        normals: [SIMD3<Float>]? = nil,
        indices: [UInt32]
    ) throws -> MeshResource {
        var descriptor = MeshDescriptor(name: name)
        descriptor.positions = MeshBuffers.Positions(positions)
        if let normals { descriptor.normals = MeshBuffers.Normals(normals) }
        descriptor.primitives = .triangles(indices)
        return try MeshResource.generate(from: [descriptor])
    }
}
#endif
