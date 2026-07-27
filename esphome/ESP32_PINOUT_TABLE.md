# OpenShrooly ESP32-S3 Pinout Reference

## Board: ESP32-S3-DevKitC-1
**Hardware Version:** v0.04

## Pin Assignments

### Communication Buses

#### I2C Bus (bus_a)
| GPIO | Function | Details |
|------|----------|---------|
| GPIO36 | I2C SDA | Data line, 100kHz |
| GPIO35 | I2C SCL | Clock line, 100kHz |

**I2C Devices:**
- SHT4x Temperature/Humidity Sensor
- Humidifier Fan Controller (Address: 0x6C)

#### SPI Bus
| GPIO | Function | Details |
|------|----------|---------|
| GPIO7 | SPI CLK | Clock line for display |
| GPIO6 | SPI MOSI | Data line for display |

### Display (Waveshare 2.90" E-Paper)
| GPIO | Function | Details |
|------|----------|---------|
| GPIO8 | CS (Chip Select) | Display select |
| GPIO48 | DC (Data/Command) | Display control |
| GPIO38 | BUSY | Display busy signal |
| GPIO21 | RESET | Display reset |
| GPIO7 | SPI CLK | Shared SPI clock |
| GPIO6 | SPI MOSI | Shared SPI data |

### SWD Programming (RP2040 Coprocessor)
| GPIO | Function | Details |
|------|----------|---------|
| GPIO2 | SWD CLK | Clock line |
| GPIO1 | SWD DIO | Data I/O |
| GPIO41 | RESET | Reset line |

### Fan Control
| GPIO | Function | Details |
|------|----------|---------|
| GPIO37 | Fan PWM | Air exchange fan speed control (inverted) |
| GPIO14 | Fan Tachometer | RPM feedback (pull-up enabled) |

### LED Control
| GPIO | Function | Details |
|------|----------|---------|
| GPIO39 | White LED PWM | White LED strip control (inverted) |
| GPIO42 | RGB LED Data | WS2812 addressable LED strip (16 LEDs) |

### Audio
| GPIO | Function | Details |
|------|----------|---------|
| GPIO47 | Buzzer/RTTTL | Audio output for alerts |

### Analog Input
| GPIO | Function | Details |
|------|----------|---------|
| GPIO4 | VBUS ADC | System voltage monitoring (ADC_CHANNEL_3) |

## Important Notes

1. **PWM Outputs:** Fan PWM (GPIO37) and White LED PWM (GPIO39) are inverted (active low)
2. **I2C Frequency:** Bus operates at 100kHz for compatibility
3. **Pull-ups:** GPIO14 (Fan tach) has internal pull-up enabled
4. **RGB LED:** Uses ESP32 RMT peripheral for WS2812 protocol
5. **Display:** Waveshare 2.90inv2-r2 model with rotation set to 90°
6. **Humidifier Control:** Via I2C at address 0x6C
   - Register 0x18: Duty from 0–100%

## Peripheral Summary

| Peripheral | Connection Type | GPIOs Used |
|------------|----------------|------------|
| E-Paper Display | SPI + Control | 6, 7, 8, 21, 38, 48 |
| Temperature/Humidity | I2C | 35, 36 |
| Humidifier | I2C | 35, 36 |
| RP2040 Coprocessor | SWD | 1, 2, 41 |
| Air Exchange Fan | PWM + Tach | 14, 37 |
| White LEDs | PWM | 39 |
| RGB LEDs | Digital | 42 |
| Buzzer | PWM | 47 |
| Voltage Monitor | ADC | 4 |

## Power Requirements

- System monitors voltage via GPIO4 ADC
- Low voltage warning at <10V
- Display shows "POWER OFF" message when voltage is too low

## WiFi Configuration

- Creates AP "OpenShrooly" at 192.168.4.1 when not connected
- Supports station mode for home network connection
- Captive portal for easy setup

---

*Generated for OpenShrooly project - ESPHome configuration*
