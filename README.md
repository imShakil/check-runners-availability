# check-runners-availability

A GitHub Action that checks whether any matching self-hosted runner is online
and, by default, **cancels the workflow immediately** if none are. Use it at
the top of a workflow to avoid queuing jobs on a workflow run that will never
make progress.

## How it works

1. Lists self-hosted runners via the GitHub REST API.
2. Filters by `labels` (must have **all** listed labels) and/or `names`
   (comma-separated whitelist of runner hostnames).
3. If at least one matching runner reports `status: online`, the action passes.
4. Otherwise, with `fail-on-offline: true` (the default), the step fails so
   downstream jobs are skipped.

## Inputs

| Name | Required | Default | Description |
| ------ | ---------- | --------- | ------------- |
| `token` | no | `${{ github.token }}` | Token used to call the API. Needs `actions: read` for the repo (and `admin:org` for org scope with a PAT). |
| `scope` | no | `repo` | `repo` lists runners registered on this repo; `org` lists all runners in the org. |
| `org` | no | inferred | Required when `scope=org`. Defaults to the repo's owner if it is an organization. |
| `owner` | no | `${{ github.repository_owner }}` | Repo owner (user or org). Only used when `scope=repo`. Override to check runners on a different repo. |
| `repo` | no | `${{ github.event.repository.name }}` | Repo name. Only used when `scope=repo`. Override to check runners on a different repo. |
| `labels` | no | _(none)_ | Comma-separated labels. Only runners with **all** of these labels are considered. |
| `names` | no | _(none)_ | Comma-separated runner names to whitelist. |
| `fail-on-offline` | no | `true` | When `false`, the action always exits 0 and only sets outputs. |
| `github-server-url` | no | `${{ github.server_url }}` | API base URL (override for GitHub Enterprise). |

## Outputs

| Name | Description |
| ------ | ------------- |
| `available` | `true` / `false` |
| `online-count` | Number of matching runners that are online. |
| `total-count` | Total number of matching runners (online + offline). |
| `runners` | JSON array of matching runners with `id`, `name`, `status`, `busy`, `os`, `labels`. |

## Permissions

For `scope: repo`, the default `GITHUB_TOKEN` is enough — the `actions: read`
permission is implicit.

For `scope: org`, the calling token must be able to list runners for the
organization (a PAT or GitHub App installation with `administration: read` on
the org).

## Usage

### Cancel the workflow if no self-hosted runner labeled `linux` is online

```yaml
name: CI
on: [push]

jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: imShakil/check-runners-availability@v1
        with:
          labels: linux
          # If this step fails, every later job is skipped — workflow cancelled.
      # any later jobs that depend on self-hosted runners...

  build:
    needs: gate
    runs-on: [self-hosted, linux]
    steps:
      - run: echo "build on self-hosted runner"
```

### Check organization-wide runners and gate with `if:`

```yaml
jobs:
  check:
    runs-on: ubuntu-latest
    outputs:
      available: ${{ steps.check.outputs.available }}
    steps:
      - id: check
        uses: imShakil/check-runners-availability@v1
        with:
          scope: org
          labels: gpu
          fail-on-offline: false

  build:
    needs: check
    if: needs.check.outputs.available == 'true'
    runs-on: [self-hosted, gpu]
    steps:
      - run: echo "gpu build"
```

### Check runners registered on a different repository

Useful when the workflow runs in an "infra" repo but the self-hosted runners
are registered against a separate "platform" repo. The token used here needs
access to that target repo.

```yaml
- uses: imShakil/check-runners-availability@v1
  with:
    owner: my-org
    repo: platform-runners
    labels: linux
```

## Development

```bash
npm install
npm run build   # bundles src/index.js into dist/index.js via @vercel/ncc
```

`dist/index.js` is committed because GitHub Actions runs the bundled file
verbatim (it does not `npm install` at runtime). Rebuild it whenever you
change anything under `src/`.

## License

MIT — see [LICENSE](./LICENSE).
