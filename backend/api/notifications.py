import logging
from typing import Iterable

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.mail import send_mail


logger = logging.getLogger(__name__)
User = get_user_model()


def _normalize_emails(emails: Iterable[str] | None) -> list[str]:
    seen: set[str] = set()
    normalized: list[str] = []
    for email in emails or []:
        if not email:
            continue
        value = str(email).strip().lower()
        if not value or value in seen:
            continue
        seen.add(value)
        normalized.append(value)
    return normalized


def _default_from_email() -> str | None:
    return (
        getattr(settings, "DEFAULT_FROM_EMAIL", None)
        or getattr(settings, "EMAIL_HOST_USER", None)
        or None
    )


def notifications_enabled() -> bool:
    return bool(getattr(settings, "EMAIL_NOTIFICATIONS_ENABLED", False))


def send_notification_email(subject: str, message: str, recipients: Iterable[str]) -> bool:
    if not notifications_enabled():
        return False
    to_emails = _normalize_emails(recipients)
    if not to_emails:
        return False
    from_email = _default_from_email()
    if not from_email:
        logger.warning("Email skipped: DEFAULT_FROM_EMAIL/EMAIL_HOST_USER not configured")
        return False
    try:
        send_mail(subject, message, from_email, to_emails, fail_silently=False)
        return True
    except Exception:
        logger.exception("Failed to send email: %s -> %s", subject, to_emails)
        return False


def get_user(user_id) -> User | None:
    if not user_id:
        return None
    return User.objects.filter(pk=user_id).first()


def get_role_emails(role: str, team: str | None = None) -> list[str]:
    qs = User.objects.filter(profile__role=role)
    if team:
        qs = qs.filter(profile__team=team)
    return list(qs.exclude(email="").values_list("email", flat=True))


def task_label(task) -> str:
    return "Bug" if (task.type or "").lower() in {"bug", "change"} else "Task"


def build_task_context(task) -> str:
    sprint_name = task.sprint.sprint_name if getattr(task, "sprint", None) else "Unassigned"
    return (
        f"Title: {task.title}\n"
        f"ID: {task.id}\n"
        f"Type: {task.type}\n"
        f"Status: {task.status}\n"
        f"QA Status: {task.qa_status or 'N/A'}\n"
        f"Sprint: {sprint_name}\n"
        f"Priority: {task.priority or 'N/A'}"
    )


def send_assignment_email(task, user: User) -> None:
    label = task_label(task)
    name = user.first_name or user.username or user.email or "there"
    subject = f"{label} assigned: {task.title}"
    body = (
        f"Hi {name},\n\n"
        f"You have been assigned a {label.lower()}.\n"
        f"{build_task_context(task)}\n\n"
        f"View: {getattr(settings, 'FRONTEND_ORIGIN', '')}"
    )
    send_notification_email(subject, body, [user.email])


def send_ready_to_test_email(task, qa_emails: Iterable[str]) -> None:
    subject = f"Ready to test: {task.title}"
    body = (
        "A task is ready for testing.\n"
        f"{build_task_context(task)}\n\n"
        f"Test Board: {getattr(settings, 'FRONTEND_ORIGIN', '')}/test-board"
    )
    send_notification_email(subject, body, qa_emails)


def send_needs_fix_email(task, user: User) -> None:
    name = user.first_name or user.username or user.email or "there"
    subject = f"Needs fixing: {task.title}"
    body = (
        f"Hi {name},\n\n"
        "QA marked a task as needing fixes.\n"
        f"{build_task_context(task)}\n\n"
        f"Test Board: {getattr(settings, 'FRONTEND_ORIGIN', '')}/test-board"
    )
    send_notification_email(subject, body, [user.email])


def send_blocker_email(task, user: User) -> None:
    name = user.first_name or user.username or user.email or "there"
    subject = f"Blocked: {task.title}"
    blocker_text = task.blocker or ""
    body = (
        f"Hi {name},\n\n"
        "A blocker was added to your task.\n"
        f"{build_task_context(task)}\n"
        f"Blocker: {blocker_text}\n\n"
        f"View: {getattr(settings, 'FRONTEND_ORIGIN', '')}"
    )
    send_notification_email(subject, body, [user.email])


def send_bug_fixed_email(task, qa_emails: Iterable[str]) -> None:
    subject = f"Bug fixed: {task.title}"
    body = (
        "A bug has been marked as fixed.\n"
        f"{build_task_context(task)}\n\n"
        f"Bugs Board: {getattr(settings, 'FRONTEND_ORIGIN', '')}/bugs"
    )
    send_notification_email(subject, body, qa_emails)


def send_status_changed_email(
    task,
    recipients: Iterable[str],
    heading: str | None = None,
    extra_lines: Iterable[str] | None = None,
    link: str | None = None,
) -> None:
    subject = f"Status changed: {task.title}"
    intro = heading or "The task status has been updated."
    body = f"{intro}\n{build_task_context(task)}"
    if extra_lines:
        body = f"{body}\n" + "\n".join([line for line in extra_lines if line])
    target = link or getattr(settings, 'FRONTEND_ORIGIN', '')
    if target:
        body = f"{body}\n\nView: {target}"
    send_notification_email(subject, body, recipients)
