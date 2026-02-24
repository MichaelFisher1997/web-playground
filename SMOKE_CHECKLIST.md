# Smoke Checklist

Use this quick checklist after gameplay/runtime refactors.

## Startup

- Run `bun run dev` and verify the scene loads without console errors.
- Confirm menu transitions work: main menu -> play menu -> back.

## Sandbox Mode

- Enter sandbox mode and verify pointer lock engages on click.
- Toggle sandbox panel with `G` and verify values regenerate terrain.
- Toggle spawn panel with `P`, place a ship, and verify buoyancy updates.

## Play Mode

- Start play mode and verify health/stamina bars are visible.
- Verify movement feels correct (WASD, jump, sprint, camera look).
- Enter/exit boat with `E` and verify boat driving + anchor behavior.
- Toggle god mode with `Y` and verify transitions in/out are stable.

## Maps and UI

- Open global map with `M`, pan, recenter, close, and confirm pointer lock recovers.
- Verify minimap appears in sandbox/play and hides in menu states.
- Open ESC menu and check players tab rendering.

## Rendering and Resize

- Resize the window and verify camera, water, and UI scale correctly.
- Move underwater and back above water; verify fog transition remains smooth.
