# Apple platform compatibility

## Stable production baseline

- Xcode 26.6 build `17F113`, Swift 6.3, and iOS/visionOS 26.5 SDKs; the verified visionOS SDK is build `23O469` and its Simulator runtime is build `23O470`.
- Automated native baseline: iOS 26.5 Simulator and Apple Vision Pro / visionOS 26.5 Simulator; Safari 26.6 remains the browser baseline.
- Deployment floor retained from the original Apple sample: iOS/iPadOS 18 and visionOS 2.

Xcode 27.0 beta 4 is also a first-class live verification lane, not a browser or launch-only canary: Xcode build `27A5228h`, Swift 6.4, xrsimulator SDK 27.0 build `24M5326e`, and visionOS 27.0 runtime build `24M5326f`. The stable 26.5 lane remains the Production compatibility baseline; the beta lane proves the same source and visionOS 2 deployment floor build and execute under the newer toolchain. Safari 27 and Reality Composer Pro 3 remain separate, unclaimed surfaces.

Authoritative references: [Xcode 26.6 release notes](https://developer.apple.com/documentation/xcode-release-notes/xcode-26_6-release-notes), [Xcode 27 release notes](https://developer.apple.com/documentation/xcode-release-notes/xcode-27-release-notes), [Swift 6.3](https://www.swift.org/blog/swift-6.3-released/), [Apple Creating a Spaceship game](https://developer.apple.com/documentation/realitykit/creating-a-spaceship-game), and [Reality Composer Pro release notes](https://developer.apple.com/documentation/realitycomposerpro/reality-composer-pro-release-notes).

## Runtime split

The browser runtime and native adapter share domain data, not renderer objects:

- Browser: Three.js WebGL2, progressive WebGPU opportunity, IndexedDB, service worker, Pointer Events, permission-gated Device Orientation.
- Native adapter: strict `Codable` manifest decoding, an `@Observable` coordinator, one deterministic RealityKit world projection, one procedural ship, value-type RealityKit flight components, a registered flight `System`, and an on-device Core Motion producer.
- Native host: the source-owned `native/App` default `.full` `ImmersiveSpace` and recovery-only `WindowGroup` consume local `GameXRNative`, embed the root-owned `shared/default-scene.json`, and own only app/immersive lifecycle, bundle metadata, fail-closed resource loading, frontend scene presentation, and UI-test wiring.
- Asset intent: GLB is the implemented browser import format. A future native resolver may project validated USD/USDC/USDZ or `.reality` variants from stable semantic IDs and hashes, but no native imported-asset resolver exists in this repository today.

The native adapter performs no imported-asset loading, so it makes no runtime claim about USD, Reality Composer Pro, or `AnimationPlaybackController` integration. Any future resolver must load asynchronously by stable ID, validate provenance and budgets before admission, and give one system ownership of each mutable transform. Shared scene assembly stays within `Entity` APIs available to both RealityKit content variants; iOS camera-content-only behavior and visionOS spatial-content-only behavior must remain isolated at their platform adapter boundaries.

## Native parity boundary

The native package and visionOS host project the canonical default deep-space source contract into one `.full` `ImmersiveSpace`. `UIApplicationPreferredDefaultSceneSessionRole` selects the immersive-space role, `UISceneInitialImmersionStyle` selects full immersion, and the `ImmersiveSpace` is declared first; there is no manual entry gate. Exiting or an external immersive-space dismissal opens the recovery window, whose only transition is **Resume GameXR**.

The versioned cross-runtime fixture verifies the complete deterministic placement stream—not selected samples—at digest `14237543821781407139`. Both adapters agree on 900 star centers, 32 asteroid instance transforms, planet placement and material targets, world bounds, ship part geometry/transforms/material targets, the four-segment 120-tick Knowgrph flight trace, procedural ship/planet/asteroid animation targets, and engine-audio waveform/frequency/gain/filter targets. The native runtime applies the same absolute throttle, brake, pause, reset, world rotation, and fixed-step flight semantics; its camera profile continues to use Knowgrph's upstream resolver. This is 100% coverage of the defined default-scene source contract.

Source-contract parity is deliberately narrower than identical rendering or complete browser-product parity. The native adapter does not duplicate browser IndexedDB persistence, local GLB admission, service-worker/offline policy, WebMCP telemetry, dynamic-resolution policy, imported animation clips, haptics, or a USD/USDC/USDZ/Reality Composer Pro asset resolver. Those remain frontend-specific capabilities or future adapters, not missing backend compatibility shims.

Native runtime readiness means all seven repository-owned gates pass: immersive source contract, Swift package tests on the host, iOS Simulator tests, visionOS cross-build, visionOS Simulator package tests, source-owned host XCUITest, and built/installed bundle verification. The UI suite cold-launches directly into the default deep-space immersive scene, confirms the entry UI is absent, reads the expected inventory, exercises throttle/flight/pause/reset telemetry, exits into recovery UI, and resumes immersion. The cross-runtime package tests cover brake semantics. Neither suite asserts compositor pixels or proves physical sensors, tracking quality, comfort, sustained performance, or physical-device behavior.

## `airvio.co/gamexr` fidelity boundary

The current source candidate passes the 40-test source suite, all eight local Playwright WebKit checks, both GameXR and Apex release checks, and the cross-runtime default-scene contract. That proves source-owned semantic parity; it does not prove pixel or framebuffer identity. The unavoidable renderer boundaries are explicit:

- Three.js `Points` is represented by small RealityKit proxy meshes at the same centers because RealityKit has no public sample-identical points primitive.
- Three.js `FogExp2` has no public RealityKit equivalent; fog values remain contract metadata rather than an identical compositor effect.
- A constant image-based light approximates Three.js ambient light, and the background is a RealityKit sphere rather than a WebGL clear color.
- RealityKit mesh storage, PBR shading, tone mapping, antialiasing, exposure, photometry, and the visionOS compositor differ from Three.js/WebGL.
- The native canopy preserves color, roughness, metalness, and opacity targets but lacks Three.js physical-material `transmission: 0.18`.
- AVFAudio implements the same engine-audio parameter targets but is not sample-identical to Web Audio DSP or automation ramps.
- The browser uses a configured monoscopic FOV/near/far chase camera; visionOS renders a stereo, head-tracked view whose final pose and projection belong to the system compositor.

Consequently, neither 100% pixel identity nor fixed-frame equality is claimed or required by the source contract.

The deployed `airvio.co/gamexr` route remains an older, unverified artifact. Its historical audit reports release source `41b2411113f968ca0bd2730deb11a2f57bd98694`, artifact digest `b3c1e8b46ba30773b57b0592742c64d48112fb7e41a4c4463445e51f412dc112`, and `productionVerified: false`; that external WebKit run passed 2 checks, failed 5, and skipped 1. Native parity targets the current source-owned GameXR contract, never Cloudflare-injected executable bytes. This task has no deployment authorization and makes no claim that the current candidate is live at `airvio.co/gamexr`.

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

- Current browser source: all 40 focused tests, all eight local Playwright WebKit checks, and both GameXR and Apex release checks pass. The WebKit profile covers responsive canvas, recoverable denial, grant/calibration/recenter/rotation lifecycle, exact cached byte/SHA-256 integrity, and a genuine offline navigation/reload against a disposable local origin. This is source evidence, not a deployed `airvio.co/gamexr` or physical-device claim.
- Swift package tests: shared manifest, complete cross-runtime placement digest, ship/flight/animation/audio targets, canonical camera admission, paused-flight lifecycle, and Apple spatial-input conformance checks run at the exact Knowgrph pin under both selected toolchains.
- iOS Simulators: the `GameXRNative` test target builds and executes under both the Xcode 26.6 and Xcode 27.0 beta 4 matrices.
- visionOS xrsimulator compile: `GameXRNative` cross-compiles for `arm64-apple-xros2.0-simulator` under both selected toolchains.
- Apple Vision Pro / visionOS 26.5 Simulator: Xcode 26.6 (`17F113`) with SDK/runtime builds `23O469`/`23O470` passes all seven native gates. Built and installed `Info.plist` bytes match at SHA-256 `3cc93a0d29d8e7061c5b61f8b70b485cec20bf2494fd1b5de363bfe54c715b12`.
- Apple Vision Pro / visionOS 27.0 Simulator: Xcode 27.0 beta 4 (`27A5228h`) with SDK/runtime builds `24M5326e`/`24M5326f` passes all seven native gates. Built and installed `Info.plist` bytes match at SHA-256 `aa6864c39e08d8c2b43a2e4734730f10cd8a5d72b0911845dbaea4db188be85d`.
- Xcode 27 live compositor receipt: Simulator UI identifies the selected destination as Apple Vision Pro / visionOS 27.0. Its **Simulated Scenes** picker has no item literally named “Default”; the unchanged current/default choice is **Living Room (Night)**. A clean direct launch produced PID `25307` and reached the native full scene without an entry window. The retained machine-local `final-live.png` is a 3,840×2,160 compositor framebuffer (387,207 bytes; SHA-256 `e442733c1874dc407f04a569f00d4742d69d4fc3df83feff4d817448624a9061`) showing the RealityKit ship, planet, asteroids, and star field with no browser or launcher surface. The final repository-owned Xcode 27 matrix records the source-owned host UI gate as compiled, executed, and passed, followed by exact built/installed bundle verification. These are transient local Simulator receipts, not portable release artifacts or pixel-parity certification.
- Physical iPhone: no attached device was available during this validation; real Safari permission, sensor quality, orientation timing, background/return, PWA installation, and thermal evidence remain pending.
- Physical Apple Vision Pro: no paired device was available; immersion comfort, tracking, control quality, and performance remain pending. The current host declares a default `.full` `ImmersiveSpace` and a recovery-only `WindowGroup`.
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
  -destination 'id=<native Apple Vision Pro simulator matching the active SDK>' \
  test
```

The final command uses a native destination selected at runtime; no device identifier belongs in source. It intentionally retains simulator signing because the UI-test app must install and launch.
