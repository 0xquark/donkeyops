"""
Core business logic for DonkeyOps.
"""
from datetime import datetime, timedelta, timezone
from typing import List, Optional
from github import Github
from github.Repository import Repository
from github.PullRequest import PullRequest

STALE_LABEL = "stale"
WARN_DAYS = 14
CLOSE_DAYS = 7  # Days after warning to close

FAILING_TESTS_LABEL = "failing-tests"
FAILING_TESTS_WARN_DAYS = 1    # Days of inactivity before warning
FAILING_TESTS_CLOSE_DAYS = 3   # Days of inactivity (after warning) before closing

def check_stale_prs(gh: Github, repo_name: str, days_until_stale: int = WARN_DAYS):
    """
    Checks for stale PRs in the given repository.
    Logic:
    1. If inactive > days_until_stale AND not awaiting review: Mark as stale (Label + Comment).
    2. If already stale and inactive > CLOSE_DAYS since staleness: Close PR.
    3. If awaiting review from assigned reviewers: Skip.
    """
    print(f"Checking {repo_name} for Stale PRs...")
    
    repo = gh.get_repo(repo_name)
    # Get all open PRs
    pulls = repo.get_pulls(state='open', sort='updated', direction='asc')

    for pr in pulls:
        process_pr(pr, days_until_stale)

def process_pr(pr: PullRequest, days_until_stale: int):
    """
    Process a single PR to check for staleness.
    """
    now = datetime.now(timezone.utc)
    # PyGithub dates are sometimes offset-naive, ensure they are aware
    last_updated = pr.updated_at.replace(tzinfo=timezone.utc)
    
    if is_labeled_stale(pr):
        # Already warned — check if it should be closed now.
        # Note: our stale comment itself updates `updated_at`, so CLOSE_DAYS
        # is measured from when the bot last commented (or any subsequent activity).
        if (now - last_updated) > timedelta(days=CLOSE_DAYS):
            close_stale_pr(pr)
    else:
        # Not yet stale — check if it should be warned.
        if (now - last_updated) > timedelta(days=days_until_stale):
            # Skip PRs that are still awaiting review.
            if is_awaiting_review(pr):
                print(f"  [SKIP] PR #{pr.number} is inactive but awaiting reviewer response. Skipping.")
            else:
                mark_pr_stale(pr, days_until_stale)

def is_labeled_stale(pr: PullRequest) -> bool:
    """Returns True if the PR has the 'stale' label."""
    return STALE_LABEL in [l.name for l in pr.labels]

def is_awaiting_review(pr: PullRequest) -> bool:
    """
    Returns True if the PR has pending review requests (i.e., assigned reviewers
    who haven't yet submitted a review).
    """
    users_requested, teams_requested = pr.get_review_requests()
    return users_requested.totalCount > 0 or teams_requested.totalCount > 0

def mark_pr_stale(pr: PullRequest, days: int):
    print(f"  [WARN] PR #{pr.number} is inactive for {days}+ days. Marking stale.")
    pr.create_issue_comment(
        f"This PR has been inactive for {days} days and has no pending review requests. "
        f"It will be closed in {CLOSE_DAYS} days if there is no further activity."
    )
    pr.add_to_labels(STALE_LABEL)

def close_stale_pr(pr: PullRequest):
    print(f"  [CLOSE] PR #{pr.number} has been stale for too long. Closing.")
    pr.create_issue_comment("Closing this PR due to inactivity.")
    pr.edit(state="closed")


# Failing-tests warn-then-close logic

def check_failing_test_prs(gh: Github, repo_name: str):
    """
    Checks open PRs for failing CI checks.
    Logic:
    1. If PR has failing tests AND inactive > FAILING_TESTS_WARN_DAYS: warn (label + comment).
    2. If PR already has the 'failing-tests' label AND inactive > FAILING_TESTS_CLOSE_DAYS: close.
    """
    print(f"Checking {repo_name} for PRs with failing tests...")
    repo = gh.get_repo(repo_name)
    pulls = repo.get_pulls(state='open', sort='updated', direction='asc')

    for pr in pulls:
        process_failing_test_pr(pr, repo)


def has_failing_tests(pr: PullRequest, repo) -> bool:
    """
    Returns True if any check run on the PR's head commit has conclusion 'failure'.
    """
    try:
        commit = repo.get_commit(pr.head.sha)
        check_runs = commit.get_check_runs()
        for run in check_runs:
            if run.conclusion == "failure":
                return True
    except Exception as e:
        print(f"  [WARN] Could not fetch check runs for PR #{pr.number}: {e}")
    return False


def process_failing_test_pr(pr: PullRequest, repo):
    """
    Process a single PR to check for failing tests and apply warn/close logic.
    """
    now = datetime.now(timezone.utc)
    last_updated = pr.updated_at.replace(tzinfo=timezone.utc)
    inactive_days = (now - last_updated).days

    if _is_labeled_failing_tests(pr):
        # Already warned — check if it should be closed.
        if inactive_days >= FAILING_TESTS_CLOSE_DAYS:
            close_failing_test_pr(pr)
    else:
        # Not yet warned — check if tests are failing and inactive long enough.
        if inactive_days >= FAILING_TESTS_WARN_DAYS and has_failing_tests(pr, repo):
            warn_failing_test_pr(pr)


def _is_labeled_failing_tests(pr: PullRequest) -> bool:
    """Returns True if the PR has the 'failing-tests' label."""
    return FAILING_TESTS_LABEL in [l.name for l in pr.labels]


def warn_failing_test_pr(pr: PullRequest):
    print(f"  [WARN] PR #{pr.number} has failing tests and has been inactive for {FAILING_TESTS_WARN_DAYS}+ day(s). Warning.")
    pr.create_issue_comment(
        f"This PR has failing CI checks and has been inactive for "
        f"{FAILING_TESTS_WARN_DAYS} day(s). "
        f"It will be automatically closed in {FAILING_TESTS_CLOSE_DAYS} days if the "
        f"tests are not fixed or there is no further activity."
    )
    pr.add_to_labels(FAILING_TESTS_LABEL)


def close_failing_test_pr(pr: PullRequest):
    print(f"  [CLOSE] PR #{pr.number} has had failing tests and been inactive for too long. Closing.")
    pr.create_issue_comment(
        "Closing this PR because it has had failing CI checks and has been "
        f"inactive for more than {FAILING_TESTS_CLOSE_DAYS} days. "
        "Feel free to reopen once the tests are fixed."
    )
    pr.edit(state="closed")
