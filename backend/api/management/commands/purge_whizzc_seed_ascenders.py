from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import Q

from api.models import Approval, AuditLog, MemberProfile, Sprint, SprintSummary, Task, TaskComment


User = get_user_model()


class Command(BaseCommand):
    help = "Convert one admin account to an ascendersservices.in login, then purge remaining whizzc.com users and related imported data."

    def add_arguments(self, parser):
        parser.add_argument("--email", default="ijaz@ascendersservices.in")
        parser.add_argument("--username", default="ijaz")
        parser.add_argument("--name", default="Ijaz")
        parser.add_argument("--password", default="password123")
        parser.add_argument("--team", default="Ascenders")
        parser.add_argument("--role", default="Super Admin")

    def handle(self, *args, **options):
        email = options["email"].strip().lower()
        username = options["username"].strip()
        name = options["name"].strip()
        password = options["password"]
        team = options["team"].strip() or "Ascenders"
        role = options["role"].strip() or "Super Admin"

        with transaction.atomic():
            keeper = self._resolve_keeper(email=email, username=username, name=name)
            old_keeper_email = keeper.email
            keeper.username = username
            keeper.email = email
            keeper.first_name = name
            keeper.is_active = True
            keeper.set_password(password)
            keeper.save()

            profile, _ = MemberProfile.objects.get_or_create(user=keeper)
            profile.role = role
            profile.team = team
            profile.save()

            whizz_qs = User.objects.filter(email__iendswith='@whizzc.com').exclude(pk=keeper.pk)
            removed_emails = list(whizz_qs.order_by("id").values_list("email", flat=True))
            whizz_ids = list(whizz_qs.values_list("id", flat=True))

            removed_task_ids = list(
                Task.objects.filter(owner_id__in=whizz_ids).values_list("id", flat=True)
            )

            if whizz_ids:
                AuditLog.objects.filter(user_id__in=whizz_ids).delete()
                Approval.objects.filter(
                    Q(approved_by_id__in=whizz_ids) | Q(task_id__in=removed_task_ids)
                ).delete()
                TaskComment.objects.filter(
                    Q(author_id__in=whizz_ids) | Q(task_id__in=removed_task_ids)
                ).delete()
                Task.objects.filter(id__in=removed_task_ids).delete()
                whizz_qs.delete()

            remaining_sprint_ids = list(
                Task.objects.exclude(sprint_id__isnull=True).values_list("sprint_id", flat=True).distinct()
            )
            stale_summaries = SprintSummary.objects.exclude(sprint_id__in=remaining_sprint_ids)
            removed_summary_count = stale_summaries.count()
            stale_summaries.delete()

            stale_sprints = Sprint.objects.exclude(id__in=remaining_sprint_ids)
            removed_sprint_ids = list(stale_sprints.values_list("id", flat=True))
            stale_sprints.delete()

            ascenders_users = list(User.objects.filter(email__iendswith='@ascendersservices.in'))
            for user in ascenders_users:
                user.set_password(password)
                user.save(update_fields=["password"])

        self.stdout.write(
            self.style.SUCCESS(
                str(
                    {
                        "keeper_id": keeper.id,
                        "keeper_old_email": old_keeper_email,
                        "keeper_new_email": keeper.email,
                        "removed_whizz_users": removed_emails,
                        "removed_task_count": len(removed_task_ids),
                        "removed_sprint_summary_count": removed_summary_count,
                        "removed_sprint_ids": removed_sprint_ids,
                        "ascenders_password_reset_count": len(ascenders_users),
                    }
                )
            )
        )

    def _resolve_keeper(self, email, username, name):
        existing = User.objects.filter(email__iexact=email).first()
        if existing:
            return existing

        super_admin = User.objects.filter(profile__role__iexact="Super Admin").order_by("id").first()
        if super_admin:
            return super_admin

        fallback = User.objects.order_by("id").first()
        if fallback:
            return fallback

        user = User.objects.create_user(
            username=username,
            first_name=name,
            email=email,
            password="temporary-password",
        )
        return user
