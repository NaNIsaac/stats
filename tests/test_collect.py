import contextlib
import io
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import collect  # noqa: E402

REFUSED = "graphql: Resource not accessible by personal access token"


class FakeGitHub:
    """Answers like collect.GitHub: REST stargazers refused, GraphQL from `stars` or `error`."""

    def __init__(self, stars: list[tuple[str, str]] | None = None, error: str = REFUSED):
        self.stars, self.error, self.queries = stars, error, 0

    def pages(self, path: str, **_) -> list | None:
        return None

    def graphql(self, query: str, strict: bool = False, **variables) -> dict:
        self.queries += 1
        if self.stars is None:
            raise RuntimeError(self.error)
        edges = [{"starredAt": date, "node": {"login": login}} for date, login in self.stars]
        page = {"hasNextPage": False, "endCursor": None}
        return {"repository": {"stargazers": {"pageInfo": page, "edges": edges}}}


class Stars(unittest.TestCase):
    def fetch(self, gh, fallback):
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            stars = collect.fetch_stars(gh, "NaNIsaac", "codigest", fallback)
        return stars, err.getvalue().splitlines()

    def test_github_token_answers_when_stats_token_is_refused(self):
        fallback = FakeGitHub([("2026-10-01T00:00:00Z", "someone")])
        stars, lines = self.fetch(FakeGitHub(), fallback)
        self.assertEqual(
            stars, [{"date": "2026-10-01T00:00:00Z", "login": "someone", "repo": "codigest"}]
        )
        self.assertEqual(fallback.queries, 1)
        self.assertEqual(lines, [])

    def test_both_refused_gives_an_empty_list_and_one_line(self):
        stars, lines = self.fetch(FakeGitHub(), FakeGitHub())
        self.assertEqual(stars, [])
        self.assertEqual(lines, [f"stars codigest: {REFUSED}"])

    def test_different_refusals_share_one_line(self):
        stars, lines = self.fetch(FakeGitHub(), FakeGitHub(error="graphql: other"))
        self.assertEqual(stars, [])
        self.assertEqual(lines, [f"stars codigest: {REFUSED}; graphql: other"])

    def test_without_github_token_the_refusal_is_logged_once(self):
        stars, lines = self.fetch(FakeGitHub(), None)
        self.assertEqual(stars, [])
        self.assertEqual(lines, [f"stars codigest: {REFUSED}"])

    def test_stats_token_answer_skips_the_fallback(self):
        fallback = FakeGitHub([("2026-10-02T00:00:00Z", "other")])
        stars, _ = self.fetch(FakeGitHub([("2026-10-01T00:00:00Z", "someone")]), fallback)
        self.assertEqual([s["login"] for s in stars], ["someone"])
        self.assertEqual(fallback.queries, 0)


class GraphQLErrors(unittest.TestCase):
    def answer(self, body):
        gh = collect.GitHub("t")
        gh.send = lambda *a, **k: (200, {}, body)
        return gh

    def test_strict_raises_errors(self):
        gh = self.answer({"data": {"repository": None}, "errors": [{"message": "nope"}]})
        with self.assertRaisesRegex(RuntimeError, "graphql: nope"):
            gh.graphql("q", strict=True)

    def test_default_prints_errors(self):
        gh = self.answer({"data": {"repository": None}, "errors": [{"message": "nope"}]})
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            self.assertEqual(gh.graphql("q"), {"repository": None})
        self.assertEqual(err.getvalue(), "graphql: nope\n")


if __name__ == "__main__":
    unittest.main()
