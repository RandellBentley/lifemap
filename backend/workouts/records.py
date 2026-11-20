"""
The PR board: PRs you log yourself plus PRs detected from workouts.

Detected PRs aren't stored: they're derived from workout sets on every read, so editing or
deleting a workout can never leave a stale PR behind. A made, weighted set of r reps counts
toward every rep target up to r (5 × 100 kg also means you can do 3 × 100 kg), and it's a PR
when it beats the best so far for that lift and target, from workouts or logged PRs alike.
Logged PRs always appear, in the one target they were logged for.
"""

from django.db.models import Prefetch

from journal.serializers import MediaAssetSerializer

from .models import REP_TARGETS, PersonalRecord, WorkoutSet


def pr_rows(user, media_queryset, context):
    """Every PR row, newest first: one per (logged PR or record-setting set, rep target)."""
    media = Prefetch("media", queryset=media_queryset)
    logged = PersonalRecord.objects.filter(user=user).select_related("exercise").prefetch_related(media)
    sets = (
        WorkoutSet.objects.filter(workout_exercise__workout__user=user, made=True, weight_kg__isnull=False, reps__gte=1)
        .select_related("workout_exercise__exercise", "workout_exercise__workout")
        .prefetch_related(media)
    )

    events = []  # (order key, record or set); replayed oldest first
    for r in logged:
        events.append(((r.achieved_on, r.created_at, 0, 0), r))
    for s in sets:
        we = s.workout_exercise
        events.append(((we.workout.performed_on, we.workout.created_at, we.position, s.position), s))
    events.sort(key=lambda e: e[0])

    best = {}  # (exercise id, target) -> best weight so far
    rows = []
    for _order, item in events:
        logged_pr = isinstance(item, PersonalRecord)
        exercise = item.exercise if logged_pr else item.workout_exercise.exercise
        targets = [item.reps] if logged_pr else [n for n in REP_TARGETS if n <= item.reps]
        for target in targets:
            key = (exercise.id, target)
            previous = best.get(key)
            # A set has to beat the best so far; a logged PR always shows.
            if not logged_pr and previous is not None and item.weight_kg <= previous:
                continue
            best[key] = item.weight_kg if previous is None else max(previous, item.weight_kg)
            rows.append(_row(item, exercise, target, context))
    rows.reverse()
    return rows


def _row(item, exercise, target, context):
    video = next(iter(item.media.all()), None)
    common = {
        "reps": target,
        "exercise": exercise.id,
        "exercise_name": exercise.name,
        "weight_kg": item.weight_kg,
        "video": MediaAssetSerializer(video, context=context).data if video else None,
    }
    if isinstance(item, PersonalRecord):
        return {**common, "key": f"{item.id}:{target}", "source": "logged", "source_id": item.id,
                "workout_id": None, "set_reps": item.reps, "achieved_on": item.achieved_on}
    workout = item.workout_exercise.workout
    # set_reps: the set itself, e.g. a 3-rep PR from a set of 5.
    return {**common, "key": f"{item.id}:{target}", "source": "workout", "source_id": item.id,
            "workout_id": workout.id, "set_reps": item.reps, "achieved_on": workout.performed_on}

