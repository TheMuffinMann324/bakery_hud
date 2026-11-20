local ready = false
local player = { loaded = false }
local objective
local objectiveOwner
local lastFrame
local statusBars = HudLayout.getStatusBars()

local function health(ped)
    local max = GetEntityMaxHealth(ped) - 100
    if max <= 0 or IsEntityDead(ped) then return 0 end
    return (GetEntityHealth(ped) - 100) * 100 / max
end

local stats = {
    health = health,
    armor = function(ped) return GetPedArmour(ped) end,
    stamina = function() return 100 - GetPlayerSprintStaminaRemaining(PlayerId()) end,
    oxygen = function() return GetPlayerUnderwaterTimeRemaining(PlayerId()) * 10 end,
}

local function statValue(name, ped)
    local getter = stats[name]
    local value = getter and getter(ped) or player[name]
    if type(value) ~= 'number' then return end
    return math.floor(math.max(0, math.min(100, value)) + 0.5)
end

local function clearObjective()
    objective = nil
    objectiveOwner = nil
end

exports('SetObjective', function(text, highlight, durationMs)
    if type(text) ~= 'string' or text == '' then
        clearObjective()
        return
    end
    objectiveOwner = GetInvokingResource()
    objective = {
        text = text,
        highlight = type(highlight) == 'string' and highlight or nil,
        expires = type(durationMs) == 'number' and durationMs > 0 and GetGameTimer() + durationMs or nil,
    }
end)

exports('ClearObjective', clearObjective)

AddEventHandler('onClientResourceStop', function(name)
    if name == objectiveOwner then clearObjective() end
end)

RegisterNUICallback('ready', function(_, cb)
    ready = true
    lastFrame = nil
    SendNUIMessage({
        type = 'config',
        statusBars = statusBars,
        currency = Config.Currency,
        navigationUnits = Config.Navigation.units,
        navigationEnabled = Config.Navigation.enabled,
        waypointChoices = HudLayout.getWaypointChoices(),
        moneyEnabled = Config.ShowMoney,
        vehicleEnabled = Config.Vehicle.enabled,
        map3dEnabled = Config.Map3D.enabled,
    })
    HudRadar.apply(true)
    HudMap3D.syncMode()
    HudLayout.send()
    SendNUIMessage({ type = 'editor', open = HudRadar.isEditing() })
    cb({ ok = true })
end)

local function canShow()
    return ready and player.loaded and not IsPauseMenuActive()
        and not IsScreenFadedOut() and not IsHudHidden() and not IsCinematicCamRendering()
end

RegisterCommand(Config.Commands.edit, function()
    if HudRadar.isEditing() then
        HudRadar.close(false)
    elseif ready and player.loaded and not IsPauseMenuActive() then
        HudRadar.edit()
    end
end, false)

CreateThread(function()
    while true do
        local wasLoaded = player.loaded
        player = HudFramework.read()
        if wasLoaded and not player.loaded then clearObjective() end
        if ready then HudRadar.apply() end
        Wait(500)
    end
end)

CreateThread(function()
    while true do
        if HudRadar.isEditing() and (IsPauseMenuActive() or not player.loaded) then
            HudRadar.close(false)
        end

        local editing = HudRadar.isEditing()
        local visible = editing or (canShow() and not HudLayout.get('cinematic'))
        local ped = PlayerPedId()
        local wantsMap = visible and (editing or HudLayout.get('mapOnFoot')
            or IsPedInAnyVehicle(ped, false))
        local drawnMap = HudMap3D.update(ped, wantsMap)
        if ready then HudRadar.display(wantsMap and not drawnMap) end
        local showMap = wantsMap and (drawnMap or not IsRadarHidden())
        local turn = HudNavigation.read(ped, showMap and HudLayout.get('turnPrompts'))
        local vehicle = HudVehicle.read(ready and player.loaded)

        if objective and objective.expires and GetGameTimer() >= objective.expires then
            clearObjective()
        end

        if ready then
            local frame = { type = 'frame', visible = visible, showMap = showMap, map3d = drawnMap }
            if visible then
                frame.bars = {}
                local underwater = IsPedSwimmingUnderWater(ped) and not IsEntityDead(ped)
                for _, bar in ipairs(statusBars) do
                    if bar.name ~= 'oxygen' or underwater then
                        frame.bars[bar.name] = statValue(bar.name, ped)
                    end
                end

                local moneyMode = HudLayout.get('moneyMode')
                if Config.ShowMoney and (editing or moneyMode == 'always' or (moneyMode == 'hold'
                    and not IsNuiFocused() and IsRawKeyDown(HudLayout.get('moneyKey')))) then
                    frame.cash = player.cash
                    frame.bank = player.bank
                end
                if showMap then
                    local hour = GetClockHours()
                    local minute = GetClockMinutes()
                    frame.clock = ('%d:%02d %s'):format((hour + 11) % 12 + 1, minute, hour < 12 and 'am' or 'pm')
                end
                frame.turn = turn
                if HudLayout.get('vehicleCard') then frame.vehicle = vehicle end
                frame.objective = objective
            end
            local encoded = json.encode(frame)
            if encoded ~= lastFrame then
                lastFrame = encoded
                SendNUIMessage(frame)
            end
        end
        Wait(100)
    end
end)

CreateThread(function()
    while true do
        if ready and player.loaded and HudLayout.get('cinematic') and not HudRadar.isEditing()
            and not IsPauseMenuActive() then
            HideHudAndRadarThisFrame()
            Wait(0)
        elseif canShow() or HudRadar.isEditing() then
            -- Keep native text, wanted stars, and weapon indicators on their own channels.
            HideHudComponentThisFrame(3)
            HideHudComponentThisFrame(4)
            HideHudComponentThisFrame(13)
            HudRadar.frame()
            if not HudRadar.isEditing() then HudVehicle.handleInput() end
            Wait(0)
        else
            Wait(150)
        end
    end
end)
