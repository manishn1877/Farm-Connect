# 🌾 FarmConnect

**Connecting farmers directly with customers: fresh produce, fair prices, no middlemen.**

[**🌐 Live demo**](https://manishn1877.github.io/Farm-Connect/) · [**🐛 Report a bug**](https://github.com/manishn1877/Farm-Connect/issues) · [**💡 Request a feature**](https://github.com/manishn1877/Farm-Connect/issues) · [**🤝 Contribute**](CONTRIBUTING.md)

![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)
![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)
![Good first issues](https://img.shields.io/badge/good%20first%20issues-available-blue.svg)

---

## Why FarmConnect?

Farmers often lose a large share of their income to middlemen, while customers pay more for produce that has travelled through many hands. FarmConnect is an open-source platform that lets farmers list their produce and customers browse and order it directly.

## Features

- 🥕 **110-item produce catalog** with matching photos
- 🖼️ **Smart image loading**: local photos first, with an automatic Wikipedia/Wikimedia fallback
- 👨‍🌾 **Farmer and customer data**, login and orders (via the Node/SQLite backend)
- 📊 **Karnataka mandi price data** fetched from the Government of India's data.gov.in Agmarknet resource
- 🔄 **Automatic price refresh** through GitHub Actions, scheduled twice daily
- 🛡️ **Cloudflare Worker relay** for the official price API, with a shared secret and restricted upstream/parameters
- 🌐 **Static frontend** that runs on GitHub Pages with no server needed for browsing
- 🗄️ **Node.js + SQLite backend** with seed data, ready to deploy on Render

## Live demo

The demo at **https://manishn1877.github.io/Farm-Connect/** is the **static frontend only**. GitHub Pages cannot run the Node server, so login, farmer/customer data and orders need the backend running (see below).

## Mandi price data automation

FarmConnect retrieves official daily wholesale market prices for Karnataka from the Government of India's [Open Government Data Platform](https://data.gov.in/), using the Agmarknet resource **Current Daily Price of Various Commodities from Various Markets (Mandi)** (resource ID: `9ef84268-d588-465a-a308-a864a43d0070`).

The workflow is scheduled for **11:10 AM and 7:10 PM India Standard Time (IST)**. It can also be started manually from **GitHub → Actions → Update daily mandi prices → Run workflow**.

### How the relay works

GitHub-hosted runners may be unable to connect directly to `api.data.gov.in`. The Cloudflare Worker provides a small authenticated HTTPS relay between GitHub Actions and the official data source:

```text
GitHub Actions
     |
     | HTTPS + X-Relay-Token
     v
Cloudflare Worker (authenticated relay)
     |
     | HTTPS + data.gov.in API key
     v
Government of India data.gov.in
     |
     v
scripts/fetch_prices.py
     |
     +--> data/prices.json
     +--> data/board.json
```

The Worker is deployed at [farmconnect-mandi-relay.manishn1877.workers.dev](https://farmconnect-mandi-relay.manishn1877.workers.dev). It is not an open proxy: it checks the relay token, uses a fixed upstream API, and allows only approved query parameters. The API key and relay token belong in secrets, never in source files or logs.

### Required GitHub Actions secrets

Repository maintainers configure these under **Settings → Secrets and variables → Actions**:

| Secret | Purpose |
| --- | --- |
| `DATA_GOV_API_KEY` | API key issued by data.gov.in |
| `FC_RELAY_URL` | Deployed Cloudflare Worker URL |
| `FC_RELAY_TOKEN` | Shared token matching the Worker's `RELAY_TOKEN` secret |

Never commit real secret values, paste them into issues, or include them in screenshots. The detailed deployment, testing, and recovery instructions are in [relay/README.md](relay/README.md).

### Price data files

- `data/prices.json` — aggregated price history used by the application.
- `data/board.json` — market/board-level prices for the Bengaluru-area markets represented in the feed.

The fetch script validates incoming data and avoids replacing usable stored data with an invalid or unexpectedly small result. Check the Actions run logs if an update fails.

## Project structure

```text
Farm-Connect/
├── index.html                  # Main FarmConnect website (frontend)
├── produce/                    # Catalog, produce photos and image helper
├── server/                     # Node.js + SQLite backend and seed data
├── data/
│   ├── prices.json             # Aggregated mandi price data
│   └── board.json              # Market-level price data
├── scripts/
│   └── fetch_prices.py         # Official mandi price fetch and processing
├── relay/
│   ├── worker.js               # Cloudflare Worker relay
│   ├── wrangler.toml           # Worker deployment configuration
│   └── README.md               # Relay setup, secrets, testing and troubleshooting
├── .github/workflows/          # Price update and site deployment workflows
├── GUIDE.txt                   # Extra setup notes
└── CONTRIBUTING.md             # Contribution guidelines
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

**Mandi price automation:** the `Update daily mandi prices` GitHub Actions workflow runs on its schedule and can be run manually. It requires the three repository secrets listed above. See [relay/README.md](relay/README.md) before recreating or moving the Worker.

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
