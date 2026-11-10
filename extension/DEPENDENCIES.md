# Dependency maintenance

This refresh addresses part of [issue #35](https://github.com/KeePassFerry/KeePassFerry/issues/35).
It does not change the KeePass plugin, native host, or Windows integration tests.

## Update scope

- Refresh the lockfile within existing direct dependency ranges where possible,
  including Pinia, Vuetify and build-tool transitive dependencies. The explicit
  range changes and major tool upgrades are listed below.
- Set Vue and its compiler minimums to 3.5.45.
- Upgrade Vite to 6.4.6 and the Vue plugin minimum to 5.2.4 (which supports Vite 6).
- Upgrade UnoCSS and its reset together to 0.65.4 for Vite 6 compatibility.
- Upgrade Vitest to 4.1.12 and web-ext to 10.8.0 to replace older vulnerable
  test/packaging dependency trees.
- Remove the unused `@vitejs/plugin-vue-jsx` and
  `firefox-addons-add-update-version` dependencies. Neither is referenced by
  the tracked source, configuration, or npm scripts.
- Pin TypeScript exactly to the previously used 5.4.5 so a later `npm update`
  does not silently move to 5.9.x. Updating to 5.9.3 exposed new
  `Uint8Array<ArrayBufferLike>` versus WebCrypto `BufferSource` type errors.
  Migrating those annotations is deferred rather than changing cryptographic
  application code as part of this dependency-only refresh.

Use Node.js 24, matching the release workflow. The validation below used
Node.js 24.22.2 and npm 11.19.1 on Linux.

## Audit interpretation

Run the full audit from this directory:

```sh
npm ci --no-audit --no-fund
npm audit --json
```

At review time, the baseline lockfile at commit
`87797221d01b17ee8a50463f4b3c9bf2e1a07396` reported 65 affected packages
(3 low, 23 moderate, 30 high, 9 critical). The refreshed lockfile reported
18 (3 low, 15 moderate, **0 high, 0 critical**). These are npm package-level
classifications, including transitive and propagated findings, not a count
of demonstrated exploitable defects. Advisory data can change independently
of this repository.

`npm audit --omit=dev` is not a sufficient shipped-code check: libraries used
by the browser extension, including Vue and Vuetify, are declared under
`devDependencies` and bundled at build time. Conversely, not every tool in
that dependency tree is shipped to users. No blanket advisory suppression
or forced cross-major override was added.

### Remaining findings and follow-up

| Dependency chain | Context and next step |
| --- | --- |
| `@typescript-eslint/*` | ESLint tooling. Updating this stack requires a coordinated lint/parser migration, not downgrading to the version suggested by an automatic audit fix. |
| `vue-tsc` / `@vue/language-core` | Type-checking tooling. Assess alongside the deferred TypeScript migration. |
| `@vue/test-utils` / `js-beautify` / `editorconfig` / `glob` / `minimatch` | Test formatting/tooling. Assess individual advisory preconditions; update as upstream compatible fixes become available. |
| `rimraf` / `glob` | Build cleanup. Do not equate tool reachability on developer-controlled paths with a browser-side exploit. |
| `unplugin-auto-import` / `unplugin-vue-components` / `minimatch` | Build-time transforms. A larger plugin migration remains separate from this refresh. |
| `web-ext` / `addons-linter` / `deepmerge` | Remaining low-severity packaging/linting findings. Keep monitoring upstream; the packaging command was exercised locally. |

This grouping is initial execution-context triage, not an assertion that all
remaining advisories are inapplicable. Review their actual inputs and
preconditions before deciding whether to accept or suppress any finding.

## Verification

After a clean `npm ci`, the following succeeded on Linux with Node.js 24:

```sh
npx vitest run
npm run tsc
npm run build-chrome:prod
mkdir -p dist
npm run pack-chrome:prod
```

The existing suite reported 174 passing tests, 26 passing test files and one
skipped test file. The Chrome ZIP's manifest and archive integrity were
checked. The existing ZIP script requires its `dist` destination directory
to exist; `mkdir -p dist` above supplies that precondition.

The updated web-ext packaging path was also exercised with
`web-ext build --source-dir extension --artifacts-dir <output-directory> --overwrite-dest`.
Packaging is not Firefox runtime validation.

Installation/build output still includes deprecation/configuration warnings
and build-time unresolved static asset warnings. A successful build is not
an interactive UI smoke test. No Windows, live KeePass, browser-store
submission, or real-credential end-to-end test was performed. Maintainers
should smoke-test the extension UI and KeePass integration before release,
especially because bundled UI dependencies were refreshed as well as tools.
