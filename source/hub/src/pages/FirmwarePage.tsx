import React, { useEffect, useState } from 'react'
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
  firmwareDir: string
  firmwarePath: string
  esptoolPath: string
  firmwareExists: boolean
  esptoolExists: boolean
}

const FirmwarePage = () => {
  const classes = useStyles()
  const [status, setStatus] = useState<FirmwareStatus | null>(null)
  const [ports, setPorts] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState('')
  const [form, setForm] = useState({
    port: '',
    wifiSsid: '',
    wifiPassword: '',
    setupApName: 'TALLY-SETUP',
    hubIp: '',
    hubPort: 7411,
    tallyName: 'Cam01',
    frontBrightness: 128,
    rearBrightness: 32,
    idleBrightness: 1,
    idleColor: 'B',
  })

  const setField = (key: string, value: any) => setForm(prev => ({...prev, [key]: value}))

  const loadStatus = async () => {
    const [statusResponse, portsResponse] = await Promise.all([
      fetch('/api/firmware/status'),
      fetch('/api/firmware/ports'),
    ])
    const nextStatus = await statusResponse.json()
    const portsJson = await portsResponse.json()
    setStatus(nextStatus)
    setPorts(portsJson.ports || [])
    setForm(prev => ({
      ...prev,
      port: prev.port || (portsJson.ports || [])[0] || '',
    }))
  }

  useEffect(() => {
    loadStatus()
  }, [])

  const flash = async () => {
    setBusy(true)
    setLog('Flashing ESP8266...\n')
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

  const toolsReady = !!status?.firmwareExists && !!status?.esptoolExists

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
              <Typography>Firmware file: {status?.firmwareExists ? 'Ready' : 'Missing'}</Typography>
              <Typography>esptool: {status?.esptoolExists ? 'Ready' : 'Missing'}</Typography>
              <Typography variant="caption">Folder: {status?.firmwareDir || 'checking...'}</Typography>
            </div>
            <Grid container spacing={2}>
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
              <Grid item xs={12} sm={6} className={classes.row}>
                <TextField fullWidth label="Setup AP Name" value={form.setupApName} onChange={event => setField('setupApName', event.target.value)} />
              </Grid>
              <Grid item xs={12} sm={6} className={classes.row}>
                <TextField fullWidth label="Tally Name" value={form.tallyName} onChange={event => setField('tallyName', event.target.value)} />
              </Grid>
              <Grid item xs={12} sm={8} className={classes.row}>
                <TextField fullWidth label="Hub IP" value={form.hubIp} onChange={event => setField('hubIp', event.target.value)} />
              </Grid>
              <Grid item xs={12} sm={4} className={classes.row}>
                <TextField fullWidth type="number" label="Hub Port" value={form.hubPort} onChange={event => setField('hubPort', Number(event.target.value))} />
              </Grid>
              <Grid item xs={12} sm={4} className={classes.row}>
                <InputLabel>Front Brightness</InputLabel>
                <NativeSelect fullWidth value={form.frontBrightness} onChange={event => setField('frontBrightness', Number(event.target.value))}>
                  {brightnessLevels.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                </NativeSelect>
              </Grid>
              <Grid item xs={12} sm={4} className={classes.row}>
                <InputLabel>Operator Brightness</InputLabel>
                <NativeSelect fullWidth value={form.rearBrightness} onChange={event => setField('rearBrightness', Number(event.target.value))}>
                  {brightnessLevels.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                </NativeSelect>
              </Grid>
              <Grid item xs={12} sm={4} className={classes.row}>
                <InputLabel>Idle Brightness</InputLabel>
                <NativeSelect fullWidth value={form.idleBrightness} onChange={event => setField('idleBrightness', Number(event.target.value))}>
                  {brightnessLevels.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                </NativeSelect>
              </Grid>
              <Grid item xs={12} sm={4} className={classes.row}>
                <InputLabel>Idle Color</InputLabel>
                <NativeSelect fullWidth value={form.idleColor} onChange={event => setField('idleColor', event.target.value as string)}>
                  {idleColors.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                </NativeSelect>
              </Grid>
            </Grid>
            <div className={classes.actions}>
              <Button variant="contained" color="primary" disabled={busy || !toolsReady || !form.port} onClick={flash}>
                Erase & Flash
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
