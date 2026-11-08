# FarmConnect Complete

This package combines the FarmConnect frontend, produce catalog/images support, and Node/SQLite backend in one project.

## Structure

- `index.html` — main FarmConnect website.
- `produce/produce-list.csv` — all 110 produce names used by the website, with matching image slugs.
- `produce/` — local-photo folder. If a matching photo exists (`tomato.jpg`, `apple.jpg`, etc.), the website uses it first.
- `produce/download_images.py` — downloads missing Wikipedia/Wikimedia thumbnails when run on a computer with internet access.
- `server/` — Node/SQLite backend and seed data.

## Images

The website tries local files in `produce/` first. If a local image is not present, the website's existing image loader fetches a real Wikipedia/Wikimedia image for the produce name. Therefore the product cards can show real produce images without needing a second ZIP.

## Important for GitHub Pages

GitHub Pages can run the `index.html` frontend and the remote produce-image fallback, but it cannot run `server/server.js`.

For the complete live system (login, farmer/customer data, orders, etc.), deploy the `server/` folder to a Node hosting service such as Render and serve the same `index.html` from that server. The included `server/render.yaml` is retained for this.

If you only want the static GitHub Pages version, upload the contents of this folder to the repository root and enable GitHub Pages from the repository branch/root.

## Updating an existing GitHub repository

1. Keep a backup/clone of your current repository.
2. Replace the old `index.html` with this package's `index.html`.
3. Replace the old `produce/` folder with this package's `produce/` folder.
4. Add/update the `server/` folder if you want the backend in the same GitHub repository.
5. Commit and push the changes.
6. Wait for GitHub Pages to publish, then hard-refresh the site (`Ctrl+F5`).

Do not delete your old repository history; replacing files in a commit does not erase previous commits.


## Produce photos on GitHub Pages
The static `index.html` loads `produce/catalog.json`. If a bundled image exists it uses that image; otherwise it requests the item's thumbnail from the Wikipedia REST API in the visitor's browser. The browser caches successful results in local storage. GitHub Pages can serve this because the frontend is static and does not require Node.js for the photo lookup. Internet access is required for Wikipedia images.
