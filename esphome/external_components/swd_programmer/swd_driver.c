#include "swd_driver.h"
#include "esp_rom_sys.h"       // for esp_rom_delay_us
#include "freertos/FreeRTOS.h" // for FreeRTOS tasking (if needed later)
#include "freertos/task.h"
#include "driver/gpio.h"       // for gpio_* functions

// Heavily inspired by https://github.com/intechstudio/grid-fw/blob/master/grid_esp/components/grid_esp32_swd/grid_esp32_swd.c
// and traces from a Saleae logic analyzer of a known-working SWD session.

// -------------------- Timing --------------------
// Clock period for SWD bitbanging (in microseconds).
// RP2040 SWD can usually tolerate this speed; tune if needed.
#define SWD_CLOCK_PERIOD_US 1

// Global pins struct (populated once at swd_init_connection()).
static swd_pins_t g_pins;

// Delay helper for clocking/pacing signals.
static inline void dly(void){ esp_rom_delay_us(SWD_CLOCK_PERIOD_US); }

// -------------------- Pin control --------------------
// SWCLK pin control
static inline void clk_high(void){ gpio_set_level(g_pins.swclk, 1); }
static inline void clk_low (void){ gpio_set_level(g_pins.swclk, 0); }

// SWDIO pin control
static inline void dio_high(void){ gpio_set_level(g_pins.swdio, 1); }
static inline void dio_low (void){ gpio_set_level(g_pins.swdio, 0); }

// Switch SWDIO direction to output mode (driven by host)
static inline void dio_out(void){
  gpio_set_direction(g_pins.swdio, GPIO_MODE_OUTPUT);
  gpio_set_pull_mode(g_pins.swdio, GPIO_FLOATING);  // no pulls
}

// Switch SWDIO direction to input mode (driven by target)
static inline void dio_in(void){
  gpio_set_direction(g_pins.swdio, GPIO_MODE_INPUT);
  gpio_set_pull_mode(g_pins.swdio, GPIO_PULLUP_ONLY); // weak pull-up
}

// Sample SWDIO level
static inline int  dio_read(void){ return gpio_get_level(g_pins.swdio); }

// Reset pin control
static inline void rst_high(void){ gpio_set_level(g_pins.rst,   1); }
static inline void rst_low (void){ gpio_set_level(g_pins.rst,   0); }

// -------------------- Pin initialization --------------------
// Fully reset and configure one pin as output
static void init_pin_output(gpio_num_t pin, int level) {
  gpio_reset_pin(pin);
  gpio_hold_dis(pin);
  gpio_set_direction(pin, GPIO_MODE_OUTPUT);
  gpio_set_pull_mode(pin, GPIO_FLOATING);
  gpio_set_level(pin, level);
  gpio_set_drive_capability(pin, GPIO_DRIVE_CAP_3);  // strongest
}

// Fully reset and configure one pin as input with pull-up
static void init_pin_input_pullup(gpio_num_t pin) {
  gpio_reset_pin(pin);
  gpio_hold_dis(pin);
  gpio_set_direction(pin, GPIO_MODE_INPUT);
  gpio_set_pull_mode(pin, GPIO_PULLUP_ONLY);
}

// Perform a single SWD clock cycle (low→high→low).
static inline void swd_clock_cycle(){
  clk_high(); dly(); clk_low(); dly();
}

// -------------------- Bit-level primitives --------------------

// Write bits MSB-first (raw) — used for reset/magic sequences.
static void swd_write_raw(uint32_t data, uint8_t length){
  dio_out();
  for(uint8_t i=0;i<length;i++){
    int bit = (data >> (length-1-i)) & 1;
    if(bit) dio_high(); else dio_low();
    clk_low(); dly(); clk_high(); dly();
  }
  clk_low(); dio_low(); dly();
}

// Write bits LSB-first (normal SWD). Adds parity if 32 bits.
static void swd_write_bits(uint32_t data, uint8_t length){
  dio_out();
  uint32_t ones = 0;
  for(uint8_t i=0;i<length;i++){
    int bit = (data >> i) & 1;
    if(bit){ dio_high(); ones++; } else dio_low();
    clk_low(); dly(); clk_high(); dly();
  }
  clk_low();
  if(length==32){
    // Insert parity bit (even parity)
    if(ones & 1) dio_high(); else dio_low();
    dly(); clk_high(); dly(); clk_low();
  }
  dio_low(); dly();
}
static inline void swd_write(uint32_t data, uint8_t len){ swd_write_bits(data, len); }

// Read bits LSB-first. If 32 bits, include trailing turnaround cycle.
static uint32_t swd_read_bits(uint8_t length){
  dio_in();
  uint32_t result = dio_read();
  dly();
  for(uint8_t i=1;i<length;i++){
    clk_high(); dly(); clk_low();
    result |= ((uint32_t)dio_read() << i);
    dly();
  }
  if(length==32){ clk_high(); dly(); clk_low(); dly(); }
  return result;
}

// -------------------- SWD protocol helpers --------------------

// Drive at least 50 ones (line reset). Here: 7×8 = 56 bits.
static void swd_line_reset(){
  for(uint8_t i=0;i<7;i++){
    dly(); dio_high(); dly(); swd_write_raw(0xFF,8); dly(); dio_low(); dly();
  }
}

// Send idle cycles for bus settle.
static void swd_idle(){
  dly(); dly(); dly(); dly(); dly();
  dio_low();
  for(uint8_t i=0;i<8;i++){ clk_high(); dly(); clk_low(); dly(); }
  swd_clock_cycle();
}

// Switch bus direction host→target
static void swd_turnaround_to_target(){
  dio_in(); dly(); clk_high(); dly(); clk_low(); dly(); clk_high(); dly();
}

// Switch bus direction target→host
static void swd_turnaround_to_host(){
  clk_high(); dly(); clk_low(); dly(); dio_out();
}

// Read 3-bit ACK after a command (OK/WAIT/FAULT)
static uint8_t swd_read_ack(){
  uint8_t ack=0;
  for(uint8_t i=0;i<3;i++){
    clk_high(); dly();
    ack |= (uint8_t)dio_read() << (2-i);
    clk_low(); dly();
  }
  return ack;
}

// -------------------- DP (Debug Port) and AP (Access Port) accessors --------------------
// Each helper follows the SWD transaction sequence: send header, turnaround,
// read/write data, restore turnaround.



static uint32_t dp_read_idcode(){ swd_write_bits(SWD_DP_RD_IDCODE,8); swd_turnaround_to_target(); swd_read_ack(); uint32_t v=swd_read_bits(32); swd_turnaround_to_host(); return v; }
static uint32_t dp_read_dlcr(){ swd_write_raw(SWD_DP_RD_DLCR,8); swd_turnaround_to_target(); swd_read_ack(); uint32_t v=swd_read_bits(32); swd_turnaround_to_host(); return v; }
static uint32_t dp_read_ctrlstat(){ swd_write_raw(SWD_DP_RD_CTRLSTAT,8); swd_turnaround_to_target(); swd_read_ack(); uint32_t v=swd_read_bits(32); swd_turnaround_to_host(); return v; }
static uint32_t dp_read_rdbuff(){ swd_write_raw(SWD_DP_RD_RDBUFF,8); swd_turnaround_to_target(); swd_read_ack(); uint32_t v=swd_read_bits(32); swd_turnaround_to_host(); return v; }

static void dp_write_abort(uint32_t value){ swd_write(SWD_DP_WR_ABORT,8); swd_turnaround_to_target(); swd_read_ack(); swd_turnaround_to_host(); swd_write(value,32); }
static void dp_write_select(uint32_t value){ swd_write(SWD_DP_WR_SELECT,8); swd_turnaround_to_target(); swd_read_ack(); swd_turnaround_to_host(); swd_write(value,32); }
static void dp_write_ctrlstat(uint32_t value){ swd_write_raw(SWD_DP_WR_CTRLSTAT,8); swd_turnaround_to_target(); swd_read_ack(); swd_turnaround_to_host(); swd_write(value,32); }

static uint32_t ap_read_csw(){ swd_write_raw(SWD_AP_RD_CSW,8); swd_turnaround_to_target(); swd_read_ack(); uint32_t v=swd_read_bits(32); swd_turnaround_to_host(); return v; }
static uint32_t ap_read_tar(){ swd_write_raw(SWD_AP_RD_TAR,8); swd_turnaround_to_target(); swd_read_ack(); uint32_t v=swd_read_bits(32); swd_turnaround_to_host(); return v; }
static uint32_t ap_read_bd0(){ swd_write_raw(SWD_AP_RD_BD0,8); swd_turnaround_to_target(); swd_read_ack(); uint32_t v=swd_read_bits(32); swd_turnaround_to_host(); return v; }
static uint32_t ap_read_drw(){ swd_write_raw(SWD_AP_RD_DRW,8); swd_turnaround_to_target(); swd_read_ack(); uint32_t v=swd_read_bits(32); swd_turnaround_to_host(); return v; }

static void ap_write_csw(uint32_t value){ swd_write_raw(SWD_AP_WR_CSW,8); swd_turnaround_to_target(); swd_read_ack(); swd_turnaround_to_host(); swd_write(value,32); }
static void ap_write_tar(uint32_t value){ swd_write_raw(SWD_AP_WR_TAR,8); swd_turnaround_to_target(); swd_read_ack(); swd_turnaround_to_host(); swd_write(value,32); }
static void ap_write_bd0(uint32_t value){ swd_write_raw(SWD_AP_WR_BD0,8); swd_turnaround_to_target(); swd_read_ack(); swd_turnaround_to_host(); swd_write(value,32); }
static void ap_write_drw(uint32_t value){ swd_write_raw(SWD_AP_WR_DRW,8); swd_turnaround_to_target(); swd_read_ack(); swd_turnaround_to_host(); swd_write(value,32); }


uint32_t swd_dp_read_idcode(void) {
  return dp_read_idcode();
}

// -------------------- Extra helpers --------------------

// Vendor-specific "magic bytes" seen in traces, required before normal comms.
static void swd_send_magic_bytes(){
  static const uint8_t magic_bytes[] = {
    0xFF,0x49,0xCF,0x90,0x46,0xA9,0xB4,0xA1,0x61,0x97,
    0xF5,0xBB,0xC7,0x45,0x70,0x3D,0x98,0x05,0x8F
  };
  for(size_t i=0;i<sizeof(magic_bytes);i++) swd_write_raw(magic_bytes[i],8);
}

// Select which RP2040 core (0 or 1) to talk to by writing TARGETSEL.
static void swd_target_select(uint8_t core_id){
  swd_write_raw(0b10011001,8); // TARGETSEL write header
  swd_turnaround_to_target(); swd_read_ack(); swd_turnaround_to_host();
  if(core_id==0) swd_write(RP2040_CORE0_ID,32); else swd_write(RP2040_CORE1_ID,32);
}

// -------------------- Reset/config sequences --------------------

// Minimal reset/init sequence
static void swd_reset_basic(uint8_t core){
  swd_line_reset(); swd_idle(); swd_target_select(core); swd_clock_cycle();
  dp_read_idcode(); swd_clock_cycle();
  dp_write_abort(ABORT_CLEAR_STICKYERR); swd_clock_cycle();
  dp_read_ctrlstat(); swd_clock_cycle();
  ap_read_tar(); swd_clock_cycle();
  dp_read_rdbuff(); swd_clock_cycle();
}

// Configure TAR/AP pipeline
static void swd_configure_tar(uint8_t core){
  swd_line_reset(); swd_idle(); swd_target_select(core); swd_clock_cycle();
  dp_read_idcode(); swd_clock_cycle();
  dp_write_abort(ABORT_CLEAR_STICKYERR); swd_clock_cycle();
  dp_read_ctrlstat(); swd_clock_cycle();

  dp_write_select(DP_SELECT_BANKF3); swd_clock_cycle();
  ap_read_csw(); swd_idle(); dp_read_rdbuff(); swd_clock_cycle();

  dp_write_select(DP_SELECT_BANK3); swd_clock_cycle();
  ap_write_tar(TAR_A2000020); swd_clock_cycle();
  ap_write_bd0(0x00000000); swd_clock_cycle();
  ap_read_tar(); swd_clock_cycle();
  dp_read_rdbuff(); swd_clock_cycle();

  dp_write_select(DP_SELECT_BANKF3); swd_clock_cycle();
  ap_read_bd0(); swd_clock_cycle();
  dp_read_rdbuff(); swd_clock_cycle();
}

// Extra reset sequence involving DHCSR
static void swd_reset_additional(uint8_t core){
  swd_line_reset(); swd_idle(); swd_target_select(core); swd_clock_cycle();
  dp_read_idcode(); swd_clock_cycle();
  dp_write_abort(ABORT_CLEAR_STICKYERR); swd_clock_cycle();
  dp_write_select(DP_SELECT_BANK13); swd_clock_cycle();
  dp_read_dlcr(); swd_clock_cycle();
  dp_write_select(DP_SELECT_BANK3); swd_clock_cycle();
  ap_write_bd0(ADDR_DHCSR); swd_clock_cycle();
  dp_write_select(DP_SELECT_BANK13); swd_clock_cycle();
  ap_read_tar(); swd_clock_cycle();
  dp_read_rdbuff(); swd_clock_cycle();
}

// Configure trace/debug registers
static void swd_configure_trace(uint8_t core){
  swd_line_reset(); swd_idle(); swd_target_select(core); swd_clock_cycle();
  dp_read_idcode(); swd_clock_cycle();
  dp_write_abort(ABORT_CLEAR_STICKYERR); swd_clock_cycle();
  dp_read_dlcr(); swd_clock_cycle();
  ap_read_tar(); swd_clock_cycle();
  dp_read_rdbuff(); swd_clock_cycle();
  ap_read_csw(); swd_idle(); dp_read_rdbuff(); swd_clock_cycle();

  ap_write_drw(0x00000000); swd_clock_cycle();
  ap_read_tar(); swd_clock_cycle(); dp_read_rdbuff(); swd_clock_cycle();
  ap_write_csw(0x01000000); swd_clock_cycle();

  // (Remaining writes are vendor-specific init of trace regs)
  dp_write_select(DP_SELECT_BANK3); swd_clock_cycle();
  ap_write_tar(TAR_A2000012); swd_clock_cycle();
  ap_write_bd0(ADDR_2000); swd_clock_cycle();
  ap_write_csw(0x00000003); swd_clock_cycle();
  ap_write_bd0(ADDR_2000); swd_clock_cycle();
  ap_read_csw(); swd_idle(); dp_read_rdbuff(); swd_clock_cycle();

  ap_write_bd0(ADDR_2008); swd_clock_cycle();
  ap_write_csw(0x00000000); swd_clock_cycle(); ap_write_csw(0x00000000); swd_clock_cycle();
  ap_write_csw(0x00000000); swd_clock_cycle(); ap_write_csw(0x00000000); swd_clock_cycle();

  ap_write_bd0(ADDR_1020); swd_clock_cycle();
  ap_write_csw(0x00000000); swd_clock_cycle(); ap_write_csw(0x00000000); swd_clock_cycle();
  ap_write_csw(0x00000000); swd_clock_cycle();

  ap_write_bd0(ADDR_1030); swd_clock_cycle();
  ap_write_csw(0x00000000); swd_clock_cycle(); ap_write_csw(0x00000000); swd_clock_cycle();
  ap_write_csw(0x00000000); swd_clock_cycle();

  ap_write_bd0(ADDR_DHCSR); swd_clock_cycle();
  dp_write_select(DP_SELECT_BANK13); swd_clock_cycle();
  ap_read_tar(); swd_clock_cycle(); dp_read_rdbuff(); swd_clock_cycle();
}



// -------------------- Public entry points --------------------


// Fully initialize SWD interface pins and reset the RP2040 target
void swd_init_connection(const swd_pins_t *pins){

  // Save pin configuration globally so helper functions know what to use
  g_pins = *pins;

  // --- Configure pins ---
  // Set SWCLK as output, idle low (SWD clock idles low)
  init_pin_output(g_pins.swclk, 0);

  // Set SWDIO as output, start high.
  // We will flip this pin between input/output later during turnarounds.
  init_pin_output(g_pins.swdio, 1);

  // Set reset pin as output, start high (inactive).
  init_pin_output(g_pins.rst, 1);

  // --- Reset the RP2040 target device ---
  // Hold reset low for 10 ms
  rst_low();
  esp_rom_delay_us(10 * 1000);

  // Release reset high for 10 ms
  rst_high();
  esp_rom_delay_us(10 * 1000);

  // Extra 50 µs delay for stability
  esp_rom_delay_us(50);

  // --- Establish SWD connection sequence ---
  // Many ARM debug probes send a fixed "magic byte" sequence to ensure
  // the target leaves dormant state and responds properly.
  swd_send_magic_bytes();

  // Perform line resets + idle cycles to get bus into known state
  swd_line_reset();
  swd_idle();
  swd_line_reset();
  esp_rom_delay_us(5 * SWD_CLOCK_PERIOD_US);

  // One more idle + single cycle, then select core 0
  swd_idle();
  swd_clock_cycle();
  swd_target_select(0);
  swd_clock_cycle();

  // --- Debug Port (DP) initialization ---
  // Read the IDCODE (sanity check that the target is responding)
  dp_read_idcode();
  swd_clock_cycle();

  // Clear all sticky error bits in the DP
  dp_write_abort(ABORT_CLEAR_ALL);
  swd_clock_cycle();

  // Select bank 3 and read DLCR (Debug Line Control Register)
  dp_write_select(DP_SELECT_BANK3);
  swd_clock_cycle();
  dp_read_dlcr();
  swd_clock_cycle();

  // Back to bank 0 for normal use
  dp_write_select(DP_SELECT_BANK0);
  swd_clock_cycle();

  // Power-up request: request both debug and system power domains
  dp_write_ctrlstat(CTRLSTAT_PWRUPREQ);
  swd_clock_cycle();

  // Read CTRL/STAT to check if power-up acknowledged
  dp_read_ctrlstat();
  swd_clock_cycle();

  // Issue a system reset via CTRL/STAT
  dp_write_ctrlstat(CTRLSTAT_SYSRESET);
  swd_clock_cycle();

  // Read CTRL/STAT a few times until reset acknowledged
  dp_read_ctrlstat();
  swd_clock_cycle();
  dp_read_ctrlstat();
  swd_clock_cycle();
  dp_read_ctrlstat();
  swd_clock_cycle();

  // Finally enable debug (DebugEn bit in CTRL/STAT)
  dp_write_ctrlstat(CTRLSTAT_DEBUGEN);
  swd_clock_cycle();

  // Confirm debug is enabled by reading back CTRL/STAT
  dp_read_ctrlstat();
  swd_clock_cycle();
}

void perform_full_reset_sequence(const swd_pins_t *pins){
  (void)pins; // g_pins already set
  for(uint8_t c=0;c<2;c++) swd_reset_basic(c);
  for(uint8_t c=0;c<2;c++) swd_configure_tar(c);
  for(uint8_t c=0;c<2;c++) swd_reset_additional(c);
  for(uint8_t c=0;c<2;c++) swd_configure_trace(c);
}

void halt_cores(const swd_pins_t *pins){
  (void)pins;
  for(uint8_t core=0; core<2; core++){
    swd_line_reset(); swd_idle(); swd_target_select(core); swd_clock_cycle();
    dp_read_idcode(); swd_clock_cycle();
    dp_write_abort(ABORT_CLEAR_STICKYERR); swd_clock_cycle();
    dp_read_ctrlstat(); swd_clock_cycle();
    ap_read_tar(); swd_clock_cycle();
    dp_read_rdbuff(); swd_clock_cycle();
  }
  // extended halt for core 0
  swd_line_reset(); swd_idle(); swd_target_select(0); swd_clock_cycle();
  dp_read_idcode(); swd_clock_cycle();
  dp_write_abort(ABORT_CLEAR_STICKYERR); swd_clock_cycle();
  dp_read_ctrlstat(); swd_clock_cycle();

  ap_write_tar(0xA05F0003); swd_clock_cycle();  // halt request
  ap_read_tar(); swd_clock_cycle(); dp_read_rdbuff(); swd_clock_cycle();
  ap_write_tar(0xA05F0003); swd_clock_cycle();

  dp_write_select(DP_SELECT_BANK3); swd_clock_cycle();
  ap_write_bd0(ADDR_DFSR); swd_clock_cycle();
  dp_write_select(DP_SELECT_BANK13); swd_clock_cycle();
  ap_read_tar(); swd_clock_cycle(); dp_read_rdbuff(); swd_clock_cycle();

  ap_write_tar(0x00000001); swd_clock_cycle();         // debug enable
  dp_write_select(DP_SELECT_BANK3); swd_clock_cycle();
  ap_write_bd0(ADDR_DHCSR); swd_clock_cycle();
  dp_write_select(DP_SELECT_BANK13); swd_clock_cycle();
  ap_read_tar(); swd_clock_cycle(); dp_read_rdbuff(); swd_clock_cycle();

  // check core 1
  swd_line_reset(); swd_idle(); swd_target_select(1); swd_clock_cycle();
  dp_read_idcode(); swd_clock_cycle();
  dp_write_abort(ABORT_CLEAR_STICKYERR); swd_clock_cycle();
  dp_read_dlcr(); swd_clock_cycle();
  ap_read_tar(); swd_clock_cycle(); dp_read_rdbuff(); swd_clock_cycle();
}


void swd_program_sram(const swd_pins_t *pins, const uint8_t *buffer, uint32_t length){
  (void)pins;
  for(uint8_t core=0; core<2; core++){
    swd_line_reset(); swd_idle(); swd_target_select(core); swd_clock_cycle();
    dp_read_idcode(); swd_clock_cycle();
    dp_write_abort(ABORT_CLEAR_STICKYERR); swd_clock_cycle();
    dp_read_ctrlstat(); swd_clock_cycle();
    ap_read_tar(); swd_clock_cycle();
    dp_read_rdbuff(); swd_clock_cycle();
  }
  swd_line_reset(); swd_idle(); swd_target_select(0); swd_clock_cycle();
  dp_read_idcode(); swd_clock_cycle();
  dp_write_abort(ABORT_CLEAR_STICKYERR); swd_clock_cycle();
  dp_read_ctrlstat(); swd_clock_cycle();
  dp_write_select(DP_SELECT_BANK3); swd_clock_cycle();
  ap_write_bd0(TAR_SRAM_BASE); swd_clock_cycle();

  dp_write_select(DP_SELECT_BANK3); swd_clock_cycle();
  for(uint32_t i=0; i<length; i+=4){
    if((i % SRAM_PAGE_SIZE)==0){ ap_write_bd0(TAR_SRAM_BASE + i); swd_clock_cycle(); }
    uint32_t word = 0;
    // handle length not multiple of 4
    for(int b=0;b<4 && (i+b)<length;b++) word |= ((uint32_t)buffer[i+b]) << (8*b);
    ap_write_csw(word);
  }

  ap_write_bd0(ADDR_DHCSR); swd_clock_cycle();
  dp_write_select(DP_SELECT_BANK13); swd_clock_cycle();
  ap_read_tar(); swd_clock_cycle(); dp_read_rdbuff(); swd_clock_cycle();

  swd_line_reset(); swd_idle(); swd_target_select(1); swd_clock_cycle();
  dp_read_idcode(); swd_clock_cycle();
  dp_write_abort(ABORT_CLEAR_STICKYERR); swd_clock_cycle();
  dp_read_dlcr(); swd_clock_cycle();
  ap_read_tar(); swd_clock_cycle(); dp_read_rdbuff(); swd_clock_cycle();
}


void swd_resume_execution(const swd_pins_t *pins){
  (void)pins;
  for(uint8_t core=0; core<2; core++){
    swd_line_reset(); swd_idle(); swd_target_select(core); swd_clock_cycle();
    dp_read_idcode(); swd_clock_cycle();
    dp_write_abort(ABORT_CLEAR_STICKYERR); swd_clock_cycle();
    dp_read_ctrlstat(); swd_clock_cycle();
    ap_read_tar(); swd_clock_cycle(); dp_read_rdbuff(); swd_clock_cycle();
  }
  // core 0 entry point
  swd_line_reset(); swd_idle(); swd_target_select(0); swd_clock_cycle();
  dp_read_idcode(); swd_clock_cycle();
  dp_write_abort(ABORT_CLEAR_STICKYERR); swd_clock_cycle();
  dp_read_ctrlstat(); swd_clock_cycle();
  ap_write_drw(TAR_SRAM_BASE); swd_clock_cycle();
  ap_write_bd0(0x0001000F);    swd_clock_cycle();

  for(uint8_t core=0; core<=2; core++){
    swd_line_reset(); swd_idle();
    swd_target_select(core==2 ? 0 : core); swd_clock_cycle();
    dp_read_idcode(); swd_clock_cycle();
    dp_write_abort(ABORT_CLEAR_STICKYERR); swd_clock_cycle();
    dp_read_ctrlstat(); swd_clock_cycle();
    ap_write_tar(DHCSR_RESUME); swd_clock_cycle();
  }
}
