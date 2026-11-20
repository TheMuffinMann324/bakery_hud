HudFramework = {}

local frameworks = {
    { name = 'qbox', resource = 'qbx_core' },
    { name = 'qbcore', resource = 'qb-core' },
    { name = 'esx', resource = 'es_extended' },
}

local active
local core

local function detectFramework()
    for _, entry in ipairs(frameworks) do
        if (Config.Framework == 'auto' or Config.Framework == entry.name)
            and GetResourceState(entry.resource) == 'started' then
            return entry
        end
    end
end

local function getPlayerData()
    if active.name == 'qbox' then
        return exports.qbx_core:GetPlayerData()
    end

    if active.name == 'qbcore' then
        core = core or exports['qb-core']:GetCoreObject({ 'Functions' })
        return core.Functions.GetPlayerData()
    end

    core = core or exports.es_extended:getSharedObject()
    if core.IsPlayerLoaded() then
        return core.GetPlayerData()
    end
end

local function getAccount(accounts, name)
    for _, account in pairs(accounts or {}) do
        if account.name == name then
            return account.money
        end
    end
end

local statusNames = { 'hunger', 'thirst', 'stress' }
local function getStatus(name)
    local value
    TriggerEvent('esx_status:getStatus', name, function(status)
        value = status.getPercent()
    end)
    return value
end

function HudFramework.read()
    local detected = detectFramework()
    if active ~= detected then
        active = detected
        core = nil
    end

    if not active then
        return { loaded = Config.Framework == 'auto' or Config.Framework == 'standalone' }
    end

    local ok, data = pcall(getPlayerData)
    if not ok then
        core = nil
        return { loaded = false }
    end

    if type(data) ~= 'table' then return { loaded = false } end

    if active.name == 'esx' then
        local player = {
            loaded = true,
            cash = getAccount(data.accounts, Config.ESX.CashAccount),
            bank = getAccount(data.accounts, Config.ESX.BankAccount),
        }
        if GetResourceState('esx_status') == 'started' then
            for _, name in ipairs(statusNames) do player[name] = getStatus(name) end
        end
        return player
    end

    local money = data.money or {}
    local metadata = data.metadata or {}
    local state = LocalPlayer.state
    local usesState = active.name == 'qbox'
    return {
        loaded = data.citizenid ~= nil and state.isLoggedIn ~= false,
        cash = money.cash,
        bank = money.bank,
        hunger = (usesState and state.hunger) or metadata.hunger,
        thirst = (usesState and state.thirst) or metadata.thirst,
        stress = (usesState and state.stress) or metadata.stress,
    }
end

AddEventHandler('onClientResourceStop', function(resource)
    if active and resource == active.resource then
        active = nil
        core = nil
    end
end)
