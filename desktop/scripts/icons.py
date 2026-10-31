"""Render GradApp's icons from SVG. Needs: pip install playwright (Chromium)."""
import pathlib, sys
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"

def tray_svg(color, active):
    dot = '<circle cx="25" cy="7" r="5.5" fill="#34d399"/>' if active else ""
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<g stroke="{color}" stroke-width="2.2" stroke-linecap="round"><path d="M16 16V6.5M16 16l8.2 4.7M16 16l-8.2 4.7M16 16 7.8 11.3"/></g>
<circle cx="16" cy="16" r="4.6" fill="{color}"/>
<g fill="{color}"><circle cx="16" cy="6" r="3"/><circle cx="7.6" cy="11" r="3"/><circle cx="24.4" cy="21" r="3"/><circle cx="7.6" cy="21" r="3"/></g>{dot}</svg>'''

def render(page, svg, size, out):
    page.set_viewport_size({"width": size, "height": size})
    page.set_content(f'<html><body style="margin:0;background:transparent">{svg.replace("<svg ", f"<svg width=\"{size}\" height=\"{size}\" ", 1)}</body></html>')
    page.screenshot(path=str(out), omit_background=True, clip={"x": 0, "y": 0, "width": size, "height": size})

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    icon = (ASSETS / "icon.svg").read_text()
    render(page, icon, 1024, ASSETS / "icon.png")
    render(page, icon, 256, ASSETS / "icon-256.png")
    for name, color, active in [("tray", "#c9d1e0", False), ("tray-active", "#c9d1e0", True)]:
        render(page, tray_svg(color, active), 32, ASSETS / f"{name}.png")
        render(page, tray_svg(color, active), 64, ASSETS / f"{name}@2x.png")
    for name, active in [("trayTemplate", False), ("trayActiveTemplate", True)]:
        render(page, tray_svg("#000000", False) if not active else tray_svg("#000000", False).replace("</svg>", '<circle cx="25" cy="7" r="5.5" fill="#000"/></svg>'), 16, ASSETS / f"{name}.png")
        render(page, tray_svg("#000000", False) if not active else tray_svg("#000000", False).replace("</svg>", '<circle cx="25" cy="7" r="5.5" fill="#000"/></svg>'), 32, ASSETS / f"{name}@2x.png")
    browser.close()
print("icons written to", ASSETS)
