"""Parse the observed ESP32 console display profile; never manufacture SI units."""
import math
import re

PROFILE = 'esp32-console-observation/v1'
MAX_RESPONSE_BYTES = 16384
IMU_FIELDS = {'status', 'model', 'who am I', 'rate', 'gyro', 'acc', 'raw gyro',
              'raw acc', 'gyro bias', 'accel bias', 'accel scale', 'landed'}


def text(data):
    if len(data) > MAX_RESPONSE_BYTES:
        raise ValueError('Response exceeds profile limit')
    decoded = data.decode('utf-8', errors='strict').strip()
    if any(ord(c) < 32 and c not in '\r\n\t' for c in decoded):
        raise ValueError('Unexpected control characters')
    return decoded


def number(value):
    result = float(value)
    if not math.isfinite(result):
        raise ValueError('Nonfinite telemetry')
    return result


def vector(value):
    parts = value.split()
    if len(parts) != 3:
        raise ValueError('Expected three axes')
    return [number(item) for item in parts]


def parse_imu(data):
    fields = {}
    for line in text(data).splitlines():
        key, separator, value = line.partition(': ')
        if not separator or key not in IMU_FIELDS or key in fields:
            raise ValueError('Unexpected, duplicate or malformed IMU field')
        fields[key] = value
    if set(fields) != IMU_FIELDS:
        raise ValueError('Incomplete IMU report')
    if fields['status'] != 'OK' or fields['model'] != 'MPU-6500' or fields['who am I'].lower() != '0x70':
        raise ValueError('Unhealthy IMU or unsupported reported identity')
    if fields['landed'] not in ('0', '1'):
        raise ValueError('Invalid landed flag')
    rate = number(fields['rate'])
    if rate <= 0:
        raise ValueError('Invalid reported rate')
    return {'status': fields['status'], 'model': fields['model'], 'who_am_i': '0x70',
            'rate_reported': rate, 'rate_unit': None,
            'gyro': vector(fields['gyro']), 'acceleration': vector(fields['acc']),
            'raw_gyro': vector(fields['raw gyro']), 'raw_acceleration': vector(fields['raw acc']),
            'gyro_bias': vector(fields['gyro bias']), 'accel_bias': vector(fields['accel bias']),
            'accel_scale': vector(fields['accel scale']), 'vector_units': None,
            'landed_reported': fields['landed'] == '1',
            'evidence': 'firmware-console; units and physical state not independently verified'}


def parse_motors(data):
    match = re.fullmatch(r'front-right (\S+) front-left (\S+) rear-right (\S+) rear-left (\S+)', text(data))
    if not match:
        raise ValueError('Unexpected motor output format')
    return {'reported': dict(zip(('front_right', 'front_left', 'rear_right', 'rear_left'),
                                 (number(item) for item in match.groups()))),
            'units': None, 'physical_measurement': False}


def frame(imu, motors, source, sequence, session):
    return {'schema': PROFILE, 'kind': 'observation', 'source': source,
            'session': session, 'sequence': sequence, 'imu': parse_imu(imu),
            'motors': parse_motors(motors), 'actuation_available': False,
            'arming_state': None, 'battery_volts': None}
