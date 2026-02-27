from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0013_task_qa_status"),
    ]

    operations = [
        migrations.AddField(
            model_name="task",
            name="qa_in_progress_date",
            field=models.CharField(blank=True, max_length=64, null=True),
        ),
        migrations.AddField(
            model_name="task",
            name="qa_actual_hours",
            field=models.FloatField(default=0),
        ),
    ]
