from django.conf import settings
from django.db import migrations


def set_user_emails(apps, schema_editor):
    User = apps.get_model(*settings.AUTH_USER_MODEL.split("."))
    email_map = {
        "kaviranjani": "kaviranjani.g@whizzc.com",
        "jawahar": "jawahar.m@whizzc.com",
        "ashif": "ashif.a@whizzc.com",
        "nivas": "nivas.j@whizzc.com",
        "gladwin": "gladwin.a@whizzc.com",
        "kamalraj": "kamalraj@whizzc.com",
        "ajay": "ajay.j@whizzc.com",
        "bhaktha": "bhaktha@whizzc.com",
        "bhakthavachalu": "bhaktha@whizzc.com",
        "siddhaarth": "siddhaarth@whizzc.com",
        "sumathy": "sumathy@whizzc.com",
        "mohamed-insaf": "mohamed.insaf@whizzc.com",
    }
    for username, email in email_map.items():
        qs = User.objects.filter(username__iexact=username)
        if qs.exists():
            qs.update(email=email.lower())


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0006_task_closed_date"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.RunPython(set_user_emails, migrations.RunPython.noop),
    ]
