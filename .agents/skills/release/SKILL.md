---
name: release
description: Use when cutting a Documint release by choosing the version, finalizing the changelog, and bumping package.json so the publish workflow ships the right version.
---

# Release Workflow

`CHANGELOG.md` collects user-facing notes under `## 🗓️ Unreleased` as changes land. A release turns that section into a versioned entry. Publishing a GitHub release then runs `.github/workflows/publish.yml`, which builds the library and publishes the version in `package.json` to npm.

1. Choose the version. Before 1.0, use a minor bump for releases with new behavior or API changes and a patch bump for releases with only small fixes or dependency updates.

1. Finalize the changelog.
   - Rename `## 🗓️ Unreleased` to `## 🗓️ vX.Y.Z (MM-DD-YY)` with the release date.
   - Check the entries against the commits since the last release. Each one should describe what a user or embedder notices, not internal refactors.

1. Set `"version"` in `package.json` to the same version. npm publishes this field, not the changelog heading, and rejects a version it already has.

1. Meet the definition of done in the root `AGENTS.md`, then commit as `Release vX.Y.Z`.

The extensions in `extensions/` keep their own versions and are not part of a library release.
