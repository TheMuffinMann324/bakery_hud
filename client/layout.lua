HudLayout = {}

-- Per-player display and placement preferences. Radar placement is stored separately.
local key = 'hud_layout_v1'
local elements = { vitals = true, money = true }
local statusNames = { 'health', 'stamina', 'armor', 'hunger', 'thirst', 'stress', 'oxygen' }
local statusBars, validStatus, addedStatus = {}, {}, {}
for _, name in ipairs(statusNames) do validStatus[name] = true end
for _, name in ipairs(Config.Bars) do
    if validStatus[name] and not addedStatus[name] then
        statusBars[#statusBars + 1] = { name = name, enabled = true }
        addedStatus[name] = true
    end
end
for _, name in ipairs(statusNames) do
    if not addedStatus[name] then statusBars[#statusBars + 1] = { name = name, enabled = name == 'oxygen' } end
end
local waypointChoices = {
    { id = 'pink', label = 'Pink', rgba = { 247, 115, 164, 255 } },
    { id = 'teal', label = 'Teal', rgba = { 90, 227, 204, 255 } },
    { id = 'violet', label = 'Violet', rgba = { 166, 133, 252, 255 } },
    { id = 'blue', label = 'Blue', rgba = { 98, 183, 255, 255 } },
    { id = 'amber', label = 'Amber', rgba = { 255, 193, 102, 255 } },
    { id = 'stock', label = 'GTA Default' },
}

local function defaultWaypointChoice()
    local color = Config.Navigation.waypointColor
    if color == false then return 'stock' end
    if type(color) ~= 'table' then return 'pink' end

    for _, choice in ipairs(waypointChoices) do
        local rgba = choice.rgba
        if rgba and rgba[1] == color[1] and rgba[2] == color[2] and rgba[3] == color[3]
            and rgba[4] == (color[4] or 255) then return choice.id end
    end

    waypointChoices[#waypointChoices + 1] = {
        id = 'server', label = 'Server Default', rgba = { color[1], color[2], color[3], color[4] or 255 },
    }
    return 'server'
end

local function validKey(value)
    -- Windows virtual keys for 0–9, A–Z, and F1–F12 (F8 opens the FiveM console).
    return type(value) == 'number' and value % 1 == 0 and ((value >= 0x30 and value <= 0x39)
        or (value >= 0x41 and value <= 0x5A) or (value >= 0x70 and value <= 0x7B and value ~= 0x77))
end

local function configuredVehicleKey()
    if type(Config.Vehicle.key) == 'string' then
        local name = Config.Vehicle.key:upper()
        if name:match('^[A-Z0-9]$') then return name:byte() end
        local number = tonumber(name:match('^F(%d+)$'))
        if number and validKey(0x6F + number) then return 0x6F + number end
    end
    return 0x76 -- F7
end

local defaults = {
    clock = Config.Radar.showClock == true,
    mapOnFoot = not Config.Radar.vehicleOnly,
    cinematic = false,
    moneyMode = 'always',
    moneyKey = 0x79, -- F10
    turnPrompts = true,
    waypointColor = defaultWaypointChoice(),
    vehicleCard = true,
    vehicleKey = configuredVehicleKey(),
}
local waypointChoicesById = {}
for _, choice in ipairs(waypointChoices) do waypointChoicesById[choice.id] = choice end
local saved = {}
local draft

local function number(value, min, max)
    if type(value) ~= 'number' or value ~= value then return end
    return math.max(min, math.min(max, value))
end

local function cleanElement(name, data)
    if type(data) ~= 'table' then return end
    local element = {
        x = number(data.x, 0.0, 0.99),
        y = number(data.y, 0.0, 0.99),
        scale = number(data.scale, 0.6, 1.6),
    }
    if name == 'vitals' and data.visible == false then element.visible = false end
    if name == 'status' and type(data.visible) == 'boolean' then element.visible = data.visible end
    if element.x == nil or element.y == nil then element.x, element.y = nil, nil end
    if next(element) then return element end
end

local function validOption(name, value)
    if name == 'moneyMode' then return value == 'always' or value == 'hold' or value == 'off' end
    if name == 'moneyKey' or name == 'vehicleKey' then return validKey(value) end
    if name == 'waypointColor' then return type(value) == 'string' and waypointChoicesById[value] ~= nil end
    return type(defaults[name]) == 'boolean' and type(value) == 'boolean'
end

local function clean(data)
    local layout = {}
    if type(data) ~= 'table' then return layout end
    for name in pairs(elements) do layout[name] = cleanElement(name, data[name]) end
    if type(data.status) == 'table' then
        local status = {}
        for _, name in ipairs(statusNames) do status[name] = cleanElement('status', data.status[name]) end
        if next(status) then layout.status = status end
    end
    for name in pairs(defaults) do
        if validOption(name, data[name]) then layout[name] = data[name] end
    end
    if layout.moneyMode == nil and type(data.money) == 'table' and data.money.visible == false then
        layout.moneyMode = 'off'
    end
    return layout
end

local function copy(layout)
    return json.decode(json.encode(layout)) or {}
end

do
    local ok, data = pcall(json.decode, GetResourceKvpString(key) or '')
    if ok then saved = clean(data) end
end

function HudLayout.get(name)
    local value = (draft or saved)[name]
    if value == nil then return defaults[name] end
    return value
end

function HudLayout.getWaypointChoices()
    return waypointChoices
end

function HudLayout.getStatusBars()
    return statusBars
end

function HudLayout.getWaypointColor()
    return waypointChoicesById[HudLayout.get('waypointColor')].rgba
end

function HudLayout.send()
    local current = draft or saved
    local layout = { vitals = current.vitals, money = current.money, status = current.status }
    for name in pairs(defaults) do layout[name] = HudLayout.get(name) end
    SendNUIMessage({ type = 'hudLayout', layout = layout })
end

local function persist()
    if next(saved) then SetResourceKvp(key, json.encode(saved)) else DeleteResourceKvp(key) end
end

function HudLayout.beginEdit()
    draft = copy(saved)
    HudLayout.send()
end

function HudLayout.endEdit(save)
    if save and draft then
        saved = clean(draft)
        persist()
    end
    draft = nil
    HudLayout.send()
end

function HudLayout.reset()
    if not draft then return end
    draft = {}
    HudLayout.send()
end

RegisterNUICallback('hudPreview', function(data, cb)
    local accepted = draft ~= nil and type(data) == 'table'
    if accepted and elements[data.element] then
        draft[data.element] = cleanElement(data.element, data.layout)
    elseif accepted and validOption(data.element, data.value) then
        draft[data.element] = data.value
    else
        accepted = false
    end
    if accepted then HudLayout.send() end
    cb({ ok = accepted })
end)

RegisterNUICallback('statusPreview', function(data, cb)
    if not draft or type(data) ~= 'table' or not validStatus[data.name] then
        cb({ ok = false })
        return
    end

    draft.status = draft.status or {}
    local current = draft.status[data.name] or {}
    if data.field == 'position' then
        current.x, current.y = data.x, data.y
    elseif data.field == 'scale' and type(data.value) == 'number' then
        current.scale = data.value
    elseif data.field == 'visible' and type(data.value) == 'boolean' then
        current.visible = data.value
    else
        cb({ ok = false })
        return
    end

    draft.status[data.name] = cleanElement('status', current)
    HudLayout.send()
    cb({ ok = true })
end)
