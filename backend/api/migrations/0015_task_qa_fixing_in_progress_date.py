from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0014_task_qa_time_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="task",
            name="qa_fixing_in_progress_date",
            field=models.CharField(blank=True, max_length=64, null=True),
        ),
    ]
