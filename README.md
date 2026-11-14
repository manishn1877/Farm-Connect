# 🌾 FarmConnect

**Connecting farmers directly with customers: fresh produce, fair prices, no middlemen.**

[**🌐 Live demo**](https://manishn1877.github.io/Farm-Connect/) · [**🐛 Report a bug**](https://github.com/manishn1877/Farm-Connect/issues) · [**💡 Request a feature**](https://github.com/manishn1877/Farm-Connect/issues) · [**🤝 Contribute**](CONTRIBUTING.md)

![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)
![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)
![Good first issues](https://img.shields.io/badge/good%20first%20issues-available-blue.svg)

<!-- Add a screenshot or GIF here, e.g. ![FarmConnect screenshot](docs/screenshot.png) -->

---

## Why FarmConnect?

Farmers often lose a large share of their income to middlemen, while customers pay more for produce that has travelled through many hands. FarmConnect is an open-source platform that lets farmers list their produce and customers browse and order it directly.

## Features

- 🥕 **110-item produce catalog** with matching photos
- 🖼️ **Smart image loading**: local photos first, with an automatic Wikipedia/Wikimedia fallback
- 👨‍🌾 **Farmer and customer data**, login and orders (via the Node/SQLite backend)
- 🌐 **Static frontend** that runs on GitHub Pages with no server needed for browsing
- 🗄️ **Node.js + SQLite backend** with seed data, ready to deploy on Render

## Live demo

The demo at **https://manishn1877.github.io/Farm-Connect/** is the **static frontend only**. GitHub Pages cannot run the Node server, so login, farmer/customer data and orders need the backend running (see below).

## Project structure

```
Farm-Connect/
├── index.html              # Main FarmConnect website (frontend)
├── produce/
│   ├── produce-list.csv    # All 110 produce names with matching image slugs
│   ├── catalog.json        # Catalog loaded by the website
│   ├── download_images.py  # Downloads missing Wikipedia/Wikimedia thumbnails
│   └── *.jpg               # Optional local photos (tomato.jpg, apple.jpg, ...)
├── server/                 # Node.js + SQLite backend and seed data
│   └── render.yaml         # Render deployment config
├── data/                   # Data files
├── scripts/                # Helper scripts
├── fetch_prices.py         # Price fetching script
├── public/                 # Static assets
├── GUIDE.txt               # Extra setup notes
└── .github/workflows/      # GitHub Actions
```

## Getting started

### Option 1: Frontend only (quickest)

Open `index.html` in your browser, or serve the folder:

```bash
# from the project root
python -m http.server 8000
# then visit http://localhost:8000
```

Produce photos need an internet connection for the Wikipedia fallback.

### Option 2: Full app with backend

Requires [Node.js](https://nodejs.org/) (LTS recommended).

```bash
git clone https://github.com/manishn1877/Farm-Connect.git
cd Farm-Connect/server
npm install
node server.js
```

The server serves the same `index.html`, so the complete system (login, farmer/customer data, orders) runs together. Check `GUIDE.txt` and the `server/` folder for the port and any configuration.

### Optional: download produce photos locally

```bash
python produce/download_images.py
```

This downloads missing Wikipedia/Wikimedia thumbnails into `produce/` so the site doesn't need to fetch them at runtime.

## How produce images work

1. The site loads `produce/catalog.json`.
2. If a bundled photo exists (for example `produce/tomato.jpg`), it is used first.
3. Otherwise the visitor's browser requests the item's thumbnail from the Wikipedia REST API.
4. Successful lookups are cached in the browser's local storage.

## Deployment

**Static version (GitHub Pages):** push to the repository, then enable Pages under *Settings → Pages* using the branch and root folder. Hard-refresh (`Ctrl+F5`) after it publishes.

**Full version (Node server):** deploy the `server/` folder to a Node host such as [Render](https://render.com) using the included `server/render.yaml`, and serve `index.html` from that server.

## Contributing

Contributions of all sizes are welcome: code, design, translations, docs, bug reports and ideas.

1. Read the [Contributing Guide](CONTRIBUTING.md).
2. Pick an issue labeled [`good first issue`](https://github.com/manishn1877/Farm-Connect/labels/good%20first%20issue).
3. Fork, branch, make your change and open a pull request.

## Roadmap

- [ ] Search and filter produce
- [ ] Multi-language support (Hindi, Kannada, more)
- [ ] Farmer profile pages
- [ ] Improved mobile layout
- [ ] API documentation
- [ ] Order tracking

Have an idea? [Open an issue](https://github.com/manishn1877/Farm-Connect/issues).

## License

Released under the [MIT License](LICENSE).

## Author

Built by [@manishn1877](https://github.com/manishn1877). If FarmConnect is useful to you, please ⭐ the repo!
