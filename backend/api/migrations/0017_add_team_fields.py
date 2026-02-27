from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0016_task_qa_fixing_hours"),
    ]

    operations = [
        migrations.AddField(
            model_name="memberprofile",
            name="team",
            field=models.CharField(default="Developers", max_length=64),
        ),
        migrations.AddField(
            model_name="sprint",
            name="team",
            field=models.CharField(default="Developers", max_length=64),
        ),
    ]
