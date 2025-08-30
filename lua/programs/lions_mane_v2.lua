-- File: lions_mane_v2.lua
-- This LUA recipe turns on the fan for fan_cycle_duration[0] seconds and turns it off for fan_cycle_duration[1].
-- RH is being controlled.
-- White LED (intensity is 5%%) is controlled; it is switched on between sunrise and sunrise+photoperiod (people call it sunset).
-- Name of the recipe is set (mushroomName).

println("Starting execution of: lions_mane_v2.lua")

-- Pod name and version information reported --
mushroomID    = "l-m-p"
mushroomName  = "Lion's Mane"
recipeVersion = 1
luaAPIVersion = 1 -- TBD: it would be great to get it from FW

set_recipe_version(recipeVersion)
set_mushroom_name(mushroomName)
set_mushroom_id(mushroomID)
---------------------------------------------

-----------------Constants-------------------
white_led_brightness             = 5          -- unit: percentage
photoperiod                      = 10         -- unit: hours
fan_cycle_period                 = 161        -- unit: seconds
---------------------------------------------

-----------------Variables-------------------
sunrise                          = 8          -- in hours (8:00 AM) TBD: get it from the config.json
deadline_epoch                   = get_start_epoch() + 86400  -- Example: 1 day after start
fan_phases                       = {7, 7, 7, 7, 45, 7, 7, 7, 7, 60}  -- duration of each phase in seconds, 10 sec is the minimum
fan_speeds                       = {10, 20, 30, 40, 50, 40, 30, 20, 10, 0}  -- fan speed percentage for each phase

-- Function to convert specific datetime to epoch (e.g., "2024-10-08 08:00:00" UTC)
function datetime_to_epoch(year, month, day, hour, min, sec)
    return os.time{year=year, month=month, day=day, hour=hour, min=min, sec=sec}
end

-- Tim-controlled start epoch (set to a specific datetime)
tim_control_start_epoch = datetime_to_epoch(2024, 10, 31, 10, 00, 00)  -- "2024-10-08 08:00:00" UTC
---------------------------------------------

-----------------Functions-------------------

function adjust_target_rh(current_temp)
    if current_temp < 21 then
        return 85  -- Lower humidity for cooler environments
    else
        return 90  -- Higher humidity for warmer environments
    end
end

function control_lighting(current_epoch)
    local current_hour = tonumber(os.date("%H", current_epoch))
    local current_minute = tonumber(os.date("%M", current_epoch))
    local current_second = tonumber(os.date("%S", current_epoch))

    local elapsed_seconds_today = current_second + (60 * current_minute) + (3600 * current_hour)

    local sunrise_seconds = sunrise * 60 * 60
    local sunset_seconds = sunrise_seconds + (photoperiod * 60 * 60)

    if ((sunrise_seconds <= elapsed_seconds_today) and (elapsed_seconds_today < sunset_seconds)) then
        println("(control_lighting) Current hour: ", current_hour, ", sunrise: ", sunrise, ", sunset: ", sunrise + photoperiod, ". Setting white LEDs to ", white_led_brightness, "%%")
        set_white_led_percentage(white_led_brightness)
    else
        println("(control_lighting) Current hour: ", current_hour, ", sunrise: ", sunrise, ", sunset: ", sunrise + photoperiod, ". Turn off white LEDs")
        set_white_led_percentage(0)
        set_rgb_color(0, 0, 0)
    end
end

function control_fan(current_epoch)
    local phase_time = current_epoch % fan_cycle_period
    local elapsed_time = 0

    for i = 1, #fan_phases do
        elapsed_time = elapsed_time + fan_phases[i]
        if phase_time < elapsed_time then
            println("(control_fan) Phase ", i, ", Time: ", phase_time, " - Setting fan to ", fan_speeds[i], "%%")
            set_fan_percentage(fan_speeds[i])
            return
        end
    end

    println("(control_fan) Phase out of bounds - turning off fan")
    set_fan_percentage(0)
end

function control_humidity(current_epoch)
    local current_rh = get_humidity()
    local current_temp = get_temperature()
    local adjusted_target_rh = adjust_target_rh(current_temp)

    println("(control_humidity) Current RH: ", current_rh, ", adjusted target RH: ", adjusted_target_rh, " based on temperature: ", current_temp)

    if current_rh < adjusted_target_rh then
        println("(control_humidity) Current RH is less than adjusted target RH, turning on humidifier")
        set_humidifier(1)
    else
        println("(control_humidity) Current RH is greater than adjusted target RH, turning off humidifier")
        set_humidifier(0)
    end
end
---------------------------------------------

local start_epoch          = get_start_epoch()
local current_epoch        = get_current_epoch()

set_elapsed_days((current_epoch - start_epoch) / 86400)
control_lighting(current_epoch)
control_fan(current_epoch)
control_humidity(current_epoch)
println("Cultivation program ended, next run in 1000 ms")