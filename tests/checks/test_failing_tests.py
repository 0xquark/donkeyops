import unittest
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock

from ruciobot.checks.failing_tests import (
    FAILING_TESTS_CLOSE_DAYS,
    FAILING_TESTS_LABEL,
    FAILING_TESTS_WARN_DAYS,
    process_failing_test_pr,
)


class TestFailingTestPRs(unittest.TestCase):
    def create_mock_pr(self, number, updated_delta_days, labels=[]):
        pr = MagicMock()
        pr.number = number
        pr.title = f"PR {number}"
        pr.updated_at = datetime.now(UTC) - timedelta(days=updated_delta_days)
        label_mocks = []
        for lbl in labels:
            m = MagicMock()
            m.name = lbl
            label_mocks.append(m)
        pr.labels = label_mocks
        return pr

    def create_mock_repo(self, check_conclusions):
        mock_repo = MagicMock()
        mock_runs = []
        for conclusion in check_conclusions:
            run = MagicMock()
            run.conclusion = conclusion
            mock_runs.append(run)
        mock_repo.get_commit.return_value.get_check_runs.return_value = mock_runs
        return mock_repo

    def test_warns_pr_with_failing_tests_after_1_day(self):
        """PR with failing checks inactive >= 1 day should be warned."""
        pr = self.create_mock_pr(1, updated_delta_days=FAILING_TESTS_WARN_DAYS + 1, labels=[])
        repo = self.create_mock_repo(["failure"])
        process_failing_test_pr(pr, repo)
        pr.add_to_labels.assert_called_with(FAILING_TESTS_LABEL)
        pr.create_issue_comment.assert_called_once()
        pr.edit.assert_not_called()

    def test_closes_pr_with_failing_tests_after_3_days(self):
        """PR already labeled 'failing-tests' and inactive >= 3 days should be closed."""
        pr = self.create_mock_pr(
            1, updated_delta_days=FAILING_TESTS_CLOSE_DAYS + 1, labels=[FAILING_TESTS_LABEL]
        )
        repo = self.create_mock_repo(["failure"])
        process_failing_test_pr(pr, repo)
        pr.edit.assert_called_with(state="closed")
        pr.create_issue_comment.assert_called_once()

    def test_ignores_recently_active_failing_pr(self):
        """PR with failing checks but inactive < 1 day should not be warned or closed."""
        pr = self.create_mock_pr(1, updated_delta_days=0, labels=[])
        repo = self.create_mock_repo(["failure"])
        process_failing_test_pr(pr, repo)
        pr.add_to_labels.assert_not_called()
        pr.create_issue_comment.assert_not_called()
        pr.edit.assert_not_called()

    def test_ignores_pr_with_passing_tests(self):
        """PR with only passing checks should not be warned."""
        pr = self.create_mock_pr(1, updated_delta_days=FAILING_TESTS_WARN_DAYS + 5, labels=[])
        repo = self.create_mock_repo(["success", "success"])
        process_failing_test_pr(pr, repo)
        pr.add_to_labels.assert_not_called()
        pr.create_issue_comment.assert_not_called()
        pr.edit.assert_not_called()

    def test_ignores_pr_with_no_checks(self):
        """PR with no check runs at all should not be warned."""
        pr = self.create_mock_pr(1, updated_delta_days=FAILING_TESTS_WARN_DAYS + 5, labels=[])
        repo = self.create_mock_repo([])
        process_failing_test_pr(pr, repo)
        pr.add_to_labels.assert_not_called()
        pr.create_issue_comment.assert_not_called()
        pr.edit.assert_not_called()

    def test_does_not_close_warned_pr_if_recently_active(self):
        """PR labeled 'failing-tests' but recently active should NOT be closed."""
        pr = self.create_mock_pr(1, updated_delta_days=1, labels=[FAILING_TESTS_LABEL])
        repo = self.create_mock_repo(["failure"])
        process_failing_test_pr(pr, repo)
        pr.edit.assert_not_called()

    def test_skips_pr_with_no_bot_label(self):
        """PR with 'no-bot' label is completely skipped by all failing-tests checks."""
        from ruciobot.checks.base import NO_BOT_LABEL

        pr = self.create_mock_pr(
            1, updated_delta_days=FAILING_TESTS_WARN_DAYS + 5, labels=[NO_BOT_LABEL]
        )
        repo = self.create_mock_repo(["failure"])
        process_failing_test_pr(pr, repo)
        pr.add_to_labels.assert_not_called()
        pr.create_issue_comment.assert_not_called()
        pr.edit.assert_not_called()


if __name__ == "__main__":
    unittest.main()
