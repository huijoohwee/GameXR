import SwiftUI

@main
struct GameXRVisionApp: App {
    var body: some Scene {
        WindowGroup {
            GameXRHostView()
                .frame(minWidth: 900, minHeight: 650)
        }
    }
}
