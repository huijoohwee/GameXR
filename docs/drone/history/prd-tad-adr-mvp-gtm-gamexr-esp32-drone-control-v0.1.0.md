---
title: "Reference implementation — GameXR control of an ESP32 drone over local Wi-Fi"
doc_type: "PRD-TAD-ADR-MVP-GTM"
version: "0.1.0"
date: "2026-09-14"
lang: "en-US"
owner: "Drone control product maintainer"
frontmatter_contract: "required"
continuity_id: "DRONE-RC-001"
prd_revision: "0.1.0"
tad_revision: "0.1.0"
adr_revision: "0.1.0"
mvp_revision: "0.1.0"
gtm_revision: "0.1.0"
parent_continuity: "FW-DEV-001@0.3.0"
local_rung: "spec-complete"
delivered_rung: "undocumented"
lane: "authoring"
universal_scope: false
worktree_id: "gamexr-drone-recommendation-local"
agent_id: "codex-01a09a28-8b33-7ef0-8183-08ad6be12e78"
guideline_revision: "2.7.0"
guideline_source: "https://github.com/huijoohwee/huijoohwee.github.io/blob/fe423728bcb52fe6d2434d8957989a057d3efd73/guidelines/prd-tad-adr-mvp-gtm-guidelines.md"
guideline_sha256: "ae7dff38da1f98386f1b45ee54857734cef8f480b453152c30a4330dae2f31c4"
source_snapshot: "evidence/source-snapshot.json"
lifecycle_status: "proposed"
load_policy: "on-demand"
verification_scope: "Source-grounded recommendation; drone implementation, bench and flight checks not executed"
---

# Reference implementation — local drone control

Recommend extending GameXR as the pilot interface and telemetry display, with flight
stabilization, motor outputs and command-loss handling owned by firmware on the ESP32.
The user selected **Local Wi-Fi first** and **ESP32 runs flight control**. These resolve
network scope and controller placement; the exact board and aircraft remain unknown.

Evaluate Espressif ESP-Drone against the selected hardware before writing a flight
stack. Start with a desktop browser plus a small local protocol bridge; retain the
existing simulator as a separate mode. Touch control follows the same command contract;
phone motion and immersive XR are later acceptance surfaces.

This is a new follow-on to [FW-DEV-001@0.3.0](provenance.json),
not a claim that its heartbeat firmware now flies. No application or firmware source
was changed for this recommendation. The original development-tool plan retains its
own evidence and acceptance criteria.

## Identity and grounding — reference implementation

All five roles join `DRONE-RC-001@0.1.0`. Context: the user wants to extend the existing
spatial interface to a physical drone. Intent: obtain an understandable, repeatable
local control loop with minimum duplicated software. Directive: recommend reuse,
ownership, interfaces and a bench-first acceptance path for an ESP32 flight controller.
RAO: the drone control product maintainer specifies the bounded follow-on and its checks.
SVO: Maintainer specifies local drone control.

[S1](evidence/source-snapshot.json) binds inspected local files and revisions. GameXR
is `8334355dc2c1f9bdf463ba102a63b5a3ac579d89`; the starter is
`de5d19a47956c740631b879c33242e60f10e4fd3`. This is source inspection, not a drone test.

| Material claim | Disposition | Source and consequence |
|---|---|---|
| Touch, keyboard, calibrated orientation and dead zones exist | Confirmed | `GameXR/src/runtime/InputController.ts`, README and S1; reuse the primitives |
| Current game controls are suitable for direct drone forwarding | Contradicted | `setTouchSteering` defaults yaw to roll × 0.55; blur clears steering/brake but retains throttle; add an independent drone profile |
| Current flight runtime is a physical quadcopter controller | Contradicted | `FlightSimulation.ts` adapts a game aircraft model and wraps position at world bounds; `GameRuntime.ts` advances it from animation frames |
| GameXR already has a vehicle network transport | Absent in inspected scope | Source inventory and `src/mcp/contracts.ts`; “transport” means local start/pause/resume, not a radio connection |
| Existing agent control can safely share the physical pilot command path | Contradicted by scope | `gamexr.control_runtime` can write game controls; it must remain simulator-only, with no physical-command handle |
| Shared input math already has an owner | Confirmed | `docs/AGENTIC-GRAPH-HARMONIZATION.md`; consume the pinned shared package, do not fork sensor/filter math |
| Starter can be reused as drone firmware unchanged | Contradicted | Starter `main/main.c` is a heartbeat; its SDK pin is v6.0.3; no IMU estimator, mixer, flight receiver or motor driver |
| ESP-Drone is a relevant firmware starting point | Confirmed by upstream documentation, hardware compatibility unverified | [Pinned README](https://github.com/espressif/esp-drone/blob/db0f6562e4f67cccee3acac4dff39c9aaea4e5fa/README.md) documents ESP32-family flight control and an ESP-IDF release/v5.0 baseline; limited support is explicit |
| Browser can send stock drone packets directly | Contradicted for the ordinary browser path | [ESP-Drone protocol](https://docs.espressif.com/projects/espressif-esp-drone/en/latest/communication.html) is CRTP/UDP; raw UDP [Direct Sockets](https://developer.chrome.com/docs/iwa/direct-sockets) requires a special Isolated Web App environment |
| Any disconnected quadcopter can automatically hold or land | Unverified and not assumed | Capabilities depend on sensors, estimator and selected firmware; no universal airborne motor-stop or landing behavior is selected |

Upstream HEAD was resolved with Git to `db0f6562e4f67cccee3acac4dff39c9aaea4e5fa`
on this review. Source/SDK pins are evaluation inputs, not a successful build claim.
The published support table and README have different chip/version granularity; the
actual board configuration and build must settle compatibility.

## PRD

### Reference implementation — problem, persona and scope

P1 is the owner/developer of a small ESP32 quadcopter. The job is to connect, inspect,
calibrate, deliberately enable control, command the aircraft and understand its actual
state. The user request validates interest in this capability; it supplies no measured
setup pain, willingness-to-pay, or flight-performance evidence.

User story: as P1, I want to use a familiar local control interface with explicit
vehicle state so that I can test and operate my selected aircraft without duplicating
its onboard flight controller.

| Pain / feature | Hook → break → fix → close | Priority and minimum value |
|---|---|---|
| P-1: requested interface has no physical-drone connection / F1 local control | Familiar controls → no vehicle link → select one compatible aircraft, map controls and show feedback → bench proof plus separate flight acceptance | Must for this requested follow-on; user-request evidence, quantitative pain unvalidated; one vehicle, one pilot, one protocol |
| P-2: optional motion/XR convenience / F2 spatial controls | Existing spatial UI → unmeasured piloting benefit → evaluate calibrated tilt later → same-board comparison | Should after F1; unvalidated, no WTP; preserve touch/gamepad fallback |
| P-3: reusable education setup / F3 workshop package | Repeated setup → support effort unknown → observe a consented pilot → record outcome and WTP | Could; commercial evidence absent |

Every Must below traces to P-1/F1. Initial implementation slice is **bench control
without propellers**, including the entire command-loss path. Flight acceptance is a
separate extension of F1; a packet echo or animated ship cannot close it.

Must: distinct Simulation/Drone modes, independently mapped axes, explicit control
enable/disable, actual telemetry, one pilot owner, bounded command freshness and
onboard command-loss handling. Should: physical gamepad adapter, calibrated phone tilt,
native mobile UDP transport and recorded telemetry playback. Could: FPV video and
telemetry-driven 3D view. Won't now: internet control, autonomous missions, LLM piloting,
multi-drone coordination, browser stabilization, cloud command routing or a new IDE.

OS Status, external AI Agent discovery and MCP Gateway federation are all excluded
from physical flight control this increment. Existing simulation tools remain available.
Any future machine-readable drone inspection is read-only and separately scoped.

### Reference implementation — acceptance and VCCs

All E1–E7 are currently **not run**. Each is an independently observable check, not an
author-rated completion label. The observer records source/configuration/firmware hashes,
hardware identity, input trace, actual output and the result of the named check.

| Criterion | Given → when → then / VCC | Evidence | Design / decision |
|---|---|---|---|
| AC1 | Given one documented board, sensors and motor interface, when the pinned firmware is built and loaded for a propeller-free bench session, then firmware identity, sensor health and inhibited actuation are observed | E1 `board-baseline`; unknown board or failed health check blocks control | C3 / ADR1 |
| AC2 | Given a bench session, when all four axes and enable/disable actions are exercised, then signs, ranges, units and mode-specific throttle semantics match the reviewed aircraft profile; no implicit yaw-from-roll coupling | E2 `pilot-mapping`; reject nonfinite/out-of-range and wrong-profile input | C1–C3 / ADR2 |
| AC3 | Given active bench control, when the page hides, focus/input is lost, the bridge is killed, Wi-Fi drops or commands stall/reorder/replay, then authority expires and the aircraft reaches its configured bench inhibited state within the profile's recorded deadline | E3 `command-loss`; 20 repetitions per fault, no automatic re-arm or stale replay | C1–C3 / ADR2 |
| AC4 | Given live telemetry, when fields update or stop, then identity, attitude, battery, control state and sample age are shown from actual measurements; stale/missing values are explicit | E4 `telemetry-truth`; no game physics substituted for aircraft data | C1–C3 / ADR2 |
| AC5 | Given Simulation mode or another pilot session, when game/MCP controls, reconnect or a second client attempts control, then no unauthorized aircraft command or ownership transfer occurs | E5 `mode-and-owner-isolation`; exactly one pilot session | C1–C3 / ADR2 |
| AC6 | Given cached compatible firmware/tools and the selected bench rig, when P1 follows the setup, then first live telemetry and verified mapping take ≤5 manual stages and ≤20 minutes | E6 `bench-walkthrough`; separate download/setup/active/wait time; compare native reference client | C1–C4 / ADR1–ADR2 |
| AC7 | Given E1–E6 and an aircraft-specific flight test plan, when a supervised contained flight is performed, then command response, measured control timing and configured loss behavior satisfy that plan | E7 `aircraft-acceptance`; sensor-dependent recovery and physical outcomes observed, no simulated substitute | C1–C3 / ADR2 |

### Reference implementation — metrics, dependencies and open decisions

| Metric | Baseline | Target / timeline |
|---|---|---|
| Local / delivered rung | spec-complete / undocumented | Bench dev-proven only after a VCC passes; runtime-ready for flight only after E1–E7 |
| Warm bench TTV | Unknown | ≤5 stages / ≤20 minutes at E6; excludes tool downloads and mechanical assembly |
| Link timing | Unknown | Record RTT, jitter, drop rate, sender gaps and receiver age; acceptance thresholds belong to the reviewed aircraft profile before E3/E7 |
| Recovery repeatability | Unknown | 20/20 bench trials per declared fault, no automatic authority restoration |
| Runtime model tokens / mandatory hosted fee | No control implementation | Target zero model calls and no required hosted service; existing developer assistant costs separate |
| Monthly TCO / ROI score | Unmeasured / unassessed | Record hardware, maintenance hours and energy before ranking a paid product; no zero-total-cost claim |

Dependencies: exact board/airframe, IMU, ESC or brushed-motor drivers, battery monitoring,
radio mode, documented firmware target, native reference client and an existing local
computer for the first bridge. A bare ESP32 development board is not the complete aircraft.
Questions still open: board/model/revision; sensors and motor interface; desired pilot
device; required flight modes. These block hardware-specific execution, not this design.

Experience rubric: Core Requirements & Functionality, Innovation & Theme Alignment,
Technical Execution & Integration, and Usefulness & Agentic Experience are all
**unassessed** at this revision. E1–E7 and a P1 comparison must supply their evidence.
No baseline sign-off or measured benefit is claimed.

## TAD

### Reference implementation — components, allocation and topology

From pilot input to reviewed setpoints: **GameXR → local protocol bridge → local Wi-Fi
→ onboard ESP32 flight controller → motors**. Actual telemetry returns through the
same bridge. The stabilization loop stays entirely on the aircraft.

| Component / SVO | Owner and reuse | New work / configuration | Rung local / delivered |
|---|---|---|---|
| C1: Interface captures pilot intent and displays telemetry | GameXR; reuse touch widgets, input primitives and upstream spatial filtering | Separate drone controller instance, mode panel, independent axes, telemetry view and physical-session lifecycle | spec-complete / undocumented |
| C2: Bridge validates and translates the selected session | Proposed `tools/drone-bridge/` in GameXR; use native local networking and one protocol codec | Explicit bind/origin/device, lease, bounded latest-command slot, telemetry decode and CRTP adapter | spec-complete / undocumented |
| C3: Aircraft stabilizes and supervises actuation | Separate firmware project based on a board-compatible ESP-Drone revision, or existing known flight firmware | Board config; verify or implement receiver freshness, ownership and command-loss behavior missing from stock protocol | spec-complete / undocumented |
| C4: Developer verifies source and procedures | Existing ESP-IDF skill, cookbook pattern and starter's evidence approach | Add only proven drone-specific recipes; keep SDK pins per firmware project | spec-complete / undocumented |

GameXR owns device-facing command semantics and the bridge; the firmware owns their
receiver and physical control. AgenticGraph continues to own shared sensor/filter math
and the existing game simulation only. Its simulation model is not promoted into an
aircraft stabilizer. Canvas, Commerce and 81rv10 need no enhancement for this scope.
The website may link a proven cookbook later; Agentic OS stays development tooling.

Topology v0.1.0 has three runtime zones: browser memory (pilot intent, session state),
local computer (bridge and bounded logs), aircraft (sensor state and control loops).
Browser↔bridge uses same-origin WebSocket; bridge↔aircraft uses the selected CRTP/UDP
implementation over Wi-Fi. No cloud hop, cloud command store or motor-level browser API.

### Reference implementation — contracts and controls

I1, C1→C2: proposed `drone-control/v1` input contains protocol version, selected device,
session epoch, increasing sequence, profile ID, mode, pilot-enable state and four
normalized axes. The reviewed profile defines units, signs, maximum tilt/yaw rate,
throttle interpretation and admissible commands. Do not reuse game `brake`, world
coordinates or animation state as physical commands. Acknowledgment distinguishes
bridge admission from aircraft receipt; neither proves physical execution.

I2, C2→C3: adapt only the exact pinned receiver's protocol. ESP-Drone's stock CRTP/UDP
packet checksum is not authentication or replay protection. Browser session fields
are a new contract, not claimed existing CRTP fields. Identify receiver gaps explicitly;
if onboard sequence/session/freshness enforcement requires an envelope or extension,
that firmware work belongs to C3 and E3/E5 must test it end to end. Restricted device
pairing and a secured local network supplement, rather than replace, these checks.

I3, freshness: the bridge has one latest-intent slot, bounded backpressure and no replay
queue. It never renews a pilot lease by retransmitting stale stick values. New sessions
discard old commands; reconnect remains disabled until deliberate control admission.
Use receiver-local monotonic deadlines, sequence/epoch checks and an explicit bounded
age method; timestamps from unsynchronized clocks alone cannot prove freshness.
Separate the sender cadence from rendering, but assume any browser task can stall.
Only the aircraft's own watchdog can cover a dead page or failed bridge.

The initial bench profile records its sender cadence and command-loss deadline before
testing; no universal values are specified here. Verify scheduling, IMU updates and
motor-control deadlines under maximum expected telemetry traffic. Dropped telemetry
must not block the stabilizer. Unknown capabilities disable the corresponding command.

I4, C3→C1: actual firmware/device identity, attitude, battery voltage, armed/control
state, mode, sensor health and receive age. Altitude, position and signal metrics are
optional when actually available. A rendered model follows received attitude; predicted
game motion is visually distinct. Limit log retention initially to 20 sessions at
5 MiB each, with an explicit export action and no automatic upload.

I5, command authority: enable, disable, land and emergency motor stop are different
actions. Ordinary Brake, Pause, lost focus or link loss must not translate into a
universal airborne motor cut. The configured onboard response depends on aircraft
capabilities and is proven first with propellers removed. Land/hold UI appears only
when the selected firmware and sensors support it. An explicit emergency stop is
separate from routine landing. Flight requires independent local intervention as
specified by the actual rig; a stop button over the failed link is not that intervention.

I6, runtime isolation: create separate simulator and human-pilot input owners and
output sinks. Existing WebMCP setters never feed C2. Switching modes invalidates the
physical session; background/blur/controller-disconnect invalidates the pilot lease.
Motion calibration remains local and ephemeral; only admitted normalized commands
leave the browser after entering Drone mode. No raw sensor stream enters a cloud store.

### Reference implementation — browser and phone path

For the first desktop prototype, serve the interface and bridge from the same loopback
origin. Bind the bridge to loopback, validate origin/session and select one drone peer;
do not expose an unauthenticated LAN command server. CRTP/UDP translation happens on
the computer, not inside an ordinary web page.

Phone control is a separate delivery profile: either a trusted local HTTPS/WSS gateway
with pairing and device tests, or the existing native Swift frontend plus a native UDP
adapter. Serving public HTTPS GameXR and connecting to arbitrary `ws://192.168...`
is not a portable deployment design ([WebSocket mixed-content guidance](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API/Writing_WebSocket_client_applications)).
Phone motion permission, backgrounding and local-network access require actual device
checks. Direct ESP-NOW would require suitable radio-side hardware, not browser JavaScript.

### Reference implementation — five flow patterns

| Pattern | Declared flow | Owner / termination |
|---|---|---|
| User journey | Choose Simulation/Drone → identify rig → view telemetry → calibrate → enable bench control → observe → disable | P1; any invalid state returns to disabled |
| Workflow | Validate identity/profile → acquire pilot lease → admit fresh command → translate → receiver verifies → acknowledge/observe | C1–C3; stale, invalid or wrong-owner input rejected |
| Data | Human axes → bounded intent → selected wire protocol → onboard setpoint; measured telemetry → UI | C1–C3; no motor PWM or game-state authority across browser seam |
| Orchestration/harness | Developer edits scoped candidate → native checks → bench fault matrix → evidence report | C4; ≤3 repair cycles, stop after two unchanged failures; no AI in the flight loop |
| Topology | Browser memory ↔ loopback bridge ↔ secured local Wi-Fi ↔ aircraft MCU | C1–C3; all runtime state local; no compulsory hosted platform |

### Reference implementation — deployment and recovery

| Boundary | Initial state | Required evidence / promotion | Recovery |
|---|---|---|---|
| B1: authored candidate → bench runtime | Closed | Exact board/firmware contract, build proof, propellers removed, implementation scope and E1 prerequisites | Disable session; restore recorded firmware/configuration on bench |
| B2: bench runtime → flight | Closed | E1–E6 plus a rig-specific flight plan, loss behavior and explicit operator flight instruction | Onboard tested recovery and independent local intervention; retain incident evidence |
| B3: source → published UI/firmware | Closed | Owner workflow and exact source/artifact checks; GameXR's existing release owner remains authoritative | Existing source-bound rollback; no direct writes to generated mirrors |

First engineering time box: 16 active hours for compatibility, mapping, bridge and bench
fault proof, re-estimated after board discovery. Flight qualification is not included
in that estimate. No subagents or persistent development daemon are required. Tool
builds use the selected project's existing limits; no generic 60-second agent wrapper
is substituted for native firmware builds. SDK installation/migration is not part of
this recommendation execution. Existing source and runtime tests remain unchanged.

## ADR

### ADR1 — reference implementation: reuse a flight stack compatible with the board

Status: recommended, hardware selection pending. Context: the ESP32 is the flight
controller; browser simulation and heartbeat firmware do not supply an estimator,
stabilizer, mixer and device drivers. Decision: evaluate ESP-Drone first for a compatible
small educational aircraft; preserve it as a separate firmware project and verify the
selected release's board, SDK and protocol contracts.

Hard constraints: onboard control; selected hardware compatibility; local operation;
no required paid service; scoped, maintainable dependencies. Comparison:

| Candidate | Constraint result | Pairwise disposition |
|---|---|---|
| Board-compatible ESP-Drone | Conditional on actual board/build; upstream limited support | Preferred over a new flight stack because existing flight/sensor/protocol code addresses the required function; compatibility and maintenance remain tests |
| Existing known ESP32 flight firmware on the user's drone | Unknown until model supplied | Can outrank ESP-Drone if it already proves the required board and protocol; avoid an unnecessary port |
| Extend the starter heartbeat into a complete flight stack | Function absent today | Reject for initial scope: estimator, drivers and stabilization would all be new work |
| Dedicated PX4/ArduPilot controller plus ESP32 bridge | Fails selected controller-placement constraint | Keep only as a future architecture change, not the current recommendation |
| Reuse the GameXR flight model on the ESP32 | Fails physical-control evidence/semantics | Reject; game dynamics and boundary wrapping are not an aircraft controller |

Argument A: upstream flight-stack reuse reduces new control code. Counterargument B:
limited support and older SDK may make a particular board expensive to support. The
independent verdict is E1 plus a maintainer review of the exact receiver/watchdog code,
not a score assigned by this document. If compatibility fails, reopen only the firmware
choice; do not silently port the application to the starter's v6.0.3 SDK. Preserve the
upstream GPL-3.0 notices and keep license metadata explicit; no relicensing is implied.

### ADR2 — reference implementation: separate pilot transport from simulator and AI

Status: recommended. Decision: GameXR owns a distinct Drone mode and a small local
protocol bridge; the ESP32 owns stabilization and failsafes. Reuse upstream clients as
the reference baseline: if GameXR supplies no measured advantage, use the native
ESP-Drone client and do not expand this feature.

The local bridge is preferred to direct browser UDP because it fits the existing web
runtime and avoids changing the flight stack merely to serve web content. Direct
onboard WebSocket is deferred: it adds firmware workload and still needs deadline,
session and browser-delivery proof. Native mobile UDP becomes preferable if phone-first
use is confirmed and gateway setup costs more than extending the existing Swift adapter.
Internet relays fail the selected local-only scope. [QGroundControl's joystick design](https://docs.qgroundcontrol.com/master/en/qgc-user-guide/setup_view/joystick.html)
is useful inspiration for calibration and explicit control modes, not a CRTP drop-in.

Consequences: one additional local process and codec to maintain; clearer separation
of simulated and actual data; board-dependent safety behavior remains firmware work.
The browser can stall, and a reliable socket can deliver stale data; transport success
therefore never replaces receiver freshness. Recovery invalidates control authority
and uses the tested aircraft policy, rather than replaying the last command.

### Reference implementation — TCO comparison

| Cost | Local web bridge | Native client baseline | Hosted relay, excluded |
|---|---|---|---|
| Mandatory service fee / runtime model calls | None designed / zero | None designed / zero | Provider-dependent / unnecessary |
| Hardware | Existing computer plus selected aircraft; actual cost unknown | Compatible phone/computer plus aircraft | Same local hardware plus relay dependency |
| New maintenance | Web adapter, codec, session tests | Lowest if stock client meets need | Internet transport, authentication and operational support |
| 12-month delta / ROI | Unmeasured; record engineering/support hours | Comparison baseline | Not ranked within local-only scope |

## MVP

### Reference implementation — joined slice and roadmap

Consumes AC1–AC6/C1–C4/ADR1–ADR2 at `DRONE-RC-001@0.1.0` for the first bench slice.
AC7 remains mandatory before claiming flight readiness; the roadmap does not create
new requirements. Source inspection earns no drone-runtime rung.

| Stage / RAO action | Reuse → new output | Prerequisite and exit |
|---|---|---|
| T1: firmware maintainer identifies and proves the baseline | Existing board documentation and native client → exact rig/SDK/profile | Board details; E1 |
| T2: interface maintainer separates drone input and telemetry | Existing widgets/filter package → C1 modes, mapping and actual telemetry | T1 contract; E2/E4/E5 |
| T3: protocol maintainer verifies the local bridge and receiver | Native networking and selected protocol → C2 plus any C3 freshness extension | T1; E3/E5, propellers removed |
| T4: observer compares the completed bench loop | Native reference client and existing firmware evidence format → timed report | T2/T3; E6 and all bench VCCs |
| T5: aircraft operator validates physical flight | Proven bench rig and onboard modes → actual flight evidence | B2; E7 |
| Later: interface maintainer evaluates motion/XR/mobile | Existing spatial/native frontends → device-specific profile only if useful | P-2 evidence, AC2–AC5 repeated for the new surface |

Five-minute warm demo for F1: Hook 20 s (show selected bench rig and explicit mode);
Probe 40 s (firmware identity and sensor state); Reveal 90 s (four-axis mapping and
actual telemetry); Domain action 120 s (enable, exercise one loss fault, show onboard
inhibition); Close 30 s (open evidence and remaining flight gap). Tools and rig are
prepared beforehand; this is not the clean-install TTV measurement.

## GTM

### Reference implementation — evidence and nearest audience

Personal local control is the first outcome, not a commercial launch. A possible later
segment is an ESP32/robotics educator with compatible kits. P-3, F3 and this GTM record
consume the PRD scope; no commerce requirement is introduced here.

Demand validation, pricing mechanism proof, collected payment, fulfillment and unit
economics are all **unproven**. No price or revenue forecast is assigned. Compare a
small workshop/setup service with a software subscription only after a reachable
segment and WTP evidence exist. Today neither satisfies those constraints, so there
is no defensible winning revenue stream. Commerce/81rv10 integration stays excluded.

After a successful personal outcome, a separately authorized consented conversation
may record setup time, baseline preference, support burden and a priced response.
Feed that evidence into a successor revision; it does not retroactively validate demand.
This recommendation initiates no outreach, purchase, deployment or aircraft actuation.

## Validation and handover — reference implementation

The recommendation is grounded in S1 and the cited primary documentation. E1–E7 are
not run. Rung is spec-complete locally and undocumented for delivery; physical-board,
browser-device and flight evidence are absent. No new executable contract is claimed
implemented. Exact independent semantic review and hardware-specific baseline remain
open; structural validation is recorded in [the evidence report](evidence/validation.json).

Before implementation, obtain board/model/revision, IMU and other sensors, motor/ESC
interface and intended pilot device. Verify the chosen firmware before changing its SDK.
Existing firmware tooling can be reused by adapting its explicit per-project pin;
do not modify the already compiled starter merely to accommodate another project.

### 2026-09-14

| PRD-TAD-ADR-MVP-GTM | CID | RAO | Updated Date |
|---|---|---|---|
| `DRONE-RC-001@0.1.0` | C: GameXR lacks a physical drone link · I: control one ESP32 aircraft locally · D: recommend compatible firmware reuse and a bounded bench-first control path | R: Drone control product maintainer · A: Maintainer specifies local drone control · O: source-grounded follow-on with explicit VCCs and owners · check: document-grounding | 2026-09-14 |
