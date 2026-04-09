# SKILL.md — Sonde Project Report

Use this skill when a project is ready for final synthesis, when creating or updating a project report, or before running `sonde project close`.

The project report is the curated endpoint of a project: it moves knowledge upward from experiments, findings, notes, artifacts, direction takeaways, and project takeaways into one stable PDF. Sonde stores the rendered PDF and the editable LaTeX entrypoint; the work repo builds them.

---

## Required workflow

```bash
# 1. Gather the scoped project context.
sonde project brief PROJ-001 --json
sonde project show PROJ-001 --json
sonde artifact list PROJ-001 --json

# 2. Pull the local notebooks/artifacts you need to read and grep.
sonde pull -p <program>
sonde project pull PROJ-001 --artifacts all

# 3. Grep the local record set until you understand the story.
rg -n "project_id: PROJ-001|finding:|hypothesis:|direction_id:" \
  .sonde/experiments .sonde/directions .sonde/projects

# 4. Scaffold the standard LaTeX entrypoint, then edit in the work repo.
sonde project report-template PROJ-001

# 5. Build locally. Sonde does not compile LaTeX.
latexmk -pdf -halt-on-error -interaction=nonstopmode \
  -jobname=project-report -outdir=build report/main.tex

# 6. Check for unfinished drafting markers before upload.
rg -n "TODO|TBD|FIXME|placeholder|__.*__" report/main.tex

# 7. Register or update the canonical report artifacts only after review.
sonde project report PROJ-001 \
  --pdf build/project-report.pdf \
  --tex report/main.tex \
  -d "Final curated report for PROJ-001"

# 8. Close only after the PDF is registered.
sonde project close PROJ-001
```

Do not close projects with `sonde project update --status completed`. Use `sonde project close`; it requires a registered PDF report.

To edit an existing report locally:

```bash
sonde project pull PROJ-001 --artifacts all
# Report artifacts appear under .sonde/projects/PROJ-001/reports/
```

---

## How to approach the paper

Write this as a curated scientific paper, not a chronological notebook dump.

1. Start from the project brief and promoted findings.
2. Pull the program notebooks and project artifacts locally, then grep until you know which experiments actually support the final claims.
3. Read the highest-signal complete experiments, the highest-value failed experiments, and the artifacts attached to them.
4. If a claim depends on code, config, or a specific implementation change, inspect the git provenance for the exact generating experiment before writing the claim.
5. Only after the evidence is understood should you draft the abstract, introduction, results, and discussion.

Use this investigation pattern while writing:

```bash
# Enumerate the project story.
sonde project brief PROJ-001 --json
sonde project show PROJ-001 --json

# Pull and grep the local notebooks.
sonde pull -p <program>
sonde project pull PROJ-001 --artifacts all
rg -n "project_id: PROJ-001|finding:|hypothesis:|direction_id:" \
  .sonde/experiments .sonde/directions .sonde/projects

# Drill into the records that matter.
sonde show EXP-0042 --json
sonde show FIND-0007 --json
sonde show DIR-001 --json
sonde artifact list EXP-0042 --json
sonde artifact list PROJ-001 --json
```

If the report needs code-level explanation, use the stored git provenance:

```bash
# Read the generating experiment's provenance first.
sonde show EXP-0042 --json

# Then inspect the exact historical code or config in git.
git show <git_commit> --stat
git show <git_commit>:path/to/file
git grep -n "symbol_or_parameter" <git_commit> -- .
```

Do this whenever the paper makes a claim about an implementation detail, model change,
configuration choice, failure mode, or surprising behavior.

---

## Standard report structure

Default to a two-column scientific-paper layout unless the user gives a stronger project-specific template:

1. **Paper header + abstract** — project name, `PROJ-*`, program, status/date metadata, then a compact abstract stating the final answer, objective, and evidence base.
2. **Introduction** — project motivation, decision context, and scope.
3. **Research map** — directions, experiment families, promoted findings, and the narrative arc of the investigation.
4. **Methods and provenance** — datasets, model/config choices, important repo/commit/command provenance, validation methods, and units.
5. **Results** — claim-first subsections with the most important experiments, figures, and tables.
6. **Negative results and failure modes** — dead ends, abandoned hypotheses, known gotchas, failed runs that change how the next scientist should work.
7. **Discussion** — synthesis, caveats, confidence, and the operational/scientific meaning of the results.
8. **Conclusions and recommended actions** — what is now known, what should be operationalized, what is still unknown, and the next follow-up directions.
9. **Reproducibility appendix** — complete run table, commands, repo snapshots, artifact inventory, data locations, and environment notes.
10. **References** — papers, internal docs, datasets, and external URLs.

---

## LaTeX design rules

- Keep a single entrypoint named like `report/main.tex` in the work repo.
- Use a full-width paper header followed by a two-column body, like a compact scientific manuscript.
- Make the abstract earn its space: it should state the final answer, objective, and evidence base immediately.
- Prefer short sections with claim-first opening paragraphs.
- Write in polished scientific prose, not in chatty lab-note voice.
- Define acronyms on first use and keep terminology consistent across abstract, results, and conclusions.
- Put the takeaway in every figure/table caption; avoid captions like "Results".
- Put Sonde evidence IDs near the claim they support, for example `(\texttt{EXP-0042}, \texttt{FIND-0007})`.
- If a sentence depends on code or configuration provenance, cite the relevant Sonde record and describe the exact commit/config in Methods or the appendix.
- Use consistent units, UTC/ISO-like dates where exact time matters, and explicit geographic/domain bounds.
- Keep raw logs, exhaustive parameter dumps, and long experiment timelines in appendices.
- Do not paste every experiment narrative into the report. Curate the conclusion; preserve detail by citing Sonde IDs.
- Mark uncertain conclusions explicitly with confidence language and the evidence that would change the conclusion.
- Never upload a first draft. Read the LaTeX source and the compiled PDF end to end before registering the report.

---

## Quality bar before close

Before `sonde project close PROJ-001`, confirm:

- The PDF builds cleanly from the registered `.tex` entrypoint in the work repo.
- You have read the generated PDF front to back and fixed awkward spacing, broken sections, weak captions, and obviously rough phrasing.
- You have read the LaTeX source itself and removed placeholders, draft notes, duplicated thoughts, and unpolished wording.
- The abstract, discussion, and conclusions agree on the final answer.
- The executive summary states the final answer and caveats without requiring the reader to inspect experiments.
- Major complete/failed experiments are either synthesized in the main narrative or listed in the appendix.
- Every important claim has evidence behind it, and code-sensitive claims were checked against the generating experiment's git provenance.
- Important figures/tables are attached to experiments/projects or reproducible from commands in the appendix.
- Project takeaways and program-relevant conclusions have been updated where appropriate.

Use this preflight before upload:

```bash
latexmk -pdf -halt-on-error -interaction=nonstopmode \
  -jobname=project-report -outdir=build report/main.tex
rg -n "TODO|TBD|FIXME|placeholder|__.*__" report/main.tex
```

Only after that review should you run:

```bash
sonde project report PROJ-001 --pdf build/project-report.pdf --tex report/main.tex
sonde project close PROJ-001
```
