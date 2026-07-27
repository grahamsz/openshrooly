# OpenShrooly RP2040 coprocessor

The coprocessor samples the five tank electrodes, exposes their raw readings
over I²C, and generates the humidifier's 8 Hz PWM locally.

## Build

```bash
cmake -S coprocessor -B coprocessor/build \
  -DPICO_SDK_PATH=/path/to/pico-sdk \
  -DCMAKE_BUILD_TYPE=Release
cmake --build coprocessor/build --parallel
python3 coprocessor/embed_firmware.py \
  coprocessor/build/src/openshrooly_coprocessor.bin \
  esphome/external_components/swd_programmer/firmware.h
```

The target uses Pico SDK's `no_flash` binary type because the ESP32 loads it
into RP2040 SRAM over SWD during boot.

CI compiles the source and verifies that the embedded image carries the
current source digest.

## I²C register map

The slave address is `0x6C`. Multi-byte values are little-endian.

| Register | Access | Value |
|---|---|---|
| `0x03` | RO | 32-bit empty electrode reading |
| `0x07` | RO | 32-bit low electrode reading |
| `0x0B` | RO | 32-bit middle electrode reading |
| `0x0F` | RO | 32-bit high electrode reading |
| `0x13` | RO | 32-bit overflow electrode reading |
| `0x17` | RO | Protocol version |
| `0x18` | RW | Humidifier duty, clamped to 0–100% |
