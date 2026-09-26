"""Shared exclusive serial selection for bounded console and passive observers."""
from contextlib import contextmanager
import fcntl
from pathlib import Path
import subprocess

@contextmanager
def selected_port(args):
    import serial
    from serial.tools import list_ports
    selected = [item for item in list_ports.comports() if item.device == args.port]
    vid, pid = [int(value, 16) for value in args.expect_usb_id.split(':')]
    if len(selected) != 1 or (selected[0].vid, selected[0].pid) != (vid, pid):
        raise RuntimeError('Selected port or USB identity changed')
    # USB IDs select a bridge model, not a cryptographically authenticated aircraft.
    lock_root = Path.home() / '.local/share/espressif/locks'
    lock_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock_name = Path(args.port).name + '.lock'
    with (lock_root / lock_name).open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        aliases = [args.port]
        if args.port.startswith('/dev/cu.'):
            aliases.append(args.port.replace('/dev/cu.', '/dev/tty.', 1))
        holder = subprocess.run(['lsof', '-nP', *aliases], capture_output=True,
                                text=True, timeout=5, check=False)
        if holder.returncode != 1 or holder.stdout.strip() or holder.stderr.strip():
            raise RuntimeError('Serial port is busy or ownership check failed')
        port = serial.Serial(port=None, baudrate=115200, timeout=0.1,
                             write_timeout=1, exclusive=True, rtscts=False, dsrdtr=False)
        port.dtr = False
        port.rts = False
        port.port = args.port
        with port:
            yield port

