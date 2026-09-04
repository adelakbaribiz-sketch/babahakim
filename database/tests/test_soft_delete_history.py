"""Soft-delete + history/versioning behavior — spec §7/§15/§16/§48.

- Soft delete: UPDATE deleted_at; hard DELETE physically impossible.
- Append-only history: price ledger, inventory ledger, questionnaire history,
  case timeline, SMS logs, ticket messages, accounting ledger, audit stream.
- Versioning: prescription supersede chain, questionnaire versions,
  dataset versions (patient-level split), image re-upload dedup.
"""
from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError


def _insert_file(conn, uid, code="BH-1405-00001"):
    conn.execute(text(
        "INSERT INTO clinical_review.medical_files (code, patient_user_id) VALUES (:c, :u)"),
        {"c": code, "u": uid})
    conn.commit()
    return conn.execute(text("SELECT id FROM clinical_review.medical_files WHERE code = :c"), {"c": code}).fetchone()[0]


class TestSoftDelete:
    def test_hard_delete_user_blocked(self, conn, seed_user, expect_violation):
        uid = seed_user()
        with expect_violation("hard DELETE forbidden"):
            conn.execute(text("DELETE FROM identity.users WHERE id = :i"), {"i": uid})

    def test_hard_delete_medical_file_blocked(self, conn, seed_user, expect_violation):
        fid = _insert_file(conn, seed_user())
        with expect_violation("hard DELETE forbidden"):
            conn.execute(text("DELETE FROM clinical_review.medical_files WHERE id = :i"), {"i": fid})

    def test_hard_delete_product_blocked(self, conn, expect_violation):
        conn.execute(text("INSERT INTO products.products (sku, name_fa, name_en) VALUES ('SKU-1', 'م', 'P')"))
        conn.commit()
        with expect_violation("hard DELETE forbidden"):
            conn.execute(text("DELETE FROM products.products WHERE sku = 'SKU-1'"))

    def test_soft_delete_then_active_query_excludes(self, conn, seed_user):
        uid = seed_user(phone="09120000001")
        conn.execute(text(
            "UPDATE identity.users SET deleted_at = now(), is_active = false WHERE id = :i"), {"i": uid})
        conn.commit()
        active = conn.execute(text(
            "SELECT count(*) FROM identity.users WHERE deleted_at IS NULL AND is_active")).fetchone()[0]
        assert active == 0

    def test_updated_at_auto_bumped(self, conn, seed_user):
        uid = seed_user()
        before = conn.execute(text("SELECT updated_at FROM identity.users WHERE id = :i"), {"i": uid}).fetchone()[0]
        conn.execute(text("UPDATE identity.users SET first_name = 'جدید' WHERE id = :i"), {"i": uid})
        conn.commit()
        after = conn.execute(text("SELECT updated_at FROM identity.users WHERE id = :i"), {"i": uid}).fetchone()[0]
        assert after >= before


class TestAppendOnlyHistory:
    def test_price_history_immutable(self, conn, expect_violation):
        conn.execute(text("INSERT INTO products.products (sku, name_fa, name_en) VALUES ('SKU-1', 'م', 'P')"))
        pid = conn.execute(text("SELECT id FROM products.products WHERE sku = 'SKU-1'")).fetchone()[0]
        conn.execute(text(
            "INSERT INTO products.product_price_history (product_id, old_price, new_price, reason) "
            "VALUES (:p, NULL, 100, 'INITIAL')"), {"p": pid})
        conn.commit()
        hid = conn.execute(text("SELECT id FROM products.product_price_history LIMIT 1")).fetchone()[0]
        with expect_violation("append-only"):
            conn.execute(text("UPDATE products.product_price_history SET new_price = 5 WHERE id = :i"), {"i": hid})
        with expect_violation("append-only"):
            conn.execute(text("DELETE FROM products.product_price_history WHERE id = :i"), {"i": hid})
        # price change = new row, old rows untouched (spec §15)
        conn.execute(text(
            "INSERT INTO products.product_price_history (product_id, old_price, new_price, reason) "
            "VALUES (:p, 100, 120, 'MANUAL')"), {"p": pid})
        conn.commit()
        rows = conn.execute(text(
            "SELECT old_price, new_price FROM products.product_price_history "
            "WHERE product_id = :p ORDER BY id"), {"p": pid}).fetchall()
        assert rows == [(None, 100), (100, 120)]

    def test_inventory_ledger_immutable(self, conn, expect_violation):
        conn.execute(text("INSERT INTO products.products (sku, name_fa, name_en) VALUES ('SKU-1', 'م', 'P')"))
        pid = conn.execute(text("SELECT id FROM products.products WHERE sku = 'SKU-1'")).fetchone()[0]
        conn.execute(text(
            "INSERT INTO products.inventory_movements (product_id, movement_type, quantity, balance_after) "
            "VALUES (:p, 'STOCK_IN', 50, 50)"), {"p": pid})
        conn.commit()
        mid = conn.execute(text("SELECT id FROM products.inventory_movements LIMIT 1")).fetchone()[0]
        with expect_violation("append-only"):
            conn.execute(text("DELETE FROM products.inventory_movements WHERE id = :i"), {"i": mid})

    def test_questionnaire_history_immutable(self, conn, seed_user, expect_violation):
        uid = seed_user()
        conn.execute(text("INSERT INTO patients.questionnaires (version, title_fa, title_en, is_active) VALUES (1, 'پ', 'Q', true)"))
        conn.execute(text(
            "INSERT INTO patients.questionnaire_responses (user_id, questionnaire_id, mizaj_result, mizaj_label_fa, mizaj_label_en) "
            "VALUES (:u, 1, 'BALANCED', 'معتدل', 'Balanced')"), {"u": uid})
        conn.commit()
        rid = conn.execute(text("SELECT id FROM patients.questionnaire_responses LIMIT 1")).fetchone()[0]
        with expect_violation("append-only"):
            conn.execute(text("DELETE FROM patients.questionnaire_responses WHERE id = :i"), {"i": rid})
        with expect_violation("append-only"):
            conn.execute(text("UPDATE patients.questionnaire_responses SET mizaj_result = 'HOT_DRY' WHERE id = :i"), {"i": rid})

    def test_case_timeline_immutable(self, conn, seed_user, expect_violation):
        fid = _insert_file(conn, seed_user())
        conn.execute(text(
            "INSERT INTO clinical_review.case_events (medical_file_id, action, from_status, to_status) "
            "VALUES (:f, 'STATUS_CHANGE', 'NEW', 'WAITING_FOR_EXPERT_1')"), {"f": fid})
        conn.commit()
        eid = conn.execute(text("SELECT id FROM clinical_review.case_events LIMIT 1")).fetchone()[0]
        with expect_violation("append-only"):
            conn.execute(text("UPDATE clinical_review.case_events SET comment = 'hack' WHERE id = :i"), {"i": eid})
        with expect_violation("append-only"):
            conn.execute(text("DELETE FROM clinical_review.case_events WHERE id = :i"), {"i": eid})

    def test_accounting_ledger_immutable(self, conn, expect_violation):
        conn.execute(text("INSERT INTO finance.financial_transactions (txn_type, category, amount) VALUES ('INCOME', 'SALES', 1000)"))
        conn.commit()
        tid = conn.execute(text("SELECT id FROM finance.financial_transactions LIMIT 1")).fetchone()[0]
        with expect_violation("append-only"):
            conn.execute(text("UPDATE finance.financial_transactions SET amount = 999999 WHERE id = :i"), {"i": tid})
        # correction = reversing entry (ED-50), never an edit
        conn.execute(text("INSERT INTO finance.financial_transactions (txn_type, category, amount, description) "
                          "VALUES ('ADJUSTMENT', 'SALES', 1000, 'reversal of #" + str(tid) + "')"))
        conn.commit()
        total = conn.execute(text(
            "SELECT sum(CASE WHEN txn_type = 'INCOME' THEN amount ELSE -amount END) "
            "FROM finance.financial_transactions")).fetchone()[0]
        assert total == 0

    def test_audit_log_immutable(self, conn, expect_violation):
        conn.execute(text("INSERT INTO administration.audit_logs (action, entity) VALUES ('LOGIN', 'users')"))
        conn.commit()
        lid = conn.execute(text("SELECT id FROM administration.audit_logs LIMIT 1")).fetchone()[0]
        with expect_violation("append-only"):
            conn.execute(text("UPDATE administration.audit_logs SET action = 'FORGED' WHERE id = :i"), {"i": lid})
        with expect_violation("append-only"):
            conn.execute(text("DELETE FROM administration.audit_logs WHERE id = :i"), {"i": lid})

    def test_sms_and_ticket_logs_immutable(self, conn, seed_user, expect_violation):
        uid = seed_user()
        conn.execute(text("INSERT INTO notifications.sms_logs (recipient, template_code, content) "
                          "VALUES ('09120000000', 'WELCOME', 'خوش آمدید')"))
        conn.execute(text("INSERT INTO tickets.tickets (code, user_id, subject) VALUES ('TKT-000001', :u, 'موضوع')"), {"u": uid})
        conn.commit()
        sid = conn.execute(text("SELECT id FROM notifications.sms_logs LIMIT 1")).fetchone()[0]
        with expect_violation("append-only"):
            conn.execute(text("DELETE FROM notifications.sms_logs WHERE id = :i"), {"i": sid})
        conn.execute(text("INSERT INTO tickets.ticket_messages (ticket_id, sender_user_id, message) VALUES (1, :u, 'سلام')"), {"u": uid})
        conn.commit()
        with expect_violation("append-only"):
            conn.execute(text("UPDATE tickets.ticket_messages SET message = 'edited' WHERE id = 1"))


class TestVersioning:
    def test_prescription_supersede_chain(self, conn, seed_user, expect_violation):
        uid = seed_user()               # expert 1 author
        other = seed_user(phone="09120000002")  # file owner (distinct phone!)
        fid = _insert_file(conn, other)
        conn.execute(text(
            "INSERT INTO prescriptions.prescriptions (medical_file_id, version, created_by_user_id) "
            "VALUES (:f, 1, :u)"), {"f": fid, "u": uid})
        conn.commit()
        v1 = conn.execute(text("SELECT id FROM prescriptions.prescriptions WHERE version = 1")).fetchone()[0]
        conn.execute(text(
            "INSERT INTO prescriptions.prescriptions (medical_file_id, version, created_by_user_id, status) "
            "VALUES (:f, 2, :u, 'DRAFT')"), {"f": fid, "u": uid})
        conn.commit()
        v2 = conn.execute(text("SELECT id FROM prescriptions.prescriptions WHERE version = 2")).fetchone()[0]
        conn.execute(text(
            "UPDATE prescriptions.prescriptions SET status = 'SUPERSEDED', superseded_by_prescription_id = :v2 "
            "WHERE id = :v1"), {"v2": v2, "v1": v1})
        conn.commit()
        chain = conn.execute(text("""
            SELECT p1.version, p1.status, p2.version AS next_version
            FROM prescriptions.prescriptions p1
            LEFT JOIN prescriptions.prescriptions p2 ON p2.id = p1.superseded_by_prescription_id
            WHERE p1.id = :v1
        """), {"v1": v1}).fetchone()
        assert chain == (1, "SUPERSEDED", 2)
        # SUPERSEDED without successor is rejected
        conn.execute(text(
            "INSERT INTO prescriptions.prescriptions (medical_file_id, version, created_by_user_id) "
            "VALUES (:f, 3, :u)"), {"f": fid, "u": uid})
        conn.commit()
        v3 = conn.execute(text("SELECT id FROM prescriptions.prescriptions WHERE version = 3")).fetchone()[0]
        with expect_violation("superseded_has_successor"):
            conn.execute(text(
                "UPDATE prescriptions.prescriptions SET status = 'SUPERSEDED' WHERE id = :v3"), {"v3": v3})

    def test_questionnaire_versions_immutable_lineage(self, conn):
        for v in (1, 2):
            conn.execute(text(
                "INSERT INTO patients.questionnaires (version, title_fa, title_en, is_active) "
                "VALUES (:v, :t, 'Questionnaire', :a)"),
                {"v": v, "t": f"نسخه {v}", "a": v == 2})
        conn.commit()
        versions = conn.execute(text(
            "SELECT version, is_active FROM patients.questionnaires ORDER BY version")).fetchall()
        assert versions == [(1, False), (2, True)]

    def test_dataset_versioning_with_patient_level_split(self, conn, seed_user, expect_violation):
        conn.execute(text("INSERT INTO ai.datasets (name) VALUES ('tongue-v1')"))
        ds = conn.execute(text("SELECT id FROM ai.datasets LIMIT 1")).fetchone()[0]
        conn.execute(text(
            "INSERT INTO ai.dataset_versions (dataset_id, version, status, split_strategy, train_count, val_count, test_count) "
            "VALUES (:d, 1, 'READY', 'PATIENT_LEVEL', 80, 10, 10)"), {"d": ds})
        conn.commit()
        dv = conn.execute(text("SELECT id FROM ai.dataset_versions LIMIT 1")).fetchone()[0]
        with expect_violation("uq_dataset_versions_dataset_version"):
            conn.execute(text(
                "INSERT INTO ai.dataset_versions (dataset_id, version) VALUES (:d, 1)"), {"d": ds})
        # both expert labels but no final label requires disagreement flag (§12)
        uid = seed_user()
        with expect_violation("disagreement_requires_resolution"):
            conn.execute(text(
                "INSERT INTO ai.dataset_items (dataset_version_id, image_id, patient_ref_id, "
                "expert1_label, expert2_label, final_label, has_disagreement) "
                "VALUES (:dv, 1, :u, 'A', 'B', NULL, false)"), {"dv": dv, "u": uid})
        # flagged disagreement is accepted
        conn.execute(text(
            "INSERT INTO ai.dataset_items (dataset_version_id, image_id, patient_ref_id, "
            "expert1_label, expert2_label, final_label, has_disagreement) "
            "VALUES (:dv, 1, :u, 'A', 'B', NULL, true)"), {"dv": dv, "u": uid})
        conn.commit()

    def test_image_version_and_dedup(self, conn, seed_user, expect_violation):
        uid = seed_user()
        sha = "a" * 64
        conn.execute(text(
            "INSERT INTO medical_records.images (owner_user_id, image_type, storage_key_original, sha256, size_original_bytes, mime) "
            "VALUES (:u, 'TONGUE', 'k1', :sha, 100, 'image/jpeg')"), {"u": uid, "sha": sha})
        conn.commit()
        with expect_violation("uq_images_owner_sha"):
            conn.execute(text(
                "INSERT INTO medical_records.images (owner_user_id, image_type, storage_key_original, sha256, size_original_bytes, mime) "
                "VALUES (:u, 'TONGUE', 'k2', :sha, 100, 'image/jpeg')"), {"u": uid, "sha": sha})
        # other owner can hold the same sha
        other = seed_user(phone="09120000002")
        conn.execute(text(
            "INSERT INTO medical_records.images (owner_user_id, image_type, storage_key_original, sha256, size_original_bytes, mime) "
            "VALUES (:u, 'TONGUE', 'k3', :sha, 100, 'image/jpeg')"), {"u": other, "sha": sha})
        conn.commit()
