# Contributing

## Setup

Requires [Bun](https://bun.sh) 1.3 or newer.

```bash
git clone https://github.com/colevels/tabbrew-cli && cd tabbrew-cli
bun install                 # also runs `wxt prepare` for the extension
bun start --help            # run the CLI from source
```

Before pushing:

```bash
bun run check && bun run typecheck && bun test
```

`bun run check:fix` applies Biome's safe fixes. The e2e suite (`bun run
test:e2e`) needs Chrome for Testing; the README's "Harness extension" section
explains how to run it locally, and CI runs it on every pull request.

## Branches

- `develop` is where work lands. Open pull requests against it from a feature
  branch (`feat/...`, `fix/...`, `chore/...`). Direct pushes are allowed,
  force-pushes are not.
- `main` only moves by a pull request from `develop` with green CI, and every
  release is tagged on `main`.

Browser-facing features come with their extension half, an operator in `sdk/`
that the harness in `extension/` picks up, and an e2e case in `src/e2e/`, so the protocol is exercised in a real Chrome before the
change is considered done. Keep the README's command reference current in
the same pull request.

## Releasing

Releases are cut by pushing a version tag; GitHub Actions
(`.github/workflows/release.yml`) does the rest.

1. Bump `version` in `package.json` and in `sdk/package.json` to the same
   number on a branch off `develop`, open a `chore(release): x.y.z` pull
   request into `develop` and merge it. The CLI, the cheat sheet and the
   extension manifest read the first; `@tabbrew/sdk` is versioned in lockstep,
   so that x.y.z of it speaks the protocol of x.y.z of the CLI. `sdk/` may
import from `src/core`; `src/` must never import from `sdk/`, which the
published CLI does not carry.
2. Open a pull request from `develop` into `main` and merge it.
3. Tag the merge commit on `main` and push the tag:

   ```bash
   git checkout main && git pull
   git tag vX.Y.Z && git push origin vX.Y.Z
   ```

   The workflow refuses a tag that does not match both manifests.
4. The workflow runs the checks, cross-compiles `tabbrew-{darwin,linux}-{arm64,x64}`,
   zips the extension as `tabbrew-extension.zip`, writes `checksums.txt`,
   attests every asset, creates the GitHub Release with generated notes, then
   publishes `tabbrew-cli` and `@tabbrew/sdk` to npm and pushes a regenerated
   `Formula/tabbrew.rb` (from `scripts/homebrew-formula.ts` and the release
   `checksums.txt`) to [colevels/homebrew-tap](https://github.com/colevels/homebrew-tap).
5. Read the generated release notes and edit them where they need a human
   sentence.

The npm jobs need an `NPM_TOKEN` repository secret: a granular access token
from npmjs.com with publish rights on `tabbrew-cli` and on the `@tabbrew`
scope. The homebrew job needs
`HOMEBREW_TAP_TOKEN`: a fine-grained GitHub token scoped to the
`homebrew-tap` repository with Contents read/write.

Users on the prebuilt binary pick the release up with `tabbrew update`;
Homebrew users with `brew upgrade tabbrew`; npm users with
`npm install -g tabbrew-cli@latest`. All then load the new
`tabbrew-extension.zip` in Chrome.
