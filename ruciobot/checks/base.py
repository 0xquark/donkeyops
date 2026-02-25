"""
Abstract base class for all RucioBot checks.
"""

from abc import ABC, abstractmethod

from github import Github

# PRs carrying this label are completely skipped by all bot checks.
NO_BOT_LABEL = "no-bot"


def is_excluded_from_bot(pr) -> bool:
    """Return True if the PR carries the no-bot exclusion label."""
    return NO_BOT_LABEL in [lbl.name for lbl in pr.labels]


class BaseCheck(ABC):
    """
    Every check must implement `run`. The CLI calls run(gh, repo_name)
    without needing to know anything about the check's internals.
    """

    @abstractmethod
    def run(self, gh: Github, repo_name: str) -> None:
        """Execute the check against the given repository."""
        ...
