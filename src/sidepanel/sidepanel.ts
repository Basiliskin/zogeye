// src/sidepanel/sidepanel.ts
import { Analyzer } from "../application/analyzer.js";
import { RuleRegistry } from "../application/rule-registry.js";
import type { AnalysisContext, Report } from "../domain/models.js";

const analyzer = new Analyzer(new RuleRegistry());

const output = document.getElementById("output") as HTMLPreElement;
const networkButton = document.getElementById("scan-network");
const clearButton = document.getElementById("clear-network");
const filesInput = document.getElementById("files") as HTMLInputElement | null;

networkButton?.addEventListener("click", async () => {
  try {
    const tabId = await activeTabId();

    if (tabId == null) {
      render("No active tab.");
      return;
    }

    render("Analyzing captured network facts...");

    const report = await chrome.runtime.sendMessage({
      type: "api-qa/get-report",
      tabId,
    });

    if (!report) {
      render("No response from background service worker.");
      return;
    }

    render(report);
  } catch (error) {
    render(`Network analysis failed: ${String(error)}`);
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

    render("Cleared captured network facts for active tab.");
  } catch (error) {
    render(`Clear failed: ${String(error)}`);
  }
});

filesInput?.addEventListener("change", async (event) => {
  const input = event.target as HTMLInputElement;
  const fileList = input.files;

  if (!fileList?.length) {
    return;
  }

  render("Static scan started...");

  const contexts: AnalysisContext[] = [];
  let fileCount = 0;
  let dependencyCount = 0;
  let processed = 0;

  const MAX_FILES = 2000;

  for (const file of Array.from(fileList)) {
    if (processed >= MAX_FILES) {
      break;
    }

    const path = (file as any).webkitRelativePath || file.name;

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
      } catch {}

      continue;
    }

    contexts.push({
      file: {
        path,
        content,
      },
    });
  }

  const findings = analyzer.analyzeContexts(contexts);

  render(
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

function render(value: Report | string): void {
  if (typeof value === "string") {
    output.textContent = value;
    return;
  }

  const lines: string[] = [
    `Generated: ${new Date(value.generatedAt).toLocaleString()}`,
    `Risk score: ${value.riskScore}`,
    `Exposure: ${value.exposure}`,
    `Requests: ${value.facts.requests}`,
    `Files: ${value.facts.files}`,
    `Dependencies: ${value.facts.dependencies}`,
    "",
  ];

  if (!value.findings.length) {
    lines.push("No deterministic findings.");
  }

  for (const item of value.findings) {
    lines.push(
      `[${item.severity.toUpperCase()}] ${item.ruleId} ${item.title} :: ${item.details}` +
        (item.evidence ? ` :: ${item.evidence}` : ""),
    );
  }

  output.textContent = lines.join("\n");
}
