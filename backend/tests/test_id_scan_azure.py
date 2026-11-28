import io
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import HTTPException
from PIL import Image

from id_scan_azure import _image_for_azure, azure_configuration, id_scan_provider, scan_id_with_azure


ENDPOINT = "https://example.cognitiveservices.azure.com"
OPERATION = f"{ENDPOINT}/documentintelligence/documentModels/prebuilt-idDocument/analyzeResults/123?api-version=2024-11-30"


class AzureIdScanTests(unittest.IsolatedAsyncioTestCase):
    async def run_scan(self, handler, raw=b"image", content_type="image/jpeg"):
        real_client = httpx.AsyncClient
        transport = httpx.MockTransport(handler)
        with patch("id_scan_azure.httpx.AsyncClient", side_effect=lambda **kwargs: real_client(transport=transport, **kwargs)):
            with patch("id_scan_azure.asyncio.sleep", new_callable=AsyncMock):
                return await scan_id_with_azure(raw, content_type, ENDPOINT, "test-key")

    async def test_polls_and_maps_id_fields(self):
        requests = []

        def handler(request):
            requests.append(request)
            self.assertEqual(request.headers["Ocp-Apim-Subscription-Key"], "test-key")
            if request.method == "POST":
                self.assertEqual(request.url.params["api-version"], "2024-11-30")
                self.assertEqual(request.content, b"image")
                return httpx.Response(202, headers={"Operation-Location": OPERATION})
            if len(requests) == 2:
                return httpx.Response(200, json={"status": "running"})
            return httpx.Response(200, json={"status": "succeeded", "analyzeResult": {"documents": [{
                "fields": {
                    "FirstName": {"valueString": "JANE", "confidence": 0.97},
                    "LastName": {"valueString": "DOE", "confidence": 0.95},
                    "DocumentNumber": {"valueString": "abc123", "confidence": 0.90},
                    "DateOfBirth": {"valueDate": "1990-02-01", "confidence": 0.93},
                },
            }]}})

        self.assertEqual(await self.run_scan(handler), {
            "name": "Jane Doe", "id_number": "ABC123",
            "birth_date": "1990-02-01", "confidence": 0.90,
        })
        self.assertEqual(len(requests), 3)

    async def test_no_document_returns_empty_fields(self):
        def handler(request):
            if request.method == "POST":
                return httpx.Response(202, headers={"Operation-Location": OPERATION})
            return httpx.Response(200, json={"status": "succeeded", "analyzeResult": {"documents": []}})

        self.assertEqual(await self.run_scan(handler), {
            "name": "", "id_number": "", "birth_date": "", "confidence": 0.0,
        })

    async def test_rejects_cross_origin_operation_without_sending_key(self):
        requests = []

        def handler(request):
            requests.append(request)
            return httpx.Response(202, headers={"Operation-Location": "https://other.example/result"})

        with self.assertRaises(HTTPException) as exc:
            await self.run_scan(handler)
        self.assertEqual(exc.exception.status_code, 502)
        self.assertEqual(len(requests), 1)

    async def test_azure_failure_is_reported(self):
        with self.assertRaises(HTTPException) as exc:
            await self.run_scan(lambda request: httpx.Response(429))
        self.assertEqual(exc.exception.status_code, 502)
        self.assertIn("429", exc.exception.detail)

    async def test_failed_operation_is_reported(self):
        def handler(request):
            if request.method == "POST":
                return httpx.Response(202, headers={"Operation-Location": OPERATION})
            return httpx.Response(200, json={"status": "failed"})

        with self.assertRaises(HTTPException) as exc:
            await self.run_scan(handler)
        self.assertEqual(exc.exception.status_code, 502)

    def test_webp_is_converted_for_azure(self):
        image = io.BytesIO()
        Image.new("RGB", (20, 20), "white").save(image, format="WEBP")
        raw, content_type = _image_for_azure(image.getvalue(), "image/webp")
        self.assertEqual(content_type, "image/jpeg")
        self.assertEqual(Image.open(io.BytesIO(raw)).format, "JPEG")

    def test_bad_image_is_reported(self):
        with self.assertRaises(HTTPException) as exc:
            _image_for_azure(b"invalid", "image/webp")
        self.assertEqual(exc.exception.status_code, 400)

    def test_configuration_requires_both_values(self):
        self.assertIsNone(azure_configuration("", ""))
        self.assertEqual(azure_configuration(f" {ENDPOINT} ", " key "), (ENDPOINT, "key"))
        for endpoint, key in ((ENDPOINT, ""), ("", "key")):
            with self.subTest(endpoint=endpoint), self.assertRaises(HTTPException) as exc:
                azure_configuration(endpoint, key)
            self.assertEqual(exc.exception.status_code, 500)

    def test_only_listed_companies_use_azure(self):
        args = (" company-a, company-c ", ENDPOINT, "azure-key", "gemini-key")
        self.assertEqual(id_scan_provider("company-a", *args), ("azure", (ENDPOINT, "azure-key")))
        self.assertEqual(id_scan_provider("company-b", *args), ("gemini", None))
        self.assertEqual(id_scan_provider("company-c", *args), ("azure", (ENDPOINT, "azure-key")))
        self.assertEqual(id_scan_provider("company", *args), ("gemini", None))

    def test_missing_company_or_gemini_key_is_rejected(self):
        with self.assertRaises(HTTPException):
            id_scan_provider(None, "company-a", ENDPOINT, "azure-key", "gemini-key")
        with self.assertRaises(HTTPException):
            id_scan_provider("company-b", "", ENDPOINT, "azure-key", "")

    def test_listed_company_never_falls_back_to_gemini(self):
        for endpoint, key in (("", ""), (ENDPOINT, "")):
            with self.subTest(endpoint=endpoint), self.assertRaises(HTTPException):
                id_scan_provider("company-a", "company-a", endpoint, key, "gemini-key")

    async def test_invalid_endpoint_is_rejected(self):
        with self.assertRaises(HTTPException) as exc:
            await scan_id_with_azure(b"image", "image/jpeg", "http://example.test", "key")
        self.assertEqual(exc.exception.status_code, 500)


if __name__ == "__main__":
    unittest.main()
