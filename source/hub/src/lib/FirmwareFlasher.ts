import fs from 'fs'
import path from 'path'
import os from 'os'
import net from 'net'
import { execFile, spawn } from 'child_process'
import tmp from 'tmp-promise'

export type FirmwareTarget = 'current' | 'legacy-nodemcu'
export type LegacyFlashMode = 'settings-only' | 'full-reinstall'

export type FirmwareFlashOptions = {
  target?: FirmwareTarget
  legacyMode?: LegacyFlashMode
  port: string
  wifiSsid: string
  wifiPassword: string
  setupApName: string
  hubIp: string
  hubPort: number
  tallyName: string
  operatorType?: string
  operatorWs2812?: number
  operatorWs2812Order?: string
  stageType?: string
  stageWs2812?: number
  stageWs2812Order?: string
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
const legacyFirmwareDir = () => path.join(firmwareDir(), 'legacy-nodemcu')
const legacyBaseFirmwarePath = () => path.join(legacyFirmwareDir(), 'nodemcu-3.0-master_20200610-cfe68233-float.bin')
const requiredLegacyProgramFiles = [
  'init.lua',
  'my-app.lc',
  'my-led.lc',
  'my-log-buffer.lc',
  'my-log.lc',
  'my-settings.lc',
  'my-tally.lc',
  'my-wifi.lc',
]

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
  const legacyFiles = getLegacyProgramFiles()
  const legacyFileNames = legacyFiles.map(file => file.fileName)
  const missingLegacyProgramFiles = requiredLegacyProgramFiles.filter(file => !legacyFileNames.includes(file))
  return {
    firmwareDir: firmwareDir(),
    firmwarePath: sourceFirmwarePath(),
    esptoolPath: esptoolPath(),
    firmwareExists: fs.existsSync(sourceFirmwarePath()),
    esptoolExists: fs.existsSync(esptoolPath()),
    targets: {
      current: {
        label: 'v1.5.x ESP8266 Listener',
        firmwarePath: sourceFirmwarePath(),
        firmwareExists: fs.existsSync(sourceFirmwarePath()),
      },
      'legacy-nodemcu': {
        label: 'Legacy NodeMCU Listener',
        firmwareDir: legacyFirmwareDir(),
        baseFirmwarePath: legacyBaseFirmwarePath(),
        baseFirmwareExists: fs.existsSync(legacyBaseFirmwarePath()),
        programFilesCount: legacyFiles.length,
        programFilesReady: missingLegacyProgramFiles.length === 0,
        missingProgramFiles: missingLegacyProgramFiles,
      },
    },
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
  const target = options.target || 'current'
  if (!['current', 'legacy-nodemcu'].includes(target)) {
    throw new Error('Firmware target is invalid.')
  }
  if (target === 'legacy-nodemcu') {
    return flashLegacyNodeMcu(options)
  }

  validateCurrentOptions(options)

  const status = getFirmwareToolStatus()
  if (!status.firmwareExists) {
    throw new Error(`Firmware file was not found: ${status.firmwarePath}`)
  }
  if (!status.esptoolExists) {
    throw new Error(`esptool was not found: ${status.esptoolPath}`)
  }

  const {path: workDir, cleanup} = await tmp.dir({unsafeCleanup: true})
  try {
    const patchedFirmwarePath = path.join(workDir, 'ESP8266_vTally_Listener.patched.bin')
    patchFirmware(status.firmwarePath, patchedFirmwarePath, options)

    const logLines: string[] = []
    await runEsptool(['--chip', 'esp8266', '--port', options.port, '--baud', '460800', 'erase_flash'], workDir, logLines)
    await runEsptool(['--chip', 'esp8266', '--port', options.port, '--baud', '460800', 'write_flash', '0x0', patchedFirmwarePath], workDir, logLines)
    return {ok: true, log: logLines.join('\n')}
  } finally {
    await cleanup()
  }
}

const validateCommonOptions = (options: FirmwareFlashOptions) => {
  if (!/^COM\d+$/i.test(options.port || '')) {
    throw new Error('COM port is invalid.')
  }
  if (!options.hubIp || net.isIP(options.hubIp) !== 4) {
    throw new Error('Hub IP is invalid.')
  }
  if (!Number.isInteger(options.hubPort) || options.hubPort < 1 || options.hubPort > 65535) {
    throw new Error('Hub port is invalid.')
  }
  if (!isSafeText(options.tallyName) || Buffer.byteLength(options.tallyName, 'utf8') > markerLimits.tallyName) {
    throw new Error('Tally name is invalid.')
  }
}

const validateCurrentOptions = (options: FirmwareFlashOptions) => {
  validateCommonOptions(options)
  if (!options.setupApName || options.setupApName.length > markerLimits.setupApName) {
    throw new Error('Setup AP name is invalid.')
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

const validateLegacyOptions = (options: FirmwareFlashOptions) => {
  validateCommonOptions(options)
  if (!isSafeText(options.wifiSsid) || Buffer.byteLength(options.wifiSsid, 'utf8') > markerLimits.wifiSsid) {
    throw new Error('WiFi SSID is invalid or too long.')
  }
  if (options.wifiSsid.includes('=') || options.tallyName.includes('=')) {
    throw new Error('Legacy WiFi SSID and tally name cannot contain an equals sign.')
  }
  if ((options.wifiPassword || '').includes('=')) {
    throw new Error('Legacy WiFi password cannot contain an equals sign.')
  }
  if (!isSafeText(options.wifiPassword, true) || Buffer.byteLength(options.wifiPassword || '', 'utf8') > markerLimits.wifiPassword) {
    throw new Error('WiFi password is invalid or too long.')
  }
  if (Buffer.byteLength(options.tallyName, 'utf8') > 26) {
    throw new Error('Legacy tally name must not exceed 26 bytes.')
  }
  if (!['grb+', 'grb-'].includes(options.operatorType || 'grb+')) {
    throw new Error('Operator LED type is invalid.')
  }
  if (!['grb+', 'grb-'].includes(options.stageType || 'grb+')) {
    throw new Error('Stage LED type is invalid.')
  }
  ;['operatorWs2812', 'stageWs2812'].forEach(key => {
    const value = (options as any)[key]
    if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > 10)) {
      throw new Error('WS2812 LED count must be between 0 and 10.')
    }
  })
  ;['operatorWs2812Order', 'stageWs2812Order'].forEach(key => {
    const value = (options as any)[key]
    if (value !== undefined && !['grb', 'rgb'].includes(value)) {
      throw new Error('WS2812 color order must be grb or rgb.')
    }
  })
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

const flashLegacyNodeMcu = async (options: FirmwareFlashOptions): Promise<FirmwareFlashResult> => {
  validateLegacyOptions(options)
  const legacyMode = options.legacyMode || 'settings-only'
  if (!['settings-only', 'full-reinstall'].includes(legacyMode)) {
    throw new Error('Legacy flash mode is invalid.')
  }

  const workDir = path.join(os.tmpdir(), 'vtally-legacy-firmware')
  fs.mkdirSync(workDir, {recursive: true})

  const logLines: string[] = []
  if (legacyMode === 'full-reinstall') {
    if (!fs.existsSync(esptoolPath())) {
      throw new Error(`esptool was not found: ${esptoolPath()}`)
    }
    if (!fs.existsSync(legacyBaseFirmwarePath())) {
      throw new Error(`Legacy NodeMCU firmware was not found: ${legacyBaseFirmwarePath()}`)
    }

    const programFiles = getLegacyProgramFiles()
    const availableFiles = programFiles.map(file => file.fileName)
    const missingFiles = requiredLegacyProgramFiles.filter(file => !availableFiles.includes(file))
    if (missingFiles.length > 0) {
      throw new Error(`Legacy NodeMCU program files were not found: ${legacyFirmwareDir()}`)
    }

    await runEsptool(['--chip', 'esp8266', '--port', options.port, '--baud', '460800', 'erase_flash'], workDir, logLines)
    await runEsptool(['--chip', 'esp8266', '--port', options.port, '--baud', '460800', 'write_flash', '0x0', legacyBaseFirmwarePath()], workDir, logLines)
    await sleep(4000)
    await uploadLegacyNodeMcuFiles(options.port, programFiles, createLegacySettingsIni(options), logLines)
  } else {
    await uploadLegacyNodeMcuSettings(options.port, createLegacySettingsIni(options), logLines)
  }

  return {ok: true, log: logLines.join('\n')}
}

const getLegacyProgramFiles = () => {
  if (!fs.existsSync(legacyFirmwareDir())) {
    return []
  }

  return fs.readdirSync(legacyFirmwareDir())
    .filter(fileName => fileName.endsWith('.lc') || fileName.endsWith('.lua'))
    .sort((a, b) => {
      if (a === 'init.lua') return 1
      if (b === 'init.lua') return -1
      return a.localeCompare(b)
    })
    .map(fileName => ({
      fileName,
      filePath: path.join(legacyFirmwareDir(), fileName),
    }))
}

export const createLegacySettingsIni = (options: FirmwareFlashOptions) => [
  `station.ssid=${options.wifiSsid || ''}`,
  `station.password=${options.wifiPassword || ''}`,
  `hub.ip=${options.hubIp}`,
  `hub.port=${options.hubPort || 7411}`,
  `tally.name=${options.tallyName}`,
  `operator.type=${options.operatorType || 'grb+'}`,
  `operator.ws2812=${options.operatorWs2812 === undefined ? 5 : options.operatorWs2812} ${options.operatorWs2812Order || 'grb'}`,
  `stage.type=${options.stageType || 'grb+'}`,
  `stage.ws2812=${options.stageWs2812 === undefined ? 0 : options.stageWs2812} ${options.stageWs2812Order || 'grb'}`,
  '',
].join('\n')

const uploadLegacyNodeMcuFiles = async (
  port: string,
  files: {fileName: string, filePath: string}[],
  settingsIni: string,
  logLines: string[],
) => {
  for (const file of files) {
    logLines.push(`> serial upload ${file.fileName}`)
    await uploadLegacyFileViaPowerShell(port, file.filePath, file.fileName, false, logLines)
    await sleep(300)
  }

  const {path: tmpPath, cleanup} = await tmp.file({})
  try {
    fs.writeFileSync(tmpPath, settingsIni)
    logLines.push('> serial upload tally-settings.ini')
    await uploadLegacyFileViaPowerShell(port, tmpPath, 'tally-settings.ini', true, logLines)
  } finally {
    cleanup()
  }
}

const uploadLegacyNodeMcuSettings = async (
  port: string,
  settingsIni: string,
  logLines: string[],
) => {
  const {path: tmpPath, cleanup} = await tmp.file({})
  try {
    fs.writeFileSync(tmpPath, settingsIni)
    logLines.push('> serial upload tally-settings.ini')
    await uploadLegacyFileViaPowerShell(port, tmpPath, 'tally-settings.ini', true, logLines)
  } finally {
    cleanup()
  }
}

const uploadLegacyFileViaPowerShell = async (
  port: string,
  sourcePath: string,
  remoteFileName: string,
  restart: boolean,
  logLines: string[],
) => {
  const commandsPath = path.join(os.tmpdir(), `vtally-legacy-${Date.now()}-${Math.random().toString(16).slice(2)}.cmds`)
  const scriptPath = path.join(os.tmpdir(), `vtally-legacy-${Date.now()}-${Math.random().toString(16).slice(2)}.ps1`)

  fs.writeFileSync(commandsPath, createLegacyUploadCommands(sourcePath, remoteFileName, restart).join('\n'), 'utf8')
  fs.writeFileSync(scriptPath, legacyPowerShellUploaderScript, 'utf8')

  try {
    await runPowerShellUploader(scriptPath, port, commandsPath, logLines)
  } finally {
    removeTempFile(commandsPath)
    removeTempFile(scriptPath)
  }
}

const removeTempFile = (filePath: string) => {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
  }
}

const createLegacyUploadCommands = (sourcePath: string, remoteFileName: string, restart: boolean) => {
  const bytes = fs.readFileSync(sourcePath)
  const commands = [
    `file.remove("${remoteFileName}")`,
    `file.open("${remoteFileName}", "w+")`,
  ]

  for (let offset = 0; offset < bytes.length; offset += 48) {
    commands.push(`file.write(${luaStringLiteral(bytes.subarray(offset, offset + 48))})`)
  }

  commands.push('file.close()')
  if (restart) {
    commands.push('node.restart()')
  }
  return commands
}

const luaStringLiteral = (bytes: Buffer) => {
  let value = '"'
  bytes.forEach(byte => {
    if (byte === 34) {
      value += '\\"'
    } else if (byte === 92) {
      value += '\\\\'
    } else if (byte === 10) {
      value += '\\n'
    } else if (byte === 13) {
      value += '\\r'
    } else if (byte >= 32 && byte <= 126) {
      value += String.fromCharCode(byte)
    } else {
      value += `\\${byte.toString().padStart(3, '0')}`
    }
  })
  value += '"'
  return value
}

const runPowerShellUploader = (
  scriptPath: string,
  port: string,
  commandsPath: string,
  logLines: string[],
): Promise<void> => {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      '-Port',
      port,
      '-CommandsPath',
      commandsPath,
    ], {
      windowsHide: true,
    })

    child.stdout.on('data', chunk => logLines.push(chunk.toString()))
    child.stderr.on('data', chunk => logLines.push(chunk.toString()))
    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`Legacy serial upload failed. Exit code: ${code}\n${logLines.join('\n')}`))
      }
    })
  })
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const legacyPowerShellUploaderScript = `
param(
  [Parameter(Mandatory=$true)][string]$Port,
  [Parameter(Mandatory=$true)][string]$CommandsPath
)
$ErrorActionPreference = 'Stop'
$serial = New-Object System.IO.Ports.SerialPort $Port, 115200, 'None', 8, 'One'
$serial.NewLine = "\`r\`n"
$serial.ReadTimeout = 1000
$serial.WriteTimeout = 5000
$serial.DtrEnable = $false
$serial.RtsEnable = $false
try {
  $openDeadline = [DateTime]::UtcNow.AddSeconds(15)
  while (-not $serial.IsOpen) {
    try {
      $serial.Open()
    } catch {
      if ([DateTime]::UtcNow -ge $openDeadline) { throw }
      Start-Sleep -Milliseconds 500
    }
  }
  Start-Sleep -Milliseconds 600
  $serial.DiscardInBuffer()
  $serial.Write("\`r\`n")
  Start-Sleep -Milliseconds 300
  $null = $serial.ReadExisting()
  $commands = Get-Content -LiteralPath $CommandsPath
  foreach ($command in $commands) {
    if ($command.Length -eq 0) { continue }
    $serial.DiscardInBuffer()
    $serial.Write($command + "\`r\`n")
    if ($command -eq 'node.restart()') {
      Start-Sleep -Milliseconds 800
      continue
    }

    $deadline = [DateTime]::UtcNow.AddSeconds(5)
    $response = ''
    do {
      Start-Sleep -Milliseconds 25
      $response += $serial.ReadExisting()
      if ($response -match '(?m)>\s*$') { break }
    } while ([DateTime]::UtcNow -lt $deadline)

    if ($response -notmatch '(?m)>\s*$') {
      throw "NodeMCU prompt timeout after command: $command"
    }
    if ($response -match '(?i)stdin:|error|not enough memory|panic|stack traceback') {
      throw "NodeMCU rejected command: $command\`n$response"
    }
  }
  Write-Output "Legacy NodeMCU serial upload completed and verified."
} finally {
  if ($serial.IsOpen) {
    $serial.Close()
  }
}
`

const replaceMarker = (bytes: Buffer, marker: string, value: string, maxLength: number) => {
  const markerBytes = Buffer.from(marker, 'ascii')
  const index = bytes.indexOf(markerBytes)
  if (index < 0) {
    throw new Error(`Firmware marker was not found: ${marker}`)
  }

  const valueBytes = Buffer.from((value || '').trim(), 'utf8')
  if (valueBytes.length > maxLength) {
    throw new Error(`Value is too long. Maximum length is ${maxLength} bytes.`)
  }

  bytes.fill(0, index, index + markerBytes.length)
  valueBytes.copy(bytes, index)
}

const isSafeText = (value?: string, allowEmpty = false) => {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) return false
  return !/[\u0000-\u001f\u007f]/.test(value)
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
