// SPDX-FileCopyrightText: 2026 Vishrut2403
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from "fs";
import path from "path";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITLAB_TOKEN = process.env.GITLAB_TOKEN;
if (!GITHUB_TOKEN) throw new Error("Missing GITHUB_TOKEN");

const GITHUB_USERNAME = "Vishrut2403";
const GITLAB_USER_ID = 1258849;
const GITLAB_BASE = "https://gitlab.freedesktop.org";
const BLENDER_BASE = "https://projects.blender.org";
const BLENDER_USERNAME = "vishydaperry";

const OUT_FILE = path.resolve("profile/streak-dark.svg");
const DAYS = 365;

async function apiFetch(url, token = null, retries = 3) {
  const headers = { Accept: "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await fetch(url, { headers });

    if ((res.status === 429 || res.status === 403) && attempt < retries) {
      const wait = parseInt(res.headers.get("retry-after") || "30", 10);
      console.warn(`Rate limited. Waiting ${wait}s...`);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }

    if (!res.ok) {
      console.warn(`  API error ${res.status} for ${url}`);
      return null;
    }

    return res.json();
  }
  return null;
}

function dateKeyIST(date) {
  const IST_OFFSET = 5.5 * 60 * 60 * 1000;
  const ist = new Date(date.getTime() + IST_OFFSET);
  return ist.toISOString().split("T")[0];
}

async function fetchGitHub(activeDays) {
  console.log("Fetching GitHub contributions...");

  const from = new Date();
  from.setUTCDate(from.getUTCDate() - DAYS);

  const query = `{
    user(login: "${GITHUB_USERNAME}") {
      contributionsCollection(from: "${from.toISOString()}") {
        contributionCalendar {
          weeks {
            contributionDays {
              date
              contributionCount
            }
          }
        }
      }
    }
  }`;

  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    console.warn("  GitHub GraphQL error:", res.status);
    return;
  }

  const data = await res.json();
  const weeks =
    data?.data?.user?.contributionsCollection?.contributionCalendar?.weeks || [];

  let count = 0;
  for (const week of weeks) {
    for (const day of week.contributionDays) {
      if (day.contributionCount > 0) {
        activeDays.add(day.date);
        count++;
      }
    }
  }
  console.log(`  GitHub: ${count} active days`);
}

async function fetchGitLab(activeDays) {
  console.log("Fetching GitLab (freedesktop) contributions...");

  const after = new Date();
  after.setUTCDate(after.getUTCDate() - DAYS);
  const afterStr = after.toISOString().split("T")[0];

  const TRACKED = new Set(["pushed", "opened", "commented", "approved", "merged"]);

  let page = 1;
  const days = new Set();

  while (true) {
    const url = `${GITLAB_BASE}/api/v4/users/${GITLAB_USER_ID}/events?per_page=100&page=${page}&after=${afterStr}`;
    const data = await apiFetch(url, GITLAB_TOKEN || null);

    if (!data || data.length === 0) break;

    for (const event of data) {
      if (!TRACKED.has(event.action_name)) continue;
      if (!event.created_at) continue;
      const key = dateKeyIST(new Date(event.created_at));
      activeDays.add(key);
      days.add(key);
    }

    if (data.length < 100) break;
    page++;
  }

  console.log(`  GitLab: ${days.size} active days`);
}

async function fetchBlender(activeDays) {
  console.log("Fetching Blender (projects.blender.org) contributions...");

  const url = `${BLENDER_BASE}/api/v1/users/${BLENDER_USERNAME}/heatmap`;
  const data = await apiFetch(url);

  if (!data) {
    console.warn("  Blender API returned no data — skipping");
    return;
  }

  const cutoff = new Date();
  cutoff.setTime(cutoff.getTime() - DAYS * 24 * 60 * 60 * 1000);

  const days = new Set();
  for (const entry of data) {
    if (!entry.contributions || entry.contributions === 0) continue;
    const date = new Date(entry.timestamp * 1000);
    if (date < cutoff) continue;
    const key = dateKeyIST(date);
    activeDays.add(key);
    days.add(key);
  }

  console.log(`  Blender: ${days.size} active days`);
}

function calculateStreaks(activeDays) {
  const now = new Date();
  const todayIST = now.toISOString().split("T")[0];
  const yesterdayIST = new Date(Date.now() - 86400000).toISOString().split("T")[0];

  // Sort descending
  const sorted = Array.from(activeDays).sort((a, b) => (a > b ? -1 : 1));

  if (sorted.length === 0) {
    return { current: 0, longest: 0, total: 0, currentStart: null, currentEnd: null, longestStart: null, longestEnd: null };
  }

  let currentStreak = 0;
  let currentStart = null;
  let currentEnd = null;

  const mostRecent = sorted[0];
  if (mostRecent === todayIST || mostRecent === yesterdayIST) {
    currentEnd = mostRecent;
    let prev = mostRecent;
    let streak = 1;

    for (let i = 1; i < sorted.length; i++) {
      const curr = sorted[i];
      const diff = (new Date(prev) - new Date(curr)) / 86400000;
      if (Math.round(diff) === 1) {
        streak++;
        prev = curr;
      } else {
        break;
      }
    }

    currentStreak = streak;
    currentStart = prev;
  }

  // Longest streak
  let longest = 0;
  let longestStart = null;
  let longestEnd = null;
  let runStart = sorted[sorted.length - 1];
  let runEnd = sorted[sorted.length - 1];
  let run = 1;

  for (let i = sorted.length - 2; i >= 0; i--) {
    const diff = (new Date(sorted[i]) - new Date(sorted[i + 1])) / 86400000;
    if (Math.round(diff) === 1) {
      run++;
      runEnd = sorted[i];
    } else {
      if (run > longest) {
        longest = run;
        longestStart = runStart;
        longestEnd = runEnd;
      }
      run = 1;
      runStart = sorted[i];
      runEnd = sorted[i];
    }
  }
  if (run > longest) {
    longest = run;
    longestStart = runStart;
    longestEnd = runEnd;
  }

  return {
    current: currentStreak,
    longest,
    total: activeDays.size,
    currentStart,
    currentEnd: currentEnd || mostRecent,
    longestStart,
    longestEnd,
  };
}

function fmtRange(start, end) {
  const fmt = (d) => {
    if (!d) return "?";
    const dt = new Date(d + "T00:00:00Z");
    return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  };
  if (!start || start === end) return fmt(end);
  return `${fmt(start)} - ${fmt(end)}`;
}

function renderSVG(stats) {
  const { current, longest, total, currentStart, currentEnd, longestStart, longestEnd } = stats;

  const W = 495;
  const H = 195;

  const ORANGE = "#f97316";
  const GREEN = "#23d18b";
  const TEXT_PRIMARY = "#e6edf3";
  const TEXT_MUTED = "#7d8590";
  const BG = "#0d1117";
  const BORDER = "#30363d";
  const CX = W / 2;
  const CY = 95;

  const firePath = `M${CX} ${CY - 38} 
    C${CX + 8} ${CY - 28} ${CX + 22} ${CY - 18} ${CX + 20} ${CY - 4}
    C${CX + 18} ${CY + 10} ${CX + 10} ${CY + 18} ${CX} ${CY + 22}
    C${CX - 10} ${CY + 18} ${CX - 18} ${CY + 10} ${CX - 20} ${CY - 4}
    C${CX - 22} ${CY - 18} ${CX - 8} ${CY - 28} ${CX} ${CY - 38}Z`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <style>
    text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
  </style>

  <!-- Background -->
  <rect width="${W}" height="${H}" rx="4.5" fill="${BG}"/>

  <!-- Dividers -->
  <line x1="165" y1="28" x2="165" y2="${H - 28}" stroke="${BORDER}" stroke-width="1"/>
  <line x1="330" y1="28" x2="330" y2="${H - 28}" stroke="${BORDER}" stroke-width="1"/>

  <!-- === Total Contributions === -->
  <text x="82" y="55" text-anchor="middle" font-size="36" font-weight="700" fill="${GREEN}">${total}</text>
  <text x="82" y="80" text-anchor="middle" font-size="14" fill="${TEXT_PRIMARY}">Total Contributions</text>
  <text x="82" y="98" text-anchor="middle" font-size="12" fill="${TEXT_MUTED}">Past Year</text>

  <!-- === Current Streak — fire circle === -->
  <!-- Outer glow ring -->
  <circle cx="${CX}" cy="${CY}" r="48" fill="none" stroke="${ORANGE}" stroke-width="4" opacity="0.15"/>
  <!-- Main ring -->
  <circle cx="${CX}" cy="${CY}" r="40" fill="none" stroke="${ORANGE}" stroke-width="4"/>
  <!-- Fire icon -->
  <text x="${CX}" y="${CY - 10}" text-anchor="middle" font-size="22">🔥</text>
  <!-- Streak number -->
  <text x="${CX}" y="${CY + 18}" text-anchor="middle" font-size="26" font-weight="700" fill="${ORANGE}">${current}</text>
  <!-- Labels below circle -->
  <text x="${CX}" y="${CY + 62}" text-anchor="middle" font-size="14" font-weight="600" fill="${ORANGE}">Current Streak</text>
  <text x="${CX}" y="${CY + 80}" text-anchor="middle" font-size="11" fill="${TEXT_MUTED}">${fmtRange(currentStart, currentEnd)}</text>

  <!-- === Longest Streak === -->
  <text x="412" y="55" text-anchor="middle" font-size="36" font-weight="700" fill="${GREEN}">${longest}</text>
  <text x="412" y="80" text-anchor="middle" font-size="14" fill="${TEXT_PRIMARY}">Longest Streak</text>
  <text x="412" y="98" text-anchor="middle" font-size="11" fill="${TEXT_MUTED}">${fmtRange(longestStart, longestEnd)}</text>
</svg>`;
}

async function main() {
  const activeDays = new Set();

  await fetchGitHub(activeDays);
  await fetchGitLab(activeDays);
  await fetchBlender(activeDays);

  console.log(`\nTotal active days across all platforms: ${activeDays.size}`);

  const stats = calculateStreaks(activeDays);
  console.log(`Current streak: ${stats.current} days`);
  console.log(`Longest streak: ${stats.longest} days`);
  console.log(`Total active days: ${stats.total}`);

  const svg = renderSVG(stats);
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, svg);
  console.log(`✓ Written to ${OUT_FILE}`);
}

main().catch((err) => {
  console.error("Script failed:", err?.message ?? String(err));
  if (process.env.DEBUG) console.error(err.stack ?? "no stack");
  process.exit(1);
});