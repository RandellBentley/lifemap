from django.contrib import admin

from .models import Entry, MediaAsset, Tag


class MediaInline(admin.TabularInline):
    model = MediaAsset
    extra = 0
    fields = ("kind", "status", "original_filename", "s3_key", "position")
    readonly_fields = ("kind", "status", "original_filename", "s3_key")


@admin.register(Entry)
class EntryAdmin(admin.ModelAdmin):
    list_display = ("title", "user", "occurred_on", "created_at")
    list_filter = ("occurred_on",)
    search_fields = ("title", "body")
    filter_horizontal = ("tags",)
    inlines = [MediaInline]


@admin.register(Tag)
class TagAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "user")
    search_fields = ("name",)


@admin.register(MediaAsset)
class MediaAssetAdmin(admin.ModelAdmin):
    list_display = ("id", "kind", "status", "user", "entry", "created_at")
    list_filter = ("kind", "status")
