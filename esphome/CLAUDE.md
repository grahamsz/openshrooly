# OpenShrooly ESPHome Development Instructions

## Building and Uploading After Web UI Changes

**IMPORTANT**: When you make changes to the web UI (webapp), you MUST follow these steps IN ORDER:

1. Build the Next.js webapp:
```bash
cd /home/gxs/dev/openshrooly/webapp && npm run build
```

2. Embed the static files into C++ headers:
```bash
cd /home/gxs/dev/openshrooly/esphome && python3 external_components/web_server/embed_static_files.py ../webapp/out external_components/web_server/static_files.h external_components/web_server/static_files.cpp
```

3. **COMPILE** the ESPHome firmware (this is required after embedding!):
```bash
source ~/dev/esphome/.venv/bin/activate && esphome compile openshrooly.yaml
```

4. Upload via OTA:
```bash
source ~/dev/esphome/.venv/bin/activate && esphome upload openshrooly.yaml --device openshrooly.local
```

**WARNING**: If you skip step 3 (compile), the upload will use the OLD firmware without your new web UI changes!

## Compiling the Project (ESPHome changes only)

Before compiling, activate the ESPHome virtual environment:

```bash
source ~/dev/esphome/.venv/bin/activate
```

Then compile the configuration:

```bash
esphome compile openshrooly.yaml
```

## Project Overview

OpenShrooly is an ESPHome-based mushroom growing environment controller with:
- Temperature and humidity monitoring
- Air exchange control
- Humidifier control
- Light control
- E-paper display with LVGL interface
- 4 touch buttons for UI navigation
- Web interface (Next.js React app embedded in firmware)
- Home Assistant integration

## Key Components

- **Main config**: `openshrooly.yaml`
- **Components**: Located in `components/` directory
- **Scripts**: Located in `scripts/` directory
- **External components**: Located in `external_components/` directory
- **Web UI**: Located in `/home/gxs/dev/openshrooly/webapp/` (Next.js React app)
