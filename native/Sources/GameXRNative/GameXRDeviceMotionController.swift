#if canImport(CoreMotion) && canImport(Observation) && canImport(UIKit) && (os(iOS) || os(visionOS))
import CoreMotion
import Foundation
import KnowgrphSpatialCore
import Observation
import UIKit

public enum GameXRDeviceMotionPhase: String, Equatable, Sendable {
    case off
    case calibrating
    case running
    case unavailable
}

@MainActor @Observable
public final class GameXRDeviceMotionController {
    public private(set) var phase: GameXRDeviceMotionPhase = .off
    public private(set) var axes = AppleSpatialInputAxes()
    public private(set) var sampleCount = 0
    public private(set) var message = "Device motion is off."

    private let manager: CMMotionManager
    private var filter = AppleSpatialInputFilter()
    private var profile: AppleSpatialInputProfile
    private var pollingTask: Task<Void, Never>?
    private var calibrationStartedAt: Date?

    public init(
        profile: AppleSpatialInputProfile = .default,
        manager: CMMotionManager = CMMotionManager()
    ) {
        self.profile = profile
        self.manager = manager
    }

    public func configure(profile: AppleSpatialInputProfile) {
        guard profile != self.profile else { return }
        self.profile = profile
        if phase == .running || phase == .calibrating {
            recenter(message: "Motion profile changed; hold the device comfortably to set neutral.")
        }
    }

    public func start() {
        stopUpdates()
        guard hasUsageDescription else {
            setUnavailable("The host app must provide NSMotionUsageDescription before enabling motion.")
            return
        }
        guard manager.isDeviceMotionAvailable else {
            setUnavailable("Processed device motion is unavailable on this device.")
            return
        }

        filter.reset()
        axes = AppleSpatialInputAxes()
        sampleCount = 0
        phase = .calibrating
        message = "Hold the device comfortably; the first motion sample sets neutral."
        calibrationStartedAt = Date()
        manager.deviceMotionUpdateInterval = 1 / 60
        manager.startDeviceMotionUpdates(using: .xArbitraryZVertical)
        pollingTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                self.readLatestSample()
                try? await Task.sleep(for: .milliseconds(16))
            }
        }
    }

    public func stop(message: String = "Device motion is off.") {
        stopUpdates()
        filter.reset()
        axes = AppleSpatialInputAxes()
        sampleCount = 0
        phase = .off
        self.message = message
    }

    public func recenter(
        message: String = "Hold the device comfortably; the next motion sample sets neutral."
    ) {
        guard phase == .running || phase == .calibrating else { return }
        filter.reset()
        axes = AppleSpatialInputAxes()
        sampleCount = 0
        phase = .calibrating
        self.message = message
        calibrationStartedAt = Date()
    }

    private var hasUsageDescription: Bool {
        guard let value = Bundle.main.object(forInfoDictionaryKey: "NSMotionUsageDescription") as? String else {
            return false
        }
        return !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func readLatestSample() {
        guard phase == .calibrating || phase == .running else { return }
        guard let motion = manager.deviceMotion else {
            if let calibrationStartedAt,
               Date().timeIntervalSince(calibrationStartedAt) * 1_000
                >= profile.calibrationTimeoutMilliseconds {
                stopUpdates()
                setUnavailable("No device-motion sample arrived before the calibration timeout.")
            }
            return
        }

        let projection = filter.project(
            AppleSpatialInputSample(
                betaDegrees: motion.attitude.pitch * 180 / .pi,
                gammaDegrees: motion.attitude.roll * 180 / .pi,
                screenAngleDegrees: Self.screenAngleDegrees,
                timestampMilliseconds: motion.timestamp * 1_000
            ),
            profile: profile
        )
        axes = projection.axes
        sampleCount += 1
        if projection.calibratedNow {
            calibrationStartedAt = nil
            phase = .running
            message = "Device motion is calibrated and controlling flight on-device."
        }
    }

    private func stopUpdates() {
        pollingTask?.cancel()
        pollingTask = nil
        calibrationStartedAt = nil
        if manager.isDeviceMotionActive { manager.stopDeviceMotionUpdates() }
    }

    private func setUnavailable(_ message: String) {
        filter.reset()
        axes = AppleSpatialInputAxes()
        sampleCount = 0
        phase = .unavailable
        self.message = message
    }

    private static var screenAngleDegrees: Double {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let orientation = scenes.first(where: { $0.activationState == .foregroundActive })?.interfaceOrientation
            ?? scenes.first?.interfaceOrientation
        switch orientation {
        case .landscapeLeft: return 90
        case .portraitUpsideDown: return 180
        case .landscapeRight: return 270
        default: return 0
        }
    }
}
#endif
