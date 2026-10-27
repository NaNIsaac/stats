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

- Contribution calendar, streaks, contributions per day/week/month and per year
- Lines added and deleted per week, and a weekday-by-hour punch card of commits (KST)
- Every public repository: stars, forks, open issues and PRs, commits, views, clones, CI runs, releases
- Commits per repository and languages by bytes
- Pull requests and issues: own vs upstream, merge rate, monthly counts, the upstream PR list
- Traffic: views, unique visitors, clones, top repositories and referrers
- GitHub Actions: runs per day by outcome, failures and minutes per repository
- Stars over time and daily snapshots of the headline numbers

A range control (30 days, 90 days, 1 year, all) scopes the time series.

## How it works

`collect.py` (standard library only) reads the GraphQL and REST APIs and writes JSON to
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

## Token

Private repositories and traffic need a token that belongs to the owner. Store a
fine-grained personal access token as the `STATS_TOKEN` repository secret:

- Repository access: all repositories
- Permissions (read-only): Administration, Contents, Issues, Pull requests, Actions, Metadata

Without it, or once it expires or is revoked, the workflow falls back to `GITHUB_TOKEN` and
refreshes public data only; the private sections from the last full run are kept. The
token's expiry date is recorded on every run: the dashboard warns 30 days ahead and shows a
red notice once the token stops working, and the workflow run carries the same warning.

## Running locally

```sh
STATS_TOKEN=$(gh auth token) uv run collect.py site/data
cd site && python -m http.server
```
