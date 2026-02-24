"""
Check registry — maps CLI action names to check instances.

When adding a new feature, add a new entry here.
"""
from .stale_prs import StalePRCheck
from .failing_tests import FailingTestsCheck

CHECKS = {
    "stale":         StalePRCheck(),
    "failing-tests": FailingTestsCheck(),
}
