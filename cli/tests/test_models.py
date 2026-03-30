"""Test Pydantic models validate correctly."""

import pytest
from pydantic import ValidationError

from sonde.models.experiment import ExperimentCreate


def test_experiment_create_minimal():
    exp = ExperimentCreate(program="weather-intervention", source="human/test")
    assert exp.program == "weather-intervention"
    assert exp.status == "open"
    assert exp.parameters == {}
    assert exp.tags == []
    assert exp.content is None


def test_experiment_create_content_only():
    """Content-first: an experiment can be just markdown with catalog metadata."""
    exp = ExperimentCreate(
        program="weather-intervention",
        source="human/test",
        status="complete",
        content=(
            "# Spectral bin CCN sweep\n\nRan CCN=1200 with spectral bin, saw 8% less enhancement."
        ),
        tags=["cloud-seeding", "spectral-bin"],
    )
    assert exp.content is not None
    assert "spectral bin" in exp.content.lower()
    assert exp.hypothesis is None
    assert exp.parameters == {}
    assert exp.finding is None


def test_experiment_create_full():
    exp = ExperimentCreate(
        program="weather-intervention",
        source="codex/task-abc",
        status="complete",
        hypothesis="Test hypothesis",
        parameters={"ccn": 1200, "scheme": "spectral_bin"},
        results={"precip_delta_pct": 5.8},
        finding="Some finding",
        tags=["cloud-seeding", "spectral"],
        related=["EXP-0001"],
    )
    assert exp.parameters["ccn"] == 1200
    assert exp.status == "complete"
    assert len(exp.tags) == 2


def test_experiment_create_invalid_status():
    with pytest.raises(ValidationError, match="status"):
        ExperimentCreate(
            program="weather-intervention",
            source="human/test",
            status="invalid",
        )


def test_experiment_null_coercion():
    """Database can return null for list/dict fields."""
    exp = ExperimentCreate.model_validate(
        {
            "program": "test",
            "source": "human/test",
            "tags": None,
            "parameters": None,
        }
    )
    assert exp.tags == []
    assert exp.parameters == {}
