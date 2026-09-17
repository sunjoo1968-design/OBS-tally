import { EventEmitter } from 'events'
import OBSWebSocket, { EventSubscription } from 'obs-websocket-js'
import ObsConnector from './ObsConnector'
import ObsConfiguration, { ObsConfigurationLiveMode } from './ObsConfiguration'

jest.mock('obs-websocket-js', () => ({
    __esModule: true,
    ...jest.requireActual('obs-websocket-js'),
    default: jest.fn(),
}))

function deferred<T = any>() {
    let resolve!: (value: T) => void
    let reject!: (error: Error) => void
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
    return {promise, resolve, reject}
}

async function flush() { for (let i = 0; i < 80; i++) await Promise.resolve() }
async function advance(ms: number) { jest.advanceTimersByTime(ms); await flush() }

const sceneItem = (sourceName: string, extra = {}) => ({sourceName, sceneItemEnabled: true, ...extra})

class MockClient extends EventEmitter {
    connect = jest.fn(async (...args: any[]) => ({}))
    disconnect = jest.fn().mockResolvedValue(undefined)
    items: {[name: string]: any[]} = {A: [sceneItem('Cam1')], B: [sceneItem('Cam2')]}
    call = jest.fn(async (type: string, data?: any): Promise<any> => {
        if (type === 'GetSceneList') return {scenes: [{sceneName: 'A'}, {sceneName: 'B'}], currentProgramSceneName: 'A'}
        if (type === 'GetSceneItemList' || type === 'GetGroupSceneItemList') return {sceneItems: this.items[data.sceneName] || []}
        if (type === 'GetStudioModeEnabled') return {studioModeEnabled: true}
        if (type === 'GetCurrentPreviewScene') return {sceneName: 'B'}
        if (type === 'GetCurrentProgramScene') return {sceneName: 'A'}
        return {outputActive: false, outputPaused: false}
    })
}

let connector: ObsConnector
let clients: MockClient[]
let communicator: any
let first: MockClient
function create(mode: ObsConfigurationLiveMode = 'always') {
    const configuration = new ObsConfiguration()
    configuration.setLiveMode(mode)
    communicator = {
        notifyChannels: jest.fn(), notifyProgramPreviewChanged: jest.fn(),
        notifyMixerIsConnected: jest.fn(), notifyMixerIsDisconnected: jest.fn(),
    }
    clients = []
    first = new MockClient()
    ;(OBSWebSocket as unknown as jest.Mock).mockImplementation(() => {
        const client = clients.length === 0 ? first : new MockClient()
        clients.push(client)
        return client
    })
    connector = new ObsConnector(configuration, communicator)
    return first
}
async function start() { connector.connect(); await flush(); await advance(0) }
function tally() { return communicator.notifyProgramPreviewChanged.mock.calls.slice(-1)[0] }

describe('OBS v5 broadcast stability', () => {
    beforeEach(() => {
        jest.useFakeTimers()
        jest.spyOn(console, 'log').mockImplementation(() => {})
        jest.spyOn(console, 'error').mockImplementation(() => {})
    })
    afterEach(async () => {
        if (connector) connector.disconnect()
        await flush()
        jest.clearAllTimers()
        jest.useRealTimers()
        jest.restoreAllMocks()
    })

    test('identifies with v5 subscriptions and expands program/preview sources', async () => {
        create(); await start()
        expect(first.connect).toHaveBeenCalledWith('ws://127.0.0.1:4455', undefined, expect.objectContaining({rpcVersion: 1}))
        const mask = first.connect.mock.calls[0][2].eventSubscriptions
        expect(mask & EventSubscription.Config).toBeTruthy()
        expect(mask & EventSubscription.SceneItems).toBeTruthy()
        expect(tally()).toEqual([['A', 'obs-source:Cam1'], ['B', 'obs-source:Cam2']])
        expect(connector.isConnected()).toBe(true)
    })

    test('connect is idempotent and explicit disconnect blocks a late handshake', async () => {
        const client = create(); const handshake = deferred()
        client.connect.mockReturnValue(handshake.promise)
        connector.connect(); connector.connect(); connector.disconnect()
        handshake.resolve({}); await flush(); await advance(20000)
        expect(clients).toHaveLength(1)
        expect(client.call).not.toHaveBeenCalled()
        expect(communicator.notifyMixerIsConnected).not.toHaveBeenCalled()
        expect(connector.isConnected()).toBe(false)
    })

    test('a closed socket clears tally and reconnects once using a fresh client', async () => {
        create(); await start()
        first.emit('ConnectionError', new Error('network lost'))
        first.emit('ConnectionClosed', new Error('duplicate close'))
        expect(tally()).toEqual([null, null])
        expect(connector.isConnected()).toBe(false)
        await advance(999); expect(clients).toHaveLength(1)
        await advance(1); await advance(0)
        expect(clients).toHaveLength(2)
        first.emit('CurrentProgramSceneChanged', {sceneName: 'old socket'})
        expect(tally()[0]).toContain('A')
        connector.disconnect(); await advance(30000)
        expect(clients).toHaveLength(2)
    })

    test('authentication failure has bounded exponential retries', async () => {
        const client = create(); client.connect.mockRejectedValue(new Error('Authentication failed'))
        connector.connect(); await flush()
        expect(connector.isConnected()).toBe(false)
        await advance(1000)
        clients[1].emit('ConnectionClosed', new Error('closed'))
        await advance(1999); expect(clients).toHaveLength(2)
        await advance(1); expect(clients).toHaveLength(3)
    })

    test('handshake timeout recovers instead of remaining connected indefinitely', async () => {
        create().connect.mockReturnValue(new Promise(() => {}))
        connector.connect(); await advance(8000)
        expect(first.disconnect).toHaveBeenCalledTimes(1)
        await advance(1000); expect(clients).toHaveLength(2)
    })

    test('unanswered heartbeat fails safe and reconnects', async () => {
        create(); await start()
        first.call.mockImplementation((type) => type === 'GetCurrentProgramScene' ? new Promise(() => {}) : Promise.resolve({}))
        await advance(5000); expect(connector.isConnected()).toBe(true)
        await advance(5000); expect(connector.isConnected()).toBe(false)
        expect(tally()).toEqual([null, null])
        await advance(1000); expect(clients).toHaveLength(2)
    })

    test('collection replacement pauses ALL queries and ignores old responses', async () => {
        create(); await start()
        const old = deferred()
        first.call.mockImplementation((type) => type === 'GetSceneList' ? old.promise : Promise.resolve({studioModeEnabled: false}))
        first.emit('SceneListChanged', {}); await advance(50)
        first.emit('CurrentSceneCollectionChanging', {})
        const count = first.call.mock.calls.length
        first.emit('SceneItemCreated', {}); first.emit('StudioModeStateChanged', {studioModeEnabled: true})
        await advance(15000)
        expect(first.call).toHaveBeenCalledTimes(count)
        expect(connector.isConnected()).toBe(true)
        old.resolve({scenes: [{sceneName: 'OLD'}], currentProgramSceneName: 'OLD'})
        await flush(); expect(tally()).toEqual([null, null])
        first.call.mockImplementation(async (type: string) => type === 'GetSceneList'
            ? {scenes: [{sceneName: 'NEW'}], currentProgramSceneName: 'NEW'}
            : type === 'GetSceneItemList' ? {sceneItems: [sceneItem('NewCam')]} : {studioModeEnabled: false})
        first.emit('CurrentSceneCollectionChanged', {})
        await flush(); await advance(0)
        expect(tally()).toEqual([['NEW', 'obs-source:NewCam'], []])
    })

    test('an event burst produces one refresh without blanking the last good snapshot', async () => {
        create(); await start(); first.call.mockClear()
        for (let i = 0; i < 100; i++) first.emit('SceneItemEnableStateChanged', {})
        expect(tally()[0]).toContain('obs-source:Cam1')
        await advance(50)
        expect(first.call.mock.calls.filter(([type]) => type === 'GetSceneList')).toHaveLength(1)
    })

    test('source changes during refresh discard the outdated snapshot', async () => {
        create(); await start()
        const pending = deferred(); const original = first.call.getMockImplementation()!
        first.call.mockImplementationOnce(() => pending.promise)
        first.emit('SceneListChanged', {}); await advance(50)
        first.emit('SceneItemEnableStateChanged', {})
        first.items.A = [sceneItem('Cam1', {sceneItemEnabled: false})]
        const published = communicator.notifyChannels.mock.calls.length
        pending.resolve({scenes: [{sceneName: 'A'}], currentProgramSceneName: 'A'})
        await flush()
        expect(communicator.notifyChannels).toHaveBeenCalledTimes(published)
        first.call.mockImplementation(original)
        await advance(100)
        expect(tally()[0]).toEqual(['A'])
    })

    test('groups use the group endpoint, disabled children remain selectable, shared scenes are cached', async () => {
        create()
        first.items.A = [sceneItem('Shared', {sourceType: 'OBS_SOURCE_TYPE_SCENE'}), sceneItem('Lights', {isGroup: true, sceneItemEnabled: false})]
        first.items.B = [sceneItem('Shared', {sourceType: 'OBS_SOURCE_TYPE_SCENE'})]
        first.items.Shared = [sceneItem('Camera')]
        first.items.Lights = [sceneItem('HiddenCam')]
        await start()
        expect(first.call.mock.calls.filter(([type, data]) => type === 'GetSceneItemList' && data.sceneName === 'Shared')).toHaveLength(1)
        expect(first.call).toHaveBeenCalledWith('GetGroupSceneItemList', {sceneName: 'Lights'})
        expect(tally()[0]).toContain('obs-source:Camera')
        expect(tally()[0]).not.toContain('obs-source:HiddenCam')
        expect(connector.selectableSources).toContain('HiddenCam')
        expect(connector.selectableSourceCategories.Lights).toBe('group')
    })

    test('recursive scene references terminate and item requests never run in parallel', async () => {
        create()
        first.items.A = [sceneItem('B', {sourceType: 'OBS_SOURCE_TYPE_SCENE'})]
        first.items.B = [sceneItem('A', {sourceType: 'OBS_SOURCE_TYPE_SCENE'})]
        const original = first.call.getMockImplementation()!
        let active = 0; let maximum = 0
        first.call.mockImplementation(async (type, data) => {
            if (!type.includes('SceneItemList')) return original(type, data)
            active++; maximum = Math.max(maximum, active)
            await Promise.resolve(); const result = await original(type, data); active--; return result
        })
        await start()
        expect(maximum).toBe(1)
        expect(tally()[0]).toEqual(['A', 'obs-source:B', 'B', 'obs-source:A'])
    })

    test('new program events win over a delayed scene list and heartbeat', async () => {
        create(); const pending = deferred()
        first.call.mockImplementationOnce(() => Promise.resolve({studioModeEnabled: false}))
        first.call.mockImplementationOnce(() => pending.promise)
        connector.connect(); await flush(); await advance(0)
        first.emit('CurrentProgramSceneChanged', {sceneName: 'B'})
        pending.resolve({scenes: [{sceneName: 'A'}, {sceneName: 'B'}], currentProgramSceneName: 'A'})
        await flush(); expect(tally()[0]).toContain('B'); expect(tally()[0]).not.toContain('A')
        const heartbeat = deferred(); first.call.mockImplementationOnce(() => heartbeat.promise)
        await advance(5000); first.emit('CurrentProgramSceneChanged', {sceneName: 'B'})
        heartbeat.resolve({sceneName: 'A'}); await flush()
        expect(tally()[0]).toContain('B')
    })

    test('new preview events win over delayed initial preview status', async () => {
        create(); const pending = deferred(); const original = first.call.getMockImplementation()!
        first.call.mockImplementation((type, data) => type === 'GetCurrentPreviewScene' ? pending.promise : original(type, data))
        await start(); first.emit('CurrentPreviewSceneChanged', {sceneName: 'A'})
        pending.resolve({sceneName: 'B'}); await flush()
        expect(tally()[1]).toContain('A'); expect(tally()[1]).not.toContain('B')
        first.emit('StudioModeStateChanged', {studioModeEnabled: false})
        expect(tally()[1]).toEqual([])
    })

    test('record pause switches to preview and resume restores program', async () => {
        create('record'); await start()
        first.emit('RecordStateChanged', {outputActive: true, outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED'})
        expect(tally()[0]).toContain('A')
        first.emit('RecordStateChanged', {outputActive: true, outputState: 'OBS_WEBSOCKET_OUTPUT_PAUSED'})
        expect(tally()).toEqual([[], ['A', 'obs-source:Cam1']])
        first.emit('RecordStateChanged', {outputActive: true, outputState: 'OBS_WEBSOCKET_OUTPUT_RESUMED'})
        expect(tally()[0]).toContain('A')
    })

    test('output events take precedence over delayed output status responses', async () => {
        create('streamOrRecord'); const pending = deferred(); const original = first.call.getMockImplementation()!
        first.call.mockImplementation((type, data) => type.endsWith('Status') ? pending.promise : original(type, data))
        await start()
        first.emit('StreamStateChanged', {outputActive: true})
        first.emit('RecordStateChanged', {outputActive: true, outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED'})
        pending.resolve({outputActive: false, outputPaused: false}); await flush()
        expect(tally()[0]).toContain('A')
    })

    test.each(['always', 'stream', 'record', 'streamOrRecord'] as ObsConfigurationLiveMode[])('queries only required outputs in %s mode', async mode => {
        create(mode); await start()
        const outputs = first.call.mock.calls.map(([type]) => type).filter(type => type.endsWith('Status'))
        expect(outputs).toEqual(mode === 'always' ? [] : mode === 'stream' ? ['GetStreamStatus'] : mode === 'record' ? ['GetRecordStatus'] : ['GetStreamStatus', 'GetRecordStatus'])
    })

    test('transient source query errors keep the good snapshot and retry at a bounded rate', async () => {
        create(); await start()
        first.call.mockRejectedValue(new Error('scene removed during query'))
        const count = first.call.mock.calls.length
        first.emit('SceneListChanged', {}); await advance(50)
        expect(tally()[0]).toContain('obs-source:Cam1')
        await advance(999); expect(first.call).toHaveBeenCalledTimes(count + 1)
        await advance(1); expect(first.call).toHaveBeenCalledTimes(count + 2)
        await advance(1000)
        expect(connector.isConnected()).toBe(false)
        expect(tally()).toEqual([null, null])
    })

    test('scene and source names matching object properties remain valid channels', async () => {
        create(); const original = first.call.getMockImplementation()!
        first.call.mockImplementation((type, data) => type === 'GetSceneList'
            ? Promise.resolve({scenes: [{sceneName: '__proto__'}], currentProgramSceneName: '__proto__'})
            : type === 'GetSceneItemList' ? Promise.resolve({sceneItems: [sceneItem('constructor')]}) : original(type, data))
        await start()
        expect(tally()[0]).toEqual(['__proto__', 'obs-source:constructor'])
        expect(connector.selectableSourceCategories.constructor).toBe('source')
    })
})
