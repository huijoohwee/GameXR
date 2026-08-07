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
            revision: "1288749a170e1e5790fccd4130e8f76562370745"
        )
    ],
    targets: [
        .target(
            name: "GameXRNative",
            dependencies: [
                .product(name: "KnowgrphSpatialCore", package: "knowgrph"),
                .product(name: "KnowgrphRealityKitFlight", package: "knowgrph")
            ]
        ),
        .testTarget(
            name: "GameXRNativeTests",
            dependencies: [
                "GameXRNative",
                .product(name: "KnowgrphSpatialCore", package: "knowgrph")
            ]
        )
    ],
    swiftLanguageModes: [.v6]
)
