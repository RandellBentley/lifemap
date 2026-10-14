from django.urls import path

from . import views

urlpatterns = [
    path("me/", views.me, name="auth-me"),
    path("login/", views.login, name="auth-login"),
    path("callback/", views.callback, name="auth-callback"),
    path("logout/", views.logout, name="auth-logout"),
]
