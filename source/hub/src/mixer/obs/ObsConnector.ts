import OBSWebSocket, { EventSubscription, OBSRequestTypes, OBSResponseTypes } from 'obs-websocket-js'
import Channel from '../../domain/Channel'
import { MixerCommunicator } from '../../lib/MixerCommunicator'
import { Connector } from '../interfaces'
import ObsConfiguration from './ObsConfiguration'

const requestTimeoutMs = 5000
const connectTimeoutMs = 8000
const heartbeatMs = 5000
const obsSourceChannelPrefix = 'obs-source:'
type SourceCategory = 'group' | 'source'
class StaleObsRequest extends Error {}

class ObsConnector implements Connector {
    configuration: ObsConfiguration
    communicator: MixerCommunicator
    visibleSourcesByScene: {[sceneName: string]: string[]} = Object.create(null)
    selectableSources: string[] = []
    selectableSourceCategories: {[sourceName: string]: SourceCategory} = Object.create(null)
    reconnectTimeout: NodeJS.Timeout | null = null
    obs: OBSWebSocket | null = null
    connected = false
    private stopped = true
    private collectionChanging = false
    private collectionEpoch = 0
    private previewScenes: string[] = []
    private programScenes: string[] = []
    private isStreaming = false
    private isRecording = false
    private programRevision = 0
    private previewRevision = 0
    private streamRevision = 0
    private recordRevision = 0
    private sourceRevision = 0
    private reconnectDelay = 1000
    private connectTimer: NodeJS.Timeout | null = null
    private heartbeatTimer: NodeJS.Timeout | null = null
    private refreshTimer: NodeJS.Timeout | null = null
    private sceneRefresh: Promise<void> | null = null
    private refreshDirty = false
    private sceneFailures = 0
    private pendingRequests = new Set<() => void>()

    constructor(configuration: ObsConfiguration, communicator: MixerCommunicator) {
        this.configuration = configuration
        this.communicator = communicator
    }

    connect() {
        if (!this.stopped) return
        this.stopped = false
        this.startConnection()
    }

    private isCurrent(client: OBSWebSocket) {
        return !this.stopped && this.obs === client
    }

    private canRequest(client: OBSWebSocket, epoch = this.collectionEpoch) {
        return this.isCurrent(client) && this.connected && !this.collectionChanging && epoch === this.collectionEpoch
    }

    private startConnection() {
        if (this.stopped) return
        this.reconnectTimeout = null
        const client = new OBSWebSocket()
        this.obs = client
        this.collectionChanging = false
        this.sceneFailures = 0
        this.isStreaming = false
        this.isRecording = false
        this.resetScenes()
        client.on('ConnectionError', error => this.failConnection(client, error))
        client.on('ConnectionClosed', error => this.failConnection(client, error))
        client.on('ExitStarted', () => this.failConnection(client, new Error('OBS is shutting down.')))
        client.on('CurrentProgramSceneChanged', data => {
            if (!this.canRequest(client)) return
            this.programRevision++
            this.programScenes = [data.sceneName]
            this.notifyChanged()
        })
        client.on('CurrentPreviewSceneChanged', data => {
            if (!this.canRequest(client)) return
            this.previewRevision++
            this.previewScenes = [data.sceneName]
            this.notifyChanged()
        })
        const refresh = () => {
            if (!this.canRequest(client)) return
            this.sourceRevision++
            this.scheduleSceneRefresh()
        }
        client.on('SceneListChanged', refresh)
        client.on('SceneCreated', refresh)
        client.on('SceneRemoved', refresh)
        client.on('SceneNameChanged', refresh)
        client.on('InputNameChanged', refresh)
        client.on('SceneItemCreated', refresh)
        client.on('SceneItemRemoved', refresh)
        client.on('SceneItemEnableStateChanged', refresh)
        client.on('CurrentSceneCollectionChanging', () => {
            if (!this.isCurrent(client)) return
            // OBS explicitly forbids requests while replacing scene collections.
            this.collectionChanging = true
            this.collectionEpoch++
            this.cancelRequests()
            this.clearRefresh()
            this.resetScenes()
        })
        client.on('CurrentSceneCollectionChanged', () => {
            if (!this.isCurrent(client)) return
            this.collectionChanging = false
            this.scheduleSceneRefresh(0)
            void this.updatePreviewScene(client)
            this.updateOutputStates()
        })
        client.on('StudioModeStateChanged', data => {
            if (!this.canRequest(client)) return
            this.previewRevision++
            if (data.studioModeEnabled) void this.updatePreviewScene(client)
            else {
                this.previewScenes = []
                this.notifyChanged()
            }
        })
        client.on('StreamStateChanged', data => {
            if (!this.isCurrent(client)) return
            this.streamRevision++
            this.isStreaming = data.outputActive
            this.notifyChanged()
        })
        client.on('RecordStateChanged', data => {
            if (!this.isCurrent(client)) return
            this.recordRevision++
            this.isRecording = data.outputActive && data.outputState !== 'OBS_WEBSOCKET_OUTPUT_PAUSED'
            this.notifyChanged()
        })

        this.connectTimer = setTimeout(() => this.failConnection(client, new Error('OBS handshake timed out.')), connectTimeoutMs)
        console.log(`Connecting to OBS at ${this.configuration.getIp()}:${this.configuration.getPort().toNumber()}`)
        client.connect(
            `ws://${this.configuration.getIp()}:${this.configuration.getPort().toNumber()}`,
            this.configuration.getPassword() || undefined,
            {rpcVersion: 1, eventSubscriptions: EventSubscription.General | EventSubscription.Config |
                EventSubscription.Scenes | EventSubscription.Inputs | EventSubscription.Outputs |
                EventSubscription.SceneItems | EventSubscription.Ui},
        ).then(() => {
            if (!this.isCurrent(client)) return
            if (this.connectTimer) clearTimeout(this.connectTimer)
            this.connectTimer = null
            this.connected = true
            this.communicator.notifyMixerIsConnected()
            this.scheduleSceneRefresh(0)
            void this.updatePreviewScene(client)
            this.updateOutputStates()
            this.scheduleHeartbeat(client)
            console.log('Connected to OBS')
        }).catch(error => this.failConnection(client, error))
    }

    private cancelRequests() {
        this.pendingRequests.forEach(cancel => cancel())
        this.pendingRequests.clear()
    }

    private request<T extends keyof OBSRequestTypes>(client: OBSWebSocket, type: T, epoch = this.collectionEpoch, data?: OBSRequestTypes[T]): Promise<OBSResponseTypes[T]> {
        if (!this.canRequest(client, epoch)) return Promise.reject(new StaleObsRequest())
        return new Promise((resolve, reject) => {
            const cancel = () => {
                clearTimeout(timer)
                this.pendingRequests.delete(cancel)
                reject(new StaleObsRequest())
            }
            const timer = setTimeout(() => {
                const error = new Error(`OBS request timed out: ${type}`)
                reject(error)
                this.failConnection(client, error)
            }, requestTimeoutMs)
            this.pendingRequests.add(cancel)
            client.call(type, data).then(result => {
                if (this.canRequest(client, epoch)) resolve(result)
                else reject(new StaleObsRequest())
            }, reject).finally(() => {
                clearTimeout(timer)
                this.pendingRequests.delete(cancel)
            })
        })
    }

    private resetScenes() {
        this.programRevision++
        this.previewRevision++
        this.streamRevision++
        this.recordRevision++
        this.programScenes = []
        this.previewScenes = []
        this.visibleSourcesByScene = Object.create(null)
        this.selectableSources = []
        this.selectableSourceCategories = Object.create(null)
        this.communicator.notifyProgramPreviewChanged(null, null)
    }

    private clearRefresh() {
        if (this.refreshTimer) clearTimeout(this.refreshTimer)
        this.refreshTimer = null
        this.sceneRefresh = null
        this.refreshDirty = false
    }

    private failConnection(client: OBSWebSocket, error: any) {
        if (!this.isCurrent(client)) return
        this.obs = null
        this.connected = false
        if (this.connectTimer) clearTimeout(this.connectTimer)
        if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer)
        this.connectTimer = this.heartbeatTimer = null
        this.cancelRequests()
        this.clearRefresh()
        this.resetScenes()
        this.communicator.notifyMixerIsDisconnected()
        client.removeAllListeners()
        void client.disconnect().catch(() => {})
        console.error('OBS connection lost:', error?.message || error?.code || 'Socket closed')
        this.reconnectTimeout = setTimeout(() => this.startConnection(), this.reconnectDelay)
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 10000)
    }

    private scheduleHeartbeat(client: OBSWebSocket) {
        this.heartbeatTimer = setTimeout(async () => {
            this.heartbeatTimer = null
            if (!this.isCurrent(client)) return
            if (!this.collectionChanging) {
                const revision = this.programRevision
                try {
                    const data = await this.request(client, 'GetCurrentProgramScene')
                    if (revision === this.programRevision) {
                        this.programScenes = [data.sceneName]
                        this.notifyChanged()
                    }
                    this.reconnectDelay = 1000
                } catch (error) { this.logRequestError(error) }
            }
            if (this.isCurrent(client)) this.scheduleHeartbeat(client)
        }, heartbeatMs)
    }

    private async updatePreviewScene(client: OBSWebSocket) {
        const revision = this.previewRevision
        const epoch = this.collectionEpoch
        try {
            const studio = await this.request(client, 'GetStudioModeEnabled', epoch)
            const scenes = studio.studioModeEnabled
                ? [(await this.request(client, 'GetCurrentPreviewScene', epoch)).sceneName] : []
            if (!this.canRequest(client, epoch) || revision !== this.previewRevision) return
            this.previewScenes = scenes
            this.notifyChanged()
        } catch (error) { this.logRequestError(error) }
    }

    private updateOutputStates() {
        const client = this.obs
        if (!client) return
        const mode = this.configuration.getLiveMode()
        const epoch = this.collectionEpoch
        // Never query FFmpeg/output status in always mode (previous crash mitigation).
        if (mode === 'stream' || mode === 'streamOrRecord') {
            const revision = this.streamRevision
            void this.request(client, 'GetStreamStatus').then(data => {
                if (!this.canRequest(client, epoch) || revision !== this.streamRevision) return
                this.isStreaming = data.outputActive
                this.notifyChanged()
            }).catch(error => this.logRequestError(error))
        }
        if (mode === 'record' || mode === 'streamOrRecord') {
            const revision = this.recordRevision
            void this.request(client, 'GetRecordStatus').then(data => {
                if (!this.canRequest(client, epoch) || revision !== this.recordRevision) return
                this.isRecording = data.outputActive && !data.outputPaused
                this.notifyChanged()
            }).catch(error => this.logRequestError(error))
        }
    }

    private logRequestError(error: any) {
        if (!(error instanceof StaleObsRequest)) console.error('OBS request failed:', error?.message || error)
    }

    private scheduleSceneRefresh(delay = 50) {
        this.refreshDirty = true
        if (this.refreshTimer || this.sceneRefresh) return
        this.refreshTimer = setTimeout(() => {
            this.refreshTimer = null
            const client = this.obs
            if (!client || !this.canRequest(client)) return
            this.refreshDirty = false
            const task = this.updateScenes(client)
            this.sceneRefresh = task
            let retryDelay = 100
            void task.catch(error => {
                this.logRequestError(error)
                retryDelay = 1000
                if (this.canRequest(client)) {
                    if (++this.sceneFailures >= 3) this.failConnection(client, error)
                    else this.refreshDirty = true
                }
            }).finally(() => {
                if (this.sceneRefresh !== task) return
                this.sceneRefresh = null
                if (this.refreshDirty && this.canRequest(client)) this.scheduleSceneRefresh(retryDelay)
            })
        }, delay)
    }

    private async updateScenes(client: OBSWebSocket) {
        const revision = this.programRevision
        const sourceRevision = this.sourceRevision
        const epoch = this.collectionEpoch
        const data = await this.request(client, 'GetSceneList')
        const names = data.scenes.map(scene => String(scene.sceneName))
        const sources = new Set<string>()
        const categories: {[name: string]: SourceCategory} = Object.create(null)
        const visible: {[name: string]: string[]} = Object.create(null)
        const cache = new Map<string, any[]>()
        // Query each scene/group only once per refresh, sequentially to bound OBS load.
        const collect = async (name: string, group: boolean, path: Set<string>): Promise<string[]> => {
            if (path.has(name)) return []
            if (path.size >= 64) throw new Error('OBS nested scene depth exceeds 64.')
            const key = `${group}:${name}`
            let items = cache.get(key)
            if (!items) {
                items = (await this.request(client, group ? 'GetGroupSceneItemList' : 'GetSceneItemList', epoch, {sceneName: name})).sceneItems
                cache.set(key, items)
            }
            const nextPath = new Set(path).add(name)
            const result: string[] = []
            for (const item of items) {
                const source = String(item.sourceName || '')
                if (!source) continue
                const isGroup = item.isGroup === true || item.sourceKind === 'group'
                const nested = isGroup || item.sourceType === 'OBS_SOURCE_TYPE_SCENE' || item.sourceKind === 'scene'
                sources.add(source)
                categories[source] = isGroup ? 'group' : 'source'
                const children = nested ? await collect(source, isGroup, nextPath) : []
                if (item.sceneItemEnabled === false) continue
                result.push(`${obsSourceChannelPrefix}${source}`)
                if (nested) result.push(source, ...children)
            }
            return Array.from(new Set(result))
        }
        for (const name of names) visible[name] = await collect(name, false, new Set())
        if (!this.canRequest(client, epoch) || sourceRevision !== this.sourceRevision) return
        // Publish a complete snapshot; never erase the cache while reads are in flight.
        this.visibleSourcesByScene = visible
        this.selectableSources = Array.from(sources).sort((a, b) => a.localeCompare(b))
        this.selectableSourceCategories = categories
        this.sceneFailures = 0
        this.communicator.notifyChannels([
            ...names.map(name => new Channel(name, `Scene: ${name}`, 'scene')),
            ...this.selectableSources.filter(name => !names.includes(name)).map(name => {
                const category = categories[name]
                return new Channel(`${obsSourceChannelPrefix}${name}`, `${category === 'group' ? 'Group' : 'Source'}: ${name}`, category)
            }),
        ])
        if (revision === this.programRevision && data.currentProgramSceneName) this.programScenes = [data.currentProgramSceneName]
        this.reconnectDelay = 1000
        this.notifyChanged()
    }

    private notifyChanged() {
        if (!this.connected || this.collectionChanging || this.stopped) return
        const expand = (scenes: string[]) => Array.from(new Set(scenes.flatMap(scene => [scene, ...(this.visibleSourcesByScene[scene] || [])])))
        const programs = expand(this.programScenes)
        const mode = this.configuration.getLiveMode()
        const previewOnly = mode === 'stream' ? !this.isStreaming : mode === 'record' ? !this.isRecording
            : mode === 'streamOrRecord' ? !this.isStreaming && !this.isRecording : false
        this.communicator.notifyProgramPreviewChanged(previewOnly ? [] : programs, previewOnly ? programs : expand(this.previewScenes))
    }

    disconnect() {
        this.stopped = true
        const client = this.obs
        this.obs = null
        this.connected = false
        if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout)
        if (this.connectTimer) clearTimeout(this.connectTimer)
        if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer)
        this.reconnectTimeout = this.connectTimer = this.heartbeatTimer = null
        this.cancelRequests()
        this.clearRefresh()
        this.resetScenes()
        this.communicator.notifyMixerIsDisconnected()
        if (client) {
            client.removeAllListeners()
            void client.disconnect().catch(() => {})
        }
    }

    isConnected() { return this.connected }
    static readonly ID: 'obs' = 'obs'
}

export default ObsConnector
