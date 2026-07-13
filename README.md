# Steward

Step 1 desktop scaffold. The renderer has no Node access; its only native capability is `window.steward.pickFolder()`, exposed by a context-isolated preload script.

## Run

```bash
npm install
npm run dev
```

## Verify

```bash
npm run typecheck
npm run build
```

No folder contents are read, indexed, sent anywhere, modified, or deleted in this step.
