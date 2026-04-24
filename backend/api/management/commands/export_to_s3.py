import json
import boto3
import psycopg2
import psycopg2.extras
from django.core.management.base import BaseCommand
from django.conf import settings


class Command(BaseCommand):
    help = 'Export all data from RDS to S3 as JSON for migration'

    def add_arguments(self, parser):
        parser.add_argument('--bucket', type=str, default=settings.ATTACHMENTS_BUCKET)
        parser.add_argument('--key', type=str, default='migration/export.json')
        parser.add_argument('--host', type=str, required=True)
        parser.add_argument('--dbname', type=str, required=True)
        parser.add_argument('--user', type=str, required=True)
        parser.add_argument('--password', type=str, required=True)
        parser.add_argument('--port', type=str, default='5432')

    def handle(self, *args, **options):
        bucket = options['bucket']
        key = options['key']

        self.stdout.write(f'Connecting to RDS at {options["host"]}...')

        conn = psycopg2.connect(
            host=options['host'],
            dbname=options['dbname'],
            user=options['user'],
            password=options['password'],
            port=options['port'],
            connect_timeout=30,
        )

        self.stdout.write(f'Exporting to s3://{bucket}/{key} ...')

        data = {}
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT tablename FROM pg_tables
                WHERE schemaname = 'public'
                ORDER BY tablename
            """)
            tables = [r['tablename'] for r in cur.fetchall()]
            self.stdout.write(f'Found tables: {tables}')

            for table in tables:
                cur.execute(f'SELECT * FROM {table}')
                rows = [dict(r) for r in cur.fetchall()]
                data[table] = rows
                self.stdout.write(f'  {table}: {len(rows)} records')

        conn.close()

        payload = json.dumps(data, default=str)

        s3 = boto3.client('s3', region_name=settings.AWS_REGION)
        s3.put_object(Bucket=bucket, Key=key, Body=payload.encode('utf-8'))

        self.stdout.write(self.style.SUCCESS('Done! Download with:'))
        self.stdout.write(f'  aws s3 cp s3://{bucket}/{key} export.json')
