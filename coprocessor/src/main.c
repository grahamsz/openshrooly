#include "capacitive.pio.h"

#include <hardware/clocks.h>
#include <hardware/gpio.h>
#include <hardware/i2c.h>
#include <hardware/pio.h>
#include <hardware/pwm.h>
#include <hardware/sync.h>
#include <pico/i2c_slave.h>
#include <pico/stdlib.h>
#include <stdbool.h>
#include <stdint.h>

// The ESP32 and RP2040 share the same 100 kHz I2C bus as the environmental
// sensor. The RP2040 is a slave and must keep its interrupt handler short so it
// never delays transactions addressed to another device.
#define I2C_ADDRESS 0x6C
#define I2C_SDA_PIN 16
#define I2C_SCL_PIN 17

// The humidifier accepts an 8 Hz duty-cycle signal. Its nearby indicator is a
// simple on/off output that follows whether a nonzero duty is active.
#define HUMIDIFIER_PIN 19
#define HUMIDIFIER_LED_PIN 11

// Tank electrodes are ordered from the bottom of the tank to the overflow
// detector. Each is sampled independently by a PIO state machine.
#define CAP_EMPTY_PIN 2
#define CAP_LOW_PIN 3
#define CAP_MID_PIN 4
#define CAP_HIGH_PIN 5
#define CAP_OVERFLOW_PIN 6

// Register values are byte-addressed. Each capacitance reading occupies four
// consecutive bytes in little-endian order, followed by the two one-byte
// control/diagnostic values consumed by the ESP32.
#define REG_CAP_EMPTY 0x03
#define REG_CAP_LOW 0x07
#define REG_CAP_MID 0x0B
#define REG_CAP_HIGH 0x0F
#define REG_CAP_OVERFLOW 0x13
#define REG_PROTOCOL_VERSION 0x17
#define REG_HUMIDIFIER_DUTY 0x18

#define PROTOCOL_VERSION 0x02
#define SENSOR_UPDATE_INTERVAL_MS 3000
#define HUMIDIFIER_PWM_FREQUENCY_HZ 8

static PIO cap_pio = pio0;
static PIO cap_pio_extra = pio1;

// The I2C callback runs in interrupt context while the main loop refreshes
// sensor values and applies duty changes. Volatile prevents register accesses
// from being cached across those two execution contexts.
static struct {
    volatile uint8_t registers[REG_HUMIDIFIER_DUTY + 1];
    uint8_t address;
    bool address_written;
} context;

static void set_humidifier_duty_register(uint8_t duty) {
    if (duty > 100) {
        duty = 100;
    }
    context.registers[REG_HUMIDIFIER_DUTY] = duty;
}

// Implement the conventional register-pointer transaction used by ESPHome:
// the first received byte selects an address, subsequent bytes write, and read
// requests return bytes while advancing that address. Humidifier duty is the
// only writable register; unsupported reads return zero.
static void i2c_slave_handler(i2c_inst_t *i2c, i2c_slave_event_t event) {
    switch (event) {
        case I2C_SLAVE_RECEIVE: {
            uint8_t value = (uint8_t) i2c_get_hw(i2c)->data_cmd;
            if (!context.address_written) {
                context.address = value;
                context.address_written = true;
            } else {
                if (context.address == REG_HUMIDIFIER_DUTY) {
                    set_humidifier_duty_register(value);
                }
                context.address++;
            }
            break;
        }

        case I2C_SLAVE_REQUEST:
            i2c_get_hw(i2c)->data_cmd =
                context.address <= REG_HUMIDIFIER_DUTY
                    ? context.registers[context.address]
                    : 0;
            context.address++;
            break;

        case I2C_SLAVE_FINISH:
            context.address_written = false;
            break;
    }
}

// Store a sensor value in the wire format expected by the ESP32.
static void store_u32(uint8_t address, uint32_t value) {
    context.registers[address] = (uint8_t) value;
    context.registers[address + 1] = (uint8_t) (value >> 8);
    context.registers[address + 2] = (uint8_t) (value >> 16);
    context.registers[address + 3] = (uint8_t) (value >> 24);
}

static void read_capacitive_sensors(void) {
    // PIO0 provides four state machines. The fifth electrode uses PIO1.
    pio_sm_set_enabled(cap_pio, 0, true);
    pio_sm_set_enabled(cap_pio, 1, true);
    pio_sm_set_enabled(cap_pio, 2, true);
    pio_sm_set_enabled(cap_pio, 3, true);
    pio_sm_set_enabled(cap_pio_extra, 0, true);

    uint32_t overflow = UINT32_MAX - pio_sm_get_blocking(cap_pio, 0);
    uint32_t high = UINT32_MAX - pio_sm_get_blocking(cap_pio, 1);
    uint32_t mid = UINT32_MAX - pio_sm_get_blocking(cap_pio, 2);
    uint32_t low = UINT32_MAX - pio_sm_get_blocking(cap_pio, 3);
    uint32_t empty = UINT32_MAX - pio_sm_get_blocking(cap_pio_extra, 0);

    pio_sm_set_enabled(cap_pio, 0, false);
    pio_sm_set_enabled(cap_pio, 1, false);
    pio_sm_set_enabled(cap_pio, 2, false);
    pio_sm_set_enabled(cap_pio, 3, false);
    pio_sm_set_enabled(cap_pio_extra, 0, false);

    // Publish all five readings as one snapshot. Pausing interrupts for these
    // short stores prevents an I2C read from combining two sample generations.
    uint32_t interrupt_state = save_and_disable_interrupts();
    store_u32(REG_CAP_EMPTY, empty);
    store_u32(REG_CAP_LOW, low);
    store_u32(REG_CAP_MID, mid);
    store_u32(REG_CAP_HIGH, high);
    store_u32(REG_CAP_OVERFLOW, overflow);
    restore_interrupts(interrupt_state);
}

static uint16_t humidifier_pwm_wrap;

static void init_humidifier_pwm(void) {
    gpio_set_function(HUMIDIFIER_PIN, GPIO_FUNC_PWM);

    // A large divider keeps the PWM wrap value within 16 bits at 8 Hz while
    // preserving enough resolution for integer percentage commands.
    uint slice = pwm_gpio_to_slice_num(HUMIDIFIER_PIN);
    pwm_config config = pwm_get_default_config();
    const float divider = 250.0f;
    humidifier_pwm_wrap =
        (uint16_t) (clock_get_hz(clk_sys) / (divider * HUMIDIFIER_PWM_FREQUENCY_HZ) - 1);

    pwm_config_set_clkdiv(&config, divider);
    pwm_config_set_wrap(&config, humidifier_pwm_wrap);
    pwm_init(slice, &config, true);
    pwm_set_gpio_level(HUMIDIFIER_PIN, 0);
}

static void apply_humidifier_duty(uint8_t duty) {
    uint32_t level = ((uint32_t) humidifier_pwm_wrap + 1) * duty / 100;
    pwm_set_gpio_level(HUMIDIFIER_PIN, (uint16_t) level);
    gpio_put(HUMIDIFIER_LED_PIN, duty > 0);
}

static void init_capacitive_sensors(void) {
    // Pull-ups charge the electrodes while PIO briefly switches each pin to an
    // output-low state between measurements.
    const uint8_t pins[] = {
        CAP_EMPTY_PIN,
        CAP_LOW_PIN,
        CAP_MID_PIN,
        CAP_HIGH_PIN,
        CAP_OVERFLOW_PIN,
    };
    for (size_t i = 0; i < sizeof(pins); i++) {
        gpio_init(pins[i]);
        gpio_pull_up(pins[i]);
    }

    // Keep the electrode-to-register ordering explicit: PIO0 is assigned from
    // overflow downward, while PIO1 handles the bottom "empty" electrode.
    uint offset = pio_add_program(cap_pio, &capacitive_program);
    uint extra_offset = pio_add_program(cap_pio_extra, &capacitive_program);
    capacitive_program_init(cap_pio, 0, offset, CAP_OVERFLOW_PIN);
    capacitive_program_init(cap_pio, 1, offset, CAP_HIGH_PIN);
    capacitive_program_init(cap_pio, 2, offset, CAP_MID_PIN);
    capacitive_program_init(cap_pio, 3, offset, CAP_LOW_PIN);
    capacitive_program_init(cap_pio_extra, 0, extra_offset, CAP_EMPTY_PIN);
}

int main(void) {
    // Static storage starts at zero, so all readings are safe until the first
    // sample completes and the humidifier always starts disabled.
    context.registers[REG_PROTOCOL_VERSION] = PROTOCOL_VERSION;
    set_humidifier_duty_register(0);

    i2c_init(i2c0, 100000);
    gpio_set_function(I2C_SDA_PIN, GPIO_FUNC_I2C);
    gpio_set_function(I2C_SCL_PIN, GPIO_FUNC_I2C);
    gpio_pull_up(I2C_SDA_PIN);
    gpio_pull_up(I2C_SCL_PIN);
    i2c_slave_init(i2c0, I2C_ADDRESS, i2c_slave_handler);

    gpio_init(HUMIDIFIER_LED_PIN);
    gpio_set_dir(HUMIDIFIER_LED_PIN, GPIO_OUT);
    gpio_put(HUMIDIFIER_LED_PIN, 0);

    init_humidifier_pwm();
    init_capacitive_sensors();
    read_capacitive_sensors();

    uint8_t applied_duty = UINT8_MAX;
    uint32_t last_sensor_update = to_ms_since_boot(get_absolute_time());

    while (true) {
        // Only touch the PWM peripheral when the ESP32 changes the requested
        // duty. The register itself remains readable as command feedback.
        uint8_t requested_duty = context.registers[REG_HUMIDIFIER_DUTY];
        if (requested_duty != applied_duty) {
            apply_humidifier_duty(requested_duty);
            applied_duty = requested_duty;
        }

        uint32_t now = to_ms_since_boot(get_absolute_time());
        // Unsigned subtraction keeps the interval correct across timer wrap.
        if (now - last_sensor_update >= SENSOR_UPDATE_INTERVAL_MS) {
            read_capacitive_sensors();
            last_sensor_update = now;
        }

        tight_loop_contents();
        sleep_ms(1);
    }
}
