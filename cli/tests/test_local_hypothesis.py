from __future__ import annotations

from sonde.local import effective_hypothesis, extract_section_text, remove_section


def test_extract_section_text_reads_multiline_hypothesis() -> None:
    content = """# Title

## Hypothesis
- Warm cache cuts compile time
- Model reuse keeps gradients stable

## Method
Run the GPU backward pass.
"""

    assert extract_section_text(content, "Hypothesis") == (
        "- Warm cache cuts compile time\n- Model reuse keeps gradients stable"
    )


def test_effective_hypothesis_falls_back_to_content() -> None:
    content = """## Hypothesis
Multiple alternatives:
- warm cache path
- fused backward path
"""

    assert effective_hypothesis(content, None) == (
        "Multiple alternatives:\n- warm cache path\n- fused backward path"
    )


def test_remove_section_strips_only_hypothesis_block() -> None:
    content = """# Title

## Hypothesis
This is the hypothesis.

## Method
Run the thing.

## Results
It worked.
"""

    assert (
        remove_section(content, "Hypothesis")
        == """# Title

## Method
Run the thing.

## Results
It worked.
"""
    )
