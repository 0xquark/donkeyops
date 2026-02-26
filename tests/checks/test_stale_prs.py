import unittest
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock

from ruciobot.checks.stale_prs import (
    CLOSE_DAYS,
    STALE_LABEL,
    WARN_DAYS,
    process_pr,
)


class TestStalePRs(unittest.TestCase):
    def create_mock_pr(
        self,
        number,
        updated_delta_days,
        labels=[],
        pending_reviewers=0,
        pending_teams=0,
        approved_reviews=0,
    ):
        pr = MagicMock()
        pr.number = number
        pr.title = f"PR {number}"
        pr.updated_at = datetime.now(UTC) - timedelta(days=updated_delta_days)

        label_mocks = [MagicMock(name=lbl) for lbl in labels]
        for m, lbl in zip(label_mocks, labels):
            m.name = lbl
        pr.labels = label_mocks

        users_requested = MagicMock()
        users_requested.totalCount = pending_reviewers
        teams_requested = MagicMock()
        teams_requested.totalCount = pending_teams
        pr.get_review_requests.return_value = (users_requested, teams_requested)

        reviews = []
        for _ in range(approved_reviews):
            r = MagicMock()
            r.state = "APPROVED"
            reviews.append(r)
        pr.get_reviews.return_value = reviews

        return pr

    def test_warns_inactive_pr(self):
        """Inactive PR with no pending reviewers gets labeled and commented on."""
        pr = self.create_mock_pr(
            1, updated_delta_days=WARN_DAYS + 1, labels=[], pending_reviewers=0
        )
        process_pr(pr, WARN_DAYS)
        pr.add_to_labels.assert_called_with(STALE_LABEL)
        pr.create_issue_comment.assert_called_once()

    def test_ignores_active_pr(self):
        """Active PR is ignored."""
        pr = self.create_mock_pr(1, updated_delta_days=5, labels=[])
        process_pr(pr, WARN_DAYS)
        pr.add_to_labels.assert_not_called()
        pr.create_issue_comment.assert_not_called()

    def test_closes_stale_pr(self):
        """Stale-labeled PR with further inactivity is closed."""
        pr = self.create_mock_pr(1, updated_delta_days=CLOSE_DAYS + 1, labels=[STALE_LABEL])
        process_pr(pr, WARN_DAYS)
        pr.edit.assert_called_with(state="closed")
        pr.create_issue_comment.assert_called()

    def test_ignores_recently_active_stale_pr(self):
        """Stale-labeled PR that was recently updated is NOT closed."""
        pr = self.create_mock_pr(1, updated_delta_days=2, labels=[STALE_LABEL])
        process_pr(pr, WARN_DAYS)
        pr.edit.assert_not_called()

    def test_skips_pr_awaiting_reviewer(self):
        """Inactive PR with pending review requests is NOT marked stale."""
        pr = self.create_mock_pr(
            1, updated_delta_days=WARN_DAYS + 1, labels=[], pending_reviewers=1
        )
        process_pr(pr, WARN_DAYS)
        pr.add_to_labels.assert_not_called()
        pr.create_issue_comment.assert_not_called()

    def test_marks_stale_when_no_pending_reviewers(self):
        """Inactive PR without pending reviewers IS marked stale."""
        pr = self.create_mock_pr(
            1, updated_delta_days=WARN_DAYS + 1, labels=[], pending_reviewers=0
        )
        process_pr(pr, WARN_DAYS)
        pr.add_to_labels.assert_called_with(STALE_LABEL)
        pr.create_issue_comment.assert_called_once()

    def test_skips_pr_with_no_bot_label(self):
        """PR with 'no-bot' label is completely skipped by all stale checks."""
        from ruciobot.checks.base import NO_BOT_LABEL

        pr = self.create_mock_pr(1, updated_delta_days=WARN_DAYS + 5, labels=[NO_BOT_LABEL])
        process_pr(pr, WARN_DAYS)
        pr.add_to_labels.assert_not_called()
        pr.create_issue_comment.assert_not_called()
        pr.edit.assert_not_called()

    def test_skips_pr_with_approved_review(self):
        """Inactive PR that already has an approved review is NOT marked stale."""
        pr = self.create_mock_pr(1, updated_delta_days=WARN_DAYS + 5, labels=[], approved_reviews=1)
        process_pr(pr, WARN_DAYS)
        pr.add_to_labels.assert_not_called()
        pr.create_issue_comment.assert_not_called()

    def test_removes_stale_label_when_reviewer_assigned_after_stale(self):
        """Stale-labeled PR that later gets a reviewer assigned has stale label removed."""
        pr = self.create_mock_pr(
            1,
            updated_delta_days=CLOSE_DAYS + 1,
            labels=[STALE_LABEL],
            pending_reviewers=1,
        )
        process_pr(pr, WARN_DAYS)
        pr.remove_from_labels.assert_called_with(STALE_LABEL)
        pr.edit.assert_not_called()

    def test_removes_stale_label_when_approved_after_stale(self):
        """Stale-labeled PR that later gets approved has stale label removed."""
        pr = self.create_mock_pr(
            1,
            updated_delta_days=CLOSE_DAYS + 1,
            labels=[STALE_LABEL],
            approved_reviews=1,
        )
        process_pr(pr, WARN_DAYS)
        pr.remove_from_labels.assert_called_with(STALE_LABEL)
        pr.edit.assert_not_called()


if __name__ == "__main__":
    unittest.main()
