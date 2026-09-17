import { MixerDriver } from "./MixerDriver"

describe('getAllowedMixers', () => {
    test('keeps the maintained mixer choices identical in development and production', () => {
        const mixersDev = MixerDriver.getAllowedMixers(true, false)
        expect(mixersDev.length).toBeGreaterThan(2)
        expect(mixersDev).toEqual(['atem', 'obs', 'vmix'])

        const mixersProd = MixerDriver.getAllowedMixers(false, false)
        expect(mixersProd.length).toBeGreaterThan(2)
        expect(mixersProd).toEqual(mixersDev)
        expect(mixersProd).not.toContain("mock")
    })
    test('does not expose removed test-only mixers', () => {
        const mixersDev = MixerDriver.getAllowedMixers(false, true)
        expect(mixersDev.length).toBeGreaterThan(2)
        expect(mixersDev).toEqual(['atem', 'obs', 'vmix'])

        const mixersProd = MixerDriver.getAllowedMixers(false, false)
        expect(mixersProd.length).toBeGreaterThan(2)
        expect(mixersProd).toEqual(mixersDev)
        expect(mixersProd).not.toContain("test")
    })
})
