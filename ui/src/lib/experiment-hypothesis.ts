import type { Experiment, ExperimentSummary } from "@/types/sonde";

function isTopLevelSectionHeader(line: string): boolean {
  return /^##\s+\S/.test(line);
}

function isNamedSectionHeader(line: string, section: string): boolean {
  return new RegExp(`^##\\s+${section}\\s*$`, "i").test(line.trim());
}

export function extractHypothesisSection(content: string | null | undefined): string | null {
  if (!content?.trim()) return null;

  const lines = content.split(/\r?\n/);
  let collecting = false;
  const collected: string[] = [];

  for (const line of lines) {
    if (!collecting && isNamedSectionHeader(line, "Hypothesis")) {
      collecting = true;
      continue;
    }
    if (collecting && isTopLevelSectionHeader(line)) {
      break;
    }
    if (collecting) {
      collected.push(line);
    }
  }

  const text = collected.join("\n").trim();
  return text || null;
}

export function effectiveExperimentHypothesis(
  exp: Pick<Experiment, "hypothesis" | "content"> | null | undefined,
): string | null {
  if (!exp) return null;
  if (exp.hypothesis?.trim()) return exp.hypothesis.trim();
  return extractHypothesisSection(exp.content);
}

export function stripHypothesisSection(content: string | null | undefined): string | null {
  if (!content?.trim()) return null;

  const lines = content.split(/\r?\n/);
  const kept: string[] = [];
  let skipping = false;

  for (const line of lines) {
    if (!skipping && isNamedSectionHeader(line, "Hypothesis")) {
      skipping = true;
      continue;
    }
    if (skipping && isTopLevelSectionHeader(line)) {
      skipping = false;
    }
    if (!skipping) {
      kept.push(line);
    }
  }

  const cleaned = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return cleaned || null;
}

export function normalizeExperimentHypothesis<T extends ExperimentSummary | Experiment>(exp: T): T {
  const hypothesis = effectiveExperimentHypothesis(exp);
  if (hypothesis === exp.hypothesis) return exp;
  return { ...exp, hypothesis } as T;
}
