"""Graph connectivity checker — detect orphans and disconnected records.

Checks for:
  - Experiments not assigned to any project or direction
  - Directions not assigned to any project
  - Experiments with broken parent_id references
  - Projects with no directions or experiments
  - Findings with no valid evidence experiments
"""

from __future__ import annotations

from sonde.models.health import HealthData, HealthIssue


def check_orphan_experiments(data: HealthData) -> list[HealthIssue]:
    """Flag experiments not linked to a project or direction."""
    issues: list[HealthIssue] = []

    for exp in data.experiments:
        status = exp.get("status", "")
        if status in ("superseded",):
            continue  # Skip superseded

        has_direction = bool(exp.get("direction_id"))
        has_project = bool(exp.get("project_id"))
        exp_id = exp.get("id", "")

        if not has_direction and not has_project:
            issues.append(
                HealthIssue(
                    category="graph",
                    severity="warning",
                    message=(
                        f"{exp_id} has no project or direction — floating in the knowledge graph"
                    ),
                    record_id=exp_id,
                    fix=f"sonde update {exp_id} --project PROJ-XXX",
                    penalty=2,
                )
            )
        elif has_direction and not has_project:
            # Check if the direction has a project we can inherit from
            dir_id = exp.get("direction_id")
            dir_project = None
            for d in data.directions:
                if d.get("id") == dir_id:
                    dir_project = d.get("project_id")
                    break
            if dir_project:
                issues.append(
                    HealthIssue(
                        category="graph",
                        severity="info",
                        message=(
                            f"{exp_id} should inherit project {dir_project} from direction {dir_id}"
                        ),
                        record_id=exp_id,
                        fix=f"sonde update {exp_id} --project {dir_project}",
                        penalty=1,
                    )
                )

    return issues


def check_orphan_directions(data: HealthData) -> list[HealthIssue]:
    """Flag directions not assigned to any project."""
    issues: list[HealthIssue] = []

    for d in data.directions:
        if not d.get("project_id"):
            d_id = d.get("id", "")
            issues.append(
                HealthIssue(
                    category="graph",
                    severity="warning",
                    message=f"{d_id} has no parent project",
                    record_id=d_id,
                    fix=f"sonde direction update {d_id} --project PROJ-XXX",
                    penalty=2,
                )
            )

    return issues


def check_broken_parent_refs(data: HealthData) -> list[HealthIssue]:
    """Flag experiments with parent_id pointing to non-existent experiments."""
    issues: list[HealthIssue] = []

    exp_ids = {exp.get("id") for exp in data.experiments}

    for exp in data.experiments:
        parent = exp.get("parent_id")
        if parent and parent not in exp_ids:
            exp_id = exp.get("id", "")
            issues.append(
                HealthIssue(
                    category="graph",
                    severity="error",
                    message=(
                        f"{exp_id} references parent {parent}"
                        " which does not exist — broken tree link"
                    ),
                    record_id=exp_id,
                    penalty=5,
                )
            )

    return issues


def check_empty_projects(data: HealthData) -> list[HealthIssue]:
    """Flag active projects with no directions or experiments."""
    issues: list[HealthIssue] = []

    for proj in data.projects:
        if proj.get("status") in ("archived", "completed"):
            continue

        proj_id = proj.get("id", "")
        proj_name = proj.get("name", "")

        # Check if any directions or experiments reference this project
        has_directions = any(d.get("project_id") == proj_id for d in data.directions)
        has_experiments = any(e.get("project_id") == proj_id for e in data.experiments)

        if not has_directions and not has_experiments:
            issues.append(
                HealthIssue(
                    category="graph",
                    severity="warning",
                    message=(
                        f"{proj_id} ({proj_name}) is active but has no directions or experiments"
                    ),
                    record_id=proj_id,
                    penalty=2,
                )
            )

    return issues


def check_finding_evidence(data: HealthData) -> list[HealthIssue]:
    """Flag findings whose evidence experiments don't exist."""
    issues: list[HealthIssue] = []

    exp_ids = {exp.get("id") for exp in data.experiments}

    for f in data.findings:
        evidence = f.get("evidence", []) or []
        missing = [eid for eid in evidence if eid not in exp_ids]
        if missing:
            f_id = f.get("id", "")
            issues.append(
                HealthIssue(
                    category="graph",
                    severity="error",
                    message=f"{f_id} references missing evidence experiments: {', '.join(missing)}",
                    record_id=f_id,
                    penalty=3,
                )
            )

    return issues


def check_direction_experiment_mismatch(data: HealthData) -> list[HealthIssue]:
    """Flag experiments whose project_id differs from their direction's project_id."""
    issues: list[HealthIssue] = []
    dir_projects = {d.get("id"): d.get("project_id") for d in data.directions}

    for exp in data.experiments:
        exp_project = exp.get("project_id")
        dir_id = exp.get("direction_id")
        if not dir_id or not exp_project:
            continue
        dir_project = dir_projects.get(dir_id)
        if dir_project and exp_project != dir_project:
            exp_id = exp.get("id", "")
            issues.append(
                HealthIssue(
                    category="graph",
                    severity="warning",
                    message=(
                        f"{exp_id} is in project {exp_project} but its"
                        f" direction {dir_id} is in project {dir_project}"
                    ),
                    record_id=exp_id,
                    fix=f"sonde update {exp_id} --project {dir_project}",
                    penalty=2,
                )
            )
    return issues
