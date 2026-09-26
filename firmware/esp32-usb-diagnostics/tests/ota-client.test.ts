// SPDX-License-Identifier: MIT
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readOtaManifest, readOtaStatus, verifyOtaFile } from '../web/ota-client.ts';
const data = new Uint8Array(1024).fill(9);
const manifest = { schema:'gamexr.ota-package/v1', version:'0.4.6', target:'esp32', project:'gamexr_usb_diagnostics',
  hardware:'xw-z1-reference-esp32-mpu6500-v1', bytes:data.length, sha256:createHash('sha256').update(data).digest('hex'),
  elf_sha256:'a'.repeat(64), bootloader_sha256:'b'.repeat(64), partitions_sha256:'c'.repeat(64), outputs_enabled:false };
test('OTA package checks real SHA-256 and rejects mismatched image size or bytes', async () => {
  const m=readOtaManifest(JSON.stringify(manifest));
  await verifyOtaFile(m,new File([data],'app.bin'));
  await assert.rejects(verifyOtaFile(m,new File([data.slice(1)],'app.bin')),/size/);
  await assert.rejects(verifyOtaFile(m,new File([new Uint8Array(1024)],'app.bin')),/SHA-256/);
});
test('OTA manifest rejects wrong hardware, legacy app, overflow and actuation claims', () => {
  for(const change of [{schema:'other'},{version:'0.4.5'},{version:'0.4.6-beta'},{hardware:'unknown'},
    {target:'esp32s3'},{project:'vendor'},{bytes:0x140001},{outputs_enabled:true},{sha256:'invalid'},
    {bootloader_sha256:''},{partitions_sha256:undefined}])
    assert.throws(()=>readOtaManifest(JSON.stringify({...manifest,...change})));
  assert.throws(()=>readOtaManifest(' '.repeat(4097)));
});
test('OTA status preserves locked bootstrap states and rejects malformed readiness', () => {
  const status={schema:'gamexr.ota/v1',version:'0.4.6',elf_sha256:'a'.repeat(64),ready:false,busy:false,
    bootloader_verified:false,boot_confirmed:false,rollback_available:false,max_bytes:0x140000,
    bootloader_sha256:'',partitions_sha256:'',outputs_enabled:false};
  assert.equal(readOtaStatus(status).ready,false);
  for(const change of [{ready:true},{ready:'true'},{outputs_enabled:true},{max_bytes:0x400000},{elf_sha256:'bad'}])
    assert.throws(()=>readOtaStatus({...status,...change}));
});
