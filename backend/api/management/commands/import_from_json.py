import json
import psycopg2
import psycopg2.extras
from django.core.management.base import BaseCommand
from django.conf import settings


TABLE_ORDER = [
    'django_content_type',
    'auth_permission',
    'auth_group',
    'auth_user',
    'auth_user_groups',
    'auth_user_user_permissions',
    'django_migrations',
    'django_session',
    'member_profiles',
    'sprints',
    'tasks',
    'approvals',
    'sprint_summaries',
    'task_comments',
    'task_attachments',
    'audit_logs',
]


def adapt_value(v):
    if isinstance(v, (dict, list)):
        return psycopg2.extras.Json(v)
    return v


class Command(BaseCommand):
    help = 'Import raw SQL export into Supabase via direct psycopg2 connection'

    def add_arguments(self, parser):
        parser.add_argument('file', type=str, help='Path to export.json')

    def handle(self, *args, **options):
        path = options['file']

        with open(path, 'r') as f:
            data = json.load(f)

        conn = psycopg2.connect(
            host=settings.DATABASES['default']['HOST'],
            dbname=settings.DATABASES['default']['NAME'],
            user=settings.DATABASES['default']['USER'],
            password=settings.DATABASES['default']['PASSWORD'],
            port=settings.DATABASES['default']['PORT'],
            connect_timeout=30,
            sslmode='require',
        )

        all_tables = list(data.keys())
        ordered = [t for t in TABLE_ORDER if t in all_tables]
        remaining = [t for t in all_tables if t not in ordered]

        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            for table in ordered + remaining:
                rows = data.get(table, [])
                if not rows:
                    continue

                columns = list(rows[0].keys())
                col_str = ', '.join(f'"{c}"' for c in columns)
                placeholders = ', '.join(['%s'] * len(columns))
                sql = f'INSERT INTO {table} ({col_str}) VALUES ({placeholders}) ON CONFLICT DO NOTHING'

                values = [tuple(adapt_value(r[c]) for c in columns) for r in rows]
                try:
                    psycopg2.extras.execute_batch(cur, sql, values)
                    conn.commit()
                    self.stdout.write(f'  {table}: {len(rows)} records')
                except Exception as e:
                    conn.rollback()
                    self.stdout.write(self.style.WARNING(f'  {table}: SKIPPED — {e}'))

        conn.close()
        self.stdout.write(self.style.SUCCESS('Import complete!'))
