from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0015_task_qa_fixing_in_progress_date"),
    ]

    operations = [
        migrations.AddField(
            model_name="task",
            name="qa_fixing_hours",
            field=models.FloatField(default=0),
        ),
    ]
