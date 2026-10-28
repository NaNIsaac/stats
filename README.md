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

The workflow reads with a GitHub App installed on all of the owner's repositories, so it
has its own rate budget instead of sharing the owner's. `GITHUB_TOKEN` only pushes the
`data` branch.

- App permissions (read-only): Metadata, Contents, Issues, Pull requests, Actions,
  Administration (for traffic only)
- Repository variable `STATS_APP_ID`: the App's ID
- Repository secret `STATS_APP_KEY`: the App's private key

If the App token cannot be made, the run fails with an error saying so, and marks
`latest.json` as not refreshed; the page then says some figures are older than its date.
A run where GitHub refused some requests is marked `degraded` in `latest.json`'s
`collector`, with the reasons, and the page shows the same line.

The contributions calendar is per user, which an App cannot read for private work. When
GitHub does not show private contributions to it, the run adds the owner's commits, pull
requests and issues in private repositories from the data it fetched anyway.

## Running locally

```sh
GH_TOKEN=$(gh auth token) uv run collect.py site/data
cd site && python -m http.server
```
