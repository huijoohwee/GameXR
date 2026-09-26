"""Protocol rejection and replay checks; no serial port opened by these tests."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from contextlib import contextmanager
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools/drone-telemetry'))
import diagnostics_stream
from console_protocol import MAX_RESPONSE_BYTES, frame, parse_imu, parse_motors

# Shape from observed device output; numeric values below are synthetic test data.
IMU = b'''status: OK
model: MPU-6500
who am I: 0x70
rate: 1000
gyro: 0.1 0.2 0.3
acc: 0 0 9.8
raw gyro: 0 0 0
raw acc: 0 0 9.7
gyro bias: 0 0 0
accel bias: 0 0 0
accel scale: 1 1 1
landed: 1
'''
MOT = b'front-right 0 front-left 0 rear-right 0 rear-left 0\n'


class ProtocolTests(unittest.TestCase):
    def test_observation_does_not_claim_units_arming_or_physical_outputs(self):
        result = frame(IMU, MOT, 'replay', 1, 'test-session')
        self.assertIsNone(result['imu']['vector_units'])
        self.assertIsNone(result['imu']['rate_unit'])
        self.assertIsNone(result['arming_state'])
        self.assertFalse(result['motors']['physical_measurement'])
        self.assertFalse(result['actuation_available'])
        self.assertEqual(result['motors']['reported']['rear_left'], 0)
        json.dumps(result, allow_nan=False)

    def test_rejects_incomplete_wrong_identity_unhealthy_or_unsolicited_data(self):
        cases = [IMU[:-11], IMU.replace(b'0x70', b'0x71'),
                 IMU.replace(b'status: OK', b'status: ERROR'),
                 IMU + b'password: private\n', IMU + b'landed: 1\n',
                 b'Setup Motors\n' + IMU, IMU.replace(b'landed: 1', b'landed: 2')]
        for data in cases:
            with self.subTest(data=data[:20]), self.assertRaises(ValueError):
                parse_imu(data)

    def test_rejects_nonfinite_numbers_and_bad_axis_count(self):
        for value in (b'nan', b'inf', b'-inf'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                parse_imu(IMU.replace(b'0.1', value))
            with self.assertRaises(ValueError):
                parse_motors(MOT.replace(b'front-right 0', b'front-right ' + value))
        with self.assertRaises(ValueError):
            parse_imu(IMU.replace(b'acc: 0 0 9.8', b'acc: 0 9.8'))

    def test_rejects_caps_binary_and_motor_format_drift(self):
        for data in (b'x' * (MAX_RESPONSE_BYTES + 1), b'\xff', IMU + b'\x00'):
            with self.assertRaises(ValueError):
                parse_imu(data)
        for data in (MOT + b'armed: 1\n', MOT.replace(b'rear-left', b'rear-right')):
            with self.assertRaises(ValueError):
                parse_motors(data)

    def test_replay_is_not_fresh_live_telemetry_and_issues_no_commands(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'imu.txt').write_bytes(IMU)
            (root / 'mot.txt').write_bytes(MOT)
            output = root / 'result'
            process = subprocess.run([sys.executable, '-B', str(ROOT / 'tools/drone-telemetry/usb_observe.py'),
                '--replay', str(root), '--output', str(output)], capture_output=True, text=True, timeout=10)
            self.assertEqual(process.returncode, 0, process.stderr)
            record = json.loads(process.stdout)
            self.assertEqual(record['source'], 'replay')
            self.assertIsNone(record['observed_at'])
            receipt = json.loads((output / 'receipt.json').read_text())
            self.assertEqual(receipt['commands'], [])
            self.assertEqual(receipt['status'], 'complete')
            self.assertEqual((output / '01-observation.json').stat().st_mode & 0o077, 0)

    def test_live_requires_identity_and_setup_acknowledgment_before_output(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / 'result'
            process = subprocess.run([sys.executable, '-B', str(ROOT / 'tools/drone-telemetry/usb_observe.py'),
                '--port', '/dev/nonexistent', '--output', str(output)],
                capture_output=True, text=True, timeout=10)
            self.assertEqual(process.returncode, 2)
            self.assertFalse(output.exists())


class PassiveStreamTests(unittest.TestCase):
    def run_stream(self, chunks):
        events, closed, clock = [], [], [0.0]
        class Port:
            def read(self, _size):
                clock[0] += 0.5
                return chunks.pop(0) if chunks else b''
            def write(self, _data):
                raise AssertionError('Passive reader attempted a write')
        @contextmanager
        def selected(_args):
            try:
                yield Port()
            finally:
                closed.append(True)
        def sleep(seconds):
            clock[0] += seconds
        with patch.object(diagnostics_stream, 'selected_port', selected), \
             patch.object(diagnostics_stream, 'emit', lambda **event: events.append(event)), \
             patch.object(diagnostics_stream.signal, 'signal'), \
             patch.object(diagnostics_stream.time, 'monotonic', lambda: clock[0]), \
             patch.object(diagnostics_stream.time, 'sleep', sleep):
            diagnostics_stream.stream(SimpleNamespace(seconds=60))
        return events, closed

    def test_passive_fragmented_lines_timeout_reconnect_and_release(self):
        events, closed = self.run_stream([b'boot log\n{"a":', b'1}\n{"b":2}\n'])
        self.assertEqual([e['line'] for e in events if e['kind'] == 'line'], ['{"a":1}', '{"b":2}'])
        self.assertEqual(len(closed), 3)
        self.assertEqual(events[-1]['attempts'], 3)
        self.assertEqual(events[-1]['serial_writes'], 0)
        self.assertTrue(any(e.get('reason') == 'USB data timeout' for e in events))

    def test_oversized_unterminated_line_closes_handle_without_forwarding(self):
        events, closed = self.run_stream([b'{' + b'x' * 1024])
        self.assertFalse(any(e['kind'] == 'line' for e in events))
        self.assertEqual(len(closed), 3)
        self.assertTrue(any('exceeds limit' in e.get('reason', '') for e in events))


if __name__ == '__main__':
    unittest.main()
