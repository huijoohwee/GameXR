"""Bounded command/acknowledgment tests for verified 0.3.0, with no motor actuation."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import time
from serial_port import selected_port  # Existing shared exclusive USB owner, via PYTHONPATH.


def require(value, message):
    if not value:
        raise RuntimeError(message)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', required=True)
    parser.add_argument('--port', default='/dev/cu.usbserial-110')
    parser.add_argument('--expect-usb-id', default='1a86:7523')
    parser.add_argument('--allow-bench-commands', action='store_true')
    args = parser.parse_args()
    require(args.allow_bench_commands, 'Explicit diagnostic-write grant required')
    os.umask(0o077)
    root = Path(args.out)
    root.mkdir(mode=0o700)
    events, checks = [], []
    receipt = {'schema': 'gamexr/usb-bench-live-tests/v1', 'status': 'running',
               'motor_actuation': False, 'flash_writes': 0, 'command_count': 0,
               'checks': checks, 'source_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    started = time.monotonic()
    total = 0
    port = None

    def expired(*_):
        raise TimeoutError('90-second operation limit')

    def read_until(predicate, timeout=2):
        nonlocal total
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            raw = port.readline(1025)
            total += len(raw)
            require(total < 490000, 'Capture byte cap')
            if not raw:
                continue
            require(len(raw) <= 1024, 'Oversize response')
            if not raw.startswith(b'{') or not raw.endswith(b'\n'):
                continue
            frame = json.loads(raw)
            events.append({'elapsed_ms': round((time.monotonic()-started)*1000), 'frame': frame})
            if frame.get('profile') == 'gamexr.usb-bench/v1':
                require(frame.get('outputs_enabled') is False, 'Unexpected output authority')
                if frame.get('type') == 'ack':
                    require(frame.get('motor_outputs') == [0, 0, 0, 0], 'Nonzero motor report')
            if predicate(frame):
                return frame
        raise TimeoutError('Expected response missing')

    def send(command, expected):
        # Respect the documented >=50 ms SET cadence, including UART TX time.
        time.sleep(.065)
        encoded = (command+'\n').encode('ascii')
        require(port.write(encoded) == len(encoded), 'Short command write')
        port.flush()
        receipt['command_count'] += 1
        frame = read_until(lambda f: f.get('profile') == 'gamexr.usb-bench/v1'
                          and f.get('type') == 'ack' and f.get('status') == expected)
        if expected != 'accepted':
            require(frame['active'] is False and frame['virtual_motors'] == [0]*4, 'Fault did not clear state')
        return frame

    def hello():
        return send('GXR1 HELLO', 'ready')['session']

    def setpoint(session, seq, values='100 0 0 0', expected='accepted'):
        return send(f'GXR1 SET {session} {seq} {values}', expected)

    def check(name):
        checks.append(name)

    signal.signal(signal.SIGALRM, expired)
    signal.alarm(90)
    try:
        with selected_port(args) as opened:
            port = opened
            ready = read_until(lambda f: f.get('profile') == 'gamexr.usb-bench/v1' and f.get('type') == 'ready', 5)
            require(ready.get('version') == '0.3.0' and ready.get('uart_code') == 0, 'Wrong firmware/receiver')
            receipt['ready'] = ready
            read_until(lambda f: f.get('type') == 'sample' and f.get('imu', {}).get('status') == 'ok')
            session = hello()
            a = setpoint(session, 1)
            require(a['active'] and all(0 <= x <= 200 for x in a['virtual_motors']), 'Invalid virtual mix')
            check('hello-and-set-ack')
            setpoint(session, 1, expected='sequence'); check('duplicate-sequence-rejected')
            session = hello(); setpoint(session, 2)
            setpoint(session, 1, expected='sequence'); check('out-of-order-rejected')
            old = session; session = hello()
            setpoint(old, 3, expected='session'); check('old-session-rejected')
            session = hello(); setpoint(session, 1, '201 0 0 0', 'range'); check('throttle-range-rejected')
            session = hello(); setpoint(session, 1, '100 1001 0 0', 'range'); check('axis-range-rejected')
            session = hello()
            send(f'GXR1 SET {session} 1 100 0 0 0\nGXR1 SET {session} 2 100 0 0 0', 'rate_limited')
            check('burst-rate-rejected')
            hello(); send('GXR1 SET nan', 'malformed'); check('malformed-rejected')
            hello(); send('X'*110, 'framing'); check('oversize-rejected')
            hello()
            port.write(b'GXR1 SET '); port.flush(); receipt['command_count'] += 1
            a = read_until(lambda f: f.get('status') == 'partial_timeout')
            require(not a['active'] and a['virtual_motors'] == [0]*4, 'Partial frame retained authority')
            port.write(b'\n'); check('partial-frame-expiry')
            session = hello(); setpoint(session, 1); send('GXR1 STOP', 'stopped'); check('explicit-stop')
            delays = []
            for _ in range(20):
                session = hello(); setpoint(session, 1)
                began = time.monotonic()
                a = read_until(lambda f: f.get('status') == 'expired', 1)
                delays.append(round((time.monotonic()-began)*1000, 2))
                require(delays[-1] <= 400, 'Expiry report exceeded bounded host observation limit')
                require(not a['active'] and a['virtual_motors'] == [0]*4, 'Lease expiry failed')
                setpoint(session, 2, expected='session')
            receipt['expiry_observation_ms_after_ack'] = delays
            check('20-of-20-command-silence-expiries-and-no-auto-resume')
            session = hello()
            for seq, values in enumerate(['100 400 0 0', '100 0 -400 0', '100 0 0 400', '0 1000 -1000 1000'], 1):
                a = setpoint(session, seq, values)
                require(all(0 <= x <= 200 for x in a['virtual_motors']), 'Mixer limit violation')
            require(a['virtual_motors'] == [0]*4, 'Zero throttle did not zero mixer')
            check('live-imu-logical-mixer-and-zero-throttle')
            send('GXR1 STOP', 'stopped')
        port = None
        # Closing the host reader is not a physical cable-unplug test. The stale session
        # must also be rejected after reopen, regardless of USB-driver reset behavior.
        time.sleep(.4)
        with selected_port(args) as opened:
            port = opened
            read_until(lambda f: f.get('type') == 'sample' and f.get('profile') == 'gamexr.usb-diagnostics/v1', 5)
            setpoint(session, 100, expected='session')
            send('GXR1 STOP', 'stopped')
            check('host-close-reopen-stale-session-rejected')
        port = None
        receipt['status'] = 'passed'
    except BaseException as error:
        receipt['status'] = 'failed'
        receipt['error'] = f'{type(error).__name__}: {error}'
    finally:
        signal.alarm(0)
        receipt['elapsed_seconds'] = round(time.monotonic()-started, 3)
        receipt['read_bytes'] = total
        receipt['port_closed'] = port is None or not port.is_open
        receipt['limits'] = {'seconds': 90, 'bytes': 490000, 'frame_bytes': 1024}
        (root/'events.jsonl').write_text(''.join(json.dumps(e)+'\n' for e in events))
        (root/'receipt.json').write_text(json.dumps(receipt, indent=2)+'\n')
    print(json.dumps(receipt, indent=2))
    return 0 if receipt['status'] == 'passed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
