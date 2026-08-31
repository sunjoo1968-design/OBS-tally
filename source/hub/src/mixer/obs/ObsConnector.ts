import OBSWebSocket from 'obs-websocket-js'
import Channel from '../../domain/Channel'
import { MixerCommunicator } from '../../lib/MixerCommunicator'
import { Connector } from '../interfaces'
import ObsConfiguration from './ObsConfiguration'

const reconnectTimeoutMs = 1000
const obsSourceChannelPrefix = "obs-source:"
type SourceCategory = "group" | "source"

// uses obs-websockets
// @see https://github.com/Palakis/obs-websocket
class ObsConnector implements Connector{
    configuration: ObsConfiguration
    communicator: MixerCommunicator
    // tracks which enabled sources are visible inside each scene
    visibleSourcesByScene: {[sceneName: string]: string[]} = {}
    selectableSources: string[] = []
    selectableSourceCategories: {[sourceName: string]: SourceCategory} = {}
    reconnectTimeout: NodeJS.Timeout | null = null
    obs: OBSWebSocket | null
    connected: boolean = false
    private previewScenes: string[] = []
    private programScenes: string[] = []
    private isStreaming: boolean = false
    private isRecording: boolean = false
    
    constructor(configuration: ObsConfiguration, communicator: MixerCommunicator) {
        this.configuration = configuration
        this.communicator = communicator
    }
    connect() {
        this.obs = new OBSWebSocket()
        // @ts-ignore https://github.com/haganbmj/obs-websocket-js/issues/203
        this.obs.on('error', err => {
            console.error("obs socket error:", err)
        })
        this.obs.on('CurrentProgramSceneChanged', data => {
            // console.debug('CurrentProgramSceneChanged', data)
            this.notifyProgramChanged([data.sceneName])
        })
        this.obs.on('SceneListChanged', data => {
            // console.debug('SceneListChanged', data)
            this.updateScenes()
        })
        this.obs.on('SceneItemCreated', data => {
            // console.debug('SceneItemCreated', data)
            this.updateScenes()
        })
        this.obs.on('SceneItemRemoved', data => {
            // console.debug('SceneItemRemoved', data)
            this.updateScenes()
        })
        this.obs.on('SceneItemEnableStateChanged', data => {
            // console.debug('SceneItemEnableStateChanged', data)
            this.updateScenes()
        })
        this.obs.on('CurrentSceneCollectionChanged', data => {
            // console.debug('CurrentSceneCollectionChanged', data)
            this.updateScenes()
        })
        this.obs.on('SceneCollectionListChanged', data => {
            // console.debug('SceneCollectionListChanged', data)
            this.updateScenes()
        })
        this.obs.on('CurrentPreviewSceneChanged', data => {
            // console.debug('CurrentPreviewSceneChanged', data)
            this.notifyPreviewChanged([data.sceneName])
        })
        this.obs.on('StudioModeStateChanged', data => {
            // console.debug('StudioModeStateChanged', data)
            if (data.studioModeEnabled) {
                // if: switched INTO studio mode
                this.updatePreviewScene()
            } else {
                // if: switched OUT OF studio mode
                this.previewScenes = []
                this.notifyChanged()
            }
        })

        this.obs.on('StreamStateChanged', data => {
            // console.debug('StreamStateChanged', data)
            this.isStreaming = data.outputActive
            this.notifyChanged()
        })
        this.obs.on('RecordStateChanged', data => {
            // console.debug('RecordStateChanged', data)
            this.isRecording = data.outputActive
            this.notifyChanged()
        })

        const connect = () => {
            if (!this.obs) { return }
            if (this.reconnectTimeout) { 
                clearTimeout(this.reconnectTimeout)
            }
            console.log(`Connecting to OBS at ${this.configuration.getIp().toString()}:${this.configuration.getPort().toNumber()}`)
            this.obs.connect(
                `ws://${this.configuration.getIp().toString()}:${this.configuration.getPort().toNumber()}`,
                this.configuration.getPassword() || undefined,
                {rpcVersion: 1},
            ).then(() => {
                this.connected = true
                this.communicator.notifyMixerIsConnected()
                this.updateScenes()
                this.updatePreviewScene()
                this.updateOutputStates()
                console.log("Connected to OBS")

                this.obs?.on('ConnectionClosed', () => {
                    this.connected = false
                    this.communicator.notifyMixerIsDisconnected()
                    this.obs?.removeAllListeners('ConnectionClosed')
                    console.error("Connection to OBS lost")
                    this.reconnectTimeout = setTimeout(connect, reconnectTimeoutMs)
                })
            }).catch(err => {
                this.connected = false
                this.communicator.notifyMixerIsDisconnected()
                console.error("error when connecting to OBS:", err.message || err.error || err)
                this.reconnectTimeout = setTimeout(connect, reconnectTimeoutMs)
            })
        }

        connect()

        this.communicator.notifyProgramPreviewChanged(null, null)
    }
    private updatePreviewScene() {
        this.obs?.call("GetCurrentPreviewScene").then(data => {
            // console.debug("GetCurrentPreviewScene", data)
            this.notifyPreviewChanged([data.sceneName])
        }).catch(err => {
            // if studio mode is disabled we get an error and fail gracefully
        })
    }
    private updateOutputStates() {
        const liveMode = this.configuration.getLiveMode()

        // OBS handles both requests through GetOutputStatus. Avoid touching the
        // output/FFmpeg state when the selected tally mode does not need it.
        if (liveMode === "stream" || liveMode === "streamOrRecord") {
            this.obs?.call("GetStreamStatus").then(data => {
                this.isStreaming = data.outputActive
                this.notifyChanged()
            }).catch(err => {
                console.error(err)
            })
        }
        if (liveMode === "record" || liveMode === "streamOrRecord") {
            this.obs?.call("GetRecordStatus").then(data => {
                this.isRecording = data.outputActive && !data.outputPaused
                this.notifyChanged()
            }).catch(err => {
                console.error(err)
            })
        }
    }
    private updateScenes() {
        this.obs?.call("GetSceneList").then(async data => {
            // console.debug("GetSceneList", data)

            const sceneNames = data.scenes.map(scene => String(scene.sceneName))
            await this.updateVisibleSources(sceneNames)
            const sourceChannels = this.selectableSources
                .filter(sourceName => !sceneNames.includes(sourceName))
                .map(sourceName => {
                    const category = this.selectableSourceCategories[sourceName] || "source"
                    const label = category === "group" ? `Group: ${sourceName}` : `Source: ${sourceName}`
                    return new Channel(this.createSourceChannelId(sourceName), label, category)
                })
            this.communicator.notifyChannels([
                ...sceneNames.map(sceneName => new Channel(sceneName, `Scene: ${sceneName}`, "scene")),
                ...sourceChannels,
            ])

            if (data.currentProgramSceneName) {
                this.notifyProgramChanged([data.currentProgramSceneName])
            }
        }).catch(err => {
            console.error(err)
            // @TODO
        })
    }
    private createSourceChannelId(sourceName: string) {
        return `${obsSourceChannelPrefix}${sourceName}`
    }

    private isNestedSceneOrGroup(item: any) {
        return item.sourceType === "OBS_SOURCE_TYPE_SCENE" ||
            item.sourceKind === "scene" ||
            item.sourceKind === "group" ||
            item.type === "scene"
    }

    private isItemEnabled(item: any) {
        if (item.sceneItemEnabled !== undefined) { return item.sceneItemEnabled === true }
        if (item.render !== undefined) { return item.render === true }
        return true
    }

    private async getSceneItems(sceneName: string): Promise<any[]> {
        if (!this.obs) { return [] }

        try {
            const data = await this.obs.call("GetSceneItemList", {sceneName})
            return data.sceneItems || []
        } catch (sceneErr) {
            try {
                const data = await this.obs.call("GetGroupSceneItemList", {sceneName})
                return data.sceneItems || []
            } catch (groupErr) {
                console.error(sceneErr)
                return []
            }
        }
    }

    private getSourceCategory(item: any): SourceCategory {
        if (item.sourceKind === "group") { return "group" }
        return "source"
    }

    private async collectVisibleSources(sceneName: string, selectableSources: Set<string>, sourceCategories: {[sourceName: string]: SourceCategory}, visited: Set<string>): Promise<string[]> {
        if (visited.has(sceneName)) { return [] }
        visited.add(sceneName)

        const visibleSources: string[] = []
        const sceneItems = await this.getSceneItems(sceneName)

        for (const item of sceneItems) {
            const sourceName = item.sourceName || item.name
            if (!sourceName) { continue }

            const sourceNameString = String(sourceName)
            selectableSources.add(sourceNameString)
            sourceCategories[sourceNameString] = this.getSourceCategory(item)

            if (!this.isItemEnabled(item)) { continue }

            visibleSources.push(this.createSourceChannelId(sourceNameString))

            if (this.isNestedSceneOrGroup(item)) {
                visibleSources.push(sourceNameString)
                visibleSources.push(...await this.collectVisibleSources(sourceNameString, selectableSources, sourceCategories, new Set(visited)))
            }
        }

        return Array.from(new Set(visibleSources))
    }

    private async updateVisibleSources(sceneNames: string[]) {
        this.visibleSourcesByScene = {}
        const selectableSources = new Set<string>()
        const sourceCategories: {[sourceName: string]: SourceCategory} = {}
        if (!this.obs) { return }

        await Promise.all(sceneNames.map(async sceneName => {
            this.visibleSourcesByScene[sceneName] = await this.collectVisibleSources(sceneName, selectableSources, sourceCategories, new Set())
        }))

        this.selectableSources = Array.from(selectableSources).sort((a, b) => a.localeCompare(b))
        this.selectableSourceCategories = sourceCategories
    }
    private notifyProgramChanged(scenes: string[]) {
        this.programScenes = scenes
        this.notifyChanged()
    }
    private notifyPreviewChanged(scenes: string[]) {
        this.previewScenes = scenes
        this.notifyChanged()
    }

    private shouldProgramBeShownAsPreview(): boolean {
        const mode = this.configuration.getLiveMode()
        if (mode === "always") {
            return false
        } else if (mode === "record") {
            return !this.isRecording
        } else if(mode === "stream") {
            return !this.isStreaming
        } else if(mode === "streamOrRecord") {
            return !this.isStreaming && !this.isRecording
        } else {
            ((_: never) => {})(mode) // if typescript complains about this, we forgot a case
        }
    }

    private notifyChanged() {
        let programs: string[] = []
        
        this.programScenes.forEach(scene => {
            programs.push(scene)
            programs.push(...(this.visibleSourcesByScene[scene] || []))
        })

        let previews: string[] = []
        if (this.shouldProgramBeShownAsPreview()) {
            previews = programs
            programs = []
        } else {
            this.previewScenes.forEach(scene => {
                previews.push(scene)
                previews.push(...(this.visibleSourcesByScene[scene] || []))
            })
        }
        
        

        this.communicator.notifyProgramPreviewChanged(programs, previews)
    }

    disconnect() {
        if (this.reconnectTimeout) { 
            clearTimeout(this.reconnectTimeout)
        }
        if (this.obs) {
            this.obs.removeAllListeners('ConnectionClosed')
            this.obs.disconnect()
        }
    }

    isConnected() {
        return this.obs !== undefined && this.connected
    }
    static readonly ID: "obs" = "obs"
}

export default ObsConnector
