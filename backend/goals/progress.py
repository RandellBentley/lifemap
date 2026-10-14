"""Where a metric stands, computed from its readings (all values in base units)."""

from decimal import Decimal

from .models import Metric


def metric_progress(metric, measurements):
    """
    measurements: the metric's readings ordered by (recorded_on, created_at).

    latest: current = most recent reading; start = start_value, else the first reading.
    total:  current = start_value (default 0) + the sum of all readings.
    progress is the share of the way from start to target (0..1), in either direction;
    weight 180 -> 165 counts down, sessions 0 -> 100 counts up.
    """
    values = [m.value for m in measurements]
    if metric.mode == Metric.Mode.LATEST:
        current = values[-1] if values else None
        start = metric.start_value if metric.start_value is not None else (values[0] if values else None)
    else:
        start = metric.start_value if metric.start_value is not None else Decimal("0")
        current = start + sum(values, Decimal("0"))

    target = metric.target_value
    progress = reached = None
    if None not in (current, start, target):
        if target == start:
            progress = 1.0 if current == target else 0.0
        else:
            progress = float(min(max((current - start) / (target - start), Decimal("0")), Decimal("1")))
        reached = current <= target if target < start else current >= target

    return {
        "current": current,
        "start": start,
        "target": target,
        "change": current - start if None not in (current, start) else None,
        "direction": "down" if None not in (target, start) and target < start else "up",
        "progress": progress,
        "reached": reached,
        "count": len(values),
        "last_recorded_on": measurements[-1].recorded_on.isoformat() if measurements else None,
    }
