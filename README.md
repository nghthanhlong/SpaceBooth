# SpaceBooth

## Run the app

Install dependencies from the repository root, then start the frontend:

```bash
npm install
npm run dev
```

Copy `frontend/.env.example` to `frontend/.env.local` and fill in the Firebase
client configuration and Cloudinary unsigned upload preset before using albums.
Restart Vite after changing env values. Local env files and private credentials
are ignored by Git; only the empty example is committed. `VITE_*` values are
included in browser bundles: never use them for server API secrets, service
account private keys, or Cloudinary API secrets. Firebase Security Rules and
Cloudinary upload restrictions must enforce access on their respective services.

The frontend is served by Vite. It imports the `spacebooth-cv` workspace package
from `cv-module`, while the CV module's setup script places its MediaPipe WASM
files and models in `frontend/public/mediapipe` for the browser to load.
`CameraStage` starts the CV engine after the frontend camera is ready and passes
its capture event to the existing photo/album flow. For the integrated app,
start only the root dev server; the CV module's own dev server is a separate
debug playground, not a server the frontend needs to connect to.

To run that standalone CV playground instead:

```bash
npm run dev --workspace cv-module
```

If model downloads were skipped because the machine was offline, run
`npm run setup` after reconnecting, then restart the dev server.

Run `npm run build` to type-check the CV module and build the frontend.

## Gesture activation

Hold an open palm for 1.5 seconds to activate control initially. After activation,
reacquiring control takes 200 ms until 30 seconds pass without seeing the
controlling hand. A short disappearance retains the existing lock for 1.5 seconds.
Once that lock is released, anyone in the group can acquire control; the session
does not identify individual people. Manual release or stopping the CV engine
ends the interaction session. This session is separate from saved photo albums.

Timing is configurable with `dwellMs`, `reacquireDwellMs`, and
`sessionIdleTimeoutMs` in the CV controller configuration.

## Sticker ownership

Gesture stickers use a Pose Landmarker Lite model to associate the controlling
hand's wrist with a body and that body's face. Keep your face, shoulders and
wrist in the camera frame. A green outline marks the confirmed face. Point and
hold over a sticker for 700 ms to apply it to that face; uncertain associations
pause sticker selection without blocking other controls. The 200 ms warm
acquisition time does not bypass face confirmation.

Pose runs at most 10 times per second for up to four people. Confirmation needs
three fresh observations spanning 200 ms; evidence expires after 350 ms. The
thresholds are configurable through `EngineConfig.ownership`. This geometric
association is not biometric identification and can refuse ambiguous scenes.

With a mouse, click the desired face before picking a sticker when multiple
faces are visible. If a face track disappears entirely, its stickers are removed
instead of reassigned by position. Missing pose assets disable gesture stickers;
camera capture and explicit mouse selection remain available. Run `npm run setup`
to download the new model. The debug HUD shows FPS, pose time and target status.

Before event use, test 2–4 people crossing arms, hiding wrists, swapping places,
and leaving/re-entering the frame on the booth laptop. Target at least 20 FPS;
automated landmark tests cannot establish real webcam accuracy or performance.

While stickers are placed, face detection runs every processed camera frame.
Pose association is skipped when no hands are visible. Sticker smoothing consumes
each face detection once, using its timestamp rather than the display refresh
rate, and follows faster motion with less smoothing. Same-ID reacquisition attaches
immediately. Frozen fallback transforms are displayed for at most 300 ms; snapshots
also require fresh transforms and omit the live sticker pop animation. Face ID
matching uses bounded short-term motion prediction and defers ambiguous detections
without creating competing duplicate tracks.

## Test photo storage

Run `npm run dev`, allow camera access, and wait for the camera status to show
that it is active. Use **Chụp ảnh** or the Victory-hand countdown to capture up
to five photos. The camera toolbar shows the capture count and **Lưu album**;
use it to upload the photos and create a Firestore document in the `sessions`
collection. The **Album đã lưu** section reads and displays the 20 most recent
sessions. Photo files are hosted on Cloudinary; Firestore stores their URLs and
session metadata. Both services must be reachable and allow the configured
operations.
