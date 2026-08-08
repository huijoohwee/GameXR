# Knowgrph shared-utility harmonization

Knowgrph is the backend SSOT for Apple spatial input, deterministic flight, and follow-camera projection. GameXR differs only in frontend visuals, interaction presentation, scene configuration, and local persistence.

## Immutable consumer pins

- Protected Knowgrph revision: `1288749a170e1e5790fccd4130e8f76562370745`.
- Browser package: `@knowgrph/apple-spatial-input@0.1.0`, stored as `vendor/knowgrph-apple-spatial-input-0.1.0.tgz`.
- Artifact SHA-256: `d3c91d63751332cdfdc7dc4a856896e714b3985093538578227a7b2431f06e17`.
- SwiftPM products: `KnowgrphSpatialCore` and `KnowgrphRealityKitFlight`, resolved at the same protected revision.

## Ownership boundary

Knowgrph owns permission-safe Safari sensor lifecycle, calibration/filter math, input normalization, deterministic flight integration, follow-camera target resolution, Swift spatial core, and RealityKit flight integration. GameXR adapters translate its user-configurable scene manifest into those canonical profiles and project results into Three.js, SwiftUI, and RealityView visuals.

GameXR's runtime/WebMCP inspection may report the actual Three.js chase-camera `position`, `quaternion`, `lookTarget`, and `fieldOfViewDegrees`. Those fields observe the frontend projection after Knowgrph resolves the follow target; they do not duplicate, patch, or supersede Knowgrph camera behavior.

GameXR contains no duplicate Apple filter, browser sensor lifecycle, flight integrator, follow-camera resolver, RealityKit flight system, or canonical schema source. The build copies the installed package schema into the release output; it does not maintain a downstream fork.

The source-owned windowed visionOS host owns `WindowGroup` lifecycle, `Info.plist`, canonical-manifest resource bundling, an explicit planar presentation container, and UI-test wiring only. Its backend dependency is local `GameXRNative`, whose workspace resolution retains the same immutable Knowgrph revision. The host introduces no second manifest, asset resolver, spatial-input implementation, flight model, camera resolver, or RealityKit flight system. Pause removes the control component from Knowgrph's system query instead of adding a downstream integrator; Fly restores that canonical-system admission.

## Update procedure

Admit a new protected Knowgrph revision first, regenerate the npm tarball, verify its digest, update both npm and SwiftPM pins together, then run `npm run check`, `npm run check:apex`, and `npm run native:check`. Do not float either dependency or add compatibility aliases.
