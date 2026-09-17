# OBS Tally v1.5.10

Wireless tally system for OBS Studio, vMix and ATEM, maintained by SunjooAN.
Portable Windows Hub, current ESP8266/NodeMCU V3 firmware and legacy NodeMCU Lua listeners.

[한국어 안내](README_KR.md) | [Repository](https://github.com/sunjoo1968-design/OBS-tally)

## Download and Run

- [Windows runtime ZIP](https://github.com/sunjoo1968-design/OBS-tally/releases/download/v1.5.10/OBS-tally-v1.5.10-runtime.zip)
- [Firmware-only ZIP](https://github.com/sunjoo1968-design/OBS-tally/releases/download/v1.5.10/OBS-tally-v1.5.10-firmware.zip)
- [Release notes](release/README_v1.5.10.md)

Extract the runtime ZIP, run `vtally-web.exe`, and open `http://localhost:3000/`.
Keep the included `firmware/` directory next to the executable.
Windows x64 requires no separate Java, Node.js or .NET installation.
In this workspace, the executable is `release/v1.5.10/vtally-web.exe`.

Back up existing `wifi-tally.json` and `vtally-web-options.json` before replacing
the Hub. Only sample settings are distributed. Use a trusted LAN; do not expose
the management UI to the internet, and enable OBS WebSocket authentication.

## Current Features

- OBS WebSocket v5 scene/group/source matching, bounded requests, event coalescing and safe collection changes.
- vMix Mix2 tally only when Mix2 is visible on main PGM/PVW; ATEM support.
- Multiple channel conditions with AND/OR and persistent listener assignments.
- Portable tray launcher, web tallies and local-PC firmware management.
- Current/V3 and legacy listener selection, configurable WiFi/Hub/name/brightness or legacy INI.
- Enclosure STL models in `3D-Model/`.

## Listener Stability Patch

Strict UDP format/range/sender checks, valid-packet-only heartbeat updates,
stable flash phase across keep-alives, correct identify/unknown/color output,
WiFi/IP/UDP recovery, nonblocking manual setup, EEPROM CRC validation and reduced
LED/OLED work. Legacy programs also fix timer wrap, reconnect timer accumulation
and failed log send recursion/loss. Hardware wiring and mixer semantics remain intact.

**Install firmware on every listener to apply these patches.** Updating the Hub
alone does not update boards. The existing flash workflow erases board settings:
confirm and enter WiFi/Hub/name/INI values first. Legacy settings-only mode does
not install new programs; use full reinstall for this upgrade.

## Repository Layout

```text
3D-Model/                         enclosure STL files
config/wifi-tally.sample.json      clean configuration template
docs/                             current build and stability reports
release/README_v1.5.10.md           current release notes
release/v1.5.10/                   local runtime (not committed)
scripts/                          listener build and release packaging
source/ESP8266_vTally_Listener/    current/V3 Arduino source and tests
source/Legacy_NodeMCU_Listener/    maintained Lua source and tests
source/hub/                       Hub and Windows tray source
source/hub/firmware/              canonical flash payloads (Git LFS)
```

Only current release artifacts remain in the working tree. Build caches,
downloaded toolchains and old duplicate sources are removed. Git history and
previous GitHub releases remain available for recovery.

## Build and Validation

See [build instructions](docs/BUILD_v1.5.10.md),
[OBS stability review](docs/OBS_STABILITY_REVIEW_v1.5.10.md) and
[listener stability review](docs/LISTENER_STABILITY_REVIEW_v1.5.10.md).
Hub: 250 tests passed, 1 existing skip; packaged runtime: 5 smoke checks passed.
Arduino source/hardware mock: 32 assertions; legacy source and compiled programs:
89 assertions each. Firmware and ZIP checksums validated.
Physical boards and long-running live broadcasts still require field testing.

## License

Based on the MIT-licensed wifi-tally project, Copyright (c) 2020 dev at xopn.de.
Original copyright and license are preserved in [LICENSE](LICENSE).
See [legacy attribution](source/Legacy_NodeMCU_Listener/UPSTREAM.md).
