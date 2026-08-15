'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { api } from '../lib/esphome-api'

interface EntityState {
  [key: string]: {
    value: number | string | boolean
    state: string
  }
}

interface ModalState {
  type: 'humidity' | 'temperature' | 'air' | 'light' | 'water' | 'settings' | 'calibrate' | null
}

export default function Dashboard() {
  const [entities, setEntities] = useState<EntityState>({})
  const [loading, setLoading] = useState(true)
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date())
  const [modal, setModal] = useState<ModalState>({ type: null })
  const [timezone, setTimezone] = useState<string>('')
  const [timezoneOptions, setTimezoneOptions] = useState<string[]>([])
  const [timezoneUpdating, setTimezoneUpdating] = useState(false)
  const [timezoneError, setTimezoneError] = useState('')
  const [flipScreen, setFlipScreen] = useState(false)
  const [calibrationSuccess, setCalibrationSuccess] = useState(false)
  const [calibrationBusy, setCalibrationBusy] = useState(false)
  const [calibrationError, setCalibrationError] = useState('')
  const [lightSunrise, setLightSunrise] = useState<number>(8)
  const [lightSunset, setLightSunset] = useState<number>(20)
  const [lightDuration, setLightDuration] = useState<number>(12)
  const [luxValue, setLuxValue] = useState<number>(150)
  const [draggingHandle, setDraggingHandle] = useState<'sunrise' | 'sunset' | null>(null)
  const [draggingHumidityHandle, setDraggingHumidityHandle] = useState<'target' | 'lower' | 'upper' | null>(null)
  const [draggingTempHandle, setDraggingTempHandle] = useState<'target' | 'lower' | 'upper' | null>(null)
  const [showLicense, setShowLicense] = useState(false)
  const [otaFile, setOtaFile] = useState<File | null>(null)
  const [otaProgress, setOtaProgress] = useState<number>(0)
  const [otaStatus, setOtaStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle')
  const [otaMessage, setOtaMessage] = useState<string>('')

  // Track humidity values during drag to avoid stale state issues
  const humidityDragValues = useRef<{ target: number; hysteresis: number }>({ target: 70, hysteresis: 2 })
  const tempDragValues = useRef<{ target: number; hysteresis: number }>({ target: 22, hysteresis: 1 })
  const debounceTimers = useRef<{ [key: string]: NodeJS.Timeout }>({})

  useEffect(() => {
    const fetchData = async () => {
      try {
        const numbers = await api.getAllNumbers()
        setEntities((prev) => ({ ...prev, ...numbers }))
      } catch (e) {
        // Ignore errors during initial fetch - EventSource will populate data
      }

      try {
        const tz = await api.getSelect('timezone')
        if (tz?.state) setTimezone(tz.state)
      } catch (e) {
        // Ignore errors during initial fetch - EventSource will populate data
      }

      try {
        const flip = await api.getSwitch('flip_screen')
        if (flip) setFlipScreen(flip.state === 'ON' || flip.value === true)
      } catch (e) {
        // Ignore errors during initial fetch - EventSource will populate data
      }

      setLoading(false)
    }

    fetchData()

    const handleEvent = (event: any) => {
      if (event.id) {
        setEntities((prev) => ({
          ...prev,
          [event.id]: {
            value: event.value !== undefined ? event.value : event.state === 'ON',
            state: event.state,
          },
        }))
        setLastUpdate(new Date())

        // Update timezone from events
        if (event.id === 'select-timezone') {
          setTimezone(event.state)
          setTimezoneError('')
          if (Array.isArray(event.option)) {
            setTimezoneOptions(event.option)
          }
        }
        if (event.id === 'switch-flip_screen') {
          setFlipScreen(event.state === 'ON' || event.value === true)
        }
      }
    }

    let eventSource: EventSource | null = null

    const disconnectEvents = () => {
      eventSource?.close()
      eventSource = null
    }

    const connectEvents = () => {
      if (document.visibilityState === 'visible' && !eventSource) {
        eventSource = api.subscribeToEvents(handleEvent)
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        connectEvents()
      } else {
        disconnectEvents()
      }
    }

    connectEvents()
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pagehide', disconnectEvents)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pagehide', disconnectEvents)
      disconnectEvents()
      Object.values(debounceTimers.current).forEach((timer) => clearTimeout(timer))
    }
  }, [])

  const handleNumberChange = useCallback((id: string, value: number) => {
    setEntities((prev) => ({
      ...prev,
      [id]: { ...prev[id], value: value },
    }))

    if (debounceTimers.current[id]) {
      clearTimeout(debounceTimers.current[id])
    }

    debounceTimers.current[id] = setTimeout(async () => {
      const numberId = id.replace('number-', '')
      await api.setNumber(numberId, value)
    }, 300)
  }, [])

  const runWaterCalibration = async () => {
    if (calibrationBusy) return

    setCalibrationBusy(true)
    setCalibrationError('')

    try {
      await api.pressButton('cancel_calibration')
      const warningAccepted = await api.pressButton('calibrate_dry_tank')
      if (!warningAccepted) throw new Error('Could not start calibration')

      await new Promise((resolve) => setTimeout(resolve, 500))

      const calibrated = await api.pressButton('calibrate_dry_tank')
      if (!calibrated) throw new Error('Could not save calibration')

      setEntities((prev) => ({
        ...prev,
        'binary_sensor-water_calibrated': { value: true, state: 'ON' },
      }))
      setCalibrationSuccess(true)
      setTimeout(() => setCalibrationSuccess(false), 10000)
      setModal({ type: 'water' })
    } catch (error) {
      setCalibrationError(error instanceof Error ? error.message : 'Calibration failed')
    } finally {
      setCalibrationBusy(false)
    }
  }

  const resetWaterCalibration = async () => {
    setCalibrationError('')
    const reset = await api.pressButton('reset_water_calibration')
    if (!reset) {
      setCalibrationError('Could not reset calibration')
      return
    }

    setCalibrationSuccess(false)
    setEntities((prev) => ({
      ...prev,
      'binary_sensor-water_calibrated': { value: false, state: 'OFF' },
    }))
  }

  const handleSwitchChange = async (id: string, checked: boolean) => {
    setEntities((prev) => ({
      ...prev,
      [id]: { ...prev[id], state: checked ? 'ON' : 'OFF', value: checked },
    }))

    const switchId = id.replace('switch-', '')
    await api.setSwitch(switchId, checked)
  }

  const handleTimezoneChange = async (tz: string) => {
    setTimezoneUpdating(true)
    setTimezoneError('')

    const updated = await api.setSelect('timezone', tz)
    if (!updated) {
      setTimezoneError('The device did not accept the timezone change. Please try again.')
      setTimezoneUpdating(false)
      return
    }

    // The device applies select calls on its main loop after acknowledging the
    // request. Read the authoritative state back instead of assuming success.
    await new Promise((resolve) => setTimeout(resolve, 100))
    const confirmed = await api.getSelect('timezone')
    if (confirmed?.state) {
      setTimezone(confirmed.state)
      if (confirmed.state !== tz) {
        setTimezoneError(`The device kept ${confirmed.state}; ${tz} was not applied.`)
      }
    } else {
      setTimezoneError('The timezone changed, but its confirmed state could not be read.')
    }

    setTimezoneUpdating(false)
  }

  const handleFlipScreenChange = async (flipped: boolean) => {
    setFlipScreen(flipped)
    await api.setSwitch('flip_screen', flipped)
  }

  const handleOtaUpload = async () => {
    if (!otaFile) {
      setOtaMessage('Please select a firmware file')
      setOtaStatus('error')
      return
    }

    setOtaStatus('uploading')
    setOtaProgress(0)
    setOtaMessage('Uploading firmware...')

    try {
      const formData = new FormData()
      formData.append('file', otaFile)

      const xhr = new XMLHttpRequest()

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const percentComplete = (e.loaded / e.total) * 100
          setOtaProgress(percentComplete)
        }
      })

      xhr.addEventListener('load', () => {
        if (xhr.status === 200) {
          setOtaStatus('success')
          setOtaMessage('Firmware uploaded successfully! Device will restart...')
          setOtaProgress(100)
          setTimeout(() => {
            setOtaStatus('idle')
            setOtaFile(null)
            setOtaProgress(0)
            setOtaMessage('')
          }, 5000)
        } else {
          setOtaStatus('error')
          setOtaMessage(`Upload failed: ${xhr.statusText}`)
        }
      })

      xhr.addEventListener('error', () => {
        setOtaStatus('error')
        setOtaMessage('Upload failed: Network error')
      })

      xhr.open('POST', '/update')
      xhr.send(formData)
    } catch (error) {
      setOtaStatus('error')
      setOtaMessage(`Upload failed: ${error}`)
    }
  }

  // Convert RGB 0-100 to hex color
  const rgbToHex = (r: number, g: number, b: number) => {
    const toHex = (n: number) => {
      const hex = Math.round((n / 100) * 255).toString(16)
      return hex.length === 1 ? '0' + hex : hex
    }
    return '#' + toHex(r) + toHex(g) + toHex(b)
  }

  // Convert hex color to RGB 0-100
  const hexToRgb = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
    return result
      ? {
          r: Math.round((parseInt(result[1], 16) / 255) * 100),
          g: Math.round((parseInt(result[2], 16) / 255) * 100),
          b: Math.round((parseInt(result[3], 16) / 255) * 100),
        }
      : { r: 0, g: 0, b: 0 }
  }

  const handleColorChange = (hex: string) => {
    const rgb = hexToRgb(hex)
    handleNumberChange('number-red_led_intensity', rgb.r)
    handleNumberChange('number-green_led_intensity', rgb.g)
    handleNumberChange('number-blue_led_intensity', rgb.b)
  }

  // Helper to get values
  const getSensor = (id: string) => entities[`sensor-${id}`]?.value
  const getNumber = (id: string) => entities[`number-${id}`]?.value
  const isValidHumiditySettings = (target: number, hysteresis: number) =>
    Number.isFinite(target) && target >= 30 && target <= 100 &&
    Number.isFinite(hysteresis) && hysteresis >= 0 && hysteresis <= 5

  // Sync lighting state from entities
  useEffect(() => {
    const sunrise = parseFloat((getNumber('lights__sunrise_hour') || 8) as string)
    const duration = parseFloat((getNumber('lights__duration__hours_') || 12) as string)
    const lux = parseFloat((getNumber('white_led_intensity') || 150) as string)

    setLightSunrise(sunrise)
    setLightDuration(duration)
    setLightSunset((sunrise + duration) % 24)
    setLuxValue(lux)
  }, [entities])

  // Time formatting helpers
  const formatTime = (hour: number) => {
    const h = Math.floor(hour)
    const m = Math.round((hour - h) * 60)
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
  }

  const timeOptions = Array.from({ length: 48 }, (_, i) => i * 0.5)

  // Lux value helpers - logarithmic scale where 0-1000 lux is half the slider
  const luxToSlider = (lux: number) => {
    if (lux <= 0) return 0
    // Use a custom scale where 1000 lux = 50% slider position
    // log base chosen so that at 50%, we get 1000 lux
    // At slider=50: lux = base^50 - 1 = 1000, so base^50 = 1001, base = 1001^(1/50)
    const base = Math.pow(1001, 1/50)
    // For max 4000 lux at slider=100: 4001 = base^100, so we scale accordingly
    const maxLux = 4000
    const scaledSlider = (Math.log(lux + 1) / Math.log(base))
    // Scale to match 4000 lux at position 100
    return Math.min(100, scaledSlider * (100 / Math.log(maxLux + 1) * Math.log(base)))
  }

  const sliderToLux = (slider: number) => {
    // Inverse: if slider=50 should give 1000 lux
    const base = Math.pow(1001, 1/50)
    const maxLux = 4000
    const scaleFactor = 100 / Math.log(maxLux + 1) * Math.log(base)
    const actualPosition = slider / scaleFactor
    return Math.round(Math.pow(base, actualPosition) - 1)
  }

  const handleSunriseChange = (newSunrise: number) => {
    setLightSunrise(newSunrise)
    setLightSunset((newSunrise + lightDuration) % 24)
    handleNumberChange('number-lights__sunrise_hour', newSunrise)
  }

  const handleSunsetChange = (newSunset: number) => {
    setLightSunset(newSunset)
    const duration = newSunset >= lightSunrise ? newSunset - lightSunrise : (24 - lightSunrise) + newSunset
    setLightDuration(duration)
    handleNumberChange('number-lights__duration__hours_', duration)
  }

  const handleDurationChange = (newDuration: number) => {
    // Clamp duration between 0 and 24
    const clampedDuration = Math.max(0, Math.min(24, newDuration))
    setLightDuration(clampedDuration)

    // Calculate sunset, handling wrap around midnight
    let newSunset = lightSunrise + clampedDuration
    if (newSunset >= 24) {
      newSunset = newSunset % 24
    }
    // Round to nearest 0.25 hour (15 min) to match dropdown options
    newSunset = Math.round(newSunset * 4) / 4
    setLightSunset(newSunset)

    handleNumberChange('number-lights__duration__hours_', clampedDuration)
  }

  const handleLuxChange = (sliderValue: number) => {
    const lux = sliderToLux(sliderValue)
    setLuxValue(lux)
    handleNumberChange('number-white_led_intensity', lux)
  }

  // Common function to get position from mouse or touch event
  const getClientX = (e: MouseEvent | TouchEvent): number => {
    return 'touches' in e ? e.touches[0].clientX : e.clientX
  }

  // Common handler for light schedule slider movement
  const handleLightSliderMove = (e: MouseEvent | TouchEvent) => {
    if (!draggingHandle) return

    const track = document.querySelector('.dual-slider-track') as HTMLDivElement
    if (track) {
      const rect = track.getBoundingClientRect()
      const x = Math.max(0, Math.min(getClientX(e) - rect.left, rect.width))
      const percentage = x / rect.width
      const hour = Math.round(percentage * 24 * 4) / 4 // Round to 0.25 increments (15 min)

      if (draggingHandle === 'sunrise') {
        handleSunriseChange(hour)
      } else {
        handleSunsetChange(hour)
      }
    }
  }

  // Common handler for humidity slider movement
  const handleHumiditySliderMove = (e: MouseEvent | TouchEvent) => {
    if (!draggingHumidityHandle) return

    const track = document.querySelector('.humidity-slider-track') as HTMLDivElement
    if (track) {
      const rect = track.getBoundingClientRect()
      const x = Math.max(0, Math.min(getClientX(e) - rect.left, rect.width))
      const percentage = x / rect.width
      const humidity = 60 + (percentage * 40) // Map 0-100% of slider to 60-100% humidity
      const roundedHumidity = Math.round(humidity * 2) / 2 // Round to 0.5%

      const currentTarget = Number(getNumber('target_humidity'))
      const currentHyst = Number(getNumber('humidity__hysteresis'))
      if (!isValidHumiditySettings(currentTarget, currentHyst)) return

      if (draggingHumidityHandle === 'target') {
        const clampedTarget = Math.max(60 + currentHyst, Math.min(100 - currentHyst, roundedHumidity))
        humidityDragValues.current.target = clampedTarget
        handleNumberChange('number-target_humidity', clampedTarget)
      } else if (draggingHumidityHandle === 'lower') {
        if (roundedHumidity > currentTarget) return
        const newHyst = Math.min(5, (currentTarget - roundedHumidity) / 2)
        const roundedHyst = newHyst < 0.125 ? 0 : Math.round(newHyst * 4) / 4
        humidityDragValues.current.hysteresis = roundedHyst
        handleNumberChange('number-humidity__hysteresis', roundedHyst)
      } else if (draggingHumidityHandle === 'upper') {
        if (roundedHumidity < currentTarget) return
        const newHyst = Math.min(5, (roundedHumidity - currentTarget) / 2)
        const roundedHyst = newHyst < 0.125 ? 0 : Math.round(newHyst * 4) / 4
        humidityDragValues.current.hysteresis = roundedHyst
        handleNumberChange('number-humidity__hysteresis', roundedHyst)
      }
    }
  }

  // Common handler for temperature slider movement
  const handleTempSliderMove = (e: MouseEvent | TouchEvent) => {
    if (!draggingTempHandle) return

    const track = document.querySelector('.temperature-slider-track') as HTMLDivElement
    if (track) {
      const rect = track.getBoundingClientRect()
      const x = Math.max(0, Math.min(getClientX(e) - rect.left, rect.width))
      const percentage = x / rect.width
      const temp = 15 + (percentage * 20) // Map 0-100% of slider to 15-35°C
      const roundedTemp = Math.round(temp * 2) / 2 // Round to 0.5°C

      const currentTarget = tempDragValues.current.target
      const currentHyst = tempDragValues.current.hysteresis

      if (draggingTempHandle === 'target') {
        const clampedTarget = Math.max(15 + currentHyst, Math.min(35 - currentHyst, roundedTemp))
        tempDragValues.current.target = clampedTarget
        handleNumberChange('number-temperature__target', clampedTarget)
      } else if (draggingTempHandle === 'lower') {
        if (roundedTemp > currentTarget) return
        const newHyst = Math.min(3, currentTarget - roundedTemp)
        const roundedHyst = newHyst < 0.125 ? 0 : Math.round(newHyst * 4) / 4
        tempDragValues.current.hysteresis = roundedHyst
        handleNumberChange('number-temperature__hysteresis', roundedHyst)
      } else if (draggingTempHandle === 'upper') {
        if (roundedTemp < currentTarget) return
        const newHyst = Math.min(3, roundedTemp - currentTarget)
        const roundedHyst = newHyst < 0.125 ? 0 : Math.round(newHyst * 4) / 4
        tempDragValues.current.hysteresis = roundedHyst
        handleNumberChange('number-temperature__hysteresis', roundedHyst)
      }
    }
  }

  const handleSliderDrag = useCallback((e: React.MouseEvent, trackRef: HTMLDivElement) => {
    if (!draggingHandle) return

    const rect = trackRef.getBoundingClientRect()
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width))
    const percentage = x / rect.width
    const hour = Math.round(percentage * 24 * 4) / 4 // Round to 0.25 increments (15 min)

    if (draggingHandle === 'sunrise') {
      handleSunriseChange(hour)
    } else {
      handleSunsetChange(hour)
    }
  }, [draggingHandle])

  useEffect(() => {
    const handleEnd = () => setDraggingHandle(null)

    document.addEventListener('mouseup', handleEnd)
    document.addEventListener('mousemove', handleLightSliderMove)
    document.addEventListener('touchend', handleEnd)
    document.addEventListener('touchmove', handleLightSliderMove)
    return () => {
      document.removeEventListener('mouseup', handleEnd)
      document.removeEventListener('mousemove', handleLightSliderMove)
      document.removeEventListener('touchend', handleEnd)
      document.removeEventListener('touchmove', handleLightSliderMove)
    }
  }, [draggingHandle])

  // Humidity slider drag handling
  useEffect(() => {
    const handleEnd = () => setDraggingHumidityHandle(null)

    document.addEventListener('mouseup', handleEnd)
    document.addEventListener('mousemove', handleHumiditySliderMove)
    document.addEventListener('touchend', handleEnd)
    document.addEventListener('touchmove', handleHumiditySliderMove)
    return () => {
      document.removeEventListener('mouseup', handleEnd)
      document.removeEventListener('mousemove', handleHumiditySliderMove)
      document.removeEventListener('touchend', handleEnd)
      document.removeEventListener('touchmove', handleHumiditySliderMove)
    }
  }, [draggingHumidityHandle])

  // Temperature slider drag handling
  useEffect(() => {
    const handleEnd = () => setDraggingTempHandle(null)

    document.addEventListener('mouseup', handleEnd)
    document.addEventListener('mousemove', handleTempSliderMove)
    document.addEventListener('touchend', handleEnd)
    document.addEventListener('touchmove', handleTempSliderMove)
    return () => {
      document.removeEventListener('mouseup', handleEnd)
      document.removeEventListener('mousemove', handleTempSliderMove)
      document.removeEventListener('touchend', handleEnd)
      document.removeEventListener('touchmove', handleTempSliderMove)
    }
  }, [draggingTempHandle])

  // Helper to get alert values
  const getAlert = (id: string) => entities[`binary_sensor-alert__${id}`]?.value === true

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner"></div>
        <div>Connecting to OpenShrooly...</div>
      </div>
    )
  }

  // Check for active alerts
  const alerts = [
    { id: 'humidity_control_failure', msg: 'Humidity has not risen after 10 minutes' },
    { id: 'i2c_communication_failure', msg: 'Sensor communication error' },
    { id: 'fan_start_failure', msg: 'Fan failed to start' },
    { id: 'temperature_too_low', msg: 'Temperature too low' },
    { id: 'temperature_too_high', msg: 'Temperature too high' },
  ].filter((a) => getAlert(a.id))

  const temp = parseFloat((getSensor('temperature') || getSensor('current_temperature') || 0) as string) || 0
  const humidity = parseFloat((getSensor('humidity') || getSensor('current_humidity') || 0) as string) || 0
  const waterLevel = parseFloat((getSensor('water_level_percent') || getSensor('water_level') || 0) as string) || 0
  const targetHumidity = parseFloat((getNumber('target_humidity') || 0) as string) || 0

  // Temperature control values
  const tempControlEnabled = entities['switch-temperature_control_enabled']?.state === 'ON' || entities['switch-temperature_control_enabled']?.value === true
  const tempTarget = parseFloat((getNumber('temperature__target') || 0) as string) || 0
  const tempHysteresis = parseFloat((getNumber('temperature__hysteresis') || 0) as string) || 0
  const tempMin = tempControlEnabled ? tempTarget - tempHysteresis : 0
  const tempMax = tempControlEnabled ? tempTarget + tempHysteresis : 0

  // Calculate status indicators
  const tempInRange = tempControlEnabled ? (temp >= tempMin && temp <= tempMax) : true
  const humidityInRange = Math.abs(humidity - targetHumidity) <= 2

  // Get device on/off states
  const humidifierOn = entities['switch-humidifier']?.state === 'ON' || entities['binary_sensor-humidifier_on']?.value === true
  const airExchangeOn = entities['switch-air_exchange']?.state === 'ON' || entities['binary_sensor-air_exchange_on']?.value === true
  const isWaterCalibrated = entities['binary_sensor-water_calibrated']?.state === 'ON' || entities['binary_sensor-water_calibrated']?.value === true
  const heatRequested = entities['binary_sensor-heat_requested']?.state === 'ON' || entities['binary_sensor-heat_requested']?.value === true

  // Calculate if lights are on based on schedule
  const now = new Date()
  const currentHour = now.getHours() + now.getMinutes() / 60
  const lightsOn =
    lightSunrise < lightSunset
      ? currentHour >= lightSunrise && currentHour < lightSunset
      : currentHour >= lightSunrise || currentHour < lightSunset

  // Get current RGB values for color picker
  const redValue = parseFloat((getNumber('red_led_intensity') || 0) as string) || 0
  const greenValue = parseFloat((getNumber('green_led_intensity') || 0) as string) || 0
  const blueValue = parseFloat((getNumber('blue_led_intensity') || 0) as string) || 0
  const currentColor = rgbToHex(redValue, greenValue, blueValue)

  return (
    <div className="dashboard">
      {/* Header */}
      <div className="header-bar">
        <h1>
          <svg
            width="28"
            height="28"
            viewBox="0 0 27.753101 27.941927"
            style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '8px' }}
          >
            <g transform="translate(-34.692395,-50.295771)">
              <g transform="matrix(0.27075242,0,0,0.27075242,20.785884,18.671899)">
                <path
                  style={{ fill: 'none', stroke: 'currentColor', strokeWidth: '5.84717', strokeLinecap: 'round' }}
                  d="m 62.774608,173.92618 h 78.560862 l 8.90336,-8.72004 -14.27203,-26.09984 -33.49774,-18.94359 -32.774503,18.71907 -14.741382,26.7906 z"
                />
                <path
                  style={{ fill: 'none', stroke: 'currentColor', strokeWidth: '5.84719', strokeLinecap: 'round' }}
                  d="m 89.451285,173.99131 -7.470248,31.26293 11.879354,11.82315 h 17.766519 l 11.28636,-12.42725 -7.37135,-30.71071 z"
                />
                <path
                  style={{ fill: 'none', stroke: 'currentColor', strokeWidth: '5.84719', strokeLinecap: 'butt' }}
                  d="m 109.6765,124.069 -10.553806,27.49 m -40.080662,18.96541 40.085576,-18.98387 29.393522,22.89182 v 0"
                />
              </g>
            </g>
          </svg>
          <span style={{ fontWeight: 'bold' }}>Open</span>
          <span style={{ fontWeight: '300' }}>Shrooly</span>
        </h1>
        <div className="header-right">
          <div className="header-time">{lastUpdate.toLocaleTimeString()}</div>
        </div>
      </div>

      {/* Alerts Banner */}
      {alerts.length > 0 && (
        <div className="alerts-banner">
          {alerts.map((alert) => (
            <div key={alert.id} className="alert-item">
              ⚠️ {alert.msg}
            </div>
          ))}
        </div>
      )}

      {/* Main Grid - 2 rows of 3 */}
      <div className="main-grid">
        {/* Row 1 */}
        <div className="card card-temp" onClick={() => setModal({ type: 'temperature' })}>
          {heatRequested && <div className="status-rectangle heating-badge">HEATING</div>}
          <div className="card-icon">🌡️</div>
          <div className="card-label">Temperature</div>
          <div className="card-value">
            {temp.toFixed(1)}
            <span className="card-unit">°C</span>
          </div>
          {tempControlEnabled && (
            <div className="card-range">
              {tempMin.toFixed(1)}° - {tempMax.toFixed(1)}°
            </div>
          )}
        </div>

        <div className="card card-humidity" onClick={() => setModal({ type: 'humidity' })}>
          {humidifierOn && <div className="status-rectangle humidifying-badge">HUMIDIFYING</div>}
          <div className="card-icon">💧</div>
          <div className="card-label">Humidity</div>
          <div className="card-value">
            {humidity.toFixed(1)}
            <span className="card-unit">%</span>
          </div>
          <div className="card-target">
            Target: {targetHumidity}%
          </div>
        </div>

        <div className="card card-air" onClick={() => setModal({ type: 'air' })}>
          {airExchangeOn && <div className="status-rectangle running-badge">RUNNING</div>}
          <div className="card-icon">🌀</div>
          <div className="card-label">Air Exchange</div>
          <div className="card-value">
            {getNumber('air_exchange__period__min_')}
            <span className="card-unit">min</span>
          </div>
          <div className="card-detail">
            {getNumber('air_exchange__run_duration__s_')}s @ {getNumber('air_exchange__speed')}%
          </div>
        </div>

        {/* Row 2 */}
        <div className="card card-light" onClick={() => setModal({ type: 'light' })}>
          <div className="card-icon">{lightsOn ? '💡' : '🌙'}</div>
          <div className="card-label">Lighting</div>
          <div className="card-value">
            {lightsOn ? getNumber('white_led_intensity') : 'OFF'}
            {lightsOn && <span className="card-unit">lux</span>}
          </div>
          <div className="card-schedule">
            {formatTime(lightSunrise)} - {formatTime(lightSunset)}
          </div>
        </div>

        <div className="card card-water" onClick={() => setModal({ type: 'water' })}>
          {!isWaterCalibrated && <div className="status-rectangle humidifying-badge">NOT CALIBRATED</div>}
          <div className="card-icon">🚰</div>
          <div className="card-label">Water Level</div>
          <div className="card-value">
            {waterLevel.toFixed(0)}
            <span className="card-unit">%</span>
          </div>
        </div>

        <div className="card card-settings" onClick={() => setModal({ type: 'settings' })}>
          <div className="card-icon">⚙️</div>
          <div className="card-label">Settings</div>
          <div className="card-value">v1.0.0</div>
          <div className="card-detail">System & Network</div>
        </div>
      </div>

      {/* Footer */}
      <div className="footer">
        <a href="https://openshrooly.com" target="_blank" rel="noopener noreferrer" className="footer-link">
          OpenShrooly.com
        </a>
        <span className="footer-separator">•</span>
        <button onClick={() => setShowLicense(true)} className="footer-link footer-button">
          Open Source (MIT License)
        </button>
        <span className="footer-separator">•</span>
        <a href="https://esphome.io" target="_blank" rel="noopener noreferrer" className="footer-link">
          Powered by ESPHome
        </a>
        <span className="footer-separator">•</span>
        <span className="footer-text">No Warranty</span>
      </div>

      {/* Modals */}
      {modal.type === 'water' && (() => {
        const isCalibrated = entities['binary_sensor-water_calibrated']?.state === 'ON' ||
                           entities['binary_sensor-water_calibrated']?.value === true

        return (
        <div className="modal-overlay" onClick={() => setModal({ type: null })}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close-x" onClick={() => setModal({ type: null })}>×</button>
            <h2>🚰 Water Level</h2>
            <div className="modal-content">
              <div className="water-level-display">
                <div className="water-level-value">{waterLevel.toFixed(0)}%</div>
                {waterLevel < 20 && (
                  <div className="water-warning">⚠️ Water level low - please refill soon</div>
                )}
              </div>

              {calibrationSuccess && (
                <div className="calibration-success">
                  ✅ Water level calibration complete! The sensor has been calibrated to measure from an empty tank.
                </div>
              )}

              <button
                className="calibrate-button"
                onClick={() => {
                  setCalibrationError('')
                  setModal({ type: 'calibrate' })
                }}
              >
                {isCalibrated ? 'Recalibrate Dry Tank' : 'Calibrate Water Level'}
              </button>

              {isCalibrated && (
                <button className="modal-cancel" style={{ width: '100%', marginBottom: '12px' }} onClick={resetWaterCalibration}>
                  Reset to Built-in Defaults
                </button>
              )}

              <div className="calibrate-info" style={isCalibrated ? { color: '#4ade80' } : undefined}>
                {isCalibrated
                  ? '✓ Sensor is calibrated'
                  : 'Calibration sets the dry-tank baseline for accurate water-level measurement.'}
              </div>

              {calibrationError && (
                <div className="water-warning" style={{ marginTop: '12px' }}>
                  {calibrationError}
                </div>
              )}
            </div>
          </div>
        </div>
        )
      })()}

      {modal.type === 'calibrate' && (
        <div className="modal-overlay" onClick={() => setModal({ type: null })}>
          <div className="modal calibrate-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close-x" onClick={() => setModal({ type: null })}>×</button>
            <h2>🚰 Water Calibration</h2>
            <div className="modal-content">
              <p className="calibrate-warning">
                ⚠️ Please completely empty and dry the water reservoir before calibrating.
              </p>
              <p className="calibrate-instruction">
                This will set the current sensor readings as the "dry" baseline for accurate water level measurement.
              </p>
              <p className="calibrate-instruction">
                The reading will update immediately after calibration.
              </p>
              {calibrationError && <p className="calibrate-warning">{calibrationError}</p>}
            </div>
            <div className="modal-buttons">
              <button className="modal-cancel" onClick={() => setModal({ type: null })}>
                Cancel
              </button>
              <button
                className="modal-confirm"
                disabled={calibrationBusy}
                onClick={runWaterCalibration}
              >
                {calibrationBusy ? 'Calibrating…' : 'Calibrate Empty Tank'}
              </button>
            </div>
          </div>
        </div>
      )}

      {modal.type === 'humidity' && (() => {
        const hysteresis = Number(getNumber('humidity__hysteresis'))
        const target = Number(getNumber('target_humidity'))
        const humiditySettingsReady = isValidHumiditySettings(target, hysteresis)

        // Initialize ref with current values ONLY if not dragging
        if (humiditySettingsReady && !draggingHumidityHandle) {
          humidityDragValues.current = { target, hysteresis }
        }

        const lowerBound = target - hysteresis
        const upperBound = target + hysteresis

        // Calculate positions on 60-100% scale
        const targetPos = ((target - 60) / 40) * 100

        // Scale hysteresis visually by 2x for easier interaction
        const visualHysteresis = hysteresis * 2
        const lowerBoundVisual = target - visualHysteresis
        const upperBoundVisual = target + visualHysteresis
        const lowerPos = ((lowerBoundVisual - 60) / 40) * 100
        const upperPos = ((upperBoundVisual - 60) / 40) * 100

        // Offset for edge handles so they don't overlap when hysteresis is 0
        const handleOffset = 2 // pixels

        return (
          <div className="modal-overlay" onClick={() => setModal({ type: null })}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <button className="modal-close-x" onClick={() => setModal({ type: null })}>×</button>
              <h2>💧 Humidity Control</h2>
              <div className="modal-content">
                {!humiditySettingsReady ? (
                  'Waiting for humidity settings…'
                ) : (
                  <>
                <div className="control-group">
                  <label>Target: {target.toFixed(1)}% ± {hysteresis.toFixed(2)}% • Turns ON below {lowerBound.toFixed(1)}%, OFF {upperBound >= 100 ? 'at' : 'above'} {upperBound.toFixed(1)}%</label>
                  <div className="dual-slider-container humidity-slider-container">
                    {/* Target handle (center) - green circle */}
                    <div
                      className="humidity-handle-center"
                      style={{
                        position: 'absolute',
                        left: `${targetPos}%`,
                        top: '26px',
                        transform: 'translateX(-50%)',
                        width: '26px',
                        height: '26px',
                        background: '#22c55e',
                        border: '3px solid white',
                        borderRadius: '50%',
                        cursor: 'grab',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                        zIndex: 20
                      }}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        setDraggingHumidityHandle('target')
                      }}
                      onTouchStart={(e) => {
                        e.preventDefault()
                        setDraggingHumidityHandle('target')
                      }}
                    />

                    {/* Humidity slider track with gradient */}
                    <div
                      className="humidity-slider-track"
                      style={{
                        position: 'absolute',
                        top: '35px',
                        left: 0,
                        right: 0,
                        height: '8px',
                        background: 'linear-gradient(to right, #f97316 0%, #3b82f6 100%)',
                        borderRadius: '4px',
                        cursor: 'pointer'
                      }}
                    />

                    {/* Hysteresis band - the acceptable range */}
                    <div
                      className="humidity-band"
                      style={{
                        position: 'absolute',
                        top: '30px',
                        left: `${lowerPos}%`,
                        width: `${upperPos - lowerPos}%`,
                        height: '18px',
                        background: 'rgba(34, 197, 94, 0.2)',
                        border: '2px solid rgba(34, 197, 94, 0.5)',
                        borderRadius: '4px',
                        pointerEvents: 'none'
                      }}
                    />

                    {/* Lower bound handle - on bottom, slightly left */}
                    <div
                      className="humidity-handle-edge"
                      style={{
                        position: 'absolute',
                        left: `calc(${Math.max(0, lowerPos)}% - ${handleOffset}px)`,
                        top: '63px',
                        transform: 'translateX(-50%)',
                        cursor: 'grab',
                        zIndex: 10
                      }}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        setDraggingHumidityHandle('lower')
                      }}
                      onTouchStart={(e) => {
                        e.preventDefault()
                        setDraggingHumidityHandle('lower')
                      }}
                    >
                      <div className="humidity-tick">◀</div>
                    </div>

                    {/* Upper bound handle - on bottom, slightly right */}
                    <div
                      className="humidity-handle-edge"
                      style={{
                        position: 'absolute',
                        left: `calc(${Math.min(100, upperPos)}% + ${handleOffset}px)`,
                        top: '63px',
                        transform: 'translateX(-50%)',
                        cursor: 'grab',
                        zIndex: 10
                      }}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        setDraggingHumidityHandle('upper')
                      }}
                      onTouchStart={(e) => {
                        e.preventDefault()
                        setDraggingHumidityHandle('upper')
                      }}
                    >
                      <div className="humidity-tick">▶</div>
                    </div>

                    {/* Humidity scale below track */}
                    <div className="dual-slider-scale" style={{ top: '80px' }}>
                      {[60, 65, 70, 75, 80, 85, 90, 95, 100].map(val => (
                        <div
                          key={val}
                          className="scale-mark"
                          style={{ left: `${((val - 60) / 40) * 100}%` }}
                        >
                          <div className="scale-tick"></div>
                          <div className="scale-label">{val}%</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="control-group">
                  <label>
                    Humidifier Speed: {getNumber('humidifier__speed')}%
                  </label>
                  <input
                    type="range"
                    min="50"
                    max="100"
                    step="5"
                    value={getNumber('humidifier__speed') as number}
                    onChange={(e) =>
                      handleNumberChange('number-humidifier__speed', parseFloat(e.target.value))
                    }
                  />
                </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {modal.type === 'temperature' && (() => {
        const tempHysteresis = Number(getNumber('temperature__hysteresis')) || 1
        const tempTarget = Number(getNumber('temperature__target')) || 22

        // Initialize ref with current values ONLY if not dragging
        if (!draggingTempHandle) {
          tempDragValues.current = { target: tempTarget, hysteresis: tempHysteresis }
        }

        const lowerTempBound = tempTarget - tempHysteresis
        const upperTempBound = tempTarget + tempHysteresis

        // Calculate positions on 15-35°C scale
        const targetTempPos = ((tempTarget - 15) / 20) * 100
        const lowerTempPos = ((lowerTempBound - 15) / 20) * 100
        const upperTempPos = ((upperTempBound - 15) / 20) * 100

        // Offset for edge handles so they don't overlap when hysteresis is 0
        const handleOffset = -10 // pixels - negative to move left

        return (
        <div className="modal-overlay" onClick={() => setModal({ type: null })}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close-x" onClick={() => setModal({ type: null })}>×</button>
            <h2>🌡️ Temperature Control</h2>
            <div className="modal-content">
              <div className="control-group" style={{ marginBottom: '20px' }}>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={entities['switch-temperature_control_enabled']?.state === 'ON' || entities['switch-temperature_control_enabled']?.value === true}
                    onChange={(e) =>
                      handleSwitchChange('switch-temperature_control_enabled', e.target.checked)
                    }
                  />
                  <span style={{ marginLeft: '8px' }}>Enable Temperature Control</span>
                </label>
              </div>

              {(entities['switch-temperature_control_enabled']?.state === 'ON' || entities['switch-temperature_control_enabled']?.value === true) && (
                <>
                  <div className="temp-disclaimer" style={{ marginBottom: '20px' }}>
                    ⚠️ <strong>Important:</strong> OpenShrooly can request heating, but external heating equipment must be controlled via Home Assistant. The "Heat Requested" binary sensor signals when heating is needed.
                  </div>

                  <div className="control-group">
                    <label style={{ marginBottom: '10px', display: 'block' }}>
                      Target Temperature: {tempTarget.toFixed(1)}°C (±{tempHysteresis.toFixed(2)}°C)
                    </label>
                    <div style={{ position: 'relative', height: '100px', marginBottom: '10px' }}>
                      {/* Temperature slider track */}
                      <div
                        className="temperature-slider-track"
                        style={{
                          position: 'absolute',
                          top: '35px',
                          left: 0,
                          right: 0,
                          height: '8px',
                          background: 'linear-gradient(to right, #60a5fa 0%, #ef4444 100%)',
                          borderRadius: '4px',
                          cursor: 'pointer'
                        }}
                      />

                      {/* Hysteresis band - the acceptable range */}
                      <div
                        className="temperature-band"
                        style={{
                          position: 'absolute',
                          top: '30px',
                          left: `${lowerTempPos}%`,
                          width: `${upperTempPos - lowerTempPos}%`,
                          height: '18px',
                          background: 'rgba(34, 197, 94, 0.2)',
                          border: '2px solid rgba(34, 197, 94, 0.5)',
                          borderRadius: '4px',
                          pointerEvents: 'none'
                        }}
                      />

                      {/* Target handle - center point */}
                      <div
                        className="temperature-handle-center"
                        style={{
                          position: 'absolute',
                          left: `${targetTempPos}%`,
                          top: '26px',
                          transform: 'translateX(-50%)',
                          width: '26px',
                          height: '26px',
                          background: '#22c55e',
                          border: '3px solid white',
                          borderRadius: '50%',
                          cursor: 'grab',
                          boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                          zIndex: 20
                        }}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          setDraggingTempHandle('target')
                        }}
                        onTouchStart={(e) => {
                          e.preventDefault()
                          setDraggingTempHandle('target')
                        }}
                      />

                      {/* Lower bound handle - on bottom, left */}
                      <div
                        className="temperature-handle-edge"
                        style={{
                          position: 'absolute',
                          left: `calc(${Math.max(0, lowerTempPos)}% + ${handleOffset}px)`,
                          top: '63px',
                          transform: 'translateX(-50%)',
                          cursor: 'grab',
                          zIndex: 10
                        }}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          setDraggingTempHandle('lower')
                        }}
                        onTouchStart={(e) => {
                          e.preventDefault()
                          setDraggingTempHandle('lower')
                        }}
                      >
                        <div className="temperature-tick">◀</div>
                      </div>

                      {/* Upper bound handle - on bottom, right */}
                      <div
                        className="temperature-handle-edge"
                        style={{
                          position: 'absolute',
                          left: `calc(${Math.min(100, upperTempPos)}% - ${handleOffset}px)`,
                          top: '63px',
                          transform: 'translateX(-50%)',
                          cursor: 'grab',
                          zIndex: 10
                        }}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          setDraggingTempHandle('upper')
                        }}
                        onTouchStart={(e) => {
                          e.preventDefault()
                          setDraggingTempHandle('upper')
                        }}
                      >
                        <div className="temperature-tick">▶</div>
                      </div>

                      {/* Temperature scale below track */}
                      <div className="dual-slider-scale" style={{ top: '80px' }}>
                        {[15, 17, 19, 21, 23, 25, 27, 29, 31, 33, 35].map(val => (
                          <div
                            key={val}
                            className="scale-mark"
                            style={{ left: `${((val - 15) / 20) * 100}%` }}
                          >
                            <div className="scale-tick"></div>
                            <div className="scale-label">{val}°C</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Temperature Warning Thresholds Section */}
              <div style={{ marginTop: '30px', paddingTop: '20px', borderTop: '1px solid #e5e7eb' }}>
                <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '15px', color: '#6b7280' }}>
                  Temperature Warnings
                </h3>
                <div className="temp-disclaimer" style={{ marginBottom: '15px' }}>
                  ℹ️ <strong>Note:</strong> These thresholds only trigger warnings. Home Assistant integration is required to receive and act on temperature warning alerts.
                </div>
                <div className="control-group">
                  <label>Warning Minimum: {getNumber('temperature__warning_minimum')}°C</label>
                  <input
                    type="number"
                    min="10"
                    max="25"
                    step="0.5"
                    value={getNumber('temperature__warning_minimum') as number}
                    onChange={(e) =>
                      handleNumberChange('number-temperature__warning_minimum', parseFloat(e.target.value))
                    }
                  />
                </div>
                <div className="control-group">
                  <label>Warning Maximum: {getNumber('temperature__warning_maximum')}°C</label>
                  <input
                    type="number"
                    min="20"
                    max="35"
                    step="0.5"
                    value={getNumber('temperature__warning_maximum') as number}
                    onChange={(e) =>
                      handleNumberChange('number-temperature__warning_maximum', parseFloat(e.target.value))
                    }
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
        )
      })()}

      {modal.type === 'air' && (
        <div className="modal-overlay" onClick={() => setModal({ type: null })}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close-x" onClick={() => setModal({ type: null })}>×</button>
            <h2>🌀 Air Exchange</h2>
            <div className="modal-content">
              <div className="control-group">
                <label>Period: {getNumber('air_exchange__period__min_')} minutes</label>
                <input
                  type="number"
                  min="1"
                  max="240"
                  value={getNumber('air_exchange__period__min_') as number}
                  onChange={(e) =>
                    handleNumberChange(
                      'number-air_exchange__period__min_',
                      parseFloat(e.target.value)
                    )
                  }
                />
              </div>
              <div className="control-group">
                <label>
                  Run Duration: {getNumber('air_exchange__run_duration__s_')} seconds
                </label>
                <input
                  type="number"
                  min="5"
                  max="900"
                  step="5"
                  value={getNumber('air_exchange__run_duration__s_') as number}
                  onChange={(e) =>
                    handleNumberChange(
                      'number-air_exchange__run_duration__s_',
                      parseFloat(e.target.value)
                    )
                  }
                />
              </div>
              <div className="control-group">
                <label>Fan Speed: {getNumber('air_exchange__speed')}%</label>
                <input
                  type="range"
                  min="15"
                  max="100"
                  step="5"
                  value={getNumber('air_exchange__speed') as number}
                  onChange={(e) =>
                    handleNumberChange('number-air_exchange__speed', parseFloat(e.target.value))
                  }
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {modal.type === 'light' && (
        <div className="modal-overlay" onClick={() => setModal({ type: null })}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close-x" onClick={() => setModal({ type: null })}>×</button>
            <h2>💡 Lighting Schedule</h2>
            <div className="modal-content">
              <div className="control-group">
                <label>Light Schedule: {formatTime(lightSunrise)} - {formatTime(lightSunset)} ({lightDuration.toFixed(1)}h)</label>
                <div className="dual-slider-container">
                  {/* Sunrise handle with sun icon - above track */}
                  <div
                    className="slider-handle-container"
                    style={{ left: `${(lightSunrise / 24) * 100}%`, top: '15px' }}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      setDraggingHandle('sunrise')
                    }}
                    onTouchStart={(e) => {
                      e.preventDefault()
                      setDraggingHandle('sunrise')
                    }}
                  >
                    <div className="slider-icon">☀️</div>
                  </div>

                  {/* Sunset handle with moon icon - above track */}
                  <div
                    className="slider-handle-container"
                    style={{ left: `${(lightSunset / 24) * 100}%`, top: '15px' }}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      setDraggingHandle('sunset')
                    }}
                    onTouchStart={(e) => {
                      e.preventDefault()
                      setDraggingHandle('sunset')
                    }}
                  >
                    <div className="slider-icon">🌙</div>
                  </div>

                  <div className="dual-slider-track">
                    {/* Yellow segment for lights ON */}
                    {lightSunset >= lightSunrise ? (
                      // Normal case: single segment from sunrise to sunset
                      <div
                        className="dual-slider-range dual-slider-on"
                        style={{
                          left: `${(lightSunrise / 24) * 100}%`,
                          width: `${((lightSunset - lightSunrise) / 24) * 100}%`
                        }}
                      />
                    ) : (
                      // Wraps past midnight: two segments
                      <>
                        <div
                          className="dual-slider-range dual-slider-on"
                          style={{
                            left: `${(lightSunrise / 24) * 100}%`,
                            width: `${((24 - lightSunrise) / 24) * 100}%`
                          }}
                        />
                        <div
                          className="dual-slider-range dual-slider-on"
                          style={{
                            left: '0%',
                            width: `${(lightSunset / 24) * 100}%`
                          }}
                        />
                      </>
                    )}
                  </div>

                  {/* Time scale below track */}
                  <div className="dual-slider-scale" style={{ top: '68px' }}>
                    {[0, 3, 6, 9, 12, 15, 18, 21, 24].map(hour => (
                      <div
                        key={hour}
                        className="scale-mark"
                        style={{ left: `${(hour / 24) * 100}%` }}
                      >
                        <div className="scale-tick"></div>
                        <div className="scale-label">{hour.toString().padStart(2, '0')}:00</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="control-group">
                <label>White Intensity: {luxValue} lux</label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="0.1"
                  value={luxToSlider(luxValue)}
                  onChange={(e) => handleLuxChange(parseFloat(e.target.value))}
                />
                {luxValue > 1000 && (
                  <div className="warning-message" style={{ marginTop: '8px', padding: '8px', backgroundColor: '#fff3cd', border: '1px solid #ffc107', borderRadius: '4px', color: '#856404' }}>
                    ⚠️ Very few mushroom species like this light level. High light can cause bleached or discolored caps.
                  </div>
                )}
                <div className="lux-guide">
                  Most mushrooms need minimal light - <strong>150 lux is typically sufficient</strong>. Light is primarily for pinning and directing growth, not energy production. Higher levels may cause bleaching or discolored caps.
                </div>
              </div>
              <div className="color-picker-row">
                <label>RGB Color:</label>
                <input
                  type="color"
                  className="color-picker-small"
                  value={currentColor}
                  onChange={(e) => handleColorChange(e.target.value)}
                />
                <span className="color-value-text">
                  {redValue === 0 && greenValue === 0 && blueValue === 0 ? (
                    'OFF'
                  ) : (
                    `R:${redValue} G:${greenValue} B:${blueValue}`
                  )}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {modal.type === 'settings' && (
        <div className="modal-overlay" onClick={() => setModal({ type: null })}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close-x" onClick={() => setModal({ type: null })}>×</button>
            <h2>⚙️ Settings</h2>
            <div className="modal-content">
              <div className="settings-section">
                <h3>System Information</h3>
                <div className="settings-info">
                  <div className="info-row">
                    <span className="info-label">Version:</span>
                    <span className="info-value">1.0.0</span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">Voltage:</span>
                    <span className="info-value">{parseFloat(getSensor('system_voltage') as string || '0').toFixed(2)}V</span>
                  </div>
                </div>
              </div>

              <div className="settings-section">
                <h3>Network</h3>
                <div className="settings-info">
                  <div className="info-row">
                    <span className="info-label">Mode:</span>
                    <span className="info-value">{entities['text_sensor-wifi_mode']?.state || 'Unknown'}</span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">SSID:</span>
                    <span className="info-value">{entities['text_sensor-wifi_ssid']?.state || 'Unknown'}</span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">IP Address:</span>
                    <span className="info-value">{entities['text_sensor-ip_address']?.state || 'Unknown'}</span>
                  </div>
                </div>
              </div>

              <div className="settings-section">
                <h3>Display & Time</h3>
                <div className="control-group">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={flipScreen}
                      onChange={(e) => handleFlipScreenChange(e.target.checked)}
                    />
                    <span style={{ marginLeft: '8px' }}>Flip screen</span>
                  </label>
                </div>
                <div className="control-group">
                  <label>Timezone</label>
                  <select
                    className="control-select"
                    value={timezone}
                    onChange={(e) => handleTimezoneChange(e.target.value)}
                    disabled={timezoneOptions.length === 0 || timezoneUpdating}
                  >
                    {timezoneOptions.length === 0 ? (
                      <option value={timezone}>{timezone || 'Loading timezones…'}</option>
                    ) : (
                      timezoneOptions.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))
                    )}
                  </select>
                  {timezoneUpdating && (
                    <div className="control-help">Applying timezone…</div>
                  )}
                  {timezoneError && (
                    <div className="control-error">{timezoneError}</div>
                  )}
                </div>
              </div>

              <div className="settings-section">
                <h3>Firmware Update (OTA)</h3>
                <div className="control-group">
                  <label>Upload Firmware (.bin file)</label>
                  <input
                    type="file"
                    accept=".bin"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) {
                        setOtaFile(file)
                        setOtaStatus('idle')
                        setOtaMessage('')
                      }
                    }}
                    disabled={otaStatus === 'uploading'}
                    style={{
                      padding: '8px',
                      border: '1px solid #cbd5e1',
                      borderRadius: '6px',
                      marginTop: '8px'
                    }}
                  />
                  {otaFile && (
                    <div style={{ marginTop: '10px', fontSize: '14px', color: '#64748b' }}>
                      Selected: {otaFile.name} ({(otaFile.size / 1024 / 1024).toFixed(2)} MB)
                    </div>
                  )}
                  <button
                    onClick={handleOtaUpload}
                    disabled={!otaFile || otaStatus === 'uploading'}
                    style={{
                      marginTop: '12px',
                      padding: '10px 20px',
                      backgroundColor: otaStatus === 'uploading' ? '#94a3b8' : '#3b82f6',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: otaStatus === 'uploading' ? 'not-allowed' : 'pointer',
                      fontSize: '14px',
                      fontWeight: '600'
                    }}
                  >
                    {otaStatus === 'uploading' ? 'Uploading...' : 'Upload Firmware'}
                  </button>
                  {otaStatus !== 'idle' && (
                    <div style={{ marginTop: '12px' }}>
                      {otaStatus === 'uploading' && (
                        <div style={{ width: '100%', backgroundColor: '#e2e8f0', borderRadius: '4px', height: '8px', overflow: 'hidden' }}>
                          <div
                            style={{
                              width: `${otaProgress}%`,
                              backgroundColor: '#3b82f6',
                              height: '100%',
                              transition: 'width 0.3s ease'
                            }}
                          />
                        </div>
                      )}
                      <div
                        style={{
                          marginTop: '8px',
                          fontSize: '14px',
                          color: otaStatus === 'success' ? '#22c55e' : otaStatus === 'error' ? '#ef4444' : '#64748b'
                        }}
                      >
                        {otaMessage}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* License Modal */}
      {showLicense && (
        <div className="modal-overlay" onClick={() => setShowLicense(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close-x" onClick={() => setShowLicense(false)}>×</button>
            <h2>MIT License</h2>
            <div className="modal-content">
              <div className="license-text">
                <p>Copyright (c) 2025-2026 OpenShrooly Contributors</p>
                <p>Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:</p>
                <p>The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.</p>
                <p><strong>THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.</strong></p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
