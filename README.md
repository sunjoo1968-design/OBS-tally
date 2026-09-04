# OBS Tally / wifi-vtally

Customized vTally-based tally system for OBS Studio, vMix, ATEM, and ESP8266 wireless tally lights.

This project is maintained for the SunjooAN portable Windows workflow.

## Current Version

Current maintained package: `v1.5.7`

Version `v1.5.7` persists listener channel assignments reliably across Hub and PC restarts while retaining all v1.5.6 behavior.

## Download

Runtime builds are attached to GitHub Releases.

[Download OBS-tally-v1.5.7-runtime.zip](https://github.com/sunjoo1968-design/OBS-tally/releases/download/v1.5.7/OBS-tally-v1.5.7-runtime.zip)

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
  legacy-nodemcu/
    nodemcu-3.0-master_20200610-cfe68233-float.bin
    *.lc
    init.lua
README_v1.5.7.md
```

No Java, Node.js, or .NET runtime installation is required for normal Windows 11 use.

## v1.5.7 Changes

- Fixed listener `channelIds` and `channelMatchMode` not being written to the configuration file after channel assignment.
- Fixed individual listener settings using the same in-place update path so they are persisted reliably.
- Added regression tests that require a configuration change event for channel and listener-setting updates.
- The web header now shows `V1.5.7`.

## v1.5.6 Changes

- Added a `Firmware Target` selector for current v1.5.x ESP8266 listeners and legacy NodeMCU listeners.
- Legacy NodeMCU listeners can update only `tally-settings.ini` when Hub IP or WiFi settings change.
- Legacy NodeMCU listeners can also be fully reinstalled with the NodeMCU base firmware and Lua/LC program files.
- The firmware page automatically fills the Hub PC's preferred LAN IPv4 address and still allows manual editing.
- Firmware management APIs are restricted to the Hub PC, and concurrent flash requests are rejected.
- Improved vMix reconnect handling, non-contiguous input numbering, empty input handling, UDP recovery, and long-running log memory use.
- The current v1.5.x listener firmware path remains the default.
- The web header now shows `V1.5.6`.

## v1.5.5 Changes

- Mix2 internal PGM/PVW sources no longer affect tally state while the Mix2 input is not visible on main vMix PGM/PVW.
- If Mix2 is on main PGM, the Mix2 internal PGM source is red and the Mix2 internal PVW source is green.
- If Mix2 is on main PVW, the Mix2 internal PGM source is green.
- The web header now shows `V1.5.5`.

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
- Legacy NodeMCU listener settings upload and full reinstall from the web `FIRMWARE` tab
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

  Legacy_NodeMCU_Listener/
    legacy NodeMCU listener firmware, Lua/LC files, upstream source, and tests

  hub/
    customized vTally hub source
    Windows tray launcher source
```

Runtime executables are attached to GitHub Releases. Firmware assets required for reproducible packaging are stored with Git LFS.

## Build Notes

Hub source directory:

```powershell
cd source\hub
npm install --legacy-peer-deps
npm run build:backend
$env:CI='false'; $env:NODE_OPTIONS='--openssl-legacy-provider'; npm run build:frontend
```

After building the frontend, copy the React `build` output into `dist\frontend` before packaging the server.

```powershell
New-Item -ItemType Directory -Force dist\frontend
Copy-Item build\* dist\frontend -Recurse -Force
```

Server executable:

```powershell
npx pkg dist/server.js --config .pkgrc.json --targets node18-win-x64 --output portable\vtally-server.exe
```

Windows tray launcher:

```powershell
dotnet publish tray-launcher\VtallyTray.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:EnableCompressionInSingleFile=true -o portable\single-build
```

## Validation

v1.5.7 was validated with:

```powershell
npm run build:backend
$env:CI='true'; npm test -- --watchAll=false --runInBand TallyContainer VmixConnector
$env:CI='false'; $env:NODE_OPTIONS='--openssl-legacy-provider'; npm run build:frontend
```

The packaged `release\vtally-web.exe` was also launched and checked at `http://localhost:3000/`.

## License and upstream

This project is based on the MIT-licensed `wifi-tally` project by dev at xopn.de. The original copyright and license are preserved in [LICENSE](LICENSE). Legacy upstream Lua source and tests are retained under `source/Legacy_NodeMCU_Listener/upstream-source`.
