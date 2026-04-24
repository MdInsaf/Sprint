import csv
import json
import re
from datetime import datetime
from pathlib import Path

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction

from api.models import (
    Approval,
    AuditLog,
    MemberProfile,
    Sprint,
    SprintSummary,
    Task,
    TaskAttachment,
    TaskComment,
)


User = get_user_model()
TZ_SUFFIX_RE = re.compile(r"\s*([+-]\d{2})(\d{2})$")
CSV_NAMES = (
    "auth_user",
    "member_profiles",
    "sprints",
    "tasks",
    "approvals",
    "sprint_summaries",
    "task_comments",
    "task_attachments",
    "audit_logs",
)


def empty_to_none(value):
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def parse_bool(value):
    text = str(value).strip().lower()
    return text in {"1", "true", "t", "yes", "y"}


def parse_int(value, default=0):
    text = empty_to_none(value)
    if text is None:
        return default
    return int(text)


def parse_float(value, default=0.0):
    text = empty_to_none(value)
    if text is None:
        return default
    return float(text)


def parse_json(value, default):
    text = empty_to_none(value)
    if text is None:
        return default
    return json.loads(text)


def parse_datetime_value(value):
    text = empty_to_none(value)
    if text is None:
        return None
    normalized = TZ_SUFFIX_RE.sub(r"\1:\2", text)
    try:
        return datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise CommandError(f"Unable to parse datetime value: {value}") from exc


class Command(BaseCommand):
    help = "Import the checked-in legacy CSV snapshot into the current Django schema."

    def add_arguments(self, parser):
        parser.add_argument(
            "--tables-dir",
            default=str(Path(__file__).resolve().parents[3] / "import_data"),
            help="Directory containing the exported CSV tables.",
        )
        parser.add_argument(
            "--replace-existing",
            action="store_true",
            help="Delete current users/data before importing the legacy snapshot.",
        )
        parser.add_argument(
            "--skip-audit-logs",
            action="store_true",
            help="Skip importing audit_logs.",
        )
        parser.add_argument(
            "--attachment-bucket",
            default=getattr(settings, "ATTACHMENTS_BUCKET", ""),
            help="Bucket name to write into imported task_attachments rows.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Read the snapshot and print counts without writing to the database.",
        )

    def handle(self, *args, **options):
        tables_dir = Path(options["tables_dir"]).resolve()
        if not tables_dir.exists():
            raise CommandError(f"Tables directory not found: {tables_dir}")

        rows_by_name = {
            name: self._load_csv(tables_dir, name)
            for name in CSV_NAMES
            if not (name == "audit_logs" and options["skip_audit_logs"])
        }

        source_counts = {name: len(rows) for name, rows in rows_by_name.items()}
        self.stdout.write(f"Using snapshot directory: {tables_dir}")
        self.stdout.write(f"Source counts: {json.dumps(source_counts, sort_keys=True)}")

        if options["dry_run"]:
            return

        attachment_bucket = empty_to_none(options["attachment_bucket"])
        if not attachment_bucket and rows_by_name.get("task_attachments"):
            raise CommandError("attachment-bucket is required when importing task_attachments rows.")

        with transaction.atomic():
            if options["replace_existing"]:
                self._replace_existing_data()
            self._import_users(rows_by_name.get("auth_user", []))
            self._import_profiles(rows_by_name.get("member_profiles", []))
            self._import_sprints(rows_by_name.get("sprints", []))
            self._import_tasks(rows_by_name.get("tasks", []))
            self._import_approvals(rows_by_name.get("approvals", []))
            self._import_summaries(rows_by_name.get("sprint_summaries", []))
            self._import_comments(rows_by_name.get("task_comments", []))
            self._import_attachments(rows_by_name.get("task_attachments", []), attachment_bucket)
            if not options["skip_audit_logs"]:
                self._import_audit_logs(rows_by_name.get("audit_logs", []))

        self._reset_identity_sequences()
        target_counts = self._target_counts(skip_audit_logs=options["skip_audit_logs"])
        self.stdout.write(self.style.SUCCESS(f"Target counts: {json.dumps(target_counts, sort_keys=True)}"))

    def _load_csv(self, tables_dir, table_name):
        matches = sorted(tables_dir.glob(f"{table_name}_*.csv"))
        if not matches:
            raise CommandError(f"Could not find CSV for table '{table_name}' in {tables_dir}")
        with matches[0].open("r", encoding="utf-8-sig", newline="") as handle:
            return list(csv.DictReader(handle))

    def _replace_existing_data(self):
        self.stdout.write("Deleting current data before import.")
        AuditLog.objects.all().delete()
        TaskAttachment.objects.all().delete()
        TaskComment.objects.all().delete()
        Approval.objects.all().delete()
        SprintSummary.objects.all().delete()
        Task.objects.all().delete()
        Sprint.objects.all().delete()
        MemberProfile.objects.all().delete()
        User.objects.all().delete()

    def _import_users(self, rows):
        for row in rows:
            user = User(
                id=parse_int(row["id"]),
                password=row["password"],
                last_login=parse_datetime_value(row["last_login"]),
                is_superuser=parse_bool(row["is_superuser"]),
                username=row["username"],
                first_name=row["first_name"],
                last_name=row["last_name"],
                email=(row["email"] or "").strip().lower(),
                is_staff=parse_bool(row["is_staff"]),
                is_active=parse_bool(row["is_active"]),
                date_joined=parse_datetime_value(row["date_joined"]),
            )
            user.save(force_insert=True)
        self.stdout.write(f"Imported {len(rows)} auth_user rows.")

    def _import_profiles(self, rows):
        for row in rows:
            MemberProfile.objects.create(
                id=parse_int(row["id"]),
                role=row["role"] or "Developer",
                avatar=empty_to_none(row["avatar"]),
                user_id=parse_int(row["user_id"]),
                team=row.get("team") or "Developers",
                leave_dates=parse_json(row.get("leave_dates"), []),
            )
        self.stdout.write(f"Imported {len(rows)} member_profiles rows.")

    def _import_sprints(self, rows):
        for row in rows:
            Sprint.objects.create(
                id=row["id"],
                sprint_name=row["sprint_name"],
                start_date=row["start_date"],
                end_date=row["end_date"],
                sprint_goal=empty_to_none(row["sprint_goal"]),
                is_active=parse_bool(row["is_active"]),
                holiday_dates=parse_json(row["holiday_dates"], []),
                team=row.get("team") or "Developers",
            )
        self.stdout.write(f"Imported {len(rows)} sprints rows.")

    def _import_tasks(self, rows):
        for row in rows:
            Task.objects.create(
                id=row["id"],
                title=row["title"],
                type=row["type"],
                sprint_id=empty_to_none(row["sprint_id"]),
                qa_sprint_id=empty_to_none(row.get("qa_sprint_id")),
                module=empty_to_none(row["module"]),
                owner_id=parse_int(row["owner_id"], default=None) if empty_to_none(row["owner_id"]) else None,
                priority=empty_to_none(row["priority"]),
                status=empty_to_none(row["status"]),
                qa_status=empty_to_none(row["qa_status"]),
                qa_in_progress_date=empty_to_none(row["qa_in_progress_date"]),
                qa_actual_hours=parse_float(row["qa_actual_hours"]),
                qa_fixing_in_progress_date=empty_to_none(row["qa_fixing_in_progress_date"]),
                qa_fixing_hours=parse_float(row["qa_fixing_hours"]),
                estimated_hours=parse_float(row["estimated_hours"]),
                actual_hours=parse_float(row["actual_hours"]),
                blocked_hours=parse_float(row["blocked_hours"]),
                blocker=empty_to_none(row["blocker"]),
                steps_to_reproduce=empty_to_none(row["steps_to_reproduce"]),
                test_reproduced=parse_int(row["test_reproduced"]),
                blocker_date=empty_to_none(row["blocker_date"]),
                in_progress_date=empty_to_none(row["in_progress_date"]),
                created_date=row["created_date"],
                closed_date=empty_to_none(row["closed_date"]),
                description=empty_to_none(row["description"]),
            )
        self.stdout.write(f"Imported {len(rows)} tasks rows.")

    def _import_approvals(self, rows):
        for row in rows:
            Approval.objects.create(
                task_id=row["task_id"],
                reason=empty_to_none(row["reason"]),
                approved_by_id=parse_int(row["approved_by"], default=None) if empty_to_none(row["approved_by"]) else None,
                impact=empty_to_none(row["impact"]),
                approved=parse_bool(row["approved"]),
            )
        self.stdout.write(f"Imported {len(rows)} approvals rows.")

    def _import_summaries(self, rows):
        for row in rows:
            SprintSummary.objects.create(
                sprint_id=row["sprint_id"],
                planned_tasks=parse_int(row["planned_tasks"]),
                completed_tasks=parse_int(row["completed_tasks"]),
                carry_forward=parse_int(row["carry_forward"]),
                additional_tasks=parse_int(row["additional_tasks"]),
                bugs=parse_int(row["bugs"]),
                success_percentage=parse_float(row["success_percentage"]),
                what_went_well=empty_to_none(row["what_went_well"]),
                issues=empty_to_none(row["issues"]),
                improvements=empty_to_none(row["improvements"]),
                completed_date=empty_to_none(row["completed_date"]),
            )
        self.stdout.write(f"Imported {len(rows)} sprint_summaries rows.")

    def _import_comments(self, rows):
        for row in rows:
            TaskComment.objects.create(
                id=row["id"],
                task_id=row["task_id"],
                author_id=parse_int(row["author_id"], default=None) if empty_to_none(row["author_id"]) else None,
                content=row["content"],
                created_date=row["created_date"],
            )
        self.stdout.write(f"Imported {len(rows)} task_comments rows.")

    def _import_attachments(self, rows, attachment_bucket):
        for row in rows:
            TaskAttachment.objects.create(
                id=row["id"],
                task_id=row["task_id"],
                uploaded_by_id=parse_int(row["uploaded_by"], default=None) if empty_to_none(row["uploaded_by"]) else None,
                file_name=row["file_name"],
                file_size=parse_int(row["file_size"]),
                content_type=empty_to_none(row["content_type"]),
                s3_bucket=attachment_bucket or row["s3_bucket"],
                s3_key=row["s3_key"],
                created_date=row["created_date"],
            )
        self.stdout.write(f"Imported {len(rows)} task_attachments rows.")

    def _import_audit_logs(self, rows):
        for row in rows:
            AuditLog.objects.create(
                id=row["id"],
                user_id=parse_int(row["user_id"], default=None) if empty_to_none(row["user_id"]) else None,
                action=row["action"],
                entity_type=empty_to_none(row["entity_type"]),
                entity_id=empty_to_none(row["entity_id"]),
                path=row["path"],
                method=row["method"],
                status_code=parse_int(row["status_code"]),
                ip_address=empty_to_none(row["ip_address"]),
                user_agent=empty_to_none(row["user_agent"]),
                metadata=parse_json(row["metadata"], {}),
                created_date=row["created_date"],
            )
        self.stdout.write(f"Imported {len(rows)} audit_logs rows.")

    def _reset_identity_sequences(self):
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT setval(pg_get_serial_sequence(%s, %s), COALESCE(MAX(id), 1), TRUE) FROM auth_user",
                ["auth_user", "id"],
            )
            cursor.execute(
                "SELECT setval(pg_get_serial_sequence(%s, %s), COALESCE(MAX(id), 1), TRUE) FROM member_profiles",
                ["member_profiles", "id"],
            )

    def _target_counts(self, skip_audit_logs=False):
        counts = {
            "auth_user": User.objects.count(),
            "member_profiles": MemberProfile.objects.count(),
            "sprints": Sprint.objects.count(),
            "tasks": Task.objects.count(),
            "approvals": Approval.objects.count(),
            "sprint_summaries": SprintSummary.objects.count(),
            "task_comments": TaskComment.objects.count(),
            "task_attachments": TaskAttachment.objects.count(),
        }
        if not skip_audit_logs:
            counts["audit_logs"] = AuditLog.objects.count()
        return counts
