#pragma once

#include "esphome/components/binary_sensor/binary_sensor.h"
#include "esphome/components/sensor/sensor.h"
#include "esphome/components/text_sensor/text_sensor.h"
#include "esphome/core/automation.h"
#include "esphome/core/component.h"

#include <array>
#include <cinttypes>
#include <cstddef>
#include <cstdint>

namespace esphome {
namespace shrooly_touch {

class ShroolyTouchComponent : public Component {
 public:
  static constexpr size_t CHANNEL_COUNT = 4;
  static constexpr size_t MAX_CALIBRATION_SAMPLES = 128;

  void setup() override;
  void loop() override;
  void dump_config() override;
  float get_setup_priority() const override { return setup_priority::DATA; }

  void set_button_sensor(size_t index, binary_sensor::BinarySensor *value);
  void set_raw_sensor(size_t index, sensor::Sensor *value);
  void set_baseline_sensor(size_t index, sensor::Sensor *value);
  void set_delta_sensor(size_t index, sensor::Sensor *value);
  void set_noise_sensor(size_t index, sensor::Sensor *value);
  void set_threshold_sensor(size_t index, sensor::Sensor *value);
  void set_backend_sensor(text_sensor::TextSensor *value) {
    this->backend_sensor_ = value;
  }
  void set_calibration_status_sensor(text_sensor::TextSensor *value) {
    this->calibration_status_sensor_ = value;
  }

  void set_sample_interval(uint32_t value) { this->sample_interval_ms_ = value; }
  void set_warmup_duration(uint32_t value) { this->warmup_duration_ms_ = value; }
  void set_calibration_samples(uint16_t value) {
    this->calibration_sample_target_ = value;
  }
  void set_minimum_threshold(float value) {
    this->minimum_threshold_percent_ = value;
  }
  void set_noise_multiplier(float value) { this->noise_multiplier_ = value; }

  void request_recalibration();

 protected:
  enum class State : uint8_t {
    WARMING_UP,
    CALIBRATING,
    READY,
  };

  void reset_calibration_(uint32_t now);
  bool read_all_channels_();
  void collect_calibration_sample_();
  void finish_calibration_();
  void process_ready_sample_(uint32_t now);
  void publish_diagnostics_(uint32_t now, bool force = false);
  void publish_calibration_status_(const char *status);
  void press_channel_(size_t index, uint32_t now);
  void release_channel_(size_t index, uint32_t now);
  void update_threshold_(size_t index);

  static float median_four_(const std::array<float, CHANNEL_COUNT> &values);

  const std::array<uint8_t, CHANNEL_COUNT> pins_{{10, 11, 12, 13}};

  std::array<binary_sensor::BinarySensor *, CHANNEL_COUNT> button_sensors_{};
  std::array<sensor::Sensor *, CHANNEL_COUNT> raw_sensors_{};
  std::array<sensor::Sensor *, CHANNEL_COUNT> baseline_sensors_{};
  std::array<sensor::Sensor *, CHANNEL_COUNT> delta_sensors_{};
  std::array<sensor::Sensor *, CHANNEL_COUNT> noise_sensors_{};
  std::array<sensor::Sensor *, CHANNEL_COUNT> threshold_sensors_{};
  text_sensor::TextSensor *backend_sensor_{nullptr};
  text_sensor::TextSensor *calibration_status_sensor_{nullptr};

  std::array<uint32_t, CHANNEL_COUNT> raw_{};
  std::array<float, CHANNEL_COUNT> baseline_{};
  std::array<float, CHANNEL_COUNT> raw_delta_percent_{};
  std::array<float, CHANNEL_COUNT> delta_percent_{};
  std::array<float, CHANNEL_COUNT> noise_percent_{};
  std::array<float, CHANNEL_COUNT> threshold_percent_{};
  std::array<uint8_t, CHANNEL_COUNT> press_counts_{};
  std::array<uint8_t, CHANNEL_COUNT> release_counts_{};
  std::array<std::array<uint32_t, MAX_CALIBRATION_SAMPLES>, CHANNEL_COUNT>
      calibration_data_{};

  State state_{State::WARMING_UP};
  int8_t pressed_channel_{-1};
  uint16_t calibration_sample_count_{0};
  uint16_t calibration_sample_target_{128};
  uint32_t sample_interval_ms_{5};
  uint32_t warmup_duration_ms_{1000};
  uint32_t state_started_ms_{0};
  uint32_t last_sample_ms_{0};
  uint32_t last_diagnostic_publish_ms_{0};
  uint32_t pressed_since_ms_{0};
  uint32_t invalid_read_log_ms_{0};
  float minimum_threshold_percent_{1.2f};
  float noise_multiplier_{8.0f};
  bool recalibration_requested_{false};
};

class RecalibrateAction : public Action<> {
 public:
  explicit RecalibrateAction(ShroolyTouchComponent *parent) : parent_(parent) {}
  void play() override { this->parent_->request_recalibration(); }

 protected:
  ShroolyTouchComponent *parent_;
};

}  // namespace shrooly_touch
}  // namespace esphome
