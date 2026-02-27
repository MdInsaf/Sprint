from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0011_task_blocked_hours"),
    ]

    operations = [
        migrations.AddField(
            model_name="sprint",
            name="holiday_dates",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
