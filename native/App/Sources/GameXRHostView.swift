import Foundation
import GameXRNative
import Observation
import SwiftUI

@MainActor @Observable
final class GameXRAppModel {
    static let launcherWindowID = "gamexr-launcher"
    static let immersiveSpaceID = "gamexr-full-scene"
    static let recoveryWindowValue = "gamexr-recovery"

    enum ImmersiveState: Equatable {
        case closed
        case transitioning
        case open
        case failed

        var label: String {
            switch self {
            case .closed: "Full scene closed"
            case .transitioning: "Full scene transitioning"
            case .open: "Full scene open"
            case .failed: "Full scene failed"
            }
        }
    }

    enum ProjectionState: Equatable {
        case pending
        case ready(GameXRWorldInventory)
        case failed(String)
    }

    let loadState: ManifestLoadState
    var immersiveState: ImmersiveState = .closed
    private(set) var projectionState: ProjectionState = .pending
    private(set) var isRecoveryWindowVisible = false
    private var isRecoveryPresentationPending = false
    private var isImmersiveDismissalPending = false

    var canResumeFullScene: Bool {
        guard case .ready = loadState else { return false }
        return immersiveState == .closed || immersiveState == .failed
    }

    var shouldDismissRecoveryWindow: Bool {
        immersiveState == .open
    }

    init(bundle: Bundle = .main) {
        do {
            guard let url = bundle.url(forResource: "default-scene", withExtension: "json") else {
                throw ManifestLoadError.missingResource
            }
            loadState = .ready(try GameXRSceneManifest.decode(Data(contentsOf: url)))
        } catch {
            loadState = .failed(error.localizedDescription)
            immersiveState = .failed
        }
    }

    func recoveryWindowDidAppear() {
        isRecoveryWindowVisible = true
        isRecoveryPresentationPending = false
    }

    func recoveryWindowDidDisappear() {
        isRecoveryWindowVisible = false
    }

    func cancelRecoveryPresentation() {
        isRecoveryPresentationPending = false
    }

    func beginRecoveryPresentation() -> Bool {
        guard !isRecoveryWindowVisible, !isRecoveryPresentationPending else { return false }
        isRecoveryPresentationPending = true
        return true
    }

    func beginImmersivePresentation() -> Bool {
        guard canResumeFullScene else { return false }
        immersiveState = .transitioning
        projectionState = .pending
        isImmersiveDismissalPending = false
        return true
    }

    func immersiveSpaceDidAppear() {
        if case .ready = projectionState { return }
        if immersiveState != .failed { immersiveState = .transitioning }
    }

    func projectionDidBecomeReady(_ inventory: GameXRWorldInventory) -> Bool {
        guard immersiveState != .failed else { return false }
        let nextState = ProjectionState.ready(inventory)
        guard projectionState != nextState || immersiveState != .open else { return false }
        projectionState = nextState
        immersiveState = .open
        isImmersiveDismissalPending = false
        return true
    }

    func projectionDidFail(_ message: String) -> Bool {
        projectionState = .failed(message)
        immersiveState = .failed
        guard !isImmersiveDismissalPending else { return false }
        isImmersiveDismissalPending = true
        return true
    }

    func beginImmersiveDismissal() -> Bool {
        guard immersiveState == .open, !isImmersiveDismissalPending else { return false }
        immersiveState = .transitioning
        isImmersiveDismissalPending = true
        return true
    }

    func immersiveSpaceDidDisappear() {
        isImmersiveDismissalPending = false
        if immersiveState != .failed {
            immersiveState = .closed
            projectionState = .pending
        }
    }

    func immersiveOpenWasCancelled() {
        immersiveState = .closed
        projectionState = .pending
    }

    func immersiveOpenFailed() {
        immersiveState = .failed
        projectionState = .failed("The system could not open the full immersive space.")
    }
}

struct GameXRHostView: View {
    @Environment(\.dismissWindow) private var dismissWindow
    @Environment(\.openImmersiveSpace) private var openImmersiveSpace
    let model: GameXRAppModel

    var body: some View {
        Group {
            switch model.loadState {
            case let .ready(manifest):
                VStack(alignment: .leading, spacing: 18) {
                    Text("GameXR recovery")
                        .font(.title2.bold())
                        .accessibilityIdentifier("gamexr-native-runtime")
                    Text(manifest.name)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("gamexr-native-manifest-name")
                    Text("Native RealityKit • full immersion • no browser")
                        .font(.callout)
                    Text(model.immersiveState.label)
                        .font(.caption)
                        .accessibilityIdentifier("gamexr-native-launcher-state")
                    Button("Resume GameXR") {
                        resumeFullScene()
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(!model.canResumeFullScene)
                    .accessibilityIdentifier("gamexr-native-resume-full-scene")
                }
                .padding(32)
            case let .failed(message):
                ContentUnavailableView(
                    "GameXR could not start",
                    systemImage: "exclamationmark.triangle",
                    description: Text(message)
                )
                .accessibilityIdentifier("gamexr-native-load-error")
            }
        }
        .onAppear {
            model.recoveryWindowDidAppear()
            if model.shouldDismissRecoveryWindow {
                dismissWindow(id: GameXRAppModel.launcherWindowID)
            }
        }
        .onDisappear {
            model.recoveryWindowDidDisappear()
        }
    }

    private func resumeFullScene() {
        guard model.beginImmersivePresentation() else { return }
        Task { @MainActor in
            switch await openImmersiveSpace(id: GameXRAppModel.immersiveSpaceID) {
            case .opened:
                break
            case .userCancelled:
                model.immersiveOpenWasCancelled()
            case .error:
                model.immersiveOpenFailed()
            @unknown default:
                model.immersiveOpenFailed()
            }
        }
    }
}

struct GameXRImmersiveHostView: View {
    @Environment(\.dismissImmersiveSpace) private var dismissImmersiveSpace
    @Environment(\.dismissWindow) private var dismissWindow
    @Environment(\.openWindow) private var openWindow
    let model: GameXRAppModel

    var body: some View {
        Group {
            switch model.loadState {
            case let .ready(manifest):
                ZStack(alignment: .top) {
                    GameXRImmersiveSceneView(
                        manifest: manifest,
                        onProjectionStateChange: handleProjectionState
                    )

                    if case .ready = model.projectionState {
                        VStack(spacing: 8) {
                            Text("Native full immersive space active")
                                .font(.caption)
                                .accessibilityIdentifier("gamexr-native-immersive-space")
                            Text("Full native GameXR scene")
                                .font(.headline)
                                .accessibilityIdentifier("gamexr-native-full-scene-marker")
                            Button("Exit Full Scene") {
                                guard model.beginImmersiveDismissal() else { return }
                                Task { @MainActor in
                                    await dismissImmersiveSpace()
                                    presentRecoveryWindow()
                                }
                            }
                            .accessibilityIdentifier("gamexr-native-exit-full-scene")
                        }
                        .padding()
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18))
                        .padding()
                    }
                }
            case let .failed(message):
                Text(message)
                    .accessibilityIdentifier("gamexr-native-load-error")
            }
        }
        .onAppear {
            switch model.loadState {
            case .ready:
                model.immersiveSpaceDidAppear()
            case let .failed(message):
                recoverFromProjectionFailure(message)
            }
        }
        .onDisappear {
            model.immersiveSpaceDidDisappear()
            presentRecoveryWindow()
        }
    }

    private func handleProjectionState(_ state: GameXRNativeProjectionState) {
        switch state {
        case let .ready(inventory):
            if model.projectionDidBecomeReady(inventory) {
                model.cancelRecoveryPresentation()
                dismissWindow(id: GameXRAppModel.launcherWindowID)
            }
        case let .failed(message):
            recoverFromProjectionFailure(message)
        }
    }

    private func recoverFromProjectionFailure(_ message: String) {
        let shouldDismissImmersiveSpace = model.projectionDidFail(message)
        guard shouldDismissImmersiveSpace else { return }
        Task { @MainActor in
            await dismissImmersiveSpace()
            presentRecoveryWindow()
        }
    }

    private func presentRecoveryWindow() {
        guard model.beginRecoveryPresentation() else { return }
        openWindow(
            id: GameXRAppModel.launcherWindowID,
            value: GameXRAppModel.recoveryWindowValue
        )
    }
}

enum ManifestLoadState {
    case ready(GameXRSceneManifest)
    case failed(String)
}

private enum ManifestLoadError: LocalizedError {
    case missingResource

    var errorDescription: String? {
        "The canonical default-scene.json resource is missing from the application bundle."
    }
}
