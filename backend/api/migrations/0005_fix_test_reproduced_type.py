from django.db import migrations


class Migration(migrations.Migration):
    """
    Align the database column type of Task.test_reproduced with the model.
    Some environments still have this column as BOOLEAN, which rejects integer
    inserts. This migration forces it to INTEGER while preserving data.
    """

    dependencies = [
        ("api", "0004_alter_task_test_reproduced"),
    ]

    operations = [
        migrations.RunSQL(
            sql="""
                ALTER TABLE tasks
                ALTER COLUMN test_reproduced
                TYPE integer
                USING CASE
                    WHEN LOWER(COALESCE(test_reproduced::text, '')) IN ('t', 'true', '1') THEN 1
                    WHEN LOWER(COALESCE(test_reproduced::text, '')) IN ('f', 'false', '0') THEN 0
                    ELSE 0
                END;
                ALTER TABLE tasks
                ALTER COLUMN test_reproduced
                SET DEFAULT 0;
                ALTER TABLE tasks
                ALTER COLUMN test_reproduced
                SET NOT NULL;
            """,
            reverse_sql="""
                ALTER TABLE tasks
                ALTER COLUMN test_reproduced
                TYPE boolean
                USING CASE
                    WHEN LOWER(COALESCE(test_reproduced::text, '')) IN ('1', 't', 'true') THEN TRUE
                    ELSE FALSE
                END;
                ALTER TABLE tasks
                ALTER COLUMN test_reproduced
                SET DEFAULT FALSE;
                ALTER TABLE tasks
                ALTER COLUMN test_reproduced
                SET NOT NULL;
            """,
        ),
    ]
