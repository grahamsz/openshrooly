// programs.h - ESPHome-compatible lambdas converted from lua/programs
// Include this header in your ESPHome YAML using:
//   esphome:
//     includes:
//       - lambda/programs.h
// Then you can call helpers from lambda: |-
//   auto status = run_shrooly_program();
//   ESP_LOGI("program","%s", status.c_str());

#pragma once
#include "esphome.h"
#include <vector>
#include <string>

namespace shrooly {

static inline void set_white_led_percentage(float pct) {
  auto wl = id(white_led);
  if (!wl) return;
  if (pct <= 0.0f) wl->turn_off();
  else wl->turn_on().set_brightness(pct / 100.0f).perform();
}

static inline void set_rgb_color(int r, int g, int b) {
  auto rgb = id(rgb_led_strip);
  if (!rgb) return;
  if (r==0 && g==0 && b==0) { rgb->turn_off(); return; }
  rgb->turn_on().set_rgb(r/255.0f, g/255.0f, b/255.0f).perform();
}

static inline void set_fan_percentage(int pct) {
  auto fan = id(air_fan);
  if (!fan) return;
  if (pct <= 0) fan->turn_off();
  else fan->turn_on().set_percentage((float)pct).perform();
}

static inline void set_humidifier(bool on) {
  if (on) id(humidifier_fan).turn_on();
  else id(humidifier_fan).turn_off();
}

static inline float get_temperature() {
  return id(temp).state;
}
static inline float get_humidity() {
  return id(rh).state;
}

// Parameters are provided via YAML globals (see openshrooly_programs.yaml)
static inline void get_active_program_params(const int* &phases,
                                             const int* &speeds,
                                             int &period_s) {
  // Bind to active_* globals set by YAML select action
  phases = id(active_phases);
  speeds = id(active_speeds);
  period_s = id(active_period);
  // Safety: if period invalid, turn fan off using a minimal safe profile
  if (period_s <= 0) {
    static const int PHASES_OFF[10] = {0,0,0,0,0,0,0,0,0,1};
    static const int SPEEDS_OFF[10] = {0,0,0,0,0,0,0,0,0,0};
    phases = PHASES_OFF;
    speeds = SPEEDS_OFF;
    period_s = 1;
  }
}

static inline int adjust_target_rh(float current_temp) {
  float split = id(rh_temp_split_c);
  int below = id(rh_target_below_split);
  int at_or_above = id(rh_target_at_or_above_split);
  if (!std::isnan(current_temp) && current_temp < split) return below; else return at_or_above;
}

static inline void control_lighting(int sunrise_h_cfg, int photoperiod_h_cfg, int white_pct_cfg) {
  time_t now_s = id(sntp_time).now().timestamp;
  if (now_s <= 0) { set_white_led_percentage(0); set_rgb_color(0,0,0); return; }
  struct tm ti; localtime_r(&now_s, &ti);
  int h = ti.tm_hour;
  bool on = (h >= sunrise_h_cfg) && (h < sunrise_h_cfg + photoperiod_h_cfg);
  if (on) set_white_led_percentage((float)white_pct_cfg); else { set_white_led_percentage(0); set_rgb_color(0,0,0); }
}

static inline void control_fan(const int phases[10], const int speeds[10], int period_s) {
  uint32_t ms = millis();
  uint32_t t = (ms / 1000) % period_s;
  int accum = 0; int idx = 9;
  for (int i = 0; i < 10; i++) { accum += phases[i]; if ((int)t < accum) { idx = i; break; } }
  set_fan_percentage(speeds[idx]);
}

static inline void control_humidity() {
  float h = get_humidity();
  float t = get_temperature();
  int target = adjust_target_rh(t);
  if (!std::isnan(h)) set_humidifier(h < target);
}

// Run a tick of the selected program; returns a short status string
static inline std::string run_shrooly_program() {
  // Lighting each tick from YAML-configured globals
  int sunrise = id(sunrise_h);
  int photo = id(photoperiod_h);
  int w = id(white_pct);
  control_lighting(sunrise, photo, w);

  // Fan by program using YAML arrays
  const int *phases = nullptr; const int *speeds = nullptr; int period = 0;
  get_active_program_params(phases, speeds, period);
  control_fan(phases, speeds, period);

  // Humidity
  control_humidity();

  // Compose status (show display name)
  std::string disp = id(active_display_name);
  char buf[128];
  float t = get_temperature();
  float h = get_humidity();
  snprintf(buf, sizeof(buf), "program=%s T=%.1f H=%.1f", disp.c_str(), t, h);
  return std::string(buf);
}

} // namespace shrooly
