# vTally Hub v1.5.10

Computer-side OBS/vMix/ATEM tally server, React web UI and portable Windows tray launcher.

Canonical flash payloads live in `firmware/`. Do not move them out of the runtime
`firmware/` directory. Hardware sources live in the sibling listener folders.
The header shows `made by SunjooAN` and `V1.5.10`.

## Development and Build

See [current build guide](../../docs/BUILD_v1.5.10.md).
Dependencies and generated `build/`, `dist/`, `portable/`, tray `bin/obj` and caches
are not distributed. Install dependencies before running development commands.

```powershell
npm ci --legacy-peer-deps
npm run build:backend
$env:CI='true'
npm test -- --watchAll=false --runInBand --silent
```

## Stability and Operation

See [OBS review](../../docs/OBS_STABILITY_REVIEW_v1.5.10.md) and
[listener review](../../docs/LISTENER_STABILITY_REVIEW_v1.5.10.md).
The Hub retains bounded OBS requests, safe collection transitions, reconnect
backoff, scene caching and atomic configuration replacement. Existing vMix Mix2
visibility semantics and persistent channel assignments are unchanged.

Listener updates are separate from Windows Hub replacement. Flashing erases
board settings; enter WiFi/Hub/name values first. Legacy settings-only uploads do
not install patched `.lc` files. Firmware operations are restricted to the Hub PC.
Do not expose the management server to the internet.
