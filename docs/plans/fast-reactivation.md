# Fast Reactivation Implementation Plan

## Goal

Keep deliberate first activation (1,500 ms), then allow fast reacquisition
(200 ms) within a shared interaction session. Expire the session after 30 seconds
without detecting the controlling hand. Do not create separate nested session
objects or couple this lifecycle to saved albums.

## Implementation

- Manage session timing inside `ControllerLock`, shared by the app and playground.
- Add `reacquireDwellMs` and `sessionIdleTimeoutMs` configuration.
- Open or refresh the session only upon successful control and controller sightings.
- Preserve the existing 1,500 ms missing-hand lock timeout and active countdowns.
- Permit any eligible hand to reacquire after release; never steal an existing lock.
- Restart cold arming when a warm session expires mid-acquisition.
- End the session on manual release or engine stop.
- Remove frontend warm-mode switching after photos or returning to the camera.
- Preserve explicit hold-time override APIs without letting an override alone
  open or extend the session.

## Validation

Use timestamp-driven Vitest cases for cold and warm boundaries, repeated
acquisition, changed hand IDs, short tracking loss, multiple people, expiration
at 30 seconds and during arming, invalid gestures/confidence/zones, explicit
release, engine stop, override compatibility, and countdown completion.
Run both workspace test suites, frontend lint, and the root build.
Check actual webcam behavior for lowering hands, switching people, and taking
multiple photos; tune the 200 ms default only with observed interaction evidence.
