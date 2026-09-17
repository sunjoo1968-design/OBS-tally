const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const net = require('net')
const {spawn} = require('child_process')
const WebSocket = require('ws')
const {encode, decode} = require('@msgpack/msgpack')
const io = require('socket.io-client')

const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(check, timeout = 10000) {
    const deadline = Date.now() + timeout
    while (!check()) {
        if (Date.now() >= deadline) throw new Error('Runtime verification timed out')
        await pause(20)
    }
}
async function freePort() {
    const server = net.createServer()
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = server.address().port
    await new Promise(resolve => server.close(resolve))
    return port
}

async function main() {
    assert(process.argv[2], 'Usage: node scripts/verify-runtime.cjs path/to/vtally-server.exe [runtime-folder]')
    const executable = path.resolve(process.argv[2])
    const workingDirectory = path.resolve(process.argv[3] || process.cwd())
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'vtally-runtime-check-'))
    const configFile = path.join(temporary, 'wifi-tally.json')
    const server = new WebSocket.Server({host: '127.0.0.1', port: 0})
    await new Promise(resolve => server.once('listening', resolve))
    let child, browserSocket, obsSocket, state, tallyState, log = ''
    let scene = 'Main', enabled = true, connections = 0
    const requests = []
    const send = (socket, message) => socket.send(socket.protocol === 'obswebsocket.msgpack' ? encode(message) : JSON.stringify(message))
    server.on('connection', socket => {
        obsSocket = socket; connections++
        send(socket, {op: 0, d: {obsWebSocketVersion: '5.0.0', rpcVersion: 1}})
        socket.on('message', raw => {
            const {op, d} = socket.protocol === 'obswebsocket.msgpack' ? decode(raw) : JSON.parse(raw.toString())
            if (op === 1) send(socket, {op: 2, d: {negotiatedRpcVersion: 1}})
            if (op !== 6) return
            requests.push(d.requestType)
            const responseData = d.requestType === 'GetSceneList'
                ? {scenes: [{sceneName: scene}], currentProgramSceneName: scene}
                : d.requestType === 'GetSceneItemList'
                    ? {sceneItems: [{sourceName: 'Camera', isGroup: false, sceneItemEnabled: enabled}]}
                    : d.requestType === 'GetStudioModeEnabled' ? {studioModeEnabled: false} : {sceneName: scene}
            send(socket, {op: 7, d: {...d, requestStatus: {result: true, code: 100}, responseData}})
        })
    })
    function event(eventType, eventData = {}) {
        send(obsSocket, {op: 5, d: {eventType, eventIntent: 1, eventData}})
    }
    const obsPort = server.address().port
    const httpPort = await freePort()
    const url = `http://127.0.0.1:${httpPort}`
    fs.writeFileSync(configFile, JSON.stringify({
        mixer: 'obs', obs: {ip: '127.0.0.1', port: obsPort, liveMode: 'always'},
        tallies: [{name: 'SmokeCam', type: 'web', channelIds: ['obs-source:Camera'], channelMatchMode: 'or'}],
    }))
    async function stop() {
        if (browserSocket) { browserSocket.close(); browserSocket = null }
        if (child && child.exitCode === null && child.signalCode === null) {
            const exited = new Promise(resolve => child.once('exit', resolve))
            child.kill(); await exited
        }
        child = null
    }
    async function start() {
        state = null; tallyState = null
        child = spawn(executable, ['--env=production'], {
            cwd: workingDirectory, windowsHide: true,
            env: {...process.env, CONFIG_FILE: configFile, PORT: String(httpPort), VTALLY_NO_BROWSER: 'true'},
        })
        child.on('error', error => { log += error.message })
        child.stdout.on('data', data => { log = (log + data).slice(-12000) })
        child.stderr.on('data', data => { log = (log + data).slice(-12000) })
        browserSocket = io(url, {transports: ['websocket'], reconnection: false, timeout: 8000})
        // The initial attempt may race the process startup; reconnect explicitly once it is listening.
        await until(() => log.includes(`localhost:${httpPort}`))
        if (!browserSocket.connected) { browserSocket.close(); browserSocket = io(url, {transports: ['websocket'], reconnection: false}) }
        browserSocket.on('program.state', data => { state = data })
        browserSocket.on('tally.state', data => { tallyState = data })
        await until(() => browserSocket.connected)
        browserSocket.emit('events.program.subscribe')
        browserSocket.emit('events.tally.subscribe')
        await until(() => state?.programs?.includes('obs-source:Camera'))
    }
    try {
        await start()
        const manifest = await (await fetch(`${url}/asset-manifest.json`)).json()
        const bundle = await (await fetch(`${url}${manifest.files['main.js']}`)).text()
        assert(bundle.includes('V' + require('../package.json').version) && bundle.includes('made by SunjooAN'), 'Wrong frontend version')
        const firmware = await (await fetch(`${url}/api/firmware/status`)).json()
        assert(firmware.targets.current.firmwareExists && firmware.targets['nodemcu-v3'].firmwareExists)
        assert(firmware.targets['legacy-nodemcu'].programFilesReady)
        assert(!requests.includes('GetRecordStatus') && !requests.includes('GetStreamStatus'))
        console.log(`PASS: packaged HTTP, frontend version, firmware targets and OBS v5 ${obsSocket.protocol} source tally`)

        const before = requests.filter(type => type === 'GetSceneList').length
        enabled = false
        for (let i = 0; i < 500; i++) event('SceneItemEnableStateChanged')
        await until(() => state?.programs?.length === 1)
        await pause(200)
        assert.strictEqual(requests.filter(type => type === 'GetSceneList').length, before + 1)
        console.log('PASS: 500 events coalesced into one refresh, source visibility updated')

        event('CurrentSceneCollectionChanging')
        await until(() => state?.programs === null)
        const count = requests.length
        event('SceneItemCreated'); await pause(200)
        assert.strictEqual(requests.length, count)
        scene = 'Replacement'; enabled = true
        event('CurrentSceneCollectionChanged')
        await until(() => state?.programs?.includes('Replacement') && state.programs.includes('obs-source:Camera'))
        console.log('PASS: collection replacement pauses requests and restores tally')

        obsSocket.terminate()
        await until(() => state?.programs === null)
        await until(() => connections === 2 && state?.programs?.includes('obs-source:Camera'))
        console.log('PASS: abrupt socket loss clears stale tally and reconnects')

        const assigned = ['obs-source:Camera', 'Replacement']
        browserSocket.emit('tally.patch.channels', 'SmokeCam', 'web', assigned, 'and')
        await until(() => {
            const saved = JSON.parse(fs.readFileSync(configFile, 'utf8')).tallies[0]
            return saved.channelMatchMode === 'and' && JSON.stringify(saved.channelIds) === JSON.stringify(assigned)
        })
        await stop(); log = ''; await start()
        await until(() => !!tallyState)
        assert.deepStrictEqual(tallyState.tallies[0].channelIds, assigned)
        assert.strictEqual(tallyState.tallies[0].channelMatchMode, 'and')
        console.log('PASS: channel assignments persist across packaged process restart')
    } catch (error) {
        console.error(log)
        throw error
    } finally {
        await stop()
        server.clients.forEach(socket => socket.terminate())
        await new Promise(resolve => server.close(resolve))
        fs.readdirSync(temporary).forEach(name => fs.unlinkSync(path.join(temporary, name)))
        fs.rmdirSync(temporary)
    }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
