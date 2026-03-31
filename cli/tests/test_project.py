"""Tests for the project entity — models, CLI commands."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from sonde.models.project import Project, ProjectCreate


class TestProjectModels:
    def test_create_minimal(self):
        p = ProjectCreate(program="nwp-development", name="GPU Port", source="human/test")
        assert p.status == "proposed"
        assert p.objective is None

    def test_create_full(self):
        p = ProjectCreate(
            program="nwp-development",
            name="GPU Port",
            objective="Port cloud microphysics to GPU",
            status="active",
            source="human/mason",
        )
        assert p.status == "active"
        assert p.objective == "Port cloud microphysics to GPU"

    def test_project_roundtrip(self):
        p = Project(
            id="PROJ-001",
            program="nwp-development",
            name="GPU Port",
            objective="Port microphysics",
            status="active",
            source="human/mason",
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        data = p.model_dump(mode="json")
        assert data["id"] == "PROJ-001"
        assert data["status"] == "active"
        p2 = Project(**data)
        assert p2.id == p.id

    def test_status_validation(self):
        with pytest.raises(ValueError):
            ProjectCreate(
                program="test",
                name="Bad",
                status="invalid",  # type: ignore
                source="test",
            )

    def test_project_inherits_create_fields(self):
        p = Project(
            id="PROJ-002",
            program="shared",
            name="Test",
            source="agent/test",
            status="proposed",
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        assert p.program == "shared"
        assert p.source == "agent/test"
