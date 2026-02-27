from django.db import models
from django.contrib.auth import get_user_model

User = get_user_model()


class MemberProfile(models.Model):
  user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="profile")
  role = models.CharField(max_length=64, default="Developer")
  avatar = models.CharField(max_length=1024, blank=True, null=True)
  team = models.CharField(max_length=64, default="Developers")
  leave_dates = models.JSONField(default=list, blank=True)

  class Meta:
    db_table = "member_profiles"


class Sprint(models.Model):
  id = models.CharField(primary_key=True, max_length=64)
  sprint_name = models.CharField(max_length=255)
  start_date = models.CharField(max_length=64)
  end_date = models.CharField(max_length=64)
  sprint_goal = models.TextField(blank=True, null=True)
  holiday_dates = models.JSONField(default=list, blank=True)
  is_active = models.BooleanField(default=False)
  team = models.CharField(max_length=64, default="Developers")

  class Meta:
    db_table = "sprints"


class Task(models.Model):
  id = models.CharField(primary_key=True, max_length=64)
  title = models.CharField(max_length=255)
  type = models.CharField(max_length=64)
  sprint = models.ForeignKey(Sprint, on_delete=models.SET_NULL, null=True, blank=True, db_column="sprint_id")
  qa_sprint = models.ForeignKey(Sprint, on_delete=models.SET_NULL, null=True, blank=True, db_column="qa_sprint_id", related_name="qa_tasks")
  module = models.CharField(max_length=255, blank=True, null=True)
  owner = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, db_column="owner_id")
  priority = models.CharField(max_length=32, blank=True, null=True)
  status = models.CharField(max_length=32, blank=True, null=True)
  qa_status = models.CharField(max_length=32, blank=True, null=True)
  qa_in_progress_date = models.CharField(max_length=64, blank=True, null=True)
  qa_actual_hours = models.FloatField(default=0)
  qa_fixing_in_progress_date = models.CharField(max_length=64, blank=True, null=True)
  qa_fixing_hours = models.FloatField(default=0)
  estimated_hours = models.FloatField(default=0)
  actual_hours = models.FloatField(default=0)
  blocked_hours = models.FloatField(default=0)
  blocker = models.TextField(blank=True, null=True)
  steps_to_reproduce = models.TextField(blank=True, null=True)
  test_reproduced = models.IntegerField(default=0)
  blocker_date = models.CharField(max_length=64, blank=True, null=True)
  in_progress_date = models.CharField(max_length=64, blank=True, null=True)
  created_date = models.CharField(max_length=64)
  closed_date = models.CharField(max_length=64, blank=True, null=True)
  description = models.TextField(blank=True, null=True)

  class Meta:
    db_table = "tasks"


class Approval(models.Model):
  task = models.OneToOneField(Task, on_delete=models.CASCADE, primary_key=True, db_column="task_id")
  reason = models.TextField(blank=True, null=True)
  approved_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, db_column="approved_by")
  impact = models.CharField(max_length=32, blank=True, null=True)
  approved = models.BooleanField(default=False)

  class Meta:
    db_table = "approvals"


class SprintSummary(models.Model):
  sprint = models.OneToOneField(Sprint, on_delete=models.CASCADE, primary_key=True, db_column="sprint_id")
  planned_tasks = models.IntegerField(default=0)
  completed_tasks = models.IntegerField(default=0)
  carry_forward = models.IntegerField(default=0)
  additional_tasks = models.IntegerField(default=0)
  bugs = models.IntegerField(default=0)
  success_percentage = models.FloatField(default=0)
  what_went_well = models.TextField(blank=True, null=True)
  issues = models.TextField(blank=True, null=True)
  improvements = models.TextField(blank=True, null=True)
  completed_date = models.CharField(max_length=64, blank=True, null=True)

  class Meta:
    db_table = "sprint_summaries"


class TaskComment(models.Model):
  id = models.CharField(primary_key=True, max_length=64)
  task = models.ForeignKey(Task, on_delete=models.CASCADE, db_column="task_id")
  author = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, db_column="author_id")
  content = models.TextField()
  created_date = models.CharField(max_length=64)

  class Meta:
    db_table = "task_comments"


class TaskAttachment(models.Model):
  id = models.CharField(primary_key=True, max_length=64)
  task = models.ForeignKey(Task, on_delete=models.CASCADE, db_column="task_id", related_name="attachments")
  uploaded_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, db_column="uploaded_by")
  file_name = models.CharField(max_length=512)
  file_size = models.BigIntegerField(default=0)
  content_type = models.CharField(max_length=255, blank=True, null=True)
  s3_bucket = models.CharField(max_length=255)
  s3_key = models.CharField(max_length=1024)
  created_date = models.CharField(max_length=64)

  class Meta:
    db_table = "task_attachments"


class AuditLog(models.Model):
  id = models.CharField(primary_key=True, max_length=64)
  user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, db_column="user_id")
  action = models.CharField(max_length=32)
  entity_type = models.CharField(max_length=64, blank=True, null=True)
  entity_id = models.CharField(max_length=64, blank=True, null=True)
  path = models.CharField(max_length=255)
  method = models.CharField(max_length=8)
  status_code = models.IntegerField(default=200)
  ip_address = models.CharField(max_length=64, blank=True, null=True)
  user_agent = models.TextField(blank=True, null=True)
  metadata = models.JSONField(default=dict, blank=True)
  created_date = models.CharField(max_length=64)

  class Meta:
    db_table = "audit_logs"

