import logging
import os
import re
import time
import uuid
import tempfile
import subprocess
from datetime import datetime, timezone, timedelta
from functools import lru_cache
import boto3
from botocore.exceptions import ClientError
import logging


from django.contrib.auth import authenticate, login, logout, get_user_model
from django.contrib.auth.tokens import default_token_generator
from django.utils.encoding import force_bytes, force_str
from django.utils import timezone as django_timezone
from django.utils.http import urlsafe_base64_encode, urlsafe_base64_decode
from django.db import transaction
from django.db import IntegrityError
from django.db.models import Q
from django.views.decorators.csrf import ensure_csrf_cookie
from django.conf import settings
from rest_framework.decorators import api_view, permission_classes, authentication_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework import status

from .models import (
    MemberProfile,
    Sprint,
    Task,
    Approval,
    SprintSummary,
    TaskComment,
    TaskAttachment,
    AuditLog,
)
from .notifications import (
    get_role_emails,
    get_user,
    send_assignment_email,
    send_blocker_email,
    send_bug_fixed_email,
    send_needs_fix_email,
    send_ready_to_test_email,
    send_status_changed_email,
)
from .permissions import IsManager, IsManagerOrReadOnly, IsOwnerOrManager, PublicReadManagerWrite, IsManagerOrSelf


DEFAULT_PASSWORD_VALUE = os.environ.get("DEFAULT_USER_PASSWORD", "password123")
User = get_user_model()
logger = logging.getLogger(__name__)

DONE_STATUSES = {"Done", "Closed", "Fixed"}
WORK_STATUSES = {"In Progress", "Reopen"}
BLOCKED_STATUS = "Blocked"
QA_STATUSES = {"Ready to Test", "Testing", "Rework", "Fixing", "Ready to Stage"}
QA_ACTIVE_STATUSES = {"Testing"}
DEFAULT_QA_STATUS = "Ready to Test"
TASK_ID_PREFIXES = {
    "sprint": "SP",
    "additional": "ADD",
    "backlog": "BLG",
    "bug": "BUG",
    "change": "CHG",
}
TASK_ID_MIN_DIGITS = 3

PAGINATION_DEFAULT_PAGE_SIZE = getattr(settings, "API_PAGE_SIZE", 50)
PAGINATION_MAX_PAGE_SIZE = getattr(settings, "API_MAX_PAGE_SIZE", 200)


def _should_paginate(request):
    params = getattr(request, "query_params", {}) or {}
    return "page" in params or "page_size" in params


def _query_bool(params, key, default):
    raw = params.get(key)
    if raw is None:
        return default
    value = str(raw).strip().lower()
    if value in {"1", "true", "yes", "on"}:
        return True
    if value in {"0", "false", "no", "off"}:
        return False
    return default


class StandardPagination(PageNumberPagination):
    page_size = PAGINATION_DEFAULT_PAGE_SIZE
    page_size_query_param = "page_size"
    max_page_size = PAGINATION_MAX_PAGE_SIZE

    def paginate_queryset(self, queryset, request, view=None):
        if not _should_paginate(request):
            return None
        return super().paginate_queryset(queryset, request, view=view)


def _normalized_role(profile):
    return (getattr(profile, "role", "") or "").strip().lower()


def _is_super_admin(user):
    profile = getattr(user, "profile", None)
    return _normalized_role(profile) == "super admin"


def _is_manager(user):
    profile = getattr(user, "profile", None)
    return _normalized_role(profile) in {"manager", "super admin"}


ASSOCIATE_TEAMS = {"R&D", "GRC"}
SECURITY_TEAMS = {"GRC"}


def _is_associate(role):
    return (role or "").strip().lower() == "associate"


def _is_security(role):
    return (role or "").strip().lower() in {"security", "system"}


def _normalize_role_label(role):
    value = (role or "").strip()
    if not value:
        return value
    if value.lower() in {"security", "system"}:
        return "Security"
    return value


def _is_grc_team(team):
    return (team or "").strip().lower() == "grc"


def _is_grc_user(user):
    return _is_grc_team(_user_team(user))


def _user_team(user):
    profile = getattr(user, "profile", None)
    return getattr(profile, "team", None) or "Developers"


def _task_team(task):
    sprint = getattr(task, "sprint", None)
    if sprint and getattr(sprint, "team", None):
        return sprint.team
    owner = getattr(task, "owner", None)
    profile = getattr(owner, "profile", None) if owner else None
    if profile and getattr(profile, "team", None):
        return profile.team
    return None


def _task_team_q(team, prefix=""):
    if not team:
        return Q()
    sprint_team_key = f"{prefix}sprint__team"
    sprint_null_key = f"{prefix}sprint__isnull"
    owner_team_key = f"{prefix}owner__profile__team"
    return Q(**{sprint_team_key: team}) | Q(**{sprint_null_key: True, owner_team_key: team})


def _can_access_task(user, task):
    if not getattr(user, "is_authenticated", False):
        return False
    profile = getattr(user, "profile", None)
    if profile and _normalized_role(profile) in {"manager", "super admin", "qa"}:
        return True
    return str(getattr(task, "owner_id", "")) == str(getattr(user, "id", ""))


def _team_allows(user, team):
    if not getattr(user, "is_authenticated", False):
        return False
    if _is_super_admin(user):
        return True
    return bool(team and team == _user_team(user))



def now_id(prefix):
    return f"{prefix}-{int(time.time() * 1000)}"


def slugify(value):
    return (
        (value or "")
        .lower()
        .replace("_", "-")
        .replace(" ", "-")
        .replace("--", "-")
        or f"user-{int(time.time())}"
    )


FILENAME_SANITIZER = re.compile(r"[^A-Za-z0-9._-]+")
TASK_ID_PATTERN = re.compile(r"^(?P<prefix>[A-Za-z]+)-(?P<number>\d+)$")


def _normalize_task_id(value):
    if value is None:
        return None
    candidate = str(value).strip()
    return candidate or None


def _parse_task_number(task_id, prefix):
    if not task_id:
        return None
    match = TASK_ID_PATTERN.match(task_id)
    if not match:
        return None
    if match.group("prefix").upper() != prefix.upper():
        return None
    try:
        return int(match.group("number"))
    except ValueError:
        return None


def build_next_task_id(task_type):
    prefix = TASK_ID_PREFIXES.get((task_type or "").lower(), "TASK")
    max_num = 0
    for existing_id in Task.objects.filter(id__istartswith=f"{prefix}-").values_list("id", flat=True):
        num = _parse_task_number(existing_id, prefix)
        if num is not None and num > max_num:
            max_num = num
    next_num = max_num + 1
    digits = max(TASK_ID_MIN_DIGITS, len(str(next_num)))
    return f"{prefix}-{str(next_num).zfill(digits)}"


def resolve_task_id(raw_id, task_type):
    candidate = _normalize_task_id(raw_id)
    if candidate and not Task.objects.filter(pk=candidate).exists():
        return candidate
    return build_next_task_id(task_type)


def normalize_filename(filename):
    base_name = os.path.basename(filename or "")
    if not base_name:
        return "attachment"
    name, ext = os.path.splitext(base_name)
    safe_name = FILENAME_SANITIZER.sub("-", name).strip("-") or "attachment"
    safe_ext = re.sub(r"[^A-Za-z0-9.]+", "", ext).lower()
    return f"{safe_name}{safe_ext}"


def build_attachment_key(task_id, filename, task_type=None):
    safe_name = normalize_filename(filename)
    name, ext = os.path.splitext(safe_name)
    unique = uuid.uuid4().hex[:8]
    timestamp = int(time.time() * 1000)
    prefix = "tasks"
    if (task_type or "").lower() == "bug":
        prefix = "bugs"
    return f"{prefix}/{task_id}/{timestamp}-{unique}-{name}{ext}"


def get_s3_client():
    session_kwargs = {}
    region = getattr(settings, "AWS_REGION", None) or "ap-south-1"
    profile_name = getattr(settings, "AWS_PROFILE", None)
    if not os.environ.get("AWS_EXECUTION_ENV") and profile_name:
        session_kwargs["profile_name"] = profile_name
    if region:
        session_kwargs["region_name"] = region
    session = boto3.session.Session(**session_kwargs)
    return session.client("s3")


def build_s3_url(bucket, key):
    region = getattr(settings, "AWS_REGION", None) or "ap-south-1"
    if region == "us-east-1":
        return f"https://{bucket}.s3.amazonaws.com/{key}"
    return f"https://{bucket}.s3.{region}.amazonaws.com/{key}"


def build_presigned_url(bucket, key):
    """Generate a time-limited URL for private objects; fallback to direct URL on error."""
    expires = getattr(settings, "ATTACHMENT_URL_EXPIRES", 3600) or 3600
    client = get_s3_client()
    try:
        return client.generate_presigned_url(
            ClientMethod="get_object",
            Params={"Bucket": bucket, "Key": key},
            ExpiresIn=expires,
        )
    except Exception:
        logger.warning("Presign failed for bucket=%s key=%s", bucket, key, exc_info=True)
        return build_s3_url(bucket, key)


def parse_datetime(value):
    if not value:
        return None
    try:
        if value.endswith("Z"):
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed
    except ValueError:
        pass
    for fmt in ("%Y-%m-%d", "%Y-%m-%d %H:%M:%S"):
        try:
            parsed = datetime.strptime(value, fmt)
            return parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


@lru_cache(maxsize=1)
def _holiday_dates():
    return _holiday_dates_from_values(getattr(settings, "HOLIDAY_DATES", []) or [])


def normalize_holiday_dates(value):
    if not value:
        return []
    if isinstance(value, str):
        items = [item.strip() for item in value.split(",")]
    elif isinstance(value, (list, tuple, set)):
        items = list(value)
    else:
        return []
    seen = set()
    normalized = []
    for item in items:
        if item is None:
            continue
        text = str(item).strip()
        if not text:
            continue
        try:
            date_value = datetime.fromisoformat(text).date().isoformat()
        except ValueError:
            logger.warning("Invalid holiday date configured: %s", text)
            continue
        if date_value not in seen:
            seen.add(date_value)
            normalized.append(date_value)
    return normalized


def normalize_qa_status(value):
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    for status in QA_STATUSES:
        if status.lower() == text.lower():
            return status
    return None


def _holiday_dates_from_values(values):
    dates = set()
    for item in normalize_holiday_dates(values):
        try:
            dates.add(datetime.fromisoformat(item).date())
        except ValueError:
            logger.warning("Invalid holiday date configured: %s", item)
    return dates


def _is_non_working_day(day, holiday_dates):
    weekend_days = getattr(settings, "WEEKEND_DAYS", [5, 6]) or [5, 6]
    if day.weekday() in weekend_days:
        return True
    if holiday_dates and day in holiday_dates:
        return True
    return False


def utc_now():
    return datetime.now(timezone.utc)


def utc_now_iso():
    return utc_now().strftime("%Y-%m-%dT%H:%M:%SZ")

def _get_workday_hours():
    workday_hours = getattr(settings, "WORKDAY_HOURS", 8) or 8
    if workday_hours <= 0:
        workday_hours = 8
    return workday_hours


def _get_workday_window():
    start_hour = getattr(settings, "WORKDAY_START_HOUR", 10)
    end_hour = getattr(settings, "WORKDAY_END_HOUR", 18)
    try:
        start_hour = float(start_hour)
    except (TypeError, ValueError):
        start_hour = 10
    try:
        end_hour = float(end_hour)
    except (TypeError, ValueError):
        end_hour = 18
    if start_hour < 0 or start_hour >= 24:
        start_hour = 10
    if end_hour <= 0 or end_hour > 24:
        end_hour = 18
    if end_hour <= start_hour:
        end_hour = min(start_hour + _get_workday_hours(), 24)
    return start_hour, end_hour


def _get_workday_timezone():
    try:
        return django_timezone.get_default_timezone()
    except Exception:
        return timezone.utc


def compute_elapsed_days(start_value, end_value=None, holiday_dates=None):
    start = parse_datetime(start_value)
    if not start:
        return 0.0
    end = parse_datetime(end_value) if end_value else utc_now()
    if not end or end < start:
        return 0.0
    workday_hours = _get_workday_hours()
    workday_start, workday_end = _get_workday_window()
    work_tz = _get_workday_timezone()
    start_local = start.astimezone(work_tz)
    end_local = end.astimezone(work_tz)
    holiday_set = set(_holiday_dates())
    if holiday_dates:
        if isinstance(holiday_dates, set):
            holiday_set |= holiday_dates
        else:
            holiday_set |= _holiday_dates_from_values(holiday_dates)
    total_hours = 0.0
    cursor = start_local
    while cursor.date() <= end_local.date():
        day_start = datetime(cursor.year, cursor.month, cursor.day, tzinfo=work_tz)
        day_end = day_start + timedelta(days=1)
        work_start = day_start + timedelta(hours=workday_start)
        work_end = day_start + timedelta(hours=workday_end)
        segment_start = cursor if cursor > work_start else work_start
        segment_end = end_local if end_local < work_end else work_end
        if segment_end <= segment_start:
            cursor = day_end
            continue
        if not _is_non_working_day(day_start.date(), holiday_set):
            total_hours += (segment_end - segment_start).total_seconds() / 3600
        cursor = day_end
    return total_hours / workday_hours


def normalize_days(days):
    rounded = round(days, 2)
    if days > 0 and rounded == 0:
        return 0.05
    return rounded


def _task_holiday_dates(task):
    sprint = getattr(task, "sprint", None)
    owner = getattr(task, "owner", None)
    profile = getattr(owner, "profile", None) if owner else None
    dates = []
    if sprint and getattr(sprint, "holiday_dates", None):
        dates.extend(sprint.holiday_dates or [])
    if profile and getattr(profile, "leave_dates", None):
        dates.extend(profile.leave_dates or [])
    normalized = normalize_holiday_dates(dates)
    return normalized or None


def compute_actual_days(task):
    total = float(task.actual_hours or 0)
    holiday_dates = _task_holiday_dates(task)
    if task.status in WORK_STATUSES and task.in_progress_date:
        total += compute_elapsed_days(task.in_progress_date, holiday_dates=holiday_dates)
    elif task.status in DONE_STATUSES and task.in_progress_date:
        total += compute_elapsed_days(
            task.in_progress_date,
            task.closed_date,
            holiday_dates=holiday_dates,
        )
    return normalize_days(total)


def compute_blocked_days(task):
    total = float(getattr(task, "blocked_hours", 0) or 0)
    holiday_dates = _task_holiday_dates(task)
    if task.status == BLOCKED_STATUS and task.blocker_date:
        total += compute_elapsed_days(task.blocker_date, holiday_dates=holiday_dates)
    elif task.status in DONE_STATUSES and task.blocker_date:
        total += compute_elapsed_days(
            task.blocker_date,
            task.closed_date,
            holiday_dates=holiday_dates,
        )
    return normalize_days(total) if total > 0 else 0


def compute_qa_days(task):
    total = float(getattr(task, "qa_actual_hours", 0) or 0)
    holiday_dates = _task_holiday_dates(task)
    if (
        getattr(task, "qa_status", None) in QA_ACTIVE_STATUSES
        and getattr(task, "qa_in_progress_date", None)
    ):
        total += compute_elapsed_days(
            task.qa_in_progress_date,
            holiday_dates=holiday_dates,
        )
    return normalize_days(total) if total > 0 else 0


def compute_qa_fixing_days(task):
    total = float(getattr(task, "qa_fixing_hours", 0) or 0)
    holiday_dates = _task_holiday_dates(task)
    if getattr(task, "qa_status", None) == "Fixing" and getattr(task, "qa_fixing_in_progress_date", None):
        total += compute_elapsed_days(
            task.qa_fixing_in_progress_date,
            holiday_dates=holiday_dates,
        )
    return normalize_days(total) if total > 0 else 0


def sanitize_user(user):
    if not user or not getattr(user, "is_authenticated", False):
        return None

    profile = getattr(user, "profile", None)
    name = getattr(user, "get_full_name", lambda: "")() or getattr(user, "username", "")
    role = _normalize_role_label(getattr(profile, "role", "Developer")) or "Developer"
    return {
        "id": str(getattr(user, "id", "")),
        "name": name,
        "username": getattr(user, "username", ""),
        "email": getattr(user, "email", ""),
        "role": role,
        "avatar": getattr(profile, "avatar", None),
        "team": getattr(profile, "team", "Developers"),
        "leave_dates": getattr(profile, "leave_dates", []) or [],
    }


def serialize_attachment(attachment, include_url=True):
    return {
        "id": attachment.id,
        "task_id": attachment.task_id,
        "uploaded_by": str(attachment.uploaded_by_id) if attachment.uploaded_by_id else None,
        "file_name": attachment.file_name,
        "file_size": attachment.file_size,
        "content_type": attachment.content_type,
        "s3_bucket": attachment.s3_bucket,
        "s3_key": attachment.s3_key,
        "url": build_presigned_url(attachment.s3_bucket, attachment.s3_key) if include_url else None,
        "created_date": attachment.created_date,
    }


def sanitize_task(task, include_attachments=True, include_attachment_urls=True):
    attachments = []
    if include_attachments:
        if hasattr(task, "attachments"):
            attachments = [serialize_attachment(a, include_url=include_attachment_urls) for a in task.attachments.all()]
        else:
            attachments = [
                serialize_attachment(a, include_url=include_attachment_urls)
                for a in TaskAttachment.objects.filter(task_id=task.id)
            ]
    task_team = _task_team(task)
    is_grc = _is_grc_team(task_team)
    qa_status = None if is_grc else getattr(task, "qa_status", None)
    if not is_grc and not qa_status and task.status in DONE_STATUSES:
        qa_status = DEFAULT_QA_STATUS
    qa_actual_hours = 0 if is_grc else compute_qa_days(task)
    qa_fixing_hours = 0 if is_grc else compute_qa_fixing_days(task)
    return {
        "id": task.id,
        "title": task.title,
        "type": task.type,
        "sprint_id": task.sprint_id,
        "qa_sprint_id": task.qa_sprint_id,
        "module": task.module,
        "owner_id": str(task.owner_id) if task.owner_id is not None else None,
        "priority": task.priority,
        "status": task.status,
        "qa_status": qa_status,
        "estimated_hours": task.estimated_hours,
        "actual_hours": compute_actual_days(task),
        "qa_actual_hours": qa_actual_hours,
        "qa_fixing_hours": qa_fixing_hours,
        "blocked_hours": compute_blocked_days(task),
        "blocker": task.blocker,
        "steps_to_reproduce": task.steps_to_reproduce,
        "test_reproduced": task.test_reproduced,
        "blocker_date": task.blocker_date,
        "in_progress_date": task.in_progress_date,
        "created_date": task.created_date,
        "closed_date": task.closed_date,
        "description": task.description,
        "attachments": attachments,
    }


def serialize_audit_log(log_entry):
    fallback_user = None
    metadata = log_entry.metadata or {}
    if not log_entry.user:
        fallback_name = metadata.get("user_name") or metadata.get("username")
        fallback_email = metadata.get("user_email")
        if fallback_name or fallback_email:
            fallback_user = {
                "id": str(log_entry.user_id) if getattr(log_entry, "user_id", None) is not None else "",
                "name": fallback_name or "System",
                "username": metadata.get("username") or "",
                "email": fallback_email or "",
                "role": metadata.get("user_role") or "Developer",
                "avatar": None,
                "team": metadata.get("user_team") or "Developers",
                "leave_dates": [],
            }

    return {
        "id": log_entry.id,
        "action": log_entry.action,
        "entity_type": log_entry.entity_type,
        "entity_id": log_entry.entity_id,
        "path": log_entry.path,
        "method": log_entry.method,
        "status_code": log_entry.status_code,
        "ip_address": log_entry.ip_address,
        "user_agent": log_entry.user_agent,
        "metadata": metadata,
        "created_date": log_entry.created_date,
        "user": sanitize_user(log_entry.user) if log_entry.user else fallback_user,
    }


def upload_task_attachments(task, files, uploader):
    if not files:
        return []

    # Block dangerous file extensions, only allow safe ones
    blocked_extensions = {
        ".exe", ".bat", ".cmd", ".com", ".sh", ".bash", ".zsh", ".ksh",
        ".dll", ".so", ".dylib", ".sys", ".drv", ".msi", ".scr",
        ".vbs", ".vbe", ".js", ".jse", ".jar", ".class", ".app",
        ".ps1", ".ps2", ".psc1", ".psc2", ".psd1", ".msh", ".msh1",
        ".msi", ".rar", ".zip", ".7z", ".gz", ".tar", ".iso",
        ".bin", ".img", ".dmg", ".vhd", ".vmdk"
    }
    
    for file_obj in files:
        filename = getattr(file_obj, "name", "") or ""
        _, ext = os.path.splitext(filename)
        if ext.lower() in blocked_extensions:
            raise ValueError(
                f"File extension '{ext}' is not allowed. "
                f"Only safe file types (documents, images, videos, archives) can be uploaded."
            )

    office_extensions = {".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx"}
    bucket = getattr(settings, "ATTACHMENTS_BUCKET", "whizz-sprint-flow-attachments")
    client = get_s3_client()
    logger.info(
        "Attachment upload start | task=%s bucket=%s file_count=%s user=%s",
        task.id,
        bucket,
        len(files),
        getattr(uploader, "username", None),
    )
    attachments = []
    uploaded_keys = []

    try:
        for file_obj in files:
            original_name = os.path.basename(getattr(file_obj, "name", "") or "attachment")
            _, ext = os.path.splitext(original_name)
            content_type = getattr(file_obj, "content_type", None)
            upload_name = original_name
            upload_fileobj = file_obj
            upload_size = getattr(file_obj, "size", 0) or 0

            if ext.lower() in office_extensions:
                try:
                    file_bytes = file_obj.read()
                    file_obj.seek(0)
                    with tempfile.TemporaryDirectory() as tmp_dir:
                        input_path = os.path.join(tmp_dir, original_name)
                        with open(input_path, "wb") as handle:
                            handle.write(file_bytes)
                        subprocess.run(
                            [
                                "libreoffice",
                                "--headless",
                                "--convert-to",
                                "pdf",
                                "--outdir",
                                tmp_dir,
                                input_path,
                            ],
                            check=True,
                            stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL,
                        )
                        output_name = f"{os.path.splitext(original_name)[0]}.pdf"
                        output_path = os.path.join(tmp_dir, output_name)
                        if os.path.exists(output_path):
                            upload_name = output_name
                            upload_fileobj = open(output_path, "rb")
                            upload_size = os.path.getsize(output_path)
                            content_type = "application/pdf"
                except Exception:
                    logger.warning("Office conversion failed for %s; uploading original", original_name, exc_info=True)

            key = build_attachment_key(task.id, upload_name, task.type)
            extra_args = {}
            if content_type:
                extra_args["ContentType"] = content_type
            if extra_args:
                client.upload_fileobj(upload_fileobj, bucket, key, ExtraArgs=extra_args)
            else:
                client.upload_fileobj(upload_fileobj, bucket, key)
            if upload_fileobj is not file_obj:
                try:
                    upload_fileobj.close()
                except Exception:
                    pass
            uploaded_keys.append(key)
            attachments.append(
                TaskAttachment.objects.create(
                    id=now_id("attachment"),
                    task=task,
                    uploaded_by=uploader if getattr(uploader, "is_authenticated", False) else None,
                    file_name=os.path.basename(upload_name),
                    file_size=upload_size,
                    content_type=content_type,
                    s3_bucket=bucket,
                    s3_key=key,
                    created_date=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                )
            )
        return attachments
    except Exception as exc:
        if isinstance(exc, ClientError):
            error = exc.response.get("Error", {})
            logger.exception(
                "S3 upload failed for task %s: %s %s",
                task.id,
                error.get("Code"),
                error.get("Message"),
            )
        else:
            logger.exception("Attachment upload failed for task %s", task.id)
        if attachments:
            TaskAttachment.objects.filter(id__in=[a.id for a in attachments]).delete()
        for key in uploaded_keys:
            try:
                client.delete_object(Bucket=bucket, Key=key)
            except Exception:
                pass
        raise


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def attachment_detail(request, attachment_id):
    try:
        attachment = TaskAttachment.objects.select_related("task").get(pk=attachment_id)
    except TaskAttachment.DoesNotExist:
        return Response({"message": "Attachment not found"}, status=status.HTTP_404_NOT_FOUND)

    profile = getattr(request.user, "profile", None)
    is_privileged = bool(profile and _normalized_role(profile) in {"manager", "super admin", "qa"})
    is_uploader = str(attachment.uploaded_by_id) == str(request.user.id)
    is_task_owner = str(attachment.task.owner_id) == str(request.user.id)

    if not _team_allows(request.user, _task_team(attachment.task)):
        return Response({"message": "Not allowed to delete this attachment"}, status=status.HTTP_403_FORBIDDEN)

    if not (is_privileged or is_uploader or is_task_owner):
        return Response({"message": "Not allowed to delete this attachment"}, status=status.HTTP_403_FORBIDDEN)

    client = get_s3_client()
    try:
        client.delete_object(Bucket=attachment.s3_bucket, Key=attachment.s3_key)
    except ClientError as exc:
        logger.exception(
            "Attachment delete failed | attachment=%s bucket=%s key=%s error=%s",
            attachment.id,
            attachment.s3_bucket,
            attachment.s3_key,
            exc,
        )
        return Response({"message": "Failed to delete attachment"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    attachment.delete()
    return Response({"deleted": attachment_id})


@api_view(["GET"])
@permission_classes([AllowAny])
def health(request):
    return Response({"status": "ok"})


# Team members
@api_view(["GET", "POST"])
@permission_classes([PublicReadManagerWrite])
def team_members(request):
    if request.method == "GET":
        if not getattr(request.user, "is_authenticated", False):
            return Response([], status=status.HTTP_401_UNAUTHORIZED)
        members = User.objects.all().select_related("profile").order_by("username")
        if not _is_super_admin(request.user):
            members = members.filter(profile__team=_user_team(request.user))
        paginator = StandardPagination()
        page = paginator.paginate_queryset(members, request)
        if page is not None:
            return paginator.get_paginated_response([sanitize_user(u) for u in page])
        return Response([sanitize_user(u) for u in members])

    # Create new user
    data = request.data or {}
    username = data.get("username") or slugify(data.get("name") or f"user-{int(time.time())}")
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or DEFAULT_PASSWORD_VALUE
    if not email:
        return Response(
            {"message": "Email is required to create a user"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if User.objects.filter(email__iexact=email).exists():
        return Response(
            {"message": "Email already exists"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    requested_team = data.get("team")
    if not _is_super_admin(request.user):
        user_team = _user_team(request.user)
        if requested_team and requested_team != user_team:
            return Response({"message": "Not allowed to create users for another team"}, status=status.HTTP_403_FORBIDDEN)
        data["team"] = user_team

    requested_role = (data.get("role") or "").strip().lower()
    if requested_role == "super admin":
        if not _is_super_admin(request.user):
            return Response({"message": "Only a Super Admin can grant Super Admin role"}, status=status.HTTP_403_FORBIDDEN)
    effective_team = data.get("team") or "Developers"
    if _is_associate(data.get("role")) and effective_team not in ASSOCIATE_TEAMS:
        return Response({"message": "Associate role is only allowed for R&D or GRC teams"}, status=status.HTTP_403_FORBIDDEN)
    if _is_security(data.get("role")) and effective_team not in SECURITY_TEAMS:
        return Response({"message": "Security role is only allowed for GRC team"}, status=status.HTTP_403_FORBIDDEN)

    try:
        user = User.objects.create_user(
            username=username,
            first_name=data.get("name", ""),
            email=email,
            password=password,
        )
        MemberProfile.objects.create(
            user=user,
            role=_normalize_role_label(data.get("role") or "Developer"),
            avatar=data.get("avatar"),
            team=data.get("team", "Developers"),
            leave_dates=normalize_holiday_dates(data.get("leave_dates")),
        )
    except IntegrityError:
        return Response(
            {"message": "Username already exists"},
            status=status.HTTP_400_BAD_REQUEST,
        )
    return Response(sanitize_user(user), status=status.HTTP_201_CREATED)


@api_view(["PUT", "DELETE"])
@permission_classes([IsManagerOrSelf])
def team_member_detail(request, member_id):
    try:
        member = User.objects.get(pk=member_id)
    except User.DoesNotExist:
        return Response({"message": "User not found"}, status=status.HTTP_404_NOT_FOUND)

    if request.method == "PUT":
        data = request.data or {}
        profile, _ = MemberProfile.objects.get_or_create(user=member)
        request_is_manager = _is_manager(request.user)
        request_is_super = _is_super_admin(request.user)
        is_self = str(request.user.id) == str(member.id)
        member_team = getattr(profile, "team", None) or "Developers"

        if not request_is_manager and not is_self:
            return Response({"message": "Not allowed"}, status=status.HTTP_403_FORBIDDEN)

        if request_is_manager and not request_is_super:
            if member_team != _user_team(request.user):
                return Response({"message": "Not allowed"}, status=status.HTTP_403_FORBIDDEN)

        if not request_is_manager:
            allowed_fields = {"leave_dates"}
            disallowed = set(data.keys()) - allowed_fields
            if disallowed:
                return Response(
                    {"message": "Only leave_dates can be updated"},
                    status=status.HTTP_403_FORBIDDEN,
                )
            profile.leave_dates = normalize_holiday_dates(data.get("leave_dates"))
            profile.save()
            return Response(sanitize_user(member))

        requested_team = member_team
        if "team" in data:
            requested_team = data["team"] or profile.team
            if not request_is_super and requested_team != _user_team(request.user):
                return Response({"message": "Not allowed to move users across teams"}, status=status.HTTP_403_FORBIDDEN)

        requested_role = profile.role
        if "role" in data:
            requested_role = data["role"]
            if (requested_role or "").strip().lower() == "super admin":
                if not request_is_super:
                    return Response({"message": "Only a Super Admin can grant Super Admin role"}, status=status.HTTP_403_FORBIDDEN)

        if _is_associate(requested_role) and requested_team not in ASSOCIATE_TEAMS:
            return Response({"message": "Associate role is only allowed for R&D or GRC teams"}, status=status.HTTP_403_FORBIDDEN)
        if _is_security(requested_role) and requested_team not in SECURITY_TEAMS:
            return Response({"message": "Security role is only allowed for GRC team"}, status=status.HTTP_403_FORBIDDEN)

        if "name" in data:
            member.first_name = data["name"]
        if "username" in data:
            member.username = data["username"]
        if "email" in data:
            new_email = (data["email"] or "").strip().lower()
            if not new_email:
                return Response({"message": "Email cannot be empty"}, status=status.HTTP_400_BAD_REQUEST)
            if User.objects.filter(email__iexact=new_email).exclude(pk=member.pk).exists():
                return Response({"message": "Email already exists"}, status=status.HTTP_400_BAD_REQUEST)
            member.email = new_email
        if "role" in data:
            profile.role = _normalize_role_label(requested_role)
        if "avatar" in data:
            profile.avatar = data["avatar"]
        if "team" in data:
            profile.team = requested_team
        if "leave_dates" in data:
            profile.leave_dates = normalize_holiday_dates(data.get("leave_dates"))
        if data.get("password"):
            member.set_password(data["password"])
        member.save()
        profile.save()
        return Response(sanitize_user(member))

    request_is_super = _is_super_admin(request.user)
    if not request_is_super:
        profile = getattr(member, "profile", None)
        member_team = getattr(profile, "team", None) or "Developers"
        if member_team != _user_team(request.user):
            return Response({"message": "Not allowed"}, status=status.HTTP_403_FORBIDDEN)

    # DELETE: also clean dependent data similar to the Node API
    with transaction.atomic():
        removed_tasks = list(Task.objects.filter(
            owner_id=member.id).values_list("id", flat=True))
        Task.objects.filter(id__in=removed_tasks).delete()
        Approval.objects.filter(Q(approved_by=member) | Q(
            task_id__in=removed_tasks)).delete()
        TaskComment.objects.filter(Q(author=member) | Q(
            task_id__in=removed_tasks)).delete()
        member.delete()
    return Response({"removed": sanitize_user(member), "removedTaskIds": removed_tasks})


@api_view(["POST"])
@permission_classes([AllowAny])
@authentication_classes([])
def auth_login(request):
    data = request.data or {}
    identifier = (data.get("email") or "").strip().lower()
    password = data.get("password")
    if not identifier or not password:
        return Response({"message": "Email and password are required"}, status=status.HTTP_400_BAD_REQUEST)

    try:
        lookup = User.objects.filter(email__iexact=identifier)
        if not lookup.exists():
            raise User.DoesNotExist
        if lookup.count() > 1:
            raise User.MultipleObjectsReturned
        member = lookup.first()
    except User.MultipleObjectsReturned:
        return Response({"message": "Multiple accounts use this email"}, status=status.HTTP_400_BAD_REQUEST)
    except User.DoesNotExist:
        logger.warning("Login failed: no user found for identifier=%s", identifier)
        return Response({"message": "Invalid credentials"}, status=status.HTTP_401_UNAUTHORIZED)

    user = authenticate(request, username=member.username, password=password)
    if user is None:
        logger.warning("Login failed: bad password for username=%s", member.username)
        return Response({"message": "Invalid credentials"}, status=status.HTTP_401_UNAUTHORIZED)

    logger.info("Login success for username=%s", member.username)
    login(request, user)
    return Response(sanitize_user(user))


@api_view(["POST"])
@permission_classes([AllowAny])
@authentication_classes([])
def auth_logout(request):
    # Normalize GET to behave like POST for logout.
    logout(request)
    response = Response(status=status.HTTP_204_NO_CONTENT)

    # Explicitly clear cookies with the same attributes they were set with.
    cookie_domain = getattr(settings, "COOKIE_DOMAIN", None)
    cookie_path = "/"
    samesite = getattr(settings, "CSRF_COOKIE_SAMESITE", "Lax")

    response.delete_cookie(
        "sessionid",
        domain=cookie_domain,
        path=cookie_path,
        samesite=samesite,
    )
    response.delete_cookie(
        "csrftoken",
        domain=cookie_domain,
        path=cookie_path,
        samesite=samesite,
    )
    return response


@api_view(["GET"])
@permission_classes([AllowAny])
def me(request):
    # Let SessionMemberAuthentication populate request.user from the session cookie.
    return Response(sanitize_user(request.user))


@api_view(["GET"])
@permission_classes([AllowAny])
@authentication_classes([])
@ensure_csrf_cookie
def csrf_token(request):
    return Response({"detail": "CSRF cookie set"})


def csrf_failure(request, reason="", template_name=None):
    """Custom CSRF failure handler to aid debugging (returns JSON)."""
    meta = request.META if hasattr(request, "META") else {}
    logger.warning(
        "CSRF failure: %s | Origin=%s Referer=%s Cookie=%s HeaderToken=%s",
        reason,
        meta.get("HTTP_ORIGIN"),
        meta.get("HTTP_REFERER"),
        meta.get("HTTP_COOKIE"),
        meta.get("HTTP_X_CSRFTOKEN"),
    )
    return Response(
        {"message": "CSRF Failed", "reason": reason or "unknown"},
        status=status.HTTP_403_FORBIDDEN,
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def change_password(request):
    data = request.data or {}
    current_password = data.get("current_password")
    new_password = data.get("new_password")
    if not current_password or not new_password:
        return Response(
            {"message": "Current password and new password are required"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    user = request.user
    if not user.check_password(current_password):
        return Response({"message": "Current password is incorrect"}, status=status.HTTP_400_BAD_REQUEST)

    user.set_password(new_password)
    user.save()
    return Response({"message": "Password updated successfully"})


@api_view(["POST"])
@permission_classes([AllowAny])
@authentication_classes([])
def request_password_reset(request):
    from .notifications import send_notification_email

    email = (request.data.get("email") or "").strip().lower()
    if not email:
        return Response({"message": "Email is required"}, status=status.HTTP_400_BAD_REQUEST)

    # Always return success to prevent email enumeration
    try:
        user = User.objects.get(email__iexact=email)
    except (User.DoesNotExist, User.MultipleObjectsReturned):
        return Response({"message": "If an account with that email exists, a reset link has been sent."})

    token = default_token_generator.make_token(user)
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    frontend_origin = getattr(settings, "FRONTEND_ORIGIN", "")
    reset_url = f"{frontend_origin}/reset-password/{uid}/{token}"

    name = user.first_name or user.username or "there"
    subject = "SprintFlow - Password Reset"
    body = (
        f"Hi {name},\n\n"
        f"You requested a password reset. Click the link below to set a new password:\n\n"
        f"{reset_url}\n\n"
        f"This link will expire after one use or when your password is changed.\n\n"
        f"If you did not request this, you can safely ignore this email."
    )
    send_notification_email(subject, body, [user.email])

    return Response({"message": "If an account with that email exists, a reset link has been sent."})


@api_view(["POST"])
@permission_classes([AllowAny])
@authentication_classes([])
def reset_password(request):
    data = request.data or {}
    uid = data.get("uid")
    token = data.get("token")
    new_password = data.get("new_password")

    if not uid or not token or not new_password:
        return Response(
            {"message": "uid, token, and new_password are required"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        user_pk = force_str(urlsafe_base64_decode(uid))
        user = User.objects.get(pk=user_pk)
    except (TypeError, ValueError, OverflowError, User.DoesNotExist):
        return Response({"message": "Invalid reset link"}, status=status.HTTP_400_BAD_REQUEST)

    if not default_token_generator.check_token(user, token):
        return Response({"message": "Reset link has expired or is invalid"}, status=status.HTTP_400_BAD_REQUEST)

    user.set_password(new_password)
    user.save()
    return Response({"message": "Password has been reset successfully"})


# Sprints
@api_view(["GET", "POST"])
@permission_classes([IsManagerOrReadOnly])
def sprints_view(request):
    if request.method == "GET":
        if not getattr(request.user, "is_authenticated", False):
            return Response([], status=status.HTTP_401_UNAUTHORIZED)
        sprints = Sprint.objects.all()
        if not _is_super_admin(request.user):
            sprints = sprints.filter(team=_user_team(request.user))
        sprints = sprints.order_by("-start_date", "id")
        paginator = StandardPagination()
        page = paginator.paginate_queryset(sprints, request)
        results = [
            {
                "id": s.id,
                "sprint_name": s.sprint_name,
                "start_date": s.start_date,
                "end_date": s.end_date,
                "sprint_goal": s.sprint_goal,
                "holiday_dates": s.holiday_dates or [],
                "is_active": s.is_active,
                "team": s.team,
            }
            for s in (page if page is not None else sprints)
        ]
        if page is not None:
            return paginator.get_paginated_response(results)
        return Response(results)

    data = request.data or {}
    sprint_id = data.get("id") or now_id("sprint")
    is_active = bool(data.get("is_active"))
    holiday_dates = normalize_holiday_dates(data.get("holiday_dates"))
    profile = getattr(request.user, "profile", None)
    team_value = data.get("team") or getattr(profile, "team", None) or "Developers"
    if not _is_super_admin(request.user):
        user_team = _user_team(request.user)
        if data.get("team") and data.get("team") != user_team:
            return Response({"message": "Not allowed to create sprints for another team"}, status=status.HTTP_403_FORBIDDEN)
        team_value = user_team
    with transaction.atomic():
        if is_active:
            Sprint.objects.filter(team=team_value).update(is_active=False)
        sprint = Sprint.objects.create(
            id=sprint_id,
            sprint_name=data.get("sprint_name", ""),
            start_date=data.get("start_date", ""),
            end_date=data.get("end_date", ""),
            sprint_goal=data.get("sprint_goal", ""),
            holiday_dates=holiday_dates,
            is_active=is_active,
            team=team_value,
        )
    return Response({
        "id": sprint.id,
        "sprint_name": sprint.sprint_name,
        "start_date": sprint.start_date,
        "end_date": sprint.end_date,
        "sprint_goal": sprint.sprint_goal,
        "holiday_dates": sprint.holiday_dates or [],
        "is_active": sprint.is_active,
        "team": sprint.team,
    }, status=status.HTTP_201_CREATED)


@api_view(["GET"])
def active_sprint(request):
    if not getattr(request.user, "is_authenticated", False):
        return Response(None, status=status.HTTP_401_UNAUTHORIZED)
    team_value = request.query_params.get("team")
    if _is_super_admin(request.user):
        if team_value:
            sprint = Sprint.objects.filter(is_active=True, team=team_value).first()
        else:
            sprint = Sprint.objects.filter(is_active=True).first()
    else:
        team_value = _user_team(request.user)
        sprint = Sprint.objects.filter(is_active=True, team=team_value).first()
    if not sprint:
        return Response(None)
    return Response({
        "id": sprint.id,
        "sprint_name": sprint.sprint_name,
        "start_date": sprint.start_date,
        "end_date": sprint.end_date,
        "sprint_goal": sprint.sprint_goal,
        "holiday_dates": sprint.holiday_dates or [],
        "is_active": sprint.is_active,
        "team": sprint.team,
    })


@api_view(["PUT"])
@permission_classes([IsManager])
def sprint_detail(request, sprint_id):
    try:
        sprint = Sprint.objects.get(pk=sprint_id)
    except Sprint.DoesNotExist:
        return Response({"message": "Sprint not found"}, status=status.HTTP_404_NOT_FOUND)

    if not _is_super_admin(request.user) and sprint.team != _user_team(request.user):
        return Response({"message": "Not allowed"}, status=status.HTTP_403_FORBIDDEN)

    data = request.data or {}
    is_active = data.get("is_active", sprint.is_active)
    next_team = data.get("team", sprint.team)
    if not _is_super_admin(request.user) and next_team != _user_team(request.user):
        return Response({"message": "Not allowed to move sprints across teams"}, status=status.HTTP_403_FORBIDDEN)
    with transaction.atomic():
        if is_active:
            Sprint.objects.exclude(pk=sprint_id).filter(team=next_team).update(is_active=False)
        sprint.sprint_name = data.get("sprint_name", sprint.sprint_name)
        sprint.start_date = data.get("start_date", sprint.start_date)
        sprint.end_date = data.get("end_date", sprint.end_date)
        sprint.sprint_goal = data.get("sprint_goal", sprint.sprint_goal)
        if "holiday_dates" in data:
            sprint.holiday_dates = normalize_holiday_dates(data.get("holiday_dates"))
        sprint.is_active = bool(is_active)
        sprint.team = next_team
        sprint.save()

    return Response({
        "id": sprint.id,
        "sprint_name": sprint.sprint_name,
        "start_date": sprint.start_date,
        "end_date": sprint.end_date,
        "sprint_goal": sprint.sprint_goal,
        "holiday_dates": sprint.holiday_dates or [],
        "is_active": sprint.is_active,
        "team": sprint.team,
    })


# Tasks
@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def tasks_view(request):
    if request.method == "GET":
        params = request.query_params
        include_attachments = _query_bool(params, "include_attachments", True)
        include_attachment_urls = _query_bool(
            params,
            "include_attachment_urls",
            include_attachments,
        )
        sprint_id = params.get("sprint_id")
        qa_sprint_id = params.get("qa_sprint_id")
        owner_id = params.get("owner_id")

        tasks = Task.objects.select_related("sprint", "qa_sprint", "owner__profile")
        if include_attachments:
            tasks = tasks.prefetch_related("attachments")
        if not _is_super_admin(request.user):
            tasks = tasks.filter(_task_team_q(_user_team(request.user))).distinct()
        if sprint_id:
            tasks = tasks.filter(sprint_id=sprint_id)
        if qa_sprint_id:
            tasks = tasks.filter(qa_sprint_id=qa_sprint_id)
        if owner_id:
            tasks = tasks.filter(owner_id=owner_id)
        tasks = tasks.order_by("-created_date", "id")
        paginator = StandardPagination()
        page = paginator.paginate_queryset(tasks, request)
        results = [
            sanitize_task(
                t,
                include_attachments=include_attachments,
                include_attachment_urls=include_attachment_urls,
            )
            for t in (page if page is not None else tasks)
        ]
        if page is not None:
            return paginator.get_paginated_response(results)
        return Response(results)

    data = request.data or {}
    sprint_id = data.get("sprint_id")
    owner_id = data.get("owner_id")
    sprint = None
    owner = None
    if sprint_id:
        sprint = Sprint.objects.filter(pk=sprint_id).first()
        if not sprint:
            return Response({"message": "Sprint not found"}, status=status.HTTP_404_NOT_FOUND)
    if owner_id:
        owner = User.objects.select_related("profile").filter(pk=owner_id).first()
        if not owner:
            return Response({"message": "Owner not found"}, status=status.HTTP_400_BAD_REQUEST)
    sprint_team = sprint.team if sprint else None
    owner_team = getattr(getattr(owner, "profile", None), "team", None) if owner else None
    if sprint_team and owner_team and sprint_team != owner_team:
        return Response({"message": "Owner team does not match sprint team"}, status=status.HTTP_400_BAD_REQUEST)
    task_team = sprint_team or owner_team
    if not _is_super_admin(request.user) and task_team != _user_team(request.user):
        return Response({"message": "Not allowed to create tasks for another team"}, status=status.HTTP_403_FORBIDDEN)
    task_type = (data.get("type") or "").strip().lower()
    if _is_grc_team(task_team) and task_type in {"bug", "change"}:
        return Response(
            {"message": "Bug/Change tasks are not allowed for GRC team"},
            status=status.HTTP_403_FORBIDDEN,
        )
    status_value = data.get("status") or "To Do"
    qa_status = normalize_qa_status(data.get("qa_status"))
    in_progress_date = data.get("in_progress_date")
    blocker_date = data.get("blocker_date")
    closed_date = data.get("closed_date")
    if status_value in WORK_STATUSES and not in_progress_date:
        in_progress_date = utc_now_iso()
    if status_value == BLOCKED_STATUS and not blocker_date:
        blocker_date = utc_now_iso()
    if status_value in DONE_STATUSES:
        if not in_progress_date:
            in_progress_date = utc_now_iso()
        if not closed_date:
            closed_date = utc_now_iso()
        if not qa_status and not _is_grc_team(task_team):
            qa_status = DEFAULT_QA_STATUS
    qa_in_progress_date = data.get("qa_in_progress_date")
    qa_actual_hours = float(data.get("qa_actual_hours") or 0)
    qa_fixing_in_progress_date = data.get("qa_fixing_in_progress_date")
    qa_fixing_hours = float(data.get("qa_fixing_hours") or 0)
    now_iso = utc_now_iso()
    if _is_grc_team(task_team):
        qa_status = None
        qa_in_progress_date = None
        qa_fixing_in_progress_date = None
        qa_actual_hours = 0
        qa_fixing_hours = 0
    else:
        if qa_status in QA_ACTIVE_STATUSES and not qa_in_progress_date:
            qa_in_progress_date = now_iso
        if qa_status == "Fixing" and not qa_fixing_in_progress_date:
            qa_fixing_in_progress_date = now_iso
    task = None
    for attempt in range(3):
        task_id = resolve_task_id(data.get("id") if attempt == 0 else None, data.get("type", ""))
        try:
            task = Task.objects.create(
                id=task_id,
                title=data.get("title", ""),
                type=data.get("type", ""),
                sprint_id=data.get("sprint_id"),
                module=data.get("module"),
                owner_id=data.get("owner_id"),
                priority=data.get("priority"),
                status=status_value,
                qa_status=qa_status,
                qa_in_progress_date=qa_in_progress_date,
                qa_actual_hours=qa_actual_hours,
                qa_fixing_in_progress_date=qa_fixing_in_progress_date,
                qa_fixing_hours=qa_fixing_hours,
                estimated_hours=float(data.get("estimated_hours") or 0),
                actual_hours=float(data.get("actual_hours") or 0),
                blocked_hours=float(data.get("blocked_hours") or 0),
                blocker=data.get("blocker"),
                steps_to_reproduce=data.get("steps_to_reproduce"),
                test_reproduced=int(data.get("test_reproduced") or 0),
                blocker_date=blocker_date,
                in_progress_date=in_progress_date,
                created_date=data.get("created_date") or time.strftime("%Y-%m-%d"),
                closed_date=closed_date,
                description=data.get("description"),
            )
            break
        except IntegrityError:
            if attempt == 2:
                return Response(
                    {"message": "Task ID already exists. Please refresh and try again."},
                    status=status.HTTP_409_CONFLICT,
                )
            continue
    if task is None:
        return Response(
            {"message": "Failed to create task. Please retry."},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )
    if task.in_progress_date and task.status in DONE_STATUSES:
        task.actual_hours = compute_actual_days(task)
        task.save(update_fields=["actual_hours"])
    files = (
        request.FILES.getlist("attachments")
        or request.FILES.getlist("files")
        or request.FILES.getlist("file")
    )
    if files:
        try:
            upload_task_attachments(task, files, request.user)
        except Exception as exc:
            task.delete()
            response = {"message": "Failed to upload attachments"}
            if isinstance(exc, ClientError):
                error = exc.response.get("Error", {})
                response["code"] = error.get("Code")
                response["detail"] = error.get("Message")
            elif settings.DEBUG:
                response["detail"] = str(exc)
            return Response(response, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    # Email notifications for new tasks/bugs.
    owner = get_user(task.owner_id)
    if owner and owner.email:
        send_assignment_email(task, owner)
        if task.blocker:
            send_blocker_email(task, owner)
    task_team = _task_team(task)
    if (
        task_team
        and not _is_grc_team(task_team)
        and task.status in DONE_STATUSES
        and (task.type or "").lower() not in {"bug", "change"}
    ):
        qa_emails = get_role_emails("QA", team=task_team)
        if qa_emails:
            send_ready_to_test_email(task, qa_emails)
    if (
        task_team
        and not _is_grc_team(task_team)
        and (task.type or "").lower() in {"bug", "change"}
        and task.status == "Fixed"
    ):
        qa_emails = get_role_emails("QA", team=task_team)
        if qa_emails:
            send_bug_fixed_email(task, qa_emails)
    return Response(sanitize_task(task), status=status.HTTP_201_CREATED)


@api_view(["GET", "PUT", "DELETE"])
@permission_classes([IsOwnerOrManager])
def task_detail(request, task_id):
    params = getattr(request, "query_params", {}) or {}
    include_attachments = _query_bool(params, "include_attachments", True)
    include_attachment_urls = _query_bool(
        params,
        "include_attachment_urls",
        include_attachments,
    )
    task_query = Task.objects.select_related("sprint", "qa_sprint", "owner__profile")
    if include_attachments:
        task_query = task_query.prefetch_related("attachments")
    try:
        task = task_query.get(pk=task_id)
    except Task.DoesNotExist:
        return Response({"message": "Task not found"}, status=status.HTTP_404_NOT_FOUND)

    if not _team_allows(request.user, _task_team(task)):
        return Response({"message": "Not allowed"}, status=status.HTTP_403_FORBIDDEN)
    if not _can_access_task(request.user, task):
        return Response({"message": "Not allowed"}, status=status.HTTP_403_FORBIDDEN)

    if request.method == "GET":
        return Response(
            sanitize_task(
                task,
                include_attachments=include_attachments,
                include_attachment_urls=include_attachment_urls,
            )
        )

    if request.method == "PUT":
        data = request.data or {}
        next_sprint_id = data.get("sprint_id") if "sprint_id" in data else task.sprint_id
        if "sprint_id" in data and not next_sprint_id:
            next_sprint_id = None
        next_owner_id = data.get("owner_id") if "owner_id" in data else task.owner_id
        if "owner_id" in data and not next_owner_id:
            next_owner_id = None

        next_sprint = None
        next_owner = None
        if next_sprint_id:
            next_sprint = Sprint.objects.filter(pk=next_sprint_id).first()
            if not next_sprint:
                return Response({"message": "Sprint not found"}, status=status.HTTP_404_NOT_FOUND)
        if next_owner_id:
            next_owner = User.objects.select_related("profile").filter(pk=next_owner_id).first()
            if not next_owner:
                return Response({"message": "Owner not found"}, status=status.HTTP_400_BAD_REQUEST)

        next_sprint_team = next_sprint.team if next_sprint else None
        next_owner_team = getattr(getattr(next_owner, "profile", None), "team", None) if next_owner else None
        if next_sprint_team and next_owner_team and next_sprint_team != next_owner_team:
            return Response({"message": "Owner team does not match sprint team"}, status=status.HTTP_400_BAD_REQUEST)
        next_team = next_sprint_team or next_owner_team
        if not _is_super_admin(request.user) and next_team != _user_team(request.user):
            return Response({"message": "Not allowed to move tasks across teams"}, status=status.HTTP_403_FORBIDDEN)
        requested_type = (data.get("type") or task.type or "").strip().lower()
        if _is_grc_team(next_team) and requested_type in {"bug", "change"}:
            return Response(
                {"message": "Bug/Change tasks are not allowed for GRC team"},
                status=status.HTTP_403_FORBIDDEN,
            )

        holiday_dates = _task_holiday_dates(task)
        previous_owner_id = task.owner_id
        previous_blocker = task.blocker
        provided_qa_status = data.get("qa_status") if "qa_status" in data else None
        normalized_qa_status = (
            normalize_qa_status(provided_qa_status)
            if "qa_status" in data
            else getattr(task, "qa_status", None)
        )
        previous_qa_status = getattr(task, "qa_status", None)
        previous_status = task.status
        new_status = data.get("status", task.status)
        provided_blocker_date = data.get("blocker_date")
        provided_in_progress_date = data.get("in_progress_date")
        for field in [
            "title",
            "type",
            "sprint_id",
            "module",
            "owner_id",
            "priority",
            "blocker",
            "created_date",
            "description",
            "steps_to_reproduce",
        ]:
            if field in data:
                setattr(task, field.replace("_id", "_id"), data[field])
        if "estimated_hours" in data:
            task.estimated_hours = float(data.get("estimated_hours") or 0)
        if "test_reproduced" in data:
            task.test_reproduced = int(data.get("test_reproduced") or 0)
        if "status" in data:
            task.status = new_status
            now_iso = utc_now_iso()
            closed_at = data.get("closed_date")
            if new_status in DONE_STATUSES and not closed_at:
                closed_at = now_iso

            if previous_status in DONE_STATUSES and new_status not in DONE_STATUSES:
                task.closed_date = None
                task.in_progress_date = None
                task.blocker_date = None
                task.blocker = None
                task.qa_status = None
                task.qa_in_progress_date = None
                task.qa_fixing_in_progress_date = None

            if new_status == "To Do":
                task.in_progress_date = None
                task.blocker_date = None
                task.blocker = None
                task.closed_date = None
                task.actual_hours = 0
                task.blocked_hours = 0
                task.qa_status = None
                task.qa_in_progress_date = None
                task.qa_actual_hours = 0
                task.qa_fixing_in_progress_date = None
                task.qa_fixing_hours = 0
            else:
                if previous_status in WORK_STATUSES and new_status not in WORK_STATUSES:
                    regular_days = compute_elapsed_days(
                        task.in_progress_date,
                        closed_at if new_status in DONE_STATUSES else None,
                        holiday_dates=holiday_dates,
                    )
                    task.actual_hours = (task.actual_hours or 0) + regular_days
                    task.in_progress_date = None
                if previous_status == BLOCKED_STATUS and new_status != BLOCKED_STATUS:
                    task.blocked_hours = (task.blocked_hours or 0) + compute_elapsed_days(
                        task.blocker_date,
                        closed_at if new_status in DONE_STATUSES else None,
                        holiday_dates=holiday_dates,
                    )
                    task.blocker_date = None
                    task.blocker = None
                if new_status in WORK_STATUSES and not task.in_progress_date:
                    task.in_progress_date = provided_in_progress_date or now_iso
                if new_status == BLOCKED_STATUS:
                    if provided_blocker_date:
                        task.blocker_date = provided_blocker_date
                    if not task.blocker_date:
                        task.blocker_date = now_iso
                if new_status in DONE_STATUSES:
                    task.closed_date = closed_at or task.closed_date or now_iso
                    if task.in_progress_date:
                        regular_days = compute_elapsed_days(
                            task.in_progress_date,
                            task.closed_date,
                            holiday_dates=holiday_dates,
                        )
                        task.actual_hours = (task.actual_hours or 0) + regular_days
                        task.in_progress_date = None
                    if task.blocker_date:
                        task.blocked_hours = (task.blocked_hours or 0) + compute_elapsed_days(
                            task.blocker_date,
                            task.closed_date,
                            holiday_dates=holiday_dates,
                        )
                        task.blocker_date = None
        if _is_grc_team(next_team):
            normalized_qa_status = None
            task.qa_in_progress_date = None
            task.qa_fixing_in_progress_date = None
            task.qa_actual_hours = 0
            task.qa_fixing_hours = 0
            task.qa_sprint = None
        else:
            if task.status in DONE_STATUSES:
                if not normalized_qa_status:
                    normalized_qa_status = DEFAULT_QA_STATUS
            else:
                normalized_qa_status = None

            now_iso = utc_now_iso()
            previous_qa_active = previous_qa_status in QA_ACTIVE_STATUSES if previous_qa_status else False
            next_qa_active = normalized_qa_status in QA_ACTIVE_STATUSES if normalized_qa_status else False
            if previous_qa_active and not next_qa_active and task.qa_in_progress_date:
                task.qa_actual_hours = (task.qa_actual_hours or 0) + compute_elapsed_days(
                    task.qa_in_progress_date,
                    now_iso,
                    holiday_dates=holiday_dates,
                )
                task.qa_in_progress_date = None
            if next_qa_active and not task.qa_in_progress_date:
                task.qa_in_progress_date = now_iso
                # Track which sprint was active when QA testing started
                task_team = next_team or _task_team(task)
                active_sprint = Sprint.objects.filter(is_active=True, team=task_team).first()
                if active_sprint:
                    task.qa_sprint = active_sprint

            if previous_qa_status == "Fixing" and normalized_qa_status != "Fixing" and task.qa_fixing_in_progress_date:
                elapsed_fixing = compute_elapsed_days(
                    task.qa_fixing_in_progress_date,
                    now_iso,
                    holiday_dates=holiday_dates,
                )
                task.actual_hours = (task.actual_hours or 0) + elapsed_fixing
                task.qa_fixing_hours = (task.qa_fixing_hours or 0) + elapsed_fixing
                task.qa_fixing_in_progress_date = None
            if normalized_qa_status == "Fixing" and not task.qa_fixing_in_progress_date:
                task.qa_fixing_in_progress_date = now_iso

        owner_changed = task.owner_id and str(task.owner_id) != str(previous_owner_id)
        # Status changes are handled below based on current values.

        task.qa_status = normalized_qa_status
        task.save()
        task_team = next_team or _task_team(task)

        files = (
            request.FILES.getlist("attachments")
            or request.FILES.getlist("files")
            or request.FILES.getlist("file")
        )
        if files:
            try:
                upload_task_attachments(task, files, request.user)
            except Exception as exc:
                response = {"message": "Failed to upload attachments"}
                if isinstance(exc, ClientError):
                    error = exc.response.get("Error", {})
                    response["code"] = error.get("Code")
                    response["detail"] = error.get("Message")
                elif settings.DEBUG:
                    response["detail"] = str(exc)
                return Response(response, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        owner = None
        if owner_changed:
            owner = get_user(task.owner_id)
            if owner and owner.email:
                send_assignment_email(task, owner)
        status_changed = "status" in data and new_status != previous_status
        qa_status_changed = "qa_status" in data and normalized_qa_status != previous_qa_status
        is_grc_task = _is_grc_team(task_team)

        if status_changed and new_status in {"To Do", "Blocked", "Fixed"}:
            if new_status == "Blocked":
                owner = owner or get_user(task.owner_id)
                if owner and owner.email:
                    send_status_changed_email(
                        task,
                        [owner.email],
                        heading="Task status changed to Blocked.",
                        extra_lines=[f"Blocker: {task.blocker or ''}"],
                    )
            elif new_status == "Fixed":
                if (task.type or "").lower() in {"bug", "change"}:
                    if not is_grc_task:
                        qa_emails = get_role_emails("QA", team=task_team) if task_team else []
                        if qa_emails:
                            send_status_changed_email(
                                task,
                                qa_emails,
                                heading="A bug has been marked as Fixed.",
                                link=f"{getattr(settings, 'FRONTEND_ORIGIN', '')}/bugs",
                            )
                else:
                    owner = owner or get_user(task.owner_id)
                    if owner and owner.email:
                        send_status_changed_email(
                            task,
                            [owner.email],
                            heading="Task status changed to Fixed.",
                        )
            else:
                owner = owner or get_user(task.owner_id)
                if owner and owner.email:
                    send_status_changed_email(
                        task,
                        [owner.email],
                        heading=f"Task status changed to {new_status}.",
                    )

        if (
            not is_grc_task
            and qa_status_changed
            and normalized_qa_status in {"Ready to Test", "Rework", "Fixing"}
        ):
            if normalized_qa_status == "Ready to Test":
                if (task.type or "").lower() not in {"bug", "change"}:
                    qa_emails = get_role_emails("QA", team=task_team) if task_team else []
                    if qa_emails:
                        send_status_changed_email(
                            task,
                            qa_emails,
                            heading="A task is ready for testing.",
                            link=f"{getattr(settings, 'FRONTEND_ORIGIN', '')}/test-board",
                        )
            else:
                owner = owner or get_user(task.owner_id)
                if owner and owner.email:
                    send_status_changed_email(
                        task,
                        [owner.email],
                        heading="QA marked a task as needing fixes.",
                        link=f"{getattr(settings, 'FRONTEND_ORIGIN', '')}/test-board",
                    )

        return Response(sanitize_task(task))

    deleted_id = task.id
    task.delete()
    return Response({"deleted": deleted_id})


# Audit logs
@api_view(["GET"])
@permission_classes([IsManager])
def audit_logs_view(request):
    if not getattr(request.user, "is_authenticated", False):
        return Response([], status=status.HTTP_401_UNAUTHORIZED)
    logs = AuditLog.objects.select_related("user__profile").all()
    if not _is_super_admin(request.user):
        logs = logs.filter(Q(user__profile__team=_user_team(request.user)) | Q(user__isnull=True))
    logs = logs.order_by("-created_date", "-id")
    paginator = StandardPagination()
    page = paginator.paginate_queryset(logs, request)
    results = [serialize_audit_log(entry) for entry in (page if page is not None else logs)]
    if page is not None:
        return paginator.get_paginated_response(results)
    return Response(results)


# Approvals
@api_view(["GET", "POST"])
@permission_classes([IsManagerOrReadOnly])
def approvals_view(request):
    if request.method == "GET":
        if not getattr(request.user, "is_authenticated", False):
            return Response([], status=status.HTTP_401_UNAUTHORIZED)
        approvals = Approval.objects.select_related("task__sprint", "task__qa_sprint", "task__owner__profile").all()
        if not _is_super_admin(request.user):
            approvals = approvals.filter(_task_team_q(_user_team(request.user), prefix="task__")).distinct()
        approvals = approvals.order_by("task_id")
        paginator = StandardPagination()
        page = paginator.paginate_queryset(approvals, request)
        results = [
            {
                "task_id": a.task_id,
                "reason": a.reason,
                "approved_by": a.approved_by_id,
                "impact": a.impact,
                "approved": a.approved,
            }
            for a in (page if page is not None else approvals)
        ]
        if page is not None:
            return paginator.get_paginated_response(results)
        return Response(results)

    data = request.data or {}
    task = None
    if data.get("task_id"):
        task = Task.objects.select_related("sprint", "qa_sprint", "owner__profile").filter(pk=data.get("task_id")).first()
        if not task:
            return Response({"message": "Task not found"}, status=status.HTTP_404_NOT_FOUND)
        if not _team_allows(request.user, _task_team(task)):
            return Response({"message": "Not allowed"}, status=status.HTTP_403_FORBIDDEN)
    if data.get("approved_by") and not _is_super_admin(request.user):
        approver = User.objects.select_related("profile").filter(pk=data.get("approved_by")).first()
        if not approver:
            return Response({"message": "Approver not found"}, status=status.HTTP_400_BAD_REQUEST)
        approver_team = getattr(getattr(approver, "profile", None), "team", None) if approver else None
        if approver_team != _user_team(request.user):
            return Response({"message": "Not allowed to set approver outside your team"}, status=status.HTTP_403_FORBIDDEN)
    approval, _ = Approval.objects.update_or_create(
        task_id=data.get("task_id"),
        defaults={
            "reason": data.get("reason"),
            "approved_by_id": data.get("approved_by"),
            "impact": data.get("impact"),
            "approved": bool(data.get("approved")),
        },
    )
    return Response({
        "task_id": approval.task_id,
        "reason": approval.reason,
        "approved_by": approval.approved_by_id,
        "impact": approval.impact,
        "approved": approval.approved,
    }, status=status.HTTP_201_CREATED)


# Sprint summaries
@api_view(["GET", "POST"])
@permission_classes([IsManagerOrReadOnly])
def sprint_summaries_view(request):
    if request.method == "GET":
        if not getattr(request.user, "is_authenticated", False):
            return Response([], status=status.HTTP_401_UNAUTHORIZED)
        summaries = SprintSummary.objects.select_related("sprint").all()
        if not _is_super_admin(request.user):
            summaries = summaries.filter(sprint__team=_user_team(request.user))
        return Response([
            {
                "sprint_id": s.sprint_id,
                "planned_tasks": s.planned_tasks,
                "completed_tasks": s.completed_tasks,
                "carry_forward": s.carry_forward,
                "additional_tasks": s.additional_tasks,
                "bugs": s.bugs,
                "success_percentage": s.success_percentage,
                "what_went_well": s.what_went_well,
                "issues": s.issues,
                "improvements": s.improvements,
                "completed_date": s.completed_date,
            }
            for s in summaries
        ])

    data = request.data or {}
    sprint = None
    if data.get("sprint_id"):
        sprint = Sprint.objects.filter(pk=data.get("sprint_id")).first()
        if not sprint:
            return Response({"message": "Sprint not found"}, status=status.HTTP_404_NOT_FOUND)
        if not _team_allows(request.user, sprint.team):
            return Response({"message": "Not allowed"}, status=status.HTTP_403_FORBIDDEN)
    summary, _ = SprintSummary.objects.update_or_create(
        sprint_id=data.get("sprint_id"),
        defaults={
            "planned_tasks": data.get("planned_tasks", 0),
            "completed_tasks": data.get("completed_tasks", 0),
            "carry_forward": data.get("carry_forward", 0),
            "additional_tasks": data.get("additional_tasks", 0),
            "bugs": data.get("bugs", 0),
            "success_percentage": float(data.get("success_percentage") or 0),
            "what_went_well": data.get("what_went_well"),
            "issues": data.get("issues"),
            "improvements": data.get("improvements"),
            "completed_date": data.get("completed_date"),
        },
    )
    return Response({
        "sprint_id": summary.sprint_id,
        "planned_tasks": summary.planned_tasks,
        "completed_tasks": summary.completed_tasks,
        "carry_forward": summary.carry_forward,
        "additional_tasks": summary.additional_tasks,
        "bugs": summary.bugs,
        "success_percentage": summary.success_percentage,
        "what_went_well": summary.what_went_well,
        "issues": summary.issues,
        "improvements": summary.improvements,
        "completed_date": summary.completed_date,
    }, status=status.HTTP_201_CREATED)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def sprint_summary_detail(request, sprint_id):
    summary = SprintSummary.objects.select_related("sprint").filter(sprint_id=sprint_id).first()
    if not summary:
        return Response(None)
    if not _team_allows(request.user, summary.sprint.team):
        return Response({"message": "Not allowed"}, status=status.HTTP_403_FORBIDDEN)
    return Response({
        "sprint_id": summary.sprint_id,
        "planned_tasks": summary.planned_tasks,
        "completed_tasks": summary.completed_tasks,
        "carry_forward": summary.carry_forward,
        "additional_tasks": summary.additional_tasks,
        "bugs": summary.bugs,
        "success_percentage": summary.success_percentage,
        "what_went_well": summary.what_went_well,
        "issues": summary.issues,
        "improvements": summary.improvements,
        "completed_date": summary.completed_date,
    })


# Task comments
@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def task_comments_view(request):
    if request.method == "GET":
        task_id = request.query_params.get("taskId")
        qs = TaskComment.objects.select_related("task__sprint", "task__qa_sprint", "task__owner__profile").order_by("created_date")
        if task_id:
            task = Task.objects.select_related("sprint", "qa_sprint", "owner__profile").filter(pk=task_id).first()
            if not task:
                return Response({"message": "Task not found"}, status=status.HTTP_404_NOT_FOUND)
            if not _team_allows(request.user, _task_team(task)):
                return Response({"message": "Not allowed"}, status=status.HTTP_403_FORBIDDEN)
            qs = qs.filter(task_id=task_id)
        elif not _is_super_admin(request.user):
            qs = qs.filter(_task_team_q(_user_team(request.user), prefix="task__")).distinct()
        return Response([
            {
                "id": c.id,
                "task_id": c.task_id,
                "author_id": c.author_id,
                "content": c.content,
                "created_date": c.created_date,
            }
            for c in qs
        ])

    data = request.data or {}
    task = None
    if data.get("task_id"):
        task = Task.objects.select_related("sprint", "qa_sprint", "owner__profile").filter(pk=data.get("task_id")).first()
        if not task:
            return Response({"message": "Task not found"}, status=status.HTTP_404_NOT_FOUND)
        if not _team_allows(request.user, _task_team(task)):
            return Response({"message": "Not allowed"}, status=status.HTTP_403_FORBIDDEN)
    if data.get("author_id") and not _is_super_admin(request.user):
        author = User.objects.select_related("profile").filter(pk=data.get("author_id")).first()
        if not author:
            return Response({"message": "Author not found"}, status=status.HTTP_400_BAD_REQUEST)
        author_team = getattr(getattr(author, "profile", None), "team", None) if author else None
        if author_team != _user_team(request.user):
            return Response({"message": "Not allowed to set author outside your team"}, status=status.HTTP_403_FORBIDDEN)
    comment = TaskComment.objects.create(
        id=data.get("id") or now_id("comment"),
        task_id=data.get("task_id"),
        author_id=data.get("author_id"),
        content=data.get("content", ""),
        created_date=data.get("created_date") or time.strftime(
            "%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    )
    return Response({
        "id": comment.id,
        "task_id": comment.task_id,
        "author_id": comment.author_id,
        "content": comment.content,
        "created_date": comment.created_date,
    }, status=status.HTTP_201_CREATED)

# Create your views here.
