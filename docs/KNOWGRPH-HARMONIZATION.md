# Knowgrph shared-utility harmonization

## Portable owner

GameXR currently owns the clean-room `airvio.apple-spatial-input/v1` reference
implementation in [`../shared/apple-spatial-input.ts`](../shared/apple-spatial-input.ts).
It contains only DOM-neutral profile validation, calibration state, screen-relative
axis mapping, jitter suppression, clamping, and elapsed-time smoothing.

Safari permission/listener lifecycle remains owned by GameXR's browser adapter.
Core Motion availability and lifecycle remain owned by `GameXRNative`. Camera,
flight, persistence, and network policy are consumers rather than shared-math
responsibilities.

## Knowgrph promotion target

The intended Knowgrph package export is
`grph-shared/spatial-input/appleSpatialInput`, backed by:

- `grph-shared/src/spatial-input/appleSpatialInput.ts`;
- `grph-shared/__tests__/apple-spatial-input.test.mjs`;
- one explicit `grph-shared/package.json#exports` entry;
- focused `grph-shared` build and conformance proof.

After admission, Knowgrph's existing device-sensor runtime can consume the pure
mapper while retaining ownership of browser permission, telemetry, and teardown.
GameXR should replace its local TypeScript copy only after the shared package is
available through the repository-owned dependency path; no alias or fallback shim
is permitted.

## Current admission boundary

On 2026-08-07, Knowgrph `origin/main` revision
`c7b7fd3954b087def061397b0e9a53fdd9d09da2` was clean and the proposed paths were
disjoint from active XR claims. Formal authoring admission nevertheless failed
closed because five registered worktrees lacked authoritative owners. The report
digest is
`990faf3bd51ed37335a8902527ed314859be241f1a6ca82c0adb4718573202ab`.

Therefore no Knowgrph checkout, branch, claim, lifecycle record, or source file was
changed. A local, unapplied promotion bundle is retained outside both repositories
at `.codex-lanes/knowgrph-apple-spatial-input-proposal/`; it must be revalidated
against the then-current protected revision after owner-led lane disposition.
