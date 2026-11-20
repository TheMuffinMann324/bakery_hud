HudNavigation = {}

local turns = {
    [3] = 'left',
    [4] = 'right',
    [6] = 'sharp-left',
    [7] = 'sharp-right',
}

local destination
local roadTarget
local lastBlip
local nextRead = 0
local lastTurn
local lastTurnAt = 0
local missionBlip
local scanningMission = false
local nextMissionScan = 0

function HudNavigation.getWaypointBlip()
    if not IsWaypointActive() then return end
    local blip = GetFirstBlipInfoId(8)
    if DoesBlipExist(blip) then return blip end
end

local function findMissionBlip()
    local waypoint = HudNavigation.getWaypointBlip()
    -- The native iterator filters by sprite, and jobs can use any blip sprite.
    for sprite = 0, 1000 do
        local blip = GetFirstBlipInfoId(sprite)
        while DoesBlipExist(blip) do
            if blip ~= waypoint and DoesBlipHaveGpsRoute(blip) then return blip end
            blip = GetNextBlipInfoId(sprite)
        end
        if sprite % 125 == 124 then Wait(0) end
    end
end

function HudNavigation.getMissionBlip()
    if missionBlip and DoesBlipExist(missionBlip) and DoesBlipHaveGpsRoute(missionBlip) then
        return missionBlip
    end
    missionBlip = nil
    if scanningMission or GetGameTimer() < nextMissionScan or not GetGpsBlipRouteFound() then return end

    scanningMission = true
    CreateThread(function()
        missionBlip = findMissionBlip()
        nextMissionScan = GetGameTimer() + 400
        scanningMission = false
    end)
end

local function clearTarget()
    destination = nil
    roadTarget = nil
    lastBlip = nil
    lastTurn = nil
    nextRead = 0
end

function HudNavigation.read(ped, showMap)
    if not Config.Navigation.enabled or not showMap
        or (Config.Navigation.vehicleOnly and not IsPedInAnyVehicle(ped, false)) then
        clearTarget()
        return
    end

    local blip = HudNavigation.getWaypointBlip() or HudNavigation.getMissionBlip()
    if not blip then
        clearTarget()
        return
    end

    if blip ~= lastBlip then
        clearTarget()
        lastBlip = blip
    end
    local now = GetGameTimer()
    if now < nextRead then return lastTurn end
    nextRead = now + 200

    local coords = GetBlipInfoIdCoord(blip)
    if not destination or coords.x ~= destination.x or coords.y ~= destination.y or coords.z ~= destination.z then
        destination = coords
        local found, node = GetClosestVehicleNode(coords.x, coords.y, coords.z, 1, 3.0, 0)
        roadTarget = found and node or coords
        lastTurn = nil
    end

    local _, direction, _, junction = GenerateDirectionsToCoord(roadTarget.x, roadTarget.y, roadTarget.z, true)
    if direction == 0 then
        Wait(0)
        _, direction, _, junction = GenerateDirectionsToCoord(roadTarget.x, roadTarget.y, roadTarget.z, true)
    end
    -- The pathfinder can briefly return 0 while updating the next instruction.
    if direction == 0 and now - lastTurnAt <= 300 then return lastTurn end

    local turn = turns[direction]
    local metres = junction and junction * 0.1 or 0
    if not turn or metres <= 0 or metres > Config.Navigation.showWithinMeters then
        lastTurn = nil
        return
    end

    lastTurn = {
        direction = turn,
        metres = math.floor(metres + 0.5),
    }
    lastTurnAt = now
    return lastTurn
end
