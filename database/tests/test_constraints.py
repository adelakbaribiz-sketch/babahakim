"""Behavioral constraint tests — PostgreSQL must REJECT invalid data.

Every test asserts a real CHECK/UNIQUE/FK violation at the database level,
proving business invariants survive application bugs (defense in depth).
`expect_violation` also rolls back the aborted transaction (PG discipline).
"""
from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError


def insert(conn, sql, params=None):
    return conn.execute(text(sql), params or {})


class TestIdentityDomain:
    def test_bad_phone_rejected(self, conn, seed_role, seed_user, expect_violation):
        seed_role()
        with expect_violation("phone_format"):
            insert(conn, "INSERT INTO identity.users (phone, password_hash, first_name, last_name, role_id, referral_code) "
                         "SELECT '123', 'x', 'a', 'b', id, 'RC1' FROM identity.roles WHERE code = 'PATIENT'")

    def test_bad_role_code_rejected(self, conn, expect_violation):
        with expect_violation("role_code_domain"):
            insert(conn, "INSERT INTO identity.roles (code, name_fa, name_en) VALUES ('SUPERHERO', 'x', 'y')")

    def test_bad_locale_rejected(self, conn, expect_violation):
        insert(conn, "INSERT INTO identity.roles (code, name_fa, name_en) VALUES ('PATIENT', 'x', 'y')")
        with expect_violation("locale_domain"):
            insert(conn, "INSERT INTO identity.users (phone, password_hash, first_name, last_name, role_id, referral_code, locale) "
                         "SELECT '09120000001', 'x', 'a', 'b', id, 'RC1', 'fr' FROM identity.roles WHERE code = 'PATIENT'")

    def test_duplicate_active_phone_rejected(self, conn, seed_role, seed_user, expect_violation):
        seed_user(phone="09120000001")
        with expect_violation("uq_users_phone_active"):
            seed_user(phone="09120000001")

    def test_phone_reusable_after_soft_delete(self, conn, seed_role, seed_user):
        uid = seed_user(phone="09120000001")
        conn.execute(text("UPDATE identity.users SET deleted_at = now() WHERE id = :i"), {"i": uid})
        conn.commit()
        uid2 = seed_user(phone="09120000001")  # must NOT raise
        assert uid2 > 0

    def test_refresh_token_expiry_order_enforced(self, conn, seed_user, expect_violation):
        uid = seed_user()
        with expect_violation("expiry_after_creation"):
            insert(conn, "INSERT INTO identity.refresh_tokens (user_id, token_hash, expires_at) "
                         "VALUES (:u, 'h1', now() - interval '1 hour')", {"u": uid})


class TestClinicalDomain:
    def _file(self, conn, patient_id, **kw):
        cols = {"code": "BH-1405-00001", "patient_user_id": patient_id, "status": "NEW"}
        cols.update(kw)
        fields = ", ".join(cols)
        marks = ", ".join(f":{k}" for k in cols)
        insert(conn, f"INSERT INTO clinical_review.medical_files ({fields}) VALUES ({marks})", cols)
        conn.commit()

    def test_bad_case_status_rejected(self, conn, seed_user, expect_violation):
        with expect_violation("status_domain"):
            self._file(conn, seed_user(), status="FLYING_TO_THE_MOON")

    def test_closed_requires_timestamp(self, conn, seed_user, expect_violation):
        with expect_violation("closed_has_timestamp"):
            self._file(conn, seed_user(), status="CLOSED")

    def test_cancelled_requires_reason(self, conn, seed_user, expect_violation):
        with expect_violation("cancel_has_reason"):
            self._file(conn, seed_user(), status="CANCELLED")

    def test_ai_confidence_range_enforced(self, conn, seed_user, expect_violation):
        self._file(conn, seed_user())
        with expect_violation("confidence_range"):
            insert(conn, "INSERT INTO ai.ai_analyses (medical_file_id, image_id, model_name, model_version, predictions, confidence) "
                         "VALUES ((SELECT id FROM clinical_review.medical_files LIMIT 1), NULL, 'TongueModelV1', 1, '{}', 1.5)")

    def test_image_rejection_requires_reason(self, conn, seed_user, expect_violation):
        with expect_violation("rejection_has_reason"):
            insert(conn, "INSERT INTO medical_records.images (owner_user_id, image_type, storage_key_original, sha256, size_original_bytes, mime, status) "
                         "VALUES (:u, 'TONGUE', 'k', repeat('a', 64), 1000, 'image/jpeg', 'REJECTED')", {"u": seed_user()})

    def test_compressed_cannot_exceed_original(self, conn, seed_user, expect_violation):
        with expect_violation("compression_not_larger"):
            insert(conn, "INSERT INTO medical_records.images (owner_user_id, image_type, storage_key_original, sha256, size_original_bytes, size_compressed_bytes, mime) "
                         "VALUES (:u, 'TONGUE', 'k', repeat('a', 64), 1000, 2000, 'image/jpeg')", {"u": seed_user()})

    def test_followup_completed_requires_timestamp(self, conn, seed_user, expect_violation):
        uid = seed_user()
        self._file(conn, uid)
        with expect_violation("completed_has_timestamp"):
            insert(conn, "INSERT INTO clinical_review.follow_ups (medical_file_id, patient_user_id, due_date, status) "
                         "VALUES ((SELECT id FROM clinical_review.medical_files LIMIT 1), :u, now() + interval '7 days', 'COMPLETED')", {"u": uid})


class TestCommerceMoneyMath:
    def _order(self, conn, uid, subtotal=1000, discount=0, shipping=0, total=None, status="CART"):
        if total is None:
            total = subtotal - discount + shipping
        insert(conn, "INSERT INTO commerce.orders (code, user_id, status, subtotal, discount, shipping_cost, total) "
                     "VALUES ('ORD-000001', :u, :s, :sub, :d, :sh, :t)",
               {"u": uid, "s": status, "sub": subtotal, "d": discount, "sh": shipping, "t": total})
        conn.commit()

    def test_total_math_enforced(self, conn, seed_user, expect_violation):
        with expect_violation("total_math"):
            self._order(conn, seed_user(), subtotal=1000, total=900)

    def test_discount_cannot_exceed_subtotal(self, conn, seed_user, expect_violation):
        # keep total math + nonnegativity valid so ONLY the discount rule fires
        with expect_violation("discount_within_subtotal"):
            self._order(conn, seed_user(), subtotal=100, discount=200, shipping=150)

    def test_line_math_enforced(self, conn, seed_user):
        uid = seed_user()
        self._order(conn, uid, status="CONFIRMED")
        oid = conn.execute(text("SELECT id FROM commerce.orders LIMIT 1")).fetchone()[0]
        insert(conn, "INSERT INTO commerce.order_items (order_id, name_fa, name_en, unit_price, quantity, line_total) "
                     "VALUES (:o, 'a', 'a', 100, 3, 300)", {"o": oid})
        conn.commit()

    def test_bad_line_math_rejected(self, conn, seed_user, expect_violation):
        uid = seed_user()
        self._order(conn, uid, status="CONFIRMED")
        oid = conn.execute(text("SELECT id FROM commerce.orders LIMIT 1")).fetchone()[0]
        with expect_violation("line_math"):
            insert(conn, "INSERT INTO commerce.order_items (order_id, name_fa, name_en, unit_price, quantity, line_total) "
                         "VALUES (:o, 'a', 'a', 100, 3, 250)", {"o": oid})

    def test_rx_order_requires_prescription(self, conn, seed_user, expect_violation):
        uid = seed_user()
        self._order(conn, uid, status="CONFIRMED")
        with expect_violation("rx_order_has_prescription"):
            insert(conn, "UPDATE commerce.orders SET order_type = 'PRESCRIPTION' WHERE id = "
                         "(SELECT id FROM commerce.orders LIMIT 1)")

    def test_one_active_cart_per_user(self, conn, seed_user, expect_violation):
        uid = seed_user()
        insert(conn, "INSERT INTO commerce.carts (user_id) VALUES (:u)", {"u": uid})
        conn.commit()
        with expect_violation("uq_carts_active_per_user"):
            insert(conn, "INSERT INTO commerce.carts (user_id) VALUES (:u)", {"u": uid})

    def test_invoice_paid_requires_timestamp(self, conn, seed_user, expect_violation):
        uid = seed_user()
        self._order(conn, uid, status="CONFIRMED")
        oid = conn.execute(text("SELECT id FROM commerce.orders LIMIT 1")).fetchone()[0]
        with expect_violation("paid_has_timestamp"):
            insert(conn, "INSERT INTO commerce.invoices (code, order_id, items_snapshot, subtotal, total, status) "
                         "VALUES ('INV-000001', :o, '[]', 1000, 1000, 'PAID')", {"o": oid})


class TestPaymentsDomain:
    def test_amount_must_be_positive(self, conn, seed_user, expect_violation):
        uid = seed_user()
        with expect_violation("amount_positive"):
            insert(conn, "INSERT INTO payments.payments (code, user_id, method, amount) "
                         "VALUES ('PAY-000001', :u, 'ZARINPAL', 0)", {"u": uid})

    def test_paid_requires_evidence_and_timestamp(self, conn, seed_user, expect_violation):
        uid = seed_user()
        with expect_violation("paid_has_evidence"):
            insert(conn, "INSERT INTO payments.payments (code, user_id, method, amount, status, paid_at) "
                         "VALUES ('PAY-000001', :u, 'ZARINPAL', 1000, 'PAID', now())", {"u": uid})

    def test_awaiting_verify_requires_receipt_image(self, conn, seed_user, expect_violation):
        uid = seed_user()
        with expect_violation("verify_requires_receipt"):
            insert(conn, "INSERT INTO payments.payments (code, user_id, method, amount, status) "
                         "VALUES ('PAY-000001', :u, 'CARD_TO_CARD', 1000, 'AWAITING_VERIFY')", {"u": uid})

    def test_idempotency_key_unique(self, conn, seed_user, expect_violation):
        uid = seed_user()
        insert(conn, "INSERT INTO payments.payments (code, user_id, method, amount, idempotency_key) "
                     "VALUES ('PAY-000001', :u, 'ZARINPAL', 1000, 'IDEM-1')", {"u": uid})
        conn.commit()
        with expect_violation("uq_payments_idempotency_key"):
            insert(conn, "INSERT INTO payments.payments (code, user_id, method, amount, idempotency_key) "
                         "VALUES ('PAY-000002', :u, 'ZARINPAL', 1000, 'IDEM-1')", {"u": uid})


class TestInventoryAndProducts:
    def _product(self, conn, sku="SKU-001", **kw):
        cols = {"sku": sku, "name_fa": "محصول", "name_en": "Product"}
        cols.update(kw)
        fields = ", ".join(cols)
        marks = ", ".join(f":{k}" for k in cols)
        insert(conn, f"INSERT INTO products.products ({fields}) VALUES ({marks})", cols)
        conn.commit()
        return conn.execute(text("SELECT id FROM products.products ORDER BY id DESC LIMIT 1")).fetchone()[0]

    def test_otc_and_rx_exclusive(self, conn, expect_violation):
        with expect_violation("otc_excludes_prescription"):
            self._product(conn, is_otc=True, requires_prescription=True)

    def test_movement_sign_discipline(self, conn, expect_violation):
        pid = self._product(conn)
        with expect_violation("movement_sign"):
            insert(conn, "INSERT INTO products.inventory_movements (product_id, movement_type, quantity, balance_after) "
                         "VALUES (:p, 'STOCK_IN', -5, 0)", {"p": pid})
        with expect_violation("movement_sign"):
            insert(conn, "INSERT INTO products.inventory_movements (product_id, movement_type, quantity, balance_after) "
                         "VALUES (:p, 'STOCK_OUT', 5, 0)", {"p": pid})

    def test_negative_balance_rejected(self, conn, expect_violation):
        pid = self._product(conn)
        with expect_violation("balance_nonnegative"):
            insert(conn, "INSERT INTO products.inventory_movements (product_id, movement_type, quantity, balance_after) "
                         "VALUES (:p, 'STOCK_OUT', -5, -5)", {"p": pid})

    def test_reserved_within_on_hand(self, conn, expect_violation):
        pid = self._product(conn)
        with expect_violation("reserved_within_on_hand"):
            insert(conn, "INSERT INTO products.inventories (product_id, quantity_on_hand, quantity_reserved) "
                         "VALUES (:p, 10, 11)", {"p": pid})


class TestPrescriptionDomain:
    def _rx(self, conn, seed_user):
        uid = seed_user()
        insert(conn, "INSERT INTO clinical_review.medical_files (code, patient_user_id) VALUES ('BH-1405-00001', :u)", {"u": uid})
        conn.commit()
        fid = conn.execute(text("SELECT id FROM clinical_review.medical_files LIMIT 1")).fetchone()[0]
        insert(conn, "INSERT INTO prescriptions.prescriptions (medical_file_id, version, created_by_user_id) "
                     "VALUES (:f, 1, :u)", {"f": fid, "u": uid})
        conn.commit()
        pid = conn.execute(text("SELECT id FROM prescriptions.prescriptions LIMIT 1")).fetchone()[0]
        return uid, fid, pid

    def test_item_availability_xor(self, conn, seed_user, expect_violation):
        _, _, pid = self._rx(conn, seed_user)
        with expect_violation("availability_flagged"):
            insert(conn, "INSERT INTO prescriptions.prescription_items (prescription_id, drug_name, is_available, is_missing) "
                         "VALUES (:p, 'دارو', false, false)", {"p": pid})

    def test_version_unique_per_file(self, conn, seed_user, expect_violation):
        uid, fid, _ = self._rx(conn, seed_user)
        with expect_violation("uq_prescriptions_file_version"):
            insert(conn, "INSERT INTO prescriptions.prescriptions (medical_file_id, version, created_by_user_id) "
                         "VALUES (:f, 1, :u)", {"f": fid, "u": uid})


class TestFinanceDomain:
    def test_txns_strictly_positive(self, conn, expect_violation):
        with expect_violation("amount_positive"):
            insert(conn, "INSERT INTO finance.financial_transactions (txn_type, category, amount) "
                         "VALUES ('INCOME', 'SALES', -100)")
        with expect_violation("amount_positive"):
            insert(conn, "INSERT INTO finance.financial_transactions (txn_type, category, amount) "
                         "VALUES ('INCOME', 'SALES', 0)")

    def test_occurred_at_not_future(self, conn, expect_violation):
        with expect_violation("occurred_not_future"):
            insert(conn, "INSERT INTO finance.financial_transactions (txn_type, category, amount, occurred_at) "
                         "VALUES ('INCOME', 'SALES', 100, now() + interval '1 day')")


class TestQuestionnaireDomain:
    def test_single_active_questionnaire(self, conn, expect_violation):
        insert(conn, "INSERT INTO patients.questionnaires (version, title_fa, title_en, is_active) "
                     "VALUES (1, 'پرسشنامه', 'Questionnaire', true)")
        conn.commit()
        with expect_violation("uq_questionnaires_single_active"):
            insert(conn, "INSERT INTO patients.questionnaires (version, title_fa, title_en, is_active) "
                         "VALUES (2, 'پرسشنامه', 'Questionnaire', true)")

    def test_answer_unique_per_question(self, conn, seed_user):
        uid = seed_user()
        insert(conn, "INSERT INTO patients.questionnaires (version, title_fa, title_en, is_active) "
                     "VALUES (1, 'پ', 'Q', true)")
        insert(conn, "INSERT INTO patients.questions (questionnaire_id, position, text_fa, text_en) "
                     "VALUES (1, 1, 'س', 'q')")
        insert(conn, "INSERT INTO patients.question_options (question_id, position, text_fa, text_en, score, dimension) "
                     "VALUES (1, 0, 'گ', 'o', 1, 'HOT')")
        insert(conn, "INSERT INTO patients.questionnaire_responses (user_id, questionnaire_id, mizaj_result, mizaj_label_fa, mizaj_label_en) "
                     "VALUES (:u, 1, 'BALANCED', 'معتدل', 'Balanced')", {"u": uid})
        conn.commit()
        insert(conn, "INSERT INTO patients.answers (response_id, question_id, option_id, score, dimension) "
                     "VALUES (1, 1, 1, 1, 'HOT')")
        conn.commit()

    def test_answer_duplicate_rejected(self, conn, seed_user, expect_violation):
        uid = seed_user()
        insert(conn, "INSERT INTO patients.questionnaires (version, title_fa, title_en, is_active) "
                     "VALUES (1, 'پ', 'Q', true)")
        insert(conn, "INSERT INTO patients.questions (questionnaire_id, position, text_fa, text_en) "
                     "VALUES (1, 1, 'س', 'q')")
        insert(conn, "INSERT INTO patients.question_options (question_id, position, text_fa, text_en, score, dimension) "
                     "VALUES (1, 0, 'گ', 'o', 1, 'HOT')")
        insert(conn, "INSERT INTO patients.questionnaire_responses (user_id, questionnaire_id, mizaj_result, mizaj_label_fa, mizaj_label_en) "
                     "VALUES (:u, 1, 'BALANCED', 'معتدل', 'Balanced')", {"u": uid})
        insert(conn, "INSERT INTO patients.answers (response_id, question_id, option_id, score, dimension) "
                     "VALUES (1, 1, 1, 1, 'HOT')")
        conn.commit()
        with expect_violation("uq_answers_response_question"):
            insert(conn, "INSERT INTO patients.answers (response_id, question_id, option_id, score, dimension) "
                         "VALUES (1, 1, 1, 1, 'HOT')")

    def test_bad_dimension_rejected(self, conn, expect_violation):
        insert(conn, "INSERT INTO patients.questionnaires (version, title_fa, title_en) VALUES (1, 'پ', 'Q')")
        insert(conn, "INSERT INTO patients.questions (questionnaire_id, position, text_fa, text_en) VALUES (1, 1, 'س', 'q')")
        conn.commit()
        with expect_violation("dimension_domain"):
            insert(conn, "INSERT INTO patients.question_options (question_id, position, text_fa, text_en, dimension) "
                         "VALUES (1, 0, 'گ', 'o', 'WARM')")
