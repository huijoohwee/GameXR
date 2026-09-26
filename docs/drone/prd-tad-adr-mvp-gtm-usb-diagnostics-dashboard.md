# USB diagnostics dashboard — implemented plan

Status: implemented in a successor of the read-only USB observer; bench and
source-review delivery, not production flight deployment. Date: 2026-09-25.

Platform decision: use the phone browser and browser camera capabilities; skip
Swift, native iOS and visionOS development/builds for this delivery. The integration
workflow now runs mobile browser, diagnostics and release checks without the
native adapter job. Existing native source remains available for separately scoped
work. Camera purpose is a local view alongside IMU telemetry and the control UI.
The selected phone transport is a paired local Mac HTTPS gateway to USB. Direct
ESP32 Wi-Fi is the fallback roadmap. Physical-phone trust/camera acceptance and
actual motor actuation remain pending; no physical-phone validation is claimed.

## PRD

Problem: the installed diagnostics firmware streams useful IMU data, but a raw
serial log makes freshness, faults and calibration difficult to assess. The
smallest useful next step is local visual observation with honest provenance.

Delivered: live acceleration/angular rate, unverified battery estimate, sample
age, gaps/rejections, gravity-derived tilt, bounded start/stop/reconnect, local
export and guided stationary/six-face calibration. The camera preview is opt-in,
local, video-only and overlays fresh IMU values. The simulated Drone controls also
show a camera view with explicit simulation provenance. Mobile layout is included.
Battery calibration is user-deferred KIV. Motor control, stabilization, yaw,
radio links, persistent calibration and flight readiness are outside this step.

## TAD

Flow: shared exclusive serial selector → passive Python line reader → loopback
Node bridge (loopback or paired local HTTPS) → strict diagnostics parser/state → lazy browser Diagnostics panel.
The firmware is the separate PR #27 candidate; this host change does not flash it.
The older console observer shares port ownership code but retains its own profile.
The simulated Drone bench shares static-file serving, not physical actuation.

Serial input has a 2 MB/session cap and 1,024-byte line cap. Captures last 10–600
seconds and retry at most twice after releasing the failed handle. The bridge
limits pending output, clients, command size/rate and outgoing backpressure.
Only exact-origin start/stop is accepted. Local HTTPS binds one assigned private
IPv4 address, requires a single-use 256-bit pairing secret within 15 minutes, then
uses a Secure/HttpOnly/SameSite=Strict cookie. Process-local sessions expire after
one hour. No certificate is trusted automatically and no router/firewall is changed. Serial stdin is absent; no command or
motor path is exposed. Browser records are capped at 800 and exports at 499,999
bytes. A shared camera session bounds video to 1280×720/30 fps, releases tracks on
stop/switch/hide/close, and rejects late permission grants after cancellation.
No camera frame upload/recording or synchronized camera/IMU fusion is implemented.
Authored modules remain under 600 lines; dependencies are unchanged.

Freshness uses host monotonic time with a 1.5-second cutoff. Duplicate/out-of-order
samples never refresh it. Errors clear displayed values; boot/reconnect creates a
new session. Client connection epochs prevent exports from conflating sessions
after a bridge process restart. Reconnection clears all corrections.

Calibration uses contiguous, healthy samples, stationary confirmation and motion
thresholds. Gyro fitting and held-out validation use separate windows. Six-face
accelerometer fitting stays inactive until a separately captured +Z pose passes.
The accelerometer transform defines user-selected right-handed board coordinates;
gyro bias is still expressed in sensor coordinates. Tilt is gravity-only, without
yaw; no integration or flight-state inference is made.

## ADR

Reuse the native Python/Node tooling and local browser instead of introducing a
new MCP server, cloud backend or dependency. Exact protocol parsing belongs in
one shared module. Calibration is pure math plus a session-local UI; no firmware
write capability is added to acquire calibration. A separate lazy panel avoids
presenting simulated motor controls as a live device interface. Keep physical
actuation unavailable until its firmware protocol, watchdog and arming/disarming
behavior have been implemented and validated. Default transport is phone → Mac HTTPS gateway → USB. A direct ESP32 Wi-Fi link
is an alternative/fallback requiring separate firmware work. Phone trust and
physical-network acceptance remain user steps; loopback or emulated success does
not prove them. USB ownership stays shared and exclusive across both entry points.

Keep private captures, receipts, build/test logs and measured device calibration
under canonical `GameXR/.artifacts`, per the user's storage choice. Commit source,
synthetic regression fixtures and this implemented plan. No private captures or
vendor implementation are included in the source candidate.

## MVP and validation

Acceptance checks: fresh USB samples visible; stale/disconnected values removed;
replay labeled and refused for live calibration; unsupported control requests
rejected; 20-second gyro measurement validates independently; six-face math
rejects missing, moving or geometrically inconsistent input; stop/reconnect
releases/reacquires one handle; mobile page has no horizontal overflow; camera
permission denial/retry and cancellation clean up tracks without microphone access.
Camera unit and mobile WebKit checks use mocks, not physical camera hardware.
The HTTPS regression verifies actual certificate validation, unpaired/foreign
origin rejection, single-use pairing, authenticated WSS and motor-command rejection.
A browser pairing test checks fragment removal, cookie-based exchange and denial.

Real bench observation passed the guided gyro fit and held-out validation with
the user-confirmed stationary, motor-isolated board. An earlier window with excess
acceleration variation was rejected without relaxing thresholds. Real six-face
orientation remains pending physical positioning by the user; synthetic known-pose
tests establish implementation behavior only. Battery calibration remains KIV.

Run `npm run check`, `npm run test:diagnostics-browser`, and the existing
`npm run test:drone-browser` after building. Browser regressions use synthetic
replay/mocked camera streams and no hardware. The browser fixture replaces
mediaDevices as a whole because WebKit exposes native wrappers; assertions verify
the mock call count so native permission denial cannot count as a test pass. Exact check receipts and measured capture data belong in
the private dashboard artifact directory. A local server can be left available
with capture stopped; it does not require a public deployment.

## GTM, deployment and rollback

Primary user: someone bringing up an existing ESP32 board who needs trustworthy
sensor visibility before modifying control behavior. Cost: local/free/FOSS,
no account, subscription or remote telemetry service. First useful outcome is a
stationary gyro measurement and an inspectable sensor stream.

Native source publication ends at review handoff; protected integration and
production deployment need their own evidence. Roll back the host feature by
stopping the bridge and using the prior checkout/build. No device restore is
required because this change performs no flash/NVS writes. If firmware rollback
is later needed, use the independently verified full backups and firmware
workflow; this dashboard cannot perform it.
