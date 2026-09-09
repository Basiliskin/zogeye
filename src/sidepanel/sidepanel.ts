// src/sidepanel/sidepanel.ts
import { Analyzer } from "../application/analyzer.js";
import { RuleRegistry } from "../application/rule-registry.js";
import type {
  AnalysisContext,
  Finding,
  Report,
  Severity,
} from "../domain/models.js";

const analyzer = new Analyzer(new RuleRegistry());

const output = document.getElementById("output") as HTMLDivElement;
const networkButton = document.getElementById("scan-network");
const clearButton = document.getElementById("clear-network");
const filesInput = document.getElementById("files") as HTMLInputElement | null;
const filedropHint = document.getElementById("filedrop-hint");

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

networkButton?.addEventListener("click", async () => {
  try {
    const tabId = await activeTabId();

    if (tabId == null) {
      renderState("No active tab", "Focus a browser tab and try again.");
      return;
    }

    renderLoading("Analyzing captured network facts…");

    const report = (await chrome.runtime.sendMessage({
      type: "api-qa/get-report",
      tabId,
    })) as Report | undefined;

    if (!report) {
      renderState(
        "No response",
        "The background service worker did not reply.",
      );
      return;
    }

    renderReport(report);
  } catch (error) {
    renderState("Network analysis failed", String(error));
  }
});

clearButton?.addEventListener("click", async () => {
  try {
    const tabId = await activeTabId();

    if (tabId == null) {
      return;
    }

    await chrome.runtime.sendMessage({
      type: "api-qa/clear",
      tabId,
    });

    renderState(
      "Network facts cleared",
      "Captured fetch / XHR / sendBeacon data for the active tab was reset.",
    );
  } catch (error) {
    renderState("Clear failed", String(error));
  }
});

filesInput?.addEventListener("change", async (event) => {
  const input = event.target as HTMLInputElement;
  const fileList = input.files;

  if (!fileList?.length) {
    return;
  }

  renderLoading("Scanning project files…");

  const contexts: AnalysisContext[] = [];
  let fileCount = 0;
  let dependencyCount = 0;
  let processed = 0;

  const MAX_FILES = 2000;

  for (const file of Array.from(fileList)) {
    if (processed >= MAX_FILES) {
      break;
    }

    const path = (file as { webkitRelativePath?: string }).webkitRelativePath || file.name;

    if (/(^|\/)(node_modules|dist|build|coverage|\.git)\//.test(path)) {
      continue;
    }

    if (!/\.(cjs|mjs|js|jsx|ts|tsx|html|json|vue|svelte)$/i.test(path)) {
      continue;
    }

    if (/package-lock\.json$|yarn\.lock$|pnpm-lock\.yaml$/i.test(path)) {
      continue;
    }

    if (file.size > 512 * 1024) {
      continue;
    }

    const content = await file.text();

    processed += 1;
    fileCount += 1;

    if (path.endsWith("package.json")) {
      try {
        const pkg = JSON.parse(content);
        const deps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
        } as Record<string, unknown>;

        for (const [name, range] of Object.entries(deps)) {
          contexts.push({
            dependency: {
              name,
              range: String(range),
              source: path,
            },
          });

          dependencyCount += 1;
        }
      } catch {
        // ignore malformed package.json
      }

      continue;
    }

    contexts.push({
      file: {
        path,
        content,
      },
    });
  }

  if (filedropHint) {
    filedropHint.textContent = `Scanned ${fileCount} file${fileCount === 1 ? "" : "s"}, ${dependencyCount} dependenc${dependencyCount === 1 ? "y" : "ies"}`;
  }

  const findings = analyzer.analyzeContexts(contexts);

  renderReport(
    analyzer.createReport(findings, {
      requests: 0,
      files: fileCount,
      dependencies: dependencyCount,
    }),
  );
});

async function activeTabId(): Promise<number | undefined> {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  return tabs[0]?.id;
}

function clear(): void {
  output.textContent = "";
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  if (className) {
    node.className = className;
  }

  if (text != null) {
    node.textContent = text;
  }

  return node;
}

function renderLoading(message: string): void {
  clear();

  const state = el("div", "state");
  state.append(el("div", "spinner"), el("span", undefined, message));
  output.append(state);
}

function renderState(title: string, detail: string): void {
  clear();

  const state = el("div", "state");
  state.innerHTML =
    '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>';
  state.append(el("strong", undefined, title), el("span", undefined, detail));
  output.append(state);
}

function renderReport(report: Report): void {
  clear();

  const meta = el("div", "results-meta");
  meta.append(
    el("h2", undefined, "Review results"),
    el(
      "time",
      undefined,
      new Date(report.generatedAt).toLocaleString(),
    ),
  );
  output.append(meta);

  output.append(
    summaryGrid([
      ["Risk score", String(report.riskScore)],
      ["Exposure", report.exposure, true],
      ["Findings", String(report.findings.length)],
      ["Requests", String(report.facts.requests), false, true],
      ["Files", String(report.facts.files), false, true],
      ["Dependencies", String(report.facts.dependencies), false, true],
    ]),
  );

  if (!report.findings.length) {
    const ok = el("div", "state");
    ok.innerHTML =
      '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
    ok.append(
      el("strong", undefined, "No deterministic findings"),
      el("span", undefined, "Nothing flagged by the current rule set."),
    );
    output.append(ok);
    return;
  }

  const list = el("div", "findings");
  list.style.marginTop = "12px";

  const sorted = [...report.findings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );

  for (const finding of sorted) {
    list.append(findingCard(finding));
  }

  output.append(list);
}

function summaryGrid(
  entries: Array<[string, string, boolean?, boolean?]>,
): HTMLElement {
  const grid = el("div", "summary");

  for (const [label, value, isBadge, small] of entries) {
    const cell = el("div", "stat");
    cell.append(el("div", "stat-label", label));

    if (isBadge) {
      const wrap = el("div", "stat-value");
      wrap.append(badge(value as Severity, value));
      cell.append(wrap);
    } else {
      cell.append(el("div", small ? "stat-value sm" : "stat-value", value));
    }

    grid.append(cell);
  }

  return grid;
}

function badge(severity: string, label: string): HTMLElement {
  const known = ["info", "low", "medium", "high", "critical"].includes(severity)
    ? severity
    : "info";

  return el("span", `badge sev-${known}`, label);
}

function findingCard(finding: Finding): HTMLElement {
  const known = ["info", "low", "medium", "high", "critical"].includes(
    finding.severity,
  )
    ? finding.severity
    : "info";

  const card = el("div", "finding");
  card.style.color = `var(--sev-${known}-fg)`;

  const head = el("div", "finding-head");
  head.append(
    badge(finding.severity, finding.severity),
    el("span", "finding-title", finding.title),
    el("span", "finding-rule", finding.ruleId),
  );
  card.append(head);

  card.append(el("p", "finding-details", finding.details));

  if (finding.evidence) {
    const evidence = el("div", "finding-evidence");

    if (/^https?:\/\//i.test(finding.evidence)) {
      const link = el("a", undefined, finding.evidence);
      link.href = finding.evidence;
      link.target = "_blank";
      link.rel = "noreferrer noopener";
      evidence.append(link);
    } else {
      evidence.textContent = finding.evidence;
    }

    card.append(evidence);
  }

  return card;
}
