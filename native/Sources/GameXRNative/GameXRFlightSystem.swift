#if canImport(RealityKit) && (os(iOS) || os(visionOS))
import RealityKit
import simd

public struct GameXRFlightControlComponent: Component, Codable {
    public var throttle: Float
    public var pitch: Float
    public var yaw: Float
    public var roll: Float
    public var brake: Float

    public init(throttle: Float = 0, pitch: Float = 0, yaw: Float = 0, roll: Float = 0, brake: Float = 0) {
        self.throttle = throttle
        self.pitch = pitch
        self.yaw = yaw
        self.roll = roll
        self.brake = brake
    }
}

public struct GameXRFlightConfigurationComponent: Component, Codable {
    public var acceleration: Float
    public var braking: Float
    public var drag: Float
    public var maxForwardSpeed: Float
    public var maxReverseSpeed: Float
    public var pitchRate: Float
    public var yawRate: Float
    public var rollRate: Float

    public init(_ configuration: FlightConfiguration) {
        acceleration = Float(configuration.acceleration)
        braking = Float(configuration.braking)
        drag = Float(configuration.drag)
        maxForwardSpeed = Float(configuration.maxForwardSpeed)
        maxReverseSpeed = Float(configuration.maxReverseSpeed)
        pitchRate = Float(configuration.pitchRate)
        yawRate = Float(configuration.yawRate)
        rollRate = Float(configuration.rollRate)
    }
}

public struct GameXRFlightStateComponent: Component, Codable {
    public var speed: Float = 0
    public init() {}
}

public struct GameXRFlightSystem: System {
    private static let query = EntityQuery(
        where: .has(GameXRFlightControlComponent.self)
            && .has(GameXRFlightConfigurationComponent.self)
            && .has(GameXRFlightStateComponent.self)
    )

    public init(scene: RealityKit.Scene) {}

    public func update(context: SceneUpdateContext) {
        let delta = Float(min(context.deltaTime, 0.1))
        for entity in context.entities(matching: Self.query, updatingSystemWhen: .rendering) {
            guard let control = entity.components[GameXRFlightControlComponent.self],
                  let configuration = entity.components[GameXRFlightConfigurationComponent.self],
                  var state = entity.components[GameXRFlightStateComponent.self] else { continue }

            let pitch = simd_quatf(angle: control.pitch * configuration.pitchRate * delta, axis: [1, 0, 0])
            let yaw = simd_quatf(angle: control.yaw * configuration.yawRate * delta, axis: [0, 1, 0])
            let roll = simd_quatf(angle: -control.roll * configuration.rollRate * delta, axis: [0, 0, 1])
            entity.transform.rotation = simd_normalize(entity.transform.rotation * yaw * pitch * roll)

            let acceleration = control.throttle >= 0 ? configuration.acceleration : configuration.braking
            state.speed += control.throttle * acceleration * delta
            state.speed *= exp(-configuration.drag * delta)
            state.speed *= exp(-configuration.braking * max(0, control.brake) * delta)
            state.speed = min(configuration.maxForwardSpeed, max(-configuration.maxReverseSpeed, state.speed))
            let forward = entity.transform.rotation.act([0, 0, -1] as SIMD3<Float>)
            entity.position += forward * state.speed * delta
            entity.components.set(state)
        }
    }
}

@MainActor
enum GameXRNativeRegistration {
    static let once: Void = {
        GameXRFlightControlComponent.registerComponent()
        GameXRFlightConfigurationComponent.registerComponent()
        GameXRFlightStateComponent.registerComponent()
        GameXRFlightSystem.registerSystem()
    }()

    static func ensure() { _ = once }
}
#endif
