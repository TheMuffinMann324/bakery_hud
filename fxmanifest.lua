fx_version 'cerulean'
game 'gta5'

description 'Bakery HUD with a customizable 3D minimap and turn-by-turn GPS'
version '1.1.0'

ui_page 'web/dist/index.html'

files {
    'web/dist/index.html',
    'web/dist/assets/*',
    'web/dist/fonts/*',
    'web/dist/map3d/*',
}

client_scripts {
    'config.lua',
    'client/framework.lua',
    'client/radar.lua',
    'client/layout.lua',
    'client/navigation.lua',
    'client/map3d.lua',
    'client/vehicle.lua',
    'client/main.lua',
}
