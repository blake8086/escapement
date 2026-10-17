"""Bundle the prototype.

docs/index.html      a complete standalone page, served by GitHub Pages
build/fragment.html  the same page without the document wrapper, for the
                     claude.ai artifact viewer (which supplies its own)
"""
from pathlib import Path

root = Path(__file__).parent
src = root / "src"
shell = (src / "shell.html").read_text()
sim = (src / "sim.js").read_text()
ui = (src / "ui.js").read_text()
style = (src / "style.css").read_text()

fragment = shell.replace("/*STYLE*/", style).replace("/*SIM*/", sim).replace("/*UI*/", ui)

# The shell starts with head material (title, metas, fonts, style) and then the body.
split = fragment.index('<div id="app">')
head, body = fragment[:split], fragment[split:]
page = (
    "<!doctype html>\n<html lang=\"en\">\n<head>\n"
    "<meta charset=\"utf-8\">\n"
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n"
    f"{head}</head>\n<body>\n{body}</body>\n</html>\n"
)

(root / "docs").mkdir(exist_ok=True)
(root / "docs" / "index.html").write_text(page)
(root / "build").mkdir(exist_ok=True)
(root / "build" / "fragment.html").write_text(fragment)
print(f"docs/index.html: {len(page):,} bytes · build/fragment.html: {len(fragment):,} bytes")
