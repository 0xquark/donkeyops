"""
Abstract base class for all RucioBot checks.
"""
from abc import ABC, abstractmethod
from github import Github


class BaseCheck(ABC):
    """
    Every check must implement `run`. The CLI calls run(gh, repo_name)
    without needing to know anything about the check's internals.
    """

    @abstractmethod
    def run(self, gh: Github, repo_name: str) -> None:
        """Execute the check against the given repository."""
        ...
