import net from 'net'
import xml2js from 'xml2js'
import Channel from '../../domain/Channel'
import { MixerCommunicator } from '../../lib/MixerCommunicator'
import { Connector } from '../interfaces'
import VmixConfiguration from './VmixConfiguration'
import fs from 'fs'
import path from 'path'

// @see https://www.vmix.com/help20/index.htm?TCPAPI.html
const vmixMixSourcePrefix = "vmix-mix-source:"

class VmixConnector implements Connector {
    configuration: VmixConfiguration
    communicator: MixerCommunicator
    client?: net.Socket
    wasHelloReceived: boolean
    wasSubcribeOkReceived: boolean
    intervalHandle: any
    xmlQueryInterval: number
    waitForHelloPeriod: number
    reconnectTimeout?: NodeJS.Timeout
    waitForHelloTimeout?: NodeJS.Timeout
    private receiveBuffer: string = ""
    private pendingXmlQueryTimeout?: NodeJS.Timeout
    private lastXmlQueryAt: number = 0
    private xmlQueryMinInterval: number
    private tallyPrograms: string[] = []
    private tallyPreviews: string[] = []
    private mixPrograms: string[] = []
    private mixPreviews: string[] = []
    private mixInputNumbers: Set<string> = new Set()
    private inputNames: {[inputNumber: string]: string} = {}
    private shouldReconnect: boolean = false

    constructor(configuration: VmixConfiguration, communicator: MixerCommunicator) {
        this.configuration = configuration
        this.communicator = communicator
        this.wasHelloReceived = false
        this.wasSubcribeOkReceived = false
        this.xmlQueryInterval = 250
        this.xmlQueryMinInterval = 100
        this.waitForHelloPeriod = 5000
    }
    connect() {
        this.shouldReconnect = true
        const client = new net.Socket()
        this.client = client

        const connectClient = () => {
            this.wasHelloReceived = false
            this.wasSubcribeOkReceived = false
            console.log(`Connecting to Vmix at ${this.configuration.getIp().toString()}:${this.configuration.getPort().toNumber()}`)
            client.connect(this.configuration.getPort().toNumber(), this.configuration.getIp().toString())
        }

        const reconnectClient = () => {
            if (!this.shouldReconnect || this.reconnectTimeout) { return }
            if (!client.destroyed) client.destroy()
            this.reconnectTimeout = setTimeout(() => {
                this.reconnectTimeout = undefined
                if (this.shouldReconnect) this.connect()
            }, 500)
        }

        connectClient()

        client.on("connect", () => {
            console.debug(`TCP connection to ${this.configuration.getIp().toString()}:${this.configuration.getPort().toNumber()} established`)
            this.waitForHelloTimeout = setTimeout(() => {
                if (this.waitForHelloTimeout) {
                    clearTimeout(this.waitForHelloTimeout)
                }
                
                if (!this.wasHelloReceived || !this.wasSubcribeOkReceived) {
                    reconnectClient()
                    console.error(`The remote at ${this.configuration.getIp().toString()}:${this.configuration.getPort().toNumber()} did not identify as vMix TCPAPI. Is this the correct port for the TCPAPI? (default ${VmixConfiguration.defaultPort})`)
                }
            }, this.waitForHelloPeriod)
        })

        client.on("ready", () => {
            client.write("SUBSCRIBE TALLY\r\n")
            // @TODO: we need to poll for new channels or renames. Is there a way to subscribe to those?
            this.intervalHandle = setInterval(() => this.queryXml(), this.xmlQueryInterval)
            this.queryXml(true)
        })

        client.on("timeout", () => {
            console.error("Connection to vMix timed out")
        })

        client.on("error", error => {
            console.error(`${error.name}: ${error.message}`)
        })

        client.on('data', this.onData.bind(this))

        client.on('close', (hadError) => {
            this.communicator.notifyMixerIsDisconnected()
            console.log("Connection to vMix closed")

            if(this.intervalHandle) {
                clearInterval(this.intervalHandle);
                this.intervalHandle = undefined;
            }
            if (this.pendingXmlQueryTimeout) {
                clearTimeout(this.pendingXmlQueryTimeout)
                this.pendingXmlQueryTimeout = undefined
            }
            if (this.waitForHelloTimeout) {
                clearTimeout(this.waitForHelloTimeout)
                this.waitForHelloTimeout = undefined
            }
            this.receiveBuffer = ""

            if (this.shouldReconnect) {
                console.debug(hadError ? "Reconnecting to vMix after an error" : "Reconnecting to vMix after the connection closed")
                reconnectClient()
            }
        })

    }
    private onConnectionComplete() {
        if (this.waitForHelloTimeout) {
            clearTimeout(this.waitForHelloTimeout)
            this.waitForHelloTimeout = undefined
        }
        console.log("Connection to vMix complete")
        this.communicator.notifyMixerIsConnected()
    }
    private queryXml(immediate: boolean = false) {
        const client = this.client
        if (!client || client.connecting || client.destroyed) {
            return
        }

        const now = Date.now()
        const elapsed = now - this.lastXmlQueryAt
        if (elapsed < this.xmlQueryMinInterval) {
            if (!this.pendingXmlQueryTimeout) {
                this.pendingXmlQueryTimeout = setTimeout(() => {
                    this.pendingXmlQueryTimeout = undefined
                    this.queryXml(true)
                }, this.xmlQueryMinInterval - elapsed)
            }
            return
        }

        this.lastXmlQueryAt = now
        client.write("XML\r\n")
    }
    private flushCompleteCommands() {
        const commands = this.receiveBuffer.split("\r\n")
        this.receiveBuffer = commands.pop() || ""
        commands.forEach(command => {
            if (command === "") { return }
            console.debug(`> ${command}`)
            if (command.startsWith("VERSION OK")) {
                this.wasHelloReceived = true
                console.debug("Connection to vMix established")
                if (this.wasHelloReceived && this.wasSubcribeOkReceived) { this.onConnectionComplete() }
            } else if (command.startsWith("SUBSCRIBE OK TALLY")) {
                this.wasSubcribeOkReceived = true
                console.debug("Successfully subscribed to tally updates from vMix")
                if (this.wasHelloReceived && this.wasSubcribeOkReceived) { this.onConnectionComplete() }
            } else if (command.startsWith("TALLY OK")) {
                this.handleTallyCommand(command)
                this.queryXml(true)
            } else if (command.startsWith("XML ")) {
                // @TODO: it would be better to detect the "XML" response itself, not the payload
            } else if (command.startsWith("<vmix>")) {  
                this.handleXmlCommand(command)
            } else {
                console.debug("Ignoring unkown command from vmix")
            }
        }, this)
    }
    private onData(data: Buffer) {
        this.receiveBuffer += data.toString()
        this.flushCompleteCommands()
    }
    private handleTallyCommand(command: string) {
        const result = command.match(/^TALLY OK (\d*)$/)

        if (result === null) {
            console.error("Tally OK command was ill formed")
        } else {
            const state = result[1]
            let programs: string[] = []
            let previews: string[] = []
            // vMix encodes tally states as numbers:
            // @see https://www.vmix.com/help20/index.htm?TCPAPI.html
            // 0 = off
            // 1 = program
            // 2 = preview
            state.split('').forEach((val, idx) => {
                if (val === "1") {
                    programs.push(`${idx + 1}`)
                } else if (val === "2") {
                    previews.push(`${idx + 1}`)
                }
            })

            this.tallyPrograms = programs
            this.tallyPreviews = previews
            this.notifyProgramPreviewChanged()
        }
    }
    private getXmlNodeValue(node: any) {
        if (Array.isArray(node)) {
            return this.getXmlNodeValue(node[0])
        }
        if (typeof node === "object" && node !== null && "_" in node) {
            return node._
        }
        return node
    }
    private getFirstValue(input: any, keys: string[]) {
        const attrs = input.$ || {}
        for (const key of keys) {
            if (attrs[key] !== undefined && attrs[key] !== null && attrs[key].toString() !== "") {
                return attrs[key]
            }
            const nodeValue = this.getXmlNodeValue(input[key])
            if (nodeValue !== undefined && nodeValue !== null && nodeValue.toString() !== "") {
                return nodeValue
            }
        }
        return undefined
    }
    private resolveInputRef(value: any, names: {[inputNumber: string]: string}) {
        const resolve = (value: any) => {
            const stringValue = value === undefined || value === null ? "" : value.toString()
            if (!stringValue) { return undefined }

            const byNumber = parseInt(stringValue, 10)
            if (!isNaN(byNumber) && names[byNumber]) {
                return {
                    id: byNumber.toString(),
                    name: names[byNumber].toString(),
                }
            }

            const entryByName = Object.entries(names).find(([, name]) => name === stringValue)
            if (entryByName) {
                return {
                    id: entryByName[0],
                    name: entryByName[1].toString(),
                }
            }

            return {
                id: stringValue,
                name: stringValue,
            }
        }

        return resolve(value)
    }
    private normalizeInputName(name: string) {
        return name.toLowerCase().replace(/[^a-z0-9가-힣]/gi, "")
    }
    private findRefByName(name: string, names: {[inputNumber: string]: string}) {
        const normalized = this.normalizeInputName(name)
        const entry = Object.entries(names).find(([, inputName]) => this.normalizeInputName(inputName.toString()) === normalized)
        if (!entry) { return undefined }

        return {
            id: entry[0],
            name: entry[1].toString(),
        }
    }
    private findRefInText(input: any, names: {[inputNumber: string]: string}) {
        const text = JSON.stringify(input)
        return Object.entries(names).reduce((results, [id, name]) => {
            if (text.includes(`>${id}<`) || text.includes(`\\"${id}\\"`) || text.includes(name.toString())) {
                results.push({id, name: name.toString()})
            }
            return results
        }, [] as {id: string, name: string}[])
    }
    private getMixInputRefs(input: any, names: {[inputNumber: string]: string}) {
        const previewValue = this.getFirstValue(input, [
            "preview",
            "previewInput",
            "mixPreview",
            "inputPreview",
            "inputPreviewNumber",
        ])
        const activeValue = this.getFirstValue(input, [
            "active",
            "output",
            "program",
            "selected",
            "input",
            "activeInput",
            "outputInput",
            "mixActive",
            "mixOutput",
            "inputActive",
            "inputActiveNumber",
        ])

        const preview = this.resolveInputRef(previewValue, names)
        const active = this.resolveInputRef(activeValue, names)
        const detectedRefs = this.findRefInText(input, names)

        return {
            preview,
            active,
            detectedRefs,
        }
    }
    private notifyProgramPreviewChanged() {
        const tallyPrograms = this.tallyPrograms.filter(channelId => !this.mixInputNumbers.has(channelId))
        const tallyPreviews = this.tallyPreviews.filter(channelId => !this.mixInputNumbers.has(channelId))
        const programs = Array.from(new Set([...tallyPrograms, ...this.mixPrograms]))
        const previews = Array.from(new Set([...tallyPreviews, ...this.mixPreviews]))
        this.communicator.notifyProgramPreviewChanged(programs, previews)
    }
    private handleXmlCommand(command: string) {
        xml2js.parseString(command, (error, result) => {
            if (error) {
                console.error(`Error parsing XML response from vMix: ${error}`)
            } else {
                const inputs = (result.vmix || {}).inputs
                if(inputs === undefined) {
                    console.log("XML from vMix looks faulty. Could not find inputs.")
                } else {
                    const inputList = inputs[0]?.input || []
                    const names = inputList.reduce((map, input, idx) => {
                        const inputNumber = input.$?.number?.toString() || (idx + 1).toString()
                        map[inputNumber] = input.$?.shortTitle || inputNumber
                        return map
                    }, {})
                    this.inputNames = names
                    const mixNodes = (result.vmix || {}).mix || []
                    this.communicator.notifyChannels(this.createChannels(inputList, names))
                    this.updateMixTallyState(inputList, names, mixNodes)
                    this.writeMixDebug(inputList, names, mixNodes)
                }
            }
        })
    }
    private writeMixDebug(inputs: any[], names: {[inputNumber: string]: string}, mixNodes: any[]) {
        if (process.env.VTALLY_VMIX_DEBUG !== "true") { return }

        const mixInputs = inputs
            .filter(input => input.$?.type === "Mix")
            .map(input => ({
                attributes: input.$,
                parsedRefs: this.getMixInputRefs(input, names),
                raw: input,
            }))

        if (mixInputs.length === 0 && mixNodes.length === 0) { return }

        const baseDir = (process as any).pkg ? path.dirname(process.execPath) : process.cwd()
        const debugPath = path.join(baseDir, "vmix-mix-debug.json")
        fs.writeFile(debugPath, JSON.stringify({
            updatedAt: new Date().toISOString(),
            inputs: names,
            mixInputs,
            mixNodes,
            programs: this.mixPrograms,
            previews: this.mixPreviews,
        }, null, 2), () => {})
    }
    private createMixSourceChannelId(mixNumber: string, sourceId: string) {
        return `${vmixMixSourcePrefix}${mixNumber}:${sourceId}`
    }

    private createChannels(inputs: any[], names: {[inputNumber: string]: string}) {
        const channels: Channel[] = inputs.map((input, idx) => {
            const inputNumber = input.$?.number?.toString() || (idx + 1).toString()
            const inputName = input.$?.shortTitle || names[inputNumber] || inputNumber
            return new Channel(inputNumber, inputName)
        })

        inputs.forEach(input => {
            const attrs = input.$ || {}
            if (attrs.type !== "Mix") { return }

            const mixNumber = attrs.number ? attrs.number.toString() : undefined
            const mixName = attrs.shortTitle || (mixNumber ? names[mixNumber] : undefined) || `Mix${mixNumber}`
            if (!mixNumber) { return }

            Object.entries(names).forEach(([sourceNumber, sourceName]) => {
                if (sourceNumber === mixNumber) { return }
                channels.push(new Channel(
                    this.createMixSourceChannelId(mixNumber, sourceNumber),
                    `${mixName}: ${sourceName}`,
                ))
            })
        })

        return channels
    }

    private getMixInputs(inputs: any[]) {
        return inputs.filter(input => input.$?.type === "Mix")
    }

    private getMixInputNumberForMixNode(mixNode: any, mixInputs: any[]) {
        const mixNumber = mixNode.$?.number?.toString()
        if (!mixNumber) { return undefined }

        const byTitle = mixInputs.find(input => {
            const attrs = input.$ || {}
            return attrs.shortTitle === `Mix${mixNumber}` || attrs.title === `Mix${mixNumber}`
        })
        if (byTitle?.$?.number) { return byTitle.$.number.toString() }

        const byIndex = mixInputs[parseInt(mixNumber, 10) - 2]
        return byIndex?.$?.number?.toString()
    }

    private getMixNodeRefs(mixNode: any, names: {[inputNumber: string]: string}) {
        return {
            active: this.resolveInputRef(this.getFirstValue(mixNode, ["active", "output", "program"]), names),
            preview: this.resolveInputRef(this.getFirstValue(mixNode, ["preview"]), names),
        }
    }
    private addMixSourceRefs(target: string[], mixInputNumber: string, ref?: {id: string, name: string}) {
        if (!ref) { return }

        target.push(this.createMixSourceChannelId(mixInputNumber, ref.id))
        target.push(this.createMixSourceChannelId(mixInputNumber, ref.name))
    }
    private addVisibleMixTallyState(programs: string[], previews: string[], mixInputNumber: string, refs: {active?: {id: string, name: string}, preview?: {id: string, name: string}}) {
        const isMixOnProgram = this.tallyPrograms.includes(mixInputNumber)
        const isMixOnPreview = this.tallyPreviews.includes(mixInputNumber)

        if (isMixOnProgram) {
            this.addMixSourceRefs(programs, mixInputNumber, refs.active)
            this.addMixSourceRefs(previews, mixInputNumber, refs.preview)
        }
        if (isMixOnPreview) {
            this.addMixSourceRefs(previews, mixInputNumber, refs.active)
        }
    }

    private updateMixTallyState(inputs: any[], names: {[inputNumber: string]: string}, mixNodes: any[]) {
        const programs: string[] = []
        const previews: string[] = []
        const mixInputNumbers = new Set<string>()
        const mixInputs = this.getMixInputs(inputs)

        mixInputs.forEach(input => {
            const attrs = input.$ || {}
            const mixNumber = attrs.number ? attrs.number.toString() : undefined
            if (!mixNumber) { return }
            mixInputNumbers.add(mixNumber)

            const refs = this.getMixInputRefs(input, names)
            this.addVisibleMixTallyState(programs, previews, mixNumber, refs)
        })

        mixNodes.forEach(mixNode => {
            const mixInputNumber = this.getMixInputNumberForMixNode(mixNode, mixInputs)
            if (!mixInputNumber) { return }
            mixInputNumbers.add(mixInputNumber)

            const refs = this.getMixNodeRefs(mixNode, names)
            this.addVisibleMixTallyState(programs, previews, mixInputNumber, refs)
        })

        this.mixInputNumbers = mixInputNumbers
        this.mixPrograms = programs
        this.mixPreviews = previews
        this.notifyProgramPreviewChanged()
    }
    disconnect() {
        this.shouldReconnect = false
        this.wasHelloReceived = false
        this.wasSubcribeOkReceived = false
        const promise = new Promise(resolve => {
            if(this.intervalHandle) {
                clearInterval(this.intervalHandle);
                this.intervalHandle = undefined;
            }
            if (this.reconnectTimeout) {
                clearTimeout(this.reconnectTimeout)
                this.reconnectTimeout = undefined;
            }
            if (this.waitForHelloTimeout) {
                clearTimeout(this.waitForHelloTimeout)
                this.waitForHelloTimeout = undefined;
            }
            if (this.pendingXmlQueryTimeout) {
                clearTimeout(this.pendingXmlQueryTimeout)
                this.pendingXmlQueryTimeout = undefined
            }
            if (this.waitForHelloTimeout) {
                clearTimeout(this.waitForHelloTimeout)
                this.waitForHelloTimeout = undefined
            }
            if (this.client && ! this.client.destroyed) {
                const client = this.client
                // @TODO: check if client is still connected and disconnect gracefully
                // if (this.client.isConnected) {
                //     // if we are connected: try to be nice
                //     this.client.end(() => {
                //         console.log("Disconnected from vMix")
                //         resolve(null)
                //     })
                // } else {
                // if not: be rude
                client.once("close", () => resolve(null))
                client.destroy()
                // }
            } else {
                resolve(null)
            }
        })
        this.client = undefined
        this.receiveBuffer = ""
        return promise
    }
    isConnected() {
        return this.client !== undefined && !this.client.destroyed && this.wasHelloReceived && this.wasSubcribeOkReceived
    }
    
    static readonly ID: "vmix" = "vmix"
}

export default VmixConnector
