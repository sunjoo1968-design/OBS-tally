const assert = require('assert')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const directory = path.resolve(process.argv[2] || 'source/hub/firmware')
const markers = [
    'VTALLY_WIFI_SSID_______________',
    'VTALLY_WIFI_PASSWORD________________________________________________',
    'VTALLY_SETUP_AP________________', 'VTALLY_HUB_IP__________________________',
    'VTALLY_HUB_PORT__', 'VTALLY_TALLY_NAME______________',
    'VTALLY_FRONT_BRIGHTNESS__', 'VTALLY_REAR_BRIGHTNESS___',
    'VTALLY_IDLE_BRIGHTNESS___', 'VTALLY_IDLE_COLOR',
]
for (const file of ['ESP8266_vTally_Listener.bin', 'NodeMCU_V3_vTally_Listener.bin']) {
    const image = fs.readFileSync(path.join(directory, file))
    assert(image.length > 300000 && image[0] === 0xe9, 'Invalid ESP image: ' + file)
    assert(image.includes(Buffer.from('1.5.10')), 'Wrong firmware version: ' + file)
    for (const marker of markers) {
        const offset = image.indexOf(marker)
        assert(offset >= 0 && image.indexOf(marker, offset + 1) === -1, 'Marker not unique: ' + marker)
        assert(image[offset + marker.length] === 0, 'Unterminated marker: ' + marker)
    }
}
const legacy = path.join(directory, 'legacy-nodemcu')
const base = fs.readFileSync(path.join(legacy, 'nodemcu-3.0-master_20200610-cfe68233-float.bin'))
assert.strictEqual(crypto.createHash('sha256').update(base).digest('hex'),
    '566bdb85ff566da9a7b8e384d84716017e892fac7fbcefaff6571436c5f52d40', 'Legacy base changed')
for (const name of ['my-app', 'my-led', 'my-log-buffer', 'my-log', 'my-settings', 'my-tally', 'my-wifi']) {
    const file = fs.readFileSync(path.join(legacy, name + '.lc'))
    assert(file.length > 100 && file.subarray(0, 5).equals(Buffer.from([0x1b, 0x4c, 0x75, 0x61, 0x51])), name)
}
assert(fs.readFileSync(path.join(legacy, 'init.lua'), 'utf8').includes('my-app.lc'))
console.log('PASS: two Arduino images, ten patch markers each, seven legacy programs, unchanged legacy base')
