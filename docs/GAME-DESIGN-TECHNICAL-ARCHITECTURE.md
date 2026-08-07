---
title: "GameXR Game Design and Technical Architecture"
doc_type: "Game PRD and TAD"
version: "1.0.0"
status: "dev-runtime-ready"
local_rung: "runtime-ready"
delivered_rung: "undocumented"
runtime_owner: "GameXR browser-local runtime and optional GameXRNative adapter"
deploy_policy: "forbidden without exact protected candidate authorization"
---

# GameXR Game Design and Technical Architecture

## Product outcome

Player fantasy: own a responsive spacecraft and reshape its world without surrendering assets, configuration, telemetry, or money to a hosted service.

Core loop:

```text
Steer / throttle → immediate motion and visual/audio feedback → explore/configure → save locally → fly the changed world
```

Time-to-first-fun target: under 10 seconds from a warm offline launch, under 20 seconds from a cold first load on a current phone.

Must scope:

- deterministic local flight and procedural starter world;
- touch, keyboard, and permission-gated device orientation;
- complete manifest editing, local profiles, import/export;
- locally admitted GLB assets and named animation control;
- offline application shell and explicit zero-model/zero-paid-call telemetry;
- one manifest shared with a SwiftUI/RealityKit adapter.

Out of scope for this increment: multiplayer, accounts, cloud saves, paid generation, copied Apple assets, combat/economy, Production mirror mutation, and Cloudflare deployment.

## Architecture

```text
gamexr-scene/v1 manifest
        │
        ├── airvio.apple-spatial-input/v1 ── portable calibration + axis shaping
        │        ├── Safari Device Orientation permission/lifecycle adapter
        │        └── Swift Core Motion availability/lifecycle adapter
        │
        ├── Browser adapter ── Three.js renderer + fixed simulation + Web Audio
        │        ├── UI / touch / keyboard / motion
        │        ├── IndexedDB scenes + admitted GLB bytes
        │        ├── AnimationMixer + procedural animation transport
        │        └── WebMCP inspection and bounded control
        │
        └── Apple adapter ── Swift Codable + Core Motion + RealityKit ECS + SwiftUI RealityView
```

The manifest is persistent state. Renderer objects and RealityKit entities are disposable projections. No adapter may write a second scene truth.

## Game loop

| Field | Contract |
|---|---|
| Timestep | Fixed, configurable at 30/60/90/120 Hz |
| Default | 60 Hz, 16.67 ms budget |
| Catch-up | At most three simulation steps per presented frame |
| Circuit breaker | Drop surplus accumulated time; lower pixel ratio after a sustained 20% frame-budget breach |
| Render | Decoupled `requestAnimationFrame`; no background catch-up after a suspended tab |
| Determinism | Seeded procedural placement plus fixed-step input/state update |

The input component is normalized to throttle, pitch, yaw, roll, and brake. The flight system owns rotation, acceleration, drag, lateral assist, speed limits, integration, and bounded-world wrapping. The animation system owns visual-only exhaust, wing, planet, asteroid, and imported-clip playback. They do not compete for the same simulation state.

## Device-orientation input contract

Phone orientation is one optional producer of the existing normalized input frame, not a second camera or flight-system owner:

```text
Explicit Enable Motion tap
  → synchronous permission request
  → listener installation after grant
  → finite orientation sample
  → screen-rotation remap
  → first-sample neutral delta
  → elapsed-time smoothing
  → portable motion profile + browser-wide sensitivity/dead zone
  → clamped pitch/roll input
```

**Enable Motion**, **Disable Motion**, and **Recenter** remain visible on the mobile control surface. Recenter invalidates the old neutral pose and makes the next valid sample neutral; it does not mutate the scene manifest. The manifest remains the owner of device-motion enablement, the closed `airvio.apple-spatial-input/v1` profile, browser-wide sensitivity/dead zone, and pitch inversion, while permission, current neutral pose, timestamps, and filtered samples remain ephemeral runtime state.

Safari permission is requested only inside the direct user-tap handler. Sensor listeners are absent before a successful grant and are removed on explicit disable, hidden visibility, `pagehide`, or runtime disposal. The native adapter checks `NSMotionUsageDescription` and processed-device-motion availability, owns one `CMMotionManager`, and stops it on disable, inactive scene, or view disappearance. A denied, unavailable, non-finite, or stale source contributes neutral axes. Screen orientation is read as a feature and remapped without user-agent forks. Both implementations use elapsed-time smoothing rather than a fixed per-event blend so 60 Hz and higher-frequency sources converge with comparable response.

Raw samples, calibration, and filtered axes have no persistence or egress path: no IndexedDB record, scene/profile export, MCP result, fetch, beacon, socket, or analytics event contains them. Hosted `/gamexr/` responses must supply same-origin accelerometer/gyroscope `Permissions-Policy`; a parent document must also delegate those features when GameXR is embedded. Those headers expose capability only and never bypass the user grant.

Knowgrph protected revision `1288749a170e1e5790fccd4130e8f76562370745` is the backend SSOT for explicit permission, listener-after-grant, lifecycle cancellation, neutral calibration, input shaping, deterministic flight, camera target projection, and RealityKit flight. GameXR owns only frontend visual projection and manifest-to-profile adapters.

## Asset pipeline

```text
User GLB → header/JSON preflight → URI/range/accessor/image budgets → SHA-256 → decode → post-decode budget inspection → normalize → IndexedDB → renderer
```

Admission ceilings:

| Dimension | Ceiling |
|---|---:|
| File | 15 MB |
| Nodes | 1,500 |
| Triangles | 250,000 |
| Lights | 4 |
| Named animation clips | 32 |
| Clip duration | 300 seconds |
| Embedded images | 16; 4 MB each; 4,096 px per side; 16.8 MP total |

Every imported asset is recorded as `user-local`, `local-use-only-unverified`, and `unreviewed`. Those assets are eligible for local play only, never Production promotion. The shipped procedural asset is source code under the repository license.

## Performance and delivery budgets

| Dimension | Target | Gate |
|---|---:|---|
| Initial compressed JavaScript | ≤ 220 kB | `npm run release:check` |
| Individual generated JS chunk | < 500 kB | `npm run release:check` |
| Default draw complexity | one instanced asteroid mesh; one points field | browser inspection |
| Default asteroid count | 32 | manifest validation |
| Maximum device pixel ratio | 2; default 1.5 | manifest validation |
| Simulation catch-up | 1–5; default 3 | manifest validation |
| Network needed after install | zero | service-worker browser smoke |
| Model / paid calls | zero | WebMCP + readiness output |

## Storage and failure behavior

- IndexedDB owns scenes, metadata, and GLB bytes. The app requests persistent storage only from an explicit interaction and never assumes it was granted.
- A corrupt saved manifest is preserved but not activated. The default scene opens with a visible warning.
- A missing or invalid active GLB blocks scene activation without replacing the currently running scene; there is no silent procedural fallback.
- GPU geometry, materials, textures, animation actions, renderer resources, event listeners, observers, audio nodes, and database handles are explicitly released.
- WebGL context loss is visible and stops simulation until a rebuild succeeds.

## Economics

| Cost | Runtime value |
|---|---:|
| Model calls | 0 |
| Prompt/completion tokens | 0 |
| Paid API calls | 0 |
| Required hosted state | 0 |
| Default third-party media bytes | 0 |

The only runtime infrastructure is the static application origin. Local assets and configuration remain on device.

## Readiness

| Surface | Status | Evidence |
|---|---|---|
| Manifest and headless core | Runtime-ready in Dev | TypeScript checks and focused tests |
| `/gamexr/` and Apex bundles | Runtime-ready in Dev | deterministic release check and browser smoke |
| Portable Apple spatial-input contract | Conformance-tested in Dev | closed JSON Schema plus matching TypeScript/Swift rotation and smoothing vectors |
| Safari orientation adapter | Source/simulated-event ready in Dev | permission, calibration, rotation, cleanup, and no-egress checks; named physical iPhone proof still required |
| iOS RealityKit/Core Motion package | Build-verified | Xcode 26.6 / iOS Simulator SDK 26.5; physical sensor proof still required |
| visionOS RealityKit/Core Motion package | Build-verified | Xcode 26.6 / xrsimulator SDK 26.5; physical headset proof still required |
| Production mirror | Deferred | no protected GameXR projection owner |
| Cloudflare routes | Deferred | no exact-candidate authorization or live verification |
