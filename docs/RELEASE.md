# GameXR release contract

## Current boundary

`npm run build` creates a production-shaped `/gamexr/` artifact under `dist/gamexr`. Its generated precache manifest covers every emitted runtime JavaScript, CSS, and dynamic chunk except the service worker itself. The emitted worker binds the exact precache digest, so every changed release is discoverable without a circular self-hash. The worker recomputes that aggregate and validates every declared response's byte count and SHA-256 before marking a full-digest cache ready; it never mutates the sealed cache with an unverified navigation or runtime response. `npm run build:apex` creates the root-base variant under `dist/apex`, but compile-time gating disables service-worker registration at `/` because that is shared production scope. `release:prepare` records Git head/worktree state, emits a content-addressed manifest, and explicitly keeps `deploymentAuthorized: false`.

GameXR source does not write `huijoohwee/content/gamexr` or mutate the Cloudflare project. The `agentic-graph` protected `.github/workflows/release.yml` owns deployment, rollback, verification, and subsequent generated publication into `huijoohwee` for the shared `joohwee` Pages project. Its `runtime:pages:owner-enforce` command disables Git production and preview deployments before Direct Upload. This is the same owner named by `huijoohwee/AGENTS.md`; a mirror merge does not deploy GameXR. A historical release is live at `/gamexr`; its receipt remains external to this source repository.

## Required controller stages

1. Require a committed exact GameXR source revision and successful repository checks.
2. Rebuild in a clean source-bound environment and verify `release-manifest.json` digest.
3. Submit the sealed artifact, exact source revision, and validation evidence to the Graph release owner. Its candidate assembly must bind those inputs and project only the reviewed GameXR artifact into `content/gamexr`, preserving all sibling applications. If that admission path is unavailable, retain the candidate until the owner supports it; a manual mirror edit is not a substitute.
4. Merge generated routing/header fragments at their Graph-owned root projection. The root projection must replace inherited policy headers, prevent response transformation, revalidate shell metadata/service-worker bytes, and keep hashed assets immutable.
5. Require Pages Web Analytics to remain disabled before deployment. Its project-level beacon injection precedes `_headers`, mutates the sealed HTML, and is therefore incompatible with exact-byte verification.
6. Let the protected release owner prepare and validate the complete source-bound candidate and rollback identity. Do not rely on a Git-connected preview or dispatch a second deployment.
7. Require exact-candidate human authorization in the owner's protected Production environment before forward effects.
8. Let that owner deploy the reviewed artifact through Direct Upload and verify the immutable production origin, `airvio.co/gamexr/`, returning-user service-worker convergence, browser WebMCP schemas, asset digest parity, and preserved sibling routes. It restores the prior Pages deployment on failure.
9. Publish the verified generated mirror only after live smoke succeeds, through the same owner's existing publication path. Record source, artifact, deployment, verification, and publication identities separately.

The Apex production route requires a separate explicit routing decision because `airvio.co/` is shared public estate. A working `npm run dev:apex` does not grant that authority.

## Required Cloudflare fragments

The Graph root projection owner consumes reviewed equivalents of [`../deployment/cloudflare/redirects.fragment`](../deployment/cloudflare/redirects.fragment) and [`../deployment/cloudflare/headers.fragment`](../deployment/cloudflare/headers.fragment). These are source inputs, not self-executing deployment files.

## Production verification

- `/gamexr/`, `manifest.webmanifest`, `sw.js`, `precache-manifest.json`, readiness JSON, scene and Apple spatial-input schemas, and every hashed chunk return the expected MIME type and digest.
- every release artifact byte count and SHA-256 hash recomputes to the aggregate release digest; the precache digest independently covers its complete entry set, and the installed cache independently validates every listed response before its ready marker is written.
- HTML is `no-store`, `no-cache`, and `no-transform`; `sw.js`, manifests, readiness, and schemas are revalidated without transformation; hashed assets are immutable and `no-transform`; no response contains a Cloudflare analytics beacon or any other injected executable.
- motion/XR and same-origin camera permissions are delegated at the root owner. GameXR does not call `getUserMedia`, persist camera frames, or claim physical-camera capture.
- initial compressed JavaScript remains under 220 kB and each chunk below 500 kB.
- first online load, a genuinely offline navigation/reload, iOS Safari touch/motion/audio, and visionOS Safari presentation pass.
- `gamexr.inspect_runtime` and `gamexr.control_runtime` match the shipped schemas with zero egress/spend; inspection exposes the projected chase-camera position, quaternion, look target, and FOV.
- public status remains `productionVerified: false` until the named physical-device matrices pass; deployment and browser/simulator verification are recorded separately.

Run the browser matrix against the exact preview, immutable origin, and public route without starting a local server:

```sh
GAME_XR_E2E_URL=https://airvio.co/gamexr/ \
GAME_XR_EXPECTED_SOURCE_REVISION=<protected-merge-sha> \
GAME_XR_EXPECTED_ARTIFACT_DIGEST=<sealed-artifact-digest> \
npm run test:webkit
```

This external receipt covers shipped artifact hashes, online service-worker/cache convergence, and WebMCP camera telemetry. The separate local WebKit test stops a disposable same-origin server to prove genuine offline navigation/reload; the external run intentionally leaves preview and Production origins online. Neither test certifies real sensor permission, Core Motion, haptics, audio routing, installed-PWA lifecycle, comfort, or sustained performance on physical Apple hardware.
