"""
Tests for stale PR check.

All `updated_at` and "now" values are pinned to a concrete Monday (2026-03-09)
so that `count_business_days` returns deterministic results regardless of when
the test suite is run.  This is necessary because the check uses business-day
counting which is sensitive to which calendar day `updated_at` falls on.

Anchor:
  NOW = Monday 2026-03-09 12:00 UTC

Business-day offsets from NOW (all going backwards in time):
  1 bd  ago = Friday  2026-03-06  (Mon – skip Sat/Sun – Fri)
  2 bds ago = Thursday 2026-03-05
  5 bds ago = Monday  2026-03-02
  7 bds ago = Thursday 2026-02-26
  8 bds ago = Wednesday 2026-02-25
 14 bds ago = Monday  2026-02-23  (exactly WARN_DAYS)
 15 bds ago = Friday  2026-02-20  (WARN_DAYS + 1)
 21 bds ago = Monday  2026-02-09  (CLOSE_DAYS=7 bds after WARN_DAYS: just testing CLOSE_DAYS)
"""

import unittest
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock, patch

from ruciobot.checks.stale_prs import (
    CLOSE_DAYS,
    STALE_LABEL,
    WARN_DAYS,
    process_pr,
)

# Pinned "now" for all tests — a Monday at noon UTC.
NOW = datetime(2026, 3, 9, 12, 0, tzinfo=UTC)


def business_days_before(n: int, anchor: datetime = NOW) -> datetime:
    """Return the datetime that is exactly *n* business days before *anchor*."""
    current = anchor
    counted = 0
    while counted < n:
        current -= timedelta(days=1)
        if current.weekday() < 5:  # Mon–Fri
            counted += 1
    return current


# Pre-computed anchor offsets used across tests
ACTIVE_DATE = business_days_before(2)  # 2 bds ago → Thu 2025-03-06 (< WARN_DAYS)
STALE_WARN_DATE = business_days_before(WARN_DAYS + 1)  # 15 bds ago → well past threshold
CLOSE_DATE = business_days_before(CLOSE_DAYS + 1)  # 8 bds ago → past CLOSE_DAYS (7)
RECENT_DATE = business_days_before(1)  # 1 bd ago → Fri 2025-03-07


class TestStalePRs(unittest.TestCase):
    def _mock_now(self, mock_dt):
        """Configure the datetime mock to return NOW for datetime.now()."""
        mock_dt.now.return_value = NOW

    def create_mock_pr(
        self,
        number,
        updated_at,
        labels=[],
        pending_reviewers=0,
        pending_teams=0,
        approved_reviews=0,
    ):
        pr = MagicMock()
        pr.number = number
        pr.title = f"PR {number}"
        pr.updated_at = updated_at

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

    # Core behaviour tests

    def test_warns_inactive_pr(self):
        """Inactive PR (> WARN_DAYS business days) with no pending reviewers gets warned."""
        pr = self.create_mock_pr(1, updated_at=STALE_WARN_DATE, labels=[], pending_reviewers=0)
        with patch("ruciobot.checks.stale_prs.datetime") as mock_dt:
            self._mock_now(mock_dt)
            process_pr(pr, WARN_DAYS)
        pr.add_to_labels.assert_called_with(STALE_LABEL)
        pr.create_issue_comment.assert_called_once()

    def test_ignores_active_pr(self):
        """Active PR (< WARN_DAYS business days) is ignored."""
        pr = self.create_mock_pr(1, updated_at=ACTIVE_DATE, labels=[])
        with patch("ruciobot.checks.stale_prs.datetime") as mock_dt:
            self._mock_now(mock_dt)
            process_pr(pr, WARN_DAYS)
        pr.add_to_labels.assert_not_called()
        pr.create_issue_comment.assert_not_called()

    def test_closes_stale_pr(self):
        """Stale-labeled PR with further inactivity past CLOSE_DAYS is closed."""
        pr = self.create_mock_pr(1, updated_at=CLOSE_DATE, labels=[STALE_LABEL])
        with patch("ruciobot.checks.stale_prs.datetime") as mock_dt:
            self._mock_now(mock_dt)
            process_pr(pr, WARN_DAYS)
        pr.edit.assert_called_with(state="closed")
        pr.create_issue_comment.assert_called()

    def test_ignores_recently_active_stale_pr(self):
        """Stale-labeled PR that was recently updated is NOT closed."""
        pr = self.create_mock_pr(1, updated_at=ACTIVE_DATE, labels=[STALE_LABEL])
        with patch("ruciobot.checks.stale_prs.datetime") as mock_dt:
            self._mock_now(mock_dt)
            process_pr(pr, WARN_DAYS)
        pr.edit.assert_not_called()

    def test_skips_pr_awaiting_reviewer(self):
        """Inactive PR with pending review requests is NOT marked stale."""
        pr = self.create_mock_pr(1, updated_at=STALE_WARN_DATE, labels=[], pending_reviewers=1)
        with patch("ruciobot.checks.stale_prs.datetime") as mock_dt:
            self._mock_now(mock_dt)
            process_pr(pr, WARN_DAYS)
        pr.add_to_labels.assert_not_called()
        pr.create_issue_comment.assert_not_called()

    def test_marks_stale_when_no_pending_reviewers(self):
        """Inactive PR without pending reviewers IS marked stale."""
        pr = self.create_mock_pr(1, updated_at=STALE_WARN_DATE, labels=[], pending_reviewers=0)
        with patch("ruciobot.checks.stale_prs.datetime") as mock_dt:
            self._mock_now(mock_dt)
            process_pr(pr, WARN_DAYS)
        pr.add_to_labels.assert_called_with(STALE_LABEL)
        pr.create_issue_comment.assert_called_once()

    def test_skips_pr_with_no_bot_label(self):
        """PR with 'no-bot' label is completely skipped by all stale checks."""
        from ruciobot.checks.base import NO_BOT_LABEL

        pr = self.create_mock_pr(1, updated_at=STALE_WARN_DATE, labels=[NO_BOT_LABEL])
        with patch("ruciobot.checks.stale_prs.datetime") as mock_dt:
            self._mock_now(mock_dt)
            process_pr(pr, WARN_DAYS)
        pr.add_to_labels.assert_not_called()
        pr.create_issue_comment.assert_not_called()
        pr.edit.assert_not_called()

    def test_skips_pr_with_approved_review(self):
        """Inactive PR that already has an approved review is NOT marked stale."""
        pr = self.create_mock_pr(1, updated_at=STALE_WARN_DATE, labels=[], approved_reviews=1)
        with patch("ruciobot.checks.stale_prs.datetime") as mock_dt:
            self._mock_now(mock_dt)
            process_pr(pr, WARN_DAYS)
        pr.add_to_labels.assert_not_called()
        pr.create_issue_comment.assert_not_called()

    def test_removes_stale_label_when_reviewer_assigned_after_stale(self):
        """Stale-labeled PR that later gets a reviewer assigned has stale label removed."""
        pr = self.create_mock_pr(
            1, updated_at=CLOSE_DATE, labels=[STALE_LABEL], pending_reviewers=1
        )
        with patch("ruciobot.checks.stale_prs.datetime") as mock_dt:
            self._mock_now(mock_dt)
            process_pr(pr, WARN_DAYS)
        pr.remove_from_labels.assert_called_with(STALE_LABEL)
        pr.edit.assert_not_called()

    def test_removes_stale_label_when_approved_after_stale(self):
        """Stale-labeled PR that later gets approved has stale label removed."""
        pr = self.create_mock_pr(1, updated_at=CLOSE_DATE, labels=[STALE_LABEL], approved_reviews=1)
        with patch("ruciobot.checks.stale_prs.datetime") as mock_dt:
            self._mock_now(mock_dt)
            process_pr(pr, WARN_DAYS)
        pr.remove_from_labels.assert_called_with(STALE_LABEL)
        pr.edit.assert_not_called()

    # Weekend-aware tests

    def test_does_not_warn_when_only_weekend_has_passed(self):
        """PR pushed on a Friday; bot runs on Sunday — 0 business days elapsed, no warning.

        Timeline:
          - updated_at = Friday 2026-03-06 17:00 UTC
          - "now"      = Sunday 2026-03-08 09:00 UTC
          Business days between Fri 17:00 and Sun 09:00 = 0  (< WARN_DAYS=14).
        """
        friday = datetime(2026, 3, 6, 17, 0, tzinfo=UTC)
        sunday = datetime(2026, 3, 8, 9, 0, tzinfo=UTC)

        pr = self.create_mock_pr(1, updated_at=friday, labels=[])

        with patch("ruciobot.checks.stale_prs.datetime") as mock_dt:
            mock_dt.now.return_value = sunday
            process_pr(pr, WARN_DAYS)

        pr.add_to_labels.assert_not_called()
        pr.create_issue_comment.assert_not_called()

    def test_warns_after_enough_business_days_spanning_weekend(self):
        """PR pushed 3 weeks ago on a Monday; 15 business days elapsed → warn.

        Timeline:
          - updated_at = Monday 2026-02-16 09:00 UTC
          - "now"      = Monday 2026-03-09 09:00 UTC
          3 calendar weeks * 5 weekdays = 15 business days >= WARN_DAYS (14).
        """
        three_weeks_ago = datetime(2026, 2, 16, 9, 0, tzinfo=UTC)
        now_monday = datetime(2026, 3, 9, 9, 0, tzinfo=UTC)

        pr = self.create_mock_pr(1, updated_at=three_weeks_ago, labels=[])

        with patch("ruciobot.checks.stale_prs.datetime") as mock_dt:
            mock_dt.now.return_value = now_monday
            process_pr(pr, WARN_DAYS)

        pr.add_to_labels.assert_called_with(STALE_LABEL)
        pr.create_issue_comment.assert_called_once()


if __name__ == "__main__":
    unittest.main()
