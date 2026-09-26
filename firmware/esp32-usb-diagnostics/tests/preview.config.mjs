// SPDX-License-Identifier: MIT
// Loopback-only fixture preview. No USB, network proxy, or device commands.
import { fileURLToPath } from 'node:url';
let seq = 0;
export default {
  root: fileURLToPath(new URL('../web', import.meta.url)),
  base: '/',
  server: { host: '127.0.0.1', port: 4197, strictPort: true },
  plugins: [{
    name: 'explicit-device-fixture',
    transformIndexHtml(html) {
      return html.replace('<body>', '<body><p role="status" style="color:#ffd399">LOCAL PREVIEW · SYNTHETIC IMU · NO DEVICE CONNECTION</p>');
    },
    configureServer(server) {
      server.middlewares.use('/api/telemetry', (req, res) => {
        if (req.method !== 'GET') { res.statusCode = 405; res.end(); return; }
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify({ schema: 'gamexr.direct-wifi/v1', session: 1,
          age_ms: 0, actuation_available: false, sample: {
            profile: 'gamexr.usb-diagnostics/v1', type: 'sample', seq: seq++,
            motor_gate_command: 'low_held', imu: { status: 'ok',
              accel_m_s2: [0, 0, 9.80665], gyro_rad_s: [0, 0, 0] },
            battery: { status: 'unverified', battery_mv: null },
          } }));
      });
    },
  }],
};
