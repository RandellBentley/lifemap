from django.contrib import admin

from .models import Goal, Milestone


class MilestoneInline(admin.TabularInline):
    model = Milestone
    extra = 0
    fields = ("title", "occurred_on")


@admin.register(Goal)
class GoalAdmin(admin.ModelAdmin):
    list_display = ("title", "user", "starts_on", "achieved_on")
    search_fields = ("title", "description")
    inlines = [MilestoneInline]
