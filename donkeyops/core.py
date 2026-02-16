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

def check_stale_prs(gh: Github, repo_name: str, days_until_stale: int = WARN_DAYS):
    """
    Checks for stale PRs in the given repository.
    Logic:
    1. If inactive > days_until_stale: Mark as stale (Label + Comment).
    2. If already stale and inactive > CLOSE_DAYS since staleness: Close PR.
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
        # Check if it should be closed
        # We assume if it's labeled stale, we look at the last update.
        # Ideally, we should check if the last update was the bot itself or the user.
        # Simplification: If 7 days passed since last update (which includes the bot's stale comment), it's dead.
        if (now - last_updated) > timedelta(days=CLOSE_DAYS):
            close_stale_pr(pr)
    else:
        # Check if it should be marked stale
        if (now - last_updated) > timedelta(days=days_until_stale):
            mark_pr_stale(pr, days_until_stale)

def is_labeled_stale(pr: PullRequest) -> bool:
    return STALE_LABEL in [l.name for l in pr.labels]

def mark_pr_stale(pr: PullRequest, days: int):
    print(f"  [WARN] PR #{pr.number} is inactive for {days}+ days. Marking stale.")
    pr.create_issue_comment(f"This PR has been inactive for {days} days. It will be closed in {CLOSE_DAYS} days if there is no activity.")
    pr.add_to_labels(STALE_LABEL)

def close_stale_pr(pr: PullRequest):
    print(f"  [CLOSE] PR #{pr.number} has been stale for too long. Closing.")
    pr.create_issue_comment(f"Closing this PR due to inactivity.")
    pr.edit(state="closed")
