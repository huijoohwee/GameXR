# Apple platform compatibility

## Stable production baseline

- Xcode 26.6, Swift 6.3, iOS/visionOS 26.5 SDKs.
- Runtime target: current iOS, iPadOS, visionOS, and Safari 26.6.
- Deployment floor retained from the original Apple sample: iOS/iPadOS 18 and visionOS 2.

Xcode 27, Swift 6.4, OS/Safari 27, and Reality Composer Pro 3 are beta/canary lanes only. They are not required for GameXR Dev readiness or a future Production candidate.

Authoritative references: [Xcode 26.6 release notes](https://developer.apple.com/documentation/xcode-release-notes/xcode-26_6-release-notes), [Swift 6.3](https://www.swift.org/blog/swift-6.3-released/), [Apple Creating a Spaceship game](https://developer.apple.com/documentation/realitykit/creating-a-spaceship-game), and [Reality Composer Pro release notes](https://developer.apple.com/documentation/realitycomposerpro/reality-composer-pro-release-notes).

## Runtime split

The browser runtime and native adapter share domain data, not renderer objects:

- Browser: Three.js WebGL2, progressive WebGPU opportunity, IndexedDB, service worker, Pointer Events, permission-gated Device Orientation.
- Native adapter: strict `Codable` manifest decoding, an `@Observable` coordinator, a procedural `RealityView` ship, value-type RealityKit flight components, a registered flight `System`, and an on-device Core Motion producer.
- Asset intent: GLB is the implemented browser import format. A future native resolver may project validated USD/USDC/USDZ or `.reality` variants from stable semantic IDs and hashes, but no native imported-asset resolver exists in this repository today.

The native adapter performs no imported-asset loading, so it makes no runtime claim about USD, Reality Composer Pro, or `AnimationPlaybackController` integration. Any future resolver must load asynchronously by stable ID, validate provenance and budgets before admission, and give one system ownership of each mutable transform. Shared scene assembly stays within `Entity` APIs available to both RealityKit content variants; iOS camera-content-only behavior and visionOS spatial-content-only behavior must remain isolated at their platform adapter boundaries.

## Native parity boundary

The native target is build-compatible procedural RealityKit proof, not full gameplay parity with the browser runtime. It currently projects manifest decode/encode, procedural hull colors and scale, initial ship transform, touch and processed-device-motion flight controls, pause/reset, and basic acceleration/drag/rate limits.

The following manifest domains are validated but not yet projected into native rendering or behavior:

- environment, fog, stars, asteroids, planet, lighting, and chase-camera configuration;
- local GLB lookup or any USD/USDC/USDZ/Reality Composer Pro asset resolver;
- canopy/accent/exhaust material parity beyond the small procedural adapter;
- bank angle, lateral assist, haptics, idle-thrust input, and the browser-wide sensitivity/dead-zone layer beyond the portable device-orientation profile;
- animation timelines/imported clips, procedural animation parameters, audio, dynamic resolution, frame targeting, and native offline asset persistence.

Native runtime readiness therefore means the package and conditional RealityKit/Core Motion sources compile for the stated Apple SDK baseline and the shared manifest contract is rejected safely when malformed. It does not prove physical sensor quality or mean every browser feature has a native projection.

## Safari behavior

- WebGL2 is the current default renderer for broad iOS/visionOS reach. WebGPU is feature-detected as a future enhancement; user-agent sniffing is forbidden.
- WebXR is feature-detected. It is available on visionOS Safari, not an iPhone Safari fallback.
- AR Quick Look and stable `<model>` are presentation/export enhancements for correctly served USDZ; they are not gameplay-runtime parity.
- Audio starts only from an explicit gesture. Motion permission is requested synchronously by **Enable Motion** from an explicit user tap in a secure context; listeners are installed only after the grant resolves.
- Safe-area CSS, Pointer Events, full-viewport fallback, reduced-motion handling, and dynamic pixel-ratio reduction are part of the base experience.

References: [Safari 26 WebGPU](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/), [Safari 26.2 WebXR/WebGPU](https://webkit.org/blog/17640/webkit-features-for-safari-26-2/), [AR Quick Look](https://webkit.org/blog/8421/viewing-augmented-reality-assets-in-safari-for-ios/), and [WebKit storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/).

## Phone orientation control

Device orientation controls the GameXR flight/camera input; it does not open the phone camera. The mobile contract is:

1. **Enable Motion** is a visible user-tap action. GameXR invokes every sensor permission API it consumes while that gesture is still active and does not preflight permission during page load.
2. No `deviceorientation` listener is active before permission succeeds. Denial, an unsupported API, or an invalid sample leaves motion input neutral and produces visible status instead of a silent fallback.
3. The first finite sample after enable or **Recenter** establishes the neutral pose. GameXR computes control deltas from that pose instead of assuming a fixed portrait holding angle.
4. The projection remaps axes for the current screen rotation, uses elapsed-time smoothing so response is stable across event rates, applies the versioned `motion.deviceOrientation` profile, then clamps normalized input before the browser-wide sensitivity/dead-zone layer.
5. **Disable Motion**, hidden visibility, `pagehide`, and runtime disposal remove listeners and clear transient samples, calibration, and smoothed state. Returning to the page requires an explicit enable/recenter path rather than replaying stale motion.

Samples, neutral calibration, and filtered axes stay in process memory. They are not persisted, exported, exposed through MCP, or transmitted. Production responses must delegate the required features to the same origin—for example `Permissions-Policy: accelerometer=(self), gyroscope=(self)`—and an embedding iframe must also use an explicit `allow="accelerometer; gyroscope"` delegation. Delegation permits a prompt; it never replaces the user tap or grant.

The Swift adapter uses one owned `CMMotionManager`, checks processed-device-motion availability, starts the `.xArbitraryZVertical` reference frame only from the visible control, polls the latest sample at the game cadence, and stops updates when disabled, when the scene becomes inactive, or when the `RealityView` disappears. Its host application must include a non-empty `NSMotionUsageDescription`. Browser permission state and native Core Motion availability deliberately remain adapter-local; only the finite sample-to-axis math and profile schema are shared.

Both adapters consume Knowgrph's `airvio.apple-spatial-input/v1`: control range, angular jitter threshold, settled-axis threshold, smoothing rate, and calibration timeout. TypeScript and Swift conformance tests run the same cardinal-screen-rotation and event-rate-independent smoothing vectors. The installed Knowgrph package exports the portable JSON profile contract and the build projects it into the release schema directory.

Knowgrph protected revision `1288749a170e1e5790fccd4130e8f76562370745` owns the shared browser and Swift spatial-input implementations, deterministic flight model, camera target resolver, and RealityKit flight system. GameXR retains thin lifecycle/UI and scene-profile adapters only.

Repository checks with mocked browser events and native conformance vectors can prove permission ordering, calibration, screen-angle math, smoothing, cleanup, and no-egress boundaries. Simulator builds cannot prove WebKit's real prompt, Core Motion hardware behavior, physical sensor quality, orientation-change timing, thermal behavior, or installed-PWA behavior. Until named current iPhone/Safari and Apple Vision Pro/visionOS runs pass their platform matrices, physical compatibility remains a promotion gate rather than a completed claim.

## Current automated evidence

- Playwright WebKit 26.5 mobile profile: responsive canvas, recoverable denial, grant/calibration/recenter/rotation lifecycle, and installed cache-byte integrity while offline pass. Physical Safari offline navigation remains in the device matrix.
- Swift 6.3.3 package tests: seven shared manifest and Apple spatial-input conformance tests pass at the exact Knowgrph pin.
- iOS 26.5 Simulator: the `GameXRNative` test target builds and executes successfully.
- visionOS Simulator: the same test target builds and executes successfully; the locally available simulator runtime is a canary lane and does not promote the stable deployment baseline.
- Physical iPhone: detected but unavailable during this validation; real Safari permission, sensor quality, orientation timing, background/return, PWA installation, and thermal evidence remain pending.
- Physical Apple Vision Pro: no paired device was available; comfort, tracking, performance, and immersive-lifecycle evidence remain pending.
- Reality Composer Pro assets: none are admitted. The procedural `RealityView` adapter compiles and tests without a duplicate native asset resolver.

## Proof commands

The repository-owned check selects an available visionOS simulator dynamically and keeps device identifiers out of source:

```sh
npm run native:check
npm run test:webkit
```

Its component commands are:

```sh
swift test --package-path native

xcodebuild -scheme GameXRNative \
  -destination '<available iPhone simulator id>' \
  CODE_SIGNING_ALLOWED=NO test

xcodebuild -scheme GameXRNative \
  -sdk xrsimulator \
  -destination '<available Apple Vision Pro simulator id>' \
  CODE_SIGNING_ALLOWED=NO test
```

The final command uses an available simulator selected at runtime; no device identifier belongs in source.
