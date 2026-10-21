# End-to-end tests

Each script drives the real application in headless Chrome over the DevTools
protocol and prints `PASS`/`FAIL` lines and a total. They are run before every
release; the validation pack (kionel.com/validation-pack.html) lists the suites
and their check counts for the published version.

```
pnpm --filter @kionel/web build && pnpm --filter @kionel/web preview   # https://localhost:4173
node tools/e2e/<script>.mjs <scratch-dir> https://localhost:4173 <path/to/license.json>
```

- `<scratch-dir>`: a Windows path (`pwd -W`) for temporary files and Chrome profiles.
- `e2e-free.mjs` needs no licence. `e2e-offline.mjs` and `e2e-filecam.mjs` take the
  offline package's `file:///…/kionel-offline-<version>.html` instead of the URL.
- `e2e-tsa.mjs` forwards the app's timestamp request to timestamp.digicert.com
  (only a SHA-256 fingerprint leaves the machine).
- Chrome is expected at `C:/Program Files/Google/Chrome/Application/chrome.exe`.
- `e2e-package.mjs` is the release acceptance test: it downloads the latest package from the
  site with a real browser, checks its SHA-256 against `tools/offline-releases.json`, and uses
  that file as sender and receivers. Run it against https://kionel.com after deploying.
- `LIVE=1 node tools/e2e/e2e-tsa.mjs … https://kionel.com …` sends the timestamp request through
  the deployed relay instead of forwarding it from the test.
