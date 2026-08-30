# GameXR

GameXR is a browser-local spatial flight runtime rebuilt from the useful control ideas in Apple's *Creating a Spaceship game* sample. It does not copy the sample's code, audio, or 3D assets. The default ship, world, motion, animation, and audio are generated locally from original code and one versioned scene manifest.

The result is mobile-first, installable, offline-capable, user-configurable, and zero-spend at runtime. A Swift 6 / SwiftUI / RealityKit package consumes the same JSON contract for native iOS and visionOS integration.

The versioned `airvio.apple-spatial-input/v1` contract makes calibration, screen-relative axis mapping, jitter suppression, and elapsed-time smoothing portable across browser and Swift frontends. AgenticGraph is the shared backend SSOT: GameXR consumes its browser sensor, filter, flight, camera, Swift Core, and RealityKit flight products at protected revision `19f9da8bc537b782e23ae7669c4a919d94171529`.

## Run

Requirements: Node.js 20.19+ or 22.12+.

```sh
npm install
npm run dev
```

Normal Dev serves the production-shaped `/gamexr/` base path. The root/Apex mode is separate:

```sh
npm run dev:apex
```

Controls:

- Touch or pointer: left joystick for pitch/roll/yaw, throttle rail to add or reduce thrust, Brake to command idle thrust.
- Keyboard: `W/S` pitch, `A/D` roll, `Q/E` yaw, `Shift` adds thrust, `X` reduces thrust, and `Space` commands idle thrust.
- Motion: tap **Enable Motion** to request iOS permission from the required direct user gesture. **Recenter** makes the next valid sample the neutral pose; **Disable Motion** releases the listeners.

Select **Tune** to edit high-value controls or the complete `gamexr-scene/v1` manifest. Scene profiles, configuration, and admitted GLB files stay in IndexedDB. JSON export is the portable recovery path.

### Phone orientation contract

GameXR installs orientation listeners only after the explicit permission request succeeds. The first valid sample becomes the neutral pose; subsequent samples are remapped when the screen rotates, smoothed by elapsed time, and shaped by the user-configurable `motion.deviceOrientation` profile before they reach normalized flight/camera input. Recenter deliberately takes a new neutral sample instead of assuming one fixed holding angle. The portable profile is closed and range-validated by the schema exported from `@agenticgraph/apple-spatial-input`; builds project that canonical schema to `schemas/apple-spatial-input.schema.json`.

Motion stops and clears its transient calibration on **Disable Motion**, hidden-page transition, `pagehide`, or runtime disposal. Raw orientation samples and calibration remain memory-only: they are not written to IndexedDB, included in scene export, returned through MCP, or sent over the network. A deployed origin must serve a same-origin `Permissions-Policy` for the required motion features, and every embedding iframe must delegate them explicitly.

Focused source and simulated-event checks can verify this lifecycle, but they are not physical-device evidence. A named current iPhone/Safari run must still verify the real permission prompt, portrait and both landscape rotations, Recenter, background/return behavior, and sustained control quality before GameXR claims iPhone Safari certification.

## What is configurable

The shared manifest at [`shared/default-scene.json`](shared/default-scene.json) owns:

- environment, colors, fog, lighting, planet, stars, asteroid field, and world bounds;
- procedural or local GLB ship, transform, material parameters, and flight dynamics;
- camera, keyboard/touch/device-motion input, animation transport, procedural motion, audio, and quality budgets.

Local GLB admission is fail-closed: one self-contained GLB, at most 15 MB, 1,500 nodes, 250,000 triangles, four lights, 32 named clips, and no external resource URI. Accessors, buffer ranges, sparse data, and decoded image budgets are checked before Three.js decoding, then inspected again after decode. Imported bytes never enter the repository or a network request.

## Browser MCP

The page exposes:

- `gamexr.inspect_runtime` — read-only manifest, flight/performance telemetry, projected chase-camera pose/FOV, and zero-cost evidence.
- `gamexr.control_runtime` — bounded transport, control, animation, and validated manifest-patch operations.

These tools register with `navigator.modelContext` when a host provides it and remain scanner-readable locally when it does not. Agentic Canvas OS already owns `/flight.sim @canvas #flight`, so GameXR does not alias that AgenticGraph route. Generic centralized discovery and execution use `/tool.catalog` and `/tool.call`; see [`docs/MCP.md`](docs/MCP.md).

## Apple adapter

[`native/Package.swift`](native/Package.swift) provides `GameXRNative`, a Swift 6 library for iOS and visionOS with:

- the same `Codable` scene manifest;
- the same `airvio.apple-spatial-input/v1` calibration and filtering semantics as Safari;
- RealityKit components and a fixed-step `System`;
- a SwiftUI `RealityView` with touch and Core Motion controls;
- iOS 18 and visionOS 2 deployment floors, retained across stable Xcode 26.6 / SDK 26.5 and Xcode 27.0 beta 4 / SDK 27.0.

[`native/App/GameXRVisionApp.xcodeproj`](native/App/GameXRVisionApp.xcodeproj) is the repository-owned visionOS host. Its information property list selects `UISceneSessionRoleImmersiveSpaceApplication` as the preferred default scene role and `UIImmersionStyleFull` as the initial style, so a cold app launch enters the first SwiftUI `.full` `ImmersiveSpace` directly without an entry window or **Enter Full Scene** gate. A suppressed-by-role `WindowGroup` exists only as recovery UI after the person exits or the system dismisses the space. The host embeds the canonical [`shared/default-scene.json`](shared/default-scene.json), fails closed if it is missing or invalid, and projects one deterministic world root containing the configured background, 900-star field, 32-asteroid field, planet, light, and one AgenticGraph-driven ship. The cross-runtime fixture fixes the complete default placement stream at digest `14237543821781407139` and verifies the ship, AgenticGraph flight trace, procedural animation, and engine-audio target contracts in both TypeScript and Swift. The host contains no WebView, browser wrapper, second flight integrator, chase camera, or asset resolver.

```sh
npm run native:check
```

On a matching native Apple Vision Pro simulator, this check runs seven gates: the immersive source contract, host Swift package tests, iOS Simulator tests, visionOS cross-build, visionOS Simulator package tests, host XCUITest, and built/installed bundle verification. Both exact matrices pass all seven gates: stable Xcode 26.6 build `17F113` with visionOS SDK/runtime builds `23O469`/`23O470`, and Xcode 27.0 beta 4 build `27A5228h` with visionOS SDK/runtime builds `24M5326e`/`24M5326f`. The built and installed `Info.plist` hashes match within each lane: `3cc93a0d29d8e7061c5b61f8b70b485cec20bf2494fd1b5de363bfe54c715b12` on stable and `aa6864c39e08d8c2b43a2e4734730f10cd8a5d72b0911845dbaea4db188be85d` on beta.

This is 100% coverage of the defined default-scene source contract, not pixel or framebuffer identity. Three.js points, exponential fog, physical-material transmission, Web Audio, its monoscopic camera, and its WebGL renderer do not have sample-identical RealityKit, AVFAudio, stereo head-tracked camera, or visionOS compositor outputs. See [`docs/APPLE-COMPATIBILITY.md`](docs/APPLE-COMPATIBILITY.md) for the explicit fidelity boundary.

The repository host supplies a meaningful `NSMotionUsageDescription`; any additional host must do the same. The adapter fails closed when that key or processed device motion is unavailable. A future native resolver can admit Reality Composer Pro content behind reviewed semantic IDs; the current native target is an explicitly bounded procedural adapter. Out-of-baseline Reality Composer Pro 3 and OS 27 APIs are not Production dependencies. See [`docs/APPLE-COMPATIBILITY.md`](docs/APPLE-COMPATIBILITY.md).

The immutable AgenticGraph dependency and frontend/backend boundary are recorded in [`docs/AGENTIC-GRAPH-HARMONIZATION.md`](docs/AGENTIC-GRAPH-HARMONIZATION.md).

## Verify

```sh
npm run check
npm run check:apex
npm run test:webkit
npm run native:check
```

The current source candidate passes all 40 focused tests, all eight local WebKit checks, and both `/gamexr/` and Apex release checks. `npm run check` type-checks, runs the focused tests, creates the `/gamexr/` production bundle, seals a deterministic local artifact manifest, and enforces chunk, initial-payload, schema, offline-shell, and zero-spend contracts.

The `/gamexr/` build registers a full-build-digest-addressed service worker. The emitted worker binds that exact digest, so an assets-only release still produces a discoverable worker revision without placing the worker inside its own circular precache hash. Before a cache becomes ready, the worker validates the precache aggregate, exact cache inventory, and every declared response's byte count and SHA-256. The sealed cache is never overwritten by an unverified navigation or runtime fetch. Local Playwright WebKit uses a disposable origin to verify cache hashes and genuine origin-outage navigation/reload. Exact external runs verify shipped bytes and online service-worker/cache convergence without disrupting the deployed origin. Neither automated browser proof is physical-device certification. Apex mode deliberately disables service-worker registration because `/` is shared production scope; `npm run dev:apex` remains useful for local route parity, but it is not an offline-install claim.

After a protected candidate is projected to a preview or Production origin, target that exact deployment without starting localhost:

```sh
GAME_XR_E2E_URL=https://airvio.co/gamexr/ \
GAME_XR_EXPECTED_SOURCE_REVISION=<protected-merge-sha> \
GAME_XR_EXPECTED_ARTIFACT_DIGEST=<sealed-artifact-digest> \
npm run test:webkit
```

This verifies shipped bytes, online service-worker/cache convergence, browser WebMCP, and chase-camera telemetry. Genuine origin-outage navigation/reload is proven by the local disposable-origin test; an external run intentionally does not take a preview or Production origin offline. Neither command grants release authority or replaces physical iPhone and Vision Pro testing.

## Release boundary

Dev output is written to `dist/gamexr`. It is not a Production or Cloudflare authorization. The protected production mirror at `huijoohwee/content/gamexr` owns publication, and the Git-connected `joohwee` Pages project is the single forward-deployment owner. GameXR source never writes that mirror or deploys `airvio.co` directly.

[`docs/RELEASE.md`](docs/RELEASE.md) records the protected projection, preview, exact authorization, Git deployment, smoke, and rollback contract. A historical deployment is live at `/gamexr`, but this current candidate is neither release-authorized nor exact-candidate live-verified. Physical iPhone and Vision Pro certification remains a separate promotion gate.
