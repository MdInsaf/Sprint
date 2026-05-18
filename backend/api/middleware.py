import logging
import uuid
from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.utils import timezone as django_timezone
from django.utils.deprecation import MiddlewareMixin

from .models import AuditLog


logger = logging.getLogger(__name__)

AUDIT_LOG_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
AUDIT_LOG_SKIP_PREFIXES = (
    "/v1/api/auth/login",
    "/v1/api/auth/logout",
    "/v1/api/csrf",
    "/v1/api/health",
)
AUDIT_LOG_ENTITY_KEYS = ("id", "task_id", "sprint_id", "member_id", "attachment_id", "deleted")
DEFAULT_USER_TIMEZONE = "UTC"


def _audit_now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _audit_user_metadata(user):
    if not user or not getattr(user, "is_authenticated", False):
        return {}

    profile = getattr(user, "profile", None)
    full_name = ""
    if hasattr(user, "get_full_name"):
        full_name = (user.get_full_name() or "").strip()

    return {
        "user_name": full_name or getattr(user, "username", "") or None,
        "username": getattr(user, "username", None),
        "user_email": getattr(user, "email", None),
        "user_role": getattr(profile, "role", None) if profile else None,
        "user_team": getattr(profile, "team", None) if profile else None,
        "user_timezone": getattr(profile, "timezone", None) if profile else None,
    }


def _audit_parse_entity(path):
    parts = path.split("?")[0].strip("/").split("/")
    if len(parts) < 3:
        return None, None
    if parts[0] != "v1" or parts[1] != "api":
        return None, None
    entity_type = parts[2]
    entity_id = parts[3] if len(parts) > 3 else None
    return entity_type, entity_id


def _audit_extract_entity_id(data):
    if not isinstance(data, dict):
        return None
    for key in AUDIT_LOG_ENTITY_KEYS:
        value = data.get(key)
        if value:
            return str(value)
    return None


_NO_CACHE_PREFIXES = (
    "/v1/api/auth/",
    "/v1/api/me",
    "/v1/api/csrf",
)


class NoCacheAuthMiddleware(MiddlewareMixin):
    """
    Set cache headers for API responses.
    Auth-sensitive endpoints get no-store.
    Read-only GET endpoints get a short private cache to speed up navigation.
    """

    def process_response(self, request, response):
        if not request.path.startswith("/v1/api/"):
            return response

        response["Vary"] = "Cookie"

        if request.path.startswith(_NO_CACHE_PREFIXES):
            response["Cache-Control"] = "no-store"
        elif request.method == "GET":
            response["Cache-Control"] = "private, max-age=30, stale-while-revalidate=60"
        else:
            response["Cache-Control"] = "no-store"

        return response


class UserTimezoneMiddleware(MiddlewareMixin):
    """
    Activate the authenticated user's IANA timezone for request-scoped Django code
    (ORM localtime helpers, admin display, etc.).

    NOTE: All business-critical elapsed-day calculations pass work_tz explicitly
    and do NOT rely on this activation for correctness.

    Auth ordering note:
    - Django session auth (AuthenticationMiddleware) populates request.user before
      this middleware runs, so process_request works for session-authenticated users.
    - DRF token/JWT authentication runs inside view dispatch (after all middleware),
      so process_request sees AnonymousUser for those auth schemes and falls back to
      UTC. process_view re-activates with the correct timezone for DRF views that
      use Django's own session authentication backend (which populates request.user
      via AuthenticationMiddleware). Pure DRF token/JWT auth will still see UTC here;
      if that matters for display, move activation into a DRF authentication class.
    """

    @staticmethod
    def _activate_for_user(user):
        profile = getattr(user, "profile", None) if getattr(user, "is_authenticated", False) else None
        timezone_name = (getattr(profile, "timezone", None) or DEFAULT_USER_TIMEZONE).strip()
        try:
            tz = ZoneInfo(timezone_name)
        except (ZoneInfoNotFoundError, ValueError):
            logger.warning(
                "UserTimezoneMiddleware: invalid timezone %r for user %s, falling back to UTC",
                timezone_name,
                getattr(user, "username", "<anonymous>"),
            )
            tz = ZoneInfo(DEFAULT_USER_TIMEZONE)
        django_timezone.activate(tz)

    def process_request(self, request):
        user = getattr(request, "user", None)
        if not getattr(user, "is_authenticated", False):
            # Unauthenticated at this stage — activate UTC as a safe default.
            # process_view will upgrade this if DRF session auth has run by then.
            django_timezone.activate(ZoneInfo(DEFAULT_USER_TIMEZONE))
            return
        self._activate_for_user(user)

    def process_view(self, request, view_func, view_args, view_kwargs):
        # Re-check in case Django's AuthenticationMiddleware wasn't processed yet
        # during process_request (e.g. test clients that inject request.user late).
        user = getattr(request, "user", None)
        if getattr(user, "is_authenticated", False):
            self._activate_for_user(user)

    def process_response(self, request, response):
        django_timezone.deactivate()
        return response


class AuditLogMiddleware(MiddlewareMixin):
    """
    Record audit logs for mutating API requests.
    """

    def process_response(self, request, response):
        try:
            path = getattr(request, "path", "") or ""
            method = getattr(request, "method", "").upper()
            if not path.startswith("/v1/api/"):
                return response
            if method not in AUDIT_LOG_METHODS:
                return response
            if path.startswith(AUDIT_LOG_SKIP_PREFIXES):
                return response
            if getattr(response, "status_code", 500) >= 400:
                return response

            user = getattr(request, "user", None)
            user_value = user if getattr(user, "is_authenticated", False) else None

            entity_type, entity_id = _audit_parse_entity(path)
            response_data = getattr(response, "data", None)
            response_entity_id = _audit_extract_entity_id(response_data)
            if response_entity_id:
                entity_id = entity_id or response_entity_id

            action = {
                "POST": "create",
                "PUT": "update",
                "PATCH": "update",
                "DELETE": "delete",
            }.get(method, method.lower())

            forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR", "")
            ip_address = forwarded_for.split(",")[0].strip() if forwarded_for else request.META.get("REMOTE_ADDR")
            metadata = {k: v for k, v in _audit_user_metadata(user_value).items() if v not in (None, "")}

            AuditLog.objects.create(
                id=f"audit-{uuid.uuid4().hex[:12]}",
                user=user_value,
                action=action,
                entity_type=entity_type,
                entity_id=entity_id,
                path=path,
                method=method,
                status_code=getattr(response, "status_code", 200),
                ip_address=ip_address,
                user_agent=request.META.get("HTTP_USER_AGENT"),
                metadata=metadata,
                created_date=_audit_now_iso(),
            )
        except Exception:
            logger.exception("Failed to write audit log")
        return response
