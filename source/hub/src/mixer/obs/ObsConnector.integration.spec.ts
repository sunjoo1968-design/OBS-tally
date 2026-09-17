/** @jest-environment node */
import WebSocket from 'ws'
import ObsConnector from './ObsConnector'
import ObsConfiguration from './ObsConfiguration'

async function until(check: () => boolean, timeout = 4000) {
    const deadline = Date.now() + timeout
    while (!check()) {
        if (Date.now() >= deadline) throw new Error('OBS integration condition timed out')
        await new Promise(resolve => setTimeout(resolve, 10))
    }
}

describe('OBS v5 real WebSocket transport', () => {
    let server: WebSocket.Server
    let connector: ObsConnector
    let socket: WebSocket
    let requests: string[]
    let identify: any
    let program: string[] | null
    let scene: string
    let connections: number
    let dropReplies: boolean
    let rejectAuthentication: boolean

    beforeEach(async () => {
        jest.spyOn(console, 'log').mockImplementation(() => {})
        jest.spyOn(console, 'error').mockImplementation(() => {})
        requests = []; identify = null; program = null; scene = 'Main'; connections = 0; dropReplies = false
        rejectAuthentication = false
        server = new WebSocket.Server({host: '127.0.0.1', port: 0})
        await new Promise(resolve => server.once('listening', resolve))
        server.on('connection', client => {
            socket = client; connections++
            client.send(JSON.stringify({op: 0, d: {obsWebSocketVersion: '5.0.0', rpcVersion: 1}}))
            client.on('message', raw => {
                const message = JSON.parse(raw.toString())
                if (message.op === 1) {
                    identify = message.d
                    if (rejectAuthentication) { client.close(4009, 'Authentication failed'); return }
                    client.send(JSON.stringify({op: 2, d: {negotiatedRpcVersion: 1}}))
                } else if (message.op === 6) {
                    const {requestId, requestType} = message.d
                    requests.push(requestType)
                    if (dropReplies) return
                    const responseData = requestType === 'GetSceneList'
                        ? {scenes: [{sceneName: scene}], currentProgramSceneName: scene}
                        : requestType === 'GetSceneItemList'
                            ? {sceneItems: [{sourceName: 'Cam', sceneItemEnabled: true, isGroup: false}]}
                            : requestType === 'GetStudioModeEnabled' ? {studioModeEnabled: false} : {sceneName: scene}
                    client.send(JSON.stringify({op: 7, d: {requestType, requestId, requestStatus: {result: true, code: 100}, responseData}}))
                }
            })
        })
        const configuration = new ObsConfiguration()
        configuration.setPort((server.address() as any).port)
        connector = new ObsConnector(configuration, {
            notifyMixerIsConnected: () => {}, notifyMixerIsDisconnected: () => {}, notifyChannels: () => {},
            notifyProgramPreviewChanged: value => { program = value },
        } as any)
    })
    afterEach(async () => {
        connector.disconnect()
        server.clients.forEach(client => client.terminate())
        await new Promise<void>(resolve => server.close(() => resolve()))
        jest.restoreAllMocks()
    })
    function event(eventType: string, eventData = {}) {
        socket.send(JSON.stringify({op: 5, d: {eventType, eventIntent: 1, eventData}}))
    }

    test('real Hello/Identify, source expansion and collection pause/resume', async () => {
        connector.connect()
        await until(() => !!program?.includes('obs-source:Cam'))
        expect(identify.rpcVersion).toBe(1)
        expect(requests).not.toContain('GetStreamStatus')
        event('CurrentSceneCollectionChanging')
        await until(() => program === null)
        const count = requests.length
        for (let i = 0; i < 100; i++) event('SceneItemCreated')
        await new Promise(resolve => setTimeout(resolve, 200))
        expect(requests).toHaveLength(count)
        scene = 'Replacement'
        event('CurrentSceneCollectionChanged')
        await until(() => !!program?.includes('Replacement'))
        expect(program).toContain('obs-source:Cam')
    })

    test('500 source events are coalesced and an abrupt socket loss recovers', async () => {
        connector.connect(); await until(() => !!program?.includes('obs-source:Cam'))
        const before = requests.filter(type => type === 'GetSceneList').length
        for (let i = 0; i < 500; i++) event('SceneItemEnableStateChanged')
        await until(() => requests.filter(type => type === 'GetSceneList').length > before)
        await new Promise(resolve => setTimeout(resolve, 200))
        expect(requests.filter(type => type === 'GetSceneList')).toHaveLength(before + 1)
        socket.terminate()
        await until(() => !connector.isConnected())
        expect(program).toBeNull()
        await until(() => connections === 2 && !!program?.includes('obs-source:Cam'))
    })

    test('disconnect cancels a pending real request and never reconnects', async () => {
        dropReplies = true
        connector.connect(); await until(() => requests.length >= 2)
        connector.disconnect()
        await new Promise(resolve => setTimeout(resolve, 1200))
        expect(connections).toBe(1)
        expect(connector.isConnected()).toBe(false)
        expect(program).toBeNull()
    })

    test('v5 authentication rejection closes cleanly and a subsequent connection recovers', async () => {
        rejectAuthentication = true
        connector.connect()
        await until(() => connections === 1 && identify !== null && !connector.isConnected())
        expect(requests).toEqual([])
        rejectAuthentication = false
        await until(() => connections === 2 && !!program?.includes('obs-source:Cam'))
    })
})
