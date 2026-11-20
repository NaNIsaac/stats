# stats

GitHub statistics for [NaNIsaac](https://github.com/NaNIsaac), collected every six hours
and shown at **https://nanisaac.github.io/stats/**.

<a href="https://nanisaac.github.io/stats/">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://nanisaac.github.io/stats/data/card-dark.svg">
    <img src="https://nanisaac.github.io/stats/data/card-light.svg" width="500" alt="Summary of GitHub activity">
  </picture>
</a>

## What the dashboard shows

What NaNIsaac builds and whether people use it:

- Contributions, stars, followers and repositories, with the contribution calendar and streaks
- Contributions per year
- Every public repository: language, stars, forks, commits and latest release
- Commits per repository and languages by bytes
- PyPI packages with their downloads
- Pull requests to projects outside the account and its organizations
- Stars over time

Traffic, CI, pull request and issue counts, lines changed and the commit punch card are still
collected (`traffic.json`, `actions.json`, `latest.json`); they are shown on the owner's own
control page, not here.

## Install

Nothing runs on your machine: `.github/workflows/stats.yml` collects the data in GitHub Actions
every six hours (`23 */6 * * *`), on every push to `main` and by hand, then deploys `site/`.

For a copy of your own, fork the repository and add `STATS_TOKEN` as an Actions secret:

### Token

Private repositories and traffic need a token that belongs to the owner. Store a
fine-grained personal access token as the `STATS_TOKEN` repository secret:

- Repository access: all repositories
- Permissions (read-only): Administration, Contents, Issues, Pull requests, Actions, Metadata

Without it, or once it expires or is revoked, the workflow falls back to `GITHUB_TOKEN` and
refreshes public data only; the private sections from the last full run are kept. The
workflow run warns 30 days before the token expires and once it stops working; the token's
state is not written to the published data.

## Quick start

To collect into a folder of your own, with a token from the `gh` CLI you are signed in with:

```sh
STATS_TOKEN=$(gh auth token) uv run collect.py site/data
cd site && python -m http.server
```

The page reads `site/data/*.json` from the same folder, so it shows what the last collection
wrote. `python -m unittest discover -s tests` runs the checks `lint.yml` runs.

## Documentation

- `collect.py` — the only collector: standard library only, GraphQL and REST, writes the JSON files
- `site/` — the static page (`index.html`, `app.js`, `style.css`) and `llms.txt`
- `.github/workflows/stats.yml` — the schedule, the commit to the `data` branch and the Pages deploy
- The `data` branch — the collected history the page reads: `latest.json`, `history.json`,
  `traffic.json`, `actions.json`, `pypi.json`

## How it works

`collect.py` reads the GraphQL and REST APIs and writes JSON to
the `data` branch. The `stats` workflow runs it on a schedule, commits the result, and
deploys `site/` together with that data to GitHub Pages.

GitHub keeps traffic for 14 days and Actions runs are queried for the last 30. Both are
merged by day into `traffic.json` and `actions.json`, so the history outlives those
windows. `history.json` gets one row of totals per day. `pypi.json` lists the PyPI
package of each public repository whose `pyproject.toml` names one that links back here,
with its latest version and the downloads pypistats.org reports for 1, 7 and 30 days.

Private repositories are counted only in aggregate (one `(private)` row or bucket); their
names, titles and per-repository numbers are never written.

"Upstream" means a pull request or issue in a repository outside the owner's account and the
organizations the owner runs (`OWN_ORGS` in `collect.py`); `NOT_CONTRIBUTIONS` lists the few
that are neither. `pulls.elsewhere` in `latest.json` is that list, and the profile README and
the homepage read it from there instead of searching GitHub themselves.

## License

MIT, see [LICENSE](LICENSE).
