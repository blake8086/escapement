"""Bundle the prototype into a single HTML page: docs/index.html (served by GitHub Pages)."""
from pathlib import Path

root = Path(__file__).parent
src = root / "src"
shell = (src / "shell.html").read_text()
sim = (src / "sim.js").read_text()
ui = (src / "ui.js").read_text()
style = (src / "style.css").read_text()

out = shell.replace("/*STYLE*/", style).replace("/*SIM*/", sim).replace("/*UI*/", ui)
(root / "docs").mkdir(exist_ok=True)
(root / "docs" / "index.html").write_text(out)
print(f"docs/index.html: {len(out):,} bytes")
