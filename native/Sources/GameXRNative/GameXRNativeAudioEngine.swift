#if canImport(AVFAudio)
import AVFAudio
import Foundation
import Synchronization

struct GameXRNativeAudioTargetProjection: Equatable, Sendable {
    static let qualityFactor = 1.4

    let normalizedThrottle: Double
    let frequency: Double
    let gain: Double
    let cutoff: Double
    let qualityFactor: Double

    static func project(
        configuration: AudioConfiguration,
        throttle: Double,
        speed: Double
    ) -> Self {
        let normalizedThrottle = min(1, max(0, throttle))
        let frequency = configuration.engineBaseFrequency
            + normalizedThrottle * configuration.engineThrottleRange
            + min(speed, 60) * 0.8
        return Self(
            normalizedThrottle: normalizedThrottle,
            frequency: frequency,
            gain: configuration.enabled
                ? configuration.masterGain * (0.3 + normalizedThrottle * 0.7)
                : 0,
            cutoff: 180 + frequency * 3.4,
            qualityFactor: qualityFactor
        )
    }
}

@MainActor
final class GameXRNativeAudioEngine {
    private static let maximumChannelCount: AVAudioChannelCount = 2

    private var configuration: AudioConfiguration
    private let engine = AVAudioEngine()
    private let signal = GameXRNativeAudioSignal()
    private var sourceNode: AVAudioSourceNode?
    private var filterNode: AVAudioUnitEQ?
    private var lastThrottle = 0.0
    private var lastSpeed = 0.0

    init(configuration: AudioConfiguration) {
        self.configuration = configuration
    }

    func configure(_ configuration: AudioConfiguration) {
        self.configuration = configuration
        applyCurrentTargets()
    }

    @discardableResult
    func start() -> Bool {
        guard configuration.enabled else { return false }
        guard ensureGraph() else { return false }
        applyCurrentTargets()
        guard !engine.isRunning else { return true }
        do {
            engine.prepare()
            try engine.start()
            return engine.isRunning
        } catch {
            // Native audio is an enhancement; flight remains usable in silent mode.
            engine.stop()
            return false
        }
    }

    func update(throttle: Double, speed: Double) {
        lastThrottle = throttle
        lastSpeed = speed
        applyCurrentTargets()
    }

    func pause() {
        guard engine.isRunning else { return }
        engine.pause()
    }

    func reset() {
        lastThrottle = 0
        lastSpeed = 0
        signal.resetPhase()
        applyCurrentTargets()
    }

    func dispose() {
        engine.stop()
        if let sourceNode {
            engine.disconnectNodeOutput(sourceNode)
            engine.detach(sourceNode)
        }
        if let filterNode {
            engine.disconnectNodeInput(filterNode)
            engine.disconnectNodeOutput(filterNode)
            engine.detach(filterNode)
        }
        sourceNode = nil
        filterNode = nil
        signal.resetPhase()
    }

    private func ensureGraph() -> Bool {
        if sourceNode != nil, filterNode != nil { return true }
        let outputFormat = engine.outputNode.outputFormat(forBus: 0)
        guard outputFormat.sampleRate > 0, outputFormat.channelCount > 0 else {
            return false
        }
        let channelCount = min(Self.maximumChannelCount, outputFormat.channelCount)
        guard let format = AVAudioFormat(
            standardFormatWithSampleRate: outputFormat.sampleRate,
            channels: channelCount
        ) else {
            return false
        }

        let signal = signal
        let sampleRate = format.sampleRate
        let sourceNode = AVAudioSourceNode(format: format) { _, _, frameCount, audioBufferList in
            signal.render(
                frameCount: frameCount,
                audioBufferList: audioBufferList,
                sampleRate: sampleRate
            )
            return noErr
        }
        let filterNode = AVAudioUnitEQ(numberOfBands: 1)
        let lowPass = filterNode.bands[0]
        lowPass.filterType = .resonantLowPass
        lowPass.bandwidth = Self.bandwidth(forQualityFactor: GameXRNativeAudioTargetProjection.qualityFactor)
        lowPass.bypass = false
        filterNode.bypass = false

        engine.attach(sourceNode)
        engine.attach(filterNode)
        engine.connect(sourceNode, to: filterNode, format: format)
        engine.connect(filterNode, to: engine.mainMixerNode, format: nil)
        engine.mainMixerNode.outputVolume = 0
        self.sourceNode = sourceNode
        self.filterNode = filterNode
        return true
    }

    private func applyCurrentTargets() {
        let targets = GameXRNativeAudioTargetProjection.project(
            configuration: configuration,
            throttle: lastThrottle,
            speed: lastSpeed
        )
        signal.setFrequency(max(0, targets.frequency))
        filterNode?.bands[0].frequency = Float(max(10, targets.cutoff))
        engine.mainMixerNode.outputVolume = Float(targets.gain)
    }

    private static func bandwidth(forQualityFactor qualityFactor: Double) -> Float {
        Float(2 * asinh(1 / (2 * qualityFactor)) / log(2))
    }
}

private final class GameXRNativeAudioSignal: Sendable {
    private let frequencyBits = Atomic<UInt64>(0)
    private let phaseBits = Atomic<UInt64>(0)

    func setFrequency(_ frequency: Double) {
        frequencyBits.store(frequency.bitPattern, ordering: .relaxed)
    }

    func resetPhase() {
        phaseBits.store(0, ordering: .relaxed)
    }

    func render(
        frameCount: AVAudioFrameCount,
        audioBufferList: UnsafeMutablePointer<AudioBufferList>,
        sampleRate: Double
    ) {
        let frequency = Double(bitPattern: frequencyBits.load(ordering: .relaxed))
        let phaseIncrement = frequency / sampleRate
        var phase = Double(bitPattern: phaseBits.load(ordering: .relaxed))
        let buffers = UnsafeMutableAudioBufferListPointer(audioBufferList)

        for frameIndex in 0..<Int(frameCount) {
            let sample = Float(phase * 2 - 1)
            for buffer in buffers {
                guard let data = buffer.mData else { continue }
                let channels = max(1, Int(buffer.mNumberChannels))
                let samples = data.assumingMemoryBound(to: Float.self)
                for channelIndex in 0..<channels {
                    samples[frameIndex * channels + channelIndex] = sample
                }
            }
            phase += phaseIncrement
            phase.formTruncatingRemainder(dividingBy: 1)
        }
        phaseBits.store(phase.bitPattern, ordering: .relaxed)
    }
}
#endif
