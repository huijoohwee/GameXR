// swift-tools-version: 6.3

import PackageDescription

let package = Package(
    name: "GameXRNative",
    platforms: [
        .iOS(.v18),
        .visionOS(.v2),
        .macOS(.v15)
    ],
    products: [
        .library(name: "GameXRNative", targets: ["GameXRNative"])
    ],
    targets: [
        .target(name: "GameXRNative"),
        .testTarget(name: "GameXRNativeTests", dependencies: ["GameXRNative"])
    ],
    swiftLanguageModes: [.v6]
)
