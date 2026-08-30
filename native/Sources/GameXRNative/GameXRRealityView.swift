#if canImport(RealityKit) && canImport(SwiftUI) && (os(iOS) || os(visionOS))
import Foundation
import Observation
import AgenticGraphRealityKitFlight
import AgenticGraphSpatialCore
import RealityKit
import SwiftUI
import UIKit
enum GameXRRealityPresentation: Equatable, Sendable {
    case spatial
    case immersiveSpace
}
public enum GameXRNativeProjectionState: Equatable, Sendable {
    case ready(GameXRWorldInventory)
    case failed(String)
}
@MainActor @Observable
public final class GameXRNativeCoordinator {
    public private(set) var manifest: GameXRSceneManifest
    public private(set) var isRunning = false
    public private(set) var throttle: Float = 0
    public private(set) var pitch: Float = 0
    public private(set) var roll: Float = 0
    public private(set) var yaw: Float = 0
    public private(set) var worldInventory = GameXRWorldInventory.empty
    public private(set) var worldProjectionError: String?
    public private(set) var flightTelemetryRevision = 0
    public let rootEntity = Entity()
    let presentationEntity = Entity()
    var isFlightSystemActive: Bool {
        shipEntity.components[AgenticGraphFlightControlComponent.self] != nil
    }
    var projectionState: GameXRNativeProjectionState {
        if let worldProjectionError {
            return .failed(worldProjectionError)
        }
        return .ready(worldInventory)
    }
    var flightTelemetrySummary: String {
        _ = flightTelemetryRevision
        guard let state = shipEntity.components[AgenticGraphFlightStateComponent.self]?.state else {
            return "Flight state unavailable"
        }
        return String(
            format: "Position %.3f, %.3f, %.3f; throttle %.3f",
            locale: Locale(identifier: "en_US_POSIX"),
            state.position.x,
            state.position.y,
            state.position.z,
            state.throttle
        )
    }
    public var flightStateSnapshot: FlightSimAircraftState? { shipEntity.components[AgenticGraphFlightStateComponent.self]?.state }
    public var flightControlInputSnapshot: FlightSimTickInput? { shipEntity.components[AgenticGraphFlightControlComponent.self]?.input }
    public var flightProfileSnapshot: FlightSimModelProfile? { shipEntity.components[AgenticGraphFlightConfigurationComponent.self]?.profile }
    private let shipEntity = Entity()
    private var exhaustEntities: [ModelEntity] = []
    private var wingEntities: (left: ModelEntity, right: ModelEntity)?
    private var updateSubscription: EventSubscription?
    private var animationElapsedSeconds = 0.0
    private var cameraPosition: SIMD3<Float>?
    private var cameraOrientation = simd_quatf()
    private var cameraSequence = 0
    private var cameraResetKey = 0
    private var cameraProfile = FlightSimCameraProfile.default
    private var brake: Float = 0
    private let audioEngine: GameXRNativeAudioEngine
    private let presentation: GameXRRealityPresentation
#if os(iOS)
    public convenience init(manifest: GameXRSceneManifest) {
        self.init(manifest: manifest, presentation: .spatial)
    }
#endif
    init(
        manifest: GameXRSceneManifest,
        presentation: GameXRRealityPresentation = .spatial
    ) {
        self.manifest = manifest
        self.presentation = presentation
        self.audioEngine = GameXRNativeAudioEngine(configuration: manifest.audio)
        AgenticGraphRealityKitFlightRegistration.ensureRegistered()
        presentationEntity.name = "gamexr-presentation"
        presentationEntity.addChild(rootEntity)
        do {
            try validateNativeProjection(manifest)
            try rebuildScene()
        } catch {
            worldProjectionError = error.localizedDescription
        }
    }
    public func apply(_ manifest: GameXRSceneManifest) throws {
        try manifest.validate()
        try validateNativeProjection(manifest)
        self.manifest = manifest
        try rebuildScene()
    }
    public func setControls(throttle: Float? = nil, pitch: Float? = nil, yaw: Float? = nil, roll: Float? = nil) {
        if let throttle { self.throttle = min(1, max(-1, throttle)) }
        if let pitch { self.pitch = min(1, max(-1, pitch)) }
        if let yaw { self.yaw = min(1, max(-1, yaw)) }
        if let roll { self.roll = min(1, max(-1, roll)) }
        writeControlComponent()
    }
    public func setBrake(_ value: Float) { brake = min(1, max(0, value)); writeControlComponent() }
    public func play() {
        isRunning = true
        audioEngine.start()
        synchronizeWorldAnimation()
        writeControlComponent()
    }
    public func pause() {
        isRunning = false
        audioEngine.pause()
        synchronizeWorldAnimation()
        writeControlComponent()
    }
    public func reset() {
        do {
            shipEntity.components.set(AgenticGraphFlightStateComponent(state: initialFlightState()))
            shipEntity.components.set(AgenticGraphFlightAccumulatorComponent(
                accumulator: try FlightSimFixedStepAccumulator(
                    maximumCatchUpSteps: manifest.performance.maxSimulationCatchUpSteps
                )
            ))
            animationElapsedSeconds = 0
            cameraPosition = nil
            audioEngine.reset()
            synchronizeWorldAnimation(reset: true)
            projectCanonicalState(initialFlightState())
            writeControlComponent()
            flightTelemetryRevision &+= 1
        } catch {
            failClosed(error.localizedDescription)
        }
    }
    private func rebuildScene() throws {
        for child in rootEntity.children { child.removeFromParent() }
        for child in shipEntity.children { child.removeFromParent() }
        exhaustEntities.removeAll(keepingCapacity: true)
        wingEntities = nil
        worldInventory = .empty
        worldProjectionError = nil
        audioEngine.configure(manifest.audio)
        rootEntity.name = "gamexr-scene"
        shipEntity.name = "gamexr-ship"
        buildProceduralShip()
        shipEntity.scale = .one * Float(manifest.ship.scale)
        cameraProfile = try makeCameraProfile()
        cameraResetKey &+= 1
        cameraSequence = 0
        shipEntity.components.set(AgenticGraphFlightConfigurationComponent(profile: try flightProfile()))
        shipEntity.components.set(AgenticGraphFlightStateComponent(state: initialFlightState()))
        shipEntity.components.set(AgenticGraphFlightAccumulatorComponent())
        shipEntity.components.set(InputTargetComponent())
        shipEntity.components.set(CollisionComponent(shapes: [.generateBox(size: [4.8, 1.0, 5.5])]))
        writeControlComponent()
#if os(visionOS)
        if presentation == .immersiveSpace {
            do {
                let world = try GameXRWorldEntityBuilder.build(
                    from: manifest.scene,
                    animation: manifest.animation,
                    seed: manifest.id
                )
                worldInventory = world.inventory
                rootEntity.addChild(world.entity)
            } catch {
                worldProjectionError = error.localizedDescription
                throw error
            }
        }
#endif
        rootEntity.addChild(shipEntity)
        reset()
    }
    private func buildProceduralShip() {
        let appearance = manifest.ship.appearance
        let hullMaterial = material(appearance.hullColor, appearance.metalness, appearance.roughness)
        let accentMaterial = material(appearance.accentColor, appearance.metalness, appearance.roughness)
        let canopyMaterial = material(appearance.canopyColor, 0.15, 0.12, opacity: 0.88)
        let exhaustMaterial = material(
            appearance.exhaustColor, 0, 1, opacity: 0.92, emission: 3.5, writesDepth: false
        )
        func part(_ name: String, _ mesh: MeshResource, _ material: PhysicallyBasedMaterial) -> ModelEntity {
            let entity = ModelEntity(mesh: mesh, materials: [material])
            entity.name = name
            shipEntity.addChild(entity)
            return entity
        }
        let hull = part("gamexr-hull", .generateCone(height: 4.2, radius: 0.62), hullMaterial)
        hull.orientation = simd_quatf(angle: -.pi / 2, axis: [1, 0, 0])
        let canopy = part("gamexr-canopy", .generateSphere(radius: 0.48), canopyMaterial)
        canopy.scale = [0.78, 0.42, 1.45]
        canopy.position = [0, 0.34, -0.45]
        let wingMesh = MeshResource.generateBox(size: [2.3, 0.09, 1.18])
        let leftWing = part("gamexr-left-wing", wingMesh, accentMaterial)
        let rightWing = part("gamexr-right-wing", wingMesh, accentMaterial)
        leftWing.position = [-1.22, -0.05, 0.42]
        rightWing.position = [1.22, -0.05, 0.42]
        leftWing.orientation = simd_quatf(angle: -0.12, axis: [0, 1, 0])
        rightWing.orientation = simd_quatf(angle: 0.12, axis: [0, 1, 0])
        wingEntities = (leftWing, rightWing)
        let engineMesh = MeshResource.generateBox(size: [0.38, 0.38, 1.25])
        for (name, x) in [("gamexr-left-engine", Float(-0.48)), ("gamexr-right-engine", 0.48)] {
            let engine = part(name, engineMesh, hullMaterial)
            engine.position = [x, -0.12, 1.45]
        }
        for (name, x) in [("gamexr-left-exhaust", Float(-0.48)), ("gamexr-right-exhaust", 0.48)] {
            let exhaust = part(name, .generateCone(height: 1.35, radius: 0.18), exhaustMaterial)
            exhaust.position = [x, -0.12, 2.65]
            exhaust.orientation = simd_quatf(angle: .pi / 2, axis: [1, 0, 0])
            exhaustEntities.append(exhaust)
        }
        let light = Entity()
        light.name = "gamexr-engine-light"
        light.position = [0, -0.1, 2.7]
        light.components.set(PointLightComponent(
            color: UIColor(gameXRHex: appearance.exhaustColor),
            intensity: Float(2.2 * 4 * Double.pi),
            attenuationRadius: 8,
            attenuationFalloffExponent: 2
        ))
        shipEntity.addChild(light)
    }
    private func material(
        _ color: String, _ metalness: Double, _ roughness: Double,
        opacity: Float = 1, emission: Float = 0, writesDepth: Bool = true
    ) -> PhysicallyBasedMaterial {
        let tint = UIColor(gameXRHex: color)
        var result = PhysicallyBasedMaterial()
        result.baseColor = .init(tint: tint)
        result.metallic = .init(floatLiteral: Float(metalness))
        result.roughness = .init(floatLiteral: Float(roughness))
        if opacity < 1 { result.blending = .transparent(opacity: .init(floatLiteral: opacity)) }
        if emission > 0 {
            result.emissiveColor = .init(color: tint)
            result.emissiveIntensity = emission
        }
        result.writesDepth = writesDepth
        return result
    }
    private func makeCameraProfile() throws -> FlightSimCameraProfile {
        try FlightSimCameraProfile(
            aircraftCollisionHalfSizeMeters: SpatialVector3(x: 0.1, y: 0.1, z: 0.1),
            chaseMinimumDistanceMeters: manifest.camera.chaseDistance,
            chaseTargetMinimumHeightMeters: max(0.1, manifest.camera.lookAhead),
            chaseHeightMeters: manifest.camera.chaseHeight,
            chaseFovDegrees: manifest.camera.fieldOfView,
            chaseWingHalfSpanClearance: 1
        )
    }
    func retainUpdateSubscription(_ subscription: EventSubscription) {
        updateSubscription?.cancel()
        updateSubscription = subscription
    }
    func synchronizeFrame(deltaSeconds: Double) {
        guard worldProjectionError == nil else { return }
        writeControlComponent()
        guard var component = shipEntity.components[AgenticGraphFlightStateComponent.self] else { return }
        guard component.failure == nil, component.state.isFinite else {
            failClosed("Canonical flight state failed during native projection.")
            return
        }
        var state = component.state
        audioEngine.update(throttle: Double(throttle), speed: state.velocity.length)
        let distance = state.position.length
        if distance > manifest.scene.boundsRadius, distance > .leastNonzeroMagnitude {
            let wrapped = state.position * (-(manifest.scene.boundsRadius - 1) / distance)
            state = FlightSimAircraftState(
                position: wrapped, velocity: state.velocity, pitch: state.pitch,
                roll: state.roll, yaw: state.yaw, throttle: state.throttle
            )
            component.state = state
            shipEntity.components.set(component)
        }
        projectCanonicalState(state)
        if isRunning, manifest.animation.playing {
            animationElapsedSeconds += deltaSeconds * manifest.animation.timeScale
            updateVisualAnimation()
        }
#if os(visionOS)
        if presentation == .immersiveSpace {
            do { try updateChasePresentation(state: state, deltaSeconds: deltaSeconds) }
            catch { failClosed(error.localizedDescription) }
        }
#endif
    }
    private func projectCanonicalState(_ state: FlightSimAircraftState) {
        shipEntity.position = [Float(state.position.x), Float(state.position.y), Float(state.position.z)]
        let yaw = simd_quatf(angle: Float(state.yaw), axis: [0, 1, 0])
        let pitch = simd_quatf(angle: Float(state.pitch), axis: [1, 0, 0])
        let roll = simd_quatf(angle: Float(-state.roll), axis: [0, 0, 1])
        shipEntity.orientation = simd_normalize(yaw * pitch * roll)
    }
    private func updateVisualAnimation() {
        let animation = manifest.animation
        let pulse = 1 + sin(animationElapsedSeconds * animation.exhaustPulseSpeed) * animation.exhaustPulseAmount
        let exhaustScale = Float(max(0.18, 0.35 + max(0, Double(throttle)) * 1.4) * pulse)
        for exhaust in exhaustEntities { exhaust.scale = [1, exhaustScale, 1] }
        let flex = Float(sin(animationElapsedSeconds * 2.2) * animation.wingFlexAmount * max(0.2, abs(Double(throttle))))
        wingEntities?.left.orientation = simd_quatf(angle: -0.12, axis: [0, 1, 0]) * simd_quatf(angle: flex, axis: [0, 0, 1])
        wingEntities?.right.orientation = simd_quatf(angle: 0.12, axis: [0, 1, 0]) * simd_quatf(angle: -flex, axis: [0, 0, 1])
    }
    private func synchronizeWorldAnimation(reset: Bool = false) {
#if os(visionOS)
        guard presentation == .immersiveSpace else { return }
        do {
            if reset { try GameXRWorldEntityBuilder.resetAnimation(in: rootEntity) }
            try GameXRWorldEntityBuilder.setAnimationRunning(isRunning, in: rootEntity)
        } catch {
            failClosed(error.localizedDescription)
        }
#endif
    }
#if os(visionOS)
    private func updateChasePresentation(state: FlightSimAircraftState, deltaSeconds: Double) throws {
        let target = try resolveFlightSimFollowTarget(
            snapshot: FlightSimCameraSnapshot(aircraft: state, runId: cameraResetKey, tick: cameraSequence),
            coordinateScale: 1, view: .chase, profile: cameraProfile
        )
        cameraSequence &+= 1
        let desiredPosition = SIMD3(Float(target.position.x), Float(target.position.y), Float(target.position.z))
        let lookTarget = SIMD3(Float(target.target.x), Float(target.target.y), Float(target.target.z))
        let forward = simd_normalize(lookTarget - desiredPosition)
        let right = simd_normalize(simd_cross(forward, SIMD3<Float>(0, 1, 0)))
        let up = simd_cross(right, forward)
        let desiredOrientation = simd_quatf(simd_float3x3(columns: (right, up, -forward)))
        let blend = cameraPosition == nil ? Float(1) : Float(1 - exp(-manifest.camera.damping * max(deltaSeconds, 1 / 120)))
        let blendedPosition = cameraPosition.map { $0 + (desiredPosition - $0) * blend } ?? desiredPosition
        cameraPosition = blendedPosition
        cameraOrientation = simd_slerp(cameraOrientation, desiredOrientation, blend)
        let inverse = cameraOrientation.inverse
        presentationEntity.orientation = inverse
        presentationEntity.position = SIMD3<Float>(0, 1.25, 0) - inverse.act(blendedPosition)
    }
#endif
    private func failClosed(_ message: String) {
        isRunning = false
        audioEngine.pause()
        shipEntity.components.remove(AgenticGraphFlightControlComponent.self)
        worldProjectionError = message
    }
    func dispose() { updateSubscription?.cancel(); audioEngine.dispose() }
    private func validateNativeProjection(_ manifest: GameXRSceneManifest) throws {
        guard manifest.ship.asset.kind == .procedural else {
            throw GameXRNativeProjectionError.unsupportedAssetKind(manifest.ship.asset.kind.rawValue)
        }
        guard manifest.performance.targetFramesPerSecond == 60 else {
            throw NSError(
                domain: "GameXRNative",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Native canonical flight requires a 60 FPS simulation target."]
            )
        }
#if os(visionOS)
        if presentation == .immersiveSpace, manifest.scene.environment != .deepSpace {
            throw GameXRNativeProjectionError.unsupportedEnvironment(manifest.scene.environment.rawValue)
        }
#endif
    }
    private func writeControlComponent() {
        guard isRunning else {
            shipEntity.components.remove(AgenticGraphFlightControlComponent.self)
            return
        }
        let currentThrottle = shipEntity.components[AgenticGraphFlightStateComponent.self]?.state.throttle ?? 0
        let requestedThrottle = brake > 0 ? 0 : Double(max(0, throttle))
        let control = AgenticGraphFlightControlComponent(
            input: FlightSimTickInput(
                pitch: normalizedAxis(Double(pitch)) * (manifest.motion.invertPitch ? -1 : 1),
                roll: normalizedAxis(Double(roll)),
                yaw: normalizedAxis(Double(yaw)),
                throttleDelta: requestedThrottle - currentThrottle
            )
        )
        shipEntity.components.set(control)
    }
    private func normalizedAxis(_ value: Double) -> Double {
        let scaled = min(1, max(-1, value * manifest.motion.sensitivity))
        let magnitude = abs(scaled)
        guard magnitude > manifest.motion.deadZone else { return 0 }
        return scaled.sign == .minus
            ? -(magnitude - manifest.motion.deadZone) / (1 - manifest.motion.deadZone)
            : (magnitude - manifest.motion.deadZone) / (1 - manifest.motion.deadZone)
    }
    private func initialFlightState() -> FlightSimAircraftState {
        FlightSimAircraftState(
            position: SpatialVector3(
                x: manifest.ship.position[safe: 0] ?? 0,
                y: manifest.ship.position[safe: 1] ?? 0,
                z: manifest.ship.position[safe: 2] ?? 0
            ),
            pitch: manifest.ship.rotation[safe: 0] ?? 0,
            roll: -(manifest.ship.rotation[safe: 2] ?? 0),
            yaw: manifest.ship.rotation[safe: 1] ?? 0
        )
    }
    private func flightProfile() throws -> FlightSimModelProfile {
        let flight = manifest.ship.flight
        return try FlightSimModelProfile(
            maximumRollRadians: flight.bankAngle,
            pitchRateRadiansPerSecond: flight.pitchRate,
            rollRateRadiansPerSecond: flight.rollRate,
            yawRateRadiansPerSecond: flight.yawRate,
            thrustAcceleration: flight.acceleration,
            baseDrag: flight.drag,
            velocityAlignmentRate: min(1, flight.lateralAssist / 30),
            maximumAirspeedMetersPerSecond: flight.maxForwardSpeed,
            stallSpeedMetersPerSecond: min(7, max(.leastNonzeroMagnitude, flight.maxForwardSpeed / 2)),
            fullControlSpeedMetersPerSecond: min(12, flight.maxForwardSpeed),
            stableRollRadians: min(0.35, flight.bankAngle)
        )
    }
}
#if os(iOS)
public struct GameXRRealityView: View {
    private let manifest: GameXRSceneManifest
    public init(manifest: GameXRSceneManifest) {
        self.manifest = manifest
    }
    public var body: some View {
        GameXRRealityContentView(manifest: manifest, presentation: .spatial)
    }
}
#endif
#if os(visionOS)
public struct GameXRImmersiveSceneView: View {
    private let manifest: GameXRSceneManifest
    private let onProjectionStateChange: @MainActor (GameXRNativeProjectionState) -> Void
    public init(
        manifest: GameXRSceneManifest,
        onProjectionStateChange: @escaping @MainActor (GameXRNativeProjectionState) -> Void = { _ in }
    ) {
        self.manifest = manifest
        self.onProjectionStateChange = onProjectionStateChange
    }
    public var body: some View {
        GameXRRealityContentView(
            manifest: manifest,
            presentation: .immersiveSpace,
            onProjectionStateChange: onProjectionStateChange
        )
    }
}
#endif
private struct GameXRRealityContentView: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var coordinator: GameXRNativeCoordinator
    @State private var motionController: GameXRDeviceMotionController
    private let presentation: GameXRRealityPresentation
    private let onProjectionStateChange: @MainActor (GameXRNativeProjectionState) -> Void
    init(
        manifest: GameXRSceneManifest,
        presentation: GameXRRealityPresentation,
        onProjectionStateChange: @escaping @MainActor (GameXRNativeProjectionState) -> Void = { _ in }
    ) {
        self.presentation = presentation
        self.onProjectionStateChange = onProjectionStateChange
        _coordinator = State(initialValue: GameXRNativeCoordinator(
            manifest: manifest,
            presentation: presentation
        ))
        _motionController = State(initialValue: GameXRDeviceMotionController(
            profile: manifest.motion.deviceOrientation
        ))
    }
    var body: some View {
        Group {
            if let worldProjectionError = coordinator.worldProjectionError {
                ContentUnavailableView(
                    "GameXR projection failed",
                    systemImage: "exclamationmark.triangle",
                    description: Text(worldProjectionError)
                )
                .accessibilityIdentifier("gamexr-native-world-projection-error")
            } else {
                ZStack(alignment: .bottom) {
                    interactiveRealityView
                    controls
                }
            }
        }
        .onAppear {
            onProjectionStateChange(coordinator.projectionState)
        }
        .onChange(of: coordinator.worldProjectionError) { _, _ in
            onProjectionStateChange(coordinator.projectionState)
        }
        .onChange(of: motionController.axes) { _, axes in
            guard motionController.phase == .running,
                  coordinator.manifest.motion.deviceMotionEnabled else { return }
            coordinator.setControls(
                pitch: Float(axes.pitch),
                roll: Float(axes.roll)
            )
        }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active {
                motionController.stop(message: "Device motion stopped because the scene is inactive.")
                coordinator.setControls(pitch: 0, roll: 0)
            }
        }
        .onDisappear {
            motionController.stop(message: "Device motion stopped because the RealityView closed.")
            coordinator.dispose()
        }
    }
    private var controls: some View {
        VStack(spacing: 12) {
#if os(visionOS)
            if presentation == .immersiveSpace {
                Text(coordinator.worldInventory.summary)
                    .font(.caption)
                    .accessibilityIdentifier("gamexr-native-world-inventory")
            }
#endif
            TimelineView(.animation(minimumInterval: 0.1, paused: !coordinator.isRunning)) { _ in
                Text(coordinator.flightTelemetrySummary)
                    .font(.caption.monospacedDigit())
                    .accessibilityIdentifier("gamexr-native-flight-telemetry")
            }
            Slider(
                value: Binding(
                    get: { coordinator.throttle },
                    set: { coordinator.setControls(throttle: $0) }
                ),
                in: -1...1
            )
            .accessibilityIdentifier("gamexr-native-throttle")
            Button("Full Throttle") {
                coordinator.setControls(throttle: 1)
            }
            .accessibilityIdentifier("gamexr-native-full-throttle")
            HStack {
                Button(coordinator.isRunning ? "Pause" : "Fly") {
                    coordinator.isRunning ? coordinator.pause() : coordinator.play()
                }
                .accessibilityIdentifier("gamexr-native-flight-toggle")
                Button("Brake") {}
                    .onLongPressGesture(
                        minimumDuration: .infinity, perform: {},
                        onPressingChanged: { coordinator.setBrake($0 ? 1 : 0) }
                    )
                    .accessibilityIdentifier("gamexr-native-brake")
                Button("Reset") { coordinator.reset() }
            }
            if coordinator.manifest.motion.deviceMotionEnabled {
                HStack {
                    Button(motionController.phase == .running || motionController.phase == .calibrating
                        ? "Disable Motion"
                        : "Enable Motion") {
                        toggleDeviceMotion()
                    }
                    if motionController.phase == .running {
                        Button("Recenter") { motionController.recenter() }
                    }
                }
                Text(motionController.message)
                    .font(.caption)
                    .multilineTextAlignment(.center)
            }
        }
        .padding()
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18))
        .padding()
    }
    private var interactiveRealityView: some View {
        RealityView { content in
            content.add(coordinator.presentationEntity)
            coordinator.retainUpdateSubscription(content.subscribe(to: SceneEvents.Update.self) { [weak coordinator = coordinator] event in
                coordinator?.synchronizeFrame(deltaSeconds: event.deltaTime)
            })
        }
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { value in
                    coordinator.setControls(
                        pitch: Float(-value.translation.height / 160),
                        yaw: Float(value.translation.width / 220),
                        roll: Float(value.translation.width / 160)
                    )
                }
                .onEnded { _ in coordinator.setControls(pitch: 0, yaw: 0, roll: 0) }
        )
    }
    private func toggleDeviceMotion() {
        if motionController.phase == .running || motionController.phase == .calibrating {
            motionController.stop()
            coordinator.setControls(pitch: 0, roll: 0)
        } else {
            motionController.configure(profile: coordinator.manifest.motion.deviceOrientation)
            motionController.start()
        }
    }
}
private extension Array {
    subscript(safe index: Index) -> Element? { indices.contains(index) ? self[index] : nil }
}
#endif
