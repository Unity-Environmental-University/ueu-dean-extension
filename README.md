# Dean Tools

A browser extension that lives between Stratus and Canvas and makes the next step shorter.

When you're on a case, the student's Canvas grades are three tabs away. This gets it to one button.

**[Documentation](https://unity-environmental-university.github.io/ueu-dean-extension/)** · **[Releases](https://github.com/Unity-Environmental-University/ueu-dean-extension/releases)** · **[Install](https://unity-environmental-university.github.io/ueu-dean-extension/install.html)** · **[Update](https://unity-environmental-university.github.io/ueu-dean-extension/update.html)**

---

## For staff

Download the latest release zip, unzip it, and follow the [install guide](https://unity-environmental-university.github.io/ueu-dean-extension/install.html) to load it into Chrome.

## For developers

```bash
npm install
npm run dev       # development build with watch
npm run build     # production build → dist/chrome/
```

Load the `dist/chrome/` folder as an unpacked extension in `chrome://extensions` with Developer mode on.

Releases are tagged on `main`. To cut a new release, tag and push:

```bash
git tag -a v0.X.0 -m "Release notes"
git push origin v0.X.0
```
