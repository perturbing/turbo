// Protocol constants verified against real hardware logs in bt-comm-test/blezwift/logs.

export const SVC_FTMS = 0x1826;
export const CHR_INDOOR_BIKE_DATA = 0x2ad2; // notify
export const CHR_FTMS_CONTROL_POINT = 0x2ad9; // write + indicate
export const CHR_FTMS_STATUS = 0x2ada; // notify (never observed firing on the KICKR)
export const CHR_FTMS_FEATURE = 0x2acc; // read
export const CHR_SUPPORTED_POWER_RANGE = 0x2ad8; // read
export const CHR_SUPPORTED_RESISTANCE_RANGE = 0x2ad6; // read

export const SVC_CYCLING_POWER = 0x1818;
export const CHR_CYCLING_POWER_MEASUREMENT = 0x2a63; // notify

export const SVC_HEART_RATE = 0x180d;
export const CHR_HEART_RATE_MEASUREMENT = 0x2a37; // notify

export const SVC_BATTERY = 0x180f;
export const CHR_BATTERY_LEVEL = 0x2a19;

export const SVC_DEVICE_INFO = 0x180a;

// KICKR: rider weight, used by the trainer's SIM-mode physics.
export const SVC_USER_DATA = 0x181c;
export const CHR_WEIGHT = 0x2a98; // u16 LE, 0.005 kg units, read + write

// The Zwift Ride pods expose their proprietary characteristics under the 16-bit
// vendor service 0xFC82. The 128-bit 00000001-19ca-… service UUID exists only on
// the KICKR's copy of the same characteristic set.
export const SVC_ZWIFT_RIDE = 0xfc82;
export const CHR_ZWIFT_ASYNC = '00000002-19ca-4651-86e5-fa29dcdd09d1'; // notify: controller state
export const CHR_ZWIFT_SYNC_RX = '00000003-19ca-4651-86e5-fa29dcdd09d1'; // write: "RideOn" handshake
export const CHR_ZWIFT_SYNC_TX = '00000004-19ca-4651-86e5-fa29dcdd09d1'; // indicate: handshake ack
