local fileName = '/FLASH/tally-settings.ini'
_G.LightTypes = {COMMON_ANODE = 'grb+', COMMON_CATHODE = 'grb-'}
_G.Ws2812Types = {RGB = 'rgb', GRB = 'grb'}
local ssid, password, ip
local port = 7411
local name = string.format('%x', node.chipid())
local opType, stageType = 'grb+', 'grb+'
local opCount, stageCount = 5, 0
local opOrder, stageOrder = 'grb', 'grb'
local trim = function(s) return s:match('^%s*(.-)%s*$') end
local ipv4 = function(s)
    if not s then return false end
    local a, b, c, d = s:match('^(%d+)%.(%d+)%.(%d+)%.(%d+)$')
    return a ~= nil and #s <= 15 and tonumber(a) <= 255 and tonumber(b) <= 255 and tonumber(c) <= 255 and tonumber(d) <= 255
end
local ws = function(value)
    local count, order = value:lower():match('^(%d+)%s*(%a*)$')
    count = tonumber(count)
    if not count or count > 10 or (order ~= '' and order ~= 'grb' and order ~= 'rgb') then return end
    return count, order ~= '' and order or nil
end
local warning = function(key) MyLog.warning('Invalid ' .. key .. ' in tally-settings.ini') end

_G.MySettings = {
    staSsid = function() return ssid end,
    staPw = function() return password end,
    hubIp = function() return ip end,
    hubPort = function() return port end,
    name = function() return name end,
    hostName = function() return 'Tally-' .. name:gsub('[^%w]+', '-'):gsub('^%-+', ''):gsub('%-+$', '') end,
    operatorType = function() return opType end,
    stageType = function() return stageType end,
    operatorNumberOfWs2812Lights = function() return opCount end,
    stageNumberOfWs2812Lights = function() return stageCount end,
    operatorWs2812Type = function() return opOrder end,
    stageWs2812Type = function() return stageOrder end,
    isValid = function() return ssid ~= nil and #ssid > 0 and #ssid <= 32 and ipv4(ip) end,
}

if file.exists(fileName) then
    local f = file.open(fileName, 'r')
    if not f then MyLog.error('Could not open tally-settings.ini')
    else
        while true do
            local line = f:readline()
            if not line then break end
            line = trim(line)
            if line:sub(1, 1) ~= ';' then
                local key, value = line:match('^([^=]+)=(.*)$')
                if key then
                    key, value = trim(key), trim(value)
                    if key == 'station.ssid' then
                        if #value > 0 and #value <= 32 then ssid = value else warning(key) end
                    elseif key == 'station.password' then
                        if #value <= 64 then password = value else warning(key) end
                    elseif key == 'hub.ip' then
                        if ipv4(value) then ip = value else warning(key) end
                    elseif key == 'hub.port' then
                        local number = value:match('^%d+$') and tonumber(value)
                        if number and number >= 1 and number <= 65535 then port = number else warning(key) end
                    elseif key == 'tally.name' then
                        if #value > 0 and not value:find('["\r\n%z]') then name = value:sub(1, 26) else warning(key) end
                    elseif key == 'operator.type' or key == 'stage.type' then
                        local kind = value:lower()
                        if kind == 'grb+' or kind == 'grb-' then
                            if key == 'operator.type' then opType = kind else stageType = kind end
                        else warning(key) end
                    elseif key == 'operator.ws2812' or key == 'stage.ws2812' then
                        local count, order = ws(value)
                        if count then
                            if key == 'operator.ws2812' then opCount, opOrder = count, order or opOrder
                            else stageCount, stageOrder = count, order or stageOrder end
                        else warning(key) end
                    else MyLog.warning('Unknown setting ' .. key) end
                end
            end
        end
        f:close()
    end
else MyLog.warning('tally-settings.ini does not exist. Using defaults.') end
