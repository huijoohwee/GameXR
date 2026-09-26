// SPDX-License-Identifier: MIT
import { readOtaManifest, verifyOtaFile, readOtaStatus } from './ota-client.ts';
import type { OtaManifest, OtaStatus } from './ota-client.ts';

export class OtaPanel {
  busy = false;
  private key: string;
  private stopBench: () => void;
  private root: HTMLElement;
  private status: HTMLElement;
  private manifestFile: HTMLInputElement;
  private imageFile: HTMLInputElement;
  private confirm: HTMLInputElement;
  private upload: HTMLButtonElement;
  private recover: HTMLButtonElement;
  private check: HTMLButtonElement;
  private manifest: OtaManifest | null = null;
  private device: OtaStatus | null = null;
  private controller: AbortController | null = null;
  private generation = 0;
  constructor(parent: HTMLElement, key: string, stopBench: () => void) {
    this.key = key; this.stopBench = stopBench;
    this.root = document.createElement('section'); this.root.className = 'ota-panel';
    this.root.setAttribute('aria-label', 'Firmware update');
    this.root.innerHTML = `<h2>Firmware update</h2>
      <p>Choose the GameXR app and its matching manifest. Upload writes the inactive slot, verifies it, then restarts the board.</p>
      <label>Build manifest JSON<input type="file" accept=".json,application/json" data-ota-manifest></label>
      <label>Application BIN<input type="file" accept=".bin,application/octet-stream" data-ota-image></label>
      <label><input type="checkbox" data-ota-confirm> Stable board power · motors isolated</label>
      <div class="capture-actions"><button data-ota-check>Check device</button><button data-ota-upload disabled>Upload and restart</button></div>
      <p role="status" data-ota-status>Check device to verify OTA readiness. Use your private pairing link.</p>
      <details><summary>Recovery</summary><p>Restore the previous compatible GameXR app if this version has a problem. This restarts the board.</p>
      <button data-ota-recover disabled>Restore previous firmware</button></details>`;
    parent.append(this.root);
    const el = <T extends HTMLElement>(name: string) => this.root.querySelector<T>(`[data-ota-${name}]`)!;
    this.status = el('status'); this.manifestFile = el('manifest'); this.imageFile = el('image'); this.confirm = el('confirm');
    this.upload = el('upload'); this.recover = el('recover'); this.check = el('check');
    this.manifestFile.onchange = this.imageFile.onchange = () => { this.manifest = null; void this.prepare(); };
    this.confirm.onchange = () => this.render();
    this.check.onclick = () => void this.inspect();
    this.upload.onclick = () => void this.install();
    this.recover.onclick = () => void this.restore();
  }
  private render() {
    this.upload.disabled = this.busy || !this.manifest || !this.device?.ready || !this.confirm.checked;
    this.recover.disabled = this.busy || !this.device?.ready || !this.device.rollback_available || !this.confirm.checked;
    this.check.disabled = this.manifestFile.disabled = this.imageFile.disabled = this.confirm.disabled = this.busy;
  }
  private async request(path: string, init: RequestInit = {}, timeoutMs = 3000) {
    if (!/^[a-f0-9]{64}$/.test(this.key)) throw new Error('Open your private pairing link first');
    const controller = new AbortController(); this.controller = controller;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(path, { ...init, cache: 'no-store', signal: controller.signal,
        headers: { ...init.headers, 'X-GXR-Key': this.key } });
      const text = await response.text();
      if (text.length > 2048) throw new Error('Oversized OTA response');
      if (!response.ok) throw new Error(`Device HTTP ${response.status}: ${text.slice(0,160)}`);
      return JSON.parse(text);
    } finally { clearTimeout(timer); if (this.controller === controller) this.controller = null; }
  }
  private async inspect() {
    if (this.busy) return;
    const run = ++this.generation; this.busy = true; this.render();
    try {
      const device = readOtaStatus(await this.request('/api/ota'));
      if (run !== this.generation) return;
      this.device = device;
      this.status.textContent = !device.bootloader_verified ? 'OTA locked: one-time USB bootstrap with the matching recovery bootloader required.'
        : device.ready ? `Firmware ${device.version} · boot verified · OTA ready`
        : 'Device self-check pending or update busy. Check device again after a few seconds.';
    } catch (error) { if (run === this.generation) { this.device = null; this.status.textContent = (error as Error).message; } }
    finally { if (run === this.generation) { this.busy = false; this.render(); } }
  }
  private async prepare() {
    const run = ++this.generation;
    this.manifest = null; this.render();
    const json = this.manifestFile.files?.[0], image = this.imageFile.files?.[0];
    if (!json || !image) return;
    try {
      if (json.size > 4096) throw new Error('Manifest too large');
      const manifest = readOtaManifest(await json.text());
      await verifyOtaFile(manifest, image);
      if (run !== this.generation) return;
      this.manifest = manifest;
      this.status.textContent = `Verified file · ${manifest.version} · ${manifest.bytes.toLocaleString()} bytes · SHA-256 ${manifest.sha256}`;
    } catch (error) { if (run === this.generation) this.status.textContent = (error as Error).message; }
    this.render();
  }
  private async install() {
    if (this.upload.disabled || !this.manifest) return;
    const manifest = this.manifest, image = this.imageFile.files?.[0];
    if (!image) return;
    const run = ++this.generation; this.busy = true; this.stopBench(); this.render();
    try {
      if(manifest.bootloader_sha256 !== this.device?.bootloader_sha256 || manifest.partitions_sha256 !== this.device.partitions_sha256)
        throw new Error('Package requires a different bootloader or partition layout');
      await verifyOtaFile(manifest,image);
      if(run !== this.generation) return;
      this.status.textContent = 'Uploading and verifying · keep board power and this page connected';
      const result = await this.request('/api/ota', { method: 'POST', body: image,
        headers: { 'Content-Type': 'application/octet-stream', 'X-GXR-SHA256': manifest.sha256,
          'X-GXR-Bootloader': manifest.bootloader_sha256, 'X-GXR-Partitions': manifest.partitions_sha256 } }, 100000);
      if(run !== this.generation) return;
      if(result.schema !== 'gamexr.ota-result/v1' || result.status !== 'restarting' || result.sha256 !== manifest.sha256 || result.outputs_enabled !== false)
        throw new Error('Update acknowledgment rejected; check device before retrying');
      this.status.textContent = 'Image verified · board restarting. Rejoin its Wi-Fi if necessary.';
      await this.readback(run,manifest);
    } catch(error) { if(run === this.generation) this.status.textContent = `Update outcome unconfirmed: ${(error as Error).message}. Check device before retrying.`; }
    finally { if(run === this.generation) { this.busy = false; this.device = null; this.confirm.checked = false; this.render(); } }
  }
  private async readback(run: number, manifest: OtaManifest) {
    const deadline = performance.now()+40000;
    while(run === this.generation && performance.now()<deadline) {
      await new Promise(resolve => setTimeout(resolve,1000));
      if(run !== this.generation || document.hidden) return;
      try {
        const device = readOtaStatus(await this.request('/api/ota',{},1500));
        if(run !== this.generation) return;
        if(device.version===manifest.version && device.elf_sha256===manifest.elf_sha256 && device.boot_confirmed && device.bootloader_verified && device.ready) {
          this.status.textContent = `Firmware ${device.version} verified after restart · startup checks passed · motors disabled. Reload the dashboard.`; return;
        }
      } catch { /* bounded readback only; never resend an upload */ }
    }
    if(run === this.generation) throw new Error('Expected firmware boot not confirmed; recovery may have restored the previous app');
  }
  private async restore() {
    if(this.recover.disabled) return;
    const run=++this.generation;this.busy=true;this.stopBench();this.render();
    try {
      const result=await this.request('/api/ota/recover',{method:'POST',body:''});
      if(run !== this.generation)return;
      if(result.schema!=='gamexr.ota-result/v1'||result.status!=='recovering'||result.outputs_enabled!==false)throw new Error('Recovery acknowledgment rejected');
      this.status.textContent='Restoring previous firmware · rejoin Wi-Fi, then Check device to verify the result.';
    }catch(error){if(run===this.generation)this.status.textContent=`Recovery outcome unconfirmed: ${(error as Error).message}`;}
    finally{if(run===this.generation){this.busy=false;this.device=null;this.confirm.checked=false;this.render();}}
  }
  cancel() {
    this.generation++;this.controller?.abort();
    if(this.busy)this.status.textContent='Request stopped locally. Device outcome unconfirmed; Check device before retrying.';
    this.busy=false;this.device=null;this.confirm.checked=false;this.render();
  }
}
