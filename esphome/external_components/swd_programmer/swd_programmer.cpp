// esphome/components/swd_programmer/swd_programmer.cpp
#include "swd_programmer.h"
#include "esphome/core/log.h"

extern "C" {
  #include "swd_driver.h"
  #include "freertos/FreeRTOS.h"
  #include "freertos/task.h"
}

#include "firmware.h"  // firmware_bin[], firmware_bin_len

namespace esphome {
namespace swd_programmer {

static const char *TAG = "swd_programmer";

// Pick a sensible core index; on ESP32-S3, 1 is the APP core.
#ifndef SWD_TASK_CORE
#define SWD_TASK_CORE 1
#endif

// 12 KiB stack gives plenty of headroom for bitbanging + logging
#ifndef SWD_TASK_STACK
#define SWD_TASK_STACK 12288
#endif

// --- Busy guard (shared across all instances) ---
static volatile bool swd_busy = false;

void SWDProgrammer::setup() {
  if (this->status_sensor_) {
    this->status_sensor_->publish_state("Not yet programmed");
  }
}


void SWDProgrammer::program() {

  if (swd_busy) {
    ESP_LOGW(TAG, "program(): already running, ignoring new request");
    return;
  }
  swd_busy = true;  // claim the bus

#if defined(ARDUINO_ARCH_ESP32) || defined(ESP_PLATFORM)

  #if (defined(CONFIG_FREERTOS_UNICORE) && CONFIG_FREERTOS_UNICORE)
    BaseType_t res = xTaskCreate(&SWDProgrammer::task_trampoline,
                                "swd_prog",
                                SWD_TASK_STACK,
                                this,
                                1,
                                nullptr);
    if (res != pdPASS) {
      ESP_LOGE(TAG, "program(): xTaskCreate failed (err=%d)", (int)res);
      swd_busy = false;  // release if creation failed
    }
  #else
    BaseType_t res = xTaskCreatePinnedToCore(&SWDProgrammer::task_trampoline,
                                            "swd_prog",
                                            SWD_TASK_STACK,
                                            this,
                                            1,
                                            nullptr,
                                            SWD_TASK_CORE);
    if (res != pdPASS) {
      ESP_LOGE(TAG, "program(): xTaskCreatePinnedToCore failed (err=%d)", (int)res);
      swd_busy = false;  // release if creation failed
    }
  #endif

#else
  ESP_LOGW(TAG, "program(): non-ESP32 platform, running synchronously");
  SWDProgrammer::task_trampoline(this);
#endif
}

void SWDProgrammer::task_trampoline(void *param) {
  static_cast<SWDProgrammer*>(param)->task_body();


  swd_busy = false;  // release when task exits
  vTaskDelete(nullptr);
}

void SWDProgrammer::task_body() {
  ESP_LOGI(TAG, "SWD start (clk=%d dio=%d rst=%d, %u bytes)",
          clk_, dio_, rst_, (unsigned) firmware_bin_len);
  vTaskDelay(1);  // yield ~1 ms

  swd_pins_t pins{ (gpio_num_t)clk_, (gpio_num_t)dio_, (gpio_num_t)rst_ };

  bool success = false;

  // Initialize and run programming sequence
  if (this->status_sensor_)
      this->status_sensor_->publish_state("Programming");
  swd_init_connection(&pins);

  perform_full_reset_sequence(&pins);
  halt_cores(&pins);
  swd_program_sram(&pins, firmware_bin, (uint32_t)firmware_bin_len);
  swd_resume_execution(&pins);

  // Basic IDCODE check
  uint32_t id = swd_dp_read_idcode();
  if (id == 0x0BC12477) {
    success = true;
  }

  if (success) {
    ESP_LOGI(TAG, "SWD programming finished successfully");
    if (this->status_sensor_)
      this->status_sensor_->publish_state("Success");
  } else {
    ESP_LOGE(TAG, "SWD programming failed (bad IDCODE 0x%08X)", id);
    if (this->status_sensor_)
      this->status_sensor_->publish_state("Error");


  }

  vTaskDelay(100);  // yield ~100 ms so logs can propagate
}

}  // namespace swd_programmer
}  // namespace esphome
