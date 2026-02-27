from rest_framework.permissions import BasePermission


def _normalized_role(profile):
    return (getattr(profile, "role", "") or "").strip().lower()


def _is_manager(profile):
    return _normalized_role(profile) in {"manager", "super admin"}


def _is_qa(profile):
    return _normalized_role(profile) == "qa"


class IsManager(BasePermission):
    """Allow access only to users with profile.role == 'Manager'."""

    def has_permission(self, request, view):
        profile = getattr(request.user, "profile", None)
        return bool(
            request.user
            and getattr(request.user, "is_authenticated", False)
            and profile
            and _is_manager(profile)
        )


class IsManagerOrReadOnly(BasePermission):
    """Allow reads for authenticated users; write requires Manager."""

    def has_permission(self, request, view):
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return bool(request.user and getattr(request.user, "is_authenticated", False))

        profile = getattr(request.user, "profile", None)
        return bool(
            request.user
            and getattr(request.user, "is_authenticated", False)
            and profile
            and _is_manager(profile)
        )


class PublicReadManagerWrite(BasePermission):
    """Allow anyone to read; only managers can create/update/delete."""

    def has_permission(self, request, view):
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return True

        profile = getattr(request.user, "profile", None)
        return bool(
            request.user
            and getattr(request.user, "is_authenticated", False)
            and profile
            and _is_manager(profile)
        )


class IsManagerOrSelf(BasePermission):
    """Allow managers full access; allow users to update themselves."""

    def has_permission(self, request, view):
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return True

        profile = getattr(request.user, "profile", None)
        if (
            request.user
            and getattr(request.user, "is_authenticated", False)
            and profile
            and _is_manager(profile)
        ):
            return True

        if request.method in ("PUT", "PATCH"):
            member_id = getattr(view, "kwargs", {}).get("member_id")
            return bool(request.user and str(request.user.id) == str(member_id))

        return False


class IsOwnerOrManager(BasePermission):
    """
    Allow access to managers or to the user who owns the object (expects the object to have an owner attribute or owner_id).
    """

    def has_permission(self, request, view):
        return bool(request.user and getattr(request.user, "is_authenticated", False))

    def has_object_permission(self, request, view, obj):
        profile = getattr(request.user, "profile", None)
        if profile and (_is_manager(profile) or _is_qa(profile)):
            return True
        owner_id = getattr(obj, "owner_id", None) or getattr(obj, "owner_id_id", None)
        return str(owner_id) == str(request.user.id)
