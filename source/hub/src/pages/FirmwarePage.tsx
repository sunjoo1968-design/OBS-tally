import React, { useEffect, useRef, useState } from 'react'
import {
  Button,
  Card,
  CardContent,
  CircularProgress,
  Grid,
  InputLabel,
  makeStyles,
  NativeSelect,
  TextField,
  Typography,
} from '@material-ui/core'
import RefreshIcon from '@material-ui/icons/Refresh'
import MemoryIcon from '@material-ui/icons/Memory'
import Layout from '../components/layout/Layout'

const brightnessLevels = [
  {label: '1 - Very Low', value: 1},
  {label: '16 - Low', value: 16},
  {label: '32 - Soft', value: 32},
  {label: '64 - Medium', value: 64},
  {label: '128 - Bright', value: 128},
  {label: '255 - Full', value: 255},
]

const idleColors = [
  {label: 'Blue', value: 'B'},
  {label: 'Green', value: 'G'},
  {label: 'Red', value: 'R'},
  {label: 'Yellow', value: 'Y'},
  {label: 'White', value: 'W'},
]

const useStyles = makeStyles(theme => ({
  page: {
    maxWidth: 960,
    margin: '0 auto',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1.5),
    marginBottom: theme.spacing(2),
  },
  card: {
    borderRadius: 6,
  },
  status: {
    display: 'grid',
    gap: theme.spacing(1),
    marginBottom: theme.spacing(2),
    color: theme.palette.text.secondary,
  },
  row: {
    minHeight: 72,
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    marginTop: theme.spacing(2),
  },
  log: {
    backgroundColor: '#101010',
    border: '1px solid #3b3b3b',
    borderRadius: 4,
    color: '#d7ead7',
    fontFamily: 'Consolas, monospace',
    minHeight: 180,
    padding: theme.spacing(1.5),
    whiteSpace: 'pre-wrap',
    overflow: 'auto',
  },
}))

type FirmwareStatus = {
  firmwareExists: boolean
  esptoolExists: boolean
  network?: {
    defaultHubIp: string
    addresses: string[]
  }
  targets?: {
    current: {
      label: string
      firmwareExists: boolean
    }
    'legacy-nodemcu': {
      label: string
      baseFirmwareExists: boolean
      programFilesCount: number
      programFilesReady: boolean
      missingProgramFiles: string[]
    }
  }
}

const FirmwarePage = () => {
  const classes = useStyles()
  const [status, setStatus] = useState<FirmwareStatus | null>(null)
  const [ports, setPorts] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState('')
  const hubIpTouched = useRef(false)
  const [form, setForm] = useState({
    target: 'current',
    legacyMode: 'settings-only',
    port: '',
    wifiSsid: '',
    wifiPassword: '',
    setupApName: 'TALLY-SETUP',
    hubIp: '',
    hubPort: 7411,
    tallyName: 'Cam01',
    operatorType: 'grb+',
    operatorWs2812: 5,
    operatorWs2812Order: 'grb',
    stageType: 'grb+',
    stageWs2812: 0,
    stageWs2812Order: 'grb',
    frontBrightness: 128,
    rearBrightness: 32,
    idleBrightness: 1,
    idleColor: 'B',
  })

  const setField = (key: string, value: any) => setForm(prev => ({...prev, [key]: value}))

  const loadStatus = async () => {
    try {
      const [statusResponse, portsResponse] = await Promise.all([
        fetch('/api/firmware/status'),
        fetch('/api/firmware/ports'),
      ])
      if (!statusResponse.ok || !portsResponse.ok) {
        throw new Error('Could not load firmware tools or COM ports.')
      }
      const nextStatus = await statusResponse.json()
      const portsJson = await portsResponse.json()
      setStatus(nextStatus)
      setPorts(portsJson.ports || [])
      setForm(prev => ({
        ...prev,
        port: prev.port || (portsJson.ports || [])[0] || '',
        hubIp: hubIpTouched.current ? prev.hubIp : (prev.hubIp || nextStatus.network?.defaultHubIp || ''),
      }))
    } catch (error) {
      setLog(error instanceof Error ? error.message : String(error))
    }
  }

  useEffect(() => {
    loadStatus()
  }, [])

  const flash = async () => {
    setBusy(true)
    setLog(form.target === 'legacy-nodemcu' ? 'Updating legacy NodeMCU listener...\n' : 'Flashing ESP8266...\n')
    try {
      const response = await fetch('/api/firmware/flash', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(form),
      })
      const result = await response.json()
      setLog(result.log || '')
    } catch (error) {
      setLog(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
      loadStatus()
    }
  }

  const currentFirmwareReady = status?.targets?.current?.firmwareExists ?? status?.firmwareExists
  const currentReady = !!currentFirmwareReady && !!status?.esptoolExists
  const legacyReady = form.legacyMode === 'settings-only'
    ? true
    : !!status?.targets?.['legacy-nodemcu']?.baseFirmwareExists && !!status?.targets?.['legacy-nodemcu']?.programFilesReady && !!status?.esptoolExists
  const toolsReady = form.target === 'legacy-nodemcu' ? legacyReady : currentReady
  const isLegacy = form.target === 'legacy-nodemcu'

  return (
    <Layout testId="firmware">
      <div className={classes.page}>
        <div className={classes.header}>
          <MemoryIcon />
          <Typography variant="h4">ESP8266 Firmware</Typography>
        </div>
        <Card className={classes.card}>
          <CardContent>
            <div className={classes.status}>
              <Typography>Current firmware file: {currentFirmwareReady ? 'Ready' : 'Missing'}</Typography>
              <Typography>Legacy NodeMCU files: {status?.targets?.['legacy-nodemcu']?.programFilesReady ? `${status.targets['legacy-nodemcu'].programFilesCount} files ready` : 'Missing'}</Typography>
              <Typography>esptool: {status?.esptoolExists ? 'Ready' : 'Missing'}</Typography>
            </div>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6} className={classes.row}>
                <InputLabel>Firmware Target</InputLabel>
                <NativeSelect fullWidth value={form.target} onChange={event => setField('target', event.target.value as string)}>
                  <option value="current">Current v1.5.x ESP8266 Listener</option>
                  <option value="legacy-nodemcu">Legacy NodeMCU Listener</option>
                </NativeSelect>
              </Grid>
              {isLegacy && <Grid item xs={12} sm={6} className={classes.row}>
                <InputLabel>Legacy Action</InputLabel>
                <NativeSelect fullWidth value={form.legacyMode} onChange={event => setField('legacyMode', event.target.value as string)}>
                  <option value="settings-only">Update IP/WiFi settings only</option>
                  <option value="full-reinstall">Erase and reinstall legacy firmware</option>
                </NativeSelect>
              </Grid>}
              <Grid item xs={12} sm={8} className={classes.row}>
                <InputLabel>COM Port</InputLabel>
                <NativeSelect fullWidth value={form.port} onChange={event => setField('port', event.target.value as string)}>
                  <option value=""></option>
                  {ports.map(port => <option key={port} value={port}>{port}</option>)}
                </NativeSelect>
              </Grid>
              <Grid item xs={12} sm={4} className={classes.row}>
                <Button startIcon={<RefreshIcon />} onClick={loadStatus}>Refresh</Button>
              </Grid>
              <Grid item xs={12} sm={6} className={classes.row}>
                <TextField fullWidth label="WiFi SSID" value={form.wifiSsid} onChange={event => setField('wifiSsid', event.target.value)} />
              </Grid>
              <Grid item xs={12} sm={6} className={classes.row}>
                <TextField fullWidth type="password" label="WiFi Password" value={form.wifiPassword} onChange={event => setField('wifiPassword', event.target.value)} />
              </Grid>
              {!isLegacy && <Grid item xs={12} sm={6} className={classes.row}>
                <TextField fullWidth label="Setup AP Name" value={form.setupApName} onChange={event => setField('setupApName', event.target.value)} />
              </Grid>}
              <Grid item xs={12} sm={6} className={classes.row}>
                <TextField fullWidth label="Tally Name" value={form.tallyName} onChange={event => setField('tallyName', event.target.value)} />
              </Grid>
              <Grid item xs={12} sm={8} className={classes.row}>
                <TextField fullWidth label="Hub IP" value={form.hubIp} onChange={event => {
                  hubIpTouched.current = true
                  setField('hubIp', event.target.value)
                }} />
              </Grid>
              <Grid item xs={12} sm={4} className={classes.row}>
                <TextField fullWidth type="number" label="Hub Port" value={form.hubPort} onChange={event => setField('hubPort', Number(event.target.value))} />
              </Grid>
              {isLegacy && <Grid item xs={12} sm={4} className={classes.row}>
                <InputLabel>Operator RGB LED Type</InputLabel>
                <NativeSelect fullWidth value={form.operatorType} onChange={event => setField('operatorType', event.target.value as string)}>
                  <option value="grb+">Common Anode (grb+)</option>
                  <option value="grb-">Common Cathode (grb-)</option>
                </NativeSelect>
              </Grid>}
              {isLegacy && <Grid item xs={12} sm={4} className={classes.row}>
                <TextField fullWidth type="number" label="Operator WS2812 Count" inputProps={{min: 0, max: 10}} value={form.operatorWs2812} onChange={event => setField('operatorWs2812', Number(event.target.value))} />
              </Grid>}
              {isLegacy && <Grid item xs={12} sm={4} className={classes.row}>
                <InputLabel>Operator WS2812 Color Order</InputLabel>
                <NativeSelect fullWidth value={form.operatorWs2812Order} onChange={event => setField('operatorWs2812Order', event.target.value as string)}>
                  <option value="grb">GRB</option>
                  <option value="rgb">RGB</option>
                </NativeSelect>
              </Grid>}
              {isLegacy && <Grid item xs={12} sm={4} className={classes.row}>
                <InputLabel>Stage RGB LED Type</InputLabel>
                <NativeSelect fullWidth value={form.stageType} onChange={event => setField('stageType', event.target.value as string)}>
                  <option value="grb+">Common Anode (grb+)</option>
                  <option value="grb-">Common Cathode (grb-)</option>
                </NativeSelect>
              </Grid>}
              {isLegacy && <Grid item xs={12} sm={4} className={classes.row}>
                <TextField fullWidth type="number" label="Stage WS2812 Count" inputProps={{min: 0, max: 10}} value={form.stageWs2812} onChange={event => setField('stageWs2812', Number(event.target.value))} />
              </Grid>}
              {isLegacy && <Grid item xs={12} sm={4} className={classes.row}>
                <InputLabel>Stage WS2812 Color Order</InputLabel>
                <NativeSelect fullWidth value={form.stageWs2812Order} onChange={event => setField('stageWs2812Order', event.target.value as string)}>
                  <option value="grb">GRB</option>
                  <option value="rgb">RGB</option>
                </NativeSelect>
              </Grid>}
              {!isLegacy && <Grid item xs={12} sm={4} className={classes.row}>
                <InputLabel>Front Brightness</InputLabel>
                <NativeSelect fullWidth value={form.frontBrightness} onChange={event => setField('frontBrightness', Number(event.target.value))}>
                  {brightnessLevels.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                </NativeSelect>
              </Grid>}
              {!isLegacy && <Grid item xs={12} sm={4} className={classes.row}>
                <InputLabel>Operator Brightness</InputLabel>
                <NativeSelect fullWidth value={form.rearBrightness} onChange={event => setField('rearBrightness', Number(event.target.value))}>
                  {brightnessLevels.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                </NativeSelect>
              </Grid>}
              {!isLegacy && <Grid item xs={12} sm={4} className={classes.row}>
                <InputLabel>Idle Brightness</InputLabel>
                <NativeSelect fullWidth value={form.idleBrightness} onChange={event => setField('idleBrightness', Number(event.target.value))}>
                  {brightnessLevels.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                </NativeSelect>
              </Grid>}
              {!isLegacy && <Grid item xs={12} sm={4} className={classes.row}>
                <InputLabel>Idle Color</InputLabel>
                <NativeSelect fullWidth value={form.idleColor} onChange={event => setField('idleColor', event.target.value as string)}>
                  {idleColors.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                </NativeSelect>
              </Grid>}
            </Grid>
            <div className={classes.actions}>
              <Button variant="contained" color="primary" disabled={busy || !toolsReady || !form.port} onClick={flash}>
                {isLegacy && form.legacyMode === 'settings-only' ? 'Update Legacy Settings' : 'Erase & Flash'}
              </Button>
              {busy && <CircularProgress size={24} />}
            </div>
            <Typography variant="caption">
              필요한 파일은 vtally-web.exe 옆 firmware 폴더에 있어야 합니다.
            </Typography>
          </CardContent>
        </Card>
        <Typography variant="h6" style={{marginTop: 16}}>Flash Log</Typography>
        <div className={classes.log}>{log || 'Ready.'}</div>
      </div>
    </Layout>
  )
}

export default FirmwarePage
