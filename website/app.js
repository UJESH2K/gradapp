// GradApp download page. Picks the right installer for this visitor, and fills
// in the version and file sizes from GitHub when it can. Every link works
// without this script: they all fall back to the latest release page.

(function () {
  "use strict";

  // Change these two lines to publish from another repository.
  var REPO = "UJESH2K/gradapp";
  var LATEST = "https://github.com/" + REPO + "/releases/latest";

  // Fixed file names (set in electron-builder.yml), so /latest/download/<name>
  // always serves the newest build without this page changing.
  var ASSETS = {
    "windows-exe": "GradApp-windows-x64.exe",
    "windows-portable": "GradApp-windows-x64-portable.exe",
    "mac-dmg": "GradApp-mac-universal.dmg",
    "mac-zip": "GradApp-mac-universal.zip",
    "linux-appimage": "GradApp-linux-x86_64.AppImage",
    "linux-deb": "GradApp-linux-amd64.deb",
    "linux-rpm": "GradApp-linux-x86_64.rpm",
  };

  var PRIMARY = { windows: "windows-exe", mac: "mac-dmg", linux: "linux-appimage" };
  var NAMES = { windows: "Windows", mac: "macOS", linux: "Linux" };

  var ICONS = {
    windows:
      '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 5.1 10.4 4v7.1H3zM11.4 3.9 21 2.5v8.6h-9.6zM3 12.1h7.4v7.1L3 18.1zM11.4 12.1H21v8.6l-9.6-1.4z"/></svg>',
    mac: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.4 12.6c0-2.4 2-3.5 2-3.6-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.2-2.8.8-3.5.8s-1.8-.8-3-.8C7 7.2 5.6 8.1 4.8 9.5c-1.6 2.8-.4 7 1.1 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7c1.3 0 2.1-1.1 2.8-2.3.9-1.3 1.3-2.6 1.3-2.6s-2.5-1-2.5-3.6zM14.1 5.6c.6-.8 1.1-1.9 1-3-1 0-2.1.6-2.8 1.4-.6.7-1.1 1.8-1 2.9 1 .1 2.1-.5 2.8-1.3z"/></svg>',
    linux:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c-2 0-3 1.7-3 4 0 1.2.3 2-.6 3.4C7 12.4 6 14 6 16c0 1 .4 1.8 1 2.4M12 3c2 0 3 1.7 3 4 0 1.2-.3 2 .6 3.4C17 12.4 18 14 18 16c0 1-.4 1.8-1 2.4"/><path d="M7 18.4c-.8.6-2 .7-2 1.6 0 1 2 1 3.5 1 1 0 1.5-.6 1.5-1.3M17 18.4c.8.6 2 .7 2 1.6 0 1-2 1-3.5 1-1 0-1.5-.6-1.5-1.3M10 19.7c.6.2 1.3.3 2 .3s1.4-.1 2-.3"/><circle cx="10.5" cy="7.5" r=".6" fill="currentColor"/><circle cx="13.5" cy="7.5" r=".6" fill="currentColor"/></svg>',
  };

  function urlFor(key) {
    return LATEST + "/download/" + ASSETS[key];
  }

  function detect() {
    var ua = navigator.userAgent || "";
    var platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "";
    var mobile = (navigator.userAgentData && navigator.userAgentData.mobile) || /Android|iPhone|iPad|iPod/i.test(ua);
    // iPadOS reports itself as a Mac; touch points give it away.
    if (/Mac/i.test(platform) && navigator.maxTouchPoints > 1) mobile = true;
    if (mobile) return { os: null, mobile: true };
    if (/Win/i.test(platform) || /Windows/i.test(ua)) return { os: "windows" };
    if (/Mac/i.test(platform) || /Mac OS X/i.test(ua)) return { os: "mac" };
    if (/Linux|X11|CrOS/i.test(platform + ua)) return { os: "linux", chromeos: /CrOS/i.test(ua) };
    return { os: null };
  }

  function bytes(n) {
    if (!n) return "";
    return n >= 1048576 ? Math.round(n / 1048576) + " MB" : Math.round(n / 1024) + " KB";
  }

  var visitor = detect();
  var primary = document.getElementById("primary-download");
  var title = document.getElementById("primary-title");
  var sub = document.getElementById("primary-sub");
  var iconHost = document.getElementById("primary-icon");
  var note = document.getElementById("hero-note");
  var other = document.getElementById("other-platforms");

  // Every per-platform link.
  var links = document.querySelectorAll("[data-asset]");
  for (var i = 0; i < links.length; i++) {
    links[i].href = urlFor(links[i].getAttribute("data-asset"));
    links[i].setAttribute("download", "");
  }
  document.getElementById("all-releases").href = LATEST;

  if (visitor.os) {
    var key = PRIMARY[visitor.os];
    primary.href = urlFor(key);
    primary.setAttribute("download", "");
    title.textContent = "Download for " + NAMES[visitor.os];
    sub.textContent = visitor.os === "mac" ? "Apple Silicon and Intel, one app" : visitor.os === "windows" ? "Windows 10 and 11, 64-bit" : "AppImage, x64";
    iconHost.innerHTML = ICONS[visitor.os];
    var card = document.querySelector('.platform[data-os="' + visitor.os + '"]');
    if (card) {
      card.classList.add("is-yours");
      var tag = document.createElement("span");
      tag.className = "yours";
      tag.textContent = "Your computer";
      card.querySelector("h3").appendChild(tag);
      // Put the visitor's platform first.
      card.parentNode.insertBefore(card, card.parentNode.firstChild);
    }
    if (visitor.chromeos) note.textContent = "On a Chromebook, turn on Linux in Settings first, then use the Linux download.";
  } else if (visitor.mobile) {
    title.textContent = "Get it on your computer";
    sub.textContent = "GradApp runs on Windows, macOS and Linux";
    primary.href = "#download";
    other.hidden = true;
    note.textContent = "Phones cannot lend a GPU. Open this page on the computer you want to use.";
    if (navigator.share) {
      var share = document.createElement("button");
      share.type = "button";
      share.className = "link-quiet";
      share.textContent = "Send this page to my computer";
      share.style.background = "none";
      share.style.border = "0";
      share.style.cursor = "pointer";
      share.style.textDecoration = "underline";
      share.addEventListener("click", function () {
        navigator.share({ title: "GradApp", url: location.href }).catch(function () {});
      });
      other.parentNode.appendChild(share);
    }
  }

  // Version and sizes from GitHub. Optional; the page is complete without it.
  if (window.fetch) {
    fetch("https://api.github.com/repos/" + REPO + "/releases/latest", { headers: { Accept: "application/vnd.github+json" } })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (release) {
        if (!release || !release.tag_name) return;
        var version = String(release.tag_name).replace(/^v/i, "");
        var date = release.published_at ? new Date(release.published_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "";
        document.getElementById("release-line").textContent = "Version " + version + (date ? ", released " + date : "") + ".";
        if (visitor.os) sub.textContent = "Version " + version + " · " + sub.textContent;
        var sizes = {};
        (release.assets || []).forEach(function (asset) {
          sizes[asset.name] = asset.size;
        });
        for (var j = 0; j < links.length; j++) {
          var size = sizes[ASSETS[links[j].getAttribute("data-asset")]];
          if (size) {
            var span = document.createElement("span");
            span.className = "size";
            span.textContent = bytes(size);
            links[j].appendChild(span);
          } else if (release.assets && release.assets.length) {
            // This build is not in the release; send people to the release page instead of a 404.
            links[j].href = release.html_url || LATEST;
            links[j].removeAttribute("download");
          }
        }
      })
      .catch(function () {});
  }
})();
