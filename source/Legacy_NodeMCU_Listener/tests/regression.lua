-- Runs against source with Lua 5.1 and compiled files with NodeMCU luac.cross -e.
local root = os.getenv('VTALLY_LUA_ROOT') or 'source/Legacy_NodeMCU_Listener/src'
local extension = os.getenv('VTALLY_LUA_EXTENSION') or '.lua'
package.path = root .. '/?' .. extension .. ';' .. package.path
local checks = 0
local check = function(value, message)
    checks = checks + 1
    assert(value, message or ('assertion ' .. checks))
end
local timers, sockets, now, connected, bindFailure, sendFailure, warnings
local loadModule = function(name)
    package.loaded[name] = nil
    return require(name)
end
local setup = function()
    timers, sockets, now, connected, bindFailure, sendFailure, warnings = {}, {}, 0, true, false, false, 0
    _G.tmr = {ALARM_AUTO = 1, ALARM_SINGLE = 0, now = function() return now end, create = function()
        local timer = {active = false, starts = 0}
        function timer:unregister() self.active = false end
        function timer:alarm(delay, mode, callback)
            self.delay, self.mode, self.callback, self.active = delay, mode, callback, true
            self.starts = self.starts + 1
        end
        function timer:fire()
            if self.active then
                if self.mode == 0 then self.active = false end
                self.callback()
            end
        end
        timers[#timers + 1] = timer
        return timer
    end}
    _G.MyLog = {info = function() end, error = function() end, warning = function() warnings = warnings + 1 end}
    _G.MySettings = {
        hubIp = function() return '192.168.1.5' end, hubPort = function() return 7411 end,
        name = function() return 'Cam01' end, staSsid = function() return 'TallyWifi' end,
        staPw = function() return '' end, hostName = function() return 'Tally-Cam01' end,
    }
    _G.MyWifi = {isConnected = function() return connected end}
    _G.MyLed = {static = function(...) MyLed.colors = {...} end,
        flash = function(...) MyLed.colors = {...} end,
        waitForServerConnection = function() MyLed.waiting = true end,
        waitForWifiConnection = function() MyLed.waiting = true end, waitForWifiIp = function() end}
    _G.net = {createUDPSocket = function()
        local socket = {closed = false}
        function socket:on(_, callback) self.receive = callback end
        function socket:listen(port) assert(not bindFailure); self.port = port end
        function socket:close() self.closed = true end
        function socket:send(port, ip, data)
            assert(not sendFailure)
            self.sent = data
        end
        sockets[#sockets + 1] = socket
        return socket
    end}
end

setup()
loadModule('my-tally')
check(MyTally:connect() and MyTally:isReady())
check(sockets[1].port == 7411 and sockets[1].sent == 'tally-ho "Cam01"\n')
check(not MyTally:isConnected())
local valid = 'O255/000/000 S255/000/000'
check(myHandleReceive(valid) and MyTally:isConnected())
check(MyLed.colors[1] == 255 and MyLed.colors[4] == 255)
check(myHandleReceive(' \r\nO255/255/255 S255/255/255 0xAA 125\t'))
check(MyLed.colors[7][1] and not MyLed.colors[7][2] and MyLed.colors[8] == 125)
local invalid = {'', 'O256/000/000 S000/000/000', 'O000/000/000 S999/000/000',
    'Oabc/000/000 S000/000/000', 'O255/000/000 S000/000/000 x',
    valid .. ' 0xGG 125', valid .. ' 0xA 125', valid .. ' 0xAA 0',
    valid .. ' 0xAA 65536', valid .. ' 0xAA -1', valid .. ' 0xAA 1a',
    valid .. ' 0xAA 100000', string.rep(' ', 65) .. valid, valid:sub(1, 8) .. '\0' .. valid:sub(10)}
now = 2000000
for _, data in ipairs(invalid) do check(not myHandleReceive(data)) end
check(warnings == 1, 'invalid-packet warnings must be rate limited')
now = 3000001
check(not MyTally:isConnected(), 'malformed packets must not refresh liveness')
now = 0
check(not MyTally:isConnected(), 'expired health must not revive after wrap')
now = 2147483000
check(myHandleReceive(valid))
now = 1000
check(MyTally:isConnected(), '31-bit microsecond timer wrap')
now = 3000000
check(not MyTally:isConnected())
sockets[1]:receive(valid, 7411, '192.168.1.6')
check(not MyTally:isConnected(), 'foreign sender')
sockets[1]:receive(valid, 7412, '192.168.1.5')
check(not MyTally:isConnected(), 'foreign port')
sockets[1]:receive(valid, 7411, '192.168.1.5')
check(MyTally:isConnected())
connected = false
check(not MyTally:isReady() and not MyTally:isConnected())
MyTally:disconnect()
check(sockets[1].closed)
connected, bindFailure = true, true
check(not MyTally:connect() and sockets[2].closed and not MyTally:isReady())
bindFailure = false
timers[1]:fire()
check(MyTally:isReady() and #sockets == 3, 'UDP bind retry')
sendFailure = true
check(not MyTally:sendInfo() and not MyTally:isReady() and sockets[3].closed, 'send failure must not recurse')
sendFailure = false
timers[1]:fire()
check(MyTally:isReady() and #sockets == 4)
check(MyTally:sendLog('INFO', 'first\r\nsecond') and not sockets[4].sent:find('first\r\n'))

setup()
local disconnects, connects, callbacks, staConnects = 0, 0, {}, 0
_G.MyTally = {disconnect = function() disconnects = disconnects + 1 end, connect = function() connects = connects + 1 end}
_G.wifi = {STATION = 1, setmode = function() end, setmaxtxpower = function() end,
    sta = {config = function(value) check(value.pwd == '' and not value.auto and not value.save) end,
        sethostname = function() end, connect = function() staConnects = staConnects + 1 end,
        disconnect = function() end, getip = function() return '192.168.1.7' end, getmac = function() return 'mac' end},
    eventmon = {STA_CONNECTED = 1, STA_DISCONNECTED = 2, STA_GOT_IP = 3, STA_DHCP_TIMEOUT = 4,
        reason = {NO_AP_FOUND = 201}, register = function(id, callback) callbacks[id] = callback end}}
loadModule('my-wifi')
MyWifi.connect()
check(staConnects == 1)
for i = 1, 100 do callbacks[2]({reason = 201}) end
check(#timers == 1 and timers[1].active and not MyWifi.isConnected(), 'one persistent reconnect timer')
callbacks[3]({IP = '192.168.1.7'})
check(MyWifi.isConnected() and connects == 1 and not timers[1].active)
callbacks[4]()
check(not MyWifi.isConnected() and timers[1].active)
timers[1]:fire()
check(staConnects == 2)
MyWifi.disconnect()
callbacks[2]({reason = 201})
check(not timers[1].active and not MyWifi.isConnected(), 'manual disconnect must not reconnect')
callbacks[3]({IP = '192.168.1.8'})
check(not MyWifi.isConnected() and connects == 1)
MyWifi.connect()
callbacks[1]({SSID = 'TallyWifi'})
check(not MyWifi.isConnected() and disconnects >= 104)
callbacks[3]({IP = '192.168.1.8'})
check(MyWifi.isConnected() and connects == 2)

local settings = function(lines)
    setup()
    _G.node = {chipid = function() return 12345 end}
    _G.file = {exists = function() return true end, open = function()
        local index = 0
        return {readline = function() index = index + 1; return lines[index] end, close = function() end}
    end}
    loadModule('my-settings')
end
settings({' station.ssid = TallyWifi ', 'station.password=a=b=c', 'hub.ip=192.168.1.5',
    'hub.port=65535', 'operator.ws2812 = 8 RGB', 'stage.ws2812 = 8 grb', 'operator.type=GRB-', 'tally.name=Cam02'})
check(MySettings.isValid() and MySettings.staPw() == 'a=b=c' and MySettings.hubPort() == 65535)
check(MySettings.operatorNumberOfWs2812Lights() == 8 and MySettings.stageNumberOfWs2812Lights() == 8)
check(MySettings.operatorWs2812Type() == 'rgb' and MySettings.operatorType() == 'grb-')
for _, port in ipairs({'0', '-1', '65536', 'abc', '1.5'}) do
    settings({'station.ssid=WiFi', 'hub.ip=192.168.1.5', 'hub.port=' .. port})
    check(MySettings.hubPort() == 7411)
end
for _, ip in ipairs({'1.2.3', '256.1.2.3', '1.2.3.4a', 'a.2.3.4', ''}) do
    settings({'station.ssid=WiFi', 'hub.ip=' .. ip})
    check(not MySettings.isValid())
end
for _, count in ipairs({'-1', '11', '1.5', '8 xyz'}) do
    settings({'operator.ws2812=' .. count})
    check(MySettings.operatorNumberOfWs2812Lights() == 5)
end
settings({'station.ssid=WiFi', 'station.password=', 'hub.ip=1.2.3.4', 'operator.ws2812=0', 'tally.name=bad"name'})
check(MySettings.isValid() and MySettings.staPw() == '' and MySettings.operatorNumberOfWs2812Lights() == 0)
check(not MySettings.name():find('"'))

setup()
_G.LightTypes = {COMMON_ANODE = 'grb+'}
_G.Ws2812Types = {GRB = 'grb', RGB = 'rgb'}
MySettings.operatorType = function() return 'grb+' end
MySettings.stageType = function() return 'grb-' end
MySettings.operatorNumberOfWs2812Lights = function() return 8 end
MySettings.stageNumberOfWs2812Lights = function() return 8 end
MySettings.operatorWs2812Type = function() return 'grb' end
MySettings.stageWs2812Type = function() return 'rgb' end
local writes, pwmWrites, data = 0, 0
_G.gpio = {OUTPUT = 1, HIGH = 1, LOW = 0, mode = function() end, write = function() end}
_G.pwm2 = {setup_pin_hz = function() end, start = function() end, set_duty = function() pwmWrites = pwmWrites + 1 end}
_G.ws2812 = {MODE_SINGLE = 0, init = function() end, write = function(value) writes = writes + 1; data = value end}
loadModule('my-led')
MyLed.static(255, 0, 0, 0, 255, 0)
check(writes == 1 and #data == 48 and data:sub(1, 3) == string.char(0, 255, 0))
check(data:sub(25, 27) == string.char(0, 255, 0))
for i = 1, 10000 do MyLed.static(255, 0, 0, 0, 255, 0) end
check(writes == 1 and pwmWrites == 6, 'identical colors should not rewrite LEDs')
local pattern = {true, false, true, false, true, false, true, false}
MyLed.flash(255, 255, 255, 255, 255, 255, pattern, 125)
local starts = timers[1].starts
timers[1]:fire()
local dim = data
MyLed.flash(255, 255, 255, 255, 255, 255, pattern, 125)
check(timers[1].starts == starts and data == dim, 'duplicate flash must preserve phase')
MyLed.static(255, 255, 0, 255, 255, 0)
check(not timers[1].active)

setup()
package.loaded['my-log-buffer'] = nil
local sent, failed = 0, true
_G.MyTally = {isReady = function() return true end, isConnected = function() return true end,
    sendLog = function() if failed then return false end; sent = sent + 1; return true end}
loadModule('my-log')
MyLog.info('retain on failure')
timers[1]:fire()
check(require('my-log-buffer'):hasLog(), 'failed flush must retain record')
failed = false
timers[1]:fire()
check(sent == 1 and not require('my-log-buffer'):hasLog())
local buffer = require('my-log-buffer')
for i = 1, 100 do buffer:addLog('INFO', string.rep('x', 200)) end
local count = 0
while buffer:hasLog() do
    local _, msg = buffer:getLog()
    count = count + 1
    check(#msg == 80)
end
check(count == 10, 'log memory must remain bounded')
-- Start all seven maintained modules together, not just their individual APIs.
setup()
for _, name in ipairs({'my-app', 'my-log', 'my-log-buffer', 'my-settings', 'my-led', 'my-tally', 'my-wifi'}) do
    package.loaded[name] = nil
end
_G.MyTally = nil
_G.node = {chipid = function() return 12345 end, bootreason = function() return 0, 0 end}
_G.file = {exists = function() return true end, open = function()
    local index = 0
    local lines = {'station.ssid=TallyWifi', 'station.password=', 'hub.ip=192.168.1.5'}
    return {readline = function() index = index + 1; return lines[index] end, close = function() end}
end}
wifi.NULLMODE = 0
loadModule('my-app')
check(MySettings.isValid() and not MyWifi.isConnected() and not MyTally:isReady())
check(#timers == 4, 'log flush, LED flash, UDP heartbeat and one WiFi retry timer')
print('PASS: ' .. checks .. ' legacy Lua assertions (' .. extension .. ')')
