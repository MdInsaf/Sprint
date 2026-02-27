from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0003_task_steps_to_reproduce_test_reproduced"),
    ]

    operations = [
        migrations.AlterField(
            model_name="task",
            name="test_reproduced",
            field=models.IntegerField(default=0),
        ),
    ]
