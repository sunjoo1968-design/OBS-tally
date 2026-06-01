# OBS Tally / wifi-vtally

This repository contains a customized vTally-based tally system for OBS Studio, vMix, ATEM, and ESP8266-based wireless tally lights.

The project started from the original [wifi-tally](https://github.com/wifi-tally/wifi-tally) codebase and was modified for a practical portable Windows workflow, OBS WebSocket 5.x support, source-based OBS tally matching, vMix Mix support, and ESP8266 firmware flashing from the web UI.

## Current Version

Current maintained package: `wifi-vtally-v1.0.1`

Version `v1.0.1` keeps the same features as `v1.0.0`, but separates runtime build artifacts from the source repository. Large executable files are published through GitHub Releases instead of being stored directly in Git.

## Download

Runtime builds are attached to GitHub Releases.

[Download OBS-tally-v1.0.1-runtime.zip](https://github.com/sunjoo1968-design/OBS-tally/releases/download/v1.0.1/OBS-tally-v1.0.1-runtime.zip)

After downloading:

1. Extract the zip file.
2. Run `vtally-web.exe`.
3. Open `http://localhost:3000/` if the browser does not open automatically.

The runtime folder must keep this structure:

```text
vtally-web.exe
vtally-server.exe
firmware/
  ESP8266_vTally_Listener.bin
  esptool.exe
  NodeMCU-PyFlasher.exe
  CP210x_Universal_Windows_Driver.zip
```

No Java, Node.js, or .NET runtime installation is required for normal Windows 11 use.

## Main Features

- Portable Windows tray launcher
- Web UI served at `http://localhost:3000/`
- OBS WebSocket 5.x support
- OBS scene, group, and source-based tally matching
- Multiple tally match conditions with `AND` / `OR`
- vMix support including Mix2 and higher internal source tally matching
- ATEM support retained
- Roland V-8HD / V-60HD code removed from this customized version
- `Tally Defaults` and old web flash tab removed from the hub UI
- ESP8266 NodeMCU tally listener firmware
- ESP8266 firmware flashing from the web `FIRMWARE` tab
- 3D model files for the tally enclosure

## Web UI Tabs

### TALLIES

Manages tally cards and patching.

For OBS, a tally can be linked to:

- a scene
- a group
- a source inside a scene or group
- multiple source conditions using `AND` or `OR`

### CONFIGURATION

Configures mixer connection settings.

Supported mixer targets in this customized version:

- OBS
- vMix
- ATEM

### FIRMWARE

Flashes ESP8266 NodeMCU tally listener firmware without opening the Arduino IDE.

Configurable values:

- COM port
- WiFi SSID
- WiFi password
- setup AP name
- hub IP
- hub port
- tally name
- front brightness
- operator brightness
- idle brightness
- idle color

Brightness is selected from six preset levels:

```text
1, 16, 32, 64, 128, 255
```

## ESP8266 Tally Listener

The included firmware targets a NodeMCU ESP8266 tally listener.

Expected hardware:

- NodeMCU Lua WiFi V3 ESP8266
- SSD1306 128x64 I2C OLED
- WS2812 LED ring/bar chain
- reset/config button on the ESP8266 flash button pin

Implemented listener behavior:

- UDP registration to the hub using `tally-ho "TALLY_NAME"`
- program tally state
- preview tally state
- idle state shown as low-brightness blue on the operator side
- OLED status display
- 3-second button hold for WiFi/hub setup portal
- 10-second button hold for factory reset

## Repository Layout

```text
3D-Model/
  STL enclosure model files

config/
  wifi-tally.sample.json

source/
  ESP8266_vTally_Listener/
    Arduino ESP8266 listener source

  hub/
    customized vTally hub source
    Windows tray launcher source
```

Large runtime artifacts are intentionally not stored directly in the repository. They are attached to GitHub Releases.

## Build Notes

Hub source directory:

```powershell
cd source\hub
npm install
npm run build:backend
$env:CI='false'; $env:NODE_OPTIONS='--openssl-legacy-provider'; npm run build:frontend
```

After building the frontend, copy the React `build` output into `dist\frontend` before packaging the server.

Server executable:

```powershell
npx pkg dist/server.js --config .pkgrc.json --targets node18-win-x64 --output portable\vtally-server.exe
```

Windows tray launcher:

```powershell
dotnet publish tray-launcher\VtallyTray.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:EnableCompressionInSingleFile=true -o portable\single-build
```

## Notes About Large Files

Earlier versions stored runtime executables directly in the repository using Git LFS. The current structure keeps the repository source-focused and publishes runtime packages through GitHub Releases.

Use the Release zip for normal operation. Use the repository source only when modifying or rebuilding the project.

