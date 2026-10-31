"use strict";

/**
 * A light update check: ask GitHub for the latest release and compare versions.
 * No updater framework and no background downloads; when a newer version exists
 * the app says so once and links to the download page.
 */

const REPO = process.env.GRADAPP_REPO || "UJESH2K/gradapp";

function parse(version) {
  return String(version || "")
    .replace(/^v/i, "")
    .split(/[.-]/)
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10) || 0);
}

function newer(a, b) {
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i += 1) {
    if (x[i] !== y[i]) return x[i] > y[i];
  }
  return false;
}

async function checkForUpdate(current) {
  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "GradApp" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return { available: false, current };
    const release = await response.json();
    return {
      available: newer(release.tag_name, current),
      current,
      latest: String(release.tag_name || "").replace(/^v/i, ""),
      url: release.html_url || `https://github.com/${REPO}/releases/latest`,
    };
  } catch {
    return { available: false, current };
  }
}

module.exports = { checkForUpdate, newer };
