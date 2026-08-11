#if canImport(AVFAudio)
import Testing
@testable import GameXRNative

@Test func nativeAudioTargetsMatchBrowserProjection() {
    let enabled = AudioConfiguration(
        enabled: true,
        masterGain: 0.2,
        engineBaseFrequency: 100,
        engineThrottleRange: 400
    )
    let targets = GameXRNativeAudioTargetProjection.project(
        configuration: enabled,
        throttle: 0.5,
        speed: 75
    )

    #expect(targets.normalizedThrottle == 0.5)
    #expect(targets.frequency == 348)
    #expect(abs(targets.gain - 0.13) < 0.000_000_1)
    #expect(abs(targets.cutoff - 1_363.2) < 0.000_000_1)
    #expect(targets.qualityFactor == 1.4)
}

@Test func nativeAudioTargetsClampThrottleAndHonorDisabledGain() {
    let disabled = AudioConfiguration(
        enabled: false,
        masterGain: 0.2,
        engineBaseFrequency: 100,
        engineThrottleRange: 400
    )
    let targets = GameXRNativeAudioTargetProjection.project(
        configuration: disabled,
        throttle: 2,
        speed: 0
    )

    #expect(targets.normalizedThrottle == 1)
    #expect(targets.frequency == 500)
    #expect(targets.gain == 0)
    #expect(targets.cutoff == 1_880)
}
#endif
