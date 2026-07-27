add_executable(openshrooly_coprocessor main.c)

pico_generate_pio_header(
    openshrooly_coprocessor
    ${CMAKE_CURRENT_LIST_DIR}/capacitive.pio
)

target_link_libraries(
    openshrooly_coprocessor
    PRIVATE
    pico_stdlib
    hardware_clocks
    hardware_i2c
    hardware_pio
    hardware_pwm
    hardware_sync
    pico_i2c_slave
)

target_compile_options(
    openshrooly_coprocessor
    PRIVATE
    -Wall
    -Wextra
    -Werror
)

pico_enable_stdio_usb(openshrooly_coprocessor 0)
pico_enable_stdio_uart(openshrooly_coprocessor 0)
pico_set_binary_type(openshrooly_coprocessor no_flash)
pico_add_extra_outputs(openshrooly_coprocessor)
