"""
Settings are driven entirely by environment variables so the same image runs
locally (docker compose) and on ECS. See .env.example for the full list.
"""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def env(name, default=None):
    return os.environ.get(name, default)


def env_bool(name, default=False):
    return env(name, str(default)).lower() in ("1", "true", "yes", "on")


def env_list(name, default=""):
    return [v.strip() for v in env(name, default).split(",") if v.strip()]


DEBUG = env_bool("DJANGO_DEBUG", False)
SECRET_KEY = env("DJANGO_SECRET_KEY", "dev-insecure-change-me" if DEBUG else None)
if not SECRET_KEY:
    raise RuntimeError("DJANGO_SECRET_KEY must be set when DEBUG is off")

ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")
CSRF_TRUSTED_ORIGINS = env_list("DJANGO_CSRF_TRUSTED_ORIGINS", "http://localhost:5173")

# Public URL of the app (the CloudFront domain in AWS, the Vite dev server locally).
APP_BASE_URL = env("APP_BASE_URL", "http://localhost:5173").rstrip("/")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "accounts",
    "journal",
    "goals",
]

MIDDLEWARE = [
    # First, so ALB health checks (Host = task IP) never hit ALLOWED_HOSTS validation.
    "config.middleware.HealthCheckMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

# Postgres when DATABASE_HOST is set (docker compose / RDS), SQLite otherwise.
if env("DATABASE_HOST"):
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "HOST": env("DATABASE_HOST"),
            "PORT": env("DATABASE_PORT", "5432"),
            "NAME": env("DATABASE_NAME", "lifemap"),
            "USER": env("DATABASE_USER", "lifemap"),
            "PASSWORD": env("DATABASE_PASSWORD", ""),
            "CONN_MAX_AGE": 60,
            "CONN_HEALTH_CHECKS": True,
            "OPTIONS": {"sslmode": env("DATABASE_SSLMODE", "prefer")},
        }
    }
else:
    DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": BASE_DIR / "db.sqlite3"}}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
AUTH_USER_MODEL = "accounts.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

# Everything Django serves lives under /api/ so one CloudFront behavior covers it.
STATIC_URL = "/api/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}

# --- Sessions & security -----------------------------------------------------
# The SPA and API share an origin, so a plain HttpOnly session cookie is all we need.
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_AGE = 60 * 60 * 24 * 14
CSRF_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_HTTPONLY = False  # the SPA reads it to send X-CSRFToken

if not DEBUG:
    # CloudFront -> ALB (HTTPS) sets X-Forwarded-Proto.
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = 60 * 60 * 24 * 365
    SECURE_CONTENT_TYPE_NOSNIFF = True

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.UserRateThrottle"],
    "DEFAULT_THROTTLE_RATES": {"user": "2000/hour"},
}

# --- Auth ----------------------------------------------------------------------
# "local": sign in through Django admin (dev only). "cognito": OIDC via Cognito managed login.
AUTH_MODE = env("AUTH_MODE", "local" if DEBUG else "cognito")
COGNITO_REGION = env("COGNITO_REGION", env("AWS_REGION", "us-east-1"))
COGNITO_USER_POOL_ID = env("COGNITO_USER_POOL_ID", "")
COGNITO_CLIENT_ID = env("COGNITO_CLIENT_ID", "")
COGNITO_CLIENT_SECRET = env("COGNITO_CLIENT_SECRET", "")
COGNITO_DOMAIN = env("COGNITO_DOMAIN", "").rstrip("/")  # https://<prefix>.auth.<region>.amazoncognito.com

# --- Media storage ---------------------------------------------------------------
AWS_REGION = env("AWS_REGION", "us-east-1")
MEDIA_BUCKET = env("MEDIA_BUCKET", "lifemap-media-local")
# Local MinIO: the server talks to http://minio:9000, but presigned URLs must use a
# host the browser can reach, so they are signed against the public endpoint.
AWS_S3_ENDPOINT_URL = env("AWS_S3_ENDPOINT_URL") or None
AWS_S3_PUBLIC_ENDPOINT_URL = env("AWS_S3_PUBLIC_ENDPOINT_URL") or AWS_S3_ENDPOINT_URL

MEDIA_MAX_IMAGE_BYTES = int(env("MEDIA_MAX_IMAGE_BYTES", 50 * 1024**2))
MEDIA_MAX_VIDEO_BYTES = int(env("MEDIA_MAX_VIDEO_BYTES", 2 * 1024**3))
MEDIA_UPLOAD_EXPIRES = 15 * 60
MEDIA_URL_TTL = 60 * 60

# When set, media URLs are CloudFront signed URLs (production). Otherwise S3 presigned GETs.
CLOUDFRONT_MEDIA_BASE_URL = env("CLOUDFRONT_MEDIA_BASE_URL", "").rstrip("/")
CLOUDFRONT_KEY_PAIR_ID = env("CLOUDFRONT_KEY_PAIR_ID", "")
CLOUDFRONT_PRIVATE_KEY = env("CLOUDFRONT_PRIVATE_KEY", "")
# A PEM is multi-line, which env files handle poorly; the single-host setup mounts it as a file.
if not CLOUDFRONT_PRIVATE_KEY and env("CLOUDFRONT_PRIVATE_KEY_FILE"):
    CLOUDFRONT_PRIVATE_KEY = Path(env("CLOUDFRONT_PRIVATE_KEY_FILE")).read_text()

# Whether an async processor (the Lambda) will generate thumbnails. If not, uploads
# go straight to "ready" and the UI falls back to originals.
MEDIA_PROCESSING_ENABLED = env_bool("MEDIA_PROCESSING_ENABLED", False)
# Shared secret the media-processing Lambda uses to report results.
INTERNAL_API_TOKEN = env("INTERNAL_API_TOKEN", "")

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": env("LOG_LEVEL", "INFO")},
}
