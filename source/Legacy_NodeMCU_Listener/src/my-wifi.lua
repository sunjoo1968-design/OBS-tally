local connected = false
local reconnect = tmr.create()
local enabled = true
local retry = function(delay)
    reconnect:unregister()
    if enabled then reconnect:alarm(delay, tmr.ALARM_SINGLE, function() MyWifi.connect() end) end
end
local lost = function()
    connected = false
    MyTally:disconnect()
    MyLed.waitForWifiConnection()
end

_G.MyWifi = {
    connect = function()
        enabled = true
        reconnect:unregister()
        MyLed.waitForWifiConnection()
        MyLog.info('Connect to WiFi ' .. MySettings:staSsid())
        wifi.setmode(wifi.STATION)
        wifi.sta.config({ssid = MySettings:staSsid(), pwd = MySettings:staPw() or '', auto = false, save = false})
        wifi.sta.sethostname(MySettings:hostName())
        wifi.sta.connect()
    end,
    disconnect = function()
        enabled = false
        reconnect:unregister()
        lost()
        wifi.sta.disconnect()
    end,
    isConnected = function() return connected end,
    getIp = function() return wifi.sta.getip() end,
    getMac = function() return wifi.sta.getmac() end,
}

wifi.setmaxtxpower(82)
wifi.eventmon.register(wifi.eventmon.STA_CONNECTED, function(event)
    reconnect:unregister()
    connected = false
    MyTally:disconnect()
    MyLog.info('Connected to ' .. (event.SSID or '') .. '. Waiting for IP.')
    MyLed.waitForWifiIp()
end)
wifi.eventmon.register(wifi.eventmon.STA_DISCONNECTED, function(event)
    lost()
    local reason = event.reason
    for key, value in pairs(wifi.eventmon.reason) do if value == reason then reason = key; break end end
    MyLog.error('WiFi disconnected. Reason ' .. tostring(reason))
    retry(2000)
end)
wifi.eventmon.register(wifi.eventmon.STA_GOT_IP, function(event)
    if not enabled then return end
    reconnect:unregister()
    connected = true
    MyLog.info('Got IP ' .. event.IP)
    MyLed.waitForServerConnection()
    MyTally:connect()
end)
wifi.eventmon.register(wifi.eventmon.STA_DHCP_TIMEOUT, function()
    lost()
    MyLog.error('DHCP timeout')
    wifi.sta.disconnect()
    retry(2000)
end)
