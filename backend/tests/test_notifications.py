from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIRequestFactory, force_authenticate

from api.notifications import send_notification_email
from api.views import health


class NotificationEmailTests(SimpleTestCase):
    @override_settings(
        EMAIL_NOTIFICATIONS_ENABLED=False,
        EMAIL_BACKEND="django.core.mail.backends.console.EmailBackend",
        EMAIL_HOST="",
        DEFAULT_FROM_EMAIL="noreply@example.com",
    )
    def test_send_notification_email_logs_when_notifications_are_disabled(self):
        with self.assertLogs("api.notifications", level="WARNING") as logs:
            sent = send_notification_email("Subject", "Body", ["user@example.com"])

        self.assertFalse(sent)
        self.assertIn("notifications disabled", logs.output[0])

    @override_settings(
        EMAIL_NOTIFICATIONS_ENABLED=True,
        EMAIL_BACKEND="django.core.mail.backends.smtp.EmailBackend",
        EMAIL_HOST="smtp.example.com",
        DEFAULT_FROM_EMAIL="noreply@example.com",
    )
    def test_send_notification_email_logs_when_recipient_list_is_empty(self):
        with self.assertLogs("api.notifications", level="WARNING") as logs:
            sent = send_notification_email("Subject", "Body", [])

        self.assertFalse(sent)
        self.assertIn("no recipients", logs.output[0])

    @override_settings(
        EMAIL_NOTIFICATIONS_ENABLED=True,
        EMAIL_BACKEND="django.core.mail.backends.smtp.EmailBackend",
        EMAIL_HOST="smtp.example.com",
        EMAIL_PORT=587,
        EMAIL_USE_TLS=True,
        EMAIL_USE_SSL=False,
        DEFAULT_FROM_EMAIL="noreply@example.com",
    )
    def test_send_notification_email_logs_delivery_errors_with_diagnostics(self):
        with patch("api.notifications.send_mail", side_effect=RuntimeError("smtp down")):
            with self.assertLogs("api.notifications", level="ERROR") as logs:
                sent = send_notification_email("Subject", "Body", ["user@example.com"])

        self.assertFalse(sent)
        self.assertIn("Failed to send email", logs.output[0])
        self.assertIn("port=587", logs.output[0])


class HealthViewTests(SimpleTestCase):
    def setUp(self):
        self.factory = APIRequestFactory()

    @override_settings(DEBUG=False)
    def test_health_hides_email_diagnostics_for_anonymous_requests_in_production(self):
        response = health(self.factory.get("/health"))

        self.assertEqual(response.data, {"status": "ok"})

    @override_settings(
        DEBUG=False,
        EMAIL_NOTIFICATIONS_ENABLED=True,
        EMAIL_BACKEND="django.core.mail.backends.smtp.EmailBackend",
        EMAIL_HOST="smtp.example.com",
        EMAIL_PORT=587,
        EMAIL_USE_TLS=True,
        EMAIL_USE_SSL=False,
        DEFAULT_FROM_EMAIL="noreply@example.com",
    )
    def test_health_includes_email_diagnostics_for_manager_requests(self):
        request = self.factory.get("/health")
        manager = SimpleNamespace(
            is_authenticated=True,
            profile=SimpleNamespace(role="Manager"),
        )
        force_authenticate(request, user=manager)

        response = health(request)

        self.assertEqual(response.data["status"], "ok")
        self.assertEqual(
            response.data["email"],
            {
                "enabled": True,
                "backend": "django.core.mail.backends.smtp.EmailBackend",
                "host_configured": True,
                "port": 587,
                "use_tls": True,
                "use_ssl": False,
                "from_email_configured": True,
            },
        )
