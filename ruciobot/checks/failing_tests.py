"""
Failing-tests check: warn after WARN_DAYS of inactivity, close after CLOSE_DAYS more.
"""

from datetime import UTC, datetime

from github import Github
from github.PullRequest import PullRequest

from .base import NO_BOT_LABEL, BaseCheck, is_excluded_from_bot

FAILING_TESTS_LABEL = "failing-tests"
FAILING_TESTS_WARN_DAYS = 1  # Days of inactivity before warning
FAILING_TESTS_CLOSE_DAYS = 3  # Days of inactivity (after warning) before closing


class FailingTestsCheck(BaseCheck):
    """Warns and closes PRs that have failing CI checks and remain inactive."""

    def run(self, gh: Github, repo_name: str) -> None:
        print(f"Checking {repo_name} for PRs with failing tests...")
        repo = gh.get_repo(repo_name)
        pulls = repo.get_pulls(state="open", sort="updated", direction="asc")
        for pr in pulls:
            process_failing_test_pr(pr, repo)


# Helpers


def process_failing_test_pr(pr: PullRequest, repo) -> None:
    """Process a single PR to check for failing tests and apply warn/close logic."""
    if is_excluded_from_bot(pr):
        print(f"  [SKIP] PR #{pr.number} has '{NO_BOT_LABEL}' label. Skipping.")
        return
    now = datetime.now(UTC)
    assert pr.updated_at is not None, f"PR #{pr.number} has no updated_at timestamp"
    last_updated = pr.updated_at.replace(tzinfo=UTC)
    inactive_days = (now - last_updated).days

    if _is_labeled_failing_tests(pr):
        if inactive_days >= FAILING_TESTS_CLOSE_DAYS:
            _close_failing_test_pr(pr)
    else:
        if inactive_days >= FAILING_TESTS_WARN_DAYS and has_failing_tests(pr, repo):
            _warn_failing_test_pr(pr)


def has_failing_tests(pr: PullRequest, repo) -> bool:
    """Returns True if any check run on the PR's head commit has conclusion 'failure'."""
    try:
        commit = repo.get_commit(pr.head.sha)
        for run in commit.get_check_runs():
            if run.conclusion == "failure":
                return True
    except Exception as e:
        print(f"  [WARN] Could not fetch check runs for PR #{pr.number}: {e}")
    return False


def _is_labeled_failing_tests(pr: PullRequest) -> bool:
    return FAILING_TESTS_LABEL in [lbl.name for lbl in pr.labels]


def _warn_failing_test_pr(pr: PullRequest) -> None:
    print(
        f"  [WARN] PR #{pr.number} has failing tests and has been "
        f"inactive for {FAILING_TESTS_WARN_DAYS}+ day(s)."
    )
    pr.create_issue_comment(
        f"This PR has failing CI checks and has been inactive for "
        f"{FAILING_TESTS_WARN_DAYS} day(s). "
        f"It will be automatically closed in {FAILING_TESTS_CLOSE_DAYS} days if the "
        f"tests are not fixed or there is no further activity."
    )
    pr.add_to_labels(FAILING_TESTS_LABEL)


def _close_failing_test_pr(pr: PullRequest) -> None:
    print(
        f"  [CLOSE] PR #{pr.number} has had failing tests and been inactive for too long. Closing."
    )
    pr.create_issue_comment(
        "Closing this PR because it has had failing CI checks and has been "
        f"inactive for more than {FAILING_TESTS_CLOSE_DAYS} days. "
        "Feel free to reopen once the tests are fixed."
    )
    pr.edit(state="closed")
