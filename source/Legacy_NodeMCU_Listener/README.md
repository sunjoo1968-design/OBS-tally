# Legacy NodeMCU Listener Firmware

This folder contains the legacy vTally listener payload used by the early NodeMCU ESP8266 hardware.

It is intentionally kept separate from `source/ESP8266_vTally_Listener`, which is the current v1.5.x listener firmware.

## Files

- `nodemcu-3.0-master_20200610-cfe68233-float.bin`: NodeMCU base firmware for a full reinstall.
- `*.lc` and `init.lua`: legacy vTally listener program files uploaded to the NodeMCU filesystem.
- `tally-settings.ini.example`: example settings file format.
- `upstream-source/`: original Lua source and tests retained from the MIT-licensed wifi-tally 0.5.2 project.

## Settings

The legacy listener reads these values from `tally-settings.ini`:

- `operator.type` / `stage.type`: `grb+` for common-anode RGB LEDs or `grb-` for common-cathode LEDs.
- `operator.ws2812` / `stage.ws2812`: LED count from `0` to `10` plus `grb` or `rgb` color order, for example `8 grb`.

```ini
station.ssid=MyWifi
station.password=topsecret
hub.ip=10.10.1.1
hub.port=7411
tally.name=Cam01
```

When only the Hub IP or WiFi settings change, use the Hub web `FIRMWARE` page and select `Legacy NodeMCU Listener` with `Update IP/WiFi settings only`.

Use `Erase and reinstall legacy firmware` only for a blank board or a board that needs the legacy firmware reinstalled.

The upstream source is Copyright (c) 2020 dev at xopn.de and is distributed under the repository's MIT `LICENSE`.
