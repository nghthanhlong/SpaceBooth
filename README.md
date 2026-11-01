# SpaceBooth

## Run the app

Install dependencies from the repository root, then start the frontend:

```bash
npm install
npm run dev
```

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

## Test photo storage

Run `npm run dev`, allow camera access, and wait for the camera status to show
that it is active. Use **Chụp ảnh** or the Victory-hand countdown to capture up
to five photos. The camera toolbar shows the capture count and **Lưu album**;
use it to upload the photos and create a Firestore document in the `sessions`
collection. The **Album đã lưu** section reads and displays the 20 most recent
sessions. Photo files are hosted on Cloudinary; Firestore stores their URLs and
session metadata. Both services must be reachable and allow the configured
operations.
