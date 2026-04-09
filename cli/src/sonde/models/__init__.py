"""Pydantic models — the schema for all Aeolus records.

Naming convention across the hierarchy:

    Entity      Headline         Body           Status values
    ----------  ---------------  -------------  ---------------------------------
    Project     objective        description    proposed/active/paused/completed/archived
    Direction   question         context        proposed/active/paused/completed/abandoned
    Experiment  hypothesis       content        open/running/complete/failed/superseded

The headline is always a one-liner. The body is optional long-form markdown
shown in `sonde show` and `sonde brief`.
"""

from sonde.models.direction import Direction, DirectionCreate
from sonde.models.experiment import Experiment, ExperimentCreate
from sonde.models.finding import Finding, FindingCreate
from sonde.models.question import Question, QuestionCreate
from sonde.models.review import (
    ExperimentReview,
    ExperimentReviewCreate,
    ExperimentReviewEntry,
    ExperimentReviewEntryCreate,
)

__all__ = [
    "Direction",
    "DirectionCreate",
    "Experiment",
    "ExperimentCreate",
    "ExperimentReview",
    "ExperimentReviewCreate",
    "ExperimentReviewEntry",
    "ExperimentReviewEntryCreate",
    "Finding",
    "FindingCreate",
    "Question",
    "QuestionCreate",
]
