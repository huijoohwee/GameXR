---
title: "GameXR saved scene review — reference implementation"
doc_type: "PRD-TAD-ADR-MVP-GTM"
version: "0.1.0"
date: "2026-09-26"
lang: "en-US"
continuity_id: "GAMEXR-SCENE-REVIEW-001"
prd_revision: "0.1.0"
tad_revision: "0.1.0"
adr_revision: "0.1.0"
mvp_revision: "0.1.0"
gtm_revision: "0.1.0"
parent_continuity: "SPATIAL-GAMEXR-001@0.3.0"
frontmatter_contract: "required"
local_rung: "dev-proven"
delivered_rung: "undocumented"
lifecycle_status: "in-progress"
lane: "authoring"
load_policy: "on-demand"
worktree_id: "device-cba000d3779d--spatial-review"
agent_id: "codex-01a0dba4"
guidelines_ref: "huijoohwee.github.io/guidelines/prd-tad-adr-mvp-gtm-guidelines.md@2.7.0"
---

# GameXR saved scene review — reference implementation

All five roles join **GAMEXR-SCENE-REVIEW-001@0.1.0**, the GameXR implementation companion of
Graph's **SPATIAL-GAMEXR-001@0.3.0**. This companion refines its GX1–GX6/T1–T4/A1–A4 criteria
without changing those owners. `/change #spatial-review-integrate @codex-01a0dba4` names this source lane.
Context: the existing browser could immediately persist an agent manifest patch. Intent: make a
saved transform change reviewable and recoverable. Directive: use Graph's pure review policy and
GameXR's existing queue, database, validator and export owner. The maintainer implements and
verifies that bounded path; the outcome is a source-bound preview with a local operator decision.

## PRD — reference implementation

A scene author can inspect a procedural ship's saved starting position and scale, preview their
difference without changing stored or simulated state, accept while idle/paused, and inspect or
undo the saved receipt. Agents may inspect and propose; the local operator accepts the exact
proposal shown. Transport remains its separate capability. No approval flag grants persistence.
Local controls work without an agent host. Physical scale/correspondence remain unknown and
geometry checks unavailable. Local GLB review, measured observations, Graph-scene conversion,
Canvas-to-GameXR transport, drone control and native UI parity remain outside this implementation.

| Criterion / parent | Observable condition | Failure behavior | Executable evidence |
|---|---|---|---|
| X1 / GX1 | Inspect reports owner, closed manifest schema, document, session, revision token and capabilities | Foreign/stale/forged bindings or replaced tools cannot preview | `tests/spatial-review.test.ts`, `tests/mcp-contract.test.ts`, browser agent case |
| X2 / GX2, GX5 | Preview/cancel leave exact scene/meta/asset bytes and live pose unchanged; authored/simulated/provenance labels remain distinct | Unsupported geometry or invalid transform produces no proposal | Unit transform cases and browser first-value case |
| X3 / GX3 | One idle/paused acceptance atomically compares saved identity and writes scene plus receipt | Race, replay, expiry, cancelled proposal, running flight or aborted transaction produces no partial write | Unit approval cases; browser two-tab and injected transaction failure |
| X4 / GX4 | Reload/export/import preserve history; undo changes only unchanged affected fields; unrelated fields survive | Partial import refuses; post-commit failure retains source/receipt and gates flight until explicit recovery | Unit recovery/undo/import cases; browser round trip and cold reload |
| X5 / GX6 | Default scene reaches accepted local value within four deliberate actions and 300 seconds at desktop and 390 px | No host is required; offline installed shell retains controls | Browser local first-value/offline cases; this is automated evidence, not a human session |

Priorities remain provisional: no completed human outcome or willingness-to-pay evidence supports
a demand claim. Existing H1 consent remains recorded by the pilot owner; zero real sessions have
completed. This code does not count automated execution as participant research.

## TAD — reference implementation

Grounding: GameXR base `01b18b515b05e027d966eb157746332d2d830bd0` supplies the closed
`gamexr-scene/v1` validator, `GameRuntime.configurationQueue`, scene preparation, `LocalDatabase`
scenes/assets/meta stores, `AppController` import/export and the two WebMCP tools. Graph's protected
shared package supplies canonicalization, digest, limits and exact source capability checks; its
exact artifact provenance is in `docs/AGENTIC-GRAPH-HARMONIZATION.md` and the vendor archive test.
Canvas remains the already integrated Graph-only consumer at
`e31de88e5353d8c0b0174bcecaa05ed1b8b4400f`; OS provides native publication/check/lifecycle through
GameXR's installed immutable `f6d03945ab297281ded6b702ae96d24d2b94c14e` dependency. No private
Canvas import, second geometry engine, schema alias, hosted service or new database exists.

| Element / parent | Actual owner | Contract and effect |
|---|---|---|
| XT1 / T1,T2 | `@agentic-graph/spatial-review`; `src/runtime/SpatialReview.ts` | One in-memory immutable proposal, five-minute expiry, source-kind/schema/document/session/revision identity, exact binding keys; tokens carry no approval |
| XT2 / T3 | `src/storage/LocalDatabase.ts`; existing runtime queue | One scene/meta transaction checks active profile, global write revision and captured scene bytes; bootstrap only when empty or byte-identical; every configuration writer rotates revision |
| XT3 / T3 | `src/runtime/SceneProjection.ts`; `GameRuntime.ts` | Existing asset preparation precedes persistence, then committed projection/readback; failure after commit preserves receipt, stops flight and requires saved-source recovery |
| XT4 / T4 | Lazy `src/ui/SpatialReviewPanel.ts`; `AppController.ts`; `src/mcp/contracts.ts` | Existing launch/transport entry, textual diff, trusted local accept click, cancel/undo/export/recover; strict complete import through existing Tune editor; tools expose inspect/preview/cancel only for saved transforms |

Receipts live in the existing meta store under `scene-review:<scene-id>`, separate from the closed
manifest. Keep the latest 32 and bound each review envelope/import to 128 KiB UTF-8. The transaction
adds `scene-write-revision`, a browser-local UUID that prevents ABA even when bytes are restored.
Two tabs can preview; one expected revision can win. An unrelated newer write cannot be erased by
rollback. Older schema records are read as empty history. Asset writes retain their separate owner.
Deleting the active profile requires first loading another profile, keeping the conditional source
available. No saved animation field changes through transport-only play/pause.

The exported `gamexr.scene-review-export/v1` contains the manifest plus complete validated ledger.
Import stages the complete bundle; edits to its staged manifest invalidate applying that history.
Imported actor identity is explicitly unverified. Export contains no local GLB bytes. Undo requires
the original ship asset/rotation context and unchanged affected position/scale; it preserves unrelated
fields and records a separate accepted inverse receipt. The bounded history is not an audit service.

Journey/workflow/data/harness/topology diagrams remain owned by the parent GX-J/GX-W/GX-D/GX-H/GX-T
register; these elements implement its GameXR adapter and transaction nodes. This companion adds
no parallel diagram topology or canvas-to-game route.

## ADR — reference implementation

| ID / parent | Decision and alternatives | Consequence / recovery |
|---|---|---|
| XA1 / A1,A2 | Consume the narrow Graph-owned package; replacing the old whole shared archive would change unrelated persisted-world schemas | Flight/Apple/native pins stay at their existing protected source; verify both old archives unchanged and the new archive's source SHA, bytes and lock integrity |
| XA2 / A3 | Extend one queue and scene/meta transaction; reject renderer-first persistence and a second review database | Conditional writes arbitrate tabs; prepare before commit; post-commit errors retain evidence and require explicit recovery |
| XA3 / A1,A3 | Retire direct agent saved-manifest/animation-setting effects; allow existing live controls and preview-only scene edit | Existing agent callers receive a typed block with the local-review route; no silent alias or approval boolean |
| XA4 / A4 | Textual transform comparison with explicit unknown provenance; reuse validator and existing projection | No calibrated geometry/twin/native/drone claim; preserve export and local fallback |

The only admitted alternative satisfies offline/no paid calls, one policy owner, existing storage,
closed native-compatible manifest and operator acceptance. A new remote service fails these hard
constraints. No invented provider score or savings estimate substitutes for those constraints.

## MVP — reference implementation

R1 is Graph-owned package integration; R2/R3 implement the GameXR consumer here. Scope is 20
changed paths (21 reservations including the renamed predecessor), three new runtime modules, a test module and browser harness, and at most 80 KiB
net runtime/test/document growth (generated vendor bytes reported separately). Existing large controllers remain
below 600 lines. One writer/lane per owner, no delegated agents. Estimates: R2 three 90-minute slices,
R3 two 60-minute slices; estimates are not observed labor. The shared package must be regenerated
twice from the protected R1 merge and compare byte-identically before consumer publication.

| PRD-TAD-ADR-MVP-GTM | CID | RAO | Updated Date |
|---|---|---|---|
| GAMEXR-SCENE-REVIEW-001@0.1.0 | X1/X2 → XT1 → XA1 | Maintainer consumes the protected pure package and rejects foreign/session-stale proposals; package/unit evidence required | 2026-09-26 |
| GAMEXR-SCENE-REVIEW-001@0.1.0 | X3/X4 → XT2/XT3 → XA2 | Maintainer verifies atomic scene/receipt writes, recovery and inverse preservation in real IndexedDB plus controller faults | 2026-09-26 |
| GAMEXR-SCENE-REVIEW-001@0.1.0 | X1/X5 → XT4 → XA3/XA4 | Maintainer verifies local four-action/mobile/offline flow and explicit host status; real research remains separate | 2026-09-26 |

Demo ceiling 300 seconds: enter/identify 60 s, compare/provenance 60 s, accept/refusal 90 s,
receipt/undo 90 s. Installation is measured separately. Commands: `npm run check`,
`npm run test:spatial`, and `npm run native:check` for the existing native boundary. Source checks
and browser assertions are mechanical observations; independent rubric/market review is pending.
Required Integration Gate and exact native completion receipts establish protected Dev integration.
Production still requires Graph's existing release controller and exact-candidate human authorization.

### Verification record

The mechanical candidate evidence set is retained at the workspace artifact
`gamexr-spatial-implementation/validation-20260926/candidate-evidence.json`; each log is digest-bound.
E1: native `npm run check` passes all three owner groups (evaluators, candidate/release, behavior).
E2: eight review-policy tests, twelve MCP-contract tests and three vendor-archive tests pass locally.
E3: all fifteen spatial browser cases pass at 1024 px desktop Chromium and 390 px mobile Chromium/WebKit,
including three real-origin-outage cases for reload, fresh navigation, acceptance/cancel and guarded undo.
E4: all fourteen existing-plus-spatial Safari regression cases pass using
`env -u NO_COLOR npm run test:webkit`; removing conflicting terminal-color configuration prevents
an unrelated upstream stderr assertion failure and changes no check or application policy.

These reproducible observations satisfy at least one local VCC and derive `local_rung: dev-proven`;
they do not supply an independent experience score or production evidence. Source acceptance uses
the exact candidate native validation receipt and required protected Integration Gate. R1's protected
package source/digest is recorded once in the harmonization owner. The first test-server iteration
exposed Vite's Origin-varying cache behavior; the dedicated harness uses the declared same-origin
hosting contract. WebKit offline emulation is replaced by a real server outage, preserving the failure
condition and avoiding browser-emulation claims. No source edits weaken cache integrity checks.

Native execution was attempted with the default Command Line Tools and then installed Xcode beta.
The latter refuses SDK execution until its license is accepted. This is recorded as unavailable
validation, not a passing native result; no license acceptance, simulator or physical-device outcome
is inferred. Existing native pins and both flight archives remain byte-identical. Rollback is a
protected source revert; local recovery preserves the saved scene and receipts.

## GTM — reference implementation

The parent's guided reversible-edit pilot remains a research offer hypothesis. No published price,
revenue, willingness to pay, demand validation or measured savings are established. The local path
makes zero model/network/paid calls for review; source package installation and first app download
are separate setup costs. Human labor, support minutes, device energy and 12-month TCO are unknown.
New managed or self-hosted services are outside scope. R4 requires three consenting real profiles
and records completion, actions, elapsed/help minutes, errors, provenance understanding and voluntary
return intent in the existing private pilot record. Automated tests cannot satisfy that outcome.

Open boundary: native hardware/simulator acceptance, real host invocation beyond registration,
independent experience ratings and real human outcomes remain separately unverified. The current
artifact does not advance delivered readiness or authorize Production from source integration alone.

The integration successor adds only three existing provenance/planning paths: five explicit
role revisions on the drone flight-path plan, refreshed source fingerprints, and its validation
record. The original snapshot and validation remain reachable by exact Git revision and SHA.
The unchanged provenance verifier checks the new snapshot against the already published runtime
candidate; no spatial runtime bytes or preserved native archives change in this repair.
