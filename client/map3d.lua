HudMap3D = {}

local config = Config.Map3D
local key = 'radar_renderer_v1'
local available = config.enabled
local savedMode = GetResourceKvpString(key)
-- Older versions stored the 2D preference as 'atlas'.
local selected = available and savedMode ~= '2d' and savedMode ~= 'atlas'
local draft
local listening = false
local ready = false
local drawing = false
local movingBlips = {}
local waypointHudColor = 142 -- HUD_COLOUR_WAYPOINT
local objectiveHudColor = 156 -- HUD_COLOUR_OBJECTIVE_ROUTE

local function publish(action, values)
    values.action = action
    SendNUIMessage(values)
end

local function selectedMode()
    if draft ~= nil then return draft end
    return selected
end

local function loadWorld()
    if not selectedMode() or not listening or ready then return end
    publish('map3d', {
        load = true,
        config = {
            view = {
                zoom = config.zoom, lift = config.buildingHeight, liftCap = 2000.0,
                tall = config.tallBuilding, anchor = 0.73, far = 0.34, shadowMax = 20.0,
                opacity = 0.86, roadOpacity = 0.92, frameAlpha = 0.34,
                haze = { to = 0.4, most = 0.18 },
            },
            -- Green land, pale roads and light-grey buildings with slate walls.
            paint = {
                land = { 78, 116, 96 }, sand = { 156, 152, 124 }, water = { 70, 118, 138 },
                road = { 146, 143, 149 }, lot = { 120, 138, 126 }, rail = { 104, 112, 106 },
                footprint = { 112, 124, 116 }, lane = { 236, 236, 240, 0.32 },
                roofLow = { 176, 178, 184 }, roof = { 232, 233, 238 }, wall = { 118, 122, 134 },
                haze = { 150, 168, 160 },
            },
            paintNight = {
                land = { 34, 54, 48 }, sand = { 64, 66, 58 }, water = { 22, 40, 56 },
                roofLow = { 92, 100, 124 }, roof = { 146, 156, 184 }, wall = { 50, 56, 76 },
                lane = { 150, 160, 180, 0.3 }, haze = { 48, 62, 64 },
            },
        },
    })
end

function HudMap3D.syncMode()
    SendNUIMessage({ type = 'mapMode', enabled = selectedMode() })
end

local function saveMode(enabled)
    if selected == enabled then return end
    selected = enabled
    SetResourceKvp(key, enabled and '3d' or '2d')
end

function HudMap3D.closeSettings(save)
    if save and draft ~= nil then saveMode(draft) end
    draft = nil
    loadWorld()
    HudMap3D.syncMode()
end

local function previewMode(enabled)
    draft = enabled
    loadWorld()
    HudMap3D.syncMode()
end

function HudMap3D.resetSettings()
    if available then previewMode(true) end
end

RegisterNUICallback('radarMode', function(data, cb)
    local accepted = available and HudRadar.isEditing()
        and type(data) == 'table' and type(data.enabled) == 'boolean'
    if accepted then previewMode(data.enabled) end
    cb({ ok = accepted == true })
end)

RegisterNUICallback('map3dHello', function(_, cb)
    listening = true
    ready = false
    loadWorld()
    cb({ ok = true })
end)

RegisterNUICallback('map3dReady', function(data, cb)
    data = type(data) == 'table' and data or {}
    -- Without a working renderer the native radar stays in its place.
    ready = data.ok == true
    cb({ ok = true })
end)

local function covered(ped)
    if GetInteriorFromEntity(ped) ~= 0 then return false end
    local location = GetEntityCoords(ped)
    -- The renderer's survey covers the mainland. Keep native radar on other islands.
    return location.x >= -3325 and location.x <= 4099
        and location.y >= -3532 and location.y <= 7221
end

function HudMap3D.update(ped, visible)
    local wants3D = visible and selectedMode() and ready and covered(ped) or false
    if wants3D ~= drawing then
        drawing = wants3D
        publish('map3d', { show = drawing })
    end
    return drawing
end

if not available then return end

-- The nearest street's height, looked up again only after the player has
-- moved STREET_STEP metres: the road search is too costly for every update.
local STREET_STEP = 2.0
local streetAt, streetZ

local function readPosition(ped)
    local vehicle = GetVehiclePedIsIn(ped, false)
    local entity = vehicle == 0 and ped or vehicle
    local position = GetEntityCoords(entity)
    local vehicleClass = vehicle ~= 0 and GetVehicleClass(vehicle)
    local height = math.max(0.0, GetEntityHeightAboveGround(entity) - 1.0)
    -- Height above the nearest street, so a canopy or awning overhead is not
    -- mistaken for a roof the player is standing on.
    if not streetAt or #(position - streetAt) > STREET_STEP then
        local found, street = GetClosestVehicleNode(position.x, position.y, position.z, 1, 3.0, 0)
        streetAt, streetZ = position, found and street.z or nil
    end
    local aboveStreet = streetZ and math.floor(math.max(0.0, position.z - streetZ - 1.0) * 2 + 0.5) / 2 or nil
    return {
        x = math.floor(position.x * 20 + 0.5) / 20,
        y = math.floor(position.y * 20 + 0.5) / 20,
        c = math.floor(GetFinalRenderedCamRot(2).z * 5 + 0.5) / 5,
        h = math.floor(GetEntityHeading(entity) * 2 + 0.5) / 2,
        s = vehicle ~= 0 and math.floor(GetEntitySpeed(vehicle) * 2 + 0.5) / 2 or 0,
        v = vehicle ~= 0,
        g = math.floor(height * 2 + 0.5) / 2,
        air = (vehicleClass == 15 or vehicleClass == 16) and math.floor(height) or 0,
        a = aboveStreet,
    }
end

CreateThread(function()
    local last
    while true do
        if drawing then
            local frame = readPosition(PlayerPedId())
            local signature = json.encode(frame)
            if signature ~= last then
                last = signature
                publish('map3dPos', frame)
            end
            Wait(32)
        else
            last = nil
            Wait(120)
        end
    end
end)

local function routeSegments(slot, color, routes)
    local points, last, distance = {}, nil, 0.0
    while distance <= 460.0 do
        local found, position = GetPosAlongGpsTypeRoute(true, distance, slot)
        if not found or not position then break end
        distance = distance + (distance < 90.0 and 3.0 or 7.0)
        local separation = last and ((position.x - last.x) ^ 2 + (position.y - last.y) ^ 2)
        if separation and separation > 1600 then
            if #points >= 4 then routes[#routes + 1] = { pts = points, rgb = color } end
            points = {}
        end
        if not separation or separation > 0.25 then
            points[#points + 1] = position.x
            points[#points + 1] = position.y
        end
        last = position
    end
    if #points >= 4 then routes[#routes + 1] = { pts = points, rgb = color } end
end

local function hudRgb(index)
    local red, green, blue = GetHudColour(index)
    return { red, green, blue }
end

CreateThread(function()
    local activeRoute = false
    local lastNight
    while true do
        if drawing then
            local routes, waypoint, tint = {}, nil, nil
            local handle = HudNavigation.getWaypointBlip()
            if handle then
                local custom = HudLayout.getWaypointColor()
                if custom then tint = { custom[1], custom[2], custom[3] } end
                local color = tint or hudRgb(waypointHudColor)
                local point = GetBlipInfoIdCoord(handle)
                waypoint = { point.x, point.y, 8, color[1], color[2], color[3], 255, 1, handle }
                routeSegments(0, color, routes)
            end
            if HudNavigation.getMissionBlip() then routeSegments(1, hudRgb(objectiveHudColor), routes) end
            local hasRoute = waypoint ~= nil or #routes > 0
            if hasRoute or activeRoute then
                publish('map3dRoute', { routes = routes, waypoint = waypoint, waypointTint = tint })
            end
            activeRoute = hasRoute

            local time = GetClockHours() + GetClockMinutes() / 60.0
            local night = math.min(1, math.max(0, (7.0 - time) / 2.0, (time - 19.0) / 2.0))
            if night ~= lastNight then
                lastNight = night
                publish('map3d', { night = night })
            end
        end
        Wait(400)
    end
end)

local invisibleDisplay = { [0] = true, [1] = true, [3] = true, [7] = true }

local function visibleBlip(blip)
    local alpha = GetBlipAlpha(blip)
    if alpha > 0 and not invisibleDisplay[GetBlipInfoIdDisplay(blip)] then return alpha end
end

local function blipData(blip, alpha, kind)
    local position = GetBlipInfoIdCoord(blip)
    local colour = GetBlipColour(blip)
    local red, green, blue
    if colour < 0 or colour > 255 then
        red, green, blue = (colour >> 24) & 255, (colour >> 16) & 255, (colour >> 8) & 255
    else
        red, green, blue = GetHudColour(GetBlipHudColour(blip))
    end
    local flags = IsBlipShortRange(blip) and 0 or 1
    if kind == 1 then flags = flags | 2 end
    return {
        position.x, position.y, GetBlipSprite(blip), red or 255, green or 255, blue or 255,
        alpha, flags, blip,
    }
end

local function scanBlips()
    local static, moving, seen = {}, {}, {}
    local mine = GetMainPlayerBlipId()
    local north = GetNorthRadarBlip()
    local waypoint = HudNavigation.getWaypointBlip()
    -- FiveM's iterator filters by sprite. Include low sprite IDs (including area
    -- markers) and exclude the handles that the renderer draws itself.
    for sprite = 0, 1000 do
        local blip = GetFirstBlipInfoId(sprite)
        while DoesBlipExist(blip) do
            if not seen[blip] and blip ~= mine and blip ~= north and blip ~= waypoint then
                seen[blip] = true
                local alpha = visibleBlip(blip)
                if alpha then
                    local kind = GetBlipInfoIdType(blip)
                    if kind >= 1 and kind <= 3 then
                        moving[blip] = kind
                    else
                        static[#static + 1] = blipData(blip, alpha, kind)
                    end
                end
            end
            blip = GetNextBlipInfoId(sprite)
        end
        if sprite % 125 == 124 then
            Wait(0)
            if not drawing then return end
        end
    end
    movingBlips = moving
    publish('map3dBlips', { list = static })
end

CreateThread(function()
    while true do
        if drawing then scanBlips() end
        Wait(drawing and 1800 or 180)
    end
end)

CreateThread(function()
    local hadMoving = false
    while true do
        if drawing then
            local current = {}
            for blip, kind in pairs(movingBlips) do
                local alpha = DoesBlipExist(blip) and visibleBlip(blip)
                if alpha then current[#current + 1] = blipData(blip, alpha, kind) end
            end
            if #current > 0 or hadMoving then publish('map3dMoving', { list = current }) end
            hadMoving = #current > 0
        end
        Wait(250)
    end
end)

-- The renderer's survey heights are rough (many towers sit at a flat 60 m),
-- so every building of any size is measured here once the player is close
-- enough for its collision to be loaded: rays are dropped onto several points
-- of its highest roof and the nearest street is taken as the ground. Results are
-- kept per client, so each building is measured only once.
local heightsKey = 'map3d_heights_v3'
local measured = {}
local unmeasured = {}

do
    local ok, data = pcall(json.decode, GetResourceKvpString(heightsKey) or '')
    if ok and type(data) == 'table' then
        for id, metres in pairs(data) do
            local numericId = math.tointeger(id)
            if numericId and type(metres) == 'number' then
                -- String keys keep sparse building IDs in a JSON object.
                measured[tostring(numericId)] = metres
            end
        end
    end
end

RegisterNUICallback('map3dMeasure', function(data, cb)
    unmeasured = {}
    local known = {}
    for _, entry in ipairs(type(data) == 'table' and type(data.list) == 'table' and data.list or {}) do
        local id, points = math.tointeger(entry[1]), {}
        for index = 3, #entry - 1, 2 do
            local x, y = tonumber(entry[index]), tonumber(entry[index + 1])
            if x and y then points[#points + 1] = vector2(x, y) end
        end
        if id and #points > 0 then
            local height = measured[tostring(id)]
            if height then known[#known + 1] = { id, height }
            else
                unmeasured[#unmeasured + 1] = { id = id, x = points[1].x, y = points[1].y, points = points }
            end
        end
    end
    if #known > 0 then publish('map3dHeights', { list = known }) end
    cb({ ok = true })
end)

-- The roof's height above the street at each point, and the middle answer
-- of those, so a ray that clips a taller neighbour or misses into a light
-- well cannot decide it on its own.
local function measure(tower, groundZ)
    local found, street = GetClosestVehicleNode(tower.x, tower.y, groundZ, 1, 3.0, 0)
    local ground = found and street.z or groundZ
    local heights = {}
    for _, point in ipairs(tower.points) do
        local probe = StartExpensiveSynchronousShapeTestLosProbe(point.x, point.y, 1200.0, point.x, point.y, -100.0, 1, 0, 7)
        local _, hit, roof = GetShapeTestResult(probe)
        if hit == 1 or hit == true then heights[#heights + 1] = roof.z - ground end
    end
    if #heights == 0 then return end
    table.sort(heights)
    return heights[math.floor((#heights + 1) / 2)]
end

CreateThread(function()
    -- Close enough that a building's collision is streamed in.
    local reach = 200.0
    -- New heights are written to storage at most this often.
    local saveEvery, unsaved, savedAt = 5000, false, 0
    while true do
        if drawing and #unmeasured > 0 then
            local here = GetEntityCoords(PlayerPedId())
            local done, probes = {}, 0
            for index = #unmeasured, 1, -1 do
                local tower = unmeasured[index]
                if probes < 8 and (tower.x - here.x) ^ 2 + (tower.y - here.y) ^ 2 < reach * reach then
                    probes = probes + 1
                    local metres = measure(tower, here.z)
                    -- A ray that only found the street means the building's
                    -- collision is not loaded yet; it is tried again later.
                    if metres and metres > 3.0 and metres < 1000.0 then
                        local height = math.floor(metres + 0.5)
                        measured[tostring(tower.id)] = height
                        done[#done + 1] = { tower.id, height }
                        table.remove(unmeasured, index)
                    end
                end
            end
            if #done > 0 then
                publish('map3dHeights', { list = done })
                unsaved = true
            end
        end
        if unsaved and GetGameTimer() - savedAt >= saveEvery then
            SetResourceKvp(heightsKey, json.encode(measured))
            unsaved, savedAt = false, GetGameTimer()
        end
        Wait(250)
    end
end)
