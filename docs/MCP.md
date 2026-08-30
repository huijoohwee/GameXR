# GameXR MCP and invocation contract

## Browser tools

`gamexr.inspect_runtime` is read-only. It accepts an empty object and returns `gamexr-runtime-result/v1` with flight/performance telemetry, the projected chase camera, manifest, animation clips, local owner, and zero network/model/paid-call cost. `runtime.camera` reports the frontend projection's `position`, `quaternion`, `lookTarget`, and `fieldOfViewDegrees`; it does not create a second follow-camera solver.

`gamexr.control_runtime` accepts one operation:

- `start`, `pause`, `reset`;
- `set-controls`, `clear-controls`;
- `animation-play`, `animation-pause`, `animation-scrub`, `animation-clip`, `animation-time-scale`;
- `apply-manifest-patch`, which deep-merges and then validates the complete closed manifest before mutation.

Every failure returns `status: blocked` with bounded detail and unchanged active runtime state. Asset-backed scene replacements are constructed and persisted before the renderer swaps projections; invalid animation selections are rejected before the active action stops. The tool has `openWorldHint: false`; neither tool can fetch, upload, generate, deploy, or spend.

When a browser supplies `navigator.modelContext`, GameXR registers the tools there. Otherwise it exposes a scanner-readable browser-local context on `navigator.modelContext` and `document.modelContext`, plus the same functions at `window.gameXR`.

## Central invocation boundary

Agentic Canvas OS documents are the only `/`, `@`, and `#` authority. Existing `/flight.sim @canvas #flight` and `/xr.*` commands name AgenticGraph's Canvas/WebMCP owners. GameXR must not impersonate those owners through an alias.

GameXR participates through the existing generic tool vocabulary:

```text
/tool.catalog #tool-function @tool-function
/tool.call #bridge-tool #tool-routing #approval-gate @bridge-tool @tool-function @tool-policy @cost-log
```

The host binds `@tool-function` to one exact `gamexr.*` schema and preserves its local-only policy. Direct GameXR slash routing requires a distinct canonical dictionary/MCP change through Agentic Canvas OS protected workflow; it is not created downstream in this repository.

## JavaScript inspection

```js
window.gameXR.inspect()
window.gameXR.inspect().runtime.camera
await window.gameXR.control({ operation: 'set-controls', throttle: 0.75, roll: 0.2 })
await window.gameXR.control({
  operation: 'apply-manifest-patch',
  patch: { scene: { asteroidCount: 12 } }
})
```

This API is a browser-local projection. AgenticGraph remains the follow-target and flight SSOT; GameXR exposes the resulting Three.js camera pose so local or production-targeted verification can prove the visible chase camera follows the aircraft. The API grants no filesystem, repository, Production, or Cloudflare authority.

## Device-motion permission boundary

MCP cannot grant or manufacture Safari sensor permission. An `apply-manifest-patch` may change the validated device-motion preference, the closed `airvio.apple-spatial-input/v1` shaping profile, browser-wide sensitivity/dead zone, or pitch inversion, but it does not count as the direct user gesture required by WebKit, install a listener before permission, or represent the sensor as active. The player must use the visible **Enable Motion**, **Disable Motion**, and **Recenter** controls on the GameXR surface.

Permission state, the first-sample neutral calibration, raw orientation samples, timestamps, and smoothed axes remain ephemeral UI/runtime state. `gamexr.inspect_runtime`, `window.gameXR`, scene/profile persistence, and export do not expose those values. Hidden visibility, `pagehide`, explicit disable, and runtime disposal tear down the listeners and clear transient motion state independently of any agent command.

Same-origin accelerometer/gyroscope `Permissions-Policy` and iframe delegation are deployment prerequisites, not MCP capabilities. They permit the browser to present a prompt but do not bypass the explicit user tap. Simulated browser checks of this boundary are not a physical iPhone Safari certification claim.
