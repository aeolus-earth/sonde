# Sonde Review — Critique, Resolve, and Trust Results

Use this skill when an experiment needs a real review thread instead of an
informal chat comment. Reviews are how Sonde captures scientific critique:
method issues, baseline problems, overclaimed conclusions, missing provenance,
and artifact-quality concerns.

Typical triggers:

- "Review this experiment"
- "Pressure-test the conclusion before we rely on it"
- "Make sure the figures and findings are actually defensible"
- "Resolve the review items on EXP-0042"

---

## Review workflow

```bash
# Read the full record first.
sonde show EXP-0001 --json
sonde artifact list EXP-0001 --json

# Open or extend the review thread.
sonde experiment review add EXP-0001 "Control run uses different resolution than the treatment run."
sonde experiment review add EXP-0001 -f critique.md

# Inspect the current thread.
sonde experiment review show EXP-0001
sonde experiment review show EXP-0001 --json

# Resolve when the critique has actually been addressed.
sonde experiment review resolve EXP-0001 "Re-ran baseline at matched 25 km resolution and updated Figure 3."

# Reopen if later evidence shows the resolution was incomplete.
sonde experiment review reopen EXP-0001 "Confidence language still overstates the evidence."
```

Canonical form is `sonde experiment review <verb>`. Use that form in prompts and
automation.

---

## What excellent review looks like

Focus on the scientific substance, not on stylistic nits.

- Check whether the baseline and controls are valid.
- Check whether the experiment body actually states enough method to reproduce
  the run.
- Check whether the quantitative result in `## Results` matches the short
  finding sentence.
- Check whether the claimed interpretation is stronger than the evidence.
- Check whether the git provenance, linked evidence, and attached artifacts are
  enough for a future scientist to verify the claim.
- Check whether the attached figures, GIFs, PDFs, or tables are readable,
  captioned, and honest about uncertainty.

Apply the same long-horizon standard during review: two years later, could a new
scientist read this record and understand what was tried, why it was tried,
what happened, and whether the conclusion was actually warranted?

Good review comments are concrete and fixable.

Bad:

```text
This seems questionable.
```

Better:

```text
The comparison is not valid yet: EXP-0001 uses spectral-bin at 25 km, but the
bulk baseline cited in the finding is from a 10 km run. Re-run or replace the
baseline before keeping the 8.2% claim.
```

---

## Review before trust

Use a review when any of these are true:

- the experiment will feed a project report or operational takeaway
- the result is surprising, negative, or high-stakes
- the conclusion depends on a specific code/config change
- the artifact is hard to read and could mislead the next agent
- the record will be handed off to someone else to continue

The review thread is where you record the critique. The experiment record is
where you record the corrected state after the critique is addressed.

---

## What to update while resolving a review

Most reviews should lead to direct record cleanup:

```bash
sonde update EXP-0001 --method "Re-ran matched 25 km bulk control."
sonde update EXP-0001 --results "Spectral bin remains 8.2% lower than matched bulk baseline."
sonde update EXP-0001 --finding "At 25 km, spectral bin shows 8.2% lower enhancement than matched bulk control."
sonde artifact update ART-0001 -d "Matched-resolution comparison; Figure 3 shows the corrected baseline."
```

Resolve the review only after the experiment and artifacts reflect the fix.

---

## Artifact review bar

If the experiment has attachments, review them as part of the science:

- Prefer polished PNGs, GIFs, PDFs, and concise CSV summaries over raw code
  dumps.
- Captions should say what the reader should conclude, not just name the file.
- Axes, units, legends, and panel labels should be interpretable without
  hunting through the experiment notes.
- If a raw notebook or config file is attached, there should usually also be a
  readable summary artifact showing the result.

An artifact is good when a teammate can open it and understand the result in a
few seconds.
