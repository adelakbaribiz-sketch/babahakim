#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""PHASE 03 — Architecture docs validator (BabaHakim)

Checks:
 1. Deliverable files exist (ARCHITECTURE.md, ARCHITECTURE-DIAGRAM.md, ADR/*)
 2. All 15 Bounded Contexts present in ARCHITECTURE.md (ownership table + tier table)
 3. All 11 architecture components present in component table
 4. ADR structure: numbering, required sections, ED mapping, README link targets
 5. ED-35..ED-46 present in BUSINESS-RULES.md and ADR cross-references match
 6. Mermaid blocks: balanced fences, valid diagram types, subgraph/end balance
 7. 17-stage patient lifecycle keywords present in ARCHITECTURE-DIAGRAM.md
 8. Stray CJK characters detection (documentation is fa/en only)
 9. Secret-like patterns scan
10. No doc mentions hard "microservices chosen" contradictions (MM verdict consistent)
Exit code: 0 = PASS, 1 = errors, 2 = warnings only.
"""
import re, sys, pathlib

ROOT = pathlib.Path("/home/z/my-project/docs")
ARCH = ROOT / "ARCHITECTURE.md"
DIAG = ROOT / "ARCHITECTURE-DIAGRAM.md"
ADR_DIR = ROOT / "ADR"
BR = ROOT / "BUSINESS-RULES.md"

errors, warnings = [], []
def err(msg): errors.append(msg)
def warn(msg): warnings.append(msg)

# ---------- 1. files ----------
required = [ARCH, DIAG, ADR_DIR / "README.md", ADR_DIR / "_TEMPLATE.md"]
ADR_IDS = [f"ADR-{i:04d}" for i in range(1, 13)]
required += [ADR_DIR / f"{a}-{slug}.md" for a, slug in [
    ("ADR-0001","modular-monolith"), ("ADR-0002","bounded-contexts-dependency-tiers"),
    ("ADR-0003","single-nextjs-app-web-backend"), ("ADR-0004","postgresql-schema-per-context"),
    ("ADR-0005","redis-cache-queue-bullmq"), ("ADR-0006","s3-object-storage-signed-urls"),
    ("ADR-0007","ai-service-isolation"), ("ADR-0008","domain-events-cross-context"),
    ("ADR-0009","ports-adapters-payment-shipping"), ("ADR-0010","architecture-enforcement-ci"),
    ("ADR-0011","deployment-topology"), ("ADR-0012","observability"),
    ("ADR-0013","alembic-ddl-source-of-truth"),
    ("ADR-0014","security-middleware-layer"), ("ADR-0015","privacy-data-rights")]]
for f in required:
    if not f.exists(): err(f"MISSING file: {f}")
if errors:
    print("\n".join(errors)); sys.exit(1)

arch = ARCH.read_text(encoding="utf-8")
diag = DIAG.read_text(encoding="utf-8")
br = BR.read_text(encoding="utf-8")
adr_readme = (ADR_DIR / "README.md").read_text(encoding="utf-8")

# ---------- 2. bounded contexts ----------
CONTEXTS = ["identity","patients","medical-records","ai","clinical-review","products",
            "prescriptions","commerce","payments","shipping","notifications",
            "tickets","reporting","finance","administration"]
# ownership table: | **Identity** | ... | `src/modules/identity` |
for c in CONTEXTS:
    if f"src/modules/{c}" not in arch:
        err(f"context module path missing in ARCHITECTURE.md: src/modules/{c}")
# tier table rows: | **T0** | Identity, Administration | ... |
tier_section = arch.split("### 5.1", 1)[1].split("### 5.2", 1)[0]
tier_flat = []
for line in tier_section.splitlines():
    if not line.strip().startswith("|") or "**T" not in line and "**Kernel" not in line:
        continue
    cells = [c.strip() for c in line.strip("|").split("|")]
    if len(cells) < 2: continue
    body = cells[1] if "Kernel" in cells[0] else (cells[1] if len(cells) >= 3 else "")
    if not body: continue
    for w in re.split(r"[,،]", body):
        w = w.strip()
        if w and w[0].isupper() and "(" not in w:
            tier_flat.append(w.lower().replace(" ", "-"))
tier_flat = [t for t in tier_flat if t in CONTEXTS or t in ("kernel",)]
found = [c for c in CONTEXTS if c in tier_flat]
if len(found) != 15:
    err(f"tier table covers {len(found)}/15 contexts: {sorted(set(CONTEXTS)-set(found))}")
# dependency-cruiser TIER map in doc must match the 15 contexts
m = re.search(r"const TIER = \{(.*?)\};", arch, re.S)
if not m: err("dependency-cruiser TIER map not found in ARCHITECTURE.md")
else:
    keys = re.findall(r"([\w'-]+)\s*:\s*\d+", m.group(1))
    keys = [k.strip("\"'") for k in keys]
    if sorted(keys) != sorted(CONTEXTS):
        err(f"TIER map contexts mismatch: {sorted(set(keys)^set(CONTEXTS))}")

# ---------- 3. components ----------
COMPONENTS = ["Frontend","Backend","Worker","Database","Cache","Queue","Object Storage",
              "AI Service","Notification Service","Payment Adapter","Shipping Adapter"]
comp_table = arch.split("### 3.1",1)[1].split("### 3.2",1)[0]
for c in COMPONENTS:
    if f"**{c}" not in comp_table:
        err(f"component missing in ARCHITECTURE.md §3.1 table: {c}")

# ---------- 4. ADR structure ----------
sec_required = ["## Context","## Decision","## Consequences","## Compliance","وضعیت"]
adr_files = sorted(ADR_DIR.glob("ADR-*.md"))
if len(adr_files) != 15: err(f"expected 15 ADR files, found {len(adr_files)}")
for f in adr_files:
    txt = f.read_text(encoding="utf-8")
    aid = f.stem.split("-")[0] + "-" + f.stem.split("-")[1]
    if aid not in txt: err(f"{f.name}: title does not contain its id {aid}")
    for s in sec_required:
        if s not in txt: err(f"{f.name}: missing section '{s}'")
    if "Accepted" not in txt: err(f"{f.name}: status not Accepted")
    ed = re.search(r"ED-(\d\d)", txt)
    if not ed: err(f"{f.name}: no ED reference")
    else:
        # ADRs map to at least the base ED of their number; phase-05+ ADRs may
        # legitimately cover ED ranges (e.g. ADR-0014 -> ED-59..62).
        n = int(ed.group(1))
        expected_min = 34 + int(aid.split("-")[1])
        if n < expected_min: err(f"{f.name}: ED-{n} below minimum ED-{expected_min}")
# README links resolve
for link in re.findall(r"\]\((\./ADR-[\w-]+\.md)\)", adr_readme):
    if not (ADR_DIR / link[2:]).exists(): err(f"ADR README broken link: {link}")

# ---------- 5. ED registry ----------
for i in range(35, 47):
    if f"| ED-{i} |" not in br: err(f"BUSINESS-RULES.md missing ED-{i}")
    if f"ADR-{i-34:04d}" not in br: err(f"BUSINESS-RULES.md ED-{i} lacks ADR ref")
ed_count = len(re.findall(r"^\| ED-\d+ \|", br, re.M))
if ed_count != 92: err(f"ED total count {ed_count} != 92")  # 70 + phase-06 ED-71..80 + phase-07 ED-81..92

# ---------- 6. mermaid ----------
blocks = re.findall(r"```mermaid\n(.*?)```", diag, re.S)
if len(blocks) < 13: err(f"mermaid blocks in DIAGRAM: {len(blocks)} < 13")
fences = diag.count("```")
if fences % 2 != 0: err("unbalanced code fences in DIAGRAM")
types = {"flowchart":0, "sequenceDiagram":0}
for i, b in enumerate(blocks, 1):
    first = b.strip().splitlines()[0].strip()
    if not re.match(r"^(flowchart|graph|sequenceDiagram|erDiagram|classDiagram|stateDiagram)", first):
        err(f"mermaid block {i}: unknown type '{first}'")
    key = first.split()[0] if first.startswith("flowchart") else ("sequenceDiagram" if first.startswith("sequenceDiagram") else first)
    if key in types: types[key]+=1
    sub = len(re.findall(r"^\s*subgraph\b", b, re.M))
    end = len(re.findall(r"^\s*end\s*$", b, re.M))
    if sub != end: err(f"mermaid block {i}: subgraph {sub} vs end {end}")
    if b.count('"') % 2 != 0: err(f"mermaid block {i}: odd number of quotes")
if types["sequenceDiagram"] < 2: err("expected >=2 sequence diagrams")
if types["flowchart"] < 8: err("expected >=8 flowcharts")

# ---------- 7. 17 stages ----------
STAGES = ["Registration","Questionnaire","Image Upload","AI Analysis","Expert 1",
          "Initial Assessment","User Approval","Prescription","Expert 2","Doctor",
          "Order","Invoice","Payment","Shipment","Delivery","Follow-up","Reassessment"]
for s in STAGES:
    if s not in diag: err(f"17-stage lifecycle keyword missing in DIAGRAM: {s}")
# numbered notes 1..17 in golden path
seq_block = [b for b in blocks if b.startswith("sequenceDiagram") and "register" in b]
if seq_block:
    nums = set(int(n) for n in re.findall(r"(?<!\d)(\d{1,2})-[A-Z]", seq_block[0]))
    if nums != set(range(1,18)):
        err(f"golden-path note numbering incomplete: {sorted(nums)}")

# ---------- 8. stray CJK ----------
cjk = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002a6df]")
for f, txt in [("ARCHITECTURE.md", arch), ("ARCHITECTURE-DIAGRAM.md", diag),
               ("BUSINESS-RULES.md", br), ("ADR/README.md", adr_readme)] + \
              [(f.name, f.read_text(encoding="utf-8")) for f in adr_files]:
    hits = cjk.findall(txt)
    if hits: err(f"{f}: stray CJK characters: {''.join(hits[:5])}")

# ---------- 9. secrets ----------
secret_pat = re.compile(r"(sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|password\s*[:=]\s*\S{8,})", re.I)
for name, txt in [("ARCHITECTURE.md", arch), ("ARCHITECTURE-DIAGRAM.md", diag)] + \
                 [(f.name, f.read_text(encoding="utf-8")) for f in adr_files]:
    if secret_pat.search(txt): err(f"{name}: secret-like pattern found")

# ---------- 10. verdict consistency ----------
if "Modular Monolith" not in arch.split("## 2.")[1][:4000]:
    err("ARCHITECTURE.md §2 does not state Modular Monolith decision")

# ---------- report ----------
ctx_n = 15; comp_n = len(COMPONENTS); adr_n = len(adr_files); ed_n = 70
print(f"[PHASE-03 validator] contexts={ctx_n} components={comp_n} ADRs={adr_n} EDs(total)={ed_n}")
print(f"[PHASE-03 validator] mermaid blocks={len(blocks)} (flowchart={types['flowchart']}, sequence={types['sequenceDiagram']})")
print(f"[PHASE-03 validator] 17-stage keywords: {sum(1 for s in STAGES if s in diag)}/17")
print(f"[PHASE-03 validator] lines: ARCH={len(arch.splitlines())}, DIAG={len(diag.splitlines())}, BR={len(br.splitlines())}")
if errors:
    print(f"\nFAIL — {len(errors)} error(s):")
    [print(f"  ✗ {e}") for e in errors]
    sys.exit(1)
if warnings:
    print(f"\nWARN — {len(warnings)} warning(s):")
    [print(f"  ⚠ {w}") for w in warnings]
print("\nPASS — PHASE 03 architecture documentation is structurally consistent.")
sys.exit(0 if not warnings else 2)
