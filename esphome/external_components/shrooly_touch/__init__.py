import esphome.codegen as cg
import esphome.config_validation as cv
from esphome import automation
from esphome.components import binary_sensor, sensor, text_sensor
from esphome.const import CONF_ID


AUTO_LOAD = ["binary_sensor", "sensor", "text_sensor"]
DEPENDENCIES = ["esp32"]
MULTI_CONF = False

CONF_BUTTONS = "buttons"
CONF_RAW_SENSORS = "raw_sensors"
CONF_BASELINE_SENSORS = "baseline_sensors"
CONF_DELTA_SENSORS = "delta_sensors"
CONF_NOISE_SENSORS = "noise_sensors"
CONF_THRESHOLD_SENSORS = "threshold_sensors"
CONF_BACKEND = "backend"
CONF_CALIBRATION_STATUS = "calibration_status"
CONF_SAMPLE_INTERVAL = "sample_interval"
CONF_WARMUP_DURATION = "warmup_duration"
CONF_CALIBRATION_SAMPLES = "calibration_samples"
CONF_MINIMUM_THRESHOLD = "minimum_threshold"
CONF_NOISE_MULTIPLIER = "noise_multiplier"

shrooly_touch_ns = cg.esphome_ns.namespace("shrooly_touch")
ShroolyTouchComponent = shrooly_touch_ns.class_(
    "ShroolyTouchComponent", cg.Component
)
RecalibrateAction = shrooly_touch_ns.class_(
    "RecalibrateAction", automation.Action
)


def exactly_four(schema):
    return cv.All(cv.ensure_list(schema), cv.Length(min=4, max=4))


CONFIG_SCHEMA = cv.Schema(
    {
        cv.GenerateID(): cv.declare_id(ShroolyTouchComponent),
        cv.Required(CONF_BUTTONS): exactly_four(
            binary_sensor.binary_sensor_schema()
        ),
        cv.Required(CONF_RAW_SENSORS): exactly_four(
            sensor.sensor_schema(
                accuracy_decimals=0,
                entity_category="diagnostic",
            )
        ),
        cv.Required(CONF_BASELINE_SENSORS): exactly_four(
            sensor.sensor_schema(
                accuracy_decimals=0,
                entity_category="diagnostic",
            )
        ),
        cv.Required(CONF_DELTA_SENSORS): exactly_four(
            sensor.sensor_schema(
                unit_of_measurement="%",
                accuracy_decimals=2,
                entity_category="diagnostic",
            )
        ),
        cv.Required(CONF_NOISE_SENSORS): exactly_four(
            sensor.sensor_schema(
                unit_of_measurement="%",
                accuracy_decimals=3,
                entity_category="diagnostic",
            )
        ),
        cv.Required(CONF_THRESHOLD_SENSORS): exactly_four(
            sensor.sensor_schema(
                unit_of_measurement="%",
                accuracy_decimals=2,
                entity_category="diagnostic",
            )
        ),
        cv.Required(CONF_BACKEND): text_sensor.text_sensor_schema(
            entity_category="diagnostic"
        ),
        cv.Required(CONF_CALIBRATION_STATUS): text_sensor.text_sensor_schema(
            entity_category="diagnostic"
        ),
        cv.Optional(CONF_SAMPLE_INTERVAL, default="5ms"):
            cv.positive_time_period_milliseconds,
        cv.Optional(CONF_WARMUP_DURATION, default="1s"):
            cv.positive_time_period_milliseconds,
        cv.Optional(CONF_CALIBRATION_SAMPLES, default=128):
            cv.int_range(min=32, max=128),
        cv.Optional(CONF_MINIMUM_THRESHOLD, default=1.2):
            cv.float_range(min=0.1, max=20.0),
        cv.Optional(CONF_NOISE_MULTIPLIER, default=8.0):
            cv.float_range(min=2.0, max=20.0),
    }
).extend(cv.COMPONENT_SCHEMA)


async def to_code(config):
    var = cg.new_Pvariable(config[CONF_ID])
    await cg.register_component(var, config)

    for index, button_config in enumerate(config[CONF_BUTTONS]):
        button = await binary_sensor.new_binary_sensor(button_config)
        cg.add(var.set_button_sensor(index, button))

    for key, setter in (
        (CONF_RAW_SENSORS, var.set_raw_sensor),
        (CONF_BASELINE_SENSORS, var.set_baseline_sensor),
        (CONF_DELTA_SENSORS, var.set_delta_sensor),
        (CONF_NOISE_SENSORS, var.set_noise_sensor),
        (CONF_THRESHOLD_SENSORS, var.set_threshold_sensor),
    ):
        for index, sensor_config in enumerate(config[key]):
            diagnostic_sensor = await sensor.new_sensor(sensor_config)
            cg.add(setter(index, diagnostic_sensor))

    backend = await text_sensor.new_text_sensor(config[CONF_BACKEND])
    cg.add(var.set_backend_sensor(backend))

    calibration_status = await text_sensor.new_text_sensor(
        config[CONF_CALIBRATION_STATUS]
    )
    cg.add(var.set_calibration_status_sensor(calibration_status))

    cg.add(
        var.set_sample_interval(
            config[CONF_SAMPLE_INTERVAL].total_milliseconds
        )
    )
    cg.add(
        var.set_warmup_duration(
            config[CONF_WARMUP_DURATION].total_milliseconds
        )
    )
    cg.add(var.set_calibration_samples(config[CONF_CALIBRATION_SAMPLES]))
    cg.add(var.set_minimum_threshold(config[CONF_MINIMUM_THRESHOLD]))
    cg.add(var.set_noise_multiplier(config[CONF_NOISE_MULTIPLIER]))


RECALIBRATE_ACTION_SCHEMA = cv.maybe_simple_value(
    {
        cv.Required(CONF_ID): cv.use_id(ShroolyTouchComponent),
    },
    key=CONF_ID,
)


@automation.register_action(
    "shrooly_touch.recalibrate",
    RecalibrateAction,
    RECALIBRATE_ACTION_SCHEMA,
    synchronous=True,
)
async def recalibrate_action_to_code(config, action_id, template_arg, args):
    parent = await cg.get_variable(config[CONF_ID])
    return cg.new_Pvariable(action_id, parent)
