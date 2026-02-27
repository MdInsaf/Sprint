from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0005_fix_test_reproduced_type"),
    ]

    operations = [
        migrations.AddField(
            model_name="task",
            name="closed_date",
            field=models.CharField(blank=True, max_length=64, null=True),
        ),
    ]
