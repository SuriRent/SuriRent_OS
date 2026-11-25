import unittest

from sms_reminder_templates import reminder_sms


class ReminderSmsTests(unittest.TestCase):
    def test_tones_are_exactly_one_gsm_segment(self):
        url = "https://app.example.com/b/abc_123"
        for tone in ("friendly", "reminder", "urgent"):
            with self.subTest(tone=tone):
                result = reminder_sms(tone, "Huurbedrijf", url)
                self.assertEqual(len(result), 160)
                self.assertTrue(result.isascii())
                self.assertIn(url, result)

    def test_company_name_can_be_shortened_but_not_the_link(self):
        url = "https://example.com/b/" + "a" * 25
        result = reminder_sms("urgent", "A" * 200, url)
        self.assertEqual(len(result), 160)
        self.assertIn(url, result)

    def test_invalid_or_overlong_link_fails(self):
        for url in ("http://example.com/b/x", "https://example.com/b/x?secret=1", "https://example.com/" + "x" * 150):
            with self.subTest(url=url), self.assertRaises(ValueError):
                reminder_sms("friendly", "Bedrijf", url)

    def test_unknown_tone_and_unusable_company_fail(self):
        with self.assertRaises(ValueError):
            reminder_sms("other", "Bedrijf", "https://example.com/b/x")
        with self.assertRaises(ValueError):
            reminder_sms("friendly", "東京", "https://example.com/b/x")

    def test_accented_company_is_encoded_in_gsm(self):
        result = reminder_sms("friendly", "Café", "https://example.com/b/x")
        self.assertIn("Cafe", result)
        self.assertEqual(len(result), 160)
