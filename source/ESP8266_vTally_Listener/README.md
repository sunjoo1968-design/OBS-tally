# NodeMCU Lua WiFi V3 build

Maintained firmware version: **v1.5.10**. The current ESP8266 and NodeMCU V3
targets use the same source, pins and `nodemcuv2` profile. Their binaries are
intentionally identical; neither is the legacy Lua firmware.

`ESP8266_vTally_Listener.ino` supports the NodeMCU Lua WiFi V3 hardware through the Arduino ESP8266 core. The word `Lua` in the board name does not require Lua source code; flashing this image replaces the Lua runtime with the complete vTally listener firmware.

## Arduino CLI build

```powershell
arduino-cli compile --fqbn esp8266:esp8266:nodemcuv2 ESP8266_vTally_Listener
```

Validated toolchain:

- ESP8266 Arduino core 3.1.2
- Board: NodeMCU 1.0 (ESP-12E Module)
- Flash: 4 MB, DIO, 80 MHz CPU

From the repository root, `./scripts/build-listeners.ps1` compiles host regression
tests, the Arduino firmware and compatible legacy programs, then validates Hub
patch markers before replacing `source/hub/firmware` payloads. It needs MSVC 2022,
Arduino CLI and NodeMCU `luac.cross`; see the legacy README for the compiler.
`-ArduinoCli` and `-LuacCross` override local tool paths. It never flashes a board.

## v1.5.10 Stability Patch

- Fixed-size UDP reads, bounded packet processing, strict format/range checks and configured Hub sender validation.
- Repeated packets refresh health without restarting flash phase or rewriting LEDs/OLED.
- WiFi drop/IP change invalidates old state; UDP bind failures retry every second.
- Button holds do not stop communication. Manual portal is nonblocking; WiFi saves clear stale output before library connection waits.
- Appended EEPROM CRC and string validation; erased CRC slots support older settings. CRC is integrity detection, not atomic recovery.
- Skip identical pixel output, refresh OLED at most every 100ms for changed state and every second otherwise; continue if display buffer allocation fails.

See [test results and limitations](../../docs/LISTENER_STABILITY_REVIEW_v1.5.10.md).
Updating through the existing Hub Firmware page erases board settings; enter all
required WiFi/Hub/name values first. EEPROM compatibility matters only when an
external programming method deliberately retains the settings sector.

## Wiring

- D5 / GPIO14: WS2812 data, front 8 LEDs followed by operator 8 LEDs
- D2 / GPIO4: OLED SDA
- D1 / GPIO5: OLED SCL
- D3 / GPIO0: configuration reset button; do not hold it while powering on
- OLED: SSD1306 128x64, I2C address `0x3C`

Use the Hub Firmware page target `NodeMCU Lua WiFi V3 (Arduino firmware)`. Hub IP, WiFi, tally name, brightness and idle color are patched into the binary before flashing. The existing `Legacy NodeMCU Listener` target remains available when the Lua runtime and legacy `.lc` files must be retained.
