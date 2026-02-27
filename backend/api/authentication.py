from rest_framework.authentication import SessionAuthentication


class SessionMemberAuthentication(SessionAuthentication):
    """
    Use Django's session authentication to bind requests to Django auth users.
    """

    def authenticate(self, request):
        return super().authenticate(request)
