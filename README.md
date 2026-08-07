# GameXR

GameXR is a browser-local spatial flight runtime rebuilt from the useful control ideas in Apple's *Creating a Spaceship game* sample. It does not copy the sample's code, audio, or 3D assets. The default ship, world, motion, animation, and audio are generated locally from original code and one versioned scene manifest.

The result is mobile-first, installable, offline-capable, user-configurable, and zero-spend at runtime. A Swift 6 / SwiftUI / RealityKit package consumes the same JSON contract for native iOS and visionOS integration.

The versioned `airvio.apple-spatial-input/v1` contract makes calibration, screen-relative axis mapping, jitter suppression, and elapsed-time smoothing portable across browser and Swift frontends. Knowgrph is the shared backend SSOT: GameXR consumes its browser sensor, filter, flight, camera, Swift Core, and RealityKit flight products at protected revision `1288749a170e1e5790fccd4130e8f76562370745`.

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

GameXR installs orientation listeners only after the explicit permission request succeeds. The first valid sample becomes the neutral pose; subsequent samples are remapped when the screen rotates, smoothed by elapsed time, and shaped by the user-configurable `motion.deviceOrientation` profile before they reach normalized flight/camera input. Recenter deliberately takes a new neutral sample instead of assuming one fixed holding angle. The portable profile is closed and range-validated by the schema exported from `@knowgrph/apple-spatial-input`; builds project that canonical schema to `schemas/apple-spatial-input.schema.json`.

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

- `gamexr.inspect_runtime` — read-only manifest, telemetry, performance, and zero-cost evidence.
- `gamexr.control_runtime` — bounded transport, control, animation, and validated manifest-patch operations.

These tools register with `navigator.modelContext` when a host provides it and remain scanner-readable locally when it does not. Agentic Canvas OS already owns `/flight.sim @canvas #flight`, so GameXR does not alias that Knowgrph route. Generic centralized discovery and execution use `/tool.catalog` and `/tool.call`; see [`docs/MCP.md`](docs/MCP.md).

## Apple adapter

[`native/Package.swift`](native/Package.swift) provides `GameXRNative`, a Swift 6 library with:

- the same `Codable` scene manifest;
- the same `airvio.apple-spatial-input/v1` calibration and filtering semantics as Safari;
- RealityKit components and a fixed-step `System`;
- a SwiftUI `RealityView` with touch and Core Motion controls;
- iOS 18 and visionOS 2 deployment floors, compiled with stable Xcode 26.6 / SDK 26.5.

```sh
npm run native:check
```

A host app must provide a meaningful `NSMotionUsageDescription`; the adapter fails closed when that key or processed device motion is unavailable. A future native resolver can admit Reality Composer Pro content behind reviewed semantic IDs; the current native target is an explicitly bounded procedural adapter. Beta-only Reality Composer Pro 3 and OS 27 APIs are not production dependencies. See [`docs/APPLE-COMPATIBILITY.md`](docs/APPLE-COMPATIBILITY.md).

The immutable Knowgrph dependency and frontend/backend boundary are recorded in [`docs/KNOWGRPH-HARMONIZATION.md`](docs/KNOWGRPH-HARMONIZATION.md).

## Verify

```sh
npm run check
npm run check:apex
npm run test:webkit
npm run native:check
```

`npm run check` type-checks, runs focused tests, creates the `/gamexr/` production bundle, seals a deterministic local artifact manifest, and enforces chunk, initial-payload, schema, offline-shell, and zero-spend contracts.

The `/gamexr/` build registers a content-addressed service worker that precaches every emitted JavaScript, CSS, and dynamic chunk. Apex mode deliberately disables service-worker registration because `/` is shared production scope; `npm run dev:apex` remains useful for local route parity, but it is not an offline-install claim.

## Release boundary

Dev output is written to `dist/gamexr`. It is not a Production or Cloudflare authorization. The protected production mirror at `huijoohwee/content/gamexr` owns publication, and the Git-connected `joohwee` Pages project is the single forward-deployment owner. GameXR source never writes that mirror or deploys `airvio.co` directly.

[`docs/RELEASE.md`](docs/RELEASE.md) records the protected projection, preview, exact authorization, Git deployment, smoke, and rollback contract. Production is live at `/gamexr`; physical iPhone and Vision Pro certification remains a separate promotion gate.
