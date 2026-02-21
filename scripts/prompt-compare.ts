/**
 * Prompt eval report comparison tool.
 * Usage: npx tsx scripts/prompt-compare.ts <report-a.json> <report-b.json>
 *
 * Handles both v1 (layout-only) and v2 (combined layout + narrative) reports.
 * Exit code 1 if any dimension regressed by >= 1.0 points (CI-gatable).
 */

import { readFileSync } from "fs";

// ---------------------------------------------------------------------------
// Raw report shapes (JSON as written by prompt-eval.ts)
// ---------------------------------------------------------------------------

interface V1LayoutResult {
  id: string;
  pass: boolean;
  overlapScore: number;
  outOfBounds: number;
  latencyMs?: number;
  description?: string;
}

interface V1Report {
  promptVersion: string;
  model: string;
  timestamp: string;
  results: V1LayoutResult[];
}

interface V2LayoutResult {
  id: string;
  pass: boolean;
  overlapScore: number;
  outOfBounds: number;
  latencyMs?: number;
  description?: string;
}

interface V2DimensionScore {
  dimension: string;
  score: number;
  reasoning?: string;
}

interface V2NarrativeResult {
  id: string;
  description?: string;
  judgeResult: {
    dimensions: V2DimensionScore[];
    overallScore: number;
  } | null;
}

interface V2Report {
  $schema: string;
  promptVersion: string;
  model: string;
  judgeModel?: string;
  timestamp: string;
  layout?: {
    results: V2LayoutResult[];
  };
  narrative?: {
    results: V2NarrativeResult[];
  };
}

type RawReport = V1Report | V2Report;

// ---------------------------------------------------------------------------
// Normalized internal representation
// ---------------------------------------------------------------------------

interface NormalizedLayoutResult {
  id: string;
  pass: boolean;
  overlapScore: number;
  outOfBounds: number;
}

interface NormalizedNarrativeDimension {
  dimension: string;
  score: number;
}

interface NormalizedNarrativeResult {
  id: string;
  dimensions: NormalizedNarrativeDimension[];
}

interface NormalizedReport {
  path: string;
  promptVersion: string;
  model: string;
  timestamp: string;
  layoutResults: NormalizedLayoutResult[];
  narrativeResults: NormalizedNarrativeResult[];
}

// ---------------------------------------------------------------------------
// Comparison output types
// ---------------------------------------------------------------------------

interface ComparisonRow {
  scenarioId: string;
  dimension: string;
  scoreA: number;
  scoreB: number;
  delta: number; // scoreB - scoreA (positive = improvement)
  regression: boolean; // true if delta <= -1.0
}

interface LayoutComparisonRow {
  scenarioId: string;
  passA: boolean;
  passB: boolean;
  overlapDelta: number;
  oobDelta: number;
  regression: boolean; // true if pass->fail
}

interface AggregateRow {
  dimension: string;
  avgA: number;
  avgB: number;
  avgDelta: number;
}

interface ComparisonSummary {
  reportA: { path: string; promptVersion: string; model: string; timestamp: string };
  reportB: { path: string; promptVersion: string; model: string; timestamp: string };
  rows: ComparisonRow[];
  layoutComparison: LayoutComparisonRow[];
  aggregates: AggregateRow[];
  regressionCount: number;
  improvementCount: number;
}

// ---------------------------------------------------------------------------
// Report loading + normalization
// ---------------------------------------------------------------------------

function isV2Report(raw: RawReport): raw is V2Report {
  return "$schema" in raw && (raw as V2Report).$schema === "eval-report-v2";
}

function loadReport(filePath: string): NormalizedReport {
  let fileContent: string;
  try {
    fileContent = readFileSync(filePath, "utf8");
  } catch (err) {
    const isNotFound = err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT";
    throw new Error(isNotFound ? `File not found: ${filePath}` : `Failed to read ${filePath}: ${err}`);
  }

  let raw: RawReport;
  try {
    raw = JSON.parse(fileContent) as RawReport;
  } catch (err) {
    throw new Error(`Invalid JSON in ${filePath}: ${err}`);
  }

  if (isV2Report(raw)) {
    const layoutResults: NormalizedLayoutResult[] = (raw.layout?.results ?? []).map((r) => ({
      id: r.id,
      pass: r.pass,
      overlapScore: r.overlapScore,
      outOfBounds: r.outOfBounds,
    }));

    const narrativeResults: NormalizedNarrativeResult[] = (raw.narrative?.results ?? [])
      .filter((r) => r.judgeResult !== null)
      .map((r) => ({
        id: r.id,
        dimensions: (r.judgeResult?.dimensions ?? []).map((d) => ({
          dimension: d.dimension,
          score: d.score,
        })),
      }));

    return {
      path: filePath,
      promptVersion: raw.promptVersion,
      model: raw.model,
      timestamp: raw.timestamp,
      layoutResults,
      narrativeResults,
    };
  }

  // v1: layout-only report (results[] at top level)
  const v1 = raw as V1Report;
  const layoutResults: NormalizedLayoutResult[] = v1.results.map((r) => ({
    id: r.id,
    pass: r.pass,
    overlapScore: r.overlapScore,
    outOfBounds: r.outOfBounds,
  }));

  return {
    path: filePath,
    promptVersion: v1.promptVersion,
    model: v1.model,
    timestamp: v1.timestamp,
    layoutResults,
    narrativeResults: [],
  };
}

// ---------------------------------------------------------------------------
// Comparison logic
// ---------------------------------------------------------------------------

function compareReports(a: NormalizedReport, b: NormalizedReport): ComparisonSummary {
  // Build narrative comparison rows (join by scenario ID)
  const narrativeMapB = new Map<string, NormalizedNarrativeResult>(b.narrativeResults.map((r) => [r.id, r]));
  const rows: ComparisonRow[] = [];

  for (const scenA of a.narrativeResults) {
    const scenB = narrativeMapB.get(scenA.id);
    if (!scenB) continue;

    const dimMapB = new Map<string, number>(scenB.dimensions.map((d) => [d.dimension, d.score]));
    for (const dimA of scenA.dimensions) {
      const scoreB = dimMapB.get(dimA.dimension);
      if (scoreB === undefined) continue;
      const delta = scoreB - dimA.score;
      rows.push({
        scenarioId: scenA.id,
        dimension: dimA.dimension,
        scoreA: dimA.score,
        scoreB,
        delta,
        regression: delta <= -1.0,
      });
    }
  }

  // Build layout comparison rows (join by scenario ID)
  const layoutMapB = new Map<string, NormalizedLayoutResult>(b.layoutResults.map((r) => [r.id, r]));
  const layoutComparison: LayoutComparisonRow[] = [];

  for (const la of a.layoutResults) {
    const lb = layoutMapB.get(la.id);
    if (!lb) continue;
    layoutComparison.push({
      scenarioId: la.id,
      passA: la.pass,
      passB: lb.pass,
      overlapDelta: lb.overlapScore - la.overlapScore,
      oobDelta: lb.outOfBounds - la.outOfBounds,
      regression: la.pass && !lb.pass,
    });
  }

  // Compute per-dimension averages across all scenarios
  const dimScoresA = new Map<string, number[]>();
  const dimScoresB = new Map<string, number[]>();
  for (const row of rows) {
    const a = dimScoresA.get(row.dimension) ?? [];
    a.push(row.scoreA);
    dimScoresA.set(row.dimension, a);
    const bArr = dimScoresB.get(row.dimension) ?? [];
    bArr.push(row.scoreB);
    dimScoresB.set(row.dimension, bArr);
  }

  const avg = (arr: number[]) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0);
  const aggregates: AggregateRow[] = Array.from(dimScoresA.keys()).map((dim) => {
    const avgA = avg(dimScoresA.get(dim) ?? []);
    const avgB = avg(dimScoresB.get(dim) ?? []);
    return { dimension: dim, avgA, avgB, avgDelta: avgB - avgA };
  });

  const narrativeRegressions = rows.filter((r) => r.regression).length;
  const layoutRegressions = layoutComparison.filter((r) => r.regression).length;
  const regressionCount = narrativeRegressions + layoutRegressions;
  const improvementCount = rows.filter((r) => r.delta >= 1.0).length;

  return {
    reportA: { path: a.path, promptVersion: a.promptVersion, model: a.model, timestamp: a.timestamp },
    reportB: { path: b.path, promptVersion: b.promptVersion, model: b.model, timestamp: b.timestamp },
    rows,
    layoutComparison,
    aggregates,
    regressionCount,
    improvementCount,
  };
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

function fmtDelta(d: number): string {
  const sign = d > 0 ? "+" : "";
  return `${sign}${d.toFixed(1)}`;
}

function printComparisonTable(summary: ComparisonSummary): void {
  const { reportA: rA, reportB: rB } = summary;
  console.log(`\nPrompt Comparison: ${rA.promptVersion} (${rA.model}) vs ${rB.promptVersion} (${rB.model})`);
  console.log(`Report A: ${rA.path}`);
  console.log(`Report B: ${rB.path}`);

  // --- Narrative section ---
  if (summary.rows.length > 0) {
    console.log("\n=== NARRATIVE SCENARIOS ===");
    console.log(
      "Scenario".padEnd(26) + "Dimension".padEnd(22) + "A".padStart(4) + "B".padStart(5) + "Delta".padStart(8),
    );
    console.log("-".repeat(67));

    for (const row of summary.rows) {
      const regressionFlag = row.regression ? "  *** REGRESSION" : "";
      console.log(
        row.scenarioId.padEnd(26) +
          row.dimension.padEnd(22) +
          String(row.scoreA).padStart(4) +
          String(row.scoreB).padStart(5) +
          fmtDelta(row.delta).padStart(8) +
          regressionFlag,
      );
    }
  }

  // --- Layout section ---
  if (summary.layoutComparison.length > 0) {
    console.log("\n=== LAYOUT SCENARIOS ===");
    console.log(
      "Scenario".padEnd(26) + "Pass(A)".padEnd(9) + "Pass(B)".padEnd(9) + "Overlap(d)".padEnd(12) + "OOB(d)".padEnd(8),
    );
    console.log("-".repeat(67));

    for (const row of summary.layoutComparison) {
      const regressionFlag = row.regression ? "  *** REGRESSION" : "";
      const overlapStr = row.overlapDelta === 0 ? "0" : fmtDelta(row.overlapDelta);
      const oobStr = row.oobDelta === 0 ? "0" : fmtDelta(row.oobDelta);
      console.log(
        row.scenarioId.padEnd(26) +
          (row.passA ? "PASS" : "FAIL").padEnd(9) +
          (row.passB ? "PASS" : "FAIL").padEnd(9) +
          overlapStr.padEnd(12) +
          oobStr.padEnd(8) +
          regressionFlag,
      );
    }
  }

  // --- Aggregates section ---
  if (summary.aggregates.length > 0) {
    console.log("\n=== AGGREGATES ===");
    console.log("Dimension".padEnd(26) + "Avg(A)".padStart(8) + "Avg(B)".padStart(8) + "Delta".padStart(8));
    console.log("-".repeat(52));

    for (const agg of summary.aggregates) {
      console.log(
        agg.dimension.padEnd(26) +
          agg.avgA.toFixed(1).padStart(8) +
          agg.avgB.toFixed(1).padStart(8) +
          fmtDelta(agg.avgDelta).padStart(8),
      );
    }
  }

  // --- Summary line ---
  const unchangedNarrative = summary.rows.filter((r) => Math.abs(r.delta) < 1.0).length;
  const unchangedLayout = summary.layoutComparison.filter((r) => !r.regression && r.passA === r.passB).length;
  const unchanged = unchangedNarrative + unchangedLayout;

  console.log(
    `\nSummary: ${summary.improvementCount} improvement(s), ${summary.regressionCount} regression(s), ${unchanged} unchanged`,
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  if (args.length !== 2) {
    console.error("Usage: npx tsx scripts/prompt-compare.ts <report-a.json> <report-b.json>");
    process.exit(2);
  }

  let reportA: NormalizedReport;
  let reportB: NormalizedReport;

  try {
    reportA = loadReport(args[0]);
  } catch (err) {
    console.error(`[compare] Failed to load report A: ${err}`);
    process.exit(2);
  }

  try {
    reportB = loadReport(args[1]);
  } catch (err) {
    console.error(`[compare] Failed to load report B: ${err}`);
    process.exit(2);
  }

  const summary = compareReports(reportA, reportB);
  printComparisonTable(summary);

  if (summary.regressionCount > 0) {
    console.error(`\n[compare] FAILED: ${summary.regressionCount} regression(s) detected`);
    process.exit(1);
  }

  console.log("\n[compare] No regressions detected.");
}

main();
