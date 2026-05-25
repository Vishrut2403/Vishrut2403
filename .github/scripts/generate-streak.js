// SPDX-FileCopyrightText: 2026 Vishrut2403
// SPDX-License-Identifier: GPL-3.0-or-later

import fs from "fs";
import path from "path";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
if (!GITHUB_TOKEN) throw new Error("Missing GITHUB_TOKEN");

const GITHUB_USERNAME = "Vishrut2403";
const OUT_FILE = path.resolve("profile/streak-dark.svg");
const DAYS = 365;

const COUNTED_EVENTS = new Set([
  "PushEvent",
  "PullRequestReviewEvent",
  "PullRequestEvent",
  "PullRequestReviewCommentEvent",
  "IssueCommentEvent",
  "IssuesEvent",
]);

function toIST(date) {
  return new Date(date.getTime() + 5.5 * 60 * 60 * 1000).toISOString().split("T")[0];
}

async function fetchGraphQLDays(activeDays) {
  console.log("Fetching GitHub contributions (GraphQL)...");
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - DAYS);

  const query = `{
    user(login: "${GITHUB_USERNAME}") {
      contributionsCollection(from: "${from.toISOString()}") {
        contributionCalendar {
          totalContributions
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
    console.warn("  GraphQL error:", res.status);
    return 0;
  }

  const data = await res.json();
  const collection = data?.data?.user?.contributionsCollection;
  const weeks = collection?.contributionCalendar?.weeks || [];

  let count = 0;
  for (const week of weeks) {
    for (const day of week.contributionDays) {
      if (day.contributionCount > 0) {
        activeDays.add(day.date);
        count++;
      }
    }
  }
  console.log(`  GraphQL: ${count} active days`);
  return collection?.contributionCalendar?.totalContributions ?? 0;
}

async function fetchEventsDays(activeDays) {
  console.log("Fetching GitHub events (Events API)...");
  let page = 1;
  let added = 0;

  while (true) {
    const res = await fetch(
      `https://api.github.com/users/${GITHUB_USERNAME}/events?per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: "application/json",
        },
      }
    );

    if (res.status === 422 || res.status === 404) break;
    if (!res.ok) {
      console.warn(`  Events API error ${res.status} on page ${page}`);
      break;
    }

    const events = await res.json();
    if (!events.length) break;

    for (const e of events) {
      if (!COUNTED_EVENTS.has(e.type)) continue;
      const day = toIST(new Date(e.created_at));
      if (!activeDays.has(day)) {
        activeDays.add(day);
        added++;
      }
    }

    if (events.length < 100) break;
    page++;
  }

  console.log(`  Events API: ${added} new days added`);
}

function calculateStreaks(activeDays) {
  const now = new Date();
  const todayIST = toIST(now);
  const yesterdayIST = toIST(new Date(now.getTime() - 86400000));

  const sorted = Array.from(activeDays).sort((a, b) => (a > b ? -1 : 1));

  if (sorted.length === 0) {
    return { current: 0, longest: 0, currentStart: null, currentEnd: null, longestStart: null, longestEnd: null };
  }

  let currentStreak = 0, currentStart = null, currentEnd = null;
  const mostRecent = sorted[0];

  if (mostRecent === todayIST || mostRecent === yesterdayIST) {
    currentEnd = mostRecent;
    let prev = mostRecent;
    let streak = 1;
    for (let i = 1; i < sorted.length; i++) {
      const diff = (new Date(prev) - new Date(sorted[i])) / 86400000;
      if (Math.round(diff) === 1) {
        streak++;
        prev = sorted[i];
      } else break;
    }
    currentStreak = streak;
    currentStart = prev;
  }

  let longest = 0, longestStart = null, longestEnd = null;
  let runStart = sorted[sorted.length - 1];
  let runEnd = sorted[sorted.length - 1];
  let run = 1;

  for (let i = sorted.length - 2; i >= 0; i--) {
    const diff = (new Date(sorted[i]) - new Date(sorted[i + 1])) / 86400000;
    if (Math.round(diff) === 1) {
      run++;
      runEnd = sorted[i];
    } else {
      if (run > longest) { longest = run; longestStart = runStart; longestEnd = runEnd; }
      run = 1;
      runStart = sorted[i];
      runEnd = sorted[i];
    }
  }
  if (run > longest) { longest = run; longestStart = runStart; longestEnd = runEnd; }

  return { current: currentStreak, longest, currentStart, currentEnd: currentEnd || mostRecent, longestStart, longestEnd };
}

function fmtRange(start, end) {
  const fmt = (d) => {
    if (!d) return "?";
    return new Date(d + "T00:00:00Z").toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric", timeZone: "UTC"
    });
  };
  if (!start || start === end) return fmt(end);
  return `${fmt(start)} - ${fmt(end)}`;
}

function renderSVG({ current, longest, total, currentStart, currentEnd, longestStart, longestEnd }) {
  const W = 495, H = 195;
  const ORANGE = "#f97316", GREEN = "#23d18b";
  const TEXT_PRIMARY = "#e6edf3", TEXT_MUTED = "#7d8590";
  const BG = "#0d1117", BORDER = "#30363d";
  const CX = W / 2, CY = 95;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <style>
    text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
  </style>
  <rect width="${W}" height="${H}" rx="4.5" fill="${BG}"/>
  <line x1="165" y1="28" x2="165" y2="${H - 28}" stroke="${BORDER}" stroke-width="1"/>
  <line x1="330" y1="28" x2="330" y2="${H - 28}" stroke="${BORDER}" stroke-width="1"/>
  <text x="82" y="55" text-anchor="middle" font-size="36" font-weight="700" fill="${GREEN}">${total}</text>
  <text x="82" y="80" text-anchor="middle" font-size="14" fill="${TEXT_PRIMARY}">Total Contributions</text>
  <text x="82" y="98" text-anchor="middle" font-size="12" fill="${TEXT_MUTED}">Past Year</text>
  <circle cx="${CX}" cy="${CY}" r="48" fill="none" stroke="${ORANGE}" stroke-width="4" opacity="0.15"/>
  <circle cx="${CX}" cy="${CY}" r="40" fill="none" stroke="${ORANGE}" stroke-width="4"/>
  <text x="${CX}" y="${CY - 10}" text-anchor="middle" font-size="22">🔥</text>
  <text x="${CX}" y="${CY + 18}" text-anchor="middle" font-size="26" font-weight="700" fill="${ORANGE}">${current}</text>
  <text x="${CX}" y="${CY + 62}" text-anchor="middle" font-size="14" font-weight="600" fill="${ORANGE}">Current Streak</text>
  <text x="${CX}" y="${CY + 80}" text-anchor="middle" font-size="11" fill="${TEXT_MUTED}">${fmtRange(currentStart, currentEnd)}</text>
  <text x="412" y="55" text-anchor="middle" font-size="36" font-weight="700" fill="${GREEN}">${longest}</text>
  <text x="412" y="80" text-anchor="middle" font-size="14" fill="${TEXT_PRIMARY}">Longest Streak</text>
  <text x="412" y="98" text-anchor="middle" font-size="11" fill="${TEXT_MUTED}">${fmtRange(longestStart, longestEnd)}</text>
</svg>`;
}

async function main() {
  const activeDays = new Set();
  const total = await fetchGraphQLDays(activeDays);
  await fetchEventsDays(activeDays);

  console.log(`\nTotal active days (merged): ${activeDays.size}`);

  const stats = calculateStreaks(activeDays);
  console.log(`Current streak: ${stats.current} days`);
  console.log(`Longest streak: ${stats.longest} days`);
  console.log(`Total contributions: ${total}`);

  const svg = renderSVG({ ...stats, total });
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, svg);
  console.log(`✓ Written to ${OUT_FILE}`);
}

main().catch((err) => {
  console.error("Script failed:", err?.message ?? String(err));
  process.exit(1);
});