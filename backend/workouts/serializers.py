from django.db import transaction
from rest_framework import serializers

from journal.models import MediaAsset
from journal.serializers import MediaAssetSerializer
from journal.uploads import delete_media

from .models import WEIGHT, Exercise, ProgressReport, Workout, WorkoutExercise, WorkoutSet


def _user(serializer):
    return serializer.context["request"].user


class ExerciseSerializer(serializers.ModelSerializer):
    use_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Exercise
        fields = ["id", "name", "use_count", "created_at"]
        read_only_fields = ["created_at"]

    def validate_name(self, value):
        name = " ".join(value.split())  # trim and collapse inner whitespace
        if not name:
            raise serializers.ValidationError("Name the exercise.")
        clash = Exercise.objects.filter(user=_user(self), name__iexact=name)
        if self.instance:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError("You already have an exercise with that name.")
        return name


class UserExerciseField(serializers.PrimaryKeyRelatedField):
    """Only the requesting user's exercises are valid choices."""

    def get_queryset(self):
        return Exercise.objects.filter(user=self.context["request"].user)


class SetSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(required=False)  # present = update that set; absent = new set
    reps = serializers.IntegerField(min_value=0, max_value=10_000)
    weight_kg = serializers.DecimalField(**WEIGHT, min_value=0, allow_null=True, required=False, coerce_to_string=False)
    video = serializers.SerializerMethodField()

    class Meta:
        model = WorkoutSet
        fields = ["id", "reps", "weight_kg", "video"]

    def get_video(self, workout_set):
        asset = next(iter(workout_set.media.all()), None)
        return MediaAssetSerializer(asset, context=self.context).data if asset else None


class WorkoutExerciseSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(required=False)
    exercise = UserExerciseField()
    exercise_name = serializers.CharField(source="exercise.name", read_only=True)
    sets = SetSerializer(many=True)

    class Meta:
        model = WorkoutExercise
        fields = ["id", "exercise", "exercise_name", "sets"]

    def validate_sets(self, sets):
        if not sets:
            raise serializers.ValidationError("Add at least one set.")
        return sets


class WorkoutSerializer(serializers.ModelSerializer):
    """
    Written as one nested document: {performed_on, notes, exercises: [{exercise, sets: [...]}]}.
    On update, exercises and sets carrying an `id` are updated in place (keeping set videos);
    ones without are created; existing ones left out are deleted, along with their videos.
    """

    exercises = WorkoutExerciseSerializer(many=True)

    class Meta:
        model = Workout
        fields = ["id", "performed_on", "notes", "exercises", "created_at", "updated_at"]
        read_only_fields = ["created_at", "updated_at"]

    def validate_exercises(self, exercises):
        if not exercises:
            raise serializers.ValidationError("Add at least one exercise.")
        return exercises

    @transaction.atomic
    def create(self, validated_data):
        exercises = validated_data.pop("exercises")
        workout = Workout.objects.create(**validated_data)
        self._sync(workout, exercises)
        return workout

    @transaction.atomic
    def update(self, instance, validated_data):
        exercises = validated_data.pop("exercises", None)
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.save()
        if exercises is not None:
            self._sync(instance, exercises)
        return instance

    def _sync(self, workout, exercises):
        existing = {we.id: we for we in workout.exercises.prefetch_related("sets")}
        kept_exercises = set()
        for position, data in enumerate(exercises):
            we = self._pick(existing, data.get("id"), "exercise")
            if we is None:
                we = WorkoutExercise.objects.create(workout=workout, exercise=data["exercise"], position=position)
            else:
                we.exercise, we.position = data["exercise"], position
                we.save(update_fields=["exercise", "position"])
            kept_exercises.add(we.id)
            self._sync_sets(we, data["sets"])
        removed = [we for we_id, we in existing.items() if we_id not in kept_exercises]
        delete_media(MediaAsset.objects.filter(workout_set__workout_exercise__in=removed))
        WorkoutExercise.objects.filter(pk__in=[we.pk for we in removed]).delete()

    def _sync_sets(self, workout_exercise, sets):
        existing = {s.id: s for s in workout_exercise.sets.all()}
        kept = set()
        for position, data in enumerate(sets):
            ws = self._pick(existing, data.get("id"), "set")
            if ws is None:
                ws = WorkoutSet(workout_exercise=workout_exercise)
            ws.position, ws.reps, ws.weight_kg = position, data["reps"], data.get("weight_kg")
            ws.save()
            kept.add(ws.id)
        removed = [s_id for s_id in existing if s_id not in kept]
        delete_media(MediaAsset.objects.filter(workout_set__in=removed))
        WorkoutSet.objects.filter(pk__in=removed).delete()

    @staticmethod
    def _pick(existing, obj_id, label):
        if obj_id is None:
            return None
        if obj_id not in existing:
            raise serializers.ValidationError({"exercises": [f"Unknown {label} id {obj_id} for this workout."]})
        return existing[obj_id]


class ProgressReportSerializer(serializers.ModelSerializer):
    body_weight_kg = serializers.DecimalField(
        **WEIGHT, min_value=0, allow_null=True, required=False, coerce_to_string=False
    )
    photos = serializers.SerializerMethodField()

    class Meta:
        model = ProgressReport
        fields = ["id", "recorded_on", "body_weight_kg", "notes", "photos", "created_at", "updated_at"]
        read_only_fields = ["created_at", "updated_at"]

    def get_photos(self, report):
        return MediaAssetSerializer(report.photos.all(), many=True, context=self.context).data
