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
    dependencies: [
        .package(
            url: "https://github.com/huijoohwee/knowgrph.git",
            revision: "19f9da8bc537b782e23ae7669c4a919d94171529"
        )
    ],
    targets: [
        .target(
            name: "GameXRNative",
            dependencies: [
                .product(name: "AgenticGraphSpatialCore", package: "knowgrph"),
                .product(name: "AgenticGraphRealityKitFlight", package: "knowgrph")
            ]
        ),
        .testTarget(
            name: "GameXRNativeTests",
            dependencies: [
                "GameXRNative",
                .product(name: "AgenticGraphSpatialCore", package: "knowgrph")
            ]
        )
    ],
    swiftLanguageModes: [.v6]
)
