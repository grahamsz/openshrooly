export interface SensorData {
  id: string
  name: string
  value: number | string
  state: string
  unit?: string
}

export interface DeviceState {
  temperature?: SensorData
  humidity?: SensorData
  water_level?: SensorData
  air_exchange_on?: boolean
  lights_on?: boolean
  white_intensity?: number
}

class ESPHomeAPI {
  private baseUrl: string

  constructor() {
    // When running on the device, API is at root
    // When developing locally, you can override this
    this.baseUrl = typeof window !== 'undefined' ? window.location.origin : ''
  }

  async getSensor(sensorId: string): Promise<SensorData | null> {
    try {
      const response = await fetch(`${this.baseUrl}/sensor/${sensorId}`)
      if (!response.ok) return null
      return await response.json()
    } catch (error) {
      console.error(`Failed to fetch sensor ${sensorId}:`, error)
      return null
    }
  }

  async getTextSensor(textSensorId: string): Promise<SensorData | null> {
    try {
      const response = await fetch(`${this.baseUrl}/text_sensor/${textSensorId}`)
      if (!response.ok) return null
      return await response.json()
    } catch (error) {
      console.error(`Failed to fetch text sensor ${textSensorId}:`, error)
      return null
    }
  }

  async getSwitch(switchId: string): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}/switch/${switchId}`)
      if (!response.ok) return null
      return await response.json()
    } catch (error) {
      console.error(`Failed to fetch switch ${switchId}:`, error)
      return null
    }
  }

  async getNumber(numberId: string): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}/number/${numberId}`)
      if (!response.ok) return null
      return await response.json()
    } catch (error) {
      console.error(`Failed to fetch number ${numberId}:`, error)
      return null
    }
  }

  async setNumber(numberId: string, value: number): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/number/${numberId}/set?value=${value}`, {
        method: 'POST',
      })
      return response.ok
    } catch (error) {
      console.error(`Failed to set number ${numberId}:`, error)
      return false
    }
  }

  async setSwitch(switchId: string, state: boolean): Promise<boolean> {
    try {
      const action = state ? 'turn_on' : 'turn_off'
      const response = await fetch(`${this.baseUrl}/switch/${switchId}/${action}`, {
        method: 'POST',
      })
      return response.ok
    } catch (error) {
      console.error(`Failed to set switch ${switchId}:`, error)
      return false
    }
  }

  async getAllSensors(): Promise<DeviceState> {
    try {
      // Fetch all the sensors in parallel
      const [temperature, humidity, waterLevel] = await Promise.all([
        this.getSensor('temperature'),
        this.getSensor('humidity'),
        this.getSensor('water_level_percent'),
      ])

      return {
        temperature: temperature || undefined,
        humidity: humidity || undefined,
        water_level: waterLevel || undefined,
      }
    } catch (error) {
      console.error('Failed to fetch device state:', error)
      return {}
    }
  }

  async getAllNumbers(): Promise<{ [key: string]: any }> {
    const numberIds = [
      'target_humidity',
      'humidifier__speed',
      'temperature__minimum',
      'temperature__maximum',
      'air_exchange__period__min_',
      'air_exchange__run_duration__s_',
      'air_exchange__speed',
      'lights__sunrise_hour',
      'lights__duration__hours_',
      'white_led_intensity',
      'red_led_intensity',
      'green_led_intensity',
      'blue_led_intensity',
    ]

    try {
      const results = await Promise.all(numberIds.map((id) => this.getNumber(id)))
      const numbers: { [key: string]: any } = {}

      results.forEach((result, index) => {
        if (result) {
          numbers[`number-${numberIds[index]}`] = result
        }
      })

      return numbers
    } catch (error) {
      console.error('Failed to fetch numbers:', error)
      return {}
    }
  }

  // Subscribe to real-time updates via EventSource
  async pressButton(buttonId: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/button/${buttonId}/press`, {
        method: 'POST',
      })
      return response.ok
    } catch (error) {
      console.error(`Failed to press button ${buttonId}:`, error)
      return false
    }
  }

  async getSelect(selectId: string): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}/select/${selectId}`)
      if (!response.ok) return null
      return await response.json()
    } catch (error) {
      console.error(`Failed to fetch select ${selectId}:`, error)
      return null
    }
  }

  async setSelect(selectId: string, value: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/select/${selectId}/set?option=${encodeURIComponent(value)}`, {
        method: 'POST',
      })
      return response.ok
    } catch (error) {
      console.error(`Failed to set select ${selectId}:`, error)
      return false
    }
  }

  subscribeToEvents(onEvent: (event: any) => void): EventSource | null {
    try {
      const eventSource = new EventSource(`${this.baseUrl}/events`)

      eventSource.addEventListener('state', (event) => {
        try {
          const data = JSON.parse(event.data)
          // Process all entity updates (sensors, numbers, switches, etc.)
          if (data.id) {
            onEvent(data)
          }
        } catch (error) {
          console.error('Failed to parse event:', error)
        }
      })

      eventSource.onerror = (error) => {
        console.error('EventSource error:', error)
      }

      return eventSource
    } catch (error) {
      console.error('Failed to create EventSource:', error)
      return null
    }
  }
}

export const api = new ESPHomeAPI()
