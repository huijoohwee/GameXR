#if canImport(RealityKit) && canImport(SwiftUI) && (os(iOS) || os(visionOS))
import Observation
import KnowgrphRealityKitFlight
import KnowgrphSpatialCore
import RealityKit
import SwiftUI
import UIKit

enum GameXRRealityPresentation: Equatable, Sendable {
    case spatial
    case planarWindow

    static let planarWindowMetersPerSceneUnit: Float = 0.05
    static let planarWindowPreviewPitchRadians: Float = 0.35
}

@MainActor @Observable
public final class GameXRNativeCoordinator {
    public private(set) var manifest: GameXRSceneManifest
    public private(set) var isRunning = false
    public private(set) var throttle: Float = 0
    public private(set) var pitch: Float = 0
    public private(set) var roll: Float = 0
    public private(set) var yaw: Float = 0
    public let rootEntity = Entity()
    let presentationEntity = Entity()

    var isFlightSystemActive: Bool {
        shipEntity.components[KnowgrphFlightControlComponent.self] != nil
    }

    private let shipEntity = Entity()
    private var exhaustEntities: [ModelEntity] = []
    private let presentation: GameXRRealityPresentation

    public convenience init(manifest: GameXRSceneManifest) {
        self.init(manifest: manifest, presentation: .spatial)
    }

    init(
        manifest: GameXRSceneManifest,
        presentation: GameXRRealityPresentation = .spatial
    ) {
        self.manifest = manifest
        self.presentation = presentation
        KnowgrphRealityKitFlightRegistration.ensureRegistered()
        presentationEntity.name = "gamexr-presentation"
        presentationEntity.addChild(rootEntity)
#if os(visionOS)
        if presentation == .planarWindow {
            presentationEntity.scale = .one * GameXRRealityPresentation.planarWindowMetersPerSceneUnit
            presentationEntity.orientation = simd_quatf(
                angle: GameXRRealityPresentation.planarWindowPreviewPitchRadians,
                axis: [1, 0, 0]
            )
        }
#endif
        rebuildScene()
    }

    public func apply(_ manifest: GameXRSceneManifest) throws {
        try manifest.validate()
        self.manifest = manifest
        rebuildScene()
    }

    public func setControls(throttle: Float? = nil, pitch: Float? = nil, yaw: Float? = nil, roll: Float? = nil) {
        if let throttle { self.throttle = min(1, max(-1, throttle)) }
        if let pitch { self.pitch = min(1, max(-1, pitch)) }
        if let yaw { self.yaw = min(1, max(-1, yaw)) }
        if let roll { self.roll = min(1, max(-1, roll)) }
        writeControlComponent()
    }

    public func play() {
        isRunning = true
        writeControlComponent()
    }

    public func pause() {
        isRunning = false
        throttle = 0
        pitch = 0
        yaw = 0
        roll = 0
        writeControlComponent()
    }

    public func reset() {
        setControls(throttle: 0, pitch: 0, yaw: 0, roll: 0)
        shipEntity.position = vector(manifest.ship.position)
        let rollRotation = simd_quatf(angle: Float(manifest.ship.rotation[safe: 2] ?? 0), axis: [0, 0, 1])
        let pitchRotation = simd_quatf(angle: Float(manifest.ship.rotation[safe: 0] ?? 0), axis: [1, 0, 0])
        let yawRotation = simd_quatf(angle: Float(manifest.ship.rotation[safe: 1] ?? 0), axis: [0, 1, 0])
        shipEntity.orientation = yawRotation * pitchRotation * rollRotation
        shipEntity.components.set(KnowgrphFlightStateComponent(state: initialFlightState()))
        shipEntity.components.set(KnowgrphFlightAccumulatorComponent())
    }

    private func rebuildScene() {
        for child in rootEntity.children { child.removeFromParent() }
        for child in shipEntity.children { child.removeFromParent() }
        exhaustEntities.removeAll(keepingCapacity: true)
        rootEntity.name = "gamexr-scene"
        shipEntity.name = "gamexr-ship"

        let hullMaterials: [any RealityKit.Material]
        let accentMaterials: [any RealityKit.Material]
        if presentation == .planarWindow {
            // Window lighting is outside this bounded adapter. Preserve manifest
            // colors without inventing a Three.js-to-RealityKit lux conversion.
            hullMaterials = [UnlitMaterial(color: UIColor(hex: manifest.ship.appearance.hullColor))]
            accentMaterials = [UnlitMaterial(color: UIColor(hex: manifest.ship.appearance.accentColor))]
        } else {
            hullMaterials = [SimpleMaterial(
                color: UIColor(hex: manifest.ship.appearance.hullColor),
                roughness: .float(Float(manifest.ship.appearance.roughness)),
                isMetallic: manifest.ship.appearance.metalness >= 0.5
            )]
            accentMaterials = [SimpleMaterial(
                color: UIColor(hex: manifest.ship.appearance.accentColor),
                roughness: .float(0.3),
                isMetallic: true
            )]
        }
        let hull = ModelEntity(mesh: .generateBox(size: [0.8, 0.32, 2.8]), materials: hullMaterials)
        let leftWing = ModelEntity(mesh: .generateBox(size: [2.0, 0.08, 0.9]), materials: accentMaterials)
        leftWing.position = [-1.05, -0.08, 0.25]
        let rightWing = ModelEntity(mesh: .generateBox(size: [2.0, 0.08, 0.9]), materials: accentMaterials)
        rightWing.position = [1.05, -0.08, 0.25]
        configurePlanarSort(for: hull)
        configurePlanarSort(for: leftWing)
        configurePlanarSort(for: rightWing)
        shipEntity.addChild(hull)
        shipEntity.addChild(leftWing)
        shipEntity.addChild(rightWing)

        let exhaustMaterial = UnlitMaterial(color: UIColor(hex: manifest.ship.appearance.exhaustColor))
        for x: Float in [-0.34, 0.34] {
            let exhaust = ModelEntity(mesh: .generateBox(size: [0.12, 0.12, 0.8]), materials: [exhaustMaterial])
            exhaust.position = [x, -0.08, 1.75]
            configurePlanarSort(for: exhaust)
            shipEntity.addChild(exhaust)
            exhaustEntities.append(exhaust)
        }

        shipEntity.scale = .one * Float(manifest.ship.scale)
        shipEntity.components.set(KnowgrphFlightConfigurationComponent(profile: flightProfile()))
        shipEntity.components.set(KnowgrphFlightStateComponent(state: initialFlightState()))
        shipEntity.components.set(KnowgrphFlightAccumulatorComponent())
        shipEntity.components.set(InputTargetComponent())
        shipEntity.components.set(CollisionComponent(shapes: [.generateBox(size: [2.6, 0.5, 3.2])]))
        writeControlComponent()
        rootEntity.addChild(shipEntity)
        reset()
    }

    private func configurePlanarSort(for entity: ModelEntity) {
#if os(visionOS)
        guard presentation == .planarWindow else { return }
        entity.components.set(ModelSortGroupComponent(group: .planarUIInline, order: 0))
#endif
    }

    private func writeControlComponent() {
        guard isRunning else {
            shipEntity.components.remove(KnowgrphFlightControlComponent.self)
            for exhaust in exhaustEntities { exhaust.scale.z = 0.35 }
            return
        }

        let control = KnowgrphFlightControlComponent(
            input: FlightSimTickInput(
                pitch: Double(pitch),
                roll: Double(roll),
                yaw: Double(yaw),
                throttleDelta: Double(throttle)
            )
        )
        shipEntity.components.set(control)
        let effectiveThrottle = Float(control.input.throttleDelta)
        let exhaustScale = max(0.2, 0.35 + max(0, effectiveThrottle) * 1.5)
        for exhaust in exhaustEntities { exhaust.scale.z = exhaustScale }
    }

    private func vector(_ values: [Double]) -> SIMD3<Float> {
        [Float(values[safe: 0] ?? 0), Float(values[safe: 1] ?? 0), Float(values[safe: 2] ?? 0)]
    }

    private func initialFlightState() -> FlightSimAircraftState {
        FlightSimAircraftState(
            position: SpatialVector3(
                x: manifest.ship.position[safe: 0] ?? 0,
                y: manifest.ship.position[safe: 1] ?? 0,
                z: manifest.ship.position[safe: 2] ?? 0
            ),
            pitch: manifest.ship.rotation[safe: 0] ?? 0,
            roll: manifest.ship.rotation[safe: 2] ?? 0,
            yaw: manifest.ship.rotation[safe: 1] ?? 0
        )
    }

    private func flightProfile() -> FlightSimModelProfile {
        let flight = manifest.ship.flight
        return (try? FlightSimModelProfile(
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
        )) ?? .default
    }
}

public struct GameXRRealityView: View {
    private let manifest: GameXRSceneManifest

    public init(manifest: GameXRSceneManifest) {
        self.manifest = manifest
    }

    public var body: some View {
        GameXRRealityContentView(manifest: manifest, presentation: .spatial)
    }
}

#if os(visionOS)
public struct GameXRPlanarWindowView: View {
    private let manifest: GameXRSceneManifest

    public init(manifest: GameXRSceneManifest) {
        self.manifest = manifest
    }

    public var body: some View {
        GameXRRealityContentView(manifest: manifest, presentation: .planarWindow)
    }
}
#endif

private struct GameXRRealityContentView: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var coordinator: GameXRNativeCoordinator
    @State private var motionController: GameXRDeviceMotionController
    private let presentation: GameXRRealityPresentation

    init(
        manifest: GameXRSceneManifest,
        presentation: GameXRRealityPresentation = .spatial
    ) {
        self.presentation = presentation
        _coordinator = State(initialValue: GameXRNativeCoordinator(
            manifest: manifest,
            presentation: presentation
        ))
        _motionController = State(initialValue: GameXRDeviceMotionController(
            profile: manifest.motion.deviceOrientation
        ))
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            presentedRealityView

            VStack(spacing: 12) {
                Slider(
                    value: Binding(
                        get: { coordinator.throttle },
                        set: { coordinator.setControls(throttle: $0) }
                    ),
                    in: -1...1
                )
                HStack {
                    Button(coordinator.isRunning ? "Pause" : "Fly") {
                        coordinator.isRunning ? coordinator.pause() : coordinator.play()
                    }
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
        .onChange(of: motionController.axes) { _, axes in
            guard motionController.phase == .running,
                  coordinator.manifest.motion.deviceMotionEnabled else { return }
            let pitchDirection: Float = coordinator.manifest.motion.invertPitch ? -1 : 1
            coordinator.setControls(
                pitch: Float(axes.pitch) * pitchDirection,
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
        }
    }

    @ViewBuilder
    private var presentedRealityView: some View {
#if os(visionOS)
        if presentation == .planarWindow {
            interactiveRealityView.frame(depth: 0)
        } else {
            interactiveRealityView
        }
#else
        interactiveRealityView
#endif
    }

    private var interactiveRealityView: some View {
        RealityView { content in
            content.add(coordinator.presentationEntity)
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

private extension UIColor {
    convenience init(hex: String) {
        let cleaned = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
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
