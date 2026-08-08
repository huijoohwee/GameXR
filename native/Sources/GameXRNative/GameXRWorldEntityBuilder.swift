#if canImport(RealityKit) && canImport(UIKit) && (os(iOS) || os(visionOS))
import RealityKit
import UIKit

public struct GameXRWorldInventory: Equatable, Sendable {
    public let environment: SceneConfiguration.Environment
    public let starCount: Int
    public let asteroidCount: Int
    public let hasPlanet: Bool
    public let placementDigest: UInt64

    public var summary: String {
        let planet = hasPlanet ? "planet enabled" : "planet disabled"
        return "\(starCount) stars, \(asteroidCount) asteroids, \(planet)"
    }

    static let empty = GameXRWorldInventory(
        environment: .deepSpace,
        starCount: 0,
        asteroidCount: 0,
        hasPlanet: false,
        placementDigest: 0
    )
}

enum GameXRNativeProjectionError: LocalizedError {
    case invalidColor(String)
    case invalidDirectionalLightPosition
    case missingProjectedEntity(String)
    case unavailableAmbientImage
    case unsupportedAssetKind(String)
    case unsupportedEnvironment(String)

    var errorDescription: String? {
        switch self {
        case let .invalidColor(color):
            "Native world projection rejected the invalid color \(color)."
        case .invalidDirectionalLightPosition:
            "Native world projection requires a nonzero key-light position when its intensity is nonzero."
        case let .missingProjectedEntity(name):
            "Native world projection did not materialize the required \(name) entity."
        case .unavailableAmbientImage:
            "Native world projection could not construct the source-owned ambient-light environment."
        case let .unsupportedAssetKind(kind):
            "Native ship projection does not support the \(kind) asset kind."
        case let .unsupportedEnvironment(environment):
            "Native full-scene projection does not support the \(environment) environment."
        }
    }
}

#if os(visionOS)
struct GameXRFogMetadataComponent: Component, Codable, Equatable, Sendable {
    let color: String
    let density: Float
}

struct GameXRAmbientLightMetadataComponent: Component, Codable, Equatable, Sendable {
    let color: String
    let intensity: Float
}

struct GameXRRotationMetadataComponent: Component, Codable, Equatable, Sendable {
    let axis: SIMD3<Float>
    let manifestPlaying: Bool
    let radiansPerSecond: Float
    let timeScale: Float
    var runtimeRunning: Bool
}

struct GameXRSourcePrimitiveMetadataComponent: Component, Codable, Equatable, Sendable {
    enum Primitive: String, Codable, Sendable { case points, icosahedronDetailOne, sphere32x20 }

    let primitive: Primitive
    let instanceCount: Int
    let pointSize: Float?
}

struct GameXRWorldRotationSystem: System {
    private static let query = EntityQuery(where: .has(GameXRRotationMetadataComponent.self))

    @MainActor init(scene: RealityKit.Scene) {}

    @MainActor mutating func update(context: SceneUpdateContext) {
        for entity in context.entities(matching: Self.query, updatingSystemWhen: .rendering) {
            guard let rotation = entity.components[GameXRRotationMetadataComponent.self],
                  rotation.runtimeRunning,
                  rotation.manifestPlaying else { continue }
            let angle = rotation.radiansPerSecond * rotation.timeScale * Float(context.deltaTime)
            guard angle.isFinite, angle != 0 else { continue }
            let delta = simd_quatf(angle: angle, axis: simd_normalize(rotation.axis))
            entity.orientation = simd_normalize(entity.orientation * delta)
        }
    }
}

@MainActor
enum GameXRWorldEntityBuilder {
    // Three.js intensity is unitless; this maps the default 4.2 key to RealityKit's default lux.
    private static let browserDirectionalIntensityToLux: Float = 2_145.7078 / 4.2
    private static let componentRegistration: Void = {
        GameXRFogMetadataComponent.registerComponent()
        GameXRAmbientLightMetadataComponent.registerComponent()
        GameXRRotationMetadataComponent.registerComponent()
        GameXRSourcePrimitiveMetadataComponent.registerComponent()
        GameXRWorldRotationSystem.registerSystem()
    }()

    struct Result {
        let entity: Entity
        let inventory: GameXRWorldInventory
    }

    static func build(
        from scene: SceneConfiguration,
        animation: AnimationConfiguration,
        seed: String
    ) throws -> Result {
        guard scene.environment == .deepSpace else {
            throw GameXRNativeProjectionError.unsupportedEnvironment(scene.environment.rawValue)
        }
        _ = componentRegistration
        let world = Entity()
        world.name = "gamexr-world"
        world.components.set(GameXRFogMetadataComponent(
            color: scene.fogColor,
            density: Float(scene.fogDensity)
        ))

        let background = try backgroundEntity(scene: scene)
        world.addChild(background)

        var random = GameXRBrowserSeededRandom(seed: seed)
        var placementHasher = GameXRPlacementHasher()
        let starCenters = GameXRBrowserWorldProjection.starCenters(
            count: scene.starCount,
            asteroidFieldRadius: scene.asteroidFieldRadius,
            boundsRadius: scene.boundsRadius,
            random: &random
        )
        let stars = try starField(centers: starCenters)
        world.addChild(stars)
        placementHasher.combine(tag: 2)
        placementHasher.combine(scene.starCount)
        starCenters.forEach { placementHasher.combine($0) }

        let asteroidLayouts = GameXRBrowserWorldProjection.asteroidLayouts(
            count: scene.asteroidCount,
            fieldRadius: scene.asteroidFieldRadius,
            random: &random
        )
        let ambientLight = try ambientLightEntity(intensity: Float(scene.lighting.ambientIntensity))
        world.addChild(ambientLight)
        let asteroids = try asteroidField(
            layouts: asteroidLayouts,
            animation: animation,
            ambientLight: ambientLight
        )
        world.addChild(asteroids)
        placementHasher.combine(tag: 3)
        placementHasher.combine(scene.asteroidCount)
        for index in asteroidLayouts.indices {
            let name = "gamexr-asteroid-\(index)"
            guard let asteroid = asteroids.findEntity(named: name) else {
                throw GameXRNativeProjectionError.missingProjectedEntity(name)
            }
            placementHasher.combine(asteroid.position)
            let orientation = asteroid.orientation
            placementHasher.combine(orientation.real < 0 ? -orientation.vector : orientation.vector)
            placementHasher.combine(asteroid.scale)
        }

        if scene.planet.enabled {
            let planet = try planetEntity(scene: scene, animation: animation, ambientLight: ambientLight)
            world.addChild(planet)
            placementHasher.combine(tag: 4)
            placementHasher.combine(planet.position)
            placementHasher.combine(Float(scene.planet.radius))
        }

        let keyLight = try keyLightEntity(scene: scene, relativeTo: world)
        world.addChild(keyLight)
        placementHasher.combine(tag: 5)
        placementHasher.combine(keyLight.position)

        return Result(
            entity: world,
            inventory: GameXRWorldInventory(
                environment: scene.environment,
                starCount: scene.starCount,
                asteroidCount: scene.asteroidCount,
                hasPlanet: scene.planet.enabled,
                placementDigest: placementHasher.state
            )
        )
    }

    static func setAnimationRunning(_ isRunning: Bool, in world: Entity) throws {
        for name in ["gamexr-planet", "gamexr-asteroid-field"] {
            guard let entity = world.findEntity(named: name),
                  var rotation = entity.components[GameXRRotationMetadataComponent.self] else {
                if name == "gamexr-planet", world.findEntity(named: name) == nil { continue }
                throw GameXRNativeProjectionError.missingProjectedEntity(name)
            }
            rotation.runtimeRunning = isRunning
            entity.components.set(rotation)
        }
    }

    static func resetAnimation(in world: Entity) throws {
        for name in ["gamexr-planet", "gamexr-asteroid-field"] {
            guard let entity = world.findEntity(named: name) else {
                if name == "gamexr-planet" { continue }
                throw GameXRNativeProjectionError.missingProjectedEntity(name)
            }
            entity.orientation = simd_quatf()
        }
    }

    private static func backgroundEntity(scene: SceneConfiguration) throws -> ModelEntity {
        var material = UnlitMaterial(color: try color(scene.backgroundColor), applyPostProcessToneMap: true)
        material.faceCulling = .front
        let entity = ModelEntity(
            mesh: .generateSphere(radius: Float(scene.boundsRadius)),
            materials: [material]
        )
        entity.name = "gamexr-background"
        return entity
    }

    private static func starField(centers: [SIMD3<Float>]) throws -> Entity {
        guard !centers.isEmpty else {
            let entity = Entity()
            entity.name = "gamexr-stars"
            return entity
        }
        let entity = ModelEntity(
            mesh: try GameXRBrowserWorldProjection.starProxyMesh(centers: centers),
            materials: [UnlitMaterial(
                color: try color(GameXRBrowserWorldProjection.starColor),
                applyPostProcessToneMap: true
            )]
        )
        entity.name = "gamexr-stars"
        entity.components.set(GameXRSourcePrimitiveMetadataComponent(
            primitive: .points,
            instanceCount: centers.count,
            pointSize: GameXRBrowserWorldProjection.starPointSize
        ))
        return entity
    }

    private static func asteroidField(
        layouts: [GameXRBrowserAsteroidLayout],
        animation: AnimationConfiguration,
        ambientLight: Entity
    ) throws -> Entity {
        let wrapper = Entity()
        wrapper.name = "gamexr-asteroids"
        let field = Entity()
        field.name = "gamexr-asteroid-field"
        field.components.set(GameXRSourcePrimitiveMetadataComponent(
            primitive: .icosahedronDetailOne,
            instanceCount: layouts.count,
            pointSize: nil
        ))
        field.components.set(rotationComponent(
            radiansPerSecond: Float(animation.asteroidDriftSpeed) * 0.05,
            animation: animation
        ))
        wrapper.addChild(field)
        guard !layouts.isEmpty else { return wrapper }

        let mesh = try GameXRBrowserWorldProjection.asteroidMesh()
        var material = PhysicallyBasedMaterial()
        material.baseColor = .init(tint: try color(GameXRBrowserWorldProjection.asteroidColor))
        material.roughness = .init(floatLiteral: GameXRBrowserWorldProjection.asteroidRoughness)
        material.metallic = .init(floatLiteral: GameXRBrowserWorldProjection.asteroidMetalness)
        for (index, layout) in layouts.enumerated() {
            let asteroid = ModelEntity(mesh: mesh, materials: [material])
            asteroid.name = "gamexr-asteroid-\(index)"
            asteroid.position = layout.position
            asteroid.orientation = layout.orientation
            asteroid.scale = layout.scale
            asteroid.components.set(ImageBasedLightReceiverComponent(imageBasedLight: ambientLight))
            field.addChild(asteroid)
        }
        return wrapper
    }

    private static func planetEntity(
        scene: SceneConfiguration,
        animation: AnimationConfiguration,
        ambientLight: Entity
    ) throws -> ModelEntity {
        var material = PhysicallyBasedMaterial()
        material.baseColor = .init(tint: try color(scene.planet.baseColor))
        material.emissiveColor = .init(color: try color(scene.planet.emissiveColor))
        material.emissiveIntensity = GameXRBrowserWorldProjection.planetEmissiveIntensity
        material.roughness = .init(floatLiteral: GameXRBrowserWorldProjection.planetRoughness)
        material.metallic = .init(floatLiteral: 0)
        let entity = ModelEntity(
            mesh: try GameXRBrowserWorldProjection.planetMesh(radius: scene.planet.radius),
            materials: [material]
        )
        entity.name = "gamexr-planet"
        entity.position = vector(scene.planet.position)
        entity.components.set(ImageBasedLightReceiverComponent(imageBasedLight: ambientLight))
        entity.components.set(rotationComponent(
            radiansPerSecond: Float(scene.planet.rotationSpeed),
            animation: animation
        ))
        entity.components.set(GameXRSourcePrimitiveMetadataComponent(
            primitive: .sphere32x20,
            instanceCount: 1,
            pointSize: nil
        ))
        return entity
    }

    private static func rotationComponent(
        radiansPerSecond: Float,
        animation: AnimationConfiguration
    ) -> GameXRRotationMetadataComponent {
        GameXRRotationMetadataComponent(
            axis: [0, 1, 0],
            manifestPlaying: animation.playing,
            radiansPerSecond: radiansPerSecond,
            timeScale: Float(animation.timeScale),
            runtimeRunning: false
        )
    }

    private static func ambientLightEntity(intensity: Float) throws -> Entity {
        let entity = Entity()
        entity.name = "gamexr-ambient-light"
        entity.components.set(GameXRAmbientLightMetadataComponent(
            color: GameXRBrowserWorldProjection.ambientColor,
            intensity: intensity
        ))
        guard intensity > 0 else {
            entity.components.set(ImageBasedLightComponent(source: .none))
            return entity
        }
        let image = try solidColorImage(try color(GameXRBrowserWorldProjection.ambientColor))
        let environment = try EnvironmentResource(equirectangular: image, withName: "gamexr-ambient-light")
        entity.components.set(ImageBasedLightComponent(
            source: .single(environment),
            intensityExponent: log2(intensity)
        ))
        return entity
    }

    private static func keyLightEntity(scene: SceneConfiguration, relativeTo world: Entity) throws -> Entity {
        let position = vector(scene.lighting.keyPosition)
        let intensity = Float(scene.lighting.keyIntensity)
        guard intensity == 0 || simd_length_squared(position) > .ulpOfOne else {
            throw GameXRNativeProjectionError.invalidDirectionalLightPosition
        }
        let entity = Entity()
        entity.name = "gamexr-key-light"
        entity.position = position
        if intensity > 0 { entity.look(at: .zero, from: position, relativeTo: world) }
        entity.components.set(DirectionalLightComponent(
            color: try color(scene.lighting.keyColor),
            intensity: intensity * browserDirectionalIntensityToLux
        ))
        return entity
    }

    private static func solidColorImage(_ color: UIColor) throws -> CGImage {
        let width = 64
        let height = 32
        guard let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
              let context = CGContext(
                data: nil,
                width: width,
                height: height,
                bitsPerComponent: 8,
                bytesPerRow: width * 4,
                space: colorSpace,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
              ) else {
            throw GameXRNativeProjectionError.unavailableAmbientImage
        }
        context.setFillColor(color.cgColor)
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        guard let image = context.makeImage() else {
            throw GameXRNativeProjectionError.unavailableAmbientImage
        }
        return image
    }

    private static func color(_ hex: String) throws -> UIColor {
        guard hex.count == 7, hex.first == "#", let value = UInt64(hex.dropFirst(), radix: 16) else {
            throw GameXRNativeProjectionError.invalidColor(hex)
        }
        return UIColor(
            red: CGFloat((value >> 16) & 0xff) / 255,
            green: CGFloat((value >> 8) & 0xff) / 255,
            blue: CGFloat(value & 0xff) / 255,
            alpha: 1
        )
    }

    private static func vector(_ values: [Double]) -> SIMD3<Float> {
        [Float(values[0]), Float(values[1]), Float(values[2])]
    }
}

private struct GameXRPlacementHasher {
    private static let offsetBasis: UInt64 = 14_695_981_039_346_656_037
    private static let prime: UInt64 = 1_099_511_628_211
    private static let quantizationScale = 10_000.0
    private(set) var state = Self.offsetBasis

    mutating func combine(tag: UInt64) { combine(tag) }
    mutating func combine(_ value: Int) { combine(UInt64(bitPattern: Int64(value))) }
    mutating func combine(_ value: Float) {
        let quantized = Int64((Double(value) * Self.quantizationScale).rounded())
        combine(UInt64(bitPattern: quantized))
    }
    mutating func combine(_ value: SIMD3<Float>) {
        combine(value.x); combine(value.y); combine(value.z)
    }
    mutating func combine(_ value: SIMD4<Float>) {
        combine(value.x); combine(value.y); combine(value.z); combine(value.w)
    }
    private mutating func combine(_ value: UInt64) {
        var littleEndian = value.littleEndian
        withUnsafeBytes(of: &littleEndian) { bytes in
            for byte in bytes { state = (state ^ UInt64(byte)) &* Self.prime }
        }
    }
}
#endif

extension UIColor {
    convenience init(gameXRHex: String) {
        let cleaned = gameXRHex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        let value = UInt64(cleaned, radix: 16) ?? 0
        self.init(
            red: CGFloat((value >> 16) & 0xff) / 255,
            green: CGFloat((value >> 8) & 0xff) / 255,
            blue: CGFloat(value & 0xff) / 255,
            alpha: 1
        )
    }
}
#endif
