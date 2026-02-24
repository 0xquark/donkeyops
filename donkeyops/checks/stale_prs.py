"""
Stale PR check: warn after WARN_DAYS of inactivity, close after CLOSE_DAYS more.
"""
from datetime import datetime, timedelta, timezone
from github import Github
from github.PullRequest import PullRequest

from .base import BaseCheck

STALE_LABEL = "stale"
WARN_DAYS = 14
CLOSE_DAYS = 7  # Days after warning to close


class StalePRCheck(BaseCheck):
    """Marks inactive PRs as stale and closes them if they remain inactive."""

    def __init__(self, days_until_stale: int = WARN_DAYS):
        self.days_until_stale = days_until_stale

    def run(self, gh: Github, repo_name: str) -> None:
        print(f"Checking {repo_name} for stale PRs...")
        repo = gh.get_repo(repo_name)
        pulls = repo.get_pulls(state="open", sort="updated", direction="asc")
        for pr in pulls:
            process_pr(pr, self.days_until_stale)



# Helpers

def process_pr(pr: PullRequest, days_until_stale: int) -> None:
    """Process a single PR to check for staleness."""
    now = datetime.now(timezone.utc)
    last_updated = pr.updated_at.replace(tzinfo=timezone.utc)

    if _is_labeled_stale(pr):
        # Already warned — close if still inactive past CLOSE_DAYS.
        if (now - last_updated) > timedelta(days=CLOSE_DAYS):
            _close_stale_pr(pr)
    else:
        if (now - last_updated) > timedelta(days=days_until_stale):
            if _is_awaiting_review(pr):
                print(f"  [SKIP] PR #{pr.number} is awaiting reviewer response. Skipping.")
            else:
                _mark_pr_stale(pr, days_until_stale)


def _is_labeled_stale(pr: PullRequest) -> bool:
    return STALE_LABEL in [l.name for l in pr.labels]


def _is_awaiting_review(pr: PullRequest) -> bool:
    users_requested, teams_requested = pr.get_review_requests()
    return users_requested.totalCount > 0 or teams_requested.totalCount > 0


def _mark_pr_stale(pr: PullRequest, days: int) -> None:
    print(f"  [WARN] PR #{pr.number} is inactive for {days}+ days. Marking stale.")
    pr.create_issue_comment(
        f"This PR has been inactive for {days} days and has no pending review requests. "
        f"It will be closed in {CLOSE_DAYS} days if there is no further activity."
    )
    pr.add_to_labels(STALE_LABEL)


def _close_stale_pr(pr: PullRequest) -> None:
    print(f"  [CLOSE] PR #{pr.number} has been stale for too long. Closing.")
    pr.create_issue_comment("Closing this PR due to inactivity.")
    pr.edit(state="closed")
