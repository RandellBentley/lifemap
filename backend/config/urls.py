from django.contrib import admin
from django.urls import include, path

from .features import config

urlpatterns = [
    path("api/admin/", admin.site.urls),
    path("api/auth/", include("accounts.urls")),
    path("api/config/", config, name="config"),
    path("api/", include("journal.urls")),
    path("api/", include("goals.urls")),
]
