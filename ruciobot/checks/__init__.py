"""
Check registry — maps CLI action names to check instances.

When adding a new feature, add a new entry here.
"""

from .failing_tests import FailingTestsCheck
from .stale_prs import StalePRCheck

CHECKS = {
    "stale": StalePRCheck(),
    "failing-tests": FailingTestsCheck(),
}
