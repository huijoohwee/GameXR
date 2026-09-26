// SPDX-License-Identifier: MIT
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const hash=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
test('app-only packaging retains the baseline bootloader across rebuilds and rejects changed pins', () => {
  const temporary=mkdtempSync(join(tmpdir(),'gamexr-ota-package-'));
  try {
    const artifact=join(temporary,'GameXR/.artifacts'),base=join(artifact,'baseline'),out=join(artifact,'candidate'),project=join(out,'mcp-project');
    for(const dir of [join(base,'bootstrap'),join(project,'private'),join(project,'build/bootloader'),join(project,'build/partition_table')])mkdirSync(dir,{recursive:true});
    const boot=Buffer.alloc(0x7000,0xff);boot.write('retained bootstrap');
    const table=Buffer.alloc(0x1000,0xff);
    const entries=[['nvs',0x9000,0x5000],['otadata',0xe000,0x2000],['app0',0x10000,0x140000],['app1',0x150000,0x140000],['spiffs',0x290000,0x160000],['coredump',0x3f0000,0x10000]] as const;
    entries.forEach(([label,offset,size],i)=>{const at=i*32;table.fill(0,at,at+32);table.writeUInt16LE(0x50aa,at);table.writeUInt32LE(offset,at+4);table.writeUInt32LE(size,at+8);table.write(label,at+12);});
    writeFileSync(join(base,'bootstrap/bootloader-padded.bin'),boot);writeFileSync(join(base,'bootstrap/partition-table-padded.bin'),table);
    writeFileSync(join(project,'build/bootloader/bootloader.bin'),Buffer.from('unused rebuilt bootloader with another timestamp'));
    writeFileSync(join(project,'build/partition_table/partition-table.bin'),table);
    writeFileSync(join(project,'private/ota-bootloader.sha256'),hash(boot)+'\n');writeFileSync(join(project,'private/ota-partitions.sha256'),hash(table)+'\n');
    writeFileSync(join(project,'sdkconfig'),'CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE=y\nCONFIG_IDF_TARGET="esp32"\n');
    // Structurally valid packaging fixture, not an executable ESP32 application.
    const image=Buffer.alloc(1024);image[0]=0xe9;image[23]=1;image.writeUInt32LE(0xabcd5432,32);
    image.write('0.4.7',48);image.write('gamexr_usb_diagnostics',80);image.write(hash(boot),320);image.write(hash(table),400);
    Buffer.from(hash(image.subarray(0,-32)),'hex').copy(image,992);
    writeFileSync(join(project,'build/gamexr_usb_diagnostics.bin'),image);
    const script=resolve('firmware/esp32-usb-diagnostics/tools/package-ota.mjs');
    const invoke=(mode:string,extra:string[]=[])=>spawnSync(process.execPath,[script,mode,project,out,...extra],{encoding:'utf8',timeout:10000});
    const packaged=invoke('package-app',[base]);assert.equal(packaged.status,0,packaged.stderr);
    const manifest=JSON.parse(readFileSync(join(out,'ota/gamexr-0.4.7.json'),'utf8'));
    assert.equal(manifest.bootloader_sha256,hash(boot));assert.equal(manifest.sha256,hash(image));
    assert.equal(existsSync(join(out,'bootstrap/plan.json')),false,'app-only package cannot create a bootloader write plan');
    assert.notEqual(invoke('package-app').status,0,'explicit baseline required');
    assert.notEqual(invoke('package').status,0,'bootstrap mode still rejects a different bootloader');
    writeFileSync(join(project,'private/ota-bootloader.sha256'),'0'.repeat(64));
    assert.notEqual(invoke('package-app',[base]).status,0,'changed compile input cannot select a different baseline');
  } finally {rmSync(temporary,{recursive:true,force:true});}
});
