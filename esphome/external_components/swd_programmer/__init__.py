# esphome/components/swd_programmer/__init__.py
import esphome.codegen as cg
import esphome.config_validation as cv

from esphome.components import text_sensor
import esphome.automation as automation
from esphome.const import CONF_ID

swd_ns = cg.esphome_ns.namespace("swd_programmer")
SWDProgrammer = swd_ns.class_("SWDProgrammer", cg.Component)
ProgramAction = swd_ns.class_("ProgramAction", automation.Action)  # <-- new

CONF_CLK = "clk_pin"
CONF_DIO = "dio_pin"
CONF_RST = "reset_pin"

# allow one instance, normal component schema
CONFIG_SCHEMA = cv.Schema({
    cv.GenerateID(): cv.declare_id(SWDProgrammer),
    cv.Optional(CONF_CLK): cv.int_range(min=0),
    cv.Optional(CONF_DIO): cv.int_range(min=0),
    cv.Optional(CONF_RST): cv.int_range(min=0),
    cv.Optional("status"): text_sensor.text_sensor_schema(),
}).extend(cv.COMPONENT_SCHEMA)

async def to_code(config):
    var = cg.new_Pvariable(config[CONF_ID])
    await cg.register_component(var, config)
    if CONF_CLK in config: cg.add(var.set_clk(config[CONF_CLK]))
    if CONF_DIO in config: cg.add(var.set_dio(config[CONF_DIO]))
    if CONF_RST in config: cg.add(var.set_rst(config[CONF_RST]))
    
    if "status" in config:
        sens = await text_sensor.new_text_sensor(config["status"])
        cg.add(var.set_status_text_sensor(sens))

PROGRAM_ACTION_SCHEMA = cv.Any(
    # Shorthand:
    #   - swd_programmer.program: swd
    cv.use_id(SWDProgrammer),

    # Explicit:
    #   - swd_programmer.program:
    #       id: swd
    cv.Schema({cv.Required(CONF_ID): cv.use_id(SWDProgrammer)}),
)

@automation.register_action(
    "swd_programmer.program",
    swd_ns.class_("ProgramAction", automation.Action),
    PROGRAM_ACTION_SCHEMA,
    synchronous=True,
)
async def swd_programmer_program_to_code(config, action_id, template_arg, args):
    # Resolve the parent SWDProgrammer instance regardless of schema form
    if isinstance(config, dict):
        parent = await cg.get_variable(config[CONF_ID])
    else:
        parent = await cg.get_variable(config)

    
    # Create ProgramAction(parent)
    var = cg.new_Pvariable(action_id, parent)
    return var
