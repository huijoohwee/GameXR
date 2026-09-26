// SPDX-License-Identifier: MIT
// Build-only reuse of a pinned GameXR checkout. Outputs belong in GameXR/.artifacts.
import { readFile, readdir, mkdir, lstat, symlink, readlink, unlink } from 'node:fs/promises';
import { resolve, join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';
import { splitCockpitModes } from './cockpit-modes.mjs';
import { assertCockpitCheckout, validateCockpitArtifact } from './cockpit-source.ts';
import { writeGeneratedFile } from '../../../node_modules/agentic-os/bin/agentic-os-generation.mjs';
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [sourceArg, outputArg] = process.argv.slice(2);
if (!sourceArg || !outputArg) throw new Error('Usage: package-cockpit.mjs PHONE_CHECKOUT ARTIFACT_DIRECTORY');
const source = resolve(sourceArg), output = resolve(outputArg);
if (!output.includes('/GameXR/.artifacts/')) throw new Error('Use canonical GameXR/.artifacts');
const lock = JSON.parse(await readFile(join(project, 'cockpit-source.lock.json'), 'utf8'));
const expected = lock.sourceRevision;
assertCockpitCheckout(source, lock);
const entries = new Map();
for (const path of await files(join(source, 'dist/gamexr'))) entries.set(path, await readFile(join(source, 'dist/gamexr', path)));
const sourceArtifact = validateCockpitArtifact(entries, lock);
const generated = join(output, 'generated'), served = join(output, 'site/gamexr');
await mkdir(generated, { recursive: true }); await mkdir(served, { recursive: true });
await build({ configFile: false, root: project, base: '/gamexr/',
  resolve: { alias: { '@gamexr/motion': join(source, 'src/runtime/DeviceOrientationController.ts'),
    '@gamexr/camera': join(source, 'src/drone/CameraView.ts'),
    '@gamexr/calibration': join(source, 'src/drone/diagnostics/calibration.ts'),
    '@gamexr/diagnostics': join(source, 'src/drone/diagnostics/protocol.ts') } },
  build: { outDir: join(output, 'extension'), emptyOutDir: true, minify: true, sourcemap: false,
    lib: { entry: join(project, 'web/cockpit.ts'), formats: ['es'], fileName: () => 'wifi-cockpit.js', cssFileName: 'wifi-cockpit' } } });
async function files(root, prefix = '') {
  const result = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...await files(root, path));
    else if (entry.isFile()) result.push(path);
    else throw new Error('Unexpected linked asset');
  }
  return result.sort();
}
// Refuse a concurrent source change while Vite reused the owner's modules.
assertCockpitCheckout(source, lock);
const extensionPaths = [];
for (const path of await files(join(output, 'extension'))) {
  const data = await readFile(join(output, 'extension', path));
  const digest = createHash('sha256').update(data).digest('hex').slice(0, 16);
  const name = path.replace(/(\.[^.]+)$/, `.${digest}$1`);
  entries.set(name, data); extensionPaths.push(name);
}
const dronePaths = splitCockpitModes(entries, extensionPaths);
const sha = b => createHash('sha256').update(b).digest('hex');
// Reuse the existing verified cache owner with a drone-only inventory.
const cache = JSON.parse(entries.get('precache-manifest.json'));
cache.entries = dronePaths.map(path => ({ path, kind: path.endsWith('.js') ? 'script' : path.endsWith('.css') ? 'style' : 'document',
  bytes: entries.get(path).length, sha256: sha(entries.get(path)) }));
cache.entries.sort((a,b)=>a.path.localeCompare(b.path));
const previousDigest = cache.buildDigest;
cache.buildDigest = sha([cache.basePath, ...cache.entries.map(e=>`${e.path}\0${e.bytes}\0${e.sha256}`)].join('\n'));
entries.set('precache-manifest.json', Buffer.from(JSON.stringify(cache)));
entries.set('sw.js', Buffer.from(entries.get('sw.js').toString().replace(previousDigest, cache.buildDigest)));
// The injected build is a new local candidate, not the published frontend artifact.
entries.set('release-manifest.json', Buffer.from(JSON.stringify({ schema:'gamexr/embedded-candidate/v1',
  candidateStatus:'local-device-development', frontendRevision:expected, packagedBy:'package-cockpit.mjs',
  precacheDigest:cache.buildDigest, deploymentAuthorized:false })));

const manifest = { schema: 'gamexr/embedded-cockpit/v1', source_commit: expected,
  source_artifact: sourceArtifact, path_execution: lock.pathExecution, embedded_path_execution: false,
  files: [], original_bytes: 0, gzip_bytes: 0, drone_gzip_bytes: 0, game_mode: '/gamexr/game.html', motor_outputs_enabled: false };
let declarations = '', rows = '', cmake = '';
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.json': 'application/json', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json' };
let i = 0;
for (const [path, data] of entries) {
  const type = mime[extname(path)]; if (!type) throw new Error(`Unsupported asset ${path}`);
  const packed = gzipSync(data, { level: 9 });
  if (packed.length > 250000) throw new Error('Per-asset compressed cap exceeded');
  await writeGeneratedFile(join(generated, `asset${i}.gz`), packed);
  await mkdir(dirname(join(served, path)), { recursive: true });
  await writeGeneratedFile(join(served, path), data);
  declarations += `extern const unsigned char a${i}[] asm("_binary_cockpit_${i}_start"), z${i}[] asm("_binary_cockpit_${i}_end");\n`;
  rows += `{${JSON.stringify('/gamexr/' + path)},${JSON.stringify(type)},a${i},z${i}},\n`;
  cmake += `target_add_binary_data(\${COMPONENT_LIB} "\${CMAKE_CURRENT_LIST_DIR}/asset${i}.gz" BINARY RENAME_TO "cockpit_${i}")\n`;
  manifest.files.push({ path, bytes: data.length, gzip_bytes: packed.length, sha256: sha(data), gzip_sha256: sha(packed) });
  manifest.original_bytes += data.length; manifest.gzip_bytes += packed.length;
  if (dronePaths.includes(path) || ['sw.js', 'precache-manifest.json'].includes(path)) manifest.drone_gzip_bytes += packed.length;
  i++;
}
if (manifest.gzip_bytes > 300000) throw new Error('300kB total cockpit budget exceeded');
const c = `// Generated by package-cockpit.mjs; exact allowlist, no filesystem access.\n#include "cockpit_assets.h"\n#include <string.h>\n${declarations}
static const struct { const char *path,*mime; const unsigned char *start,*end; } assets[]={\n${rows}};
esp_err_t cockpit_asset(httpd_req_t *req) {
 char path[160]; size_t n=strcspn(req->uri,"?");
 if(n>=sizeof(path)) return httpd_resp_send_err(req,HTTPD_404_NOT_FOUND,"Unknown asset");
 memcpy(path,req->uri,n);path[n]=0;
 if(!strcmp(path,"/gamexr/")) strcpy(path,"/gamexr/index.html");
 for(unsigned i=0;i<sizeof(assets)/sizeof(assets[0]);i++) if(!strcmp(path,assets[i].path)) {
  httpd_resp_set_type(req,assets[i].mime);httpd_resp_set_hdr(req,"Content-Encoding","gzip");
  return httpd_resp_send(req,(const char*)assets[i].start,assets[i].end-assets[i].start);
 }
 return httpd_resp_send_err(req,HTTPD_404_NOT_FOUND,"Unknown asset");
}\n`;
await writeGeneratedFile(join(generated, 'cockpit_assets.c'), c);
await writeGeneratedFile(join(generated, 'cockpit_assets.h'), '#pragma once\n#include "esp_http_server.h"\nesp_err_t cockpit_asset(httpd_req_t *req);\n');
await writeGeneratedFile(join(generated, 'assets.cmake'), cmake);
await writeGeneratedFile(join(output, 'cockpit-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const link = join(project, 'generated');
try {
  const current = await lstat(link);
  if (!current.isSymbolicLink()) throw new Error('Generated inputs must be an artifact link');
  if (resolve(dirname(link), await readlink(link)) !== generated) { await unlink(link); await symlink(generated, link); }
} catch (error) { if (error.code !== 'ENOENT') throw error; await symlink(generated, link); }
console.log(JSON.stringify({ files: i, original_bytes: manifest.original_bytes, gzip_bytes: manifest.gzip_bytes, drone_gzip_bytes: manifest.drone_gzip_bytes, output }));
