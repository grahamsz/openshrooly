#pragma once

#include "esphome/core/component.h"
#include "esphome/core/automation.h"
#include "esphome/components/text_sensor/text_sensor.h"

namespace esphome {
namespace swd_programmer {

class SWDProgrammer : public Component {
 public:
  // Attach the text sensor from Python (__init__.py)
  void set_status_text_sensor(text_sensor::TextSensor *s) { status_sensor_ = s; }

  void set_clk(int p) { clk_ = p; }
  void set_dio(int p) { dio_ = p; }
  void set_rst(int p) { rst_ = p; }


  void setup() override;
  void loop() override {}

  void program();  // launches FreeRTOS task

 protected:
  int clk_ = 2;
  int dio_ = 1;
  int rst_ = 41;

  static void task_trampoline(void *param);
  void task_body();

  // ✅ single source of truth: publishes "Idle", "Success", "Error"
  text_sensor::TextSensor *status_sensor_{nullptr};

  friend class ProgramAction;
};

class ProgramAction : public Action<> {
 public:
  explicit ProgramAction(SWDProgrammer *parent) : parent_(parent) {}
  void play() override { parent_->program(); }
 private:
  SWDProgrammer *parent_;
};

}  // namespace swd_programmer
}  // namespace esphome
