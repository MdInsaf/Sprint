from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0021_merge_20260315_0958"),
    ]

    operations = [
        migrations.AddField(
            model_name="memberprofile",
            name="timezone",
            field=models.CharField(default="UTC", max_length=64),
        ),
    ]
