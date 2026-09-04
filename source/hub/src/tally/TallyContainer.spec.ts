import TallyContainer from './TallyContainer'
import ServerEventEmitter from '../lib/ServerEventEmitter';
import { AppConfiguration } from '../lib/AppConfiguration';
import WebTallyDriver from './WebTallyDriver';
import { TallyConfiguration } from './TallyConfiguration';

test('it writes changes to configuration', () => {
    const emitter = new ServerEventEmitter()
    const configuration = new AppConfiguration(emitter)
    const container = new TallyContainer(configuration, emitter)
    new WebTallyDriver(configuration, container)

    // check that it is initially empty
    expect(configuration.getTallies()).toEqual([])

    const tally = container.getOrCreate("Foobar", "web")

    // tally was created
    expect(configuration.getTallies()).toHaveLength(1)
    expect(configuration.getTallies()[0].name).toEqual("Foobar")
    expect(configuration.getTallies()[0].channelId).toBe(undefined)

    tally.channelId = "42"
    container.update(tally)
    expect(configuration.getTallies()).toHaveLength(1)
    expect(configuration.getTallies()[0].name).toEqual("Foobar")
    expect(configuration.getTallies()[0].channelId).toEqual("42")

    container.remove(tally.name, "web")
    expect(configuration.getTallies()).toEqual([])
})

test('it emits a configuration change when patch channels are changed in place', () => {
    const emitter = new ServerEventEmitter()
    const configuration = new AppConfiguration(emitter)
    const container = new TallyContainer(configuration, emitter)
    const onConfigurationChanged = jest.fn()
    emitter.on('config.changed', onConfigurationChanged)

    container.getOrCreate('Cam02', 'web')
    onConfigurationChanged.mockClear()

    container.patchChannels('Cam02', 'web', ['camera-2', 'mix-2'], 'or')

    expect(onConfigurationChanged).toHaveBeenCalledTimes(1)
    expect(configuration.toJson().tallies).toEqual(expect.arrayContaining([
        expect.objectContaining({
            name: 'Cam02',
            channelIds: ['camera-2', 'mix-2'],
            channelMatchMode: 'or',
        }),
    ]))
})

test('it emits a configuration change when individual tally settings are changed in place', () => {
    const emitter = new ServerEventEmitter()
    const configuration = new AppConfiguration(emitter)
    const container = new TallyContainer(configuration, emitter)
    const onConfigurationChanged = jest.fn()
    emitter.on('config.changed', onConfigurationChanged)

    container.getOrCreate('Cam02', 'web')
    onConfigurationChanged.mockClear()
    const settings = new TallyConfiguration()
    settings.setStageLightBrightness(55)

    container.updateSettings('Cam02', 'web', settings)

    expect(onConfigurationChanged).toHaveBeenCalledTimes(1)
    expect(configuration.toJson().tallies).toEqual(expect.arrayContaining([
        expect.objectContaining({name: 'Cam02', stBrightness: 55}),
    ]))
})

test('a web tally created with a channel emits the channel persistence change', () => {
    const emitter = new ServerEventEmitter()
    const configuration = new AppConfiguration(emitter)
    const container = new TallyContainer(configuration, emitter)
    const driver = new WebTallyDriver(configuration, container)
    const onConfigurationChanged = jest.fn()
    emitter.on('config.changed', onConfigurationChanged)

    driver.create('Cam03', 'camera-3')

    expect(onConfigurationChanged).toHaveBeenCalledTimes(2)
    expect(configuration.toJson().tallies).toEqual(expect.arrayContaining([
        expect.objectContaining({name: 'Cam03', channelIds: ['camera-3']}),
    ]))
})
