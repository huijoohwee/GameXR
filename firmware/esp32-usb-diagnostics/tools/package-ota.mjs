// SPDX-License-Identifier: MIT
// Pure local packaging: never opens a serial port or changes device flash.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
const [mode, projectArg, outputArg, baselineArg] = process.argv.slice(2);
if (!['bind','package','package-app'].includes(mode) || !projectArg || !outputArg) throw new Error('Usage: package-ota.mjs bind|package|package-app FROZEN_PROJECT ARTIFACT_DIRECTORY [BASELINE_ARTIFACT_DIRECTORY]');
const project=resolve(projectArg), output=resolve(outputArg), build=join(project,'build');
if(!output.includes('/GameXR/.artifacts/') || !project.startsWith(output+'/')) throw new Error('Use a frozen project inside canonical GameXR/.artifacts');
if((mode==='package-app') !== Boolean(baselineArg)) throw new Error('package-app requires an explicit retained bootstrap baseline');
const baseline=mode==='package-app'?resolve(baselineArg):output;
if(!baseline.includes('/GameXR/.artifacts/')) throw new Error('Baseline must be a retained GameXR artifact');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const config=await readFile(join(project,'sdkconfig'),'utf8');
if(!/^CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE=y$/m.test(config) || !/^CONFIG_IDF_TARGET="esp32"$/m.test(config)) throw new Error('ESP32 rollback build required');
if(/^CONFIG_SECURE_BOOT=y$/m.test(config) || /^CONFIG_SECURE_FLASH_ENC_ENABLED=y$/m.test(config)) throw new Error('This package workflow does not support secured-flash provisioning');
async function padded(file,size) { const data=await readFile(file);if(data.length>size)throw new Error('Bootstrap overflow');return Buffer.concat([data,Buffer.alloc(size-data.length,255)]); }
// App-only updates retain the installed bootloader, even when a new build timestamp changes its unused rebuilt binary.
const boot=await padded(mode==='package-app'?join(baseline,'bootstrap/bootloader-padded.bin'):join(build,'bootloader/bootloader.bin'),0x7000);
const table=await padded(join(build,'partition_table/partition-table.bin'),0x1000);
const expected=[['nvs',0x9000,0x5000],['otadata',0xe000,0x2000],['app0',0x10000,0x140000],['app1',0x150000,0x140000],['spiffs',0x290000,0x160000],['coredump',0x3f0000,0x10000]];
for(let i=0;i<expected.length;i++) {
  const at=i*32, [label,offset,size]=expected[i];
  if(table.readUInt16LE(at)!==0x50aa || table.readUInt32LE(at+4)!==offset || table.readUInt32LE(at+8)!==size
    || table.subarray(at+12,at+28).toString().replace(/\0.*$/s,'')!==label) throw new Error('Unexpected partition layout');
}
const bootHash=sha(boot), tableHash=sha(table);
await mkdir(join(output,'ota'),{recursive:true});await mkdir(join(output,'bootstrap'),{recursive:true});
if(mode==='bind') {
  for(const dir of [join(project,'private'),join(output,'private')]) {
    await mkdir(dir,{recursive:true});
    await writeFile(join(dir,'ota-bootloader.sha256'),bootHash+'\n');
    await writeFile(join(dir,'ota-partitions.sha256'),tableHash+'\n');
  }
  await writeFile(join(output,'bootstrap/bootloader-padded.bin'),boot);
  await writeFile(join(output,'bootstrap/partition-table-padded.bin'),table);
  console.log('Bootstrap digests bound. Reconfigure/rebuild the frozen project, then package. No device operation.');
} else {
  if((await readFile(join(project,'private/ota-bootloader.sha256'),'utf8')).trim()!==bootHash
    || (await readFile(join(project,'private/ota-partitions.sha256'),'utf8')).trim()!==tableHash
    || sha(await readFile(join(baseline,'bootstrap/bootloader-padded.bin')))!==bootHash
    || sha(await readFile(join(baseline,'bootstrap/partition-table-padded.bin')))!==tableHash) throw new Error('Bootstrap drift; do not publish');
  const data=await readFile(join(build,'gamexr_usb_diagnostics.bin'));
  if(!data.includes(Buffer.from(bootHash)) || !data.includes(Buffer.from(tableHash))) throw new Error('Application was not built with the retained bootstrap digests');
  const text=(offset,n)=>data.subarray(offset,offset+n).toString().replace(/\0.*$/s,'');
  const version=text(48,32), projectName=text(80,32);
  if(data.length>0x140000 || data.length<1024 || data[0]!==0xe9 || data.readUInt16LE(12)!==0
    || data[23]!==1 || data.readUInt32LE(32)!==0xabcd5432 || projectName!=='gamexr_usb_diagnostics'
    || !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(version) || sha(data.subarray(0,-32))!==data.subarray(-32).toString('hex')) throw new Error('Invalid ESP32 image');
  const [major,minor,patch]=version.split('.').map(Number);
  if(major===0 && (minor<4 || minor===4 && patch<6))throw new Error('Legacy app is not OTA-compatible');
  const name=`gamexr-${version}`;
  const manifest={schema:'gamexr.ota-package/v1',version,target:'esp32',project:projectName,
    hardware:'xw-z1-reference-esp32-mpu6500-v1',bytes:data.length,sha256:sha(data),elf_sha256:data.subarray(176,208).toString('hex'),
    bootloader_sha256:bootHash,partitions_sha256:tableHash,outputs_enabled:false};
  await copyFile(join(build,'gamexr_usb_diagnostics.bin'),join(output,`ota/${name}.bin`));
  await writeFile(join(output,`ota/${name}.json`),JSON.stringify(manifest,null,2)+'\n');
  const bootstrap={schema:'gamexr.bootstrap-plan/v1',installed:false,requires_verified_full_backup:true,
    requires_fresh_boot_selection_and_partition_readback:true,usb_reliability:'unresolved',
    writes:[{offset:'0x1000',path:'bootstrap/bootloader-padded.bin',bytes:boot.length,sha256:bootHash},
      {offset:'0x10000',path:`ota/${name}.bin`,bytes:data.length,sha256:sha(data),condition:'Only after app0 boot selection is verified; otherwise stop and replan'}],
    partition_table:{offset:'0x8000',bytes:table.length,sha256:tableHash,action:'compare only; no partition table write'},
    preserve:['NVS','otadata','app1','SPIFFS','coredump'],automatic_recovery:'Not established until hardware validation passes'};
  if(mode==='package') await writeFile(join(output,'bootstrap/plan.json'),JSON.stringify(bootstrap,null,2)+'\n');
  else await writeFile(join(output,'ota/package-provenance.json'),JSON.stringify({schema:'gamexr/ota-app-packaging/v1',baseline,bootloader_sha256:bootHash,partitions_sha256:tableHash,bootstrap_writes:0,deployment_authorized:false},null,2)+'\n');
  console.log(JSON.stringify(manifest));
}
