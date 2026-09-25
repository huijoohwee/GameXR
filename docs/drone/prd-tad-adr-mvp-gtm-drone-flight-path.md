---
title: GameXR execution of Graph drone paths
doc_type: PRD-TAD-ADR-MVP-GTM
version: 1.0.0
date: 2026-09-26
owner: GameXR bench maintainer
continuity_id: DRONE-FLIGHT-PATH-001
status: implementation
frontmatter_contract: required
---

# GameXR execution of Graph drone paths

## PRD

DRONE-FLIGHT-PATH-001@1.0.0 consumes the Graph-owned portable data contract in
`agentic-graph/docs/documents/prd-tad-adr-mvp-gtm-drone-flight-path.md`. The user explicitly
confirmed simulated bench operation. Import, review, connect and Run on iPhone/Safari
must preserve the authored route, visibly acknowledge takeoff/travel/landing, and
stop on authority loss. Import cannot execute or change receiver authority. Unknown,
oversized or invalid files clear prior imported data and fail visibly.

## TAD

Graph owns 60 Hz kinematic simulation; GameXR consumes rounded sampled positions and
owns sample selection, preview and transport. `FlightPath.ts` validates the versioned
JSON file without executing source; `FlightPathView.ts` projects the trace isometrically.
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
