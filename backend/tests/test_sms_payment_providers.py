import sys
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import stripe

from sms_payment_attempts import (
    PaymentAttemptConflict, begin_provider_request, finish_provider_request, reserve_attempt,
)
from sms_payment_providers import (
    create_sms_mope_request, create_sms_stripe_intent, resume_sms_stripe_intent, verify_sms_provider_payment,
)
from test_sms_payment_attempts import Attempts


class PaymentProviderTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.collection = Attempts()
        self.db = SimpleNamespace(sms_payment_attempts=self.collection)
        self.client = object()

        async def preflight(_db, _client, *, key, attempt_id):
            stored = await self.collection.find_one({"_id": key, "attempt_id": attempt_id})
            if not stored or stored["attempt_id"] != attempt_id or stored["state"] != "reserved":
                raise PaymentAttemptConflict("Betaalpoging kan niet opnieuw worden gestart")
            return stored

        preflight_patch = patch("sms_payment_providers.preflight_reserved_payment", side_effect=preflight)
        self.preflight = preflight_patch.start()
        self.addCleanup(preflight_patch.stop)
        async def guard(_db, _client, *, key, attempt_id):
            self.collection.docs[key]["guard_owner"] = attempt_id
        guard_patch = patch("sms_payment_providers.guard_reserved_sms_attempt", side_effect=guard)
        guard_patch.start()
        self.addCleanup(guard_patch.stop)
        cancel_patch = patch("sms_payment_providers.cancel_reserved_sms_attempt", new_callable=AsyncMock)
        self.cancel = cancel_patch.start()
        self.addCleanup(cancel_patch.stop)

    async def _open(self, method):
        amount, currency = (10000, "SRD") if method == "mope" else (250, "EUR")
        attempt = await reserve_attempt(
            self.collection, company_id="c1", tenant_id="t1",
            item={"kind": "invoice", "id": "i1"}, method=method,
            amount_cents=10000, currency="SRD",
            provider_amount_cents=amount, provider_currency=currency,
            stripe_mode=None if method == "mope" else "test",
        )
        attempt["guard_owner"] = attempt["attempt_id"]
        self.collection.docs[attempt["_id"]]["guard_owner"] = attempt["attempt_id"]
        await begin_provider_request(self.collection, attempt)
        await finish_provider_request(self.collection, attempt, "provider_1")
        return attempt

    async def test_stripe_checks_provider_and_scope_before_verification(self):
        attempt = await self._open("card")
        payment = {
            "id": "provider_1", "livemode": False, "status": "succeeded",
            "amount": 250, "amount_received": 250, "currency": "eur",
            "payment_method_types": ["card"],
            "metadata": {"source": "surirent_sms_payment", "attempt_id": attempt["attempt_id"],
                         "company_id": "c1", "tenant_id": "t1"},
        }
        config = AsyncMock(return_value={"stripe_config": {"test": {"secret_key": "test-key"}}})
        fake_route = SimpleNamespace(_cfg_doc=config)
        retrieve = Mock(return_value=stripe.PaymentIntent.construct_from(payment, key=None))
        with patch.dict(sys.modules, {"routes.company_stripe": fake_route}), \
                patch("sms_payment_providers.stripe.PaymentIntent.retrieve", retrieve):
            for changed in (
                {"status": "processing"}, {"amount_received": 249}, {"amount": 251},
                {"livemode": True}, {"payment_method_types": ["ideal"]},
                {"metadata": {**payment["metadata"], "company_id": "other"}},
                {"metadata": {**payment["metadata"], "attempt_id": "other"}},
            ):
                retrieve.return_value = stripe.PaymentIntent.construct_from({**payment, **changed}, key=None)
                with self.subTest(changed=changed), self.assertRaises(PaymentAttemptConflict):
                    await verify_sms_provider_payment(self.collection, attempt["attempt_id"], attempt["_id"])
                self.assertEqual(self.collection.docs[attempt["_id"]]["state"], "open")
            retrieve.return_value = stripe.PaymentIntent.construct_from(payment, key=None)
            result = await verify_sms_provider_payment(self.collection, attempt["attempt_id"], attempt["_id"])
            self.assertEqual(result["state"], "verified")
            retrieve.assert_called_with("provider_1", api_key="test-key")
            config.assert_awaited_with("c1")

    async def test_resume_only_returns_secret_for_matching_unconfirmed_intent(self):
        attempt = await self._open("card")
        attempt = await self.collection.find_one({"_id": attempt["_id"], "attempt_id": attempt["attempt_id"]})
        payment = {
            "id": "provider_1", "livemode": False, "status": "requires_payment_method",
            "amount": 250, "currency": "eur", "client_secret": "secret",
            "payment_method_types": ["card"],
            "metadata": {"source": "surirent_sms_payment", "attempt_id": attempt["attempt_id"],
                         "company_id": "c1", "tenant_id": "t1"},
        }
        config = AsyncMock(return_value={"stripe_config": {"test": {
            "secret_key": "test-key", "publishable_key": "pk_test",
        }}})
        retrieve = Mock(return_value=stripe.PaymentIntent.construct_from(payment, key=None))
        with patch.dict(sys.modules, {"routes.company_stripe": SimpleNamespace(_cfg_doc=config)}), \
                patch("sms_payment_providers.stripe.PaymentIntent.retrieve", retrieve):
            for changed in (
                {"status": "processing"}, {"status": "succeeded"}, {"status": "requires_action"},
                {"id": "other"}, {"payment_method_types": ["ideal"]},
                {"amount": 251}, {"currency": "usd"}, {"livemode": True},
                {"metadata": {**payment["metadata"], "tenant_id": "other"}}, {"client_secret": None},
            ):
                retrieve.return_value = stripe.PaymentIntent.construct_from({**payment, **changed}, key=None)
                with self.subTest(changed=changed), self.assertRaises(PaymentAttemptConflict):
                    await resume_sms_stripe_intent(attempt)
            retrieve.return_value = stripe.PaymentIntent.construct_from(payment, key=None)
            result = await resume_sms_stripe_intent(attempt)
            self.assertEqual(result, {"client_secret": "secret", "publishable_key": "pk_test"})
            self.assertEqual(self.collection.docs[attempt["_id"]]["state"], "open")

    async def test_stripe_request_is_created_once_with_reserved_amount_and_identity(self):
        attempt = await reserve_attempt(
            self.collection, company_id="c1", tenant_id="t1",
            item={"kind": "invoice", "id": "i1"}, method="card",
            amount_cents=10000, currency="SRD", provider_amount_cents=250,
            provider_currency="EUR", stripe_mode="test",
        )
        fake_deps = SimpleNamespace(require_plan_feature=AsyncMock())
        fake_route = SimpleNamespace(
            _cfg_doc=AsyncMock(return_value={"stripe_config": {}}),
            _active=lambda _: {
                "enabled": True, "mode": "test", "methods": ["card"],
                "secret_key": "test-key", "publishable_key": "public-key",
            },
        )
        intent = {"id": "pi_123", "client_secret": "secret", "amount": 250,
                  "currency": "eur", "livemode": False}
        create = Mock(return_value=stripe.PaymentIntent.construct_from(intent, key=None))
        with patch.dict(sys.modules, {"routes": SimpleNamespace(_deps=fake_deps),
                                     "routes.company_stripe": fake_route}), \
                patch("sms_payment_providers.stripe.PaymentIntent.create", create):
            result = await create_sms_stripe_intent(self.db, self.client, attempt)
            self.assertEqual(result["payment_intent_id"], "pi_123")
            args = create.call_args.kwargs
            self.assertEqual(args["idempotency_key"], attempt["attempt_id"])
            self.assertEqual(args["metadata"]["tenant_id"], "t1")
            self.assertEqual(args["amount"], 250)
            self.assertNotIn("confirm", args)
            with self.assertRaises(PaymentAttemptConflict):
                await create_sms_stripe_intent(self.db, self.client, attempt)
            create.assert_called_once()
            self.assertNotIn("client_secret", self.collection.docs[attempt["_id"]])

    async def test_uncertain_stripe_creation_is_not_repeated(self):
        attempt = await reserve_attempt(
            self.collection, company_id="c1", tenant_id="t1",
            item={"kind": "invoice", "id": "i1"}, method="card",
            amount_cents=10000, currency="SRD", provider_amount_cents=250,
            provider_currency="EUR", stripe_mode="test",
        )
        fake_deps = SimpleNamespace(require_plan_feature=AsyncMock())
        fake_route = SimpleNamespace(
            _cfg_doc=AsyncMock(return_value={"stripe_config": {}}),
            _active=lambda _: {"enabled": True, "mode": "test", "methods": ["card"],
                               "secret_key": "test-key", "publishable_key": "public-key"},
        )
        with patch.dict(sys.modules, {"routes": SimpleNamespace(_deps=fake_deps),
                                     "routes.company_stripe": fake_route}), \
                patch("sms_payment_providers.stripe.PaymentIntent.create",
                      side_effect=stripe.error.StripeError("timeout")) as create:
            with self.assertRaises(PaymentAttemptConflict):
                await create_sms_stripe_intent(self.db, self.client, attempt)
            self.assertEqual(self.collection.docs[attempt["_id"]]["state"], "uncertain")
            with self.assertRaises(PaymentAttemptConflict):
                await create_sms_stripe_intent(self.db, self.client, attempt)
            create.assert_called_once()

    async def test_mope_checks_live_status_and_order_id(self):
        attempt = await self._open("mope")
        payment = {
            "id": "provider_1", "status": "paid", "amount": 10000,
            "currency": {"code": "SRD"},
            "meta_data": [{"key": "order_id", "value": attempt["attempt_id"]}],
        }
        response = SimpleNamespace(is_success=True)
        request = AsyncMock(return_value=response)
        config = AsyncMock(return_value={"api_token": "token"})
        payload = Mock(return_value=payment)
        fake_route = SimpleNamespace(
            _config=config, _request_api=request, _response_payload=payload, _provider_error=Mock(),
        )
        with patch.dict(sys.modules, {"routes.company_mope": fake_route}):
            for changed in (
                {"status": "open"}, {"amount": 9999}, {"currency": {"code": "EUR"}},
                {"id": "other"}, {"meta_data": [{"key": "order_id", "value": "other"}]},
                {"meta_data": []},
            ):
                payload.return_value = {**payment, **changed}
                with self.subTest(changed=changed), self.assertRaises(PaymentAttemptConflict):
                    await verify_sms_provider_payment(self.collection, attempt["attempt_id"], attempt["_id"])
                self.assertEqual(self.collection.docs[attempt["_id"]]["state"], "open")
            payload.return_value = payment
            result = await verify_sms_provider_payment(self.collection, attempt["attempt_id"], attempt["_id"])
            self.assertEqual(result["state"], "verified")
            request.assert_awaited_with("GET", "shop/payment_request/provider_1", "token")
            config.assert_awaited_with("c1")

    async def test_mope_request_uses_attempt_as_order_and_does_not_repeat(self):
        attempt = await reserve_attempt(
            self.collection, company_id="c1", tenant_id="t1",
            item={"kind": "invoice", "id": "i1"}, method="mope",
            amount_cents=10000, currency="SRD", provider_amount_cents=10000,
            provider_currency="SRD",
        )
        fake_deps = SimpleNamespace(
            require_plan_feature=AsyncMock(), public_url=lambda path: f"https://app.example.com{path}",
        )
        request = AsyncMock(return_value=SimpleNamespace(is_success=True))
        fake_route = SimpleNamespace(
            _config=AsyncMock(return_value={"api_token": "token"}), _active=lambda _: True,
            _request_api=request, _response_payload=lambda _: {"id": "payment-1", "url": "https://mope.sr/p/id"},
            _provider_error=Mock(),
        )
        with patch.dict(sys.modules, {"routes": SimpleNamespace(_deps=fake_deps),
                                     "routes.company_mope": fake_route}):
            result = await create_sms_mope_request(self.db, self.client, attempt)
            self.assertEqual(result["payment_id"], "payment-1")
            payload = request.await_args.args[3]
            self.assertEqual(payload["order_id"], attempt["attempt_id"])
            self.assertEqual((payload["amount"], payload["currency"]), (10000, "SRD"))
            self.assertEqual(payload["redirect_url"], "https://app.example.com/b/return")
            with self.assertRaises(PaymentAttemptConflict):
                await create_sms_mope_request(self.db, self.client, attempt)
            request.assert_awaited_once()

    async def test_uncertain_mope_creation_is_not_repeated(self):
        attempt = await reserve_attempt(
            self.collection, company_id="c1", tenant_id="t1",
            item={"kind": "invoice", "id": "i1"}, method="mope",
            amount_cents=10000, currency="SRD", provider_amount_cents=10000,
            provider_currency="SRD",
        )
        fake_deps = SimpleNamespace(
            require_plan_feature=AsyncMock(), public_url=lambda path: f"https://app.example.com{path}",
        )
        request = AsyncMock(side_effect=RuntimeError("timeout"))
        fake_route = SimpleNamespace(
            _config=AsyncMock(return_value={"api_token": "token"}), _active=lambda _: True,
            _request_api=request, _response_payload=Mock(), _provider_error=Mock(),
        )
        with patch.dict(sys.modules, {"routes": SimpleNamespace(_deps=fake_deps),
                                     "routes.company_mope": fake_route}):
            with self.assertRaises(RuntimeError):
                await create_sms_mope_request(self.db, self.client, attempt)
            self.assertEqual(self.collection.docs[attempt["_id"]]["state"], "uncertain")
            with self.assertRaises(PaymentAttemptConflict):
                await create_sms_mope_request(self.db, self.client, attempt)
            request.assert_awaited_once()

    async def test_preflight_failure_never_contacts_provider(self):
        for method in ("card", "mope"):
            self.collection = Attempts()
            self.db.sms_payment_attempts = self.collection
            attempt = await reserve_attempt(
                self.collection, company_id="c1", tenant_id="t1",
                item={"kind": "invoice", "id": "i1"}, method=method,
                amount_cents=10000, currency="SRD",
                provider_amount_cents=10000 if method == "mope" else 250,
                provider_currency="SRD" if method == "mope" else "EUR",
                stripe_mode=None if method == "mope" else "test",
            )
            self.preflight.side_effect = PaymentAttemptConflict("Factuur is gewijzigd")
            fake_routes = {
                "routes": SimpleNamespace(_deps=SimpleNamespace()),
                "routes.company_stripe": SimpleNamespace(_active=Mock(), _cfg_doc=AsyncMock()),
                "routes.company_mope": SimpleNamespace(_active=Mock(), _config=AsyncMock(),
                                                       _provider_error=Mock(), _request_api=AsyncMock(),
                                                       _response_payload=Mock()),
            }
            with patch.dict(sys.modules, fake_routes), \
                    patch("sms_payment_providers.stripe.PaymentIntent.create") as stripe_create:
                action = create_sms_mope_request if method == "mope" else create_sms_stripe_intent
                with self.subTest(method=method), self.assertRaises(PaymentAttemptConflict):
                    await action(self.db, self.client, attempt)
                stripe_create.assert_not_called()
                self.cancel.assert_awaited_with(
                    self.db, self.client, key=attempt["_id"], attempt_id=attempt["attempt_id"],
                )
            self.assertEqual(self.collection.docs[attempt["_id"]]["state"], "reserved")

    async def test_unavailable_provider_does_not_confirm_payment(self):
        attempt = await self._open("mope")
        request = AsyncMock(side_effect=RuntimeError("network unavailable"))
        fake_route = SimpleNamespace(
            _config=AsyncMock(return_value={"api_token": "token"}), _request_api=request,
            _response_payload=Mock(), _provider_error=Mock(),
        )
        with patch.dict(sys.modules, {"routes.company_mope": fake_route}):
            with self.assertRaises(RuntimeError):
                await verify_sms_provider_payment(self.collection, attempt["attempt_id"], attempt["_id"])
        self.assertEqual(self.collection.docs[attempt["_id"]]["state"], "open")

    async def test_stripe_error_does_not_confirm_payment(self):
        attempt = await self._open("card")
        fake_route = SimpleNamespace(
            _cfg_doc=AsyncMock(return_value={"stripe_config": {"test": {"secret_key": "test-key"}}}),
        )
        with patch.dict(sys.modules, {"routes.company_stripe": fake_route}), \
                patch("sms_payment_providers.stripe.PaymentIntent.retrieve",
                      side_effect=stripe.error.StripeError("provider unavailable")):
            with self.assertRaises(PaymentAttemptConflict):
                await verify_sms_provider_payment(self.collection, attempt["attempt_id"], attempt["_id"])
        self.assertEqual(self.collection.docs[attempt["_id"]]["state"], "open")
