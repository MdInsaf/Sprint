import importlib
import os
import sys
import unittest
from unittest.mock import Mock, patch

from botocore.exceptions import NoCredentialsError


class SettingsSecretFallbackTests(unittest.TestCase):
    def tearDown(self):
        sys.modules.pop("core.settings", None)

    def _import_settings(self, *, allow_missing_secret: bool, secret_payload=None, env_overrides=None):
        env = {
            "ALLOW_MISSING_AWS_SECRET": "1" if allow_missing_secret else "",
            "AWS_SECRET_NAME": "dev/SprintFlow",
            "AWS_REGION": "ap-south-1",
            "DB_NAME": "test_db",
            "DB_USER": "test_user",
            "DB_PASSWORD": "test_password",
            "DB_HOST": "localhost",
            "DB_PORT": "5432",
        }
        if env_overrides:
            env.update(env_overrides)
        client = Mock()
        if secret_payload is None:
            client.get_secret_value.side_effect = NoCredentialsError()
        else:
            client.get_secret_value.return_value = {"SecretString": secret_payload}
        session = Mock()
        session.client.return_value = client

        sys.modules.pop("core.settings", None)
        with patch.dict(os.environ, env, clear=False):
            with patch("boto3.session.Session", return_value=session):
                return importlib.import_module("core.settings")

    def test_settings_import_allows_missing_secret_when_credentials_are_absent(self):
        settings = self._import_settings(allow_missing_secret=True)
        self.assertEqual(settings.secrets, {})

    def test_settings_import_still_raises_without_allow_missing_secret_flag(self):
        with self.assertRaises(NoCredentialsError):
            self._import_settings(allow_missing_secret=False)

    def test_email_boolean_flags_can_be_loaded_from_secret_manager(self):
        settings = self._import_settings(
            allow_missing_secret=True,
            secret_payload='{"EMAIL_HOST":"smtp.example.com","EMAIL_USE_TLS":"false","EMAIL_USE_SSL":"true","EMAIL_NOTIFICATIONS_ENABLED":"true"}',
        )

        self.assertEqual(settings.EMAIL_HOST, "smtp.example.com")
        self.assertFalse(settings.EMAIL_USE_TLS)
        self.assertTrue(settings.EMAIL_USE_SSL)
        self.assertTrue(settings.EMAIL_NOTIFICATIONS_ENABLED)

    def test_environment_email_boolean_flags_override_secret_manager_values(self):
        settings = self._import_settings(
            allow_missing_secret=True,
            secret_payload='{"EMAIL_HOST":"smtp.example.com","EMAIL_USE_TLS":"false","EMAIL_USE_SSL":"false","EMAIL_NOTIFICATIONS_ENABLED":"false"}',
            env_overrides={
                "EMAIL_USE_TLS": "true",
                "EMAIL_USE_SSL": "true",
                "EMAIL_NOTIFICATIONS_ENABLED": "true",
            },
        )

        self.assertTrue(settings.EMAIL_USE_TLS)
        self.assertTrue(settings.EMAIL_USE_SSL)
        self.assertTrue(settings.EMAIL_NOTIFICATIONS_ENABLED)
