// SPDX-License-Identifier: MIT
export const OTA_MAX_BYTES = 0x140000;
const hex = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export interface OtaManifest {
  schema: 'gamexr.ota-package/v1'; version: string; target: 'esp32'; project: 'gamexr_usb_diagnostics';
  hardware: 'xw-z1-reference-esp32-mpu6500-v1'; bytes: number; sha256: string; elf_sha256: string;
  bootloader_sha256: string; partitions_sha256: string; outputs_enabled: false;
}
export function readOtaManifest(text: string): OtaManifest {
  if (text.length > 4096) throw new Error('Manifest too large');
  const m = JSON.parse(text);
  if (m?.schema !== 'gamexr.ota-package/v1' || m.target !== 'esp32' || m.project !== 'gamexr_usb_diagnostics'
    || m.hardware !== 'xw-z1-reference-esp32-mpu6500-v1' || m.outputs_enabled !== false
    || !Number.isInteger(m.bytes) || m.bytes < 1024 || m.bytes > OTA_MAX_BYTES
    || ![m.sha256, m.elf_sha256, m.bootloader_sha256, m.partitions_sha256].every(hex)
    || typeof m.version !== 'string' || !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(m.version)) throw new Error('Not a GameXR ESP32 OTA package');
  const [major, minor, patch] = m.version.split('.').map(Number);
  if (major === 0 && (minor < 4 || minor === 4 && patch < 6)) throw new Error('OTA requires firmware 0.4.6 or newer');
  return m;
}
export async function verifyOtaFile(manifest: OtaManifest, file: File): Promise<void> {
  if (file.size !== manifest.bytes) throw new Error('Application size does not match manifest');
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  const actual = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
  if (actual !== manifest.sha256) throw new Error('Application SHA-256 does not match manifest');
}
export interface OtaStatus { schema: string; version: string; elf_sha256: string; ready: boolean; busy: boolean;
  bootloader_verified: boolean; boot_confirmed: boolean; rollback_available: boolean; max_bytes: number; bootloader_sha256: string; partitions_sha256: string; outputs_enabled: false }
export function readOtaStatus(value: unknown): OtaStatus {
  const s = value as OtaStatus;
  if (s?.schema !== 'gamexr.ota/v1' || s.outputs_enabled !== false || !hex(s.elf_sha256)
    || ![s.bootloader_sha256,s.partitions_sha256].every(v => v === '' || hex(v))
    || typeof s.version !== 'string' || !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(s.version) || s.max_bytes !== OTA_MAX_BYTES
    || ![s.ready,s.busy,s.bootloader_verified,s.boot_confirmed,s.rollback_available].every(v => typeof v === 'boolean')
    || (s.ready && (s.busy || !s.bootloader_verified || !s.boot_confirmed))) throw new Error('OTA status rejected');
  return s;
}
