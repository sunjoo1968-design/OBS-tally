import { ConnectionState, UdpTally } from '../domain/Tally'
import dgram from 'dgram'
import { ChannelList } from '../lib/MixerCommunicator'
import { AppConfiguration } from '../lib/AppConfiguration'
import CommandParser, { InvalidCommandError } from './CommandParser'
import CommandCreator from './CommandCreator'
import TallyContainer from './TallyContainer'
import Log, { Severity } from '../domain/Log'

// - handles connections with Tallies.
// - emits signals when tallies connect, go missing or disconnect
class UdpTallyDriver {
    io?: dgram.Socket
    private isListening: boolean = false
    private restartTimeout?: NodeJS.Timeout
    container: TallyContainer
    configuration: AppConfiguration
    lastTallyReport: Map<string, Date> = new Map()

    constructor(configuration: AppConfiguration, container: TallyContainer) {
        this.configuration = configuration
        this.container = container
        this.container.addUdpTallyDriver(this)

        this.startSocket()

        // check that all tallies are still reporting regularily
        setInterval(() => {
            const now = new Date()
            this.container.getUdpTallies().forEach(tally => {
                const lastTallyReportDate = this.lastTallyReport.get(tally.name)
                if(!lastTallyReportDate) {
                    tally.state = ConnectionState.DISCONNECTED
                } else {
                    const diff = now.getTime() - lastTallyReportDate.getTime() // milliseconds
                    if(diff > this.configuration.getTallyTimeoutDisconnected()) {
                        if(tally.state !== ConnectionState.DISCONNECTED) {
                            tally.state = ConnectionState.DISCONNECTED
                            this.container.update(tally)
                            this.container.addLog(tally.name, "udp", new Log(new Date(), Severity.STATUS, `Tally got disconnected after not reporting for ${diff}ms`))
                        }
                    } else if(diff > this.configuration.getTallyTimeoutMissing()) {
                        if(tally.state !== ConnectionState.MISSING) {
                            tally.state = ConnectionState.MISSING
                            this.container.update(tally)
                            this.container.addLog(tally.name, "udp", new Log(new Date(), Severity.STATUS, `Tally got missing. It has not reported for ${diff}ms`))
                        }
                    }
                }
            })
        }, 500)

        // send keep-alive messages
        // - show the tally, we are still here
        // - compensate for lost packages
        setInterval(() => {
            this.container.getUdpTallies().forEach(tally => {
                this.updateTallyState(tally, this.container.lastPrograms, this.container.lastPreviews)
            })
        }, 1000 / this.configuration.getTallyKeepAlivesPerSecond())
    }

    private startSocket() {
        const socket = dgram.createSocket('udp4')
        this.io = socket
        this.isListening = false

        socket.on('error', err => {
            console.error(`UDP tally server error: ${err.stack || err.message}`)
            this.isListening = false
            try {
                socket.close()
            } catch (_) {
                this.scheduleSocketRestart()
            }
        })
        socket.on('close', () => {
            this.isListening = false
            if (this.io === socket) this.scheduleSocketRestart()
        })
        socket.on('message', (msg, rinfo) => {
            try {
                const command = CommandParser.parse(msg.toString().trim())
                if (command.command === "tally-ho") {
                    const {tallyName} = command
                    this.tallyReported(tallyName, rinfo)
                } else if (command.command === "log") {
                    const {tallyName, log} = command
                    this.tallyReported(tallyName, rinfo)
                    this.container.addLog(tallyName, "udp", log)
                } else {
                    // typescript should complain if we missed a command
                    ((_: never) => {})(command)
                }
            } catch (e) {
                if (e instanceof InvalidCommandError) {
                    console.warn(e.message)
                } else {
                    console.error(`Failed to process UDP tally message: ${e instanceof Error ? e.message : String(e)}`)
                }
            }
        })
        socket.on('listening', () => {
            if (this.io !== socket) return
            this.isListening = true
            const address = socket.address()
            console.log(`Listening for Tallies on ${address.address}:${address.port}`)
        })
        socket.bind(this.configuration.getTallyPort())
    }

    private scheduleSocketRestart() {
        if (this.restartTimeout) return
        this.restartTimeout = setTimeout(() => {
            this.restartTimeout = undefined
            this.startSocket()
        }, 2000)
    }
    private tallyReported(tallyName: string, rinfo: dgram.RemoteInfo) {
        this.lastTallyReport.set(tallyName, new Date())
        let tally = this.container.getOrCreate(tallyName, "udp") as UdpTally
        const oldState = tally.state
        const oldAddress = tally.address
        const oldPort = tally.port

        tally.state = ConnectionState.CONNECTED
        tally.address = rinfo.address
        tally.port = rinfo.port

        if (oldState !== tally.state || oldAddress !== tally.address || oldPort !== tally.port) {
            this.container.update(tally)
        }
        return tally
    }

    updateTallyState(tally: UdpTally, programs: ChannelList, previews: ChannelList) {
        if(tally.isActive() && this.io && this.isListening) {
            const command = CommandCreator.createStateCommand(tally, programs, previews, this.configuration.getTallyConfiguration())
            this.io.send(command, tally.port, tally.address, error => {
                if (error) console.error(`Failed to send UDP tally state: ${error.message}`)
            })
        }
    }
}

export default UdpTallyDriver
