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
    private tallyPrograms: string[] = []
    private tallyPreviews: string[] = []
    private mixPrograms: string[] = []
    private mixPreviews: string[] = []
    private mixInputNumbers: Set<string> = new Set()
    private inputNames: {[inputNumber: string]: string} = {}

    constructor(configuration: VmixConfiguration, communicator: MixerCommunicator) {
        this.configuration = configuration
        this.communicator = communicator
        this.wasHelloReceived = false
        this.wasSubcribeOkReceived = false
        this.xmlQueryInterval = 1000
        this.waitForHelloPeriod = 5000
    }
    connect() {
        const client = new net.Socket()
        this.client = client

        const connectClient = () => {
            this.wasHelloReceived = false
            this.wasSubcribeOkReceived = false
            console.log(`Connecting to Vmix at ${this.configuration.getIp().toString()}:${this.configuration.getPort().toNumber()}`)
            client.connect(this.configuration.getPort().toNumber(), this.configuration.getIp().toString())
        }

        const reconnectClient = () => {
            this.disconnect().then(() =>
                this.reconnectTimeout = setTimeout(() => {
                    if (this.reconnectTimeout) {
                        clearTimeout(this.reconnectTimeout)
                    }
                    client.connect(this.configuration.getPort().toNumber(), this.configuration.getIp().toString())
                }, 200)
            )
        }

        const queryXml = () => {
            if(!client.connecting && !client.destroyed) {
                client.write("XML\r\n")
            }
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
            this.intervalHandle = setInterval(queryXml, this.xmlQueryInterval)
            queryXml()
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

            if (hadError) {
                console.debug("Connection to vMix is reconnected after an error")
                reconnectClient()
            }
        })

    }
    private onConnectionComplete() {
        console.log("Connection to vMix complete")
        this.communicator.notifyMixerIsConnected()
    }
    private onData(data: Buffer) {
        data.toString().replace(/[\r\n]*$/, "").split("\r\n").forEach(command => {
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
            } else if (command.startsWith("XML ")) {
                // @TODO: it would be better to detect the "XML" response itself, not the payload
            } else if (command.startsWith("<vmix>")) {  
                this.handleXmlCommand(command)
            } else {
                console.debug("Ignoring unkown command from vmix")
            }
        }, this)
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
                    const inputList = inputs[0].input
                    const names = inputList.reduce((map, input, idx) => {
                        map[idx+1] = input.$.shortTitle
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
            if (refs.active) {
                programs.push(this.createMixSourceChannelId(mixNumber, refs.active.id))
                programs.push(this.createMixSourceChannelId(mixNumber, refs.active.name))
            }
            if (refs.preview) {
                previews.push(this.createMixSourceChannelId(mixNumber, refs.preview.id))
                previews.push(this.createMixSourceChannelId(mixNumber, refs.preview.name))
            }
        })

        mixNodes.forEach(mixNode => {
            const mixInputNumber = this.getMixInputNumberForMixNode(mixNode, mixInputs)
            if (!mixInputNumber) { return }
            mixInputNumbers.add(mixInputNumber)

            const refs = this.getMixNodeRefs(mixNode, names)
            if (refs.active) {
                programs.push(this.createMixSourceChannelId(mixInputNumber, refs.active.id))
                programs.push(this.createMixSourceChannelId(mixInputNumber, refs.active.name))
            }
            if (refs.preview) {
                previews.push(this.createMixSourceChannelId(mixInputNumber, refs.preview.id))
                previews.push(this.createMixSourceChannelId(mixInputNumber, refs.preview.name))
            }
        })

        this.mixInputNumbers = mixInputNumbers
        this.mixPrograms = programs
        this.mixPreviews = previews
        this.notifyProgramPreviewChanged()
    }
    disconnect() {
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
            if (this.client && ! this.client.destroyed) {
                // @TODO: check if client is still connected and disconnect gracefully
                // if (this.client.isConnected) {
                //     // if we are connected: try to be nice
                //     this.client.end(() => {
                //         console.log("Disconnected from vMix")
                //         resolve(null)
                //     })
                // } else {
                // if not: be rude
                this.client.destroy()
                resolve(null)
                // }
            } else {
                resolve(null)
            }
        })
        this.client = undefined
        return promise
    }
    isConnected() {
        return this.client !== undefined && !this.client.destroyed && this.wasHelloReceived && this.wasSubcribeOkReceived
    }
    
    static readonly ID: "vmix" = "vmix"
}

export default VmixConnector
