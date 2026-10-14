"""
Units for goal metrics. Every value is stored in its kind's base unit (kg, m, seconds, ...)
and converted to the metric's chosen display unit on the way in and out, so switching a
weight goal from lb to kg just re-renders. Money is never converted between currencies.
"""

import re
from decimal import Decimal

KINDS = {
    # kind: {display unit: factor to base unit}; None means "any label" (count) or "currency code" (money)
    "count": None,
    "weight": {"kg": Decimal("1"), "lb": Decimal("0.45359237")},
    "distance": {"km": Decimal("1000"), "mi": Decimal("1609.344"), "m": Decimal("1")},
    "duration": {"h": Decimal("3600"), "min": Decimal("60")},
    "money": None,
    "percent": {"%": Decimal("1")},
}

DEFAULT_UNIT = {"count": "times", "weight": "lb", "distance": "mi", "duration": "h", "money": "USD", "percent": "%"}

CURRENCY = re.compile(r"^[A-Z]{3}$")


def validate_unit(kind, unit):
    """Return an error message, or None if `unit` is valid for `kind`."""
    if kind not in KINDS:
        return f"Unknown kind “{kind}”."
    if kind == "count":
        return None if 0 < len(unit.strip()) <= 32 else "Name what you’re counting, e.g. “study sessions”."
    if kind == "money":
        return None if CURRENCY.match(unit) else "Use a 3-letter currency code, e.g. USD or EUR."
    return None if unit in KINDS[kind] else f"Use one of: {', '.join(KINDS[kind])}."


def factor(kind, unit):
    units = KINDS[kind]
    return units[unit] if units else Decimal("1")


def to_base(kind, unit, value):
    return None if value is None else Decimal(value) * factor(kind, unit)


def from_base(kind, unit, value):
    """
    Display-unit value as a float, rounded to 4 decimals: enough for any unit here (0.0001 h is
    under half a second) and it hides conversion residue, so 171 lb reads back as 171.
    """
    if value is None:
        return None
    return round(float(Decimal(value) / factor(kind, unit)), 4)
