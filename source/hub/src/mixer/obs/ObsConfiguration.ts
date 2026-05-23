import ipAddress, {IpAddress} from '../../domain/IpAddress'
import ipPort, {IpPort} from '../../domain/IpPort'
import {Configuration} from '../interfaces'

export type ObsConfigurationSaveType = {
    ip: string
    port: number
    password?: string
    liveMode?: ObsConfigurationLiveMode
}

export type ObsConfigurationLiveMode = "always" | "stream" | "record" | "streamOrRecord"

class ObsConfiguration extends Configuration {
    ip: IpAddress
    port: IpPort
    password: string
    liveMode: ObsConfigurationLiveMode


    constructor() {
        super()
        this.ip = ObsConfiguration.defaultIp
        this.port = ObsConfiguration.defaultPort
        this.password = ObsConfiguration.defaultPassword
        this.liveMode = ObsConfiguration.defaultLiveMode
    }

    fromJson(data: ObsConfigurationSaveType): void {
        this.loadIpAddress("ip", this.setIp.bind(this), data)
        this.loadIpPort("port", this.setPort.bind(this), data)
        this.setPassword(data.password || null)
        data.liveMode && this.setLiveMode(data.liveMode)
    }
    toJson(): ObsConfigurationSaveType {
        return {
            ip: this.ip.toString(),
            port: this.port.toNumber(),
            password: this.password,
            liveMode: this.liveMode,
        }
    }
    clone(): ObsConfiguration {
        const clone = new ObsConfiguration()
        clone.fromJson(this.toJson())
        return clone
    }

    setIp(ip: IpAddress | string | null) {
        if (typeof ip === "string") {
            ip = ipAddress(ip)
        } else if (ip === null) {
            ip = ObsConfiguration.defaultIp
        }
        this.ip = ip
        
        return this
    }
    getIp() {
        return this.ip
    }

    setPort(port: IpPort | string | number | null) {
        if (typeof port === "number" || typeof port === "string") {
            port = ipPort(port)
        } else if (port === null) {
            port = ObsConfiguration.defaultPort
        }
        this.port = port
        
        return this
    }
    getPort() {
        return this.port
    }

    setPassword(password: string | null) {
        this.password = password || ObsConfiguration.defaultPassword
        return this
    }
    getPassword() {
        return this.password
    }

    setLiveMode(mode: ObsConfigurationLiveMode) {
        this.liveMode = mode
    }
    getLiveMode() {
        return this.liveMode
    }

    private static readonly defaultIp = ipAddress("127.0.0.1")
    private static readonly defaultPort = ipPort(4455)
    private static readonly defaultPassword = ""
    private static readonly defaultLiveMode = "always"

    static isValidLiveMode(theString: string): theString is ObsConfigurationLiveMode {
        return theString === "always" || theString === "streamOrRecord" || theString === "stream" || theString === "record"
    }

}

export default ObsConfiguration
