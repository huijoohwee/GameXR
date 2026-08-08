# Apple platform compatibility

## Stable production baseline

- Xcode 26.6, Swift 6.3, iOS/visionOS 26.5 SDKs.
- Automated native baseline: iOS 26.5 Simulator and Apple Vision Pro / visionOS 26.5 Simulator; Safari 26.6 remains the browser baseline.
- Deployment floor retained from the original Apple sample: iOS/iPadOS 18 and visionOS 2.

visionOS 27 runtime execution is an out-of-baseline canary. Xcode 27, Swift 6.4, OS/Safari 27, and Reality Composer Pro 3 remain canary lanes and are not required for GameXR Dev readiness or a Production candidate.

Authoritative references: [Xcode 26.6 release notes](https://developer.apple.com/documentation/xcode-release-notes/xcode-26_6-release-notes), [Swift 6.3](https://www.swift.org/blog/swift-6.3-released/), [Apple Creating a Spaceship game](https://developer.apple.com/documentation/realitykit/creating-a-spaceship-game), and [Reality Composer Pro release notes](https://developer.apple.com/documentation/realitycomposerpro/reality-composer-pro-release-notes).

## Runtime split

The browser runtime and native adapter share domain data, not renderer objects:

- Browser: Three.js WebGL2, progressive WebGPU opportunity, IndexedDB, service worker, Pointer Events, permission-gated Device Orientation.
- Native adapter: strict `Codable` manifest decoding, an `@Observable` coordinator, a procedural `RealityView` ship, value-type RealityKit flight components, a registered flight `System`, and an on-device Core Motion producer.
- Native host: the source-owned `native/App` `WindowGroup` consumes local `GameXRNative`, embeds the root-owned `shared/default-scene.json`, and owns only app lifecycle, bundle metadata, fail-closed resource loading, planar-window presentation, and UI-test wiring.
- Asset intent: GLB is the implemented browser import format. A future native resolver may project validated USD/USDC/USDZ or `.reality` variants from stable semantic IDs and hashes, but no native imported-asset resolver exists in this repository today.

The native adapter performs no imported-asset loading, so it makes no runtime claim about USD, Reality Composer Pro, or `AnimationPlaybackController` integration. Any future resolver must load asynchronously by stable ID, validate provenance and budgets before admission, and give one system ownership of each mutable transform. Shared scene assembly stays within `Entity` APIs available to both RealityKit content variants; iOS camera-content-only behavior and visionOS spatial-content-only behavior must remain isolated at their platform adapter boundaries.

## Native parity boundary

The native package and windowed visionOS host are bounded procedural RealityKit proof, not full browser-gameplay parity or an `ImmersiveSpace` implementation. They currently project manifest decode/encode, procedural unlit hull/accent/exhaust colors and scale, initial ship transform, touch and processed-device-motion flight controls, pause/reset, and basic acceleration/drag/rate limits. The explicit planar-window presentation scales and tilts its own container and uses planar material ordering; the coordinator's simulation root remains host-placeable and unchanged.

The following manifest domains are validated but not yet projected into native rendering or behavior:

- environment, fog, stars, asteroids, planet, lighting, and dynamic chase-camera projection;
- local GLB lookup or any USD/USDC/USDZ/Reality Composer Pro asset resolver;
- canopy/accent/exhaust material parity beyond the small procedural adapter;
- bank angle, lateral assist, haptics, idle-thrust input, and the browser-wide sensitivity/dead-zone layer beyond the portable device-orientation profile;
- animation timelines/imported clips, procedural animation parameters, audio, dynamic resolution, frame targeting, and native offline asset persistence.

Native runtime readiness means the package sources compile and pass their contract tests and, on the stable native simulator lane, the source-owned app installs, launches, loads the canonical manifest successfully, exposes working Fly/Pause and Reset controls, and holds the procedural ship stationary while paused. It does not prove physical sensors, full visual parity, tracking, comfort, performance, or immersive lifecycle.

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

## Current validation evidence

- Playwright mobile WebKit profile: responsive canvas, recoverable denial, grant/calibration/recenter/rotation lifecycle, exact cached byte/SHA-256 integrity, and a genuinely offline navigation/reload pass against a disposable local origin. The same suite can target an exact deployed URL and expected source/artifact identity for shipped-byte and online cache-convergence proof; it does not disrupt the external origin. This remains automated browser evidence, not a physical Safari, Core Motion, haptics, audio-routing, or installed-PWA certification.
- Swift 6.3 package tests: shared manifest, canonical camera-admission, paused-flight lifecycle, and Apple spatial-input conformance checks run at the exact Knowgrph pin.
- iOS 26.5 Simulator: the `GameXRNative` test target builds and executes successfully.
- visionOS xrsimulator compile: `GameXRNative` cross-compiles for `arm64-apple-xros2.0-simulator`.
- Apple Vision Pro / visionOS 26.5 Simulator: `GameXRVisionAppUITests` launches the source-owned windowed app, waits for `gamexr-native-runtime`, verifies the fail-closed load-error marker is absent, checks the canonical manifest identity and RealityView host, exercises Fly, Reset while running, Pause, and a stationary paused hold. A separate live framebuffer capture shows the procedural hull, wings, and exhaust after an eight-second paused hold. The UI assertions prove host/resource/control wiring; the framebuffer is simulator visual evidence, not pixel-regression, physical-device, or immersive proof.
- Apple Vision Pro / visionOS 27 Simulator: manual launch is an optional forward-compatibility canary and does not substitute for the stable 26.5 `xcodebuild test` lane.
- Physical iPhone: no attached device was available during this validation; real Safari permission, sensor quality, orientation timing, background/return, PWA installation, and thermal evidence remain pending.
- Physical Apple Vision Pro: no paired device was available; window comfort, tracking, control quality, and performance remain pending. The current host declares a `WindowGroup`, not an `ImmersiveSpace`.
- Reality Composer Pro assets: none are admitted. The procedural `RealityView` adapter compiles and tests without a duplicate native asset resolver.

## Proof commands

The repository-owned check always runs Swift tests, an available iOS Simulator test destination, the native visionOS cross-compile gate, and the source-owned app UI suite on an exact-SDK native Apple Vision Pro destination. Compatibility-only Designed-for-iPad/iPhone destinations are rejected:

```sh
npm run native:check
npm run test:webkit
```

An exact deployed browser run uses `GAME_XR_E2E_URL`, with `GAME_XR_EXPECTED_SOURCE_REVISION` and `GAME_XR_EXPECTED_ARTIFACT_DIGEST` binding the expected candidate. Passing it proves the deployed browser artifact and chase-camera/WebMCP projection; physical iPhone and Apple Vision Pro matrices remain separate.

Its component commands are:

```sh
swift test --package-path native

xcodebuild -scheme GameXRNative \
  -destination '<available iPhone simulator id>' \
  CODE_SIGNING_ALLOWED=NO test

swift build --package-path native \
  --triple arm64-apple-xros2.0-simulator \
  --sdk '<installed xrsimulator SDK path>'

xcodebuild \
  -project native/App/GameXRVisionApp.xcodeproj \
  -scheme GameXRVisionApp \
  -sdk xrsimulator \
  -destination 'id=<native Apple Vision Pro / visionOS 26.5 simulator id>' \
  test
```

The final command uses a native destination selected at runtime; no device identifier belongs in source. It intentionally retains simulator signing because the UI-test app must install and launch.
