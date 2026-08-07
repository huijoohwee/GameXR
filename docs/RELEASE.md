# GameXR release contract

## Current boundary

`npm run build` creates a production-shaped `/gamexr/` artifact under `dist/gamexr`. Its generated precache manifest covers every emitted runtime JavaScript, CSS, and dynamic chunk except the service worker itself. The emitted worker binds the exact precache digest, so every changed release is discoverable without a circular self-hash. The worker recomputes that aggregate and validates every declared response's byte count and SHA-256 before marking a full-digest cache ready; it never mutates the sealed cache with an unverified navigation or runtime response. `npm run build:apex` creates the root-base variant under `dist/apex`, but compile-time gating disables service-worker registration at `/` because that is shared production scope. `release:prepare` records Git head/worktree state, emits a content-addressed manifest, and explicitly keeps `deploymentAuthorized: false`.

GameXR source does not write `huijoohwee/content/gamexr` or mutate the Cloudflare project. The protected `huijoohwee` mirror and its Git-connected `joohwee` Pages project own Production. The first authorized release is live at `/gamexr`; its receipt remains external to this source repository.

## Required controller stages

1. Require a committed exact GameXR source revision and successful repository checks.
2. Rebuild in a clean source-bound environment and verify `release-manifest.json` digest.
3. Project only `dist/gamexr` into `huijoohwee/content/gamexr` through an isolated mirror pull request.
4. Merge generated routing/header fragments at their root owner; never hand-edit stale downstream copies. The root projection must replace inherited `Permissions-Policy`, prevent response transformation, revalidate shell metadata/service-worker bytes, and keep hashed assets immutable.
5. Let the existing Git-connected Pages integration create the pull-request preview; never dispatch a second Wrangler deployment for the same candidate.
6. Verify preview origin hashes and browser behavior, then stop for exact-candidate human authorization.
7. Merge the protected mirror pull request. The Git integration is the only forward production deployment owner.
8. Verify the resulting immutable production origin, `airvio.co/gamexr/`, returning-user service-worker convergence, browser WebMCP schemas, and asset digest parity. Restore the prior Pages deployment on failure.

The Apex production route requires a separate explicit routing decision because `airvio.co/` is shared public estate. A working `npm run dev:apex` does not grant that authority.

## Required Cloudflare fragments

The future root routing owner should merge the reviewed equivalents of [`../deployment/cloudflare/redirects.fragment`](../deployment/cloudflare/redirects.fragment) and [`../deployment/cloudflare/headers.fragment`](../deployment/cloudflare/headers.fragment). These are source inputs, not self-executing deployment files.

## Production verification

- `/gamexr/`, `manifest.webmanifest`, `sw.js`, `precache-manifest.json`, readiness JSON, scene and Apple spatial-input schemas, and every hashed chunk return the expected MIME type and digest.
- every release artifact byte count and SHA-256 hash recomputes to the aggregate release digest; the precache digest independently covers its complete entry set, and the installed cache independently validates every listed response before its ready marker is written.
- HTML is `no-store`, `no-cache`, and `no-transform`; `sw.js`, manifests, readiness, and schemas are revalidated without transformation; hashed assets are immutable and `no-transform`.
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
