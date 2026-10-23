# EMPRO Ironworker (PWA)
Static, no build step. Serve the folder (`npm run serve`) and open it. Tests: `npm test` (node --test, 27 tests).
- `js/calc.js`: pure calculation logic (tonnage for round/square/rect/oblong/hex/custom, clearance, die size, stock lookup, machine limits).
- `js/tooling.js`: pure inventory logic (merge sheet + device edits, validation, CSV/JSON import/export). `js/store.js` = localStorage.
- `data/materials.json`: shear strengths, clearance table (`steps[].sheet` = Nick's original O3; active = with the aluminum fix), sources.
- `data/tooling.json` + `data/sizes.json`: from the sheet (`tools/extract.py`; group kinds set in GROUP_KIND).
- `data/machines.json`: Edwards 120T default with cited spec fields; device-added machines live in localStorage.
- `tools/make_fixtures.py`: recalculates Nick's exact formulas in LibreOffice to make test fixtures.
- URL params: `?tab=punch|tooling`.

## Publish on GitHub Pages

Merge to `main`, then turn Pages on once. This app is already static, so publish the branch itself. A GitHub Actions workflow cannot create the Pages site: the default `GITHUB_TOKEN` is not allowed to, even with `enablement: true` on `actions/configure-pages`.

1. Open the repository **Settings** tab: https://github.com/bmxnick101/Ironworker/settings/pages
2. In the left sidebar, under **Code and automation**, click **Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
4. Set the branch to **main** and the folder to **/ (root)**.
5. Click **Save**.

The site is https://bmxnick101.github.io/Ironworker/ (capital I). The first publish usually finishes within a minute. On the iPad, open that URL in Safari and use Share → Add to Home Screen.

`index.html`, `sw.js`, `manifest.webmanifest`, and `js/data.js` use relative URLs, so the same files load from a local server at `/` and from the `/Ironworker/` Pages path. `.nojekyll` makes Pages serve the files directly. The service worker cache is `empro-ironworker-v5`.

`tools/source.xlsx` stays off the repo (see `.gitignore`). Regenerate the JSON with `python3 tools/extract.py tools/source.xlsx` on a machine that has the spreadsheet.
