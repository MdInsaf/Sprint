import django.db.models
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0019_audit_log"),
    ]

    operations = [
        migrations.AddField(
            model_name="task",
            name="qa_sprint",
            field=models.ForeignKey(
                blank=True,
                db_column="qa_sprint_id",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="qa_tasks",
                to="api.sprint",
            ),
        ),
    ]
