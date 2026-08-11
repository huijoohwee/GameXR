import SwiftUI

@main
struct GameXRVisionApp: App {
    @State private var model = GameXRAppModel()
    @State private var immersionStyle: ImmersionStyle = .full

    var body: some Scene {
        ImmersiveSpace(id: GameXRAppModel.immersiveSpaceID, makeContent: {
            GameXRImmersiveHostView(model: model)
        })
        .immersionStyle(selection: $immersionStyle, in: .full)

        WindowGroup(id: GameXRAppModel.launcherWindowID, for: String.self) { _ in
            GameXRHostView(model: model)
        } defaultValue: {
            GameXRAppModel.recoveryWindowValue
        }
        .defaultSize(width: 460, height: 320)
    }
}
