from django.urls import path

from . import views

urlpatterns = [
    path("health", views.health),
    path("csrf", views.csrf_token),
    path("auth/login", views.auth_login),
    path("auth/logout", views.auth_logout),
    path("auth/change-password", views.change_password),
    path("auth/request-password-reset", views.request_password_reset),
    path("auth/reset-password", views.reset_password),
    path("me", views.me),
    path("users", views.team_members),
    path("users/<str:member_id>", views.team_member_detail),
    path("team-members", views.team_members),
    path("team-members/<str:member_id>", views.team_member_detail),
    path("sprints", views.sprints_view),
    path("active-sprint", views.active_sprint),
    path("sprints/<str:sprint_id>", views.sprint_detail),
    path("tasks", views.tasks_view),
    path("tasks/<str:task_id>", views.task_detail),
    path("attachments/<str:attachment_id>", views.attachment_detail),
    path("audit-logs", views.audit_logs_view),
    path("approvals", views.approvals_view),
    path("sprint-summaries", views.sprint_summaries_view),
    path("sprint-summaries/<str:sprint_id>", views.sprint_summary_detail),
    path("task-comments", views.task_comments_view),
]
