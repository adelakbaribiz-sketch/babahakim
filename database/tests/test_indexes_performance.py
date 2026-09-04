"""Performance index tests — existence, partial predicates, access paths.

EXPLAIN-based assertions force index usage (enable_seqscan=off) for the
platform's hot queries (staff queues, unread inbox, due follow-ups, search).
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def plan_of(conn, sql, params=None):
    rows = conn.execute(text(f"EXPLAIN (FORMAT TEXT) {sql}"), params or {}).fetchall()
    return "\n".join(r[0] for r in rows)


@pytest.fixture()
def hot_data(conn, seed_role, seed_user):
    """Seed realistic volumes for planner checks (no real medical data — C5)."""
    patient_ids = [seed_user(phone=f"09120000{i:03d}") for i in range(1, 21)]
    # medical files across statuses (terminal states carry their evidence — CHECK)
    statuses = ["NEW", "WAITING_FOR_EXPERT_1", "EXPERT_1_REVIEW", "WAITING_FOR_DOCTOR",
                "PAYMENT_CONFIRMED", "CLOSED"]
    for i in range(60):
        status = statuses[i % len(statuses)]
        closed_at = "now()" if status == "CLOSED" else "NULL"
        closing_note = "'پایان'" if status == "CLOSED" else "NULL"
        conn.execute(text(
            f"INSERT INTO clinical_review.medical_files (code, patient_user_id, status, priority, created_at, closed_at, closing_note) "
            f"VALUES (:c, :u, :s, 'NORMAL', now() - (:i || ' hours')::interval, {closed_at}, {closing_note})"),
            {"c": f"BH-1405-{i:05d}", "u": patient_ids[i % 20], "s": status, "i": i})
    # follow-ups
    for i in range(30):
        conn.execute(text(
            "INSERT INTO clinical_review.follow_ups (medical_file_id, patient_user_id, due_date, status) "
            "VALUES (:f, :u, now() + (:d || ' days')::interval, :s)"),
            {"f": i + 1, "u": patient_ids[i % 20], "d": i - 10, "s": "PENDING" if i % 2 else "DUE"})
    # notifications
    for i in range(40):
        conn.execute(text(
            "INSERT INTO notifications.notifications (user_id, event_code, title_fa, title_en, is_read) "
            "VALUES (:u, 'CASE_PAYMENT_CONFIRMED', 'ع', 'N', :r)"),
            {"u": patient_ids[i % 20], "r": i % 3 == 0})
    # products for trgm search
    names = ["شربت بابونه", "شربت زعفران", "قرص گل گاوزبان", "روغن بابونه کوهی",
             "پماد آلوئه ورا", "دمنوش بهار نارنج", "عسل کوهی بابا", "پودر ریشه چای ترش"]
    for i, n in enumerate(names * 3):
        conn.execute(text(
            "INSERT INTO products.products (sku, name_fa, name_en) VALUES (:s, :n, 'Product')"),
            {"s": f"SKU-{i:04d}", "n": n})
    # audit log sample
    for i in range(30):
        conn.execute(text(
            "INSERT INTO administration.audit_logs (action, entity, entity_id, is_sensitive) "
            "VALUES ('VIEW_MEDICAL_FILE', 'medical_files', :i, :s)"),
            {"i": i + 1, "s": i % 5 == 0})
    conn.execute(text("ANALYZE"))
    conn.commit()
    return patient_ids


@pytest.fixture()
def no_seqscan(conn):
    conn.execute(text("SET enable_seqscan = off"))
    yield
    conn.execute(text("SET enable_seqscan = on"))
    conn.commit()


class TestIndexCatalogue:
    CRITICAL_INDEXES = [
        "ix_medical_files_status", "ix_medical_files_expert1_queue",
        "ix_medical_files_expert2_queue", "ix_medical_files_doctor_queue",
        "ix_medical_files_patient_time", "ix_medical_files_followup_due",
        "ix_follow_ups_due_scan", "ix_notifications_unread",
        "ix_notifications_user_time", "ix_orders_user_time", "ix_orders_status_time",
        "ix_payments_order", "ix_payments_user_time", "ix_payments_status_time",
        "ix_invoices_order", "ix_tickets_status_updated", "ix_tickets_user_updated",
        "ix_case_events_file_time", "ix_audit_logs_actor_time", "ix_audit_logs_entity",
        "ix_dataset_items_version_split", "ix_dataset_items_patient",
        "ix_prescriptions_file_status", "ix_questionnaire_responses_user_time",
        "ix_inventories_low_stock", "ix_contact_logs_user_time",
        "ix_financial_txns_type_time", "ix_ai_analyses_medical_file",
        "ix_images_medical_file", "ix_shipments_status_time",
        "ix_expert_reviews_file_stage_time", "ix_doctor_reviews_file",
        "ix_referrals_referrer", "ix_answers_question", "ix_question_options_question",
    ]

    def test_critical_indexes_exist(self, conn):
        rows = conn.execute(text(
            "SELECT indexname FROM pg_indexes WHERE schemaname = ANY(:s)"
        ), {"s": ["identity", "patients", "medical_records", "ai", "clinical_review",
                  "products", "prescriptions", "commerce", "payments", "shipping",
                  "notifications", "tickets", "finance", "administration", "reporting"]}
        ).fetchall()
        present = {r[0] for r in rows}
        missing = [i for i in self.CRITICAL_INDEXES if i not in present]
        assert missing == [], f"missing critical indexes: {missing}"

    def test_brin_indexes_for_append_only_streams(self, conn):
        rows = conn.execute(text("""
            SELECT indexname FROM pg_indexes
            WHERE schemaname = ANY(ARRAY['administration', 'clinical_review',
                'notifications', 'finance'])
              AND indexdef LIKE '%USING brin%'
        """)).fetchall()
        brins = {r[0] for r in rows}
        assert {"brin_audit_logs_created_at", "brin_case_events_created_at",
                "brin_sms_logs_created_at", "brin_financial_txns_occurred_at"} <= brins

    def test_trgm_gin_indexes_for_search(self, conn):
        rows = conn.execute(text("""
            SELECT indexdef FROM pg_indexes
            WHERE indexname LIKE '%trgm%' AND indexdef LIKE '%USING gin%'
        """)).fetchall()
        assert len(rows) >= 4, "expected 4 trgm GIN indexes (products fa/en + diseases fa/en)"


class TestHotQueryAccessPaths:
    def test_case_queue_uses_partial_status_index(self, conn, hot_data, no_seqscan):
        plan = plan_of(conn, "SELECT id, status FROM clinical_review.medical_files "
                             "WHERE deleted_at IS NULL AND status = 'WAITING_FOR_EXPERT_1' "
                             "ORDER BY created_at")
        assert "Index Scan" in plan or "Bitmap" in plan
        assert "ix_medical_files" in plan

    def test_expert_queue_uses_queue_index(self, conn, hot_data, no_seqscan):
        plan = plan_of(conn, "SELECT id FROM clinical_review.medical_files "
                             "WHERE assigned_expert1_user_id = 1 AND deleted_at IS NULL")
        assert "ix_medical_files_expert1_queue" in plan

    def test_unread_inbox_uses_partial_index(self, conn, hot_data, no_seqscan):
        # filter-only shape targets the partial unread index directly
        plan = plan_of(conn, "SELECT id FROM notifications.notifications "
                             "WHERE user_id = 1 AND is_read = false")
        assert "ix_notifications_unread" in plan
        # ordered inbox variant must also be index-driven (composite)
        plan = plan_of(conn, "SELECT id FROM notifications.notifications "
                             "WHERE user_id = 1 AND is_read = false ORDER BY created_at DESC")
        assert "ix_notifications" in plan

    def test_due_followups_uses_composite_index(self, conn, hot_data, no_seqscan):
        plan = plan_of(conn, "SELECT id FROM clinical_review.follow_ups "
                             "WHERE status IN ('PENDING', 'DUE', 'OVERDUE') AND due_date < now() "
                             "ORDER BY due_date")
        assert "ix_follow_ups_due_scan" in plan

    def test_patient_timeline_uses_composite_index(self, conn, hot_data, no_seqscan):
        plan = plan_of(conn, "SELECT id FROM clinical_review.case_events "
                             "WHERE medical_file_id = 1 ORDER BY created_at DESC")
        assert "ix_case_events_file_time" in plan

    def test_user_orders_uses_composite_index(self, conn, hot_data, no_seqscan):
        plan = plan_of(conn, "SELECT id FROM commerce.orders WHERE user_id = 1 "
                             "ORDER BY created_at DESC")
        assert "ix_orders_user_time" in plan

    def test_trgm_similarity_search_uses_gin(self, conn, hot_data, no_seqscan):
        # btree paths off -> the `%` operator can only be served by the trgm GIN
        conn.execute(text("SET enable_indexscan = off"))
        conn.execute(text("SET enable_indexonlyscan = off"))
        plan = plan_of(conn, "SELECT id FROM products.products WHERE name_fa % 'بابونه'")
        conn.execute(text("SET enable_indexscan = on"))
        conn.execute(text("SET enable_indexonlyscan = on"))
        assert "trgm" in plan, plan

    def test_trgm_similarity_actually_matches(self, conn, hot_data):
        rows = conn.execute(text(
            "SELECT name_fa FROM products.products WHERE name_fa % 'بابونه'")).fetchall()
        assert len(rows) >= 3, "trigram similarity must find بابونه-family products"
        assert all("بابونه" in r[0] or "بابا" in r[0] for r in rows)

    def test_softref_columns_are_indexed(self, conn, hot_data, no_seqscan):
        """Every hot soft-ref (user_id / medical_file_id / order_id) is index-backed (D4)."""
        plan = plan_of(conn, "SELECT id FROM clinical_review.medical_files WHERE patient_user_id = 1")
        assert "ix_medical_files_patient" in plan
        plan = plan_of(conn, "SELECT id FROM payments.payments WHERE order_id = 1")
        assert "ix_payments_order" in plan
        plan = plan_of(conn, "SELECT id FROM medical_records.images WHERE medical_file_id = 1")
        assert "ix_images_medical_file" in plan

    def test_low_stock_report_uses_partial_index(self, conn, hot_data, no_seqscan):
        conn.execute(text(
            "INSERT INTO products.inventories (product_id, quantity_on_hand, quantity_reserved, reorder_level) "
            "SELECT id, 2, 0, 10 FROM products.products LIMIT 5"))
        conn.commit()
        plan = plan_of(conn, "SELECT product_id FROM products.inventories "
                             "WHERE quantity_on_hand <= reorder_level")
        assert "ix_inventories_low_stock" in plan
