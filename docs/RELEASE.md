# GameXR release contract

## Current boundary

`npm run build` creates a production-shaped `/gamexr/` artifact under `dist/gamexr`. Its generated precache manifest covers every emitted runtime JavaScript, CSS, and dynamic chunk. `npm run build:apex` creates the root-base variant under `dist/apex`, but compile-time gating disables service-worker registration at `/` because that is shared production scope. `release:prepare` records Git head/worktree state, emits a content-addressed manifest, and explicitly keeps `deploymentAuthorized: false`.

GameXR source does not write `huijoohwee/content/gamexr` or mutate the Cloudflare project. The protected `huijoohwee` mirror and its Git-connected `joohwee` Pages project own Production. The first authorized release is live at `/gamexr`; its receipt remains external to this source repository.

## Required controller stages

1. Require a committed exact GameXR source revision and successful repository checks.
2. Rebuild in a clean source-bound environment and verify `release-manifest.json` digest.
3. Project only `dist/gamexr` into `huijoohwee/content/gamexr` through an isolated mirror pull request.
4. Merge generated routing/header fragments at their root owner; never hand-edit stale downstream copies.
5. Let the existing Git-connected Pages integration create the pull-request preview; never dispatch a second Wrangler deployment for the same candidate.
6. Verify preview origin hashes and browser behavior, then stop for exact-candidate human authorization.
7. Merge the protected mirror pull request. The Git integration is the only forward production deployment owner.
8. Verify the resulting immutable production origin, `airvio.co/gamexr/`, returning-user service-worker convergence, browser WebMCP schemas, and asset digest parity. Restore the prior Pages deployment on failure.

The Apex production route requires a separate explicit routing decision because `airvio.co/` is shared public estate. A working `npm run dev:apex` does not grant that authority.

## Required Cloudflare fragments

The future root routing owner should merge the reviewed equivalents of [`../deployment/cloudflare/redirects.fragment`](../deployment/cloudflare/redirects.fragment) and [`../deployment/cloudflare/headers.fragment`](../deployment/cloudflare/headers.fragment). These are source inputs, not self-executing deployment files.

## Production verification

- `/gamexr/`, `manifest.webmanifest`, `sw.js`, `precache-manifest.json`, readiness JSON, scene and Apple spatial-input schemas, and every hashed chunk return the expected MIME type and digest.
- every release artifact byte count and SHA-256 hash recomputes to the aggregate release digest; the precache digest independently covers its complete entry set.
- HTML is no-cache; `sw.js`, manifest, and readiness are revalidated; hashed assets are immutable.
- motion/XR and same-origin camera permissions are delegated at the root owner. GameXR does not call `getUserMedia`, persist camera frames, or claim physical-camera capture.
- initial compressed JavaScript remains under 220 kB and each chunk below 500 kB.
- first online load, offline reload, iOS Safari touch/motion/audio, and visionOS Safari presentation pass.
- `gamexr.inspect_runtime` and `gamexr.control_runtime` match the shipped schemas with zero egress/spend.
- public status remains `productionVerified: false` until the named physical-device matrices pass; deployment and browser/simulator verification are recorded separately.
