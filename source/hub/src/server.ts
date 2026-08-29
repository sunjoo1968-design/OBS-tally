// set NODE_ENV from argument to enable portability to windows
import yargs from 'yargs'

import TallyContainer from './tally/TallyContainer'
import UdpTallyDriver from './tally/UdpTallyDriver'
import { AppConfiguration } from './lib/AppConfiguration'
import { MixerDriver } from './lib/MixerDriver'
import express from 'express'
import { createProxyMiddleware } from 'http-proxy-middleware'
import { Server } from 'http'
import socketIo from 'socket.io'
import path from 'path'
import { spawn } from 'child_process'

import { SocketAwareEvent } from './lib/SocketAwareEvent'
import ServerEventEmitter from './lib/ServerEventEmitter'
import { ServerSideSocket } from './lib/SocketEvents'
import AppConfigurationPersistence from './lib/AppConfigurationPersistence'
import AtemConfiguration from './mixer/atem/AtemConfiguration'
import VmixConfiguration from './mixer/vmix/VmixConfiguration'
import ObsConfiguration from './mixer/obs/ObsConfiguration'
import MockConfiguration from './mixer/mock/MockConfiguration'
import TestConnector from './mixer/test/TestConnector'
import TestConfiguration from './mixer/test/TestConfiguration'
import WebTallyDriver from './tally/WebTallyDriver'
import { TallyConfiguration } from './tally/TallyConfiguration'
import { flashFirmware, getFirmwareToolStatus, listComPorts } from './lib/FirmwareFlasher'
import { getHubNetworkInfo } from './lib/NetworkAddresses'

const argv = yargs.argv
if (argv.env !== undefined) {
  // @ts-ignore @TODO: setting the env is not nice, but the easiest way to be cross-platform compatible
  // @see https://github.com/wifi-tally/wifi-tally/issues/18
  process.env.NODE_ENV = argv.env
}
if ((process as any).pkg && process.env.NODE_ENV === undefined) {
  ;(process.env as any).NODE_ENV = "production"
}
if ((process as any).pkg && process.env.CONFIG_FILE === undefined) {
  process.env.CONFIG_FILE = path.join(path.dirname(process.execPath), "wifi-tally.json")
}
if (argv['with-test'] !== undefined) {
  process.env.HUB_WITH_TEST = "true"
}
const app = express()
const server = new Server(app)
const io = socketIo(server)
app.use(express.json())

const myEmitter = new ServerEventEmitter()
myEmitter.setMaxListeners(99)
const myConfiguration = new AppConfiguration(myEmitter)
if (myConfiguration.isTest()) {
  console.log("Starting test environment")
  myConfiguration.setMixerSelection(TestConnector.ID)
  myConfiguration.setTallyTimeoutMissing(1000)
  myConfiguration.setTallyTimeoutDisconnected(3000)
} else {
  new AppConfigurationPersistence(myConfiguration, myEmitter)
}

const myTallyContainer = new TallyContainer(myConfiguration, myEmitter)
new UdpTallyDriver(myConfiguration, myTallyContainer)
const myWebTallyDriver = new WebTallyDriver(myConfiguration, myTallyContainer)

const myMixerDriver = new MixerDriver(myConfiguration, myEmitter)
let isFirmwareFlashInProgress = false

const isLocalRequest = (address?: string) => {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

app.use('/api/firmware', (req, res, next) => {
  if (!isLocalRequest(req.socket.remoteAddress)) {
    res.status(403).json({ok: false, log: 'Firmware management is available only on the Hub PC.'})
    return
  }
  next()
})

// log stuff
myEmitter.on('tally.logged', ({tally, log}) => {
    let fn = console.info
    if(log.isError()) { 
      fn = console.error 
    } else if(log.isWarning()) {
      fn = console.warn
    }
    fn(`${tally.name}: ${log.message}`)
})
myEmitter.on('program.changed', ({programs, previews}) => {
    console.info("Program/Preview was changed to ", programs, previews)
})

app.get('/api/firmware/status', (req, res) => {
  const status = getFirmwareToolStatus()
  res.json({
    firmwareExists: status.firmwareExists,
    esptoolExists: status.esptoolExists,
    targets: {
      current: {
        label: status.targets.current.label,
        firmwareExists: status.targets.current.firmwareExists,
      },
      'legacy-nodemcu': {
        label: status.targets['legacy-nodemcu'].label,
        baseFirmwareExists: status.targets['legacy-nodemcu'].baseFirmwareExists,
        programFilesCount: status.targets['legacy-nodemcu'].programFilesCount,
        programFilesReady: status.targets['legacy-nodemcu'].programFilesReady,
        missingProgramFiles: status.targets['legacy-nodemcu'].missingProgramFiles,
      },
    },
    network: getHubNetworkInfo(req.socket.localAddress),
  })
})

app.get('/api/firmware/ports', async (req, res) => {
  res.json({ports: await listComPorts()})
})

app.post('/api/firmware/flash', async (req, res) => {
  if (isFirmwareFlashInProgress) {
    res.status(409).json({ok: false, log: 'Another firmware operation is already running.'})
    return
  }

  isFirmwareFlashInProgress = true
  try {
    const result = await flashFirmware(req.body)
    res.json(result)
  } catch (error) {
    res.status(500).json({
      ok: false,
      log: error instanceof Error ? error.message : String(error),
    })
  } finally {
    isFirmwareFlashInProgress = false
  }
})

// socket.io server
io.on('connection', (socket: ServerSideSocket) => {
  (socket as socketIo.Socket).setMaxListeners(99)
  const mixerEvents = [
    // @TODO: use event objects instead of repeating the same structure again and again
    new SocketAwareEvent(myEmitter, 'mixer.connected', socket, (socket) => {
      socket.emit('mixer.state', {
        isConnected: true
      })
    }),
    new SocketAwareEvent(myEmitter, 'mixer.disconnected', socket, (socket) => {
      socket.emit('mixer.state', {
        isConnected: false
      })
    }),
  ]
  socket.on('events.mixer.subscribe', () => {
    mixerEvents.forEach(pipe => pipe.register())
    socket.emit('mixer.state', {
      isConnected: myMixerDriver.isConnected()
    })
  })
  socket.on('events.mixer.unsubscribe', () => {
    // @TODO: not used yet
    mixerEvents.forEach(pipe => pipe.unregister())
  })

  const programEvents = [
    new SocketAwareEvent(myEmitter, 'program.changed', socket, (socket, {programs, previews}) => {
      socket.emit('program.state', {
        programs: programs,
        previews: previews,
      })
    })
  ]
  socket.on('events.program.subscribe', () => {
    programEvents.forEach(pipe => pipe.register())

    socket.emit('program.state', {
      programs: myMixerDriver.getCurrentPrograms(),
      previews: myMixerDriver.getCurrentPreviews(),
    })
  })
  socket.on('events.program.unsubscribe', () => {
    // @TODO: not used yet
    programEvents.forEach(pipe => pipe.unregister())
  })

  const configEvents = [
    new SocketAwareEvent(myEmitter, 'config.changed.atem', socket, (socket, atemConfiguration) => {
      socket.emit('config.state.atem', atemConfiguration.toJson())
    }),
    new SocketAwareEvent(myEmitter, 'config.changed.mock', socket, (socket, mockConfiguration) => {
      socket.emit('config.state.mock', mockConfiguration.toJson())
    }),
    new SocketAwareEvent(myEmitter, 'config.changed.obs', socket, (socket, obsConfiguration) => {
      socket.emit('config.state.obs', obsConfiguration.toJson())
    }),
    new SocketAwareEvent(myEmitter, 'config.changed.vmix', socket, (socket, vmixConfiguration) => {
      socket.emit('config.state.vmix', vmixConfiguration.toJson())
    }),
    new SocketAwareEvent(myEmitter, 'config.changed.mixer', socket, (socket, mixerName) => {
      socket.emit('config.state.mixer', {mixerName, allowedMixers: MixerDriver.getAllowedMixers(myConfiguration.isDev(), myConfiguration.isTest())})
    }),
  ]
  socket.on('events.config.subscribe', () => {
    configEvents.forEach(pipe => pipe.register())

    socket.emit('config.state.atem', myConfiguration.getAtemConfiguration().toJson())
    socket.emit('config.state.mixer', {mixerName: myConfiguration.getMixerSelection() || "", allowedMixers: MixerDriver.getAllowedMixers(myConfiguration.isDev(), myConfiguration.isTest())})
    socket.emit('config.state.mock', myConfiguration.getMockConfiguration().toJson())
    socket.emit('config.state.obs', myConfiguration.getObsConfiguration().toJson())
    socket.emit('config.state.vmix', myConfiguration.getVmixConfiguration().toJson())
    socket.emit('config.state.tallyconfig', myConfiguration.getTallyConfiguration().toJson())
  })
  socket.on('events.config.unsubscribe', () => {
    // @TODO: not used yet
    configEvents.forEach(pipe => pipe.unregister())
  })

  const tallyEvents = [
    new SocketAwareEvent(myEmitter, 'tally.changed', socket, (socket) => {
      socket.emit('tally.state', {tallies: myTallyContainer.getTalliesAsJson()})
    }),
    new SocketAwareEvent(myEmitter, 'tally.removed', socket, (socket) => {
      socket.emit('tally.state', {tallies: myTallyContainer.getTalliesAsJson()})
    }),
  ]
  socket.on('events.tally.subscribe', () => {
    tallyEvents.forEach(pipe => pipe.register())

    socket.emit('tally.state', {tallies: myTallyContainer.getTalliesAsJson()})
  })
  socket.on('events.tally.unsubscribe', () => {
    // @TODO: not used yet
    tallyEvents.forEach(pipe => pipe.unregister())
  })
  
  socket.on('tally.patch', (tallyName, tallyType, channelId) => {
    myTallyContainer.patch(tallyName, tallyType, channelId)
  })
  socket.on('tally.patch.channels', (tallyName, tallyType, channelIds, channelMatchMode) => {
    myTallyContainer.patchChannels(tallyName, tallyType, channelIds, channelMatchMode)
  })
  socket.on('tally.highlight', (tallyName, tallyType) => {
    myTallyContainer.highlight(tallyName, tallyType)
  })
  socket.on('tally.remove', (tallyName, tallyType) => {
    myTallyContainer.remove(tallyName, tallyType)
  })
  socket.on('tally.create', (tallyName, channelId) => {
    myWebTallyDriver.create(tallyName, channelId)
  })
  socket.on('tally.settings', (tallyName, tallyType, settings) => {
    const configuration = new TallyConfiguration()
    configuration.fromJson(settings)
    myTallyContainer.updateSettings(tallyName, tallyType, configuration)
  })
  socket.on('events.webTally.subscribe', tallyName => myWebTallyDriver.subscribe(tallyName, socket))
  socket.on('events.webTally.unsubscribe', tallyName => myWebTallyDriver.unsubscribe(tallyName, socket))

  const tallyLogEvents = [
    new SocketAwareEvent(myEmitter, 'tally.logged', socket, (socket, {tally, log}) => {
      socket.emit('tally.log', {tallyId: tally.getId(), log: log.toJson()})
    }),
  ]
  socket.on('events.tallyLog.subscribe', () => {
    tallyLogEvents.forEach(pipe => pipe.register())

    const logs = myTallyContainer.getTallies().map(tally => {
      return {
        tallyId: tally.getId(),
        logs: tally.getLogs().map(log => log.toJson())
      }
    })

    socket.emit('tally.log.state', logs)
  })
  socket.on('events.tallyLog.unsubscribe', () => {
    // @TODO: not used yet
    tallyLogEvents.forEach(pipe => pipe.unregister())
  })

  const channelEvents = [
    new SocketAwareEvent(myEmitter, 'config.changed.channels', socket, (socket, channels) => {
      socket.emit('channel.state', {channels: channels.map(channel => channel.toJson())})
    }),
  ]
  socket.on('events.channel.subscribe', () => {
    channelEvents.forEach(pipe => pipe.register())

    socket.emit('channel.state', {channels: myConfiguration.getChannelsAsJson()})
  })
  socket.on('events.channel.unsubscribe', () => {
    // @TODO: not used yet
    channelEvents.forEach(pipe => pipe.unregister())
  })


  socket.on('config.change.atem', (newAtemConfiguration, newMixerName) => {
    const atem = new AtemConfiguration()
    atem.fromJson(newAtemConfiguration)
    myConfiguration.setAtemConfiguration(atem)

    if (newMixerName) {
      myConfiguration.setMixerSelection(newMixerName)
    }
  })
  socket.on('config.change.mock', (newMockConfiguration, newMixerName) => {
    const mock = new MockConfiguration()
    mock.fromJson(newMockConfiguration)
    myConfiguration.setMockConfiguration(mock)

    if (newMixerName) {
      myConfiguration.setMixerSelection(newMixerName)
    }
  })
  socket.on('config.change.null', newMixerName => {
    if (newMixerName) {
      myConfiguration.setMixerSelection(newMixerName)
    }
  })
  socket.on('config.change.obs', (newObsConfiguration, newMixerName) => {
    const obs = new ObsConfiguration()
    obs.fromJson(newObsConfiguration)
    myConfiguration.setObsConfiguration(obs)

    if (newMixerName) {
      myConfiguration.setMixerSelection(newMixerName)
    }
  })
  socket.on('config.change.test', (newTestConfiguration, newMixerName) => {
    const test = new TestConfiguration()
    test.fromJson(newTestConfiguration)
    myConfiguration.setTestConfiguration(test)

    if (newMixerName) {
      myConfiguration.setMixerSelection(newMixerName)
    }
  })
  socket.on('config.change.vmix', (newVmixConfiguration, newMixerName) => {
    const vmix = new VmixConfiguration()
    vmix.fromJson(newVmixConfiguration)
    myConfiguration.setVmixConfiguration(vmix)

    if (newMixerName) {
      myConfiguration.setMixerSelection(newMixerName)
    }
  })
})

if (myConfiguration.isDev()) {
  const proxyPort = process.env.DEV_PROXY_PORT || 3001
  console.info(`Serving frontend via proxy. The React dev server is expected to run on port ${proxyPort}.`)

  app.use('/', createProxyMiddleware({ 
    target: `http://localhost:${proxyPort}`, 
    changeOrigin: true, 
    ws: true,
    onError: (err: any, req, res) => {
      if (typeof res.writeHead === "function") {
        res.writeHead(500, {
          'Content-Type': 'text/plain',
        });
        if (err && err.code === "ECONNREFUSED") {
          res.end(`Could not connect to server on http://localhost:${proxyPort}. Is the react dev server running?\nTo fix it run:\n    npm run start:frontend`)
        } else {
          res.end("The proxy reported an error: \n" + err.toString())
        }
      }
    },
  }))
} else {
  const publicDirName = "frontend"
  console.info(`Serving frontend from directory ${publicDirName}`)
  app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate")
    res.setHeader("Pragma", "no-cache")
    res.setHeader("Expires", "0")
    next()
  })
  app.use('/', express.static(`${__dirname}/${publicDirName}/`))

  // fetch all route to allow deep-links into the application
  app.get('*', function(req, res) {
    res.sendFile(`${__dirname}/${publicDirName}/index.html`)
  })
}



const openBrowser = (url: string) => {
  if (!(process as any).pkg || process.env.VTALLY_NO_BROWSER === "true") {
    return
  }

  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], {detached: true, stdio: "ignore", windowsHide: true}).unref()
  } else if (process.platform === "darwin") {
    spawn("open", [url], {detached: true, stdio: "ignore"}).unref()
  } else {
    spawn("xdg-open", [url], {detached: true, stdio: "ignore"}).unref()
  }
}

server.listen(myConfiguration.getHttpPort(), () => {
  const url = `http://localhost:${myConfiguration.getHttpPort()}`
  console.log(`Web Server available on ${url}`)
  openBrowser(url)
})
