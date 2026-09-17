import { createLegacySettingsIni, FirmwareFlashOptions, flashFirmware, getFirmwareToolStatus } from './FirmwareFlasher'

const options: FirmwareFlashOptions = {
  target: 'legacy-nodemcu',
  legacyMode: 'settings-only',
  port: 'COM1',
  wifiSsid: 'StudioWiFi',
  wifiPassword: 'secret',
  setupApName: 'TALLY-SETUP',
  hubIp: '192.168.0.25',
  hubPort: 7411,
  tallyName: 'Cam01',
  operatorType: 'grb+',
  operatorWs2812: 8,
  operatorWs2812Order: 'grb',
  stageType: 'grb-',
  stageWs2812: 4,
  stageWs2812Order: 'rgb',
  frontBrightness: 128,
  rearBrightness: 32,
  idleBrightness: 1,
  idleColor: 'B',
}

describe('legacy firmware settings', () => {
  test('writes the complete tally-settings.ini format', () => {
    expect(createLegacySettingsIni(options)).toBe([
      'station.ssid=StudioWiFi',
      'station.password=secret',
      'hub.ip=192.168.0.25',
      'hub.port=7411',
      'tally.name=Cam01',
      'operator.type=grb+',
      'operator.ws2812=8 grb',
      'stage.type=grb-',
      'stage.ws2812=4 rgb',
      '',
    ].join('\n'))
  })

  test('rejects invalid Hub IP before opening a COM port', async () => {
    await expect(flashFirmware({...options, hubIp: 'not-an-ip'})).rejects.toThrow('Hub IP is invalid')
  })

  test('rejects settings line injection before opening a COM port', async () => {
    await expect(flashFirmware({...options, wifiSsid: 'Studio\nHub.ip=1.2.3.4'})).rejects.toThrow('WiFi SSID is invalid')
  })

  test('rejects unsupported flash modes before opening a COM port', async () => {
    await expect(flashFirmware({...options, legacyMode: 'invalid' as any})).rejects.toThrow('Legacy flash mode is invalid')
  })
})

describe('NodeMCU V3 Arduino firmware', () => {
  test('exposes a dedicated firmware target', () => {
    const target = getFirmwareToolStatus().targets['nodemcu-v3']
    expect(target.label).toContain('NodeMCU Lua WiFi V3')
    expect(target.firmwarePath).toMatch(/NodeMCU_V3_vTally_Listener\.bin$/)
  })
})
