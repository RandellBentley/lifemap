"""
Goal markers for the timeline, calendar and day views: a goal's start, each dated
milestone, and the day a goal was achieved. Undated milestones have no place in time.
"""

from django.db.models import Prefetch, Q
from django.utils.text import slugify

from journal.models import MediaAsset
from journal.serializers import MediaAssetSerializer

from .models import Goal, Milestone

_MEDIA = MediaAsset.objects.prefetch_related("tags").order_by("-created_at")


def _thumb(manager):
    asset = next(iter(manager.all()), None)
    return MediaAssetSerializer().get_urls(asset)["thumb"] if asset and asset.status != "failed" else None


def _in_range(day, start, end):
    return (start is None or day >= start) and (end is None or day <= end)


def goal_markers(user, start=None, end=None, tag=None, q=None):
    """Markers sorted by date (then start, milestones, achievement within a day)."""
    goals = Goal.objects.filter(user=user).prefetch_related(Prefetch("photos", queryset=_MEDIA))
    milestones = (
        Milestone.objects.filter(user=user, occurred_on__isnull=False)
        .select_related("goal")
        .prefetch_related(Prefetch("media", queryset=_MEDIA))
    )
    if start:
        milestones = milestones.filter(occurred_on__gte=start)
    if end:
        milestones = milestones.filter(occurred_on__lte=end)
    if tag:
        # Matches when the goal's or milestone's photo carries the tag.
        slug = slugify(tag)
        goals = goals.filter(photos__tags__slug=slug)
        milestones = milestones.filter(media__tags__slug=slug)
    if q:
        goals = goals.filter(Q(title__icontains=q) | Q(description__icontains=q))
        milestones = milestones.filter(
            Q(title__icontains=q) | Q(description__icontains=q) | Q(goal__title__icontains=q)
        )

    markers = []
    for goal in goals.distinct():
        base = {"goal": {"id": str(goal.id), "title": goal.title}, "milestone": None, "thumb": _thumb(goal.photos)}
        if goal.starts_on and _in_range(goal.starts_on, start, end):
            markers.append({**base, "kind": "goal_start", "date": goal.starts_on, "title": goal.title})
        if goal.achieved_on and _in_range(goal.achieved_on, start, end):
            markers.append({**base, "kind": "goal_achieved", "date": goal.achieved_on, "title": goal.title,
                            "reward": goal.reward})
    for m in milestones.distinct():
        markers.append({
            "kind": "milestone",
            "date": m.occurred_on,
            "title": m.title,
            "goal": {"id": str(m.goal_id), "title": m.goal.title},
            "milestone": {"id": str(m.id)},
            "thumb": _thumb(m.media),
        })

    order = {"goal_start": 0, "milestone": 1, "goal_achieved": 2}
    markers.sort(key=lambda mk: (mk["date"], order[mk["kind"]], mk["title"]))
    for mk in markers:
        mk["date"] = mk["date"].isoformat()
    return markers
