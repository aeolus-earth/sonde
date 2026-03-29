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


def test_experiment_create_hypothesis_max_length():
    with pytest.raises(ValidationError):
        ExperimentCreate(
            program="weather-intervention",
            source="human/test",
            hypothesis="x" * 5001,
        )


def test_experiment_create_finding_max_length():
    with pytest.raises(ValidationError):
        ExperimentCreate(
            program="weather-intervention",
            source="human/test",
            finding="x" * 10001,
        )
