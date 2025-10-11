# OpenShrooly Web Dashboard

A Next.js-based web dashboard for monitoring OpenShrooly sensor data in real-time.

## Features

- 📊 Real-time sensor data display
- 🌡️ Temperature monitoring
- 💧 Humidity tracking
- 💦 Water level indicator
- 💡 Light intensity display
- 🔄 Auto-refresh every 5 seconds
- ⚡ EventSource support for real-time updates

## Development

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000/app](http://localhost:3000/app) in your browser.

## Building for Production

Build the static export:

```bash
npm run build
```

This creates an optimized static build in the `out/` directory.

## Deployment to ESP32

### 1. Build the app

```bash
npm run build
```

### 2. Upload to LittleFS

The `out/` directory contains your static files. You need to upload these to the ESP32's LittleFS filesystem at `/www/`.

#### Option A: Using PlatformIO

Create a `data/www/` directory in your ESPHome project and copy the contents:

```bash
mkdir -p ../data/www
cp -r out/* ../data/www/
```

Then upload using PlatformIO's filesystem uploader.

#### Option B: Using esptool

You can create a LittleFS image and flash it:

1. Install `mklittlefs` tool
2. Create the filesystem image:
  ```bash
  mklittlefs -c out -s 1048576 littlefs.bin
  ```
3. Flash to ESP32:
  ```bash
  esptool.py --port /dev/ttyUSB0 write_flash 0x310000 littlefs.bin
  ```

#### Option C: Custom upload script

Create a script to upload files via the ESP32's OTA mechanism (advanced).

### 3. Access the dashboard

Once uploaded, access your dashboard at:

- **When connected to AP mode:** http://192.168.4.1/app/
- **When connected to WiFi:** http://[your-esp-ip]/app/

The ESPHome interface remains at the root `/` path.

## File Structure

```
webapp/
├── app/
│   ├── components/       # React components
│   │   ├── SensorCard.tsx
│   │   └── StatusCard.tsx
│   ├── layout.tsx        # Root layout
│   ├── page.tsx          # Main dashboard page
│   └── globals.css       # Global styles
├── lib/
│   └── esphome-api.ts    # ESPHome API client
├── next.config.js        # Next.js configuration
├── package.json
└── tsconfig.json
```

## API Integration

The app communicates with ESPHome's REST API:

- `/sensor/{id}` - Get sensor data
- `/number/{id}` - Get number entities
- `/events` - Server-sent events for real-time updates

## Customization

### Adding new sensors

Edit `app/page.tsx` and add new `SensorCard` components with your sensor IDs.

### Changing styles

Modify `app/globals.css` to customize colors, layout, and appearance.

### Updating refresh rate

Change the interval in `app/page.tsx`:

```typescript
const interval = setInterval(fetchData, 5000) // milliseconds
```

## Notes

- The app uses `basePath: '/app'` to avoid conflicts with ESPHome's web interface
- Images are unoptimized for static export compatibility
- Static files are served from ESP32's LittleFS filesystem
- Captive portal functionality is preserved at the root path
