# Contributing

## How changes land

- Branch from `dev` and open a pull request against `dev`. Releases are promoted from `dev` to `main`
  and tagged on `main`.
- CI must pass: the type check, the Jest suite, the generated-resource and SBOM checks, and the
  Release iOS build.
- Run the same checks locally before you push:

  ```sh
  npm run typecheck && npm test && npm run check:ui-resources && python3 scripts/sbom.py --check
  ```

## Conventions

- Every UI string lives in `src/locales/en.jsonc`, and every design value in `src/ui/tokens.jsonc`.
  After editing either, run `python3 scripts/generate-ui-resources.py`.
- After changing dependencies, run `python3 scripts/sbom.py` and commit `sbom/`.
- Import the SDK only through `@kenshiki/identity-capture`. Personal data stays in the SDK's native
  sheets; React receives only each step's status.
- Tests use synthetic data only.

## Reporting problems

Open an issue for a bug or an integration question. Report security problems privately, as
[SECURITY.md](SECURITY.md) describes.
