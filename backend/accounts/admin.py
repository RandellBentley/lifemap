from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    fieldsets = BaseUserAdmin.fieldsets + (("Profile", {"fields": ("display_name", "cognito_sub")}),)
    list_display = ("username", "email", "display_name", "is_staff")
