import fs from 'fs'
import path from 'path'
import os from 'os'
import { execFile, spawn } from 'child_process'

export type FirmwareFlashOptions = {
  port: string
  wifiSsid: string
  wifiPassword: string
  setupApName: string
  hubIp: string
  hubPort: number
  tallyName: string
  frontBrightness: number
  rearBrightness: number
  idleBrightness: number
  idleColor: string
}

export type FirmwareFlashResult = {
  ok: boolean
  log: string
}

const firmwareDir = () => path.join(process.cwd(), 'firmware')
const sourceFirmwarePath = () => path.join(firmwareDir(), 'ESP8266_vTally_Listener.bin')
const esptoolPath = () => path.join(firmwareDir(), process.platform === 'win32' ? 'esptool.exe' : 'esptool')

const markers = {
  wifiSsid: 'VTALLY_WIFI_SSID_______________',
  wifiPassword: 'VTALLY_WIFI_PASSWORD________________________________________________',
  setupApName: 'VTALLY_SETUP_AP________________',
  hubIp: 'VTALLY_HUB_IP__________________________',
  hubPort: 'VTALLY_HUB_PORT__',
  tallyName: 'VTALLY_TALLY_NAME______________',
  frontBrightness: 'VTALLY_FRONT_BRIGHTNESS__',
  rearBrightness: 'VTALLY_REAR_BRIGHTNESS___',
  idleBrightness: 'VTALLY_IDLE_BRIGHTNESS___',
  idleColor: 'VTALLY_IDLE_COLOR',
}

const markerLimits = {
  wifiSsid: 32,
  wifiPassword: 64,
  setupApName: 31,
  hubIp: 39,
  hubPort: 5,
  tallyName: 31,
  frontBrightness: 3,
  rearBrightness: 3,
  idleBrightness: 3,
  idleColor: 1,
}

export const getFirmwareToolStatus = () => {
  return {
    firmwareDir: firmwareDir(),
    firmwarePath: sourceFirmwarePath(),
    esptoolPath: esptoolPath(),
    firmwareExists: fs.existsSync(sourceFirmwarePath()),
    esptoolExists: fs.existsSync(esptoolPath()),
  }
}

export const listComPorts = (): Promise<string[]> => {
  if (process.platform !== 'win32') {
    return Promise.resolve([])
  }

  return new Promise(resolve => {
    execFile('reg', ['query', 'HKLM\\HARDWARE\\DEVICEMAP\\SERIALCOMM'], {windowsHide: true}, (error, stdout) => {
      if (error) {
        resolve([])
        return
      }

      const ports = stdout
        .split(/\r?\n/)
        .map(line => {
          const match = line.match(/\s+(COM\d+)\s*$/i)
          return match ? match[1].toUpperCase() : ''
        })
        .filter(Boolean)
        .filter((value, index, list) => list.indexOf(value) === index)
        .sort((a, b) => Number(a.replace('COM', '')) - Number(b.replace('COM', '')))

      resolve(ports)
    })
  })
}

export const flashFirmware = async (options: FirmwareFlashOptions): Promise<FirmwareFlashResult> => {
  validateOptions(options)

  const status = getFirmwareToolStatus()
  if (!status.firmwareExists) {
    throw new Error(`Firmware file was not found: ${status.firmwarePath}`)
  }
  if (!status.esptoolExists) {
    throw new Error(`esptool was not found: ${status.esptoolPath}`)
  }

  const workDir = path.join(os.tmpdir(), 'vtally-firmware')
  fs.mkdirSync(workDir, {recursive: true})
  const patchedFirmwarePath = path.join(workDir, 'ESP8266_vTally_Listener.patched.bin')
  patchFirmware(status.firmwarePath, patchedFirmwarePath, options)

  const logLines: string[] = []
  await runEsptool(['--chip', 'esp8266', '--port', options.port, '--baud', '460800', 'erase_flash'], workDir, logLines)
  await runEsptool(['--chip', 'esp8266', '--port', options.port, '--baud', '460800', 'write_flash', '0x0', patchedFirmwarePath], workDir, logLines)

  return {ok: true, log: logLines.join('\n')}
}

const validateOptions = (options: FirmwareFlashOptions) => {
  if (!/^COM\d+$/i.test(options.port || '')) {
    throw new Error('COM port is invalid.')
  }
  if (!options.setupApName || options.setupApName.length > markerLimits.setupApName) {
    throw new Error('Setup AP name is invalid.')
  }
  if (!options.hubIp || options.hubIp.length > markerLimits.hubIp) {
    throw new Error('Hub IP is invalid.')
  }
  if (!options.hubPort || options.hubPort < 1 || options.hubPort > 65535) {
    throw new Error('Hub port is invalid.')
  }
  if (!options.tallyName || options.tallyName.length > markerLimits.tallyName) {
    throw new Error('Tally name is invalid.')
  }
  ;['frontBrightness', 'rearBrightness', 'idleBrightness'].forEach(key => {
    const value = (options as any)[key]
    if (![1, 16, 32, 64, 128, 255].includes(value)) {
      throw new Error('Brightness must be one of the preset values.')
    }
  })
  if (!['B', 'G', 'R', 'Y', 'W'].includes((options.idleColor || '').toUpperCase())) {
    throw new Error('Idle color is invalid.')
  }
}

const patchFirmware = (sourcePath: string, destinationPath: string, options: FirmwareFlashOptions) => {
  const bytes = fs.readFileSync(sourcePath)
  replaceMarker(bytes, markers.wifiSsid, options.wifiSsid || '', markerLimits.wifiSsid)
  replaceMarker(bytes, markers.wifiPassword, options.wifiPassword || '', markerLimits.wifiPassword)
  replaceMarker(bytes, markers.setupApName, options.setupApName || 'TALLY-SETUP', markerLimits.setupApName)
  replaceMarker(bytes, markers.hubIp, options.hubIp || '', markerLimits.hubIp)
  replaceMarker(bytes, markers.hubPort, String(options.hubPort || 7411), markerLimits.hubPort)
  replaceMarker(bytes, markers.tallyName, options.tallyName || 'Cam01', markerLimits.tallyName)
  replaceMarker(bytes, markers.frontBrightness, String(options.frontBrightness), markerLimits.frontBrightness)
  replaceMarker(bytes, markers.rearBrightness, String(options.rearBrightness), markerLimits.rearBrightness)
  replaceMarker(bytes, markers.idleBrightness, String(options.idleBrightness), markerLimits.idleBrightness)
  replaceMarker(bytes, markers.idleColor, (options.idleColor || 'B').toUpperCase(), markerLimits.idleColor)
  fs.writeFileSync(destinationPath, bytes)
}

const replaceMarker = (bytes: Buffer, marker: string, value: string, maxLength: number) => {
  const markerBytes = Buffer.from(marker, 'ascii')
  const index = bytes.indexOf(markerBytes)
  if (index < 0) {
    throw new Error(`Firmware marker was not found: ${marker}`)
  }

  const valueBytes = Buffer.from((value || '').trim(), 'ascii')
  if (valueBytes.length > maxLength) {
    throw new Error(`Value is too long. Maximum length is ${maxLength} bytes.`)
  }

  bytes.fill(0, index, index + markerBytes.length)
  valueBytes.copy(bytes, index)
}

const runEsptool = (args: string[], workDir: string, logLines: string[]): Promise<void> => {
  return new Promise((resolve, reject) => {
    logLines.push(`> ${path.basename(esptoolPath())} ${args.join(' ')}`)

    const child = spawn(esptoolPath(), args, {
      cwd: firmwareDir(),
      windowsHide: true,
      env: {
        ...process.env,
        TEMP: workDir,
        TMP: workDir,
      },
    })

    child.stdout.on('data', chunk => logLines.push(chunk.toString()))
    child.stderr.on('data', chunk => logLines.push(chunk.toString()))
    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`esptool failed. Exit code: ${code}\n${logLines.join('\n')}`))
      }
    })
  })
}
