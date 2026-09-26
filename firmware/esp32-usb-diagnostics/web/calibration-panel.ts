// SPDX-License-Identifier: MIT
import { fitGyro } from '@gamexr/calibration';
import { parseFrame } from '@gamexr/diagnostics';
import { ImuCapture, CAPTURE_SAMPLES, CAPTURE_LIMIT_MS, WINDOW_LIMIT_BYTES } from './imu-capture.ts';

/** No command, flash or settings API. Successful fitting only enables a local JSON export. */
export class CalibrationPanel {
  private capture = new ImuCapture(text => {
    const frame = parseFrame(text);
    if (frame.type !== 'sample') throw new Error('Sample frame required');
    return frame;
  }, fitGyro);
  private generation = 0;
  private abort: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private url = '';
  private root: HTMLElement;
  private status: HTMLElement;
  private progress: HTMLProgressElement;
  private confirm: HTMLInputElement;
  private start: HTMLButtonElement;
  private cancelButton: HTMLButtonElement;
  private download: HTMLAnchorElement;
  get busy() { return this.capture.active; }
  constructor(parent: HTMLElement, stopBench: () => void, available: () => boolean = () => true) {
    this.root = document.createElement('section'); this.root.className = 'imu-capture';
    this.root.setAttribute('aria-label', 'Stationary IMU capture');
    this.root.innerHTML = `<h2>Stationary IMU capture</h2>
      <p>Keep the board still for about 20 seconds. This measures gyro bias over Wi-Fi; it does not apply calibration.</p>
      <label><input type="checkbox"> Board stationary · motor power isolated</label>
      <div class="capture-actions"><button data-capture-start>Capture 20 seconds</button><button data-capture-cancel disabled>Cancel</button></div>
      <progress max="200" value="0" aria-label="IMU samples collected"></progress>
      <p data-capture-status role="status">Ready · motors disabled</p>
      <a data-capture-download hidden download="gamexr-wifi-imu.json">Save capture JSON</a>`;
    parent.append(this.root);
    this.status = this.root.querySelector('[data-capture-status]')!;
    this.progress = this.root.querySelector('progress')!;
    this.confirm = this.root.querySelector('input')!;
    this.start = this.root.querySelector('[data-capture-start]')!;
    this.cancelButton = this.root.querySelector('[data-capture-cancel]')!;
    this.download = this.root.querySelector('[data-capture-download]')!;
    this.start.onclick = () => {
      if (this.busy) return;
      if (!available()) { this.status.textContent = 'Finish the firmware update before capturing IMU.'; return; }
      if (!this.confirm.checked) { this.status.textContent = 'Confirm the board is stationary first.'; return; }
      stopBench(); this.revokeDownload();
      this.capture.start(true, performance.now()); this.confirm.checked = false;
      const run = ++this.generation;
      this.deadline = setTimeout(() => this.cancel('Capture timed out; start a new run'), CAPTURE_LIMIT_MS);
      this.render(); void this.poll(run);
    };
    this.cancelButton.onclick = () => this.cancel('Cancelled; calibration unchanged');
  }
  cancel(reason: string) {
    if (!this.busy) return;
    this.capture.cancel(reason); this.generation++; this.abort?.abort();
    clearTimeout(this.timer); clearTimeout(this.deadline); this.render(); this.export();
  }
  private async poll(run: number) {
    if (run !== this.generation || !this.busy) return;
    const request = new AbortController(); this.abort = request;
    const timeout = setTimeout(() => request.abort(), 1500), requestedAt = performance.now();
    try {
      const response = await fetch(this.capture.path(), { cache: 'no-store', signal: request.signal });
      if (!response.ok) throw new Error(response.status === 409 ? 'Device restarted or samples lost; restart capture'
        : 'Capture endpoint unavailable; firmware 0.4.5 or newer required');
      // Limit decoded bytes while streaming, not after buffering an arbitrary response.
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Capture stream unavailable');
      const decoder = new TextDecoder(); let text = '', bytes = 0;
      try {
        while (true) {
          const part = await reader.read(); if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > WINDOW_LIMIT_BYTES) throw new Error('Oversized capture window');
          text += decoder.decode(part.value, { stream: true });
        }
        text += decoder.decode();
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      if (run !== this.generation || !this.busy) return;
      if (document.hidden) { this.cancel('Page hidden; start a new run'); return; }
      this.capture.ingest(text, requestedAt, performance.now()); this.render();
      if (!this.busy) { clearTimeout(this.deadline); this.export(); }
    } catch (error) {
      if (run !== this.generation) return;
      this.capture.cancel((error as Error).name === 'AbortError' ? 'Wi-Fi request timed out; start a new run' : (error as Error).message);
      clearTimeout(this.deadline); this.render(); this.export();
    } finally {
      clearTimeout(timeout);
      if (this.abort === request) this.abort = null;
      if (run === this.generation && this.busy) this.timer = setTimeout(() => void this.poll(run), 200);
    }
  }
  private render() {
    const n = this.capture.samples.length;
    this.start.disabled = this.confirm.disabled = this.busy; this.cancelButton.disabled = !this.busy;
    this.progress.value = n;
    this.status.textContent = this.busy ? `${n}/${CAPTURE_SAMPLES} samples · keep the board still`
      : this.capture.status === 'validated' ? '200/200 · gyro fit and independent validation passed. Calibration remains inactive.'
      : `${this.capture.status} · ${n}/${CAPTURE_SAMPLES} samples · nothing applied`;
  }
  private export() {
    this.revokeDownload();
    const synthetic = ['localhost', '127.0.0.1'].includes(location.hostname);
    this.url = URL.createObjectURL(new Blob([JSON.stringify(this.capture.evidence(location.origin, synthetic), null, 2)], { type: 'application/json' }));
    this.download.href = this.url; this.download.hidden = false;
    this.download.download = synthetic ? 'gamexr-synthetic-imu.json' : 'gamexr-wifi-imu.json';
  }
  private revokeDownload() { if (this.url) URL.revokeObjectURL(this.url); this.url = ''; this.download.hidden = true; }
  dispose() { this.cancel('Page closed'); this.revokeDownload(); this.root.remove(); }
}
