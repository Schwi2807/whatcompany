# WhatCompany

Offline-first career-fair PWA (vanilla HTML/CSS/JS, no build step). All data stays on the device (IndexedDB).

## Publish to GitHub Pages

1. Push this folder to a GitHub repo (files at the repo root).
2. Repo → Settings → Pages → Source: "Deploy from a branch", branch `main`, folder `/ (root)` → Save.
3. Wait for the URL: `https://<user>.github.io/<repo>/`. All paths are relative, so the subpath works.
4. On later deploys, bump `VERSION` in `sw.js` so installed copies update (they update on the next launch after that; close and reopen once more to see it).

## iPad setup (do it in this exact order, while online)

1. Open the Pages URL in **Safari** (online).
2. Tap **Share** → **Add to Home Screen** → Add.
3. Open WhatCompany **from the Home Screen icon**.
4. **Then** upload your CV (CV tab) and fill in Me, inside the installed app.
   iOS keeps Safari and Home Screen app storage separate, so anything entered in the Safari tab will not appear in the installed app.

After the first launch from the icon the app works fully offline (airplane mode is fine).

Tip: after the fair, Me → Data → Export backup (JSON) and Export companies (CSV) → Save to Files.
