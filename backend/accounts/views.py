import logging
import secrets
from urllib.parse import urlencode

from django.conf import settings
from django.contrib.auth import login as django_login
from django.contrib.auth import logout as django_logout
from django.http import HttpResponseBadRequest, HttpResponseRedirect
from django.utils.http import url_has_allowed_host_and_scheme
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from . import cognito
from .models import User

log = logging.getLogger(__name__)

SESSION_OAUTH_KEY = "oauth_pending"


def _safe_next(value: str | None) -> str:
    """Only allow relative, same-site redirects after login."""
    if value and url_has_allowed_host_and_scheme(value, allowed_hosts=None) and value.startswith("/"):
        return value
    return "/"


@api_view(["GET"])
@permission_classes([AllowAny])
@ensure_csrf_cookie  # the SPA calls this first, so it also seeds the CSRF cookie
def me(request):
    user = request.user
    if not user.is_authenticated:
        return Response({"detail": "Not authenticated"}, status=401)
    return Response({"id": user.id, "email": user.email, "display_name": user.display_name or user.email})


@require_GET
def login(request):
    next_url = _safe_next(request.GET.get("next"))

    if settings.AUTH_MODE == "local":
        # Dev only: reuse Django admin's login form (create a user with `createsuperuser`).
        return HttpResponseRedirect(f"/api/admin/login/?{urlencode({'next': next_url})}")

    verifier, challenge = cognito.new_pkce_pair()
    state = secrets.token_urlsafe(32)
    request.session[SESSION_OAUTH_KEY] = {"state": state, "verifier": verifier, "next": next_url}
    return HttpResponseRedirect(cognito.authorize_url(state, challenge))


@require_GET
def callback(request):
    pending = request.session.pop(SESSION_OAUTH_KEY, None)
    if not pending or not secrets.compare_digest(pending["state"], request.GET.get("state", "")):
        return HttpResponseBadRequest("Login session expired or invalid. Please try again.")
    if "error" in request.GET:
        log.warning("Cognito returned error: %s", request.GET.get("error_description", request.GET["error"]))
        return HttpResponseRedirect("/")

    try:
        tokens = cognito.exchange_code(request.GET.get("code", ""), pending["verifier"])
        claims = cognito.verify_id_token(tokens["id_token"])
    except cognito.CognitoError:
        log.exception("Cognito login failed")
        return HttpResponseBadRequest("Login failed. Please try again.")

    user, _ = User.objects.get_or_create(
        cognito_sub=claims["sub"],
        defaults={"username": claims["sub"]},
    )
    # Keep profile fields in sync with Cognito on each login.
    user.email = claims.get("email", user.email)
    user.display_name = claims.get("name") or claims.get("given_name") or user.display_name
    user.save(update_fields=["email", "display_name"])

    django_login(request, user)  # rotates the session id
    return HttpResponseRedirect(pending["next"])


@api_view(["POST"])
@permission_classes([AllowAny])
def logout(request):
    django_logout(request)
    redirect_url = cognito.logout_url() if settings.AUTH_MODE == "cognito" else "/"
    return Response({"redirect_url": redirect_url})
