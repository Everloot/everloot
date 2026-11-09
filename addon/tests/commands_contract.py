"""
One command list. The in-game help line (core.lua), the README's command table and the site's addon guide each
name the /everloot commands; this contract reads the three and fails when one names a command the others miss.

A command is read the same way from each source: `/everloot word [a|b]` is the word plus "word a" and "word b";
`word on|off` is "word on" and "word off"; `<share code>` is the placeholder word. The README is the source: the
help must name every word it documents, and the README and the guide must carry every phrase the help prints.
"""
import html
import re
from pathlib import Path

root = Path(__file__).parents[1]
core = (root / "core.lua").read_text(encoding="utf-8")
readme = (root / "README.md").read_text(encoding="utf-8")
guide = (root.parent / "web/src/app/docs/guides/addon/page.tsx").read_text(encoding="utf-8")


def phrases(text):
    """The command phrases one entry names: `gph [start|hide|cut on|off]` -> gph, gph start, gph hide, gph cut on, gph cut off."""
    text = re.sub(r"<([^>]+)>", r"\1", html.unescape(text)).strip()
    if text.startswith("/everloot"):
        text = text[len("/everloot"):].strip()
    if not text:
        return set()
    word, _, rest = text.partition(" ")
    rest = rest.strip()
    optional = rest.startswith("[") and rest.endswith("]")
    rest = rest.strip("[]")
    out = {word} if optional or not rest else set()
    previous = None
    for alt in [a.strip() for a in rest.split("|") if a.strip()]:
        if alt == "off" and previous and previous.endswith(" on"):
            alt = previous[:-3] + " off"
        out.add(f"{word} {alt}")
        previous = alt
    return out


def words(phrase_set):
    return {p.split(" ")[0] for p in phrase_set}


# The help line: every string literal in the print statement, the pulls branch included.
help_statement = re.search(r'print\("Everloot commands: .*?\)\n', core, re.S)
assert help_statement, "core.lua has no 'Everloot commands:' help line"
help_text = "".join(re.findall(r'"([^"]*)"', help_statement.group(0)))
help_text = help_text.removeprefix("Everloot commands: ")
help_phrases = set()
for entry in help_text.split(", "):
    help_phrases |= phrases(entry)

# The README table: the first cell of each row under "## Commands".
section = readme.split("## Commands", 1)[1].split("\n## ", 1)[0]
readme_cells = re.findall(r"^\| `([^`]+)` \|", section, re.M)
assert readme_cells, "README.md has no command table under ## Commands"
readme_phrases = set()
for cell in readme_cells:
    readme_phrases |= phrases(cell.replace("\\|", "|"))

# The guide: every <C> entry inside the commands table that starts with a command word.
table = re.search(r"<Table\s+head=\{\[\"Command\".*?\]\}\s*/>", guide, re.S)
assert table, "the guide has no Command table"
guide_phrases = set()
for entry in re.findall(r"<C[^>]*>(.*?)</C>", table.group(0), re.S):
    found = phrases(entry)
    if words(found) & words(help_phrases) or entry.startswith("/ask"):
        guide_phrases |= found

help_words, readme_words, guide_words = words(help_phrases), words(readme_phrases), words(guide_phrases)

missing = sorted(help_phrases - readme_phrases)
assert not missing, f"the help line names commands the README table lacks: {missing}"
missing = sorted(help_phrases - guide_phrases)
assert not missing, f"the help line names commands the guide table lacks: {missing}"
extra = sorted(readme_words - help_words)
assert not extra, f"the README table documents commands the help line does not name: {extra}"
extra = sorted(guide_words - help_words)
assert not extra, f"the guide table documents commands the help line does not name: {extra}"

# Every word the help names is one core.lua handles, so the list is never ahead of the code.
handled = set(re.findall(r'msg == "([a-z]+)', core)) | set(re.findall(r'match\("\^(?:%s\*)?([a-z]+)%f', core))
# Routed before the message is lowercased, with a case-insensitive pattern each.
handled |= {"ask", "plan", "price"}
unhandled = sorted(w for w in help_words - {"/ask"} if w not in handled)
assert not unhandled, f"the help line names commands core.lua does not handle: {unhandled}"

print(f"commands contract: {len(help_words)} commands, {len(help_phrases)} phrases in all three lists PASS")
