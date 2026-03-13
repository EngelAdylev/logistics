"""
Тесты нормализации даты и активности рейсов (ТЗ №1, ТЗ №2).

Запуск: cd backend && python -m unittest tests.test_sync_normalization -v
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from datetime import timezone

from services.sync_service_v2 import _canonical_flight_start_date


class TestCanonicalFlightStartDate(unittest.TestCase):
    """ТЗ №2: нормализация даты — один рейс при одинаковом моменте времени."""

    def test_same_moment_different_timezone(self):
        """Одна дата в +03 и в UTC — один канонический результат."""
        raw1 = "2024-01-15 12:00:00+03"
        raw2 = "2024-01-15 09:00:00+00:00"
        c1 = _canonical_flight_start_date(raw1)
        c2 = _canonical_flight_start_date(raw2)
        assert c1 is not None and c2 is not None
        assert c1 == c2

    def test_same_moment_different_format(self):
        """Одна дата в разных строковых форматах — один результат."""
        raw1 = "2024-01-15 12:00:00.000"
        raw2 = "2024-01-15T12:00:00"
        c1 = _canonical_flight_start_date(raw1)
        c2 = _canonical_flight_start_date(raw2)
        assert c1 is not None and c2 is not None
        assert c1 == c2

    def test_microseconds_truncated(self):
        """Микросекунды обрезаются — даты в одну секунду становятся одинаковыми."""
        raw1 = "2024-01-15 12:00:00.000"
        raw2 = "2024-01-15 12:00:00.999"
        c1 = _canonical_flight_start_date(raw1)
        c2 = _canonical_flight_start_date(raw2)
        assert c1 is not None and c2 is not None
        assert c1.microsecond == 0 and c2.microsecond == 0
        assert c1 == c2

    def test_different_seconds_different_results(self):
        """Разные секунды — разные канонические значения."""
        raw1 = "2024-01-15 12:00:00"
        raw2 = "2024-01-15 12:00:01"
        c1 = _canonical_flight_start_date(raw1)
        c2 = _canonical_flight_start_date(raw2)
        assert c1 != c2

    def test_different_dates_different_results(self):
        """Разные даты — разные канонические значения."""
        raw1 = "2024-01-15 12:00:00"
        raw2 = "2024-01-16 12:00:00"
        c1 = _canonical_flight_start_date(raw1)
        c2 = _canonical_flight_start_date(raw2)
        assert c1 != c2

    def test_returns_utc(self):
        """Результат всегда в UTC."""
        raw = "2024-01-15 12:00:00+03"
        c = _canonical_flight_start_date(raw)
        assert c is not None
        assert c.tzinfo == timezone.utc

    def test_none_input(self):
        """None и пустая строка — None."""
        assert _canonical_flight_start_date(None) is None
        assert _canonical_flight_start_date("") is None
        assert _canonical_flight_start_date("   ") is None
