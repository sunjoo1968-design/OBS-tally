import os from 'os'

export type HubNetworkInfo = {
  defaultHubIp: string
  addresses: string[]
}

type NetworkEntry = {
  name: string
  address: string
}

const normalizeIpv4 = (address?: string) => {
  if (!address) return ''
  return address.startsWith('::ffff:') ? address.slice(7) : address
}

const isIpv4 = (address: string) => /^(?:\d{1,3}\.){3}\d{1,3}$/.test(address)
const isLoopback = (address: string) => address.startsWith('127.')
const isLinkLocal = (address: string) => address.startsWith('169.254.')
const isPrivate = (address: string) => {
  const octets = address.split('.').map(Number)
  return octets[0] === 10
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
}

const interfacePenalty = (name: string) => {
  const value = name.toLowerCase()
  if (/virtual|virtualbox|vmware|hyper-v|vethernet|wsl|docker|loopback|bluetooth|tailscale|zerotier|vpn/.test(value)) return 100
  if (/wi-?fi|wlan|wireless|ethernet|이더넷|lan/.test(value)) return 0
  return 20
}

const addressPenalty = (address: string) => {
  if (isLinkLocal(address)) return 50
  if (isPrivate(address)) return 0
  return 10
}

export const selectHubNetworkInfo = (entries: NetworkEntry[], requestAddress?: string): HubNetworkInfo => {
  const uniqueEntries = entries
    .filter(entry => isIpv4(entry.address) && !isLoopback(entry.address) && !isLinkLocal(entry.address))
    .filter((entry, index, list) => list.findIndex(candidate => candidate.address === entry.address) === index)
    .sort((a, b) => {
      const score = interfacePenalty(a.name) + addressPenalty(a.address)
      const otherScore = interfacePenalty(b.name) + addressPenalty(b.address)
      return score - otherScore || a.name.localeCompare(b.name) || a.address.localeCompare(b.address)
    })

  const addresses = uniqueEntries.map(entry => entry.address)
  const requestedIp = normalizeIpv4(requestAddress)
  const defaultHubIp = addresses.includes(requestedIp) ? requestedIp : (addresses[0] || '')
  return {defaultHubIp, addresses}
}

export const getHubNetworkInfo = (requestAddress?: string): HubNetworkInfo => {
  const entries: NetworkEntry[] = []
  Object.entries(os.networkInterfaces()).forEach(([name, addresses]) => {
    ;(addresses || []).forEach(address => {
      const family = String(address.family)
      if (!address.internal && (family === 'IPv4' || family === '4')) {
        entries.push({name, address: address.address})
      }
    })
  })
  return selectHubNetworkInfo(entries, requestAddress)
}
