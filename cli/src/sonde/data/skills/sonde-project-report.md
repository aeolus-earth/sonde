# SKILL.md — Sonde Project Report

Use this skill when a project is ready for final synthesis, when creating or updating a project report, or before running `sonde project close`.

The project report is the curated endpoint of a project: it moves knowledge upward from experiments, findings, notes, artifacts, direction takeaways, and project takeaways into one stable PDF. Sonde stores the rendered PDF and the editable LaTeX entrypoint; the work repo builds them.

---

## Required workflow

```bash
# 1. Gather the scoped evidence.
sonde project brief PROJ-001 --json
sonde project show PROJ-001 --json
sonde artifact list PROJ-001 --json

# 2. Scaffold the standard LaTeX entrypoint, then edit/build in the work repo.
sonde project report-template PROJ-001

# Sonde does not compile LaTeX.
# Example only; use the repo's established build command.
latexmk -pdf -outdir=build report/main.tex

# 3. Register or update the canonical report artifacts.
sonde project report PROJ-001 \
  --pdf build/project-report.pdf \
  --tex report/main.tex \
  -d "Final curated report for PROJ-001"

# 4. Close only after the PDF is registered.
sonde project close PROJ-001
```

Do not close projects with `sonde project update --status completed`. Use `sonde project close`; it requires a registered PDF report.

To edit an existing report locally:

```bash
sonde project pull PROJ-001 --artifacts all
# Report artifacts appear under .sonde/projects/PROJ-001/reports/
```

---

## Standard report structure

Use this order unless the user gives a stronger project-specific template:

1. **Title page** — project name, `PROJ-*`, program, authors/agents, report date, report version, canonical Sonde link if available.
2. **Executive summary** — one page max: objective, final answer, confidence, highest-value results, major caveats, recommended next action.
3. **Project objective and scope** — the question, in/out of scope, why the project existed, what decision it supports.
4. **Research map** — directions, experiment families, key `EXP-*` / `DIR-*` / `FIND-*` IDs, and the narrative arc of the investigation.
5. **Methods and provenance** — datasets, model/config choices, important repo/commit/command provenance, validation methods, units.
6. **Curated results** — claim-first subsections; each important claim cites Sonde evidence IDs and points to key figures/tables/artifacts.
7. **Negative results and failure modes** — dead ends, abandoned hypotheses, known gotchas, failed runs that change how the next scientist should work.
8. **Conclusions and recommendations** — what is now known, what should be operationalized, what is still unknown, recommended follow-up directions.
9. **Reproducibility appendix** — complete run table, commands, repo snapshots, artifact inventory, data locations, environment notes.
10. **References** — papers, internal docs, datasets, external URLs.

---

## LaTeX design rules

- Keep a single entrypoint named like `report/main.tex` in the work repo.
- Prefer short sections with claim-first opening paragraphs.
- Put the takeaway in every figure/table caption; avoid captions like "Results".
- Put Sonde evidence IDs near the claim they support, for example `(\texttt{EXP-0042}, \texttt{FIND-0007})`.
- Use consistent units, UTC/ISO-like dates where exact time matters, and explicit geographic/domain bounds.
- Keep raw logs, exhaustive parameter dumps, and long experiment timelines in appendices.
- Do not paste every experiment narrative into the report. Curate the conclusion; preserve detail by citing Sonde IDs.
- Mark uncertain conclusions explicitly with confidence language and the evidence that would change the conclusion.

---

## Quality bar before close

Before `sonde project close PROJ-001`, confirm:

- The PDF builds from the registered `.tex` entrypoint in the work repo.
- The executive summary states the final answer and caveats without requiring the reader to inspect experiments.
- Major complete/failed experiments are either synthesized in the main narrative or listed in the appendix.
- Important figures/tables are attached to experiments/projects or reproducible from commands in the appendix.
- Project takeaways and program-relevant conclusions have been updated where appropriate.
