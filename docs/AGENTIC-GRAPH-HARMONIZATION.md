# AgenticGraph shared-utility harmonization

AgenticGraph is the backend SSOT for Apple spatial input, deterministic flight, and follow-camera projection. GameXR differs only in frontend visuals, interaction presentation, scene configuration, and local persistence.

## Immutable consumer pins

- Protected AgenticGraph revision: `19f9da8bc537b782e23ae7669c4a919d94171529`.
- Browser package: `@agenticgraph/apple-spatial-input@0.1.0`, stored as `vendor/agenticgraph-apple-spatial-input-0.1.0.tgz`.
- Apple archive SHA-256: `06ce0ee14b53a97f5981df38d66f0b83bdb0aedd8b54a313b02aa47ca4a7028b`.
- `grph-shared` archive SHA-256: `12b943cd79be56c258b3fd4a97dac1c0db7ffc334719942376fb5f3c38ad5363`.

## Vendor provenance

Both archives are built from independent clean extractions of protected AgenticGraph revision `19f9da8bc537b782e23ae7669c4a919d94171529` with Node 24.15.0 and npm 11.12.1. Each extraction builds the canonical package and runs `npm pack --ignore-scripts`; the two Apple archives and the two `grph-shared` archives must compare byte-identically before either artifact enters `vendor`.

[`tests/vendor-archives.test.ts`](../tests/vendor-archives.test.ts) parses every tar member name, scans every raw member payload, rejects the retired and intermediate identities plus product-prefixed legacy constants, and binds each archive byte-for-byte to its npm lock integrity.

## Pending protected-source projection

The physical SwiftPM provider URL remains `https://github.com/huijoohwee/knowgrph.git`, and SwiftPM therefore retains the derived package identity `knowgrph`. Those two immutable provider carriers do not define the product identity. `native/Package.swift`, the generated `native/Package.resolved`, source imports, product references, component symbols, browser package, and both vendored archives bind the same protected AgenticGraph revision and canonical `AgenticGraph*` product surface.

## Ownership boundary

AgenticGraph owns permission-safe Safari sensor lifecycle, calibration/filter math, input normalization, deterministic flight integration, follow-camera target resolution, Swift spatial core, and RealityKit flight integration. GameXR adapters translate its user-configurable scene manifest into those canonical profiles and project results into Three.js, SwiftUI, and RealityView visuals.

GameXR's runtime/WebMCP inspection may report the actual Three.js chase-camera `position`, `quaternion`, `lookTarget`, and `fieldOfViewDegrees`. Those fields observe the frontend projection after AgenticGraph resolves the follow target; they do not duplicate, patch, or supersede AgenticGraph camera behavior.

GameXR contains no duplicate Apple filter, browser sensor lifecycle, flight integrator, follow-camera resolver, RealityKit flight system, or canonical schema source. The build copies the installed package schema into the release output; it does not maintain a downstream fork.

The source-owned visionOS host owns the default `.full` `ImmersiveSpace`, recovery-only `WindowGroup`, scene-role `Info.plist`, canonical-manifest resource bundling, deterministic frontend world projection, and UI-test wiring only. Its backend dependency is local `GameXRNative`, whose workspace resolution retains the same immutable AgenticGraph revision. The immersive root contains one visual world and one AgenticGraph-controlled ship; the host introduces no second manifest, asset resolver, spatial-input implementation, flight model, camera resolver, or RealityKit flight system. The host forwards Pause, Fly, absolute throttle, Brake, and Reset actions to the coordinator.

The versioned cross-runtime fixture verifies the complete default-world placement stream at digest `14237543821781407139` plus ship, four-segment 120-tick AgenticGraph flight, procedural-animation, and engine-audio target contracts in TypeScript and Swift. That evidence preserves AgenticGraph ownership: GameXR supplies frontend projection and test vectors, while the canonical integrator, camera resolver, and RealityKit flight system remain upstream. The native camera adapter continues to map the manifest into that upstream resolver. The fixture proves source-contract parity, not identical Three.js/RealityKit pixels, Web Audio/AVFAudio samples, or browser/deployed-product parity.

## Update procedure

Admit a new protected AgenticGraph revision first, regenerate both npm-compatible tarballs twice from that exact revision, verify byte identity and digests, update both npm and SwiftPM pins together, regenerate `native/Package.resolved`, then run `npm run check`, `npm run check:apex`, and `npm run native:check`. Do not float either dependency or add compatibility aliases.
