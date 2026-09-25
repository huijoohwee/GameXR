---
title: GameXR execution of Graph drone paths
doc_type: PRD-TAD-ADR-MVP-GTM
version: 1.1.0
date: 2026-09-26
owner: GameXR bench maintainer
continuity_id: DRONE-FLIGHT-PATH-001
status: implementation
frontmatter_contract: required
---

# GameXR execution of Graph drone paths

## PRD

DRONE-FLIGHT-PATH-001@1.1.0 consumes the Graph-owned portable data contract in
`agentic-graph/docs/documents/prd-tad-adr-mvp-gtm-drone-flight-path.md`. The user explicitly
confirmed simulated bench operation. Import, review, connect and Run on iPhone/Safari
must preserve the authored route, visibly acknowledge takeoff/travel/landing, and
stop on authority loss. Import cannot execute or change receiver authority. Unknown,
oversized or invalid files clear prior imported data and fail visibly.

## TAD

Graph owns 60 Hz kinematic simulation; GameXR consumes rounded sampled positions and
owns sample selection, preview and transport. `FlightPath.ts` validates the versioned
JSON file without executing source; `FlightPathView.ts` hosts the Graph-owned Canvas build through `GraphCanvasPreview.ts`.
The existing lazy Drone panel owns Run and its session. A 40 ms sender selects the
current authored sample. It never invents velocity, attitude, rotor or throttle values.

`simulated-drone-path/v1` commands carry kind=path, profile, session, one-use challenge,
sequence and pose. The receiver accepts bounded ordered poses under its existing
250 ms lease, pins each session to either manual controls or path commands, and keeps
all manual axes neutral during paths. Its telemetry adds optional pathProfile/pathPose;
actual attitude/battery remain unavailable and motorOutputs is always false.
The RPYT codec, physical diagnostics and firmware are outside this path.

## ADR

Reuse the stopped phone-browser candidate's paired HTTPS gateway and the existing
WebSocket → loopback UDP receiver. The user approved coordination; its former writer
confirmed exact clean stopped head 93133aa75cfe403b80b119ef72508e32e52efe59. Native successor
and readmission preserve that candidate and the active firmware writer's disjoint paths.
TLS accepts an explicit local private interface and certificate/key; gateway pairing
is one-use, origin-bound, cookie-authenticated and expires after one hour. No arbitrary
UDP peer, physical mode, automatic enable or command persistence is introduced.

## MVP

Acceptance: malformed path rejection; exact sample timing with final acknowledgment;
independent receiver expiry, replay/order/mode rejection; authenticated HTTPS transport;
mobile WebKit import/Run/Stop/focus-loss; existing manual-control regression checks.
Graph's exported nine-second route is a cross-repository fixture supplied to the browser
suite by GRAPH_FLIGHT_PATH_FILE, not a copied runtime. Native package pins are unchanged.
Budget refresh: at most 20 files across both repositories, 80 KiB added source, zero new
dependencies or mandatory services; no source file reaches 600 lines. Existing lazy
Drone loading contains the new UI code. Physical iPhone certificate trust/Wi-Fi behavior
requires an actual phone session; host WebKit evidence cannot certify it.

## GTM

The demonstrated value is a learner moving an authored route onto a phone-operated
simulated bench. Measure completion and setup burden before adding curriculum or hardware.
Demand, paid conversion and physical flight remain unverified. No outreach is authorized.

## Release, rollback and evidence

Run native selected validation, mobile browser checks and RELEASE publication. Protected
merge and Production require their own receipts. Local recovery stops the bridge and
uses a fresh explicit Run; source recovery is a reviewed revert of this extension.
Implementation passes native selected evaluators, candidate TypeScript/build/release
checks and Node behavior tests, including four path admission/clock/lease/TLS tests.
All six mobile WebKit bench tests pass with Graph's exported nine-second route. The
file-input width regression found by the unchanged manual-control mobile check was
corrected before its passing rerun. The visible local preview completed the same route
at x=4, z=0, altitude=0 and tick=540, with receiver acknowledgment and neutral axes.
All chunks remain below 500 kB; the lazy Drone panel is about 15 kB uncompressed.
Evidence lives outside the source tree under
`.audit-artifacts/drone-implementation-20260925/gamexr-path-*`; it observes working
source before publication, not protected integration or physical iPhone acceptance.


## Canvas reuse and source navigation — 1.1.0

PRD: show Graph's existing drone scene in the phone preview and provide a clickable
return to its authored file. GameXR's SVG geometry is removed. The UI still owns import,
review and explicit Run; no preview operation enables control.

TAD/ADR: the optional `--graph-canvas-root=DIR` flag (or GAME_XR_GRAPH_CANVAS_ROOT)
mounts a locally built Graph artifact under the gateway's same HTTP(S) origin. Validate
its versioned manifest before spawning the receiver; preserve path/Host/method guards
and reject filesystem escape. Only this mount allows same-origin framing. A versioned
channel exchanges bounded read-only pose tuples; stale/foreign messages are ignored.
The lazy Drone panel starts the embed, disposes its listener/iframe, and visibly reports
missing artifacts. GameXR's release output does not silently vendor a sibling repository;
the local operator supplies the explicit Graph build described in its source runbook.

Graph's v2 file adds sourceUrl using its existing kgDoc route. Consumer validation
rejects executable schemes, credentials, extra parameters, traversal and oversized
links. Source navigation requires a user click and opens a separate tab with noopener
and noreferrer. v1 files still run but require re-export for a source link. A source route
opens that browser workspace's current file; it is not cross-device workspace sync or
proof that the file still matches sourceDigest.

MVP: test source-link admission, static mount/symlink containment and actual mobile
WebKit Canvas loading, wrong-channel rejection, accepted final pose and no UI overflow.
Retain the 250 ms lease and all stop/focus-loss checks. CI's completion screenshot moves
after landing because screenshot capture can block an active WebKit event loop.
A separate run with no artifact verifies the explicit unavailable state. Actual iPhone
Wi-Fi remains a physical acceptance step; host emulation cannot certify it.

GTM: recommend Send to GameXR for same-browser handoff, a paired link/QR for iPhone,
then copy/paste for offline exchange. These are future transfer choices; this revision
keeps file import. Shared Canvas and source navigation are implemented now. Rollback
reverts this successor and restarts the gateway with the prior candidate.

1.1.0 working-source validation: native selected evaluators, candidate and behavior
checks pass. Six path admission/clock/lease/TLS/source-link/artifact-containment tests
pass; all six mobile WebKit bench tests pass with the real Graph Canvas artifact, and
all six pass with the artifact absent. Wrong-channel messages leave the preview unchanged;
final accepted pose matches the imported sample. Evidence: external `canvas-reuse-*`
artifacts in `.audit-artifacts/drone-implementation-20260925`. Publication and protected
integration require separate receipts.
