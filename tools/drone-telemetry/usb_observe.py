"""Headless telemetry only: fixed imu/mot display requests, or offline log replay."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import signal
import sys
import time
import uuid

from console_protocol import MAX_RESPONSE_BYTES, frame, parse_imu, parse_motors
from serial_port import selected_port


class ResponseError(ValueError):
    def __init__(self, message, data):
        super().__init__(message)
        self.data = data


def timestamp():
    return datetime.now(timezone.utc).isoformat()


def collect(port, parser=None, seconds=6):
    data = bytearray()
    deadline = time.monotonic() + seconds
    valid_at = None
    while time.monotonic() < deadline:
        chunk = port.read(min(4096, MAX_RESPONSE_BYTES + 1 - len(data)))
        if chunk:
            data.extend(chunk)
            if len(data) > MAX_RESPONSE_BYTES:
                raise ResponseError('Serial response exceeded cap', bytes(data))
            valid_at = None
            if parser is not None:
                try:
                    parser(bytes(data))
                    valid_at = time.monotonic()
                except (ValueError, UnicodeDecodeError):
                    pass
        elif parser is not None and valid_at is not None and time.monotonic() - valid_at >= 0.3:
            return bytes(data)
    if parser is not None:
        try:
            parser(bytes(data))  # Fail on empty, partial or changed protocol.
        except ValueError as error:
            raise ResponseError('Incomplete or unsupported console response', bytes(data)) from error
    return bytes(data)




def expired(signum, frame):
    raise TimeoutError('Observer reached operation time limit')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--port', help='Explicit selected serial path; never auto-selects')
    mode.add_argument('--replay', type=Path, help='Directory containing imu.txt and mot.txt')
    parser.add_argument('--expect-usb-id', help='Required for live mode, e.g. 1a86:7523')
    parser.add_argument('--acknowledge-open-may-reset', action='store_true',
                        help='Use only with propellers removed and motor power isolated from USB')
    parser.add_argument('--samples', type=int, choices=range(1, 6), default=1, metavar='1..5')
    parser.add_argument('--output', type=Path, required=True, help='New local evidence directory')
    args = parser.parse_args()
    if args.port and (not args.acknowledge_open_may_reset or not args.expect_usb_id):
        parser.error('Live observation requires explicit USB identity and reset/physical-setup acknowledgment')
    if args.port:
        import re
        if not re.fullmatch(r'[0-9a-fA-F]{4}:[0-9a-fA-F]{4}', args.expect_usb_id):
            parser.error('USB identity must have four hexadecimal digits for VID and PID')
        if not args.port.startswith('/dev/') or '/' in args.port[5:]:
            parser.error('Use a direct /dev serial path')
    os.umask(0o077)
    args.output.mkdir(mode=0o700, parents=True, exist_ok=False)
    session = str(uuid.uuid4())
    receipt = {'schema': 'gamexr/usb-observer-receipt/v1', 'session': session,
               'started_at': timestamp(), 'mode': 'usb' if args.port else 'replay',
               'selected_port': args.port, 'usb_id': args.expect_usb_id,
               'commands': [], 'status': 'running', 'deliberate_resets': 0,
               'actuation_commands': 0, 'configuration_writes': 0, 'flash_commands': 0,
               'output_files': [], 'samples_requested': args.samples}
    signal.signal(signal.SIGALRM, expired)
    signal.alarm(90)

    def save(name, data):
        (args.output / name).write_bytes(data)
        receipt['output_files'].append({'name': name, 'bytes': len(data),
                                       'sha256': hashlib.sha256(data).hexdigest()})

    def emit(imu, mot, index, observed_at, source):
        result = frame(imu, mot, source, index, session)
        result['observed_at'] = observed_at
        result['recorded_at'] = timestamp()
        result['simultaneous_sample'] = False
        payload = (json.dumps(result, allow_nan=False) + '\n').encode()
        save(f'{index:02d}-imu.txt', imu)
        save(f'{index:02d}-mot.txt', mot)
        save(f'{index:02d}-observation.json', payload)
        print(payload.decode().strip(), flush=True)

    try:
        if args.replay:
            for index in range(1, args.samples + 1):
                # Replayed acquisition time is unknown; do not label it as fresh live data.
                imu_path, mot_path = args.replay / 'imu.txt', args.replay / 'mot.txt'
                if any(p.stat().st_size > MAX_RESPONSE_BYTES for p in (imu_path, mot_path)):
                    raise ValueError('Replay input exceeds cap')
                emit(imu_path.read_bytes(), mot_path.read_bytes(), index, None, 'replay')
        else:
            with selected_port(args) as port:
                # Retain and ignore startup text. Opening may reset via OS/driver line behavior.
                save('startup-private.txt', collect(port, seconds=3))
                for index in range(1, args.samples + 1):
                    responses = []
                    observed_at = timestamp()
                    for command, parse in ((b'imu\n', parse_imu), (b'mot\n', parse_motors)):
                        if port.in_waiting:
                            raise RuntimeError('Unsolicited serial output; refusing to mix samples')
                        receipt['commands'].append({'wire_hex': command.hex(), 'sent_at': timestamp()})
                        if port.write(command) != len(command):
                            raise RuntimeError('Partial serial command write')
                        port.flush()
                        responses.append(collect(port, parse))
                    emit(*responses, index, observed_at, 'device-console')
        receipt['status'] = 'complete'
    except (Exception, KeyboardInterrupt) as error:
        receipt['status'] = 'failed'
        receipt['error'] = f'{type(error).__name__}: {error}'
        if isinstance(error, ResponseError):
            save('failed-response-private.bin', error.data)
        print(receipt['error'], file=sys.stderr)
    finally:
        signal.alarm(0)
        receipt['finished_at'] = timestamp()
        (args.output / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    return 0 if receipt['status'] == 'complete' else 1


if __name__ == '__main__':
    raise SystemExit(main())
