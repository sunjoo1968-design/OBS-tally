-- UDP protocol and connection health. tmr.now() wraps at 31 bits, not 32.
local elapsed = function(time)
    return (tmr.now() - time) % 2147483648
end
local listenSocket, lastReceived, lastWarning
local parse = function(data)
    if type(data) ~= 'string' or #data > 64 then return end
    data = data:match('^%s*(.-)%s*$')
    local r, g, b, sr, sg, sb, suffix = data:match('^O(%d%d%d)/(%d%d%d)/(%d%d%d) S(%d%d%d)/(%d%d%d)/(%d%d%d)(.*)$')
    if not r then return end
    r, g, b, sr, sg, sb = tonumber(r), tonumber(g), tonumber(b), tonumber(sr), tonumber(sg), tonumber(sb)
    if r > 255 or g > 255 or b > 255 or sr > 255 or sg > 255 or sb > 255 then return end
    local pattern, duration
    if suffix ~= '' then
        local hex, number = suffix:match('^ 0x(%x%x) (%d+)$')
        if not hex or #number > 5 then return end
        duration = tonumber(number)
        if duration < 1 or duration > 65535 then return end
        local bits = tonumber(hex, 16)
        pattern = {}
        for i = 1, 8 do
            local mask = 2^(8-i)
            pattern[i] = bits >= mask
            if pattern[i] then bits = bits - mask end
        end
    end
    return r, g, b, sr, sg, sb, pattern, duration
end

_G.myHandleReceive = function(data)
    local r, g, b, sr, sg, sb, pattern, duration = parse(data)
    if not r then
        if not lastWarning or elapsed(lastWarning) >= 1000000 then
            lastWarning = tmr.now()
            MyLog.warning('Invalid tally packet ignored')
        end
        return false
    end
    lastReceived = tmr.now()
    if pattern then MyLed.flash(r, g, b, sr, sg, sb, pattern, duration)
    else MyLed.static(r, g, b, sr, sg, sb) end
    return true
end

_G.MyTally = {
    disconnect = function()
        lastReceived = nil
        if listenSocket then pcall(function() listenSocket:close() end) end
        listenSocket = nil
    end,
    connect = function(self)
        self:disconnect()
        if not MyWifi.isConnected() then return false end
        local socket
        local ok = pcall(function()
            socket = net.createUDPSocket()
            socket:on('receive', function(_, data, port, ip)
                if MyWifi.isConnected() and ip == MySettings:hubIp() and port == MySettings:hubPort() then
                    myHandleReceive(data)
                end
            end)
            socket:listen(7411)
        end)
        if not ok then
            if socket then pcall(function() socket:close() end) end
            return false
        end
        listenSocket = socket
        MyLog.info(string.format('Contacting hub on %s:%d', MySettings:hubIp(), MySettings:hubPort()))
        self:sendInfo()
        return true
    end,
    isReady = function() return MyWifi.isConnected() and listenSocket ~= nil end,
    isConnected = function()
        if MyTally:isReady() and lastReceived ~= nil and elapsed(lastReceived) <= 3000000 then return true end
        -- Expire permanently so a complete timer wrap cannot revive an old heartbeat.
        lastReceived = nil
        return false
    end,
    send = function(_, data)
        if not MyTally:isReady() then return false end
        -- Never log via MyLog here: a failed sendLog would recurse back into send.
        local ok = pcall(function() listenSocket:send(MySettings:hubPort(), MySettings:hubIp(), data .. '\n') end)
        if not ok then MyTally:disconnect() end
        return ok
    end,
    sendInfo = function(self) return self:send(string.format('tally-ho "%s"', MySettings:name())) end,
    sendLog = function(self, severity, msg)
        return self:send(string.format('log "%s" %s "%s"', MySettings:name(), severity, msg:gsub('[\r\n]', ' ')))
    end,
}

tmr.create():alarm(1000, tmr.ALARM_AUTO, function()
    if MyWifi and MyWifi.isConnected() then
        if not MyTally:isConnected() then MyLed.waitForServerConnection() end
        if not MyTally:isReady() then MyTally:connect() else MyTally:sendInfo() end
    end
end)
