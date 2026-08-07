import Foundation

public struct AppleSpatialInputAxes: Equatable, Sendable {
    public let pitch: Double
    public let roll: Double

    public init(pitch: Double = 0, roll: Double = 0) {
        self.pitch = pitch
        self.roll = roll
    }
}

public struct AppleSpatialInputSample: Equatable, Sendable {
    public let betaDegrees: Double
    public let gammaDegrees: Double
    public let screenAngleDegrees: Double
    public let timestampMilliseconds: Double

    public init(
        betaDegrees: Double,
        gammaDegrees: Double,
        screenAngleDegrees: Double,
        timestampMilliseconds: Double
    ) {
        self.betaDegrees = betaDegrees
        self.gammaDegrees = gammaDegrees
        self.screenAngleDegrees = screenAngleDegrees
        self.timestampMilliseconds = timestampMilliseconds
    }
}

public struct AppleSpatialInputProjection: Equatable, Sendable {
    public let axes: AppleSpatialInputAxes
    public let calibratedNow: Bool
}

public struct AppleSpatialInputFilter: Sendable {
    private struct Baseline: Sendable {
        let betaDegrees: Double
        let gammaDegrees: Double
    }

    private var baseline: Baseline?
    private var previousTimestampMilliseconds: Double?
    public private(set) var axes = AppleSpatialInputAxes()

    public init() {}

    public mutating func reset() {
        baseline = nil
        previousTimestampMilliseconds = nil
        axes = AppleSpatialInputAxes()
    }

    public mutating func project(
        _ sample: AppleSpatialInputSample,
        profile: AppleSpatialInputProfile
    ) -> AppleSpatialInputProjection {
        guard sample.betaDegrees.isFinite,
              sample.gammaDegrees.isFinite,
              sample.screenAngleDegrees.isFinite else {
            return AppleSpatialInputProjection(axes: axes, calibratedNow: false)
        }
        guard let baseline else {
            self.baseline = Baseline(
                betaDegrees: sample.betaDegrees,
                gammaDegrees: sample.gammaDegrees
            )
            previousTimestampMilliseconds = sample.timestampMilliseconds
            axes = AppleSpatialInputAxes()
            return AppleSpatialInputProjection(axes: axes, calibratedNow: true)
        }

        let mapped = Self.mapToScreen(
            betaDeltaDegrees: Self.shortestAngleDelta(
                sample.betaDegrees - baseline.betaDegrees
            ),
            gammaDeltaDegrees: sample.gammaDegrees - baseline.gammaDegrees,
            screenAngleDegrees: sample.screenAngleDegrees
        )
        let targetPitch = abs(mapped.pitch) < profile.jitterThresholdDegrees
            ? 0
            : Self.clamp(mapped.pitch / profile.controlRangeDegrees)
        let targetRoll = abs(mapped.roll) < profile.jitterThresholdDegrees
            ? 0
            : Self.clamp(mapped.roll / profile.controlRangeDegrees)
        let elapsedSeconds = elapsedSeconds(for: sample.timestampMilliseconds)
        let blend = 1 - exp(-profile.smoothingRatePerSecond * elapsedSeconds)
        var pitch = axes.pitch + (targetPitch - axes.pitch) * blend
        var roll = axes.roll + (targetRoll - axes.roll) * blend
        if targetPitch == 0 && abs(pitch) < profile.settledAxisThreshold { pitch = 0 }
        if targetRoll == 0 && abs(roll) < profile.settledAxisThreshold { roll = 0 }
        axes = AppleSpatialInputAxes(
            pitch: Self.clamp(pitch),
            roll: Self.clamp(roll)
        )
        previousTimestampMilliseconds = sample.timestampMilliseconds
        return AppleSpatialInputProjection(axes: axes, calibratedNow: false)
    }

    public static func mapToScreen(
        betaDeltaDegrees: Double,
        gammaDeltaDegrees: Double,
        screenAngleDegrees: Double
    ) -> AppleSpatialInputAxes {
        let radians = normalizedAngle(screenAngleDegrees) * .pi / 180
        return AppleSpatialInputAxes(
            pitch: betaDeltaDegrees * cos(radians) + gammaDeltaDegrees * sin(radians),
            roll: gammaDeltaDegrees * cos(radians) - betaDeltaDegrees * sin(radians)
        )
    }

    public static func shortestAngleDelta(_ value: Double) -> Double {
        let normalized = normalizedAngle(value)
        return normalized > 180 ? normalized - 360 : normalized
    }

    private func elapsedSeconds(for timestampMilliseconds: Double) -> Double {
        guard let previousTimestampMilliseconds,
              timestampMilliseconds.isFinite,
              timestampMilliseconds > previousTimestampMilliseconds else {
            return 1 / 60
        }
        return min(0.1, max(1 / 240, (timestampMilliseconds - previousTimestampMilliseconds) / 1_000))
    }

    private static func normalizedAngle(_ value: Double) -> Double {
        let remainder = value.truncatingRemainder(dividingBy: 360)
        return remainder < 0 ? remainder + 360 : remainder
    }

    private static func clamp(_ value: Double) -> Double {
        min(1, max(-1, value.isFinite ? value : 0))
    }
}

public extension AppleSpatialInputProfile {
    static let `default` = AppleSpatialInputProfile(
        schema: schemaIdentifier,
        controlRangeDegrees: 35,
        jitterThresholdDegrees: 0.75,
        settledAxisThreshold: 0.002,
        smoothingRatePerSecond: 12,
        calibrationTimeoutMilliseconds: 2_500
    )
}
