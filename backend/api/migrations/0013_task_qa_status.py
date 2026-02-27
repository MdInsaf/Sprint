from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0012_sprint_holiday_dates"),
    ]

    operations = [
        migrations.AddField(
            model_name="task",
            name="qa_status",
            field=models.CharField(blank=True, max_length=32, null=True),
        ),
    ]
