"""Passive bounded USB reader. No serial writes, console commands or deliberate resets."""
import argparse
import json
import re
import signal
import sys
import time
from serial_port import selected_port


def emit(**fields):
    print(json.dumps(fields, allow_nan=False), flush=True)


def stream(args):
    stopped = False

    def stop(_signum, _frame):
        nonlocal stopped
        stopped = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    deadline = time.monotonic() + args.seconds
    attempts, total = 0, 0
    while not stopped and time.monotonic() < deadline and attempts < 3:
        attempts += 1
        try:
            with selected_port(args) as port:
                emit(kind='link', status='connected', reason='USB connected', attempt=attempts)
                pending = bytearray()
                last_byte = time.monotonic()
                while not stopped and time.monotonic() < deadline:
                    chunk = port.read(256)
                    if chunk:
                        last_byte = time.monotonic()
                        total += len(chunk)
                        if total > 2_000_000:
                            raise RuntimeError('Session byte limit reached')
                        pending.extend(chunk)
                        while b'\n' in pending:
                            line, _, tail = pending.partition(b'\n')
                            pending = bytearray(tail)
                            if len(line) > 1024:
                                raise RuntimeError('Serial line exceeds limit')
                            if line.startswith(b'{'):
                                emit(kind='line', line=line.decode('utf-8', errors='strict').strip())
                        if len(pending) > 1024:
                            raise RuntimeError('Unterminated serial line exceeds limit')
                    elif time.monotonic() - last_byte > 5:
                        raise RuntimeError('USB data timeout')
        except Exception as error:
            emit(kind='link', status='disconnected', reason=str(error)[:160], attempt=attempts)
            if attempts < 3 and not stopped:
                until = min(deadline, time.monotonic() + attempts)
                while not stopped and time.monotonic() < until:
                    time.sleep(0.1)
        else:
            break
    emit(kind='link', status='disconnected', reason='Capture ended; start a new session to reconnect', attempts=attempts,
         serial_writes=0, bytes_read=total)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', required=True)
    parser.add_argument('--expect-usb-id', required=True)
    parser.add_argument('--seconds', type=int, default=60)
    parser.add_argument('--acknowledge-open-may-reset', action='store_true')
    args = parser.parse_args()
    if (not args.acknowledge_open_may_reset or not re.fullmatch(r'/dev/[^/]+', args.port)
            or not re.fullmatch(r'[0-9a-fA-F]{4}:[0-9a-fA-F]{4}', args.expect_usb_id)
            or not 10 <= args.seconds <= 600):
        parser.error('Select /dev port, USB VID:PID, duration 10..600 and existing physical/reset acknowledgment')
    try:
        stream(args)
    except BrokenPipeError:
        sys.exit(0)
