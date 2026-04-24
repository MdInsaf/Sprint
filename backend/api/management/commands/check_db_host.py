from django.core.management.base import BaseCommand
from django.conf import settings


class Command(BaseCommand):
    help = 'Print current DB host'

    def handle(self, *args, **options):
        db = settings.DATABASES['default']
        self.stdout.write(f"HOST: {db['HOST']}")
        self.stdout.write(f"USER: {db['USER']}")
        self.stdout.write(f"NAME: {db['NAME']}")
