from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0010_backfill_in_progress_date"),
    ]

    operations = [
        migrations.AddField(
            model_name="task",
            name="blocked_hours",
            field=models.FloatField(default=0),
        ),
    ]
