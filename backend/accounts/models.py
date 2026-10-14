from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    # Stable Cognito identifier ("sub" claim). Emails can change; sub never does.
    cognito_sub = models.CharField(max_length=64, unique=True, null=True, blank=True)
    display_name = models.CharField(max_length=150, blank=True)

    def __str__(self):
        return self.email or self.username
