#!/usr/bin/env python3
"""BabaHakim PHASE 05 — Security & Privacy documentation validator.

Checks:
1. Deliverables: docs/SECURITY.md, docs/THREAT-MODEL.md, middleware, security modules
2. SECURITY.md has all 12 sections + covers every mandated area from the phase order
3. THREAT-MODEL.md: STRIDE categories + DREAD + threats table + residual risks
4. ED-59..70 in DATABASE? no — in BUSINESS-RULES.md + ADR-0014/0015 indexed
5. Tests exist: unit test file + pentest script + package.json scripts
6. Code markers: middleware CSRF, login rate limit, image permission ED-66, register validation
7. No stray CJK; no secrets in committed files
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
errors: list[str] = []
warnings: list[str] = []

SEC = REPO / "docs" / "SECURITY.md"
TM = REPO / "docs" / "THREAT-MODEL.md"
MW = REPO / "src" / "middleware.ts"
BR_MD = REPO / "docs" / "BUSINESS-RULES.md"
RTM = REPO / "docs" / "REQUIREMENTS-TRACEABILITY-MATRIX.md"
ADR14 = REPO / "docs" / "ADR" / "ADR-0014-security-middleware-layer.md"
ADR15 = REPO / "docs" / "ADR" / "ADR-0015-privacy-data-rights.md"
ADR_README = REPO / "docs" / "ADR" / "README.md"
UNIT = REPO / "src" / "lib" / "security" / "__tests__" / "security.test.ts"
PENTEST = REPO / "tests" / "security-pentest.sh"
PKG = REPO / "package.json"
MODULES = ["env", "rate-limit", "csrf", "otp", "encryption", "privacy"]

for f in [SEC, TM, MW, BR_MD, RTM, ADR14, ADR15, ADR_README, UNIT, PENTEST, PKG]:
    if not f.exists():
        errors.append(f"MISSING file: {f}")

for m in MODULES:
    if not (REPO / "src" / "lib" / "security" / f"{m}.ts").exists():
        errors.append(f"missing security module: src/lib/security/{m}.ts")

sec = SEC.read_text(encoding="utf-8") if SEC.exists() else ""
tm = TM.read_text(encoding="utf-8") if TM.exists() else ""
br = BR_MD.read_text(encoding="utf-8") if BR_MD.exists() else ""
rtm = RTM.read_text(encoding="utf-8") if RTM.exists() else ""

# 2) SECURITY.md sections 0..12 + mandated topics
for sec_n in [f"## {i})" for i in "۰۱۲۳۴۵۶۷۸۹"] + ["## ۱۰)", "## ۱۱)", "## ۱۲)"]:
    if sec_n not in sec:
        errors.append(f"SECURITY.md missing section {sec_n}")
MANDATE = [
    ("Authentication", "۱) Authentication"), ("Authorization", "۲) Authorization"),
    ("RBAC/Permission", "Permission"), ("JWT", "JWT"), ("Refresh Rotation", "۱.۳"),
    ("OTP/MFA", "OTP/MFA"), ("Session", "۱.۵"), ("Rate Limiting", "۳) Rate Limiting"),
    ("Brute Force", "Brute"), ("Secure Headers", "۴.۱"), ("CORS", "۴.۲"), ("CSRF", "۴.۳"),
    ("Input Validation", "۵)"), ("SQL Injection", "SQL Injection"), ("XSS", "XSS"),
    ("File Upload", "Upload"), ("Secret Management", "۶.۱"), ("Encryption", "۶.۲"),
    ("Signed URLs", "۶.۳"), ("Audit Logging", "۷)"), ("Medical Data", "۸)"),
    ("Private Storage", "Private Storage"), ("Expiring URLs", "Expiring"),
    ("Download Audit", "Download Audit"), ("Image Access Audit", "Image Access Audit"),
    ("Consent", "۹.۱"), ("Privacy Acceptance", "ConsentRecord"), ("Export", "۹.۲"),
    ("Deletion Request", "۹.۳"), ("Anonymization", "Anonymization"), ("De-identification", "De-identification"),
]
for label, frag in MANDATE:
    if frag not in sec:
        errors.append(f"SECURITY.md missing mandated topic: {label} (~'{frag}')")

# 3) THREAT-MODEL structure
for frag in ["Spoofing", "Tampering", "Repudiation", "Information Disclosure", "Denial of Service",
             "Elevation of Privilege", "DREAD", "Residual", "T-SPF-", "T-TAM-", "T-REP-",
             "T-INF-", "T-DOS-", "T-EOP-", "Assets"]:
    if frag not in tm:
        errors.append(f"THREAT-MODEL.md missing: {frag}")

# 4) ED chain + ADR index
for i in range(59, 71):
    if f"ED-{i}" not in br:
        errors.append(f"BUSINESS-RULES.md missing ED-{i}")
for f, token in [(ADR14, "ADR-0014"), (ADR15, "ADR-0015")]:
    if f.exists() and token not in f.read_text(encoding="utf-8"):
        errors.append(f"{f.name} missing self-id")
adr_idx = ADR_README.read_text(encoding="utf-8") if ADR_README.exists() else ""
for t in ["ADR-0014", "ADR-0015"]:
    if t not in adr_idx:
        errors.append(f"ADR README does not index {t}")
if "ED-01..ED-70" not in rtm:
    errors.append("RTM does not claim ED-01..70 range")

# 5) test scripts wired
pkg = PKG.read_text(encoding="utf-8") if PKG.exists() else ""
for script in ["test:security", "pentest"]:
    if script not in pkg:
        errors.append(f"package.json missing script: {script}")
if PENTEST.exists():
    sh = PENTEST.read_text(encoding="utf-8")
    for cat in ["AUTHN", "AUTHZ", "CSRF", "UPLOAD", "MED", "INJ", "HDR", "PRIV", "OTP"]:
        if f"── {cat}" not in sh:
            errors.append(f"pentest script missing category: {cat}")

# 6) code markers
mw_src = MW.read_text(encoding="utf-8") if MW.exists() else ""
for marker in ["x-csrf-token", "Origin", "zarinpal/callback", "ta_csrf"]:
    if marker not in mw_src:
        errors.append(f"middleware.ts missing marker: {marker}")
login = REPO / "src" / "app" / "api" / "v1" / "auth" / "login" / "route.ts"
if login.exists():
    ls = login.read_text(encoding="utf-8")
    for marker in ["login:ip", "login:acct", "mfaRequired", "LOGIN_RATE_LIMITED"]:
        if marker not in ls:
            errors.append(f"login route missing hardening marker: {marker}")
img = REPO / "src" / "app" / "api" / "v1" / "images" / "[id]" / "file" / "route.ts"
if img.exists():
    ims = img.read_text(encoding="utf-8")
    for marker in ["view_images", "view_medical_files", "VIEW_MEDICAL_FILE", "DOWNLOAD_IMAGE", "MEDICAL_FILE_ACCESS_DENIED"]:
        if marker not in ims:
            errors.append(f"image route missing ED-66/audit marker: {marker}")
up = REPO / "src" / "app" / "api" / "v1" / "images" / "upload" / "route.ts"
if up.exists():
    ups = up.read_text(encoding="utf-8")
    for marker in ["sniffMime", "UPLOAD_RATE_LIMITED", "rateLimit"]:
        if marker not in ups:
            errors.append(f"upload route missing marker: {marker}")

# 7) CJK + secret scan on new docs
for name, text in [("SECURITY.md", sec), ("THREAT-MODEL.md", tm)]:
    cjk = re.findall(r"[\u4e00-\u9fff]", text)
    if cjk:
        errors.append(f"{name} contains stray CJK: {cjk[:5]}")
secret_pat = re.compile(r"(sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY)", re.I)
for name, text in [("SECURITY.md", sec), ("THREAT-MODEL.md", tm)]:
    if secret_pat.search(text):
        errors.append(f"{name} contains a secret pattern")

print(f"[PHASE-05 validator] sections=12 topics={len(MANDATE)} EDs=59..70 ADRs=0014/0015")
if errors:
    print("\nFAIL — error(s):")
    for e in errors:
        print(f"  ✗ {e}")
    sys.exit(1)
if warnings:
    print("warnings:")
    for w in warnings:
        print(f"  ~ {w}")
print("\nPASS — PHASE 05 security documentation is structurally consistent.")
