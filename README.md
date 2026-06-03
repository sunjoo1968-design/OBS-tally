# OBS Tally / wifi-vtally

Customized vTally-based tally system for OBS Studio, vMix, ATEM, and ESP8266 wireless tally lights.

This project is maintained for the SunjooAN portable Windows workflow.

## Current Version

Current maintained package: `v1.5.0`

Version `v1.5.0` improves vMix Mix2 source tally responsiveness, adds web UI version branding, and keeps runtime executable files attached to GitHub Releases instead of storing large build artifacts directly in Git.

## Download

Runtime builds are attached to GitHub Releases.

[Download OBS-tally-v1.5.0-runtime.zip](https://github.com/sunjoo1968-design/OBS-tally/releases/download/v1.5.0/OBS-tally-v1.5.0-runtime.zip)

After downloading:

1. Extract the zip file.
2. Run `vtally-web.exe`.
3. Open `http://localhost:3000/` if the browser does not open automatically.

The runtime folder must keep this structure:

```text
vtally-web.exe
firmware/
  ESP8266_vTally_Listener.bin
  esptool.exe
README_v1.5.0.md
```

No Java, Node.js, or .NET runtime installation is required for normal Windows 11 use.

## v1.5.0 Changes

- Reduced vMix Mix input XML polling from 1000ms to 250ms.
- Triggered a rate-limited XML refresh immediately after vMix `TALLY OK` events.
- Buffered vMix TCP responses before command parsing so fragmented XML is handled safely.
- Reconnected vMix with a fresh socket instead of reusing a closed socket.
- Limited `vmix-mix-debug.json` writes to `VTALLY_VMIX_DEBUG=true`.
- Added `made by SunjooAN` and `V1.5.0` to the web header.

## Main Features

- Portable Windows tray launcher
- Web UI served at `http://localhost:3000/`
- OBS WebSocket 5.x support
- OBS scene, group, and source-based tally matching
- Multiple tally match conditions with `AND` / `OR`
- vMix support including Mix2 internal source tally matching
- ATEM support retained
- ESP8266 NodeMCU tally listener firmware
- ESP8266 firmware flashing from the web `FIRMWARE` tab
- 3D model files for the tally enclosure

## Repository Layout

```text
3D-Model/
  STL enclosure model files

config/
  wifi-tally.sample.json

release/
  README files for packaged releases

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
npm install --legacy-peer-deps
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

## Validation

v1.5.0 was validated with:

```powershell
npm run build:backend
$env:CI='true'; npm test -- --watchAll=false --runInBand VmixConnector
$env:CI='false'; $env:NODE_OPTIONS='--openssl-legacy-provider'; npm run build:frontend
```

The packaged `release\vtally-web.exe` was also launched and checked at `http://localhost:3000/`.
