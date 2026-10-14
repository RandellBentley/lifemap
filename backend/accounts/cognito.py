"""
Minimal OIDC client for Cognito's authorization-code + PKCE flow.

Django is the confidential client: it exchanges the code server-side (with the
client secret), verifies the ID token, then issues its own session cookie. The
browser never sees Cognito tokens.
"""

import base64
import hashlib
import secrets
from functools import lru_cache
from urllib.parse import urlencode

import jwt
import requests
from django.conf import settings


class CognitoError(Exception):
    pass


def issuer() -> str:
    return f"https://cognito-idp.{settings.COGNITO_REGION}.amazonaws.com/{settings.COGNITO_USER_POOL_ID}"


def redirect_uri() -> str:
    return f"{settings.APP_BASE_URL}/api/auth/callback/"


def new_pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


def authorize_url(state: str, code_challenge: str) -> str:
    params = {
        "response_type": "code",
        "client_id": settings.COGNITO_CLIENT_ID,
        "redirect_uri": redirect_uri(),
        "scope": "openid email profile",
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    return f"{settings.COGNITO_DOMAIN}/oauth2/authorize?{urlencode(params)}"


def logout_url() -> str:
    params = {"client_id": settings.COGNITO_CLIENT_ID, "logout_uri": f"{settings.APP_BASE_URL}/"}
    return f"{settings.COGNITO_DOMAIN}/logout?{urlencode(params)}"


def exchange_code(code: str, code_verifier: str) -> dict:
    resp = requests.post(
        f"{settings.COGNITO_DOMAIN}/oauth2/token",
        data={
            "grant_type": "authorization_code",
            "client_id": settings.COGNITO_CLIENT_ID,
            "code": code,
            "redirect_uri": redirect_uri(),
            "code_verifier": code_verifier,
        },
        auth=(settings.COGNITO_CLIENT_ID, settings.COGNITO_CLIENT_SECRET),
        timeout=10,
    )
    if resp.status_code != 200:
        raise CognitoError(f"Token exchange failed: {resp.status_code} {resp.text[:200]}")
    return resp.json()


@lru_cache(maxsize=1)
def _jwks_client() -> jwt.PyJWKClient:
    # PyJWKClient caches keys and refetches on unknown "kid" (key rotation).
    return jwt.PyJWKClient(f"{issuer()}/.well-known/jwks.json", cache_keys=True)


def verify_id_token(id_token: str) -> dict:
    try:
        signing_key = _jwks_client().get_signing_key_from_jwt(id_token)
        claims = jwt.decode(
            id_token,
            signing_key.key,
            algorithms=["RS256"],
            audience=settings.COGNITO_CLIENT_ID,
            issuer=issuer(),
            options={"require": ["exp", "iat", "sub", "token_use"]},
        )
    except jwt.PyJWTError as exc:
        raise CognitoError(f"Invalid ID token: {exc}") from exc
    if claims.get("token_use") != "id":
        raise CognitoError("Expected an ID token")
    return claims
