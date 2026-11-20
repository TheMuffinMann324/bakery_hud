/* The drawn minimap: the island as flat colour seen at a slant, with its
 * buildings standing up, where the engine's radar would otherwise be.
 *
 * It began as a port of the "GTA VI MiniMap (3D Buildings) (Legacy & Enhanced)"
 * mod by loneeps (Discord @moddims), made with their permission:
 *   https://www.gta5-mods.com/scripts/gtavi-minimap-3d-buildings-legacy-enhanced
 * The world it draws is that mod's survey of the map, converted by
 * tools/map3d/build.py; the idea is theirs too, and both are credited to
 * them. The camera in VIEW and the terrain colours in PAINT are based on the
 * single-player HUD's minimap (ViMinimap, with FBICat's additions and art).
 * The mod paints
 * its picture straight onto the game's frame from a plugin, which a server
 * cannot hand to its players, so here the same picture is drawn by WebGL on
 * the HUD's own page.
 *
 * What it costs: the geometry is uploaded once and never touched again. A
 * frame is a few dozen draw calls over the 256 m squares around the player,
 * and a frame is only drawn when client_map3d.lua says something moved.
 *
 *   map3d       { load, show, config, night }
 *               fetch the world; on or off; Config.Map3D's view and paints;
 *               night, 0 (day) to 1
 *   map3dPos    { x, y, c, h, s, v, air, g, a }
 *                                           position, camera and ped heading
 *                                           (degrees), speed (m/s), in a
 *                                           vehicle, in a helicopter or a plane
 *                                           its height above the ground, and
 *                                           out of one metres above whatever is
 *                                           beneath the player and above the
 *                                           nearest street (if any)
 *   map3dRoute  { routes: [{ pts, rgb }], waypoint: blip, waypointTint: rgb }
 *               the GPS lines as world x,y pairs, plus the personal waypoint
 *               in the same format as map3dBlips
 *   map3dBlips  { list: [[x, y, sprite, r, g, b, a, flags, id], ...] }
 *               flags: 1 = stays on the edge when out of view (not short
 *               range), 2 = a vehicle, or someone in one. A blip's icon is
 *               always drawn upright, as the engine's radar draws it
 *   map3dMoving { list }                    the same, for blips that ride an
 *                                           entity and so are sent more often
 *
 *   map3dHeights { list: [[id, metres], ...] }
 *               real heights the game measured for buildings
 *
 * And back: map3dHello once the page is listening, map3dReady { ok, why }
 * once the world is in (or will not go in), and map3dMeasure { list: [[id,
 * surveyed metres, x1, y1, x2, y2, ...], ...] }: the buildings to measure in
 * game, and the points on their highest roof to measure them at. Nothing is fetched and no WebGL
 * context exists until the first `load` or `show`: a server or a player with
 * the drawn map switched off pays for none of it.
 */
(function () {
    'use strict';

    // How the world is seen: the single-player minimap's view (ViMinimap's
    // View), so both versions draw the same picture. A point on the ground
    // g pixels ahead of the player is drawn k = 1 / (1 + T g) of its size,
    // with T = `far` / (how far the player is down the panel): the panel's
    // top edge is 1 / (1 + far) of the scale at the player, and the horizon
    // is never in view. Buildings stand straight up the screen, `lift` pixels
    // for each pixel of height, no more than k and never past `liftCap`.
    var VIEW = {
        zoom: 2.58,         // pixels per metre across, at the player, on a panel 115 pixels tall
        speedZoom: 0.25,    // how much of that is given up at full speed
        speedFull: 50,      // m/s that counts as full speed
        zoomEase: 7,        // per second
        anchor: 0.85,       // the player, as a fraction of the way down the panel
        far: 0.8,
        lift: 0.3,
        liftCap: 400,       // a building's rise L is drawn L / (1 + L / liftCap)
        shadowMax: 20,      // how far a roof's shadow can be thrown
        // Roofs shade from `roofLow` at street level to `roof` at `tall`
        // metres, so a tower reads lighter than the block around it.
        tall: 250,
        // In a helicopter or a plane the view pulls back with the height above
        // the ground: to `most` of the scale at `to` metres, eased by `curve`.
        air: { from: 10, to: 1500, most: 0.01, curve: 0.6 },
        // Out of one, the camera rides at the player's height: on a roof the
        // city falls away below, and under a parachute it shrinks. The ground
        // is lowered as a building would be raised (`lift`, `liftCap`), so a
        // roof the player stands on stays under the marker, and drawn further
        // off by `lean` (of T) for each pixel of that height. `ease` is how
        // fast it follows, per second; under `floor` metres is the ground.
        altitude: { ease: 3, floor: 3, max: 500, lean: 0.904 },
        // The far end of the map pales toward the horizon: `most` of the haze
        // colour along the panel's top edge, none of it by `to` of the way
        // down. It goes by where a thing is DRAWN, not how far off it is.
        haze: { to: 0.42, most: 0.34 },
        // How much of what is behind the map it hides: the map 85%, its
        // roads 90%. The route and everything on top are solid.
        opacity: 0.85,
        roadOpacity: 0.9,
        // The building the player is in or on is seen through round the
        // marker: down to `min` of itself at the middle of an oval rx by ry
        // (centred `up` above the marker), solid from its rim out.
        fade: { rx: 30, ry: 40, up: 6, min: 0.18, near: 0.3 },
        // The line is a lane wide but never under `minWidth`, with a lighter
        // rim; round where it starts it fades to `from` of itself within `fade`.
        route: { lane: 3.5, minWidth: 6, rim: 1.2, fade: 36, from: 0.1 },
        waypoint: { ring: 17, pin: 9, foot: 15 },
        marker: 12,         // diameter, panel pixels
        blip: 13,           // a blip's picture
        dot: 3.7,           // a plain blip's radius
        badge: 5,           // the N badge's radius
        corner: 9,          // the panel's corners
        frame: 0.8,         // its outline, white at frameAlpha
        frameAlpha: 110 / 255,
        north: true
    };

    // The single-player minimap's colours: warm grey ground with its roads
    // and yards lighter, buildings a blue-grey lit from one side. The ground,
    // water, sand and buildings have night colours (NIGHT); the footprints,
    // rail, roads and yards keep theirs.
    var PAINT = {
        land: [160, 155, 149], water: [118, 152, 158], sand: [178, 162, 134],
        footprint: [158, 159, 166], rail: [148, 144, 140], road: [172, 167, 161],
        lot: [182, 177, 170],
        roof: [158, 159, 166], roofLow: [140, 141, 148], wall: [146, 150, 160], shadow: [8, 7, 8, 20 / 255],
        lane: [120, 117, 114, 70 / 255],        // single player's own lane colours
        haze: [170, 166, 186]
    };

    // After dark. `night` runs from 0 (day) to 1 and every colour with a night
    // one is mixed by it, so dusk and dawn are a slow change and not a switch.
    var NIGHT = {
        land: [34, 38, 54], water: [18, 28, 46], sand: [62, 60, 66],
        roof: [60, 71, 99], roofLow: [46, 54, 78], wall: [42, 51, 72],
        lane: [58, 64, 82, 70 / 255], haze: [58, 58, 84]
    };
    var night = 0;

    function ink(name) {
        var d = PAINT[name], n = NIGHT[name];
        if (n == null || night <= 0) return d;
        if (typeof d === 'number') return d + (n - d) * night;
        var out = [];
        for (var i = 0; i < d.length; i++) out.push(d[i] + ((n[i] != null ? n[i] : d[i]) - d[i]) * night);
        return out;
    }

    var PANEL_H = 115;          // the panel height every size above is measured on
    var canvas, gl, world, glFailed = false;
    var progs = {}, layers = {}, bld, groundTex, uiTex, atlasTex, atlas;
    var routeBuf, routeCount = 0, routes = [];
    var SPRITE_BATCH = 512;
    var spriteBuf, spriteData = new Float32Array(8 * 6 * SPRITE_BATCH);
    var blips = [], fixed = [], moving = [], routeSrc = [], waypoint = null, waypointTint = null, uiArt;
    var booted = false;
    var shown = false, wanted = false, loaded = false, dirty = false, queued = false;
    var pos = { x: 0, y: 0, c: 0, h: 0, s: 0, v: false, air: 0, g: 0, a: null };
    var zoomNow = -1, lastDraw = 0;
    var altNow = 0;             // metres the player is above the ground, as drawn

    function post(name, data) {
        try {
            var res = (typeof GetParentResourceName === 'function') ? GetParentResourceName() : 'vice_hud';
            fetch('https://' + res + '/' + name, { method: 'POST', body: JSON.stringify(data || {}) }).catch(function () {});
        } catch { /* a browser preview has nobody to tell */ }
    }

    // An empty Lua table crosses to the page as {} as readily as [], so a
    // list is only ever taken as one when it is one.
    function list(v) { return Array.isArray(v) ? v : []; }

    function merge(into, from) {
        if (!from) return;
        Object.keys(from).forEach(function (k) {
            if (from[k] && typeof from[k] === 'object' && !Array.isArray(from[k]) && typeof into[k] === 'object') merge(into[k], from[k]);
            else if (from[k] != null) into[k] = from[k];
        });
    }

    /* --- shaders ----------------------------------------------------------
       Every one of them places a world point the same way, so that part is
       written once. `u` is pixels to the right of the player, `g` pixels
       ahead; `w` = 1 + T g is how much smaller the point is drawn, and the
       divide by it is the perspective. `lift` is how many pixels up the
       screen the point is raised -- a building's height -- and it shrinks
       with distance but never grows nearer than the player (min(k, 1)).
       Depth is k itself, nearer smaller, as the single-player minimap keeps
       it. Up high, uAlt is how far down the ground is drawn (the player's
       height, raised as a building would be) and uLeanZ how much further off
       it is (view() works both out). hazed() is how much of the horizon's
       pallor a pixel takes on, by how near the top of the panel it is; it
       applies to everything that is part of the map. */
    var PLACE = [
        'uniform vec2 uCentre; uniform vec2 uRot; uniform float uScale;',
        'uniform vec2 uPanel; uniform vec2 uOrigin; uniform float uT; uniform float uAlt; uniform float uLeanZ;',
        'vec4 place(vec2 p, float lift) {',
        '    vec2 d = p - uCentre;',
        '    float u = uScale * (d.x * uRot.x + d.y * uRot.y);',
        '    float g = uScale * (d.y * uRot.x - d.x * uRot.y);',
        '    float w = 1.0 + uT * g + uLeanZ;',
        '    return vec4((2.0 * uOrigin.x / uPanel.x - 1.0) * w + 2.0 * u / uPanel.x,',
        '                (1.0 - 2.0 * uOrigin.y / uPanel.y) * w + 2.0 * (g - uAlt + lift * min(w, 1.0)) / uPanel.y,',
        '                w - 0.2, w);',
        '}'
    ].join('\n');
    var PANEL = 'uniform vec2 uPanel; uniform vec2 uMargin;\n';
    var HAZE = 'uniform vec4 uHaze; uniform float uHazeTo;' +
        'vec3 hazed(vec3 c) { float down = 1.0 - (gl_FragCoord.y - uMargin.y) / uPanel.y;' +
        ' return mix(c, uHaze.rgb, uHaze.a * (1.0 - smoothstep(0.0, uHazeTo, down))); }\n';

    var SHADERS = {
        flat: {
            vs: PLACE + '\nlayout(location = 0) in vec2 aPos; void main() { gl_Position = place(aPos, 0.0); }',
            fs: PANEL + HAZE + 'uniform vec4 uColour; out vec4 o; void main() { o = vec4(hazed(uColour.rgb), uColour.a); }'
        },
        // The ground is one sheet over the whole panel: each pixel is taken
        // back through the camera to the spot on the ground it shows (which is
        // place(), run the other way), and coloured by the survey there. Its
        // alpha is left at 0: the map's see-through is worked out at the end,
        // and 0 is "not a road".
        ground: {
            vs: 'layout(location = 0) in vec2 aPos; void main() { gl_Position = vec4(aPos, 0.0, 1.0); }',
            fs: PANEL + HAZE + [
                'uniform vec2 uCentre; uniform vec2 uRot; uniform float uScale;',
                'uniform vec2 uOrigin; uniform float uT; uniform float uAlt; uniform float uLeanZ;',
                'uniform sampler2D uGround; uniform vec2 uGroundAt; uniform vec2 uGroundSize;',
                'uniform vec3 uLand; uniform vec3 uWater; uniform vec3 uSand;',
                'out vec4 o;',
                'float edge(float v) { float e = max(fwidth(v) * 0.7, 0.02); return smoothstep(0.5 - e, 0.5 + e, v); }',
                'void main() {',
                '    vec2 f = gl_FragCoord.xy - uMargin;',
                '    float q = uOrigin.y - (uPanel.y - f.y);',
                '    float g = (q * (1.0 + uLeanZ) + uAlt) / max(1.0 - uT * q, 0.05);',
                '    float u = (f.x - uOrigin.x) * (1.0 + uT * g + uLeanZ);',
                '    vec2 p = uCentre + vec2(u * uRot.x - g * uRot.y, u * uRot.y + g * uRot.x) / uScale;',
                '    vec2 uv = (p - uGroundAt) / uGroundSize;',
                '    vec2 t = texture(uGround, uv).rg;',
                // Past the survey's edge there is only sea.
                '    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) t = vec2(1.0, 0.0);',
                '    vec3 c = mix(uLand, uSand, edge(t.g));',
                '    c = mix(c, uWater, edge(t.r));',
                '    o = vec4(hazed(c), 0.0);',
                '}'
            ].join('\n')
        },
        // The GPS line, drawn on the screen and not on the ground, as the
        // single-player minimap draws it: discs at its points and strips
        // between them, `uHalf` pixels either side of it at the player's
        // scale, narrowing with distance down to 0.3 of that (and no wider
        // than 1.6 below the player), plus `uRim` for the rim, which narrows
        // only from 1.3 down to 0.6. A strip is squared to the way the line
        // runs on the screen; a disc is round on it.
        route: {
            vs: PLACE + '\nlayout(location = 0) in vec2 aPos; layout(location = 1) in vec2 aOff; layout(location = 2) in float aAlong;' +
                'layout(location = 3) in vec2 aTan; uniform float uHalf; uniform float uRim; uniform float uZ; out float vAlong;' +
                'vec2 screen(vec2 p, out float k) { vec2 d = p - uCentre;' +
                ' float u = uScale * (d.x * uRot.x + d.y * uRot.y), g = uScale * (d.y * uRot.x - d.x * uRot.y);' +
                ' k = 1.0 / max(1.0 + uT * g + uLeanZ, 0.25); return vec2(uOrigin.x + u * k, uOrigin.y - (g - uAlt) * k); }' +
                'void main() { float k, k2, k3; vec2 s = screen(aPos, k), dir = aOff;' +
                ' if (dot(aTan, aTan) < 0.25) {' +
                '  vec2 t = screen(aPos + vec2(-aOff.y, aOff.x), k2) - s; t /= max(length(t), 0.0001);' +
                '  vec2 n = vec2(-t.y, t.x); dir = dot(n, screen(aPos + aOff, k3) - s) < 0.0 ? -n : n; }' +
                ' float kc = clamp(k, 0.3, 1.6); vec2 px = s + dir * (uHalf * kc + uRim * clamp(kc, 0.6, 1.3));' +
                ' vAlong = aAlong; gl_Position = vec4(2.0 * px.x / uPanel.x - 1.0, 1.0 - 2.0 * px.y / uPanel.y, uZ, 1.0); }',
            // Nothing of the line is drawn before the point it starts at (the
            // player's place on it), and round that point it is faded.
            fs: 'uniform vec2 uPanel; uniform vec2 uMargin;' +
                'in float vAlong; uniform float uStart; uniform vec2 uStartAt; uniform float uFadeR; uniform float uFrom; uniform vec4 uColour; out vec4 o;' +
                'void main() { if (vAlong < uStart) discard;' +
                ' vec2 p = vec2(gl_FragCoord.x - uMargin.x, uPanel.y - (gl_FragCoord.y - uMargin.y));' +
                ' float r = min(length(p - uStartAt) / uFadeR, 1.0), a = uFrom + (1.0 - uFrom) * r * r * (3.0 - 2.0 * r);' +
                ' o = vec4(uColour.rgb * a, a); }'
        },
        // A building stands its full height, raised up the screen through the
        // same camera as the ground it is on, its roof lighter the taller it
        // is and its walls darker toward the street. The one the player is in or on
        // is seen through round the marker; every other stays solid. Roofs
        // sit a hair nearer than their walls, so the top of a building is its
        // roof. Its alpha is how solid it is, which takes it off the road
        // under it for the see-through worked out at the end.
        building: {
            vs: PLACE + [
                '',
                'layout(location = 0) in vec4 aVert; layout(location = 1) in float aId;',
                'uniform float uLift; uniform float uLiftCap; uniform float uInside; uniform float uTall;',
                'uniform vec3 uRoof; uniform vec3 uRoofLow; uniform vec3 uWall; out vec3 vColour; out float vMine;',
                'out float vWall; out float vUp; out float vZ;',
                'void main() {',
                // Straight up the screen, `lift` pixels for each pixel of real
                // height, so a tower's walls stand as tall as the tower is.
                '    float L = aVert.z * uScale * uLift;',
                '    gl_Position = place(aVert.xy, L / (1.0 + L / uLiftCap));',
                '    vMine = abs(aId - uInside) < 0.5 ? 1.0 : 0.0;',
                '    vWall = aVert.w > 8.0 ? 0.0 : 1.0; vUp = aVert.z > 0.01 ? 1.0 : 0.0; vZ = aVert.z;',
                '    float tall = sqrt(clamp(aVert.z / uTall, 0.0, 1.0));',
                '    if (aVert.w > 8.0) { vColour = mix(uRoofLow, uRoof, tall); gl_Position.z -= 0.00008 * gl_Position.w; }',
                '    else {',
                '        vec2 n = vec2(cos(aVert.w), sin(aVert.w));',
                '        float nx = n.x * uRot.x + n.y * uRot.y;',
                '        float ny = n.y * uRot.x - n.x * uRot.y;',
                '        float lum = 0.62 + 0.42 * (0.5 + 0.5 * (-0.75 * nx - 0.35 * ny));',
                // Walls darken toward the street, so a tall one reads as tall.
                '        vColour = uWall * lum * (aVert.z > 0.01 ? 1.0 : 0.5);',
                '    }',
                '}'
            ].join('\n'),
            fs: PANEL + HAZE + [
                'in vec3 vColour; in float vMine; in float vWall; in float vUp; in float vZ;',
                'uniform vec2 uFadeAt; uniform vec2 uFadeSize; uniform vec3 uRim;',
                'uniform float uFadeMin; uniform float uFadeNear; out vec4 o;',
                'void main() {',
                '    vec3 c = vColour;',
                '    if (vWall > 0.5) {',
                // A floor line every 4 m, gone before they crowd together.
                '        float f = vZ / 4.0, fw = max(fwidth(f), 1e-4);',
                '        float line = 1.0 - smoothstep(0.0, fw * 1.2, min(fract(f), 1.0 - fract(f)));',
                '        c *= 1.0 - 0.16 * line * (1.0 - smoothstep(0.12, 0.3, fw)) * step(1.0, vZ);',
                // A light rim along the top of every wall: the roof's outline.
                '        float rw = max(fwidth(vUp), 1e-4);',
                '        c = mix(c, uRim, 0.85 * (1.0 - smoothstep(rw * 0.8, rw * 2.0, 1.0 - vUp)));',
                '    }',
                '    float a = 1.0;',
                '    if (vMine > 0.5) {',
                '        vec2 p = vec2(gl_FragCoord.x - uMargin.x, uPanel.y - (gl_FragCoord.y - uMargin.y));',
                '        float t = clamp((length((p - uFadeAt) / uFadeSize) - uFadeNear) / (1.0 - uFadeNear), 0.0, 1.0);',
                '        a = uFadeMin + (1.0 - uFadeMin) * t * t * (3.0 - 2.0 * t);',
                '    }',
                '    o = vec4(hazed(c), a);',
                '}'
            ].join('\n')
        },
        // A roof's shadow: the roof again, on the ground, pushed down and right
        // by its building's rise (no further than uShadowMax). Drawn at one
        // fixed depth, so where shadows overlap the ground is darkened once.
        shadow: {
            vs: PLACE + [
                '',
                'layout(location = 0) in vec4 aVert; uniform float uLift; uniform float uLiftCap; uniform float uShadowMax;',
                'void main() {',
                '    float L = aVert.z * uScale * uLift;',
                '    L = min(L / (1.0 + L / uLiftCap), uShadowMax);',
                '    gl_Position = place(aVert.xy, 0.0);',
                '    float k = min(1.0 / gl_Position.w, 1.0);',
                '    gl_Position.xy += vec2(0.55, -0.3) * L * k * 2.0 / uPanel * gl_Position.w;',
                '    gl_Position.z = 0.0;',
                '}'
            ].join('\n'),
            fs: 'uniform vec4 uColour; out vec4 o; void main() { o = uColour; }'
        },
        // A whole-panel pass that only writes what the blend makes of it: the
        // see-through, then the colours taken down to it (see frame()).
        fill: {
            vs: 'layout(location = 0) in vec2 aPos; void main() { gl_Position = vec4(aPos, 0.0, 1.0); }',
            fs: 'uniform vec4 uColour; out vec4 o; void main() { o = uColour; }'
        },
        // Rounds the panel's corners off: everything outside the outline is
        // multiplied away, with the edge itself left soft.
        corners: {
            vs: 'layout(location = 0) in vec2 aPos; void main() { gl_Position = vec4(aPos, 0.0, 1.0); }',
            fs: PANEL + 'uniform float uCorner; out vec4 o;' +
                'void main() { vec2 q = abs(gl_FragCoord.xy - uMargin - uPanel * 0.5) - (uPanel * 0.5 - uCorner);' +
                ' float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uCorner; o = vec4(clamp(0.5 - d, 0.0, 1.0)); }'
        },
        // And its outline: a line uWidth wide down the middle of that edge.
        frame: {
            vs: 'layout(location = 0) in vec2 aPos; void main() { gl_Position = vec4(aPos, 0.0, 1.0); }',
            fs: PANEL + 'uniform float uCorner; uniform float uWidth; uniform vec4 uColour; out vec4 o;' +
                'void main() { vec2 q = abs(gl_FragCoord.xy - uMargin - uPanel * 0.5) - (uPanel * 0.5 - uCorner);' +
                ' float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uCorner;' +
                ' o = uColour * clamp(uWidth * 0.5 + 0.5 - abs(d), 0.0, 1.0); }'
        },
        // A picture's grey pixels take the blip's colour, as the single-player
        // minimap tints them; its coloured ones keep their own.
        sprite: {
            vs: 'layout(location = 0) in vec2 aPx; layout(location = 1) in vec2 aUv; layout(location = 2) in vec4 aTint; uniform vec2 uPanel; out vec2 vUv; out vec4 vTint;' +
                'void main() { vUv = aUv; vTint = aTint; gl_Position = vec4(2.0 * aPx.x / uPanel.x - 1.0, 1.0 - 2.0 * aPx.y / uPanel.y, 0.0, 1.0); }',
            fs: 'in vec2 vUv; in vec4 vTint; uniform sampler2D uTex; out vec4 o;' +
                'void main() { vec4 t = texture(uTex, vUv); vec3 c = t.rgb / max(t.a, 0.0001);' +
                ' if (max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b)) <= 40.0 / 255.0) c *= vTint.rgb;' +
                ' o = vec4(c * t.a, t.a) * vTint.a; }'
        }
    };

    function compile(name) {
        var src = SHADERS[name];
        function sh(type, body) {
            var s = gl.createShader(type);
            gl.shaderSource(s, '#version 300 es\nprecision highp float;\n' + body);
            gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(name + ': ' + gl.getShaderInfoLog(s));
            return s;
        }
        var p = gl.createProgram();
        gl.attachShader(p, sh(gl.VERTEX_SHADER, src.vs));
        gl.attachShader(p, sh(gl.FRAGMENT_SHADER, src.fs));
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(name + ': ' + gl.getProgramInfoLog(p));
        var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
        for (var i = 0; i < n; i++) {
            var info = gl.getActiveUniform(p, i);
            u[info.name] = gl.getUniformLocation(p, info.name);
        }
        return { p: p, u: u };
    }

    /* --- the world -------------------------------------------------------- */

    function parseWorld(buf) {
        var dv = new DataView(buf);
        if (dv.getUint32(0, true) !== 0x314d4856) throw new Error('world.bin: not a map');   // "VHM1"
        var headLen = dv.getUint32(4, true);
        var head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, headLen)));
        var base = 8 + headLen;
        head.f32 = function (r) { return new Float32Array(buf, base + r.at, r.n); };
        head.u32 = function (r) { return new Uint32Array(buf, base + r.at, r.n); };
        return head;
    }

    function upload(target, data) {
        var b = gl.createBuffer();
        gl.bindBuffer(target, b);
        gl.bufferData(target, data, gl.STATIC_DRAW);
        return b;
    }

    function buildWorld(head) {
        world = head;
        Object.keys(head.layers).forEach(function (name) {
            var L = head.layers[name];
            var vao = gl.createVertexArray();
            gl.bindVertexArray(vao);
            upload(gl.ARRAY_BUFFER, head.f32(L.xy));
            gl.enableVertexAttribArray(0);
            gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
            upload(gl.ELEMENT_ARRAY_BUFFER, head.u32(L.tri));
            layers[name] = { vao: vao, starts: head.u32(L.starts) };
        });
        if (head.buildings) {
            var B = head.buildings;
            var verts = upload(gl.ARRAY_BUFFER, head.f32(B.verts));
            bld = {};
            ['roof', 'wall'].forEach(function (part) {
                var vao = gl.createVertexArray();
                gl.bindVertexArray(vao);
                gl.bindBuffer(gl.ARRAY_BUFFER, verts);
                gl.enableVertexAttribArray(0);
                gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 20, 0);
                gl.enableVertexAttribArray(1);
                gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 20, 16);
                upload(gl.ELEMENT_ARRAY_BUFFER, head.u32(B[part]));
                bld[part] = { vao: vao, starts: head.u32(B[part + 'Starts']) };
            });
            bld.vbo = verts;
            bld.verts = head.f32(B.verts);
            bld.roofTris = head.u32(B.roof);
            findSized();
        }
        gl.bindVertexArray(null);
    }

    /* The survey's heights are rough: many towers are stored at a flat 60 m
       and plenty of other buildings are off too. Every building of any size
       is listed for client/map3d.lua, which measures its real roof against
       the game's own collision as the player comes near, and each building
       is then scaled to the answer (setHeights), keeping its shape. */
    var MEASURE_FROM = 10;      // metres; anything lower is left as surveyed
    var SAMPLES = 5;
    var sized = {};             // id -> { at: [[x, y], ...], top, idx: raised vertex numbers, z: their surveyed heights, runs, h }
    function findSized() {
        var v = bld.verts, n = v.length / 5, top = {}, i, id, t;
        for (i = 0; i < n; i++) {
            if (v[i * 5 + 3] > 8) {
                id = v[i * 5 + 4];
                t = top[id] || (top[id] = { z: 0 });
                if (v[i * 5 + 2] > t.z) t.z = v[i * 5 + 2];
            }
        }
        // Where it is measured: the middles of the biggest pieces of its
        // highest roof, up to SAMPLES of them, so one stray hit cannot decide it.
        var tris = bld.roofTris, pieces = {};
        for (i = 0; i < tris.length; i += 3) {
            var a = tris[i] * 5, b = tris[i + 1] * 5, d = tris[i + 2] * 5;
            id = v[a + 4]; t = top[id];
            if (!t || t.z < MEASURE_FROM || Math.min(v[a + 2], v[b + 2], v[d + 2]) < t.z - 0.05) continue;
            var area = Math.abs((v[b] - v[a]) * (v[d + 1] - v[a + 1]) - (v[d] - v[a]) * (v[b + 1] - v[a + 1])) / 2;
            (pieces[id] || (pieces[id] = [])).push([area, (v[a] + v[b] + v[d]) / 3, (v[a + 1] + v[b + 1] + v[d + 1]) / 3]);
        }
        for (id in pieces) {
            var at = pieces[id].sort(function (p, q) { return q[0] - p[0]; }).slice(0, SAMPLES);
            sized[id] = { at: at.map(function (p) { return [Math.round(p[1] * 10) / 10, Math.round(p[2] * 10) / 10]; }),
                          top: top[id].z, idx: [], z: [], h: top[id].z };
        }
        // The vertices each building raises, and the runs of the buffer it
        // lives in (its roof and its walls), so a new height re-sends those
        // few kilobytes and not the whole city.
        for (i = 0; i < n; i++) {
            var c = sized[v[i * 5 + 4]];
            if (!c) continue;
            if (v[i * 5 + 2] > 0.01) { c.idx.push(i); c.z.push(v[i * 5 + 2]); }
            var run = c.runs ? c.runs[c.runs.length - 1] : null;
            if (run && run[0] + run[1] === i) run[1]++;
            else (c.runs || (c.runs = [])).push([i, 1]);
        }
        for (id in sized) { sized[id].idx = Uint32Array.from(sized[id].idx); sized[id].z = Float32Array.from(sized[id].z); }
    }
    function sizedList() {
        return Object.keys(sized).map(function (id) {
            var c = sized[id];
            return [Number(id), Math.round(c.top)].concat([].concat.apply([], c.at));
        });
    }
    function setHeights(list) {
        if (!bld || !gl) return;
        var v = bld.verts, changed = false;
        gl.bindBuffer(gl.ARRAY_BUFFER, bld.vbo);
        list.forEach(function (e) {
            var c = Array.isArray(e) && sized[e[0]], h = Array.isArray(e) && Number(e[1]);
            if (!c || !c.runs || !(h > 2) || h > 1000 || Math.abs(h - c.h) < 0.5) return;
            c.h = h;
            var k = h / c.top;
            for (var j = 0; j < c.idx.length; j++) v[c.idx[j] * 5 + 2] = c.z[j] * k;
            c.runs.forEach(function (r) { gl.bufferSubData(gl.ARRAY_BUFFER, r[0] * 20, v, r[0] * 5, r[1] * 5); });
            changed = true;
        });
        if (!changed) return;
        inside.x = 1e9;         // the player's building may have changed height
        invalidate();
    }

    function texture(image, smooth) {
        var t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, smooth ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        if (smooth) gl.generateMipmap(gl.TEXTURE_2D);
        return t;
    }

    function loadImage(src) {
        return new Promise(function (ok, bad) {
            var im = new Image();
            im.onload = function () { ok(im); };
            im.onerror = function () { bad(new Error(src + ' would not load')); };
            im.src = src;
        });
    }

    /* What is drawn that is not the island, painted once into one sheet at a
       size no screen will outgrow: the north badge, a plain tintable disc
       for missing blips, plus the player marker and waypoint art from map3d/sp.png. */
    var UI = { cell: 128, cells: 5, north: 0, dot: 1, player: 2, ring: 3, pin: 4 };
    var DISC = 0.48;            // a painted disc's radius, as a part of its cell
    function paintUi(art) {
        var c = document.createElement('canvas');
        c.width = UI.cell * UI.cells; c.height = UI.cell;
        var x = c.getContext('2d'), m = UI.cell / 2, R = UI.cell * DISC, cx;

        // The badge: a near-black disc with a bold white N, its capitals 1.1
        // of the disc's radius tall, centred on the letter itself.
        cx = UI.north * UI.cell + m;
        x.fillStyle = '#0c0b0d'; x.beginPath(); x.arc(cx, m, R, 0, 7); x.fill();
        x.fillStyle = '#ffffff';
        x.font = '700 ' + (R * 1.1 / 0.716).toFixed(2) + 'px Arial, sans-serif';
        x.textAlign = 'left'; x.textBaseline = 'alphabetic';
        var n = x.measureText('N'), nl = n.actualBoundingBoxLeft || 0, nr = n.actualBoundingBoxRight || n.width;
        var na = n.actualBoundingBoxAscent || R * 1.1, nd = n.actualBoundingBoxDescent || 0;
        x.fillText('N', cx - (nr - nl) / 2 + nl, m + (na - nd) / 2);

        cx = UI.dot * UI.cell + m;
        x.fillStyle = '#ffffff'; x.beginPath(); x.arc(cx, m, R, 0, 7); x.fill();

        if (art) {
            var width = 3 * UI.cell;
            x.drawImage(art, 0, 0, width, UI.cell, UI.player * UI.cell, 0, width, UI.cell);
            if (waypointTint) {
                // Recolour the teal pin and ring while keeping their neutral detail and alpha.
                var left = UI.ring * UI.cell;
                var artPixels = x.getImageData(left, 0, 2 * UI.cell, UI.cell);
                var pixels = artPixels.data;
                for (var i = 0; i < pixels.length; i += 4) {
                    var neutral = pixels[i], green = pixels[i + 1], blue = pixels[i + 2];
                    if (green <= neutral || blue <= neutral) continue;
                    var chroma = (Math.max(green, blue) - neutral) / 255;
                    for (var channel = 0; channel < 3; channel++) {
                        pixels[i + channel] = neutral + chroma * waypointTint[channel];
                    }
                }
                x.putImageData(artPixels, left, 0);
            }
        } else {
            // The marker as the single-player minimap draws it with no picture.
            cx = UI.player * UI.cell + m;
            var r = UI.cell * 0.5;
            x.fillStyle = '#060707'; x.beginPath(); x.arc(cx, m, r, 0, 7); x.fill();
            x.fillStyle = '#141415'; x.beginPath(); x.arc(cx, m, r * 0.939, 0, 7); x.fill();
            x.fillStyle = '#fcfcfc'; x.beginPath();
            x.moveTo(cx, m - 0.647 * r); x.lineTo(cx + 0.655 * r, m + 0.553 * r);
            x.lineTo(cx, m + 0.223 * r); x.lineTo(cx - 0.655 * r, m + 0.553 * r);
            x.closePath(); x.fill();
            if (waypointTint) {
                x.fillStyle = 'rgb(' + waypointTint.join(',') + ')';
                x.beginPath(); x.arc(UI.pin * UI.cell + m, m, R * 0.6, 0, 7); x.fill();
            }
        }
        return c;
    }

    function updateUiTexture() {
        var next = texture(paintUi(uiArt), true);
        if (uiTex) gl.deleteTexture(uiTex);
        uiTex = next;
    }

    function setWaypointTint(data) {
        var color = list(data);
        if (color.length !== 3) color = null;
        if ((!color && !waypointTint) || (color && waypointTint && color.every(function (value, i) {
            return value === waypointTint[i];
        }))) return;
        waypointTint = color;
        if (uiTex) updateUiTexture();
    }

    function boot() {
        if (booted) return;
        booted = true;
        canvas = document.getElementById('map3d');
        if (!canvas) return;
        gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: true, depth: true, stencil: false });
        if (!gl) { glFailed = true; post('map3dReady', { ok: false, why: 'this browser has no WebGL2' }); return; }

        try {
            Object.keys(SHADERS).forEach(function (n) { progs[n] = compile(n); });
        } catch (e) { glFailed = true; post('map3dReady', { ok: false, why: String(e.message || e) }); return; }

        var quad = gl.createVertexArray();
        gl.bindVertexArray(quad);
        upload(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]));
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        progs.quad = quad;

        var rv = gl.createVertexArray();
        gl.bindVertexArray(rv);
        routeBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, routeBuf);
        gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 28, 0);
        gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 28, 8);
        gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 28, 16);
        gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 2, gl.FLOAT, false, 28, 20);
        progs.routeVao = rv;

        var sv = gl.createVertexArray();
        gl.bindVertexArray(sv);
        spriteBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, spriteBuf);
        gl.bufferData(gl.ARRAY_BUFFER, spriteData.byteLength, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 32, 0);
        gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 32, 8);
        gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16);
        progs.spriteVao = sv;
        gl.bindVertexArray(null);

        updateUiTexture();
        setRoutes(routeSrc);

        fetch('map3d/world.bin')
            .then(function (r) { if (!r.ok) throw new Error('map3d/world.bin is not there: build it with tools/map3d/build.py'); return r.arrayBuffer(); })
            .then(function (buf) {
                var head = parseWorld(buf);
                buildWorld(head);
                return loadImage('map3d/' + head.ground.file);
            })
            .then(function (im) {
                gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
                groundTex = texture(im, true);
                loaded = true;
                post('map3dReady', { ok: true });
                if (bld) post('map3dMeasure', { list: sizedList() });
                setShown(wanted);
            })
            .catch(function (e) { post('map3dReady', { ok: false, why: String(e.message || e) }); });

        // The blip pictures are optional: without them a blip is a dot.
        fetch('map3d/blips.json')
            .then(function (r) { if (!r.ok) throw 0; return r.json(); })
            .then(function (j) { return loadImage('map3d/' + j.file).then(function (im) { atlas = j; atlasTex = texture(im, true); invalidate(); }); })
            .catch(function () {});

        // The single-player minimap's pictures. Without them the marker is
        // drawn and the rest are discs.
        loadImage('map3d/sp.png')
            .then(function (im) { uiArt = im; updateUiTexture(); invalidate(); })
            .catch(function () {});

        if (typeof ResizeObserver === 'function') new ResizeObserver(function () { invalidate(); }).observe(canvas);
    }

    /* --- a frame ---------------------------------------------------------- */

    var snapNext = false;      // the next frame jumps to the end of any easing

    function invalidate() {
        dirty = true;
        if (queued || !shown || !loaded || !gl) return;
        queued = true;
        requestAnimationFrame(frame);
    }

    // The canvas is a tenth of the panel's height bigger than the panel on
    // every side, so a blip pinned to the edge can sit across it the way the
    // single-player minimap's do. The HUD stylesheet adds the overhang and
    // view() below subtracts it to get the panel size.
    var OVERHANG = 0.1;

    // In a helicopter or a plane, how far the height above the ground pulls
    // the view back.
    function airScale() {
        var A = VIEW.air;
        if (!A || !(pos.air > 0)) return 1;
        var t = Math.max(0, Math.min(1, (pos.air - A.from) / Math.max(1, A.to - A.from)));
        return Math.exp(Math.log(Math.max(0.0001, A.most)) * Math.pow(t, A.curve));
    }

    /* How high the player is above the ground the map is drawn on: how far
       they are above whatever is under them (pos.g), plus the height of the
       building the map knows is there, which is right on a roof and right in
       the air. Their height above the nearest street (pos.a) limits it, so a
       canopy or awning overhead is not taken for a roof underfoot. In a
       helicopter or a plane the view pulls back instead (airScale). */
    function altitudeWanted() {
        var A = VIEW.altitude;
        if (!A || pos.air > 0) return 0;
        var under = (bld && world && standingIn() >= 0) ? inside.h : 0;
        var z = Math.max(0, Number(pos.g) || 0) + under;
        if (typeof pos.a === 'number') z = Math.min(z, Math.max(0, pos.a));
        if (z < (Number(A.floor) || 3)) return 0;
        return Math.min(z, Number(A.max) || 500);
    }
    // One step of the camera following it. True while it still has to move.
    function stepAltitude(dt, snap) {
        var to = altitudeWanted(), ease = Number((VIEW.altitude || {}).ease) || 3;
        if (snap || Math.abs(to - altNow) < 0.05) { var moved = altNow !== to && !snap; altNow = to; return moved; }
        altNow += (to - altNow) * (1 - Math.exp(-dt * ease));
        return true;
    }

    function view(Wc, Hc, dt) {
        var m = Math.round(Hc * OVERHANG / (1 + 2 * OVERHANG)), H = Hc - 2 * m, W = Wc - 2 * m;
        var unit = H / PANEL_H;
        var target = VIEW.zoom * airScale() * (1 - VIEW.speedZoom * Math.min(1, pos.s / VIEW.speedFull));
        zoomNow = zoomNow < 0 ? target : zoomNow + (target - zoomNow) * (1 - Math.exp(-dt * VIEW.zoomEase));
        var rad = pos.c * Math.PI / 180, oy = H * VIEW.anchor, s = zoomNow * unit;
        // A point g pixels ahead of the player is drawn 1 + T * g times smaller.
        var T = Math.max(0, Number(VIEW.far) || 0) / Math.max(1, oy);
        // The player's height, raised as a building's would be: the ground is
        // drawn that far down, and further off by lean for each pixel of it.
        var lift = Math.max(0.01, VIEW.lift), A = lift * altNow * s, cap = VIEW.liftCap * unit;
        var alt = A / (1 + A / cap), leanZ = (Number((VIEW.altitude || {}).lean) || 0) * T * alt / lift;
        return { W: W, H: H, Wc: Wc, Hc: Hc, m: m, corner: VIEW.corner * unit, unit: unit, s: s,
                 cos: Math.cos(rad), sin: Math.sin(rad), ox: W / 2, oy: oy, rad: rad,
                 T: T, alt: alt, leanZ: leanZ,
                 easing: Math.abs(target - zoomNow) > target * 0.002 };
    }

    function shared(prog, V) {
        var u = prog.u;
        gl.useProgram(prog.p);
        gl.uniform2f(u.uCentre, pos.x, pos.y);
        gl.uniform2f(u.uRot, V.cos, V.sin);
        gl.uniform1f(u.uScale, V.s);
        gl.uniform2f(u.uPanel, V.W, V.H);
        gl.uniform2f(u.uMargin, V.m, V.m);
        gl.uniform2f(u.uOrigin, V.ox, V.oy);
        gl.uniform1f(u.uT, V.T);
        gl.uniform1f(u.uAlt, V.alt);
        gl.uniform1f(u.uLeanZ, V.leanZ);
        if (u.uHaze) {
            var c = ink('haze'), h = VIEW.haze || {};
            gl.uniform4f(u.uHaze, c[0] / 255, c[1] / 255, c[2] / 255, Math.max(0, Math.min(1, Number(h.most) || 0)));
            gl.uniform1f(u.uHazeTo, Math.max(0.01, Number(h.to) || 0.42));
        }
        return u;
    }

    // Where on the ground a point of the panel is looking: place(), backwards.
    // x and y are panel pixels from its top left; the answer is pixels right
    // of and ahead of the player.
    function ground(V, x, y) {
        var q = V.oy - y;
        var g = (q * (1 + V.leanZ) + V.alt) / Math.max(1 - V.T * q, 0.05);
        var w = 1 + V.T * g + V.leanZ;
        return { u: (x - V.ox) * w, g: g, w: w };
    }

    // Which squares of the world can be on the panel: everything within reach
    // of the furthest ground its corners look at, and one square more for
    // what stands tall. From high up that is a great deal of ground, so there
    // is a limit.
    function reach(V) {
        var far = ground(V, 0, 0), near = ground(V, 0, V.H);
        var r = Math.min(3000, Math.max(Math.hypot(far.u, far.g), Math.hypot(near.u, near.g)) / V.s) + world.chunk;
        var b = world.bounds, c = world.chunk;
        return {
            x0: Math.max(0, Math.floor((pos.x - r - b[0]) / c)), x1: Math.min(world.gw - 1, Math.floor((pos.x + r - b[0]) / c)),
            y0: Math.max(0, Math.floor((pos.y - r - b[1]) / c)), y1: Math.min(world.gh - 1, Math.floor((pos.y + r - b[1]) / c))
        };
    }

    function drawChunks(mesh, R) {
        if (R.x1 < R.x0) return;
        gl.bindVertexArray(mesh.vao);
        for (var cy = R.y0; cy <= R.y1; cy++) {
            var from = mesh.starts[cy * world.gw + R.x0], to = mesh.starts[cy * world.gw + R.x1 + 1];
            if (to > from) gl.drawElements(gl.TRIANGLES, to - from, gl.UNSIGNED_INT, from * 4);
        }
    }

    // Which building the player is inside or on, or -1. Only that one is
    // seen through around the marker; the rest of the street stays solid.
    // Looked up again once the player has moved half a metre, over the roofs
    // of the squares around them.
    var inside = { x: 1e9, y: 1e9, id: -1, h: 0 };
    function standingIn() {
        if (Math.abs(pos.x - inside.x) + Math.abs(pos.y - inside.y) < 0.5) return inside.id;
        inside.x = pos.x; inside.y = pos.y; inside.id = -1; inside.h = 0;
        var b = world.bounds, c = world.chunk, v = bld.verts, t = bld.roofTris, s = bld.roof.starts;
        var cx = Math.floor((pos.x - b[0]) / c), cy = Math.floor((pos.y - b[1]) / c), px = pos.x, py = pos.y;
        for (var y = Math.max(0, cy - 1); y <= Math.min(world.gh - 1, cy + 1); y++) {
            var x0 = Math.max(0, cx - 1), x1 = Math.min(world.gw - 1, cx + 1);
            if (x1 < x0) continue;
            for (var i = s[y * world.gw + x0], end = s[y * world.gw + x1 + 1]; i < end; i += 3) {
                var a = t[i] * 5, d = t[i + 1] * 5, e = t[i + 2] * 5;
                var d1 = (px - v[d]) * (v[a + 1] - v[d + 1]) - (v[a] - v[d]) * (py - v[d + 1]);
                var d2 = (px - v[e]) * (v[d + 1] - v[e + 1]) - (v[d] - v[e]) * (py - v[e + 1]);
                var d3 = (px - v[a]) * (v[e + 1] - v[a + 1]) - (v[e] - v[a]) * (py - v[a + 1]);
                if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) { inside.id = v[a + 4]; inside.h = v[a + 2]; return inside.id; }
            }
        }
        return -1;
    }

    // The building program, ready to draw: `mine` is the building seen through.
    function buildingProgram(V, mine) {
        var u = shared(progs.building, V);
        gl.uniform1f(u.uLift, VIEW.lift);
        gl.uniform1f(u.uLiftCap, VIEW.liftCap * V.unit);
        gl.uniform1f(u.uInside, mine);
        gl.uniform1f(u.uTall, Math.max(1, VIEW.tall));
        var roof = ink('roof'), roofLow = ink('roofLow'), wall = ink('wall');
        gl.uniform3f(u.uRoof, roof[0] / 255, roof[1] / 255, roof[2] / 255);
        gl.uniform3f(u.uRoofLow, roofLow[0] / 255, roofLow[1] / 255, roofLow[2] / 255);
        gl.uniform3f(u.uWall, wall[0] / 255, wall[1] / 255, wall[2] / 255);
        gl.uniform3f(u.uRim, Math.min(1, roof[0] / 255 * 1.08), Math.min(1, roof[1] / 255 * 1.08), Math.min(1, roof[2] / 255 * 1.08));
        gl.uniform2f(u.uFadeAt, V.ox, V.oy - VIEW.fade.up * V.unit);
        gl.uniform2f(u.uFadeSize, VIEW.fade.rx * V.unit, VIEW.fade.ry * V.unit);
        gl.uniform1f(u.uFadeMin, VIEW.fade.min);
        gl.uniform1f(u.uFadeNear, VIEW.fade.near);
        return u;
    }

    function frame(now) {
        queued = false;
        if (!shown || !loaded || !dirty) return;
        dirty = false;

        var dpr = window.devicePixelRatio || 1;
        var rect = canvas.getBoundingClientRect();
        var W = Math.max(2, Math.round(rect.width * dpr)), H = Math.max(2, Math.round(rect.height * dpr));
        if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
        var dt = snapNext ? 10 : Math.min(0.25, lastDraw ? (now - lastDraw) / 1000 : 0.25);
        snapNext = false;
        var climbing = stepAltitude(dt, dt >= 10);
        lastDraw = now;
        var V = view(W, H, dt), R = reach(V), u;
        var mine = (bld && world) ? standingIn() : -1;

        gl.disable(gl.SCISSOR_TEST);
        gl.clearColor(0, 0, 0, 0);
        gl.clearDepth(1);
        gl.depthMask(true);
        gl.colorMask(true, true, true, true);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.disable(gl.DEPTH_TEST);
        // The island is drawn into the panel and nowhere else.
        gl.viewport(V.m, V.m, V.W, V.H);
        gl.scissor(V.m, V.m, V.W, V.H);
        gl.enable(gl.SCISSOR_TEST);
        gl.disable(gl.BLEND);

        // The ground: land, with the survey's sand and sea over it.
        u = shared(progs.ground, V);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, groundTex);
        gl.uniform1i(u.uGround, 0);
        gl.uniform2f(u.uGroundAt, world.ground.x0, world.ground.y0);
        gl.uniform2f(u.uGroundSize, world.ground.w * world.ground.cell, world.ground.h * world.ground.cell);
        var land = ink('land'), water = ink('water'), sand = ink('sand');
        gl.uniform3f(u.uLand, land[0] / 255, land[1] / 255, land[2] / 255);
        gl.uniform3f(u.uWater, water[0] / 255, water[1] / 255, water[2] / 255);
        gl.uniform3f(u.uSand, sand[0] / 255, sand[1] / 255, sand[2] / 255);
        gl.bindVertexArray(progs.quad);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        // Footprints and rail, the roads (which mark themselves in the alpha
        // as road), then yards and lots over them, and the lane lines.
        gl.enable(gl.BLEND);
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        u = shared(progs.flat, V);
        ['footprint', 'rail', 'road', 'bridge', 'lot', 'lane'].forEach(function (name) {
            if (!layers[name]) return;
            var c = ink(name === 'bridge' ? 'road' : name);
            gl.colorMask(true, true, true, name === 'road' || name === 'bridge');
            gl.uniform4f(u.uColour, c[0] / 255, c[1] / 255, c[2] / 255, c.length > 3 ? c[3] : 1);
            drawChunks(layers[name], R);
        });
        gl.colorMask(true, true, true, true);

        if (bld && VIEW.buildings !== false) {
            var cap = VIEW.liftCap * V.unit;
            // What a building covers is taken off the road under it.
            gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
            u = shared(progs.shadow, V);
            gl.uniform1f(u.uLift, VIEW.lift);
            gl.uniform1f(u.uLiftCap, cap);
            gl.uniform1f(u.uShadowMax, VIEW.shadowMax * V.unit);
            var sh = PAINT.shadow;
            gl.uniform4f(u.uColour, sh[0] / 255, sh[1] / 255, sh[2] / 255, sh[3]);
            gl.enable(gl.DEPTH_TEST);
            gl.depthFunc(gl.LESS);
            drawChunks(bld.roof, R);
            gl.clear(gl.DEPTH_BUFFER_BIT);

            // Depth first, colour second: whatever is nearest at a pixel is
            // laid over the ground once, however many walls stand behind it.
            buildingProgram(V, mine);
            gl.colorMask(false, false, false, false);
            drawChunks(bld.roof, R); drawChunks(bld.wall, R);
            gl.colorMask(true, true, true, true);
            gl.depthFunc(gl.EQUAL);
            gl.depthMask(false);
            drawChunks(bld.roof, R); drawChunks(bld.wall, R);
            gl.depthMask(true);
            gl.disable(gl.DEPTH_TEST);
        }

        // The map's see-through: `opacity`, and `roadOpacity` where a road
        // shows (which the alpha now says), then the colours taken down to it.
        gl.bindVertexArray(progs.quad);
        u = shared(progs.fill, V);
        gl.blendColor(0, 0, 0, Math.max(0, Math.min(1, VIEW.roadOpacity - VIEW.opacity)));
        gl.blendFuncSeparate(gl.ZERO, gl.ONE, gl.ONE, gl.CONSTANT_ALPHA);
        gl.uniform4f(u.uColour, 0, 0, 0, Math.max(0, Math.min(1, VIEW.opacity)));
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.blendFuncSeparate(gl.ZERO, gl.DST_ALPHA, gl.ZERO, gl.ONE);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        // The GPS line, solid, over the buildings.
        if (routeCount) {
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            u = shared(progs.route, V);
            gl.bindVertexArray(progs.routeVao);
            var half = 0.5 * Math.max(VIEW.route.lane * V.s, VIEW.route.minWidth * V.unit);
            gl.uniform1f(u.uHalf, half);
            gl.uniform1f(u.uFadeR, Math.max(1, VIEW.route.fade * V.unit));
            gl.uniform1f(u.uFrom, VIEW.route.from);
            // The line is made of overlapping pieces. Depth lets each pixel be
            // painted by one of them only, so where it is faded it fades
            // evenly and not in patches: the fill first, then the rim round it.
            gl.enable(gl.DEPTH_TEST);
            gl.depthFunc(gl.LESS);
            routes.forEach(function (r) {
                var st = startOf(r, pos.x, pos.y), at = project(V, st.x, st.y);
                gl.uniform1f(u.uStart, st.s - 0.01);
                gl.uniform2f(u.uStartAt, at.x, at.y);
                gl.uniform1f(u.uZ, 0.0);
                gl.uniform1f(u.uRim, 0.0);
                gl.uniform4f(u.uColour, r.rgb[0] / 255, r.rgb[1] / 255, r.rgb[2] / 255, 1);
                gl.drawArrays(gl.TRIANGLES, r.from, r.count);
                gl.uniform1f(u.uZ, 0.2);
                gl.uniform1f(u.uRim, VIEW.route.rim * V.unit);
                gl.uniform4f(u.uColour, r.rim[0] / 255, r.rim[1] / 255, r.rim[2] / 255, 1);
                gl.drawArrays(gl.TRIANGLES, r.from, r.count);
                gl.clear(gl.DEPTH_BUFFER_BIT);
            });
            gl.disable(gl.DEPTH_TEST);
        }

        gl.blendFunc(gl.ZERO, gl.SRC_ALPHA);
        u = shared(progs.corners, V);
        gl.uniform1f(u.uCorner, V.corner);
        gl.bindVertexArray(progs.quad);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        gl.disable(gl.SCISSOR_TEST);
        gl.viewport(0, 0, W, H);
        // The outline, astride the edge.
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        u = shared(progs.frame, V);
        gl.uniform1f(u.uCorner, V.corner);
        gl.uniform1f(u.uWidth, VIEW.frame * V.unit);
        gl.uniform4f(u.uColour, VIEW.frameAlpha, VIEW.frameAlpha, VIEW.frameAlpha, VIEW.frameAlpha);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        drawSprites(V);
        gl.bindVertexArray(null);
        // Carried on without being asked while the zoom or height still eases.
        if (V.easing || climbing) invalidate();
    }

    /* --- what sits on top: blips, the route's end, north, the player ------ */

    // A world point on the ground through the camera: place() in the
    // shaders, here. `to` is which way it lies from the marker ON THE PANEL,
    // which is what pins it to the edge when it is out of view.
    function project(V, x, y) {
        var dx = x - pos.x, dy = y - pos.y;
        var u = V.s * (dx * V.cos + dy * V.sin), g = V.s * (dy * V.cos - dx * V.sin);
        var w = 1 + V.T * g + V.leanZ;
        var p = { u: u, g: g, w: w, x: V.ox + u / w, y: V.oy - (g - V.alt) / w };
        var behind = w < 0.25, tx = behind ? u : p.x - V.ox, ty = behind ? -(g - V.alt) : p.y - V.oy;
        if (Math.abs(tx) + Math.abs(ty) < 1e-6) { tx = 0; ty = -1; }
        p.to = [tx, ty];
        return p;
    }

    // Distance outside the panel's rounded outline (negative inside).
    function outline(V, x, y, r) {
        var qx = Math.abs(x - V.W / 2) - (V.W / 2 - r), qy = Math.abs(y - V.H / 2) - (V.H / 2 - r);
        return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
    }

    // Where a ray from the player meets the outline, `inset` pixels in.
    function edgePoint(V, dx, dy, r, inset) {
        var len = Math.hypot(dx, dy) || 1, lo = 0, hi = V.W + V.H;
        dx /= len; dy /= len;
        for (var i = 0; i < 24; i++) {
            var mid = (lo + hi) / 2;
            if (outline(V, V.ox + dx * mid, V.oy + dy * mid, r) < -inset) lo = mid; else hi = mid;
        }
        return { x: V.ox + dx * lo, y: V.oy + dy * lo };
    }

    var spriteN = 0;
    function sprite(cx, cy, size, rot, u0, v0, u1, v1, tint) {
        if (spriteN >= SPRITE_BATCH) return;
        var h = size / 2, c = Math.cos(rot), s = Math.sin(rot), o = spriteN * 48, d = spriteData;
        var corners = [[-h, -h, u0, v0], [h, -h, u1, v0], [h, h, u1, v1], [-h, -h, u0, v0], [h, h, u1, v1], [-h, h, u0, v1]];
        for (var i = 0; i < 6; i++) {
            var k = corners[i];
            d[o++] = cx + k[0] * c - k[1] * s; d[o++] = cy + k[0] * s + k[1] * c;
            d[o++] = k[2]; d[o++] = k[3];
            d[o++] = tint[0]; d[o++] = tint[1]; d[o++] = tint[2]; d[o++] = tint[3];
        }
        spriteN++;
    }
    function flush(tex, V) {
        if (!spriteN) return;
        gl.useProgram(progs.sprite.p);
        gl.uniform2f(progs.sprite.u.uPanel, V.Wc, V.Hc);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(progs.sprite.u.uTex, 0);
        gl.bindVertexArray(progs.spriteVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, spriteBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, spriteData.subarray(0, spriteN * 48));
        gl.drawArrays(gl.TRIANGLES, 0, spriteN * 6);
        spriteN = 0;
    }

    function uiCell(i) { return [i / UI.cells, 0, (i + 1) / UI.cells, 1]; }
    function uiSprite(i, x, y, size, rot, tint) {
        var c = uiCell(i);
        sprite(x, y, size, rot, c[0], c[1], c[2], c[3], tint);
    }

    // A painted disc of radius r.
    function disc(x, y, r, tint) { uiSprite(UI.dot, x, y, r / DISC, 0, tint); }

    function drawSprites(V) {
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        var corner = V.corner, m = V.m, u = V.unit, size = VIEW.blip * u;
        var dots = [], i, b, p, at, on, cell, cols, rows, cx, cy;

        // Draw resource blips above the scene, regardless of building depth.
        var count = blips.length + (waypoint && !waypointTint ? 1 : 0);
        for (i = 0; i < count; i++) {
            b = i < blips.length ? blips[i] : waypoint;
            var spr = b[2], edge = (b[7] & 1) === 1;
            cell = atlasTex && atlas ? atlas.cells[spr] : null;
            p = project(V, b[0], b[1]);
            var k = p.w >= 0.25 ? 1 / p.w : 1;
            var r = VIEW.dot * u * ((b[7] & 2) ? 1.5 : 1) * Math.max(0.6, Math.min(1.25, k));
            on = p.w >= 0.25 && outline(V, p.x, p.y, corner) <= 0;
            if (on) {
                at = p;
            } else {
                if (!edge) continue;
                at = edgePoint(V, p.to[0], p.to[1], corner, 0);
            }
            var tint = [b[3] / 255, b[4] / 255, b[5] / 255, b[6] / 255];
            if (cell != null) {
                if (spriteN === SPRITE_BATCH) flush(atlasTex, V);
                cols = atlas.cols; rows = atlas.rows; cx = cell % cols; cy = Math.floor(cell / cols);
                sprite(at.x + m, at.y + m, size, 0, cx / cols, cy / rows, (cx + 1) / cols, (cy + 1) / rows, tint);
            } else {
                dots.push([at.x, at.y, r, tint]);
            }
        }
        if (atlasTex) flush(atlasTex, V);
        else spriteN = 0;

        // A dot, with its shadow down and to the right.
        for (i = 0; i < dots.length; i++) {
            if (spriteN + 2 > SPRITE_BATCH) flush(uiTex, V);
            var q = dots[i];
            disc(q[0] + m + 0.45 * u, q[1] + m + 0.85 * u, q[2] + 0.35 * u, [0, 0, 0, 135 / 255]);
            disc(q[0] + m, q[1] + m, q[2], q[3]);
        }
        flush(uiTex, V);

        if (waypoint && waypointTint) {
            p = project(V, waypoint[0], waypoint[1]);
            on = p.w >= 0.25 && outline(V, p.x, p.y, corner) <= 0;
            var scale = on ? Math.max(0.85, Math.min(1.15, 1 / p.w)) : 1;
            at = on ? p : edgePoint(V, p.to[0], p.to[1], corner, 0);
            var pinTint = [1, 1, 1, 1];
            if (pos.v) uiSprite(UI.ring, at.x + m, at.y + m, VIEW.waypoint.ring * u * scale, 0, pinTint);
            uiSprite(UI.pin, at.x + m, at.y + m, (pos.v ? VIEW.waypoint.pin : VIEW.waypoint.foot) * u * scale, 0, pinTint);
        }

        uiSprite(UI.player, V.ox + m, V.oy + m, VIEW.marker * u, (pos.c - pos.h) * Math.PI / 180, [1, 1, 1, 1]);
        if (VIEW.north) {
            at = edgePoint(V, Math.sin(V.rad), -Math.cos(V.rad), corner, 0);
            uiSprite(UI.north, at.x + m, at.y + m, VIEW.badge * u / DISC, 0, [1, 1, 1, 1]);
        }
        flush(uiTex, V);
    }

    /* --- the route -------------------------------------------------------- */

    // The game hands the line over as points along its road network: unevenly
    // spaced, a lane to one side where two stretches of road meet, and begun
    // at the last junction behind the player rather than at the player. The
    // single-player minimap tidies it so, and this does the same:
    //
    //   tidy()     the line as points 0.75 m apart, smoothed twice -- hard
    //              (8 m) and lightly (2.2 m) -- and the two mixed by how
    //              sharply it turns over 14 m either side: the light one at a
    //              real corner, the hard one where it only steps across a
    //              lane. Kept as every other point, 1.5 m apart.
    //   startOf()  where along it the player is, found again every frame, so
    //              the line begins at them: the nearest point on it -- or,
    //              where it runs back past them first, the first pass within
    //              3 m of that -- if it is within 22 m; its start otherwise.
    var ROUTE = { step: 0.75, heavy: 8, light: 2.2, turn: 14, from: 0.1, over: 0.34, weight: 3, max: 1200, trim: 22, slack: 3 };

    // A Gaussian along the line. Past either end the line is carried on as its
    // own mirror image through the end point, which leaves the ends in place.
    function blur(x, y, step, sigma) {
        var n = x.length, r = Math.max(1, Math.ceil(2.6 * sigma / step)), k = [], sum = 0, i, j;
        for (j = 0; j <= r; j++) { k.push(Math.exp(-0.5 * Math.pow(j * step / sigma, 2))); sum += j ? 2 * k[j] : k[j]; }
        for (j = 0; j <= r; j++) k[j] /= sum;
        var ox = new Float64Array(n), oy = new Float64Array(n);
        for (i = 0; i < n; i++) {
            var sx = k[0] * x[i], sy = k[0] * y[i];
            for (j = 1; j <= r; j++) {
                var a = i - j, b = i + j, ax, ay, bx, by, q;
                if (a >= 0) { ax = x[a]; ay = y[a]; } else { q = Math.min(-a, n - 1); ax = 2 * x[0] - x[q]; ay = 2 * y[0] - y[q]; }
                if (b <= n - 1) { bx = x[b]; by = y[b]; } else { q = Math.max(0, 2 * (n - 1) - b); bx = 2 * x[n - 1] - x[q]; by = 2 * y[n - 1] - y[q]; }
                sx += k[j] * (ax + bx); sy += k[j] * (ay + by);
            }
            ox[i] = sx; oy[i] = sy;
        }
        return [ox, oy];
    }

    function tidy(raw) {
        var p = [], i, j;
        for (i = 0; i + 1 < raw.length; i += 2) {
            if (!p.length || Math.hypot(raw[i] - p[p.length - 2], raw[i + 1] - p[p.length - 1]) > 0.05) p.push(raw[i], raw[i + 1]);
        }
        var n = p.length / 2;
        if (n < 2) return null;
        var along = [0];
        for (i = 1; i < n; i++) along.push(along[i - 1] + Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]));
        var total = along[n - 1], line;
        if (n < 3 || total < 6) line = p;
        else {
            var S = ROUTE.step, m = Math.min(ROUTE.max, Math.floor(total / S) + 1), tail = total - (m - 1) * S > 0.15;
            if (tail) m++;
            var x = new Float64Array(m), y = new Float64Array(m);
            for (i = 0, j = 0; i < m; i++) {
                var at = tail && i === m - 1 ? total : i * S;
                while (j < n - 2 && along[j + 1] < at) j++;
                var len = along[j + 1] - along[j], t = len > 1e-6 ? Math.max(0, Math.min(1, (at - along[j]) / len)) : 0;
                x[i] = p[j * 2] + (p[j * 2 + 2] - p[j * 2]) * t;
                y[i] = p[j * 2 + 1] + (p[j * 2 + 3] - p[j * 2 + 1]) * t;
            }
            var hard = blur(x, y, S, ROUTE.heavy), soft = blur(x, y, S, Math.max(0.6, ROUTE.light));
            // How sharply the lightly smoothed line turns here, 0-1.
            var reachN = Math.max(2, Math.round(ROUTE.turn / S)), w = new Float64Array(m), none = new Float64Array(m);
            for (i = 0; i < m; i++) {
                var a = Math.max(0, i - reachN), b = Math.min(m - 1, i + reachN);
                var ax = soft[0][i] - soft[0][a], ay = soft[1][i] - soft[1][a], bx = soft[0][b] - soft[0][i], by = soft[1][b] - soft[1][i];
                var turn = (Math.hypot(ax, ay) > 0.5 && Math.hypot(bx, by) > 0.5) ? Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by)) : 0;
                var f = Math.max(0, Math.min(1, (turn - ROUTE.from) / ROUTE.over));
                w[i] = f * f * (3 - 2 * f);
            }
            w = blur(w, none, S, ROUTE.weight)[0];
            line = [];
            for (i = 0; i < m; i += 2) {
                var c = Math.max(0, Math.min(1, w[i]));
                line.push(hard[0][i] + (soft[0][i] - hard[0][i]) * c, hard[1][i] + (soft[1][i] - hard[1][i]) * c);
            }
            if ((m - 1) % 2 !== 0) {
                var e = Math.max(0, Math.min(1, w[m - 1]));
                line.push(hard[0][m - 1] + (soft[0][m - 1] - hard[0][m - 1]) * e, hard[1][m - 1] + (soft[1][m - 1] - hard[1][m - 1]) * e);
            }
        }
        var count = line.length / 2, out = new Float32Array(count * 2), arc = new Float32Array(count);
        for (i = 0; i < count; i++) {
            out[i * 2] = line[i * 2]; out[i * 2 + 1] = line[i * 2 + 1];
            if (i) arc[i] = arc[i - 1] + Math.hypot(line[i * 2] - line[i * 2 - 2], line[i * 2 + 1] - line[i * 2 - 1]);
        }
        return { line: out, arc: arc };
    }

    // Where along the line it starts for a player at px, py: { s, x, y }.
    function startOf(r, px, py) {
        var p = r.line, s = r.arc, n = s.length, best = -1, bestT = 0, bestD = Infinity, i;
        if (n < 2) return { s: 0, x: n ? p[0] : px, y: n ? p[1] : py };
        function near(j) {
            var ax = p[j * 2], ay = p[j * 2 + 1], dx = p[j * 2 + 2] - ax, dy = p[j * 2 + 3] - ay, len = dx * dx + dy * dy;
            var t = len > 1e-9 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
            var ex = ax + dx * t - px, ey = ay + dy * t - py;
            return [ex * ex + ey * ey, t];
        }
        for (i = 0; i < n - 1; i++) { var a = near(i); if (a[0] < bestD) { bestD = a[0]; best = i; bestT = a[1]; } }
        var lim = Math.pow(Math.sqrt(bestD) + ROUTE.slack, 2);
        for (i = 0; i < n - 1; i++) { var b = near(i); if (b[0] <= lim) { best = i; bestT = b[1]; bestD = b[0]; break; } }
        if (best < 0 || bestD >= ROUTE.trim * ROUTE.trim) return { s: 0, x: p[0], y: p[1] };
        return { s: s[best] + (s[best + 1] - s[best]) * bestT,
                 x: p[best * 2] + (p[best * 2 + 2] - p[best * 2]) * bestT,
                 y: p[best * 2 + 1] + (p[best * 2 + 3] - p[best * 2 + 1]) * bestT };
    }

    function setRoutes(src) {
        var v = [], FAN = 8;
        routeSrc = list(src);
        if (!gl) return;
        routes = [];
        routeSrc.forEach(function (r) {
            var rgb = list(r.rgb);
            if (rgb.length !== 3) return;
            var made = tidy(list(r.pts));
            if (!made) return;
            var p = made.line, s = made.arc, n = s.length, from = v.length / 7;
            for (var i = 0; i < n; i++) {
                var x = p[i * 2], y = p[i * 2 + 1], d = s[i];
                // Which way the line is going here, for the round join.
                var i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
                var tx = p[i1 * 2] - p[i0 * 2], ty = p[i1 * 2 + 1] - p[i0 * 2 + 1], tl = Math.hypot(tx, ty) || 1;
                tx /= tl; ty /= tl;
                for (var f = 0; f < FAN; f++) {
                    var a0 = f / FAN * 6.2832, a1 = (f + 1) / FAN * 6.2832;
                    v.push(x, y, 0, 0, d, tx, ty, x, y, Math.cos(a0), Math.sin(a0), d, tx, ty, x, y, Math.cos(a1), Math.sin(a1), d, tx, ty);
                }
                if (i + 1 >= n) break;
                var bx = p[i * 2 + 2], by = p[i * 2 + 3], dx = bx - x, dy = by - y, len = Math.hypot(dx, dy), e = s[i + 1];
                if (len < 1e-4) continue;
                var nx = -dy / len, ny = dx / len;
                v.push(x, y, nx, ny, d, 0, 0, x, y, -nx, -ny, d, 0, 0, bx, by, -nx, -ny, e, 0, 0,
                       x, y, nx, ny, d, 0, 0, bx, by, -nx, -ny, e, 0, 0, bx, by, nx, ny, e, 0, 0);
            }
            routes.push({ from: from, count: v.length / 7 - from, line: p, arc: s,
                          rgb: rgb, rim: lighten(rgb) });
        });
        routeCount = v.length / 7;
        gl.bindBuffer(gl.ARRAY_BUFFER, routeBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.DYNAMIC_DRAW);
    }

    function lighten(c) {
        return [c[0] + (255 - c[0]) * 0.45, c[1] + (255 - c[1]) * 0.45, c[2] + (255 - c[2]) * 0.45];
    }

    /* --- messages --------------------------------------------------------- */

    function setShown(on) {
        shown = on && !glFailed;
        if (canvas) canvas.classList.toggle('hidden', !(shown && loaded));
        if (shown) { zoomNow = -1; lastDraw = 0; invalidate(); }
    }

    window.addEventListener('message', function (e) {
        var d = e.data;
        if (!d || typeof d.action !== 'string' || d.action.indexOf('map3d') !== 0) return;
        if (d.action === 'map3dPos') {
            pos.x = d.x; pos.y = d.y; pos.c = d.c; pos.h = d.h; pos.s = d.s || 0;
            pos.v = d.v === true; pos.air = Number(d.air) || 0;
            pos.g = Number(d.g) || 0; pos.a = (typeof d.a === 'number') ? d.a : null;
        } else if (d.action === 'map3d') {
            if (d.config) { merge(VIEW, d.config.view); merge(PAINT, d.config.paint); merge(NIGHT, d.config.paintNight); }
            if (typeof d.night === 'number') night = Math.min(1, Math.max(0, d.night));
            if (d.load || d.show) boot();
            if (d.show != null) { wanted = d.show === true; setShown(wanted); }
        } else if (d.action === 'map3dRoute') {
            setRoutes(d.routes);
            waypoint = Array.isArray(d.waypoint) ? d.waypoint : null;
            setWaypointTint(d.waypointTint);
        } else if (d.action === 'map3dBlips') {
            fixed = list(d.list);
            blips = fixed.concat(moving);
        } else if (d.action === 'map3dHeights') {
            setHeights(list(d.list));
        } else if (d.action === 'map3dMoving') {
            moving = list(d.list);
            blips = fixed.concat(moving);
        }
        invalidate();
    });

    post('map3dHello');
})();
