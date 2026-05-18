from datetime import date
from unittest.mock import patch
from zoneinfo import ZoneInfo

from django.test import SimpleTestCase, RequestFactory, override_settings

from .views import compute_elapsed_days, parse_datetime


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_BASE_SETTINGS = dict(
    WORKDAY_HOURS=8,
    WORKDAY_START_HOUR=10,
    WORKDAY_END_HOUR=18,
    WEEKEND_DAYS=[5, 6],
    HOLIDAY_DATES=[],
)

_NIGHT_SETTINGS = dict(
    WORKDAY_HOURS=8,
    WORKDAY_START_HOUR=22,
    WORKDAY_END_HOUR=6,
    WEEKEND_DAYS=[5, 6],
    HOLIDAY_DATES=[],
)


# ---------------------------------------------------------------------------
# Existing regression tests (must not break)
# ---------------------------------------------------------------------------

class ExistingRegressionTests(SimpleTestCase):

    @override_settings(**_BASE_SETTINGS)
    def test_elapsed_hours_use_india_local_workday(self):
        # 04:30–12:30 UTC = 10:00–18:00 IST → exactly 1 working day
        elapsed = compute_elapsed_days(
            "2026-03-02T04:30:00Z",
            "2026-03-02T12:30:00Z",
            work_tz=ZoneInfo("Asia/Kolkata"),
        )
        self.assertEqual(elapsed, 1.0)

    @override_settings(**_BASE_SETTINGS)
    def test_elapsed_hours_are_dst_safe_for_canada(self):
        # Fri 10:00 EST → Mon 11:00 EDT across the spring-forward weekend.
        # Friday: 10:00–18:00 EST = 1.0 day; Monday: 10:00–11:00 EDT = 0.125 day.
        elapsed = compute_elapsed_days(
            "2026-03-06T15:00:00Z",
            "2026-03-09T15:00:00Z",
            work_tz=ZoneInfo("America/Toronto"),
        )
        self.assertEqual(elapsed, 1.125)

    @override_settings(**_NIGHT_SETTINGS)
    def test_cross_midnight_work_windows_are_counted(self):
        # Monday 22:00 UTC → Tuesday 02:00 UTC = 4 working hours = 0.5 day
        elapsed = compute_elapsed_days(
            "2026-05-04T22:00:00Z",
            "2026-05-05T02:00:00Z",
            work_tz=ZoneInfo("UTC"),
        )
        self.assertEqual(elapsed, 0.5)


# ---------------------------------------------------------------------------
# BUG-04 — cross-midnight weekend boundary
# ---------------------------------------------------------------------------

class CrossMidnightWeekendTests(SimpleTestCase):

    @override_settings(**_NIGHT_SETTINGS)
    def test_friday_overnight_saturday_hours_not_counted(self):
        # Night shift: Friday 22:00 UTC → Saturday 06:00 UTC (full window).
        # Only the Friday-side portion (22:00–00:00 = 2 h) should count.
        # Saturday 00:00–06:00 is a weekend and must NOT be credited.
        elapsed = compute_elapsed_days(
            "2026-05-08T22:00:00Z",   # Friday 22:00 UTC
            "2026-05-09T06:00:00Z",   # Saturday 06:00 UTC
            work_tz=ZoneInfo("UTC"),
        )
        # 2 hours pre-midnight (Friday) / 8 workday hours = 0.25
        self.assertAlmostEqual(elapsed, 0.25, places=6)

    @override_settings(**_NIGHT_SETTINGS)
    def test_friday_overnight_partial_saturday_not_counted(self):
        # Night shift starts Friday 23:00, ends Saturday 03:00.
        # Friday portion: 23:00–00:00 = 1 h. Saturday portion: 0 h (weekend).
        elapsed = compute_elapsed_days(
            "2026-05-08T23:00:00Z",   # Friday 23:00 UTC
            "2026-05-09T03:00:00Z",   # Saturday 03:00 UTC
            work_tz=ZoneInfo("UTC"),
        )
        self.assertAlmostEqual(elapsed, 1 / 8, places=6)

    @override_settings(**_NIGHT_SETTINGS)
    def test_sunday_overnight_monday_hours_counted(self):
        # Sunday 22:00 → Monday 06:00.
        # Sunday portion (22:00–00:00 = 2 h) is weekend → not counted.
        # Monday portion (00:00–06:00 = 6 h) is working day → counted.
        elapsed = compute_elapsed_days(
            "2026-05-10T22:00:00Z",   # Sunday 22:00 UTC
            "2026-05-11T06:00:00Z",   # Monday 06:00 UTC
            work_tz=ZoneInfo("UTC"),
        )
        self.assertAlmostEqual(elapsed, 6 / 8, places=6)

    @override_settings(**_NIGHT_SETTINGS)
    def test_full_weekday_night_shift_both_portions_counted(self):
        # Tuesday 22:00 → Wednesday 06:00: both sides are working days.
        elapsed = compute_elapsed_days(
            "2026-05-05T22:00:00Z",   # Tuesday 22:00 UTC
            "2026-05-06T06:00:00Z",   # Wednesday 06:00 UTC
            work_tz=ZoneInfo("UTC"),
        )
        self.assertEqual(elapsed, 1.0)


# ---------------------------------------------------------------------------
# DST — spring-forward (North America, second Sunday of March)
# ---------------------------------------------------------------------------

class SpringForwardDSTTests(SimpleTestCase):

    @override_settings(**_BASE_SETTINGS)
    def test_spring_forward_work_window_correct_local_hours(self):
        # 2026-03-08 is spring-forward Sunday in America/Toronto.
        # The transition is on a weekend so it doesn't affect working hours directly,
        # but Monday's work window must use 10:00 EDT (not 11:00 EDT).
        # Monday: 10:00–18:00 EDT = 14:00–22:00 UTC. Task covers full window.
        elapsed = compute_elapsed_days(
            "2026-03-09T14:00:00Z",   # Monday 10:00 EDT
            "2026-03-09T22:00:00Z",   # Monday 18:00 EDT
            work_tz=ZoneInfo("America/Toronto"),
        )
        self.assertEqual(elapsed, 1.0)

    @override_settings(**_BASE_SETTINGS)
    def test_spring_forward_partial_monday(self):
        # Task ends at 12:00 EDT = 16:00 UTC on the post-spring-forward Monday.
        elapsed = compute_elapsed_days(
            "2026-03-09T14:00:00Z",   # Monday 10:00 EDT
            "2026-03-09T16:00:00Z",   # Monday 12:00 EDT
            work_tz=ZoneInfo("America/Toronto"),
        )
        self.assertAlmostEqual(elapsed, 2 / 8, places=6)

    @override_settings(**_BASE_SETTINGS)
    def test_spring_forward_spans_weekend_correctly(self):
        # Task runs Fri 10:00 EST → Tue 10:00 EDT across spring-forward weekend.
        # Fri: 8 h, Mon: 8 h, Tue: 0 h (ends exactly at work_start). = 2.0 days
        elapsed = compute_elapsed_days(
            "2026-03-06T15:00:00Z",   # Fri 10:00 EST
            "2026-03-10T14:00:00Z",   # Tue 10:00 EDT
            work_tz=ZoneInfo("America/Toronto"),
        )
        self.assertEqual(elapsed, 2.0)


# ---------------------------------------------------------------------------
# DST — fall-back (North America, first Sunday of November)
# ---------------------------------------------------------------------------

class FallBackDSTTests(SimpleTestCase):

    @override_settings(**_BASE_SETTINGS)
    def test_fall_back_no_double_counting(self):
        # 2026-11-01 is fall-back Sunday in America/Toronto (EDT→EST, 02:00→01:00).
        # Monday 2026-11-02: work window 10:00–18:00 EST = 15:00–23:00 UTC.
        # The clocks fell back the night before; Monday itself has no ambiguous hours.
        elapsed = compute_elapsed_days(
            "2026-11-02T15:00:00Z",   # Monday 10:00 EST
            "2026-11-02T23:00:00Z",   # Monday 18:00 EST
            work_tz=ZoneInfo("America/Toronto"),
        )
        self.assertEqual(elapsed, 1.0)

    @override_settings(**_BASE_SETTINGS)
    def test_fall_back_friday_to_monday_correct(self):
        # Fri 10:00 EDT → Mon 18:00 EST across fall-back weekend.
        # Fri: 8 h, Mon: 8 h = 2.0 days.
        elapsed = compute_elapsed_days(
            "2026-10-30T14:00:00Z",   # Fri 10:00 EDT (UTC-4)
            "2026-11-02T23:00:00Z",   # Mon 18:00 EST (UTC-5)
            work_tz=ZoneInfo("America/Toronto"),
        )
        self.assertEqual(elapsed, 2.0)

    @override_settings(**_NIGHT_SETTINGS)
    def test_fall_back_overnight_no_double_counting(self):
        # Night shift spanning fall-back: Sat 22:00 EDT → Sun 06:00 EST.
        # Sat=weekend, Sun=weekend → 0 hours.
        elapsed = compute_elapsed_days(
            "2026-11-01T02:00:00Z",   # Sat 22:00 EDT (UTC-4) → UTC = 22:00+4h = Nov01 02:00Z
            "2026-11-01T11:00:00Z",   # Sun 06:00 EST (UTC-5)
            work_tz=ZoneInfo("America/Toronto"),
        )
        self.assertEqual(elapsed, 0.0)

    @override_settings(**_NIGHT_SETTINGS)
    def test_fall_back_weekday_night_shift_not_doubled(self):
        # Mon 22:00 EDT → Tue 06:00 EST crossing fall-back (the transition is
        # actually on Sunday, so this is just a normal night shift on a week
        # following fall-back; both days are working days, should be 1.0 day).
        elapsed = compute_elapsed_days(
            "2026-11-03T03:00:00Z",   # Mon 22:00 EST (UTC-5) → UTC = 22:00+5h = Nov03 03:00Z
            "2026-11-03T11:00:00Z",   # Tue 06:00 EST
            work_tz=ZoneInfo("America/Toronto"),
        )
        self.assertEqual(elapsed, 1.0)


# ---------------------------------------------------------------------------
# DST — Australia (AEDT→AEST, first Sunday of April; AEST→AEDT, first Sunday of October)
# ---------------------------------------------------------------------------

class AustraliaDSTTests(SimpleTestCase):

    @override_settings(**_BASE_SETTINGS)
    def test_australia_fall_back_april(self):
        # 2026-04-05 is fall-back Sunday in Australia/Sydney (AEDT→AEST).
        # Monday 2026-04-06: work window 10:00–18:00 AEST (UTC+10) = 00:00–08:00 UTC.
        elapsed = compute_elapsed_days(
            "2026-04-06T00:00:00Z",   # Mon 10:00 AEST
            "2026-04-06T08:00:00Z",   # Mon 18:00 AEST
            work_tz=ZoneInfo("Australia/Sydney"),
        )
        self.assertEqual(elapsed, 1.0)

    @override_settings(**_BASE_SETTINGS)
    def test_australia_spring_forward_october(self):
        # 2026-10-04 is spring-forward Sunday in Australia/Sydney (AEST→AEDT).
        # Monday 2026-10-05: work window 10:00–18:00 AEDT (UTC+11) = 23:00–07:00 UTC prev/next.
        elapsed = compute_elapsed_days(
            "2026-10-04T23:00:00Z",   # Mon 10:00 AEDT
            "2026-10-05T07:00:00Z",   # Mon 18:00 AEDT
            work_tz=ZoneInfo("Australia/Sydney"),
        )
        self.assertEqual(elapsed, 1.0)

    @override_settings(**_BASE_SETTINGS)
    def test_australia_cross_dst_week(self):
        # Fri before spring-forward → Mon after, 10:00 local → 18:00 local.
        # Fri: 8 h, Mon: 8 h = 2.0 days.
        elapsed = compute_elapsed_days(
            "2026-10-02T00:00:00Z",   # Fri 10:00 AEST (UTC+10)
            "2026-10-05T07:00:00Z",   # Mon 18:00 AEDT (UTC+11)
            work_tz=ZoneInfo("Australia/Sydney"),
        )
        self.assertEqual(elapsed, 2.0)


# ---------------------------------------------------------------------------
# BUG-05 — parse_datetime naive timestamp handling
# ---------------------------------------------------------------------------

class NaiveTimestampParsingTests(SimpleTestCase):

    def test_utc_z_suffix_parsed_correctly(self):
        dt = parse_datetime("2026-03-02T10:00:00Z")
        self.assertIsNotNone(dt)
        self.assertEqual(dt.utcoffset().total_seconds(), 0)

    def test_utc_offset_suffix_parsed_correctly(self):
        dt = parse_datetime("2026-03-02T10:00:00+00:00")
        self.assertIsNotNone(dt)
        self.assertEqual(dt.utcoffset().total_seconds(), 0)

    def test_naive_iso_string_treated_as_utc_with_warning(self):
        # Naive strings are stamped as UTC (matching historical write behavior).
        # A warning must be emitted so ops can detect legacy rows.
        with self.assertLogs("api.views", level="WARNING") as log:
            dt = parse_datetime("2026-03-02T10:00:00")
        self.assertIsNotNone(dt)
        self.assertEqual(dt.utcoffset().total_seconds(), 0)
        self.assertTrue(any("naive" in msg for msg in log.output))

    def test_date_only_string_treated_as_utc_with_warning(self):
        with self.assertLogs("api.views", level="WARNING") as log:
            dt = parse_datetime("2026-03-02")
        self.assertIsNotNone(dt)
        self.assertEqual(dt.utcoffset().total_seconds(), 0)
        self.assertTrue(any("naive" in msg or "date-only" in msg for msg in log.output))

    def test_none_returns_none(self):
        self.assertIsNone(parse_datetime(None))

    def test_empty_string_returns_none(self):
        self.assertIsNone(parse_datetime(""))

    def test_unparseable_string_returns_none(self):
        self.assertIsNone(parse_datetime("not-a-date"))

    def test_non_utc_offset_preserved(self):
        dt = parse_datetime("2026-03-02T10:00:00+05:30")
        self.assertIsNotNone(dt)
        self.assertEqual(dt.utcoffset().total_seconds(), 5.5 * 3600)


# ---------------------------------------------------------------------------
# BUG-06 — holiday cache isolation between test cases
# ---------------------------------------------------------------------------

class HolidayCacheIsolationTests(SimpleTestCase):

    @override_settings(
        WORKDAY_HOURS=8,
        WORKDAY_START_HOUR=10,
        WORKDAY_END_HOUR=18,
        WEEKEND_DAYS=[5, 6],
        HOLIDAY_DATES=["2026-03-02"],   # Monday is a holiday
    )
    def test_holiday_excluded_when_configured(self):
        # Monday 2026-03-02 is a holiday → 0 elapsed days.
        elapsed = compute_elapsed_days(
            "2026-03-02T04:30:00Z",
            "2026-03-02T12:30:00Z",
            work_tz=ZoneInfo("Asia/Kolkata"),
        )
        self.assertEqual(elapsed, 0.0)

    @override_settings(
        WORKDAY_HOURS=8,
        WORKDAY_START_HOUR=10,
        WORKDAY_END_HOUR=18,
        WEEKEND_DAYS=[5, 6],
        HOLIDAY_DATES=[],              # No holidays this time
    )
    def test_same_day_not_holiday_in_different_test(self):
        # Previous test's holiday must NOT bleed into this test (lru_cache removed).
        elapsed = compute_elapsed_days(
            "2026-03-02T04:30:00Z",
            "2026-03-02T12:30:00Z",
            work_tz=ZoneInfo("Asia/Kolkata"),
        )
        self.assertEqual(elapsed, 1.0)


# ---------------------------------------------------------------------------
# Middleware timezone activation
# ---------------------------------------------------------------------------

class UserTimezoneMiddlewareTests(SimpleTestCase):

    def _make_middleware(self):
        from .middleware import UserTimezoneMiddleware
        from django.utils import timezone as django_tz
        return UserTimezoneMiddleware(get_response=lambda r: None), django_tz

    def _mock_user(self, tz_name):
        from unittest.mock import MagicMock
        user = MagicMock()
        user.is_authenticated = True
        user.username = "testuser"
        profile = MagicMock()
        profile.timezone = tz_name
        user.profile = profile
        return user

    def test_authenticated_user_timezone_activated(self):
        from django.utils import timezone as django_tz
        from zoneinfo import ZoneInfo
        mw, _ = self._make_middleware()
        request = RequestFactory().get("/v1/api/tasks/")
        request.user = self._mock_user("Asia/Kolkata")
        mw.process_request(request)
        self.assertEqual(django_tz.get_current_timezone(), ZoneInfo("Asia/Kolkata"))
        mw.process_response(request, type("R", (), {"status_code": 200})())

    def test_unauthenticated_request_activates_utc(self):
        from django.utils import timezone as django_tz
        from unittest.mock import MagicMock
        mw, _ = self._make_middleware()
        request = RequestFactory().get("/v1/api/tasks/")
        anon = MagicMock()
        anon.is_authenticated = False
        request.user = anon
        mw.process_request(request)
        self.assertEqual(str(django_tz.get_current_timezone()), "UTC")
        mw.process_response(request, type("R", (), {"status_code": 200})())

    def test_invalid_timezone_falls_back_to_utc_with_warning(self):
        from django.utils import timezone as django_tz
        mw, _ = self._make_middleware()
        request = RequestFactory().get("/v1/api/tasks/")
        request.user = self._mock_user("Invalid/Timezone")
        with self.assertLogs("api.middleware", level="WARNING") as log:
            mw.process_request(request)
        self.assertEqual(str(django_tz.get_current_timezone()), "UTC")
        self.assertTrue(any("invalid timezone" in msg.lower() for msg in log.output))
        mw.process_response(request, type("R", (), {"status_code": 200})())

    def test_process_response_deactivates_timezone(self):
        from django.utils import timezone as django_tz
        mw, _ = self._make_middleware()
        request = RequestFactory().get("/")
        request.user = self._mock_user("America/Toronto")
        mw.process_request(request)
        mw.process_response(request, type("R", (), {"status_code": 200})())
        # After deactivation, Django returns the default (settings.TIME_ZONE = UTC).
        self.assertEqual(str(django_tz.get_current_timezone()), "UTC")
