HudRadar = {}

local layoutKey = 'radar_layout_v1'
local referenceAspect = 16 / 9
local components = {
    { 'minimap',      -0.0045, 0.002, 0.150, 0.188888 },
    { 'minimap_mask',  0.0200, 0.032, 0.111, 0.159000 },
    { 'minimap_blur', -0.0300, 0.022, 0.266, 0.237000 },
}

local gfxWidth = 0.170
local gfxHeight = 0.188888
-- Bounds of the rounded mask inside the radar viewport.
local paintedWidth = 0.160
local paintedHeight = gfxHeight * 0.8575
local paintedLeftInset = 0.0205
local paintedCenterOffset = 0.010
local textureSource = 'platform:/textures/graphics'
local maskDictionary = 'gta6_graphics'
local maskTexture = 'radarmasksm'
local requestingMask = false
local maskInstalled = false
local waypointHudColor = 142 -- HUD_COLOUR_WAYPOINT
local originalWaypointColor
local appliedWaypointColor

local saved
local draft
local editing = false
local lastPlacement
local radarMovie
local radarVisible
local refreshPending
local owned = false

local function clamp(value, min, max)
    return math.max(min, math.min(max, value))
end

local function finite(value)
    return type(value) == 'number' and value == value and math.abs(value) < math.huge
end

local function aspectRatio()
    local width, height = GetActiveScreenResolution()
    return width / math.max(height, 1)
end

local function safeArea()
    SetScriptGfxAlign(string.byte('L'), string.byte('B'))
    local x, bottom = GetScriptGfxPosition(0.0, 0.0)
    ResetScriptGfxAlign()
    return x, bottom
end

local function validate(data)
    if type(data) ~= 'table' or not finite(data.x) or not finite(data.y)
        or not finite(data.scale) then return end

    return {
        x = clamp(data.x, 0.002, 0.998),
        y = clamp(data.y, 0.002, 0.998),
        scale = clamp(data.scale, 0.7, 1.65),
    }
end

do
    local stored = GetResourceKvpString(layoutKey)
    if stored then
        local ok, data = pcall(json.decode, stored)
        if ok then saved = validate(data) end
    end
end

local function refreshRadar()
    if refreshPending then return end
    refreshPending = true
    -- Rebuild the Scaleform bounds after native component changes.
    SetBigmapActive(true, false)
    CreateThread(function()
        Wait(0)
        if refreshPending then
            SetBigmapActive(false, false)
            refreshPending = nil
        end
    end)
end

function HudRadar.apply(force)
    local aspect = aspectRatio()
    local originX, bottom = safeArea()
    local current = saved
    -- A nil draft is the default layout, including during a reset preview.
    if editing then current = draft end
    local scale = current and current.scale or 1.0
    local width = clamp(Config.Radar.width * referenceAspect / aspect * scale, 0.05, 0.90)
    local height = clamp(Config.Radar.height * scale, 0.05, 0.90)
    local x = current and current.x or math.max(originX, 0.010 * referenceAspect / aspect)
    local y = current and current.y or bottom - height - 0.023
    x = clamp(x, 0.002, 0.998 - width)
    y = clamp(y, 0.002, 0.998 - height)

    local key = ('%.6f:%.6f:%.6f:%.6f:%.6f:%.6f'):format(x, y, width, height, originX, bottom)
    if not force and key == lastPlacement then return end
    lastPlacement = key
    owned = true

    -- Keep the native radar layers aligned with the rounded mask and HUD rectangle.
    local baseline = components[1]
    local sx, sy = width / paintedWidth, height / paintedHeight
    local nativeLeft = x - originX - width * paintedLeftInset
    local nativeBottom = y + (height + gfxHeight * sy) / 2 - bottom - height * paintedCenterOffset
    for index, part in ipairs(components) do
        SetMinimapComponentPosition(part[1], 'L', 'B',
            nativeLeft + (part[2] - baseline[2]) * sx,
            nativeBottom + (part[3] - baseline[3]) * sy,
            (index == 1 and gfxWidth or part[4]) * sx,
            part[5] * sy)
    end
    if Config.Radar.zoom then SetRadarZoom(Config.Radar.zoom) end
    if radarVisible then refreshRadar() end

    SendNUIMessage({
        type = 'radar',
        rect = { x = x, y = y, width = width, height = height, scale = scale },
        safe = { x = originX, y = 1.0 - bottom },
        showClock = Config.Radar.showClock,
    })
end

local function loadRadarArt()
    if maskInstalled or requestingMask then return end
    requestingMask = true

    CreateThread(function()
        RequestStreamedTextureDict(maskDictionary, false)
        local deadline = GetGameTimer() + 5000
        while not HasStreamedTextureDictLoaded(maskDictionary) and GetGameTimer() < deadline do
            Wait(25)
        end
        requestingMask = false

        if not HasStreamedTextureDictLoaded(maskDictionary) then
            SetStreamedTextureDictAsNoLongerNeeded(maskDictionary)
            return
        end

        AddReplaceTexture(textureSource, maskTexture, maskDictionary, maskTexture)
        maskInstalled = true
        HudRadar.apply(true)
    end)
end

function HudRadar.isEditing()
    return editing
end

function HudRadar.edit()
    editing = true
    draft = saved
    SetNuiFocus(true, true)
    HudRadar.apply(true)
    HudMap3D.syncMode()
    HudLayout.beginEdit()
    SendNUIMessage({ type = 'editor', open = true })
end

function HudRadar.close(save)
    if not editing then return end
    if save then
        saved = draft
        if saved then
            SetResourceKvp(layoutKey, json.encode(saved))
        else
            DeleteResourceKvp(layoutKey)
        end
    end
    editing = false
    draft = nil
    HudMap3D.closeSettings(save)
    HudLayout.endEdit(save)
    SetNuiFocus(false, false)
    SendNUIMessage({ type = 'editor', open = false })
    HudRadar.apply(true)
end

RegisterNUICallback('radarPreview', function(data, cb)
    local layout = validate(data)
    if editing and layout then
        draft = layout
        HudRadar.apply()
    end
    cb({ ok = editing and layout ~= nil })
end)

RegisterNUICallback('radarReset', function(_, cb)
    if editing then
        draft = nil
        HudMap3D.resetSettings()
        HudLayout.reset()
        HudRadar.apply(true)
    end
    cb({ ok = editing })
end)

RegisterNUICallback('radarDone', function(data, cb)
    HudRadar.close(type(data) == 'table' and data.save == true)
    cb({ ok = true })
end)

local function tintWaypoint(visible)
    local color = visible and HudLayout.getWaypointColor() or nil
    if color == appliedWaypointColor then return end

    if color then
        originalWaypointColor = originalWaypointColor or { GetHudColour(waypointHudColor) }
        ReplaceHudColourWithRgba(waypointHudColor, table.unpack(color))
    elseif originalWaypointColor then
        ReplaceHudColourWithRgba(waypointHudColor, table.unpack(originalWaypointColor))
        originalWaypointColor = nil
    end
    appliedWaypointColor = color
end

function HudRadar.display(visible)
    tintWaypoint(visible)
    if radarVisible == visible then return end
    radarVisible = visible
    DisplayRadar(visible)
    if visible then
        SetMinimapClipType(0)
        loadRadarArt()
        HudRadar.apply(true)
    end
end

function HudRadar.frame()
    if not radarVisible then return end
    if not radarMovie or radarMovie == 0 then
        radarMovie = RequestScaleformMovie('minimap')
    end
    if HasScaleformMovieLoaded(radarMovie) then
        BeginScaleformMovieMethod(radarMovie, 'SETUP_HEALTH_ARMOUR')
        ScaleformMovieMethodAddParamInt(3)
        EndScaleformMovieMethod()

        -- The native radar draws its own destination distance and arrow.
        if BeginScaleformMovieMethod(radarMovie, 'HIDE_SATNAV') then
            EndScaleformMovieMethod()
        end
    end
end

AddEventHandler('onClientResourceStop', function(resource)
    if resource ~= GetCurrentResourceName() then return end
    tintWaypoint(false)
    if editing then SetNuiFocus(false, false) end

    if maskInstalled then
        RemoveReplaceTexture(textureSource, maskTexture)
    end
    if maskInstalled or requestingMask then
        SetStreamedTextureDictAsNoLongerNeeded(maskDictionary)
    end
    if not owned then return end

    refreshPending = nil
    SetBigmapActive(false, false)
    for _, part in ipairs(components) do
        SetMinimapComponentPosition(part[1], 'L', 'B', part[2], part[3], part[4], part[5])
    end
    if radarMovie and HasScaleformMovieLoaded(radarMovie) then
        BeginScaleformMovieMethod(radarMovie, 'SETUP_HEALTH_ARMOUR')
        ScaleformMovieMethodAddParamInt(0)
        EndScaleformMovieMethod()
        if GetGpsBlipRouteFound() and BeginScaleformMovieMethod(radarMovie, 'SHOW_SATNAV') then
            EndScaleformMovieMethod()
        end
        SetScaleformMovieAsNoLongerNeeded(radarMovie)
    end
    SetMinimapClipType(0)
    SetRadarZoom(0)
    DisplayRadar(true)
end)
