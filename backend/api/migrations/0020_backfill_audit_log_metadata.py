from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0019_audit_log"),
    ]

    operations = [
        migrations.RunSQL(
            sql="""
                UPDATE audit_logs AS al
                SET metadata = COALESCE(al.metadata, '{}'::jsonb) || jsonb_strip_nulls(
                    jsonb_build_object(
                        'user_name',
                        NULLIF(
                            BTRIM(
                                CONCAT(
                                    COALESCE(au.first_name, ''),
                                    CASE
                                        WHEN COALESCE(au.first_name, '') <> '' AND COALESCE(au.last_name, '') <> '' THEN ' '
                                        ELSE ''
                                    END,
                                    COALESCE(au.last_name, '')
                                )
                            ),
                            ''
                        ),
                        'username', NULLIF(au.username, ''),
                        'user_email', NULLIF(au.email, ''),
                        'user_role', NULLIF(mp.role, ''),
                        'user_team', NULLIF(mp.team, '')
                    )
                )
                FROM auth_user AS au
                LEFT JOIN member_profiles AS mp ON mp.user_id = au.id
                WHERE al.user_id IS NOT NULL
                  AND al.user_id::text = au.id::text
                  AND (
                    al.metadata IS NULL
                    OR NOT (al.metadata ? 'user_name')
                    OR NOT (al.metadata ? 'username')
                    OR NOT (al.metadata ? 'user_email')
                  );
            """,
            reverse_sql=migrations.RunSQL.noop,
        ),
    ]
