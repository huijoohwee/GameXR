// SPDX-License-Identifier: MIT
// Loopback-only synthetic receiver. No proxy, serial access or real device key.
import { otaPreview } from './ota-preview.mjs';
const bootAt = Date.now();
const currentSeq = () => Math.floor((Date.now() - bootAt) / 100);
const sample = seq => ({ profile: 'gamexr.usb-diagnostics/v1', type: 'sample', seq, uptime_ms: 10000 + seq * 100, motor_gate_command: 'low_held',
  imu: { status: 'ok', frame: 'sensor', gyro_rad_s: [-.052, .005, .017], accel_m_s2: [0, 0, 9.81] },
  battery: { status: 'out_of_range', raw: 3000, adc_mv: 2550, battery_mv: null } });
let session = 100, lastSeq = 0, linked = false, lastAt = 0;
const commands = [];
export default {
  root: process.env.GXR_COCKPIT_SITE,
  server: { host: '127.0.0.1', port: 4199, strictPort: true },
  plugins: [{ name: 'synthetic-wifi-preview',
    configureServer(server) {
      otaPreview(server);
      server.middlewares.use('/api/telemetry', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ schema: 'gamexr.direct-wifi/v1', session: 1, age_ms: 0, actuation_available: false,
          sample: sample(currentSeq()) }));
      });
      server.middlewares.use('/api/imu-window', (req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        const after = url.searchParams.get('after'), now = currentSeq();
        if (after !== null && (url.searchParams.get('session') !== '1' || +after > now || now - +after > 32)) {
          res.statusCode = 409; res.end('Synthetic cursor gap'); return;
        }
        const first = after === null ? now : +after + 1;
        const samples = Array.from({ length: Math.min(8, Math.max(0, now - first + 1)) }, (_, i) => sample(first + i));
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ schema: 'gamexr.imu-window/v1', session: 1, actuation_available: false,
          age_ms: samples.length ? (now - samples.at(-1).seq) * 100 : 0, samples }));
      });
      server.middlewares.use('/preview/evidence', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ synthetic: true, device_connection: false, commands }));
      });
      server.middlewares.use('/api/bench', (req, res) => {
        if (req.method !== 'POST' || req.headers['x-gxr-key'] !== 'a'.repeat(64)) {
          res.statusCode = 403; res.end('Preview requires its synthetic pairing link'); return;
        }
        let body = '';
        req.on('data', chunk => { body += chunk; if (body.length > 95) req.destroy(); });
        req.on('end', () => {
          let status = 'rejected', active = false, values = [0, 0, 0, 0];
          if (Date.now() - lastAt > 250) linked = false;
          if (body === 'GXR1 HELLO' && !linked) { status = 'ready'; session++; lastSeq = 0; linked = true; }
          else if (body === 'GXR1 STOP') { linked = false; status = 'stopped'; }
          else {
            const match = /^GXR1 SET (\d+) (\d+) (\d+) (-?\d+) (-?\d+) (-?\d+)$/.exec(body);
            if (match && linked && +match[1] === session && +match[2] === lastSeq + 1 && +match[3] <= 200
              && match.slice(4).every(n => Math.abs(+n) <= 1000)) {
              status = 'accepted'; active = true; lastSeq++; values = match.slice(3).map(Number);
            }
          }
          lastAt = Date.now(); commands.push({ command: body, status, values });
          if (commands.length > 400) commands.shift();
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ profile: 'gamexr.usb-bench/v1', type: 'ack', session, seq: lastSeq,
            status, active, lease_ms: 250, outputs_enabled: false, motor_outputs: [0, 0, 0, 0],
            virtual_motors: values[0] ? [1, -1, -1, 1].map(sign => Math.max(0, Math.min(200, Math.round(values[0] + sign * values[1] * .04)))) : [0, 0, 0, 0] }));
        });
      });
    },
    transformIndexHtml(html) {
      return html.replace('<body>', '<body><div style="position:fixed;top:0;left:0;z-index:999;background:#ffd399;color:#111;padding:4px">PREVIEW · SYNTHETIC IMU / OTA · NO DEVICE CONNECTION</div>');
    },
  }],
};
