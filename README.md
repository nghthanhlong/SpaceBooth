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

If model downloads were skipped because the machine was offline, run
`npm run setup` after reconnecting, then restart the dev server.

Run `npm run build` to type-check the CV module and build the frontend.
