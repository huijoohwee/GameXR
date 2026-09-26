// SPDX-License-Identifier: MIT
/** Drone-only entry: no canvas, game runtime, renderer or simulation imports. */
export function renderDroneShell(root: HTMLElement) {
  root.innerHTML = `<div class="app-shell">
    <header class="topbar">
      <a class="brand" href="/gamexr/">GameXR <small>DEVICE COCKPIT</small></a>
      <nav aria-label="Mode"><span aria-current="page">Wi-Fi Drone</span><a id="game-mode" href="/gamexr/game.html">Game Mode</a></nav>
      <div id="connection-button"></div>
    </header>
    <section class="stage" id="drone-stage" aria-label="Wi-Fi drone cockpit">
      <div class="stage-heading"><div><small>DIRECT WI-FI</small><h1>Drone control</h1></div>
        <span id="runtime-phase" class="runtime-badge">BENCH STOPPED</span></div>
      <section class="telemetry" aria-label="Drone telemetry">
        <span><small>IMU</small><strong id="telemetry-imu">—</strong></span>
        <span><small>THROTTLE</small><strong id="telemetry-throttle">0%</strong></span>
        <span><small>YAW</small><strong id="telemetry-yaw">0</strong></span>
        <span><small>MOTORS</small><strong id="telemetry-motors">OFF</strong></span>
      </section>
      <div class="drone-workspace">
        <section id="wifi-stage" aria-label="Device connection status">
          <small>DEVICE STATUS</small><h2>Wi-Fi Drone</h2><strong>Motors disabled</strong>
          <span data-main-imu>Waiting for live IMU</span><span data-main-ack>No command session</span>
          <p>Use Motion or the joystick, then Start. These controls send bench commands to the board.</p>
        </section>
        <section class="camera-card" aria-label="Phone camera">
          <small>PHONE CAMERA</small><h2>Your real-world view</h2>
          <p>Camera is off. Open Connection to enable a local preview. Frames stay on your phone.</p>
        </section>
      </div>
      <section class="transport" aria-label="Drone transport">
        <button id="pause-flight" type="button">Start</button><button id="reset-flight" type="button">Reset</button>
        <button id="fullscreen" type="button">Full screen</button>
        <button id="motion-control" type="button" aria-pressed="false">Enable Motion</button>
        <button id="motion-recenter" type="button" hidden>Recenter</button>
      </section>
      <p id="stage-status" class="stage-status" role="status">Preparing controls…</p>
      <section class="touch-controls" aria-label="Drone touch controls">
        <div class="joystick-wrap"><div class="joystick" id="joystick" role="slider" aria-label="Pitch and roll"
          aria-valuemin="-1" aria-valuemax="1" tabindex="0"><span class="joystick-knob" id="joystick-knob"></span></div><small>PITCH · ROLL</small></div>
        <div class="throttle-wrap"><label for="throttle"><span>BENCH THROTTLE</span><output id="throttle-output">0%</output></label>
          <input id="throttle" type="range" min="0" max="100" value="0" step="1" disabled><button id="brake" type="button">BRAKE</button></div>
      </section>
    </section>
    <footer><span>Local device connection · no cloud</span><span id="offline-status">Direct Wi-Fi</span></footer>
  </div>`;
  root.setAttribute('aria-busy', 'false');
}
