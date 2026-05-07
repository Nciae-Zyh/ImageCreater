# ImageCreater

ImageCreater is an Electron desktop app for AI chat + image generation/editing.

## Development

Requirements:
- Node.js 20+
- pnpm 9+

Install and run:

```bash
pnpm install
pnpm dev
```

Type check:

```bash
pnpm typecheck
```

## Local Build

Build renderer/main/preload:

```bash
pnpm build
```

Platform package:

```bash
pnpm build:mac
pnpm build:win
pnpm build:linux
```

Artifacts are generated in `dist/`.

## CI Build and Auto Release (This Repo)

Workflow file: `.github/workflows/build.yml`

Trigger:
- Push a tag that starts with `v` (example: `v1.0.1`)

What CI does:
1. Build on macOS/Linux/Windows (matrix jobs)
2. Upload all artifacts
3. Create a GitHub Release in this repository and attach artifacts

### Publish a new version

```bash
git tag v1.0.1
git push origin v1.0.1
```

After the workflow succeeds, a Release will be created automatically.

## Notes About Common CI Errors

### 1) `GitHub Personal Access Token is not set ... GH_TOKEN`

Cause:
- `electron-builder` may try to publish automatically in CI.

Fix in this repo:
- Build scripts are configured with `--publish never`.
- Actual release publishing is handled only by GitHub Actions `softprops/action-gh-release`.

So for this repo you usually do not need to configure a PAT manually.

### 2) macOS `hdiutil` intermittent failure when building DMG

Cause:
- `hdiutil` on GitHub macOS runners can be flaky.

Fix in this repo:
- mac build step retries once automatically in CI.
- `strategy.fail-fast: false` avoids canceling other platform jobs immediately.

## GitHub Permissions

For auto release, ensure repository Actions permission allows writing contents:

- Repository `Settings` -> `Actions` -> `General`
- `Workflow permissions`: select **Read and write permissions**

The workflow already sets:

```yaml
permissions:
  contents: write
```

## License

MIT
