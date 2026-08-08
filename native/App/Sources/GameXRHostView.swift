import Foundation
import GameXRNative
import SwiftUI

struct GameXRHostView: View {
    private let loadState: ManifestLoadState

    init(bundle: Bundle = .main) {
        do {
            guard let url = bundle.url(forResource: "default-scene", withExtension: "json") else {
                throw ManifestLoadError.missingResource
            }
            loadState = .ready(try GameXRSceneManifest.decode(Data(contentsOf: url)))
        } catch {
            loadState = .failed(error.localizedDescription)
        }
    }

    var body: some View {
        switch loadState {
        case let .ready(manifest):
            ZStack(alignment: .topLeading) {
                GameXRPlanarWindowView(manifest: manifest)
                    .accessibilityIdentifier("gamexr-native-reality-view")

                VStack(alignment: .leading, spacing: 4) {
                    Text("GameXR native runtime")
                        .font(.headline)
                        .accessibilityIdentifier("gamexr-native-runtime")
                    Text(manifest.name)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("gamexr-native-manifest-name")
                }
                .padding()
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
                .padding()
                .allowsHitTesting(false)
            }
        case let .failed(message):
            ContentUnavailableView(
                "GameXR could not start",
                systemImage: "exclamationmark.triangle",
                description: Text(message)
            )
            .accessibilityIdentifier("gamexr-native-load-error")
        }
    }
}

private enum ManifestLoadState {
    case ready(GameXRSceneManifest)
    case failed(String)
}

private enum ManifestLoadError: LocalizedError {
    case missingResource

    var errorDescription: String? {
        "The canonical default-scene.json resource is missing from the application bundle."
    }
}
