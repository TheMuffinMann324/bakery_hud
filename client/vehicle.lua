HudVehicle = {}

local config = Config.Vehicle
local emblemDictionary = 'mpcarhud'
local current
local legacySeatbelt
local emblemsRequested = false

local function occupiedVehicle()
    local vehicle = GetVehiclePedIsIn(PlayerPedId(), false)
    if vehicle == 0 then return end
    local class = GetVehicleClass(vehicle)
    if class ~= 13 and class ~= 21 then return vehicle end
end

local function localized(key)
    if not key or key == '' or key == 'NULL' or key == 'CARNOTFOUND' then return end
    local label = GetLabelText(key)
    return label and label ~= 'NULL' and label ~= '' and label or key
end

local function forVehicle(vehicle)
    if not current or current.vehicle ~= vehicle then
        local model = GetEntityModel(vehicle)
        local makeKey = GetMakeNameFromVehicleModel(model)
        local make = localized(makeKey)
        current = {
            vehicle = vehicle,
            make = make,
            emblem = make and makeKey:match('^[%w_]+$') and makeKey:lower() or nil,
            name = localized(GetDisplayNameFromVehicleModel(model)) or 'Vehicle',
            -- Pop up on getting in.
            visibleUntil = GetGameTimer() + config.holdMs,
            lowFuel = false,
            engineLow = false,
        }
        if legacySeatbelt and legacySeatbelt.vehicle ~= vehicle then legacySeatbelt = nil end
    end
    return current
end

local function percent(value)
    return math.floor(math.max(0, math.min(100, value)) + 0.5)
end

local function fuelLevel(vehicle)
    local fuel = Entity(vehicle).state.fuel
    if type(fuel) == 'number' then return fuel end
    return GetVehicleFuelLevel(vehicle)
end

local function beltState(vehicle)
    local state = LocalPlayer.state
    if state.harness == true then return true end
    if type(state.seatbelt) == 'boolean' then return state.seatbelt end
    if legacySeatbelt and legacySeatbelt.vehicle == vehicle then return legacySeatbelt.on end
end

AddEventHandler('seatbelt:client:ToggleSeatbelt', function(on)
    local vehicle = occupiedVehicle()
    if vehicle and type(on) == 'boolean' then
        legacySeatbelt = { vehicle = vehicle, on = on }
    end
end)

AddEventHandler('onClientResourceStop', function(resource)
    if emblemsRequested and resource == GetCurrentResourceName() then
        SetStreamedTextureDictAsNoLongerNeeded(emblemDictionary)
    end
end)

function HudVehicle.read(loaded)
    local vehicle = config.enabled and loaded and occupiedVehicle()
    if not vehicle then
        current = nil
        legacySeatbelt = nil
        return
    end

    local entry = forVehicle(vehicle)
    local engine = GetVehicleEngineHealth(vehicle)
    local body = GetVehicleBodyHealth(vehicle)
    local fuel = fuelLevel(vehicle)
    local now = GetGameTimer()

    -- Only a major hit counts: a big loss of body or engine health in one
    -- read. Scrapes and slow wear are ignored.
    local crashed = entry.engine and (entry.engine - engine >= config.crashDamage
        or entry.body - body >= config.crashDamage)
    entry.engine, entry.body = engine, body

    local enginePercent = percent(engine / 10)
    local engineFailing = not entry.engineLow and enginePercent <= config.engineWarning
    if engineFailing then entry.engineLow = true end
    if enginePercent > config.engineWarning + 5 then entry.engineLow = false end

    local becameLow = not entry.lowFuel and fuel <= config.lowFuel
    if becameLow then entry.lowFuel = true end
    if fuel > config.lowFuel + 3 then entry.lowFuel = false end
    if crashed or engineFailing or becameLow then entry.visibleUntil = now + config.holdMs end

    if not entry.pinned and now >= entry.visibleUntil then return end
    if entry.emblem and not emblemsRequested then
        RequestStreamedTextureDict(emblemDictionary, false)
        emblemsRequested = true
    end
    return {
        make = entry.make,
        emblem = entry.emblem and HasStreamedTextureDictLoaded(emblemDictionary) and entry.emblem or nil,
        name = entry.name,
        engine = enginePercent,
        lowEngine = enginePercent <= config.engineWarning,
        fuel = percent(fuel),
        lowFuel = entry.lowFuel,
        buckled = beltState(vehicle),
    }
end

function HudVehicle.handleInput()
    if not config.enabled or not HudLayout.get('vehicleCard') or IsNuiFocused()
        or not IsRawKeyPressed(HudLayout.get('vehicleKey')) then return end

    local vehicle = occupiedVehicle()
    if not vehicle then return end
    local entry = forVehicle(vehicle)
    entry.pinned = not entry.pinned
    if not entry.pinned then entry.visibleUntil = 0 end
end
