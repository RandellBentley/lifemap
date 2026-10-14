from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from journal.serializers import MediaAssetSerializer

from . import units
from .models import Goal, Measurement, Metric, Milestone
from .progress import metric_progress

DECIMAL = {"max_digits": 30, "decimal_places": 10}


class MetricSerializer(serializers.ModelSerializer):
    """Start/target values are read and written in the metric's display unit."""

    start_value = serializers.DecimalField(**DECIMAL, allow_null=True, required=False)
    target_value = serializers.DecimalField(**DECIMAL, allow_null=True, required=False)
    progress = serializers.SerializerMethodField()

    class Meta:
        model = Metric
        fields = ["id", "goal", "name", "kind", "unit", "mode", "start_value", "target_value", "position",
                  "progress", "created_at"]
        read_only_fields = ["goal", "created_at"]
        extra_kwargs = {"unit": {"required": False}}  # defaults per kind (weight -> lb, distance -> mi, ...)

    def validate(self, data):
        kind = data.get("kind", getattr(self.instance, "kind", None))
        unit = data.get("unit", getattr(self.instance, "unit", None)) or units.DEFAULT_UNIT.get(kind, "")
        if kind == "money":
            unit = unit.upper()
        if error := units.validate_unit(kind, unit):
            raise serializers.ValidationError({"unit": error})
        if self.instance and kind != self.instance.kind and self.instance.measurements.exists():
            raise serializers.ValidationError({"kind": "Can’t change the kind of a metric that has readings."})
        data["unit"] = unit
        for field in ("start_value", "target_value"):
            if field in data:
                data[field] = units.to_base(kind, unit, data[field])
        return data

    def to_representation(self, metric):
        out = super().to_representation(metric)
        for field in ("start_value", "target_value"):
            out[field] = units.from_base(metric.kind, metric.unit, getattr(metric, field))
        return out

    def get_progress(self, metric):
        p = metric_progress(metric, list(metric.measurements.all()))
        for field in ("current", "start", "target", "change"):
            p[field] = units.from_base(metric.kind, metric.unit, p[field])
        return p


class MeasurementSerializer(serializers.ModelSerializer):
    """`value` is in the metric's display unit."""

    value = serializers.DecimalField(**DECIMAL)
    milestone = serializers.SerializerMethodField()

    class Meta:
        model = Measurement
        fields = ["id", "metric", "value", "recorded_on", "note", "milestone", "created_at"]
        read_only_fields = ["metric", "created_at"]

    def _metric(self):
        return self.instance.metric if isinstance(self.instance, Measurement) else self.context["metric"]

    def validate_value(self, value):
        metric = self._metric()
        return units.to_base(metric.kind, metric.unit, value)

    def to_representation(self, measurement):
        out = super().to_representation(measurement)
        out["value"] = units.from_base(measurement.metric.kind, measurement.metric.unit, measurement.value)
        return out

    def get_milestone(self, measurement):
        m = measurement.milestone
        return {"id": str(m.id), "title": m.title} if m else None


class ReadingSerializer(serializers.Serializer):
    """A milestone's value for one metric; null clears it."""

    metric = serializers.UUIDField()
    value = serializers.DecimalField(**DECIMAL, allow_null=True)


def first_media(manager, context):
    asset = next(iter(manager.all()), None)  # uses the prefetched list when there is one
    return MediaAssetSerializer(asset, context=context).data if asset else None


class GoalSerializer(serializers.ModelSerializer):
    photo = serializers.SerializerMethodField()
    milestone_count = serializers.SerializerMethodField()
    metrics = MetricSerializer(many=True, read_only=True)

    class Meta:
        model = Goal
        fields = [
            "id", "title", "description", "starts_on", "reward", "achieved_on",
            "photo", "milestone_count", "metrics", "created_at", "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]

    def validate(self, data):
        starts_on = data.get("starts_on", getattr(self.instance, "starts_on", None))
        achieved_on = data.get("achieved_on", getattr(self.instance, "achieved_on", None))
        if starts_on and achieved_on and achieved_on < starts_on:
            raise serializers.ValidationError({"achieved_on": "A goal can't be achieved before it starts."})
        return data

    def get_photo(self, goal):
        return first_media(goal.photos, self.context)

    def get_milestone_count(self, goal):
        count = getattr(goal, "milestone_count", None)
        return count if count is not None else goal.milestones.count()


class MilestoneSerializer(serializers.ModelSerializer):
    media = serializers.SerializerMethodField()
    measurements = serializers.SerializerMethodField()
    # Write-only: [{"metric": id, "value": 168.2 | null}] in each metric's display unit.
    readings = ReadingSerializer(many=True, write_only=True, required=False)

    class Meta:
        model = Milestone
        fields = ["id", "goal", "title", "description", "occurred_on", "media", "measurements", "readings",
                  "created_at", "updated_at"]
        read_only_fields = ["goal", "created_at", "updated_at"]

    def get_media(self, milestone):
        return first_media(milestone.media, self.context)

    def get_measurements(self, milestone):
        return [
            {"id": str(m.id), "metric": str(m.metric_id),
             "value": units.from_base(m.metric.kind, m.metric.unit, m.value)}
            for m in milestone.measurements.all()
        ]

    def validate_readings(self, readings):
        goal = self.context.get("goal") or getattr(self.instance, "goal", None)
        metrics = {m.id: m for m in goal.metrics.all()} if goal else {}
        for r in readings:
            if r["metric"] not in metrics:
                raise serializers.ValidationError("Each reading must be for one of this goal’s metrics.")
            r["metric"] = metrics[r["metric"]]
        return readings

    @transaction.atomic
    def create(self, validated_data):
        readings = validated_data.pop("readings", [])
        milestone = super().create(validated_data)
        self._apply_readings(milestone, readings)
        return milestone

    @transaction.atomic
    def update(self, instance, validated_data):
        readings = validated_data.pop("readings", None)
        milestone = super().update(instance, validated_data)
        if milestone.occurred_on:  # readings follow the milestone's date
            milestone.measurements.update(recorded_on=milestone.occurred_on)
        if readings is not None:
            self._apply_readings(milestone, readings)
        return milestone

    def _apply_readings(self, milestone, readings):
        for r in readings:
            metric = r["metric"]
            if r["value"] is None:
                Measurement.objects.filter(milestone=milestone, metric=metric).delete()
                continue
            Measurement.objects.update_or_create(
                milestone=milestone,
                metric=metric,
                defaults={
                    "user": milestone.user,
                    "value": units.to_base(metric.kind, metric.unit, r["value"]),
                    "recorded_on": milestone.occurred_on or timezone.localdate(),
                },
            )
