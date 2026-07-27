#include "shrooly_touch.h"

#include "esphome/core/hal.h"
#include "esphome/core/log.h"

#include <Arduino.h>

#include <algorithm>
#include <array>
#include <cmath>

namespace esphome {
namespace shrooly_touch {

static const char *const TAG = "shrooly_touch";
static constexpr uint8_t PRESS_DEBOUNCE_SAMPLES = 2;
static constexpr uint8_t RELEASE_DEBOUNCE_SAMPLES = 20;
static constexpr uint32_t DIAGNOSTIC_INTERVAL_MS = 1000;
static constexpr float BASELINE_TRACKING_RATE = 0.0005f;
static constexpr float NOISE_TRACKING_RATE = 0.005f;
static constexpr float RELEASE_THRESHOLD_RATIO = 0.45f;
static constexpr float CALIBRATION_NOISE_FLOOR_PERCENT = 0.02f;

void ShroolyTouchComponent::set_button_sensor(
    size_t index, binary_sensor::BinarySensor *value) {
  if (index < CHANNEL_COUNT)
    this->button_sensors_[index] = value;
}

void ShroolyTouchComponent::set_raw_sensor(size_t index,
                                           sensor::Sensor *value) {
  if (index < CHANNEL_COUNT)
    this->raw_sensors_[index] = value;
}

void ShroolyTouchComponent::set_baseline_sensor(size_t index,
                                                sensor::Sensor *value) {
  if (index < CHANNEL_COUNT)
    this->baseline_sensors_[index] = value;
}

void ShroolyTouchComponent::set_delta_sensor(size_t index,
                                             sensor::Sensor *value) {
  if (index < CHANNEL_COUNT)
    this->delta_sensors_[index] = value;
}

void ShroolyTouchComponent::set_noise_sensor(size_t index,
                                             sensor::Sensor *value) {
  if (index < CHANNEL_COUNT)
    this->noise_sensors_[index] = value;
}

void ShroolyTouchComponent::set_threshold_sensor(size_t index,
                                                 sensor::Sensor *value) {
  if (index < CHANNEL_COUNT)
    this->threshold_sensors_[index] = value;
}

void ShroolyTouchComponent::setup() {
  if (this->backend_sensor_ != nullptr)
    this->backend_sensor_->publish_state("ESP32-S3 adaptive touch");

  for (auto *button : this->button_sensors_) {
    if (button != nullptr)
      button->publish_initial_state(false);
  }

  this->reset_calibration_(millis());
}

void ShroolyTouchComponent::dump_config() {
  ESP_LOGCONFIG(TAG, "Adaptive Shrooly Touch:");
  ESP_LOGCONFIG(TAG, "  Pins: GPIO10, GPIO11, GPIO12, GPIO13");
  ESP_LOGCONFIG(TAG, "  Sample interval: %" PRIu32 " ms",
                this->sample_interval_ms_);
  ESP_LOGCONFIG(TAG, "  Warmup: %" PRIu32 " ms", this->warmup_duration_ms_);
  ESP_LOGCONFIG(TAG, "  Calibration samples: %u",
                this->calibration_sample_target_);
  ESP_LOGCONFIG(TAG, "  Minimum threshold: %.2f%%",
                this->minimum_threshold_percent_);
  ESP_LOGCONFIG(TAG, "  Noise multiplier: %.1f", this->noise_multiplier_);
}

void ShroolyTouchComponent::request_recalibration() {
  this->recalibration_requested_ = true;
}

void ShroolyTouchComponent::reset_calibration_(uint32_t now) {
  if (this->pressed_channel_ >= 0)
    this->release_channel_(this->pressed_channel_, now);

  this->state_ = State::WARMING_UP;
  this->state_started_ms_ = now;
  this->last_sample_ms_ = 0;
  this->calibration_sample_count_ = 0;
  this->pressed_channel_ = -1;
  this->press_counts_.fill(0);
  this->release_counts_.fill(0);
  this->baseline_.fill(0.0f);
  this->raw_delta_percent_.fill(0.0f);
  this->delta_percent_.fill(0.0f);
  this->noise_percent_.fill(CALIBRATION_NOISE_FLOOR_PERCENT);
  this->threshold_percent_.fill(this->minimum_threshold_percent_);
  this->publish_calibration_status_("Warming up");
  ESP_LOGI(TAG, "Touch calibration starting; leave the top buttons untouched");
}

void ShroolyTouchComponent::loop() {
  const uint32_t now = millis();

  if (this->recalibration_requested_) {
    this->recalibration_requested_ = false;
    this->reset_calibration_(now);
  }

  if (now - this->last_sample_ms_ < this->sample_interval_ms_)
    return;
  this->last_sample_ms_ = now;

  if (this->state_ == State::WARMING_UP) {
    if (now - this->state_started_ms_ < this->warmup_duration_ms_)
      return;
    this->state_ = State::CALIBRATING;
    this->state_started_ms_ = now;
    this->publish_calibration_status_("Calibrating");
  }

  if (!this->read_all_channels_()) {
    if (now - this->invalid_read_log_ms_ > 5000) {
      ESP_LOGW(TAG, "Touch read returned invalid data; calibration paused");
      this->invalid_read_log_ms_ = now;
    }
    return;
  }

  if (this->state_ == State::CALIBRATING) {
    this->collect_calibration_sample_();
    if (this->calibration_sample_count_ >= this->calibration_sample_target_)
      this->finish_calibration_();
  } else {
    this->process_ready_sample_(now);
  }

  this->publish_diagnostics_(now);
}

bool ShroolyTouchComponent::read_all_channels_() {
  bool valid = true;
  for (size_t i = 0; i < CHANNEL_COUNT; i++) {
    this->raw_[i] = static_cast<uint32_t>(touchRead(this->pins_[i]));
    valid = valid && this->raw_[i] > 0;
  }
  return valid;
}

void ShroolyTouchComponent::collect_calibration_sample_() {
  if (this->calibration_sample_count_ >= MAX_CALIBRATION_SAMPLES)
    return;

  for (size_t i = 0; i < CHANNEL_COUNT; i++)
    this->calibration_data_[i][this->calibration_sample_count_] = this->raw_[i];
  this->calibration_sample_count_++;
}

void ShroolyTouchComponent::finish_calibration_() {
  for (size_t channel = 0; channel < CHANNEL_COUNT; channel++) {
    std::array<uint32_t, MAX_CALIBRATION_SAMPLES> values =
        this->calibration_data_[channel];
    auto end = values.begin() + this->calibration_sample_count_;
    std::sort(values.begin(), end);

    const size_t middle = this->calibration_sample_count_ / 2;
    const float median =
        (this->calibration_sample_count_ % 2 == 0)
            ? (static_cast<float>(values[middle - 1]) +
               static_cast<float>(values[middle])) /
                  2.0f
            : static_cast<float>(values[middle]);
    this->baseline_[channel] = median;

    std::array<uint32_t, MAX_CALIBRATION_SAMPLES> deviations{};
    for (size_t i = 0; i < this->calibration_sample_count_; i++)
      deviations[i] = static_cast<uint32_t>(
          std::fabs(static_cast<float>(values[i]) - median));
    auto deviation_end = deviations.begin() + this->calibration_sample_count_;
    std::sort(deviations.begin(), deviation_end);

    const float mad =
        (this->calibration_sample_count_ % 2 == 0)
            ? (static_cast<float>(deviations[middle - 1]) +
               static_cast<float>(deviations[middle])) /
                  2.0f
            : static_cast<float>(deviations[middle]);

    this->noise_percent_[channel] =
        std::max(CALIBRATION_NOISE_FLOOR_PERCENT,
                 1.4826f * mad / median * 100.0f);
    this->update_threshold_(channel);
  }

  this->state_ = State::READY;
  this->publish_calibration_status_("Ready");
  this->publish_diagnostics_(millis(), true);

  ESP_LOGI(TAG,
           "Touch ready: baselines %.0f/%.0f/%.0f/%.0f, thresholds "
           "%.2f/%.2f/%.2f/%.2f%%",
           this->baseline_[0], this->baseline_[1], this->baseline_[2],
           this->baseline_[3], this->threshold_percent_[0],
           this->threshold_percent_[1], this->threshold_percent_[2],
           this->threshold_percent_[3]);
}

void ShroolyTouchComponent::process_ready_sample_(uint32_t now) {
  for (size_t i = 0; i < CHANNEL_COUNT; i++) {
    if (this->baseline_[i] <= 0.0f)
      return;
    this->raw_delta_percent_[i] =
        (static_cast<float>(this->raw_[i]) - this->baseline_[i]) /
        this->baseline_[i] * 100.0f;
  }

  const float common_delta = this->median_four_(this->raw_delta_percent_);
  for (size_t i = 0; i < CHANNEL_COUNT; i++)
    this->delta_percent_[i] =
        this->raw_delta_percent_[i] - common_delta;

  if (this->pressed_channel_ >= 0) {
    const size_t active = static_cast<size_t>(this->pressed_channel_);
    const float release_threshold =
        this->threshold_percent_[active] * RELEASE_THRESHOLD_RATIO;
    if (this->delta_percent_[active] < release_threshold) {
      if (++this->release_counts_[active] >= RELEASE_DEBOUNCE_SAMPLES)
        this->release_channel_(active, now);
    } else {
      this->release_counts_[active] = 0;
    }
    return;
  }

  int candidate = -1;
  float strongest_margin = 0.0f;
  for (size_t i = 0; i < CHANNEL_COUNT; i++) {
    const float margin = this->delta_percent_[i] - this->threshold_percent_[i];
    if (margin > strongest_margin) {
      candidate = static_cast<int>(i);
      strongest_margin = margin;
    }
  }

  for (size_t i = 0; i < CHANNEL_COUNT; i++) {
    if (static_cast<int>(i) == candidate) {
      if (++this->press_counts_[i] >= PRESS_DEBOUNCE_SAMPLES) {
        this->press_channel_(i, now);
        return;
      }
    } else {
      this->press_counts_[i] = 0;
    }
  }

  if (candidate >= 0)
    return;

  for (size_t i = 0; i < CHANNEL_COUNT; i++) {
    if (std::fabs(this->delta_percent_[i]) <
        this->threshold_percent_[i] * 0.75f) {
      this->baseline_[i] +=
          (static_cast<float>(this->raw_[i]) - this->baseline_[i]) *
          BASELINE_TRACKING_RATE;
      this->noise_percent_[i] =
          this->noise_percent_[i] * (1.0f - NOISE_TRACKING_RATE) +
          std::fabs(this->delta_percent_[i]) * NOISE_TRACKING_RATE;
      this->update_threshold_(i);
    }
  }
}

void ShroolyTouchComponent::press_channel_(size_t index, uint32_t now) {
  this->pressed_channel_ = static_cast<int8_t>(index);
  this->pressed_since_ms_ = now;
  this->press_counts_.fill(0);
  this->release_counts_.fill(0);

  ESP_LOGI(TAG,
           "Button %u pressed: raw=%" PRIu32
           " baseline=%.0f delta=%.2f%% threshold=%.2f%% noise=%.3f%%",
           static_cast<unsigned>(index + 1), this->raw_[index],
           this->baseline_[index], this->delta_percent_[index],
           this->threshold_percent_[index], this->noise_percent_[index]);

  if (this->button_sensors_[index] != nullptr)
    this->button_sensors_[index]->publish_state(true);
}

void ShroolyTouchComponent::release_channel_(size_t index, uint32_t now) {
  ESP_LOGI(TAG, "Button %u released after %" PRIu32 " ms",
           static_cast<unsigned>(index + 1), now - this->pressed_since_ms_);

  if (this->button_sensors_[index] != nullptr)
    this->button_sensors_[index]->publish_state(false);

  this->pressed_channel_ = -1;
  this->press_counts_.fill(0);
  this->release_counts_.fill(0);
}

void ShroolyTouchComponent::update_threshold_(size_t index) {
  this->threshold_percent_[index] =
      std::max(this->minimum_threshold_percent_,
               this->noise_percent_[index] * this->noise_multiplier_);
}

float ShroolyTouchComponent::median_four_(
    const std::array<float, CHANNEL_COUNT> &values) {
  std::array<float, CHANNEL_COUNT> sorted = values;
  std::sort(sorted.begin(), sorted.end());
  return (sorted[1] + sorted[2]) / 2.0f;
}

void ShroolyTouchComponent::publish_diagnostics_(uint32_t now, bool force) {
  if (!force &&
      now - this->last_diagnostic_publish_ms_ < DIAGNOSTIC_INTERVAL_MS)
    return;
  this->last_diagnostic_publish_ms_ = now;

  for (size_t i = 0; i < CHANNEL_COUNT; i++) {
    if (this->raw_sensors_[i] != nullptr)
      this->raw_sensors_[i]->publish_state(this->raw_[i]);
    if (this->baseline_sensors_[i] != nullptr)
      this->baseline_sensors_[i]->publish_state(this->baseline_[i]);
    if (this->delta_sensors_[i] != nullptr)
      this->delta_sensors_[i]->publish_state(this->delta_percent_[i]);
    if (this->noise_sensors_[i] != nullptr)
      this->noise_sensors_[i]->publish_state(this->noise_percent_[i]);
    if (this->threshold_sensors_[i] != nullptr)
      this->threshold_sensors_[i]->publish_state(
          this->threshold_percent_[i]);
  }
}

void ShroolyTouchComponent::publish_calibration_status_(const char *status) {
  if (this->calibration_status_sensor_ != nullptr)
    this->calibration_status_sensor_->publish_state(status);
}

}  // namespace shrooly_touch
}  // namespace esphome
