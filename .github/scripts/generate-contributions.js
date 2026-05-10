// SPDX-FileCopyrightText: 2025 SternXD
// SPDX-FileCopyrightText: 2026 Vishrut2403
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from "fs";
import path from "path";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
if (!GITHUB_TOKEN) throw new Error("Missing GITHUB_TOKEN environment variable");

const USERNAME = "Vishrut2403";
const API_BASE = "https://api.github.com";
const MANUAL_FILE = path.resolve(".github/manual_contributions.yml");
const OUT_FILE = path.resolve("docs/contributions.md");

async function ghRequest(urlPath, params = {}, retries = 3) {
  const url = new URL(API_BASE + urlPath);
  Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, String(v)));

  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if ((res.status === 403 || res.status === 429) && attempt < retries) {
      const retryAfter = parseInt(res.headers.get("retry-after") || "60", 10);
      console.warn(`Rate limited. Waiting ${retryAfter}s before retry ${attempt}/${retries - 1}...`);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      continue;
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GitHub API ${res.status} ${res.statusText}: ${body}`);
    }

    return res.json();
  }
}

async function fetchMergedPRs() {
  let page = 1;
  const all = [];

  while (true) {
    const data = await ghRequest("/search/issues", {
      q: `author:${USERNAME} is:pr is:merged`,
      sort: "created",
      order: "desc",
      per_page: 100,
      page,
    });

    const items = data.items || [];
    all.push(...items);

    if (items.length < 100) break;
    page++;
  }

  return all;
}

const repoCache = new Map();
async function isRepoPublic(owner, repo) {
  const key = `${owner}/${repo}`;
  if (repoCache.has(key)) return repoCache.get(key);

  try {
    const data = await ghRequest(`/repos/${owner}/${repo}`);
    const pub = !data.private;
    repoCache.set(key, pub);
    return pub;
  } catch {
    repoCache.set(key, false);
    return false;
  }
}

function parseManualYaml(text) {
  const entries = [];
  let current = null;

  for (const raw of text.split("\n")) {
    const line = raw.trim();

    if (!line || line.startsWith("#")) continue;

    if (line.startsWith("- ")) {
      if (current) entries.push(current);
      current = {};
      const rest = line.slice(2).trim();
      if (rest.includes(":")) {
        const colon = rest.indexOf(":");
        const k = rest.slice(0, colon).trim();
        const v = rest.slice(colon + 1).trim().replace(/^["']|["']$/g, "");
        current[k] = v;
      }
    } else if (current && line.includes(":")) {
      const colon = line.indexOf(":");
      const k = line.slice(0, colon).trim();
      const v = line.slice(colon + 1).trim().replace(/^["']|["']$/g, "");
      current[k] = v;
    }
  }

  if (current) entries.push(current);
  return entries;
}

async function loadManualContributions() {
  if (!fs.existsSync(MANUAL_FILE)) return [];

  const text = fs.readFileSync(MANUAL_FILE, "utf8");
  const raw = parseManualYaml(text);

  const valid = raw.filter((e) => e.pr_url && !e.pr_url.includes("<"));

  const enriched = [];
  for (const e of valid) {
    const match = e.pr_url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!match) {
      console.warn(`  Skipping malformed pr_url: ${e.pr_url}`);
      continue;
    }
    const [, owner, repo, number] = match;

    try {
      const pr = await ghRequest(`/repos/${owner}/${repo}/pulls/${number}`);
      enriched.push({
        repo: `${owner}/${repo}`,
        repo_url: `https://github.com/${owner}/${repo}`,
        title: pr.title,
        pr_url: e.pr_url,
        commit_url: e.commit_url,
        closed_at: fmtDate(pr.closed_at),
        type: e.type,
        note: e.note,
      });
      console.log(`  Enriched manual entry: ${owner}/${repo}#${number}`);
    } catch (err) {
      console.warn(`  Could not fetch PR ${e.pr_url}: ${err.message}`);
    }
  }

  return enriched;
}

function fmtDate(s) {
  return new Date(s).toISOString().split("T")[0];
}

async function main() {
  console.log(`Fetching merged PRs for ${USERNAME}...`);
  const rawPRs = await fetchMergedPRs();
  console.log(`Found ${rawPRs.length} merged PRs from search API`);

  const repoMap = new Map(); 

  for (const pr of rawPRs) {
    const parts = pr.repository_url.split("/").slice(-2);
    const repoFullName = parts.join("/");
    const [owner, repo] = parts;

    if (!repoMap.has(repoFullName)) {
      const pub = await isRepoPublic(owner, repo);
      if (!pub) {
        console.log(`  Skipping private repo: ${repoFullName}`);
        continue;
      }
      repoMap.set(repoFullName, {
        url: `https://github.com/${repoFullName}`,
        prs: [],
      });
    }

    const entry = repoMap.get(repoFullName);
    if (!entry) continue;

    entry.prs.push({
      title: pr.title,
      url: pr.html_url,
      merged: fmtDate(pr.closed_at),
      type: "merged",
    });
  }

  for (const data of repoMap.values()) {
    data.prs.sort((a, b) => new Date(b.merged) - new Date(a.merged));
  }

  const sortedRepos = Array.from(repoMap.entries()).sort((a, b) => {
    return new Date(b[1].prs[0].merged) - new Date(a[1].prs[0].merged);
  });

  const totalMerged = Array.from(repoMap.values()).reduce(
    (s, r) => s + r.prs.length,
    0
  );

  const manualEntries = await loadManualContributions();
  console.log(`Loaded ${manualEntries.length} manual contribution(s)`);

  const now = new Date().toISOString().split("T")[0];

  let md = `# Contributions\n\n`;
  md += `This page is automatically updated with all **public** merged pull requests by [@${USERNAME}](https://github.com/${USERNAME})`;

  if (manualEntries.length > 0) {
    md += `, plus **${manualEntries.length}** manually tracked contribution${manualEntries.length > 1 ? "s" : ""} (applied or inspired — see notes)`;
  }

  md += `.\n`;
  md += `Total public PRs merged: **${totalMerged}**`;
  if (manualEntries.length > 0) md += ` + ${manualEntries.length} manual`;
  md += `\n\n`;
  md += `_Last updated: ${now}_\n\n`;
  md += `---\n\n`;

  if (manualEntries.length > 0) {
    md += `## Manually Tracked Contributions\n\n`;
    md += `> These PRs were closed without a GitHub merge, but the work landed upstream or directly led to a fix.\n\n`;

    for (const e of manualEntries) {
      const label = e.type === "applied" ? "✓ Applied upstream" : "⟳ Inspired upstream fix";
      md += `### [${e.repo}](${e.repo_url})\n`;
      md += `- [${e.title}](${e.pr_url}) — **${label}**\n`;
      md += `  - Commit: [${e.commit_url.split("/").pop()}](${e.commit_url})\n`;
      if (e.note) md += `  - _${e.note}_\n`;
      md += `\n`;
    }

    md += `---\n\n`;
  }

  for (const [repoName, data] of sortedRepos) {
    md += `## [${repoName}](${data.url})\n`;
    for (const pr of data.prs) {
      md += `- [${pr.title}](${pr.url}) _(merged ${pr.merged})_\n`;
    }
    md += "\n";
  }

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, md);
  console.log(`✓ Written to ${OUT_FILE}`);
}

main().catch((err) => {
  console.error("Script failed:", err?.message ?? String(err));
  if (process.env.DEBUG) console.error(err.stack ?? "no stack");
  process.exit(1);
});