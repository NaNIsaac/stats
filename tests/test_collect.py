import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import collect  # noqa: E402


class Refusals(unittest.TestCase):
    def test_kinds(self):
        k = collect.refusal_kind
        self.assertEqual(k(403, {"X-RateLimit-Remaining": "0"}), "rate-limit")
        self.assertEqual(k(429, {"Retry-After": "30"}), "rate-limit")
        self.assertEqual(
            k(
                200,
                {},
                {"errors": [{"type": "RATE_LIMIT", "message": "API rate limit already exceeded"}]},
            ),
            "rate-limit",
        )
        self.assertEqual(k(403, {"X-Accepted-GitHub-Permissions": "metadata=read"}), "auth")
        self.assertEqual(k(401, {}), "auth")
        self.assertEqual(k(429, {}), "quota")
        self.assertIsNone(k(404, {}))
        self.assertIsNone(k(200, {}, {"errors": [{"type": "NOT_FOUND"}]}))

    def test_paths_group_by_endpoint(self):
        self.assertEqual(
            collect.path_kind("/repos/NaNIsaac/codigest/stargazers"), "/repos/*/stargazers"
        )
        self.assertEqual(
            collect.path_kind("/repos/NaNIsaac/x/traffic/views?per=week"), "/repos/*/traffic/views"
        )
        self.assertEqual(collect.path_kind("/users/NaNIsaac"), "/users/NaNIsaac")

    def test_refusals_are_counted_and_404_is_not(self):
        gh = collect.GitHub("t")
        answers = iter(
            [(403, {"X-Accepted-GitHub-Permissions": "administration=read"}, None)] * 2
            + [(404, {}, None)]
        )
        with mock.patch.object(gh, "send", side_effect=lambda *a, **k: next(answers)):
            gh.get("/repos/NaNIsaac/a/traffic/views")
            gh.get("/repos/NaNIsaac/b/traffic/views")
            gh.get("/repos/NaNIsaac/c/readme")
        self.assertEqual(
            dict(gh.refused), {("auth", "github-rest", "GET /repos/*/traffic/views"): 2}
        )

    def test_a_refusal_with_a_fallback_is_not_counted(self):
        gh = collect.GitHub("t")
        with mock.patch.object(gh, "send", return_value=(403, {}, None)):
            self.assertIsNone(gh.pages("/repos/NaNIsaac/a/stargazers", has_fallback=True))
        self.assertFalse(gh.refused)

    def test_collector_status(self):
        s = collect.collector_status(
            "degraded",
            [("auth", "github-rest", "GET /repos/*/traffic/views", 3)],
            "2026-10-28T13:00:00Z",
        )
        self.assertEqual(s["status"], "degraded")
        self.assertEqual(s["causes"][0]["detail"], "GET /repos/*/traffic/views (3 times)")
        self.assertEqual(
            set(s["causes"][0]), {"kind", "service", "detail", "resets_at", "owner_action"}
        )


class Tokens(unittest.TestCase):
    def pick(self, env):
        with mock.patch.dict(os.environ, env, clear=True):
            return collect.pick_token()

    def test_actions_needs_the_app_token(self):
        self.assertEqual(
            self.pick({"GITHUB_ACTIONS": "true", "STATS_APP_TOKEN": "ghs_x"}),
            ("ghs_x", {"kind": "app", "status": "ok", "expires": None}),
        )
        for env in (
            {"GITHUB_ACTIONS": "true"},
            {"GITHUB_ACTIONS": "true", "STATS_APP_TOKEN": " "},
            {
                "GITHUB_ACTIONS": "true",
                "STATS_APP_TOKEN": "",
                "STATS_TOKEN": "ghp_x",
                "GITHUB_TOKEN": "ghs_y",
            },
        ):
            secret, token = self.pick(env)
            self.assertIsNone(secret)
            self.assertEqual((token["kind"], token["status"]), ("app", "missing"))

    def test_local_run_uses_the_user_token(self):
        self.assertEqual(self.pick({})[1]["status"], "missing")
        with mock.patch.object(collect.GitHub, "send", return_value=(200, {}, None)):
            secret, token = self.pick({"GH_TOKEN": "ghp_x"})
        self.assertEqual((secret, token["kind"]), ("ghp_x", "user"))

    def test_app_token_expiry_is_not_a_warning(self):
        now = collect.datetime(2026, 10, 28, tzinfo=collect.UTC)
        self.assertIsNone(
            collect.token_warning({"kind": "app", "status": "ok", "expires": None}, now)
        )
        soon = {"kind": "user", "status": "ok", "expires": "2026-11-01T00:00:00+00:00"}
        self.assertIn("expires in 4 days", collect.token_warning(soon, now))

    def test_missing_app_token_fails_and_marks_the_last_snapshot(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d)
            (out / "latest.json").write_text(
                json.dumps({"generated": "2026-10-28T10:00:00Z"}), encoding="utf-8"
            )
            env = {"GITHUB_ACTIONS": "true", "STATS_APP_TOKEN": ""}
            with (
                mock.patch.dict(os.environ, env, clear=True),
                mock.patch.object(sys, "argv", ["collect.py", d]),
            ):
                with self.assertRaises(SystemExit) as stop:
                    collect.main()
            self.assertIn("STATS_APP_TOKEN is missing or empty", str(stop.exception))
            run = json.loads((out / "latest.json").read_text(encoding="utf-8"))["collector"]
            self.assertEqual(run["status"], "failed")
            self.assertEqual(run["causes"][0]["kind"], "auth")
            self.assertTrue(run["causes"][0]["owner_action"])


def contributions(restricted=0, by_repo=()):
    return {
        "years": {"2026": {"total": 10, "commits": 10, "pulls": 0, "issues": 0}},
        "days": {"2022-03-01": 0, "2026-01-01": 4, "2026-10-01": 6},
        "last_year": {
            "total": 10,
            "commits": 10,
            "pulls": 0,
            "issues": 0,
            "reviews": 0,
            "restricted": restricted,
        },
        "by_repo": list(by_repo),
    }


class PrivateWork(unittest.TestCase):
    def test_rebuilt_when_github_shows_none(self):
        c = contributions()
        source = collect.add_private_work(
            c,
            ["2026-10-01T09:00:00Z", "2026-10-02T09:00:00Z"],
            ["2026-10-02T10:00:00Z"],
            ["2024-05-01T00:00:00Z", "2019-01-01T00:00:00Z"],
            "2025-10-28",
        )
        self.assertEqual(source, "rebuilt")
        self.assertEqual(c["days"]["2026-10-01"], 7)
        self.assertEqual(c["days"]["2026-10-02"], 2)
        self.assertEqual(c["days"]["2024-05-01"], 1)
        self.assertNotIn("2019-01-01", c["days"])  # before the account's first calendar day
        self.assertEqual(c["last_year"]["total"], 13)
        self.assertEqual(
            (c["last_year"]["commits"], c["last_year"]["pulls"], c["last_year"]["issues"]),
            (12, 1, 0),
        )
        self.assertEqual(c["years"]["2024"], {"total": 1, "issues": 1})
        self.assertEqual(list(c["days"]), sorted(c["days"]))

    def test_nothing_added_when_github_already_counts_it(self):
        for c in (
            contributions(restricted=5),
            contributions(by_repo=[{"repo": collect.PRIVATE, "commits": 3}]),
        ):
            before = json.dumps(c)
            self.assertEqual(
                collect.add_private_work(c, ["2026-10-01T00:00:00Z"], [], [], "2025-10-28"),
                "github",
            )
            self.assertEqual(json.dumps(c), before)


if __name__ == "__main__":
    unittest.main()
