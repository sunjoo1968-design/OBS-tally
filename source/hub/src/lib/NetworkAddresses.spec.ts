import { selectHubNetworkInfo } from './NetworkAddresses'

describe('selectHubNetworkInfo()', () => {
  test('prefers the LAN address over virtual and link-local adapters', () => {
    expect(selectHubNetworkInfo([
      {name: 'vEthernet (WSL)', address: '172.20.0.1'},
      {name: 'Ethernet', address: '169.254.1.2'},
      {name: 'Wi-Fi', address: '192.168.0.25'},
    ])).toEqual({
      defaultHubIp: '192.168.0.25',
      addresses: ['192.168.0.25', '172.20.0.1'],
    })
  })

  test('uses the address that served the browser when it is a local interface', () => {
    expect(selectHubNetworkInfo([
      {name: 'Ethernet', address: '10.0.0.8'},
      {name: 'Wi-Fi', address: '192.168.0.25'},
    ], '::ffff:10.0.0.8').defaultHubIp).toBe('10.0.0.8')
  })

  test('does not return loopback as a firmware Hub IP', () => {
    expect(selectHubNetworkInfo([{name: 'Loopback', address: '127.0.0.1'}], '127.0.0.1'))
      .toEqual({defaultHubIp: '', addresses: []})
  })
})
