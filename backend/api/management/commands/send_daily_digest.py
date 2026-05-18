"""
Daily digest email command.

Usage:
    python manage.py send_daily_digest

Schedule via Windows Task Scheduler (or cron on Linux) to run once per day,
e.g. every morning at 8 AM.
"""
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from api.models import Task
from api.notifications import send_notification_email, notifications_enabled
from django.conf import settings

User = get_user_model()

ACTIVE_STATUSES = {"To Do", "In Progress", "Blocked", "Reopen"}
DONE_STATUSES = {"Done", "Closed", "Fixed"}


def _user_name(user) -> str:
    return user.first_name or user.username or user.email or "there"


def _task_line(task) -> str:
    sprint = task.sprint.sprint_name if getattr(task, "sprint", None) else "—"
    return f"  [{task.id}] {task.title} | {task.status} | Sprint: {sprint} | Priority: {task.priority or '—'}"


def _send_member_digest(user, tasks: list) -> bool:
    if not tasks:
        return False
    name = _user_name(user)
    lines = [_task_line(t) for t in tasks]
    body = (
        f"Hi {name},\n\n"
        f"Here are your open tasks for today:\n\n"
        + "\n".join(lines)
        + f"\n\nView: {getattr(settings, 'FRONTEND_ORIGIN', '')}"
    )
    return send_notification_email(
        subject="Your daily task digest",
        message=body,
        recipients=[user.email],
    )


def _send_manager_digest(user, team_tasks: list) -> bool:
    if not team_tasks:
        return False
    name = _user_name(user)

    by_status: dict[str, list] = {}
    for task in team_tasks:
        by_status.setdefault(task.status, []).append(task)

    sections = []
    for st in ["In Progress", "Blocked", "To Do", "Reopen"]:
        bucket = by_status.get(st, [])
        if bucket:
            sections.append(f"── {st} ({len(bucket)}) ──")
            sections.extend(_task_line(t) for t in bucket)

    body = (
        f"Hi {name},\n\n"
        f"Team task summary for today:\n\n"
        + "\n".join(sections)
        + f"\n\nView: {getattr(settings, 'FRONTEND_ORIGIN', '')}"
    )
    return send_notification_email(
        subject="Daily team task summary",
        message=body,
        recipients=[user.email],
    )


class Command(BaseCommand):
    help = "Send daily digest emails: personal pending tasks to each member, full team summary to managers."

    def add_arguments(self, parser):
        parser.add_argument(
            "--team",
            type=str,
            default=None,
            help="Limit digest to a specific team (default: all teams).",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Print what would be sent without actually sending emails.",
        )

    def handle(self, *args, **options):
        team_filter = options.get("team")
        dry_run = options.get("dry_run", False)

        if not notifications_enabled() and not dry_run:
            self.stderr.write("Email notifications are disabled. Set EMAIL_NOTIFICATIONS_ENABLED=True.")
            return

        users_qs = User.objects.select_related("profile").exclude(email="")
        if team_filter:
            users_qs = users_qs.filter(profile__team=team_filter)

        tasks_qs = (
            Task.objects.select_related("sprint", "owner__profile")
            .filter(status__in=ACTIVE_STATUSES)
        )
        if team_filter:
            tasks_qs = tasks_qs.filter(
                sprint__team=team_filter
            ) | tasks_qs.filter(owner__profile__team=team_filter)
            tasks_qs = tasks_qs.distinct()

        tasks_by_owner: dict[int, list] = {}
        all_tasks_by_team: dict[str, list] = {}
        for task in tasks_qs:
            if task.owner_id:
                tasks_by_owner.setdefault(task.owner_id, []).append(task)
            team = (
                task.sprint.team
                if getattr(task, "sprint", None)
                else getattr(getattr(task, "owner", None), "profile", None) and
                getattr(task.owner.profile, "team", None)
            )
            if team:
                all_tasks_by_team.setdefault(team, []).append(task)

        sent = skipped = 0
        for user in users_qs:
            role = getattr(getattr(user, "profile", None), "role", "")
            team = getattr(getattr(user, "profile", None), "team", None)
            is_manager = role in {"Manager", "Super Admin"}

            if dry_run:
                member_tasks = tasks_by_owner.get(user.pk, [])
                self.stdout.write(
                    f"[dry-run] {'Manager' if is_manager else 'Member'} {user.email} "
                    f"— {len(member_tasks)} personal task(s)"
                    + (f", {len(all_tasks_by_team.get(team, []))} team task(s)" if is_manager else "")
                )
                continue

            # Personal digest — every member with pending tasks
            member_tasks = tasks_by_owner.get(user.pk, [])
            if _send_member_digest(user, member_tasks):
                sent += 1
                self.stdout.write(f"Sent personal digest to {user.email} ({len(member_tasks)} tasks)")
            else:
                skipped += 1

            # Manager team summary
            if is_manager:
                team_tasks = all_tasks_by_team.get(team, [])
                if _send_manager_digest(user, team_tasks):
                    sent += 1
                    self.stdout.write(f"Sent team summary to {user.email} ({len(team_tasks)} tasks)")

        if not dry_run:
            self.stdout.write(self.style.SUCCESS(f"Done. Sent: {sent}, Skipped: {skipped}"))
