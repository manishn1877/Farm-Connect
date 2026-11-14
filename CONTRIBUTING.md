# Contributing to FarmConnect

Thank you for helping FarmConnect grow! Every contribution counts, whether it's code, design, translations, documentation, testing or ideas.

## Ways to contribute

- 🐛 Report bugs
- 💡 Suggest features
- 🧑‍💻 Fix issues or build features
- 🎨 Improve UI/UX and mobile layout
- 🌍 Add translations
- 📝 Improve documentation
- 🖼️ Add or improve produce photos
- 🌾 Share feedback from a farmer's or customer's point of view

New here? Look for issues labeled [`good first issue`](https://github.com/manishn1877/Farm-Connect/labels/good%20first%20issue).

## Getting set up

1. **Fork** the repository on GitHub.
2. **Clone** your fork:
   ```bash
   git clone https://github.com/<your-username>/Farm-Connect.git
   cd Farm-Connect
   ```
3. **Run the frontend:** open `index.html`, or run `python -m http.server 8000` and visit `http://localhost:8000`.
4. **Run the backend** (optional, needed for login and orders):
   ```bash
   cd server
   npm install
   node server.js
   ```
   See `GUIDE.txt` for extra notes.

## Making a change

1. Create a branch from `main`:
   ```bash
   git checkout -b feature/short-description
   ```
   Use prefixes like `feature/`, `fix/`, `docs/` or `translation/`.
2. Make your changes, keeping them focused on one thing.
3. Test locally: check the page in your browser (including a phone-sized window) and, if you touched the backend, that the server starts and the affected feature works.
4. Commit with a clear message:
   ```bash
   git commit -m "Add search box to produce catalog"
   ```
5. Push and open a **pull request** against `main`:
   ```bash
   git push origin feature/short-description
   ```
6. In the PR, explain what changed and why, link the issue (for example `Closes #12`), and add screenshots for UI changes.

## Guidelines

- **Keep PRs small and focused.** One feature or fix per PR is easier to review.
- **Follow the existing style** of the file you're editing (indentation, naming).
- **Don't commit secrets**, API keys, `.env` files or local database files.
- **Large images:** keep produce photos small (ideally under 200 KB) and name them with the slug from `produce/produce-list.csv` (for example `tomato.jpg`).
- **Accessibility matters:** use alt text, readable contrast and keyboard-friendly controls.
- **Ask first for big changes.** Open an issue to discuss before starting major work.

## Adding or changing produce

- Edit `produce/produce-list.csv` and `produce/catalog.json` together so they stay in sync.
- Photos go in `produce/` using the matching slug.
- Use only images you have the right to share (your own photos, or public-domain / openly licensed ones), and mention the source in your PR.

## Reporting bugs

Open an [issue](https://github.com/manishn1877/Farm-Connect/issues) and include:

- What you expected and what happened
- Steps to reproduce
- Browser/OS (and Node version, for backend issues)
- Screenshots or error messages if you have them

## Suggesting features

Open an issue describing the problem you want solved, who it helps (farmers, customers, or both) and any ideas for how it could work.

## Code of conduct

Be kind and respectful. We welcome contributors of every background and experience level. Harassment, discrimination and personal attacks are not acceptable, and maintainers may remove comments or contributions that violate this.

## Questions?

Ask in [GitHub Discussions](https://github.com/manishn1877/Farm-Connect/discussions) or open an issue. Thank you for contributing! 🌾
