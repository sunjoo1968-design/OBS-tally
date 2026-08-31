import ObsConnector from './ObsConnector'
import ObsConfiguration, { ObsConfigurationLiveMode } from './ObsConfiguration'

function createConnector(mode: ObsConfigurationLiveMode) {
    const configuration = new ObsConfiguration()
    configuration.setLiveMode(mode)
    const communicator = {
        notifyProgramPreviewChanged: jest.fn(),
    }
    const connector = new ObsConnector(configuration, communicator as any)
    const call = jest.fn().mockResolvedValue({outputActive: false, outputPaused: false})
    connector.obs = {call} as any

    return {connector, call}
}

describe('OBS output status request safety', () => {
    test('does not query output status in always mode', () => {
        const {connector, call} = createConnector('always')

        connector['updateOutputStates']()

        expect(call).not.toHaveBeenCalled()
    })

    test.each([
        ['stream', ['GetStreamStatus']],
        ['record', ['GetRecordStatus']],
        ['streamOrRecord', ['GetStreamStatus', 'GetRecordStatus']],
    ] as Array<[ObsConfigurationLiveMode, string[]]>)('queries only the output required by %s mode', (mode, expectedRequests) => {
        const {connector, call} = createConnector(mode)

        connector['updateOutputStates']()

        expect(call.mock.calls.map(args => args[0])).toEqual(expectedRequests)
    })
})
