import { AppConfiguration } from "./AppConfiguration";
import fs from 'fs'
import os from 'os'
import { randomBytes } from 'crypto'
import ServerEventEmitter from "./ServerEventEmitter";

class AppConfigurationPersistence {
    configuration: AppConfiguration
    fileName: string
    emitter: ServerEventEmitter
    saveTimeout?: NodeJS.Timeout
    private saveQueue: Promise<void> = Promise.resolve()

    constructor(configuration: AppConfiguration, emitter: ServerEventEmitter, fileName?: string) {
        this.configuration = configuration
        this.emitter = emitter
        this.fileName = fileName || process.env.CONFIG_FILE || (os.homedir() + "/.wifi-tally.json")
        this.load()
        this.emitter.on("config.changed", config => {
            if (config === this.configuration) {
                this.scheduleSave()
            }
        })
    }

    getConfiguration() : AppConfiguration {
        return this.configuration
    }

    private load() {
        if(fs.existsSync(this.fileName)) {
            const rawdata = fs.readFileSync(this.fileName)
            let config: unknown
            try {
                config = JSON.parse(rawdata.toString())
            } catch (e) {
                if (e instanceof SyntaxError && rawdata.byteLength === 0) {
                    console.warn(`Could not parse ${this.fileName}, because file is empty. Using defaults.`)
                    return
                } else { 
                    console.error(`Error when parsing ${this.fileName}: ${e}`)
                    throw e 
                }
            }
            if (typeof config !== "object" || config === null) {
                throw new Error(`Expected ${this.fileName} to contain a JSON object, but got ${typeof config}`)
            }
            this.configuration.fromJson(config)
        } else {
            console.warn(`Configuration File ${this.fileName} does not exist. Using defaults.`)
            
            return
        }
    }

    /* don't save instantly, but wait a bit to prevent too many writes in short succession */
    private scheduleSave() {
        if (this.saveTimeout) { return }
        this.saveTimeout = setTimeout(() => {
            // A failed disk write must not become an unhandled rejection and stop the Hub.
            void this.save().catch(() => {})
        }, AppConfigurationPersistence.saveDelay)
    }

    async save() {
        // @TODO: don't save if there are no changes
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout)
            this.saveTimeout = undefined
        }

        const dataToWrite = Object.assign({
            _warning: "This file was automatically generated.",
            _warning2: "Do not edit it while the hub is running. Your changes will be lost."
        }, this.configuration.toJson())
        const snapshot = JSON.stringify(dataToWrite, null, '\t')
        const task = this.saveQueue.then(() => this.writeAtomically(snapshot))
        this.saveQueue = task.catch(() => {})
        return task
    }

    private async writeAtomically(snapshot: string) {
        const temporary = `${this.fileName}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
        let handle: fs.promises.FileHandle | undefined
        try {
            // Keep the last valid config until the complete replacement has been flushed.
            handle = await fs.promises.open(temporary, 'wx', 0o600)
            await handle.writeFile(snapshot, 'utf8')
            await handle.sync()
            await handle.close()
            handle = undefined
            await fs.promises.rename(temporary, this.fileName)
        } catch (error) {
            console.error(`error when saving file ${this.fileName}: ${error}`)
            throw error
        } finally {
            if (handle) await handle.close().catch(() => {})
            await fs.promises.unlink(temporary).catch(() => {})
        }
    }

    private static readonly saveDelay = 500 //ms
}

export default AppConfigurationPersistence
