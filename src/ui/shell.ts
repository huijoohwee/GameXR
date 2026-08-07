export function renderShell(root: HTMLElement): HTMLCanvasElement {
  root.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <a class="brand" href="${__GAME_XR_BASE_PATH__}" aria-label="GameXR home">
          <img src="${__GAME_XR_BASE_PATH__}icons/gamexr.svg" alt="" width="32" height="32" />
          <span><strong>GameXR</strong><small>Spatial flight lab</small></span>
        </a>
        <div class="runtime-badge" id="runtime-badge" data-phase="idle">
          <span class="status-light"></span><span id="runtime-phase">BOOTING</span>
        </div>
        <button class="icon-button" id="open-config" type="button" aria-label="Open configuration">Tune</button>
      </header>

      <section class="stage" aria-label="GameXR flight stage">
        <canvas id="game-canvas" aria-label="Interactive GameXR 3D scene" tabindex="0"></canvas>

        <section class="telemetry" aria-label="Flight telemetry">
          <span><small>SPD</small><strong id="telemetry-speed">0.0</strong></span>
          <span><small>THR</small><strong id="telemetry-throttle">0%</strong></span>
          <span><small>ALT</small><strong id="telemetry-altitude">0.0</strong></span>
          <span><small>FPS</small><strong id="telemetry-fps">0</strong></span>
        </section>

        <section class="launch-card" id="launch-card" aria-labelledby="launch-title">
          <p class="eyebrow">NO CLOUD. NO TOKENS. YOUR COCKPIT.</p>
          <h1 id="launch-title">Turn space into<br /><em>your</em> flight system.</h1>
          <p>Configure every scene, ship, control, and animation. Fly on-device, save locally, keep going offline.</p>
          <div class="launch-actions">
            <button class="primary-button" id="launch-flight" type="button">Start local flight</button>
            <button class="secondary-button" id="launch-config" type="button">Configure first</button>
          </div>
          <ul class="launch-proof" aria-label="Runtime properties">
            <li>Browser local</li><li>Mobile ready</li><li>Zero paid calls</li>
          </ul>
        </section>

        <section class="transport" aria-label="Flight transport">
          <button id="pause-flight" type="button">Pause</button>
          <button id="reset-flight" type="button">Reset</button>
          <button id="fullscreen" type="button">Full screen</button>
          <button id="motion-control" type="button" data-state="off" aria-pressed="false">Enable Motion</button>
          <button id="motion-recenter" type="button" hidden>Recenter</button>
        </section>

        <section class="touch-controls" aria-label="Touch flight controls">
          <div class="joystick-wrap">
            <div class="joystick" id="joystick" role="slider" aria-label="Pitch and roll" aria-valuemin="-1" aria-valuemax="1" tabindex="0">
              <span class="joystick-knob" id="joystick-knob"></span>
            </div>
            <small>PITCH · ROLL</small>
          </div>
          <div class="throttle-wrap">
            <label for="throttle"><span>THROTTLE</span><output id="throttle-output">0%</output></label>
            <input id="throttle" type="range" min="-100" max="100" value="0" step="1" />
            <button id="brake" type="button">BRAKE</button>
          </div>
        </section>

        <p class="stage-status" id="stage-status" role="status">Preparing the local runtime…</p>
      </section>

      <footer class="runtime-footer">
        <span><b>WEBMCP</b> <code>gamexr.inspect_runtime</code> · <code>gamexr.control_runtime</code></span>
        <span id="offline-status">Installable after production build</span>
      </footer>
    </div>

    <dialog class="config-dialog" id="config-dialog" aria-labelledby="config-title">
      <header>
        <div><p class="eyebrow">LOCAL CONTROL PLANE</p><h2 id="config-title">Make the world yours.</h2></div>
        <button class="icon-button" id="close-config" type="button" aria-label="Close configuration">Close</button>
      </header>

      <div class="config-scroll">
        <section class="config-section" aria-labelledby="profile-title">
          <div class="section-heading"><div><small>01</small><h3 id="profile-title">Scene profile</h3></div><p>Saved in IndexedDB on this device.</p></div>
          <div class="profile-row">
            <select id="profile-select" aria-label="Saved scene profile"></select>
            <button id="load-profile" type="button">Load</button>
            <button id="delete-profile" class="danger-button" type="button">Delete</button>
            <button id="reset-default" type="button">Default</button>
          </div>
        </section>

        <section class="config-section" aria-labelledby="quick-title">
          <div class="section-heading"><div><small>02</small><h3 id="quick-title">Flight essentials</h3></div><p>Fast controls for the highest-value parameters.</p></div>
          <form id="quick-config" class="control-grid">
            <label>Name<input id="scene-name" maxlength="80" required /></label>
            <label>Scene ID<input id="scene-id" maxlength="64" pattern="[a-z0-9]+([._-][a-z0-9]+)*" required /></label>
            <label>Environment<select id="environment"><option value="deep-space">Deep space</option><option value="orbit">Orbit</option><option value="hangar">Hangar</option></select></label>
            <label>Hull color<input id="hull-color" type="color" /></label>
            <label>Accent color<input id="accent-color" type="color" /></label>
            <label>Exhaust color<input id="exhaust-color" type="color" /></label>
            <label>Stars<input id="star-count" type="number" min="0" max="4000" step="1" /></label>
            <label>Asteroids<input id="asteroid-count" type="number" min="0" max="128" step="1" /></label>
            <label>Acceleration<input id="acceleration" type="number" min="0" max="200" step="0.5" /></label>
            <label>Max speed<input id="max-speed" type="number" min="1" max="500" step="0.5" /></label>
            <label>Sensitivity<input id="sensitivity" type="number" min="0.1" max="4" step="0.1" /></label>
            <label>Control dead zone<input id="dead-zone" type="number" min="0" max="0.45" step="0.01" /></label>
            <label>Pixel ratio cap<input id="pixel-ratio" type="number" min="0.75" max="2" step="0.05" /></label>
            <label class="check-label"><input id="invert-pitch" type="checkbox" /> Invert pitch</label>
            <label class="check-label"><input id="audio-enabled" type="checkbox" /> Engine audio</label>
            <button class="primary-button wide-button" type="submit">Apply and save locally</button>
          </form>
        </section>

        <section class="config-section" aria-labelledby="asset-title">
          <div class="section-heading"><div><small>03</small><h3 id="asset-title">Ship asset & animation</h3></div><p>Self-contained GLB only · 15 MB / 250k triangle ceiling.</p></div>
          <div class="asset-controls">
            <label class="file-drop">Import local GLB<input id="asset-file" type="file" accept=".glb,model/gltf-binary" /></label>
            <select id="asset-select" aria-label="Local ship asset"><option value="">No local assets</option></select>
            <button id="use-asset" type="button">Use selected</button>
            <button id="use-procedural" type="button">Use procedural</button>
            <button id="delete-asset" class="danger-button" type="button">Delete selected</button>
          </div>
          <div class="animation-controls">
            <label>Animation clip<select id="animation-clip"><option value="">Procedural / none</option></select></label>
            <button id="animation-play" type="button">Play</button>
            <button id="animation-pause" type="button">Pause</button>
            <label>Scrub<input id="animation-scrub" type="range" min="0" max="100" value="0" /></label>
            <label>Speed<input id="animation-speed" type="range" min="0" max="400" value="100" /></label>
          </div>
          <p class="inline-status" id="asset-status">Procedural ship active. No third-party asset bytes ship by default.</p>
        </section>

        <section class="config-section" aria-labelledby="manifest-title">
          <div class="section-heading"><div><small>04</small><h3 id="manifest-title">Complete scene manifest</h3></div><p>The versioned source of truth for every runtime parameter.</p></div>
          <textarea id="manifest-editor" spellcheck="false" aria-label="Complete scene manifest JSON"></textarea>
          <div class="manifest-actions">
            <button class="primary-button" id="apply-manifest" type="button">Validate & apply</button>
            <label class="file-button">Import JSON<input id="manifest-file" type="file" accept="application/json,.json" /></label>
            <button id="export-manifest" type="button">Export JSON</button>
          </div>
          <pre class="validation-output" id="validation-output" aria-live="polite">Manifest valid.</pre>
        </section>

        <section class="config-section" aria-labelledby="platform-title">
          <div class="section-heading"><div><small>05</small><h3 id="platform-title">Offline & agent control</h3></div><p>Explicit capability gates; no background egress.</p></div>
          <div class="platform-actions">
            <button id="persist-storage" type="button">Request durable local storage</button>
            <button id="copy-inspection" type="button">Copy runtime inspection</button>
          </div>
          <div class="mcp-card">
            <code>/tool.catalog #tool-function @tool-function</code>
            <p>Discover the two browser-local GameXR tools through the centralized Agentic Canvas OS vocabulary. Direct <code>/flight.sim</code> remains owned by Knowgrph and is not aliased here.</p>
          </div>
        </section>
      </div>
    </dialog>
  `

  const canvas = root.querySelector<HTMLCanvasElement>('#game-canvas')
  if (!canvas) throw new Error('GameXR canvas was not created.')
  return canvas
}
