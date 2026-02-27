from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0002_alter_task_owner_alter_approval_approved_by_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="task",
            name="steps_to_reproduce",
            field=models.TextField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="task",
            name="test_reproduced",
            field=models.IntegerField(default=0),
        ),
    ]
