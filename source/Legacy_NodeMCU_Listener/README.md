# Legacy NodeMCU Listener v1.5.10

Maintained Lua listener for the early NodeMCU hardware. This is separate from
the current/V3 Arduino firmware and keeps the legacy electrical pinout.

## Canonical Files

- `src/`: maintained Lua source, including `init.lua`.
- `tests/regression.lua`: mocked source/compiled-output tests.
- `UPSTREAM.md`: original copyright and source attribution.
- `../hub/firmware/legacy-nodemcu/`: base image, 7 compiled `.lc` programs, init and INI example.

Original duplicate sources/tests and the second binary mirror were removed.
The original MIT copyright remains in the repository LICENSE and attribution.
The NodeMCU base image remains byte-for-byte unchanged; its 2020 filename identifies
the compatible runtime, not the current project release version.

## Settings and Wiring

`tally-settings.ini` contains `station.ssid`, `station.password`, `hub.ip`,
`hub.port` and `tally.name`. Empty passwords support open WiFi; `=` inside a
password is preserved. Hub port is 1..65535 and Hub address is IPv4.

`operator.type`/`stage.type`: `grb+` common-anode or `grb-` common-cathode.
`operator.ws2812`/`stage.ws2812`: integer 0..10 and optional `grb`/`rgb`, such as
`8 grb`. WS2812 uses D4, operator first and stage next. PWM operator G/R/B uses
D1/D2/D3, stage G/R/B D5/D6/D7, onboard LED D0. Existing hardware is unchanged.

For IP/WiFi changes only, choose the legacy target's settings-only mode in the
Hub. **To install patched programs, use full reinstall** after recording your INI
values. Full reinstall erases the filesystem and writes the entered settings.

## Compiler and Tests

Use official [NodeMCU 3.0-master_20200610](https://github.com/nodemcu/nodemcu-firmware/tree/3.0-master_20200610)
`luac.cross`, not standard `luac` (incompatible constant encoding).
Keep non-integral numbers. MSVC project `msvc/luac-cross/luac-cross.vcxproj` builds
with Release/Win32, `PlatformToolset=v143`, `WindowsTargetPlatformVersion=10.0.26100.0`.
For `-e` host tests, change the downloaded compiler's cross-only `rotables_meta`
entry in `app/lua/linit.c` from `_index` to `__index`. This fixes host library lookup,
not the bytecode ABI or the shipped base image; hardware linker registration is unaffected.

Run `scripts/build-listeners.ps1 -LuacCross <path>` from the repository root.
It compares compiler compatibility with existing payloads, compiles with `-s`,
executes tests against `.lc`, validates images and updates `source/hub/firmware`.
It never flashes boards. Standard Lua 5.1 can run `tests/regression.lua` on source.

See [build guide](../../docs/BUILD_v1.5.10.md) and
[stability review](../../docs/LISTENER_STABILITY_REVIEW_v1.5.10.md).
