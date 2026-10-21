"""Collect GitHub statistics for one account into JSON files.

    GH_TOKEN=... python collect.py OUT_DIR [--owner NaNIsaac]

OUT_DIR keeps its history between runs: traffic and Actions runs are merged by day,
so data older than GitHub's 14-day and 30-day windows survives. Private repositories
are counted only in aggregate; their names and titles are never written.

A token that belongs to the owner sees private repositories and traffic ("full" scope).
Any other token sees public data only, and its sections never replace full ones.
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime, timedelta, timezone
from pathlib import Path

API = "https://api.github.com"
KST = timezone(timedelta(hours=9), "KST")
OWN_FORKS = {"NaNIsaac.github.io"}
PRIVATE = "(private)"
SCOPED = ("private", "languages", "contributions", "commits", "pulls", "issues")
ACTIONS_DAYS = 30
HISTORY_PAGES = 20


class GitHub:
    def __init__(self, token: str) -> None:
        self.headers = {
            "Authorization": f"Bearer {token}",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "NaNIsaac-stats",
        }

    def send(
        self, url: str, data: bytes | None = None, accept: str = "application/vnd.github+json"
    ):
        request = urllib.request.Request(url, data=data, headers=self.headers | {"Accept": accept})
        for attempt in range(6):
            try:
                with urllib.request.urlopen(request, timeout=60) as resp:
                    body = resp.read()
                    return resp.status, resp.headers, json.loads(body) if body else None
            except urllib.error.HTTPError as e:
                if e.code in (502, 503, 504):
                    time.sleep(2**attempt)
                    continue
                if e.code in (403, 429) and (wait := retry_after(e.headers)) is not None:
                    time.sleep(min(wait, 900))
                    continue
                return e.code, e.headers, None
            except (urllib.error.URLError, TimeoutError):
                time.sleep(2**attempt)
        raise RuntimeError(f"giving up on {url}")

    def graphql(self, query: str, **variables) -> dict:
        payload = json.dumps({"query": query, "variables": variables}).encode()
        status, _, body = self.send(f"{API}/graphql", data=payload)
        if not body or not body.get("data"):
            raise RuntimeError(f"GraphQL {status}: {body}")
        for error in body.get("errors", []):
            print(f"graphql: {error.get('message')}", file=sys.stderr)
        return body["data"]

    def get(self, path: str, accept: str = "application/vnd.github+json", **params):
        query = f"?{urllib.parse.urlencode(params)}" if params else ""
        status, _, body = self.send(f"{API}{path}{query}", accept=accept)
        return body if status == 200 else None

    def pages(
        self,
        path: str,
        key: str | None = None,
        accept: str = "application/vnd.github+json",
        limit: int = 10,
        **params,
    ) -> list | None:
        url = f"{API}{path}?{urllib.parse.urlencode(params | {'per_page': 100})}"
        items = []
        for _ in range(limit):
            status, headers, body = self.send(url, accept=accept)
            if status != 200:
                return items or None
            items += body[key] if key else body
            url = next_link(headers.get("Link", ""))
            if not url:
                break
        return items


def retry_after(headers) -> int | None:
    if value := headers.get("Retry-After"):
        return int(value)
    if headers.get("X-RateLimit-Remaining") == "0":
        return max(int(headers.get("X-RateLimit-Reset", "0")) - int(time.time()), 0) + 5
    return None


def next_link(header: str) -> str | None:
    for part in header.split(","):
        url, _, rel = part.partition(";")
        if 'rel="next"' in rel:
            return url.strip()[1:-1]
    return None


def kst_date(timestamp: str) -> str:
    return datetime.fromisoformat(timestamp).astimezone(KST).date().isoformat()


def iso(moment: datetime) -> str:
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


REPOS_QUERY = """
query($owner: String!, $after: String) {
  user(login: $owner) {
    repositories(first: 50, after: $after, ownerAffiliations: OWNER) {
      pageInfo { hasNextPage endCursor }
      nodes {
        name isPrivate isFork isArchived description url homepageUrl
        stargazerCount forkCount diskUsage createdAt pushedAt
        watchers { totalCount }
        openIssues: issues(states: OPEN) { totalCount }
        closedIssues: issues(states: CLOSED) { totalCount }
        openPRs: pullRequests(states: OPEN) { totalCount }
        mergedPRs: pullRequests(states: MERGED) { totalCount }
        releases { totalCount }
        latestRelease { tagName publishedAt }
        licenseInfo { spdxId }
        primaryLanguage { name color }
        languages(first: 20, orderBy: {field: SIZE, direction: DESC}) {
          edges { size node { name color } }
        }
        repositoryTopics(first: 20) { nodes { topic { name } } }
        defaultBranchRef { target { ... on Commit { history { totalCount } } } }
      }
    }
  }
}"""

PROFILE_QUERY = """
query($owner: String!) {
  user(login: $owner) {
    id login name bio avatarUrl createdAt
    followers { totalCount }
    following { totalCount }
    starredRepositories { totalCount }
    gists { totalCount }
  }
}"""

CONTRIB_QUERY = """
query($owner: String!, $start: DateTime!, $end: DateTime!) {
  user(login: $owner) {
    contributionsCollection(from: $start, to: $end) {
      totalCommitContributions totalIssueContributions totalPullRequestContributions
      totalPullRequestReviewContributions totalRepositoryContributions
      restrictedContributionsCount
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount } }
      }
      commitContributionsByRepository(maxRepositories: 100) {
        repository { name isPrivate owner { login } }
        contributions { totalCount }
      }
    }
  }
}"""

HISTORY_QUERY = """
query($owner: String!, $name: String!, $author: ID!, $since: GitTimestamp!, $after: String) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef { target { ... on Commit {
      history(first: 100, after: $after, since: $since, author: {id: $author}) {
        pageInfo { hasNextPage endCursor }
        nodes { authoredDate additions deletions }
      }
    } } }
  }
}"""

SEARCH_QUERY = """
query($q: String!, $after: String) {
  search(query: $q, type: ISSUE, first: 100, after: $after) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        title url state createdAt mergedAt closedAt additions deletions
        repository { name isPrivate owner { login } }
      }
      ... on Issue {
        title url state createdAt closedAt
        repository { name isPrivate owner { login } }
      }
    }
  }
}"""

COUNT_QUERY = """
query($q: String!) { search(query: $q, type: ISSUE, first: 1) { issueCount } }"""


def fetch_repos(gh: GitHub, owner: str) -> list[dict]:
    nodes, after = [], None
    while True:
        conn = gh.graphql(REPOS_QUERY, owner=owner, after=after)["user"]["repositories"]
        nodes += conn["nodes"]
        if not conn["pageInfo"]["hasNextPage"]:
            return nodes
        after = conn["pageInfo"]["endCursor"]


def search_all(gh: GitHub, query: str, limit: int = 10) -> list[dict]:
    nodes, after = [], None
    for _ in range(limit):
        result = gh.graphql(SEARCH_QUERY, q=query, after=after)["search"]
        nodes += [node for node in result["nodes"] if node]
        if not result["pageInfo"]["hasNextPage"]:
            break
        after = result["pageInfo"]["endCursor"]
    return nodes


def count(gh: GitHub, query: str) -> int:
    return gh.graphql(COUNT_QUERY, q=query)["search"]["issueCount"]


def repo_label(repo: dict, owner: str) -> str:
    if repo["isPrivate"]:
        return PRIVATE
    login = repo["owner"]["login"]
    return repo["name"] if login.lower() == owner.lower() else f"{login}/{repo['name']}"


def fetch_contributions(gh: GitHub, owner: str, created: datetime, now: datetime) -> dict:
    def window(start: datetime, end: datetime) -> dict:
        return gh.graphql(CONTRIB_QUERY, owner=owner, start=iso(start), end=iso(end))["user"][
            "contributionsCollection"
        ]

    years, days = {}, {}
    for year in range(created.year, now.year + 1):
        start = max(datetime(year, 1, 1, tzinfo=UTC), created)
        end = min(datetime(year + 1, 1, 1, tzinfo=UTC) - timedelta(seconds=1), now)
        c = window(start, end)
        years[str(year)] = {
            "total": c["contributionCalendar"]["totalContributions"],
            "commits": c["totalCommitContributions"],
            "pulls": c["totalPullRequestContributions"],
            "issues": c["totalIssueContributions"],
            "reviews": c["totalPullRequestReviewContributions"],
            "repos": c["totalRepositoryContributions"],
            "restricted": c["restrictedContributionsCount"],
        }
        first, last = start.date().isoformat(), end.date().isoformat()
        for week in c["contributionCalendar"]["weeks"]:
            for day in week["contributionDays"]:
                if first <= day["date"] <= last:
                    days[day["date"]] = day["contributionCount"]

    recent = window(now - timedelta(days=365), now)
    by_repo = Counter()
    for item in recent["commitContributionsByRepository"]:
        by_repo[repo_label(item["repository"], owner)] += item["contributions"]["totalCount"]
    return {
        "years": years,
        "days": dict(sorted(days.items())),
        "last_year": {
            "total": recent["contributionCalendar"]["totalContributions"],
            "commits": recent["totalCommitContributions"],
            "pulls": recent["totalPullRequestContributions"],
            "issues": recent["totalIssueContributions"],
            "reviews": recent["totalPullRequestReviewContributions"],
            "restricted": recent["restrictedContributionsCount"],
        },
        "by_repo": [{"repo": name, "commits": n} for name, n in by_repo.most_common()],
    }


def fetch_commits(gh: GitHub, owner: str, name: str, author: str, since: datetime) -> list:
    nodes, after = [], None
    for _ in range(HISTORY_PAGES):
        repo = gh.graphql(
            HISTORY_QUERY, owner=owner, name=name, author=author, since=iso(since), after=after
        )["repository"]
        target = (repo or {}).get("defaultBranchRef") or {}
        history = (target.get("target") or {}).get("history")
        if not history:
            break
        nodes += history["nodes"]
        if not history["pageInfo"]["hasNextPage"]:
            break
        after = history["pageInfo"]["endCursor"]
    return nodes


def fetch_traffic(gh: GitHub, owner: str, name: str) -> dict | None:
    views = gh.get(f"/repos/{owner}/{name}/traffic/views")
    if views is None:
        return None
    clones = gh.get(f"/repos/{owner}/{name}/traffic/clones") or {"clones": []}
    return {
        "views": {v["timestamp"][:10]: [v["count"], v["uniques"]] for v in views["views"]},
        "clones": {c["timestamp"][:10]: [c["count"], c["uniques"]] for c in clones["clones"]},
        "referrers": gh.get(f"/repos/{owner}/{name}/traffic/popular/referrers") or [],
    }


def fetch_runs(gh: GitHub, owner: str, name: str, since: date) -> list[dict]:
    runs = gh.pages(
        f"/repos/{owner}/{name}/actions/runs",
        key="workflow_runs",
        limit=5,
        created=f">={since.isoformat()}",
        exclude_pull_requests="true",
    )
    result = []
    for run in runs or []:
        started, ended = run.get("run_started_at"), run.get("updated_at")
        seconds = (
            (datetime.fromisoformat(ended) - datetime.fromisoformat(started)).total_seconds()
            if started and ended and run["status"] == "completed"
            else 0
        )
        result.append(
            {
                "date": kst_date(run["created_at"]),
                "created": run["created_at"],
                "workflow": run["name"],
                "conclusion": run["conclusion"] or run["status"],
                "seconds": max(seconds, 0),
            }
        )
    return result


def fetch_stars(gh: GitHub, owner: str, name: str) -> list[dict]:
    stars = gh.pages(f"/repos/{owner}/{name}/stargazers", accept="application/vnd.github.star+json")
    return [
        {"date": s["starred_at"], "login": s["user"]["login"], "repo": name}
        for s in stars or []
        if s.get("user")
    ]


def summarize_items(items: list[dict], owner: str) -> dict:
    counts = {"own": Counter(), "elsewhere": Counter()}
    monthly = defaultdict(Counter)
    listed = []
    for item in items:
        repo = item["repository"]
        side = "own" if repo["owner"]["login"].lower() == owner.lower() else "elsewhere"
        state = "merged" if item.get("mergedAt") else item["state"].lower()
        counts[side][state] += 1
        monthly[item["createdAt"][:7]][side] += 1
        if side == "elsewhere" and not repo["isPrivate"]:
            listed.append(
                {
                    "repo": repo_label(repo, owner),
                    "title": item["title"],
                    "url": item["url"],
                    "state": state,
                    "created": item["createdAt"],
                    "closed": item.get("mergedAt") or item.get("closedAt"),
                    "additions": item.get("additions"),
                    "deletions": item.get("deletions"),
                }
            )
    return {
        "counts": {side: dict(c) for side, c in counts.items()},
        "monthly": {month: dict(c) for month, c in sorted(monthly.items())},
        "elsewhere": sorted(listed, key=lambda x: x["created"], reverse=True),
    }


def collect_repo(gh: GitHub, owner: str, author: str, repo: dict, now: datetime, full: bool):
    name = repo["name"]
    since = now - timedelta(days=365)
    return {
        "commits": fetch_commits(gh, owner, name, author, since),
        "traffic": fetch_traffic(gh, owner, name) if full else None,
        "runs": fetch_runs(gh, owner, name, (now - timedelta(days=ACTIONS_DAYS)).date()),
        "stars": fetch_stars(gh, owner, name)
        if repo["stargazerCount"] and not repo["isPrivate"]
        else [],
    }


def commit_stats(per_repo: dict[str, list], now: datetime) -> dict:
    punch = [[0] * 24 for _ in range(7)]
    weekly = defaultdict(lambda: {"commits": 0, "additions": 0, "deletions": 0})
    for nodes in per_repo.values():
        for node in nodes:
            moment = datetime.fromisoformat(node["authoredDate"]).astimezone(KST)
            punch[moment.weekday()][moment.hour] += 1
            week = (moment.date() - timedelta(days=moment.weekday())).isoformat()
            weekly[week]["commits"] += 1
            weekly[week]["additions"] += node["additions"]
            weekly[week]["deletions"] += node["deletions"]
    return {
        "since": (now - timedelta(days=365)).date().isoformat(),
        "total": sum(len(nodes) for nodes in per_repo.values()),
        "additions": sum(w["additions"] for w in weekly.values()),
        "deletions": sum(w["deletions"] for w in weekly.values()),
        "punch": punch,
        "weekly": [{"week": week} | weekly[week] for week in sorted(weekly)],
    }


def ci_summary(runs: list[dict]) -> dict:
    pending = {"in_progress", "queued", "waiting", "requested", "pending"}
    completed = sorted(
        (r for r in runs if r["conclusion"] not in pending), key=lambda r: r["created"]
    )
    return {
        "runs": len(runs),
        "failed": sum(r["conclusion"] in ("failure", "timed_out", "startup_failure") for r in runs),
        "minutes": round(sum(r["seconds"] for r in runs) / 60, 1),
        "last": completed[-1]["conclusion"] if completed else None,
    }


def merge_traffic(path: Path, fetched: dict[str, dict | None], private: set[str]) -> dict:
    data = load(path, {"repos": {}, "referrers": {}})
    totals = {"views": defaultdict(lambda: [0, 0]), "clones": defaultdict(lambda: [0, 0])}
    for name, traffic in fetched.items():
        if traffic is None:
            continue
        if name in private:
            for kind in totals:
                for day, (n, u) in traffic[kind].items():
                    totals[kind][day][0] += n
                    totals[kind][day][1] += u
            continue
        entry = data["repos"].setdefault(name, {"views": {}, "clones": {}})
        for kind in totals:
            entry[kind].update(traffic[kind])
        data["referrers"][name] = traffic["referrers"]
    if any(totals.values()):
        entry = data["repos"].setdefault(PRIVATE, {"views": {}, "clones": {}})
        for kind, days in totals.items():
            entry[kind].update(days)
    for entry in data["repos"].values():
        for kind in ("views", "clones"):
            entry[kind] = dict(sorted(entry[kind].items()))
    return data


def merge_actions(path: Path, runs: dict[str, list], private: set[str], since: str) -> dict:
    data = load(path, {"days": {}})
    fresh = defaultdict(lambda: defaultdict(Counter))
    for name, items in runs.items():
        label = PRIVATE if name in private else name
        for run in items:
            day = fresh[run["date"]][label]
            day[run["conclusion"]] += 1
            day["seconds"] += round(run["seconds"])
    days = {d: v for d, v in data["days"].items() if d < since}
    days |= {d: {repo: dict(c) for repo, c in repos.items()} for d, repos in fresh.items()}
    return {"days": dict(sorted(days.items()))}


def views_14(entry: dict | None, today: date) -> dict:
    start = (today - timedelta(days=14)).isoformat()
    if not entry:
        return {"views": 0, "uniques": 0, "clones": 0}
    views = [v for d, v in entry["views"].items() if d >= start]
    return {
        "views": sum(v[0] for v in views),
        "uniques": sum(v[1] for v in views),
        "clones": sum(v[0] for d, v in entry["clones"].items() if d >= start),
    }


def load(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default


def save(path: Path, data) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def card(snapshot: dict, dark: bool) -> str:
    ink, muted, surface, line = (
        ("#f0efec", "#a3a29b", "#1a1a19", "#2c2c2a")
        if dark
        else ("#0b0b0b", "#63625c", "#fcfcfb", "#e1e0d9")
    )
    t = snapshot["totals"]
    items = [
        ("Contributions, 1 year", t["contributions_year"]),
        ("Commits, 1 year", t["commits_year"]),
        ("Stars", t["stars"]),
        ("Merged pull requests", t["pulls_merged"]),
        ("Repositories", t["repos_public"] + t["repos_private"]),
        ("Views, 14 days", t["views_14"]),
    ]
    cells = []
    for i, (label, value) in enumerate(items):
        x, y = 24 + (i % 3) * 160, 70 + (i // 3) * 62
        cells.append(
            f'<text x="{x}" y="{y}" font-size="26" font-weight="600" fill="{ink}">{value:,}</text>'
            f'<text x="{x}" y="{y + 20}" font-size="12" fill="{muted}">{label}</text>'
        )
    stamp = snapshot["generated"][:10]
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="170" viewBox="0 0 500 170" '
        'font-family="system-ui,-apple-system,Segoe UI,sans-serif">'
        f'<rect x="0.5" y="0.5" width="499" height="169" rx="8" fill="{surface}" stroke="{line}"/>'
        f'<text x="24" y="32" font-size="14" font-weight="600" fill="{ink}">'
        f"{snapshot['profile']['login']} on GitHub</text>"
        f'<text x="476" y="32" font-size="12" fill="{muted}" text-anchor="end">{stamp}</text>'
        + "".join(cells)
        + "</svg>"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Collect GitHub statistics into JSON files.")
    parser.add_argument("out", type=Path)
    parser.add_argument("--owner", default="NaNIsaac")
    args = parser.parse_args()
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if not token:
        sys.exit("set GH_TOKEN")
    gh, owner, out = GitHub(token), args.owner, args.out
    out.mkdir(parents=True, exist_ok=True)
    now = datetime.now(UTC)
    today = now.astimezone(KST).date()

    try:
        viewer = gh.graphql("{ viewer { login } }")["viewer"]["login"]
    except RuntimeError:
        viewer = None
    full = (viewer or "").lower() == owner.lower()
    scope = "full" if full else "public"
    print(f"scope: {scope}", file=sys.stderr)

    profile = gh.graphql(PROFILE_QUERY, owner=owner)["user"]
    repos = [r for r in fetch_repos(gh, owner) if not r["isFork"] or r["name"] in OWN_FORKS]
    private = {r["name"] for r in repos if r["isPrivate"]}
    public = [r for r in repos if not r["isPrivate"]]

    with ThreadPoolExecutor(max_workers=4) as pool:
        details = dict(
            zip(
                (r["name"] for r in repos),
                pool.map(lambda r: collect_repo(gh, owner, profile["id"], r, now, full), repos),
                strict=True,
            )
        )

    traffic = merge_traffic(
        out / "traffic.json", {n: d["traffic"] for n, d in details.items()}, private
    )
    since = (today - timedelta(days=ACTIONS_DAYS)).isoformat()
    actions = merge_actions(
        out / "actions.json", {n: d["runs"] for n, d in details.items()}, private, since
    )

    languages = defaultdict(lambda: {"bytes": 0, "color": None, "repos": 0})
    for repo in repos:
        for edge in repo["languages"]["edges"]:
            lang = languages[edge["node"]["name"]]
            lang["bytes"] += edge["size"]
            lang["color"] = edge["node"]["color"]
            lang["repos"] += 1

    def commit_count(repo: dict) -> int:
        ref = repo["defaultBranchRef"]
        return ref["target"]["history"]["totalCount"] if ref and ref.get("target") else 0

    rows = []
    for repo in public:
        d = details[repo["name"]]
        rows.append(
            {
                "name": repo["name"],
                "description": repo["description"],
                "url": repo["url"],
                "homepage": repo["homepageUrl"],
                "language": (repo["primaryLanguage"] or {}).get("name"),
                "color": (repo["primaryLanguage"] or {}).get("color"),
                "archived": repo["isArchived"],
                "fork": repo["isFork"],
                "stars": repo["stargazerCount"],
                "forks": repo["forkCount"],
                "watchers": repo["watchers"]["totalCount"],
                "issues_open": repo["openIssues"]["totalCount"],
                "issues_closed": repo["closedIssues"]["totalCount"],
                "pulls_open": repo["openPRs"]["totalCount"],
                "pulls_merged": repo["mergedPRs"]["totalCount"],
                "releases": repo["releases"]["totalCount"],
                "latest_release": repo["latestRelease"],
                "license": (repo["licenseInfo"] or {}).get("spdxId"),
                "topics": [t["topic"]["name"] for t in repo["repositoryTopics"]["nodes"]],
                "size_kb": repo["diskUsage"],
                "created": repo["createdAt"],
                "pushed": repo["pushedAt"],
                "commits": commit_count(repo),
                "commits_year": len(d["commits"]),
                "traffic": views_14(traffic["repos"].get(repo["name"]), today),
                "ci": ci_summary(d["runs"]),
            }
        )
    rows.sort(key=lambda r: r["pushed"] or "", reverse=True)

    hidden = [r for r in repos if r["isPrivate"]]
    private_section = {
        "count": len(hidden),
        "archived": sum(r["isArchived"] for r in hidden),
        "stars": sum(r["stargazerCount"] for r in hidden),
        "commits": sum(map(commit_count, hidden)),
        "commits_year": sum(len(details[r["name"]]["commits"]) for r in hidden),
        "issues_open": sum(r["openIssues"]["totalCount"] for r in hidden),
        "pulls_open": sum(r["openPRs"]["totalCount"] for r in hidden),
        "size_kb": sum(r["diskUsage"] for r in hidden),
        "traffic": views_14(traffic["repos"].get(PRIVATE), today),
        "ci": ci_summary([run for r in hidden for run in details[r["name"]]["runs"]]),
    }

    pulls = summarize_items(search_all(gh, f"author:{owner} is:pr"), owner)
    pulls["received"] = {
        "open": count(gh, f"user:{owner} is:pr is:open -author:{owner}"),
        "merged": count(gh, f"user:{owner} is:pr is:merged -author:{owner}"),
        "closed": count(gh, f"user:{owner} is:pr is:closed is:unmerged -author:{owner}"),
    }
    issues = summarize_items(search_all(gh, f"author:{owner} is:issue"), owner)
    issues["received"] = {
        "open": count(gh, f"user:{owner} is:issue is:open -author:{owner}"),
        "closed": count(gh, f"user:{owner} is:issue is:closed -author:{owner}"),
    }

    created = datetime.fromisoformat(profile["createdAt"])
    stamp = iso(now)
    snapshot = {
        "generated": stamp,
        "scope": scope,
        "profile": {
            "login": profile["login"],
            "name": profile["name"],
            "bio": profile["bio"],
            "avatar": profile["avatarUrl"],
            "created": profile["createdAt"],
            "followers": profile["followers"]["totalCount"],
            "following": profile["following"]["totalCount"],
            "starred": profile["starredRepositories"]["totalCount"],
            "gists": profile["gists"]["totalCount"],
        },
        "repos": rows,
        "private": private_section,
        "languages": {"items": dict(sorted(languages.items(), key=lambda kv: -kv[1]["bytes"]))},
        "contributions": fetch_contributions(gh, owner, created, now),
        "commits": commit_stats({n: d["commits"] for n, d in details.items()}, now),
        "pulls": pulls,
        "issues": issues,
        "stars": sorted((s for d in details.values() for s in d["stars"]), key=lambda s: s["date"]),
    }
    previous = load(out / "latest.json", {})
    for key in SCOPED:
        snapshot[key] |= {"scope": scope, "updated": stamp}
        if scope == "public" and previous.get(key, {}).get("scope") == "full":
            snapshot[key] = previous[key]

    pulls_counts = snapshot["pulls"]["counts"]
    snapshot["totals"] = {
        "repos_public": len(public),
        "repos_private": snapshot["private"]["count"],
        "stars": sum(r["stars"] for r in rows) + snapshot["private"]["stars"],
        "forks": sum(r["forks"] for r in rows),
        "followers": snapshot["profile"]["followers"],
        "commits": sum(r["commits"] for r in rows) + snapshot["private"]["commits"],
        "commits_year": snapshot["commits"]["total"],
        "contributions_year": snapshot["contributions"]["last_year"]["total"],
        "issues_open": sum(r["issues_open"] for r in rows) + snapshot["private"]["issues_open"],
        "pulls_merged": sum(c.get("merged", 0) for c in pulls_counts.values()),
        "pulls_upstream_merged": pulls_counts["elsewhere"].get("merged", 0),
        "views_14": sum(r["traffic"]["views"] for r in rows)
        + snapshot["private"]["traffic"]["views"],
        "clones_14": sum(r["traffic"]["clones"] for r in rows)
        + snapshot["private"]["traffic"]["clones"],
    }

    history = [row for row in load(out / "history.json", []) if row["date"] != today.isoformat()]
    history.append({"date": today.isoformat()} | snapshot["totals"])
    history.sort(key=lambda row: row["date"])

    save(out / "latest.json", snapshot)
    save(out / "history.json", history)
    save(out / "traffic.json", traffic)
    save(out / "actions.json", actions)
    for dark in (False, True):
        (out / f"card-{'dark' if dark else 'light'}.svg").write_text(
            card(snapshot, dark), encoding="utf-8"
        )
    print(json.dumps(snapshot["totals"]), file=sys.stderr)


if __name__ == "__main__":
    main()
