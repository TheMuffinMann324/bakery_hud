Config = {}

-- auto, qbox, qbcore, esx, or standalone
Config.Framework = 'auto'
Config.ShowMoney = true
Config.Currency = '$'

-- Enabled status bars and their default order. Players can enable other bars in HUD Settings.
-- Available: health, stamina, armor, hunger, thirst, stress, oxygen (underwater only).
Config.Bars = { 'health', 'stamina', 'armor', 'hunger', 'thirst', 'oxygen' }

Config.ESX = {
    CashAccount = 'money',
    BankAccount = 'bank',
}

Config.Radar = {
    -- Width is a fraction of a 16:9 screen at the current screen height.
    -- Height is a fraction of the screen height.
    width = 0.160,
    height = 0.155,
    zoom = 1000,
    vehicleOnly = false,
    showClock = true,
}

Config.Map3D = {
    enabled = true,
    zoom = 0.95, -- Pixels per metre at the player on a 115-pixel-tall map. Lower is further out.
    -- Buildings stand straight up at their real height: screen pixels per
    -- pixel of height. At 0.45 a 270 m tower fills the whole minimap.
    buildingHeight = 1.2,
    tallBuilding = 120.0,
}

Config.Navigation = {
    enabled = true,
    vehicleOnly = true,
    showWithinMeters = 80.0,
    units = 'imperial', -- imperial or metric
    waypointColor = { 247, 115, 164, 255 }, -- Default for new players. Set to false for GTA Default.
}

Config.Vehicle = {
    enabled = true,
    key = 'F7', -- Default vehicle card key. Players can change it in HUD Settings.
    holdMs = 5000, -- How long the card stays up when it pops up on its own.
    -- It pops up on getting into a vehicle, when fuel drops to lowFuel, after
    -- a major crash, and when the engine falls to engineWarning.
    lowFuel = 20, -- Percent. The alert rearms after refuelling above this.
    crashDamage = 60.0, -- Body or engine health points lost in one hit (of 1000).
    engineWarning = 35, -- Percent. Rearms after a repair above this.
}

Config.Commands = {
    edit = 'hudsettings',
}
