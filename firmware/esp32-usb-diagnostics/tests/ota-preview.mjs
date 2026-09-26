// SPDX-License-Identifier: MIT
// Synthetic loopback API only. This module cannot access USB or the drone network.
import { createHash } from 'node:crypto';
export const fixtureBytes=Buffer.alloc(1024,42);
export const fixtureManifest={schema:'gamexr.ota-package/v1',version:'0.4.7',target:'esp32',project:'gamexr_usb_diagnostics',
  hardware:'xw-z1-reference-esp32-mpu6500-v1',bytes:fixtureBytes.length,sha256:createHash('sha256').update(fixtureBytes).digest('hex'),
  elf_sha256:'d'.repeat(64),bootloader_sha256:'b'.repeat(64),partitions_sha256:'c'.repeat(64),outputs_enabled:false};
export function otaPreview(server) {
  const evidence=[];
  let version='0.4.6',elf='a'.repeat(64);
  const reply=(res,body)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));};
  server.middlewares.use('/preview/ota/evidence',(_req,res)=>reply(res,{synthetic:true,device_connection:false,evidence}));
  server.middlewares.use('/api/ota',(req,res)=>{
    if(req.headers['x-gxr-key']!=='a'.repeat(64)){res.statusCode=403;res.end('Synthetic key required');return;}
    if(req.method==='GET')return reply(res,{schema:'gamexr.ota/v1',version,elf_sha256:elf,ready:true,busy:false,
      bootloader_verified:true,boot_confirmed:true,rollback_available:true,max_bytes:0x140000,
      bootloader_sha256:'b'.repeat(64),partitions_sha256:'c'.repeat(64),outputs_enabled:false});
    if(req.method!=='POST'){res.statusCode=405;res.end();return;}
    if(req.url==='/recover') {
      version='0.4.6';elf='a'.repeat(64);evidence.push({action:'recover',synthetic:true});
      return reply(res,{schema:'gamexr.ota-result/v1',status:'recovering',outputs_enabled:false});
    }
    let body=Buffer.alloc(0);
    req.on('data',chunk=>{body=Buffer.concat([body,chunk]);if(body.length>2048)req.destroy();});
    req.on('end',()=>{
      const digest=createHash('sha256').update(body).digest('hex');
      if(body.length!==1024 || digest!==fixtureManifest.sha256 || req.headers['x-gxr-sha256']!==digest
        || req.headers['x-gxr-bootloader']!==fixtureManifest.bootloader_sha256 || req.headers['x-gxr-partitions']!==fixtureManifest.partitions_sha256) {
        res.statusCode=400;res.end('Synthetic package mismatch');return;
      }
      version=fixtureManifest.version;elf=fixtureManifest.elf_sha256;evidence.push({action:'upload',bytes:body.length,sha256:digest,synthetic:true});
      reply(res,{schema:'gamexr.ota-result/v1',status:'restarting',sha256:digest,outputs_enabled:false});
    });
  });
}
