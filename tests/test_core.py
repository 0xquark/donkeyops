import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch
from donkeyops.core import check_stale_prs, STALE_LABEL, process_pr, WARN_DAYS, CLOSE_DAYS

class TestStalePRs(unittest.TestCase):

    def setUp(self):
        self.mock_gh = MagicMock()
        self.mock_repo = MagicMock()
        self.mock_gh.get_repo.return_value = self.mock_repo
        
    def create_mock_pr(self, number, updated_delta_days, labels=[], pending_reviewers=0, pending_teams=0):
        pr = MagicMock()
        pr.number = number
        pr.title = f"PR {number}"
        # updated_at is N days ago
        pr.updated_at = datetime.now(timezone.utc) - timedelta(days=updated_delta_days)
        
        # Mock labels
        label_mocks = []
        for l in labels:
            m = MagicMock()
            m.name = l
            label_mocks.append(m)
        pr.labels = label_mocks

        # Mock review requests
        users_requested = MagicMock()
        users_requested.totalCount = pending_reviewers
        teams_requested = MagicMock()
        teams_requested.totalCount = pending_teams
        pr.get_review_requests.return_value = (users_requested, teams_requested)
        
        return pr

    def test_warns_inactive_pr(self):
        """Test that an inactive PR with no pending reviewers gets labeled and commented on."""
        pr = self.create_mock_pr(1, updated_delta_days=WARN_DAYS + 1, labels=[], pending_reviewers=0)
        self.mock_repo.get_pulls.return_value = [pr]

        check_stale_prs(self.mock_gh, "owner/repo", days_until_stale=WARN_DAYS)

        pr.add_to_labels.assert_called_with(STALE_LABEL)
        pr.create_issue_comment.assert_called_once()

    def test_ignores_active_pr(self):
        """Test that an active PR is ignored."""
        pr = self.create_mock_pr(1, updated_delta_days=5, labels=[])
        self.mock_repo.get_pulls.return_value = [pr]

        check_stale_prs(self.mock_gh, "owner/repo", days_until_stale=WARN_DAYS)

        pr.add_to_labels.assert_not_called()
        pr.create_issue_comment.assert_not_called()

    def test_closes_stale_pr(self):
        """Test that a labeled STALE PR with further inactivity is closed."""
        pr = self.create_mock_pr(1, updated_delta_days=CLOSE_DAYS + 1, labels=[STALE_LABEL])
        self.mock_repo.get_pulls.return_value = [pr]

        check_stale_prs(self.mock_gh, "owner/repo")

        pr.edit.assert_called_with(state="closed")
        pr.create_issue_comment.assert_called()

    def test_ignores_recently_active_stale_pr(self):
        """Test that a PR labeled stale but recently updated (e.g. user replied) is NOT closed."""
        pr = self.create_mock_pr(1, updated_delta_days=2, labels=[STALE_LABEL])
        self.mock_repo.get_pulls.return_value = [pr]

        check_stale_prs(self.mock_gh, "owner/repo")

        pr.edit.assert_not_called()

    def test_skips_pr_awaiting_reviewer(self):
        """Test that an inactive PR with pending review requests is NOT marked stale."""
        pr = self.create_mock_pr(
            1, updated_delta_days=WARN_DAYS + 1, labels=[], pending_reviewers=1
        )
        self.mock_repo.get_pulls.return_value = [pr]

        check_stale_prs(self.mock_gh, "owner/repo", days_until_stale=WARN_DAYS)

        # Should NOT be marked stale — reviewer hasn't responded yet
        pr.add_to_labels.assert_not_called()
        pr.create_issue_comment.assert_not_called()

    def test_marks_stale_when_no_pending_reviewers(self):
        """Test that an inactive PR without pending reviewers IS marked stale."""
        pr = self.create_mock_pr(
            1, updated_delta_days=WARN_DAYS + 1, labels=[], pending_reviewers=0, pending_teams=0
        )
        self.mock_repo.get_pulls.return_value = [pr]

        check_stale_prs(self.mock_gh, "owner/repo", days_until_stale=WARN_DAYS)

        pr.add_to_labels.assert_called_with(STALE_LABEL)
        pr.create_issue_comment.assert_called_once()

if __name__ == '__main__':
    unittest.main()
