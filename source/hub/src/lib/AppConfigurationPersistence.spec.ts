/** @jest-environment node */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { EventEmitter } from 'events'
import { AppConfiguration } from './AppConfiguration'
import AppConfigurationPersistence from './AppConfigurationPersistence'

let directory: string
let filename: string
let emitter: EventEmitter
let configuration: AppConfiguration
let persistence: AppConfigurationPersistence

beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vtally-config-'))
    filename = path.join(directory, 'wifi-tally.json')
    emitter = new EventEmitter()
    configuration = new AppConfiguration(emitter)
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
    if (persistence?.saveTimeout) clearTimeout(persistence.saveTimeout)
    fs.readdirSync(directory).forEach(name => fs.unlinkSync(path.join(directory, name)))
    fs.rmdirSync(directory)
    jest.restoreAllMocks()
})

test('missing and empty files use defaults', () => {
    persistence = new AppConfigurationPersistence(configuration, emitter, filename)
    expect(configuration.getObsConfiguration().getPort().toNumber()).toBe(4455)
    fs.writeFileSync(filename, '')
    expect(() => new AppConfigurationPersistence(configuration, emitter, filename)).not.toThrow()
    expect(console.warn).toHaveBeenCalledTimes(2)
})

test.each(['Hello World', '{"invalid":', 'null', '42'])('invalid nonempty config is rejected: %s', data => {
    fs.writeFileSync(filename, data)
    expect(() => new AppConfigurationPersistence(configuration, emitter, filename)).toThrow()
})

test.each(['obs', 'atem', 'vmix'])('legacy single-channel JSON remains compatible with %s', mixer => {
    // Self-contained legacy-format fixture, independent of previously removed fixture files.
    fs.writeFileSync(filename, JSON.stringify({
        mixer, obs: {ip: '127.0.0.1', port: 4444}, atem: {ip: '192.168.99.200', port: 9910},
        vmix: {ip: '127.0.0.1', port: 8099},
        channels: [{id: '1', name: 'Camera'}], tallies: [{name: 'Cam01', type: 'udp', channelId: '1'}],
    }))
    persistence = new AppConfigurationPersistence(configuration, emitter, filename)
    expect(configuration.getMixerSelection()).toBe(mixer)
    expect(configuration.getObsConfiguration().getPort().toNumber()).toBe(4444)
    expect(configuration.getTallies()[0].channelIds).toEqual(['1'])
    expect(configuration.getChannels()[0].name).toBe('Camera')
})

test('channelIds and channelMatchMode survive an atomic save/reload', async () => {
    persistence = new AppConfigurationPersistence(configuration, emitter, filename)
    configuration.fromJson({tallies: [{name: 'Cam02', type: 'web', channelIds: ['obs-source:Cam2', 'Scene2'], channelMatchMode: 'and'}]})
    await persistence.save()
    const other = new AppConfiguration(new EventEmitter())
    new AppConfigurationPersistence(other, other.emitter, filename)
    expect(other.getTallies()[0].channelIds).toEqual(['obs-source:Cam2', 'Scene2'])
    expect(other.getTallies()[0].channelMatchMode).toBe('and')
    expect(fs.readdirSync(directory)).toEqual(['wifi-tally.json'])
})

test('concurrent saves are serialized and the newest snapshot wins', async () => {
    persistence = new AppConfigurationPersistence(configuration, emitter, filename)
    const rename = jest.spyOn(fs.promises, 'rename')
    configuration.setMixerSelection('atem'); const first = persistence.save()
    configuration.setMixerSelection('vmix'); const last = persistence.save()
    await Promise.all([first, last])
    expect(rename).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fs.readFileSync(filename, 'utf8')).mixer).toBe('vmix')
})

test('failed replacement preserves the old valid file, cleans temp files and allows a later save', async () => {
    fs.writeFileSync(filename, '{"mixer":"obs"}')
    persistence = new AppConfigurationPersistence(configuration, emitter, filename)
    jest.spyOn(fs.promises, 'rename').mockRejectedValueOnce(new Error('disk unavailable'))
    configuration.setMixerSelection('atem')
    await expect(persistence.save()).rejects.toThrow('disk unavailable')
    expect(fs.readFileSync(filename, 'utf8')).toBe('{"mixer":"obs"}')
    expect(fs.readdirSync(directory)).toEqual(['wifi-tally.json'])
    await persistence.save()
    expect(JSON.parse(fs.readFileSync(filename, 'utf8')).mixer).toBe('atem')
})

test('scheduled write failures are handled rather than becoming unhandled rejections', async () => {
    persistence = new AppConfigurationPersistence(configuration, emitter, filename)
    jest.spyOn(persistence, 'save').mockRejectedValue(new Error('read-only disk'))
    jest.useFakeTimers()
    try {
        configuration.setMixerSelection('vmix')
        jest.advanceTimersByTime(500)
        await Promise.resolve(); await Promise.resolve()
        expect(persistence.save).toHaveBeenCalledTimes(1)
    } finally { jest.useRealTimers() }
})
