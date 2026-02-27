from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0014_task_qa_time_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="memberprofile",
            name="leave_dates",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
