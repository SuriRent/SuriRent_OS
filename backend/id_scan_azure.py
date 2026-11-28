"""Azure Document Intelligence integration for ID-card OCR."""

import asyncio
import io
from urllib.parse import urlsplit

import httpx
from fastapi import HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError


_API_VERSION = "2024-11-30"
_MAX_IMAGE_BYTES = 4 * 1024 * 1024


def azure_configuration(endpoint: str, api_key: str) -> tuple[str, str] | None:
    endpoint = endpoint.strip()
    api_key = api_key.strip()
    if bool(endpoint) != bool(api_key):
        raise HTTPException(status_code=500, detail="Azure ID-scan vereist zowel endpoint als API-sleutel")
    return (endpoint, api_key) if endpoint else None


def _image_for_azure(raw: bytes, content_type: str) -> tuple[bytes, str]:
    if content_type in ("image/jpeg", "image/png") and len(raw) <= _MAX_IMAGE_BYTES:
        return raw, content_type
    try:
        with Image.open(io.BytesIO(raw)) as image:
            image = ImageOps.exif_transpose(image).convert("RGB")
            output = io.BytesIO()
            image.save(output, format="JPEG", quality=90, optimize=True)
    except (UnidentifiedImageError, OSError, ValueError):
        raise HTTPException(status_code=400, detail="ID-foto heeft een ongeldig of niet-ondersteund formaat")
    if output.tell() > _MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="ID-foto is te groot voor Azure (maximaal 4 MB)")
    return output.getvalue(), "image/jpeg"


def _azure_fields(result: dict) -> dict:
    documents = result.get("analyzeResult", {}).get("documents", [])
    if not documents:
        return {"name": "", "id_number": "", "birth_date": "", "confidence": 0.0}
    fields = documents[0].get("fields", {})

    def field(name: str, value_key: str) -> str:
        value = fields.get(name, {}).get(value_key)
        return value.strip() if isinstance(value, str) else ""

    name = " ".join(filter(None, (
        field("FirstName", "valueString"),
        field("MiddleName", "valueString"),
        field("LastName", "valueString"),
    ))).title()
    confidence_values = [
        fields[name]["confidence"]
        for name in ("FirstName", "MiddleName", "LastName", "DocumentNumber", "DateOfBirth")
        if isinstance(fields.get(name), dict)
        and isinstance(fields[name].get("confidence"), (int, float))
        and 0 <= fields[name]["confidence"] <= 1
    ]
    return {
        "name": name,
        "id_number": field("DocumentNumber", "valueString").upper(),
        "birth_date": field("DateOfBirth", "valueDate"),
        "confidence": min(confidence_values) if confidence_values else 0.0,
    }


async def scan_id_with_azure(raw: bytes, content_type: str, endpoint: str, api_key: str) -> dict:
    endpoint = endpoint.rstrip("/")
    endpoint_url = urlsplit(endpoint)
    if (endpoint_url.scheme != "https" or not endpoint_url.hostname or endpoint_url.username
            or endpoint_url.password or endpoint_url.path or endpoint_url.query or endpoint_url.fragment):
        raise HTTPException(status_code=500, detail="AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT is ongeldig")
    raw, content_type = _image_for_azure(raw, content_type)
    url = f"{endpoint}/documentintelligence/documentModels/prebuilt-idDocument:analyze"
    headers = {"Ocp-Apim-Subscription-Key": api_key}
    try:
        async with asyncio.timeout(45):
            async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
                response = await client.post(
                    url, params={"api-version": _API_VERSION},
                    headers={**headers, "Content-Type": content_type}, content=raw,
                )
                if response.status_code != 202:
                    raise HTTPException(status_code=502, detail=f"Azure ID-scan fout ({response.status_code})")
                operation = response.headers.get("Operation-Location", "")
                operation_url = urlsplit(operation)
                if (operation_url.scheme != endpoint_url.scheme or operation_url.netloc != endpoint_url.netloc
                        or not operation_url.path.startswith("/documentintelligence/documentModels/prebuilt-idDocument/analyzeResults/")):
                    raise HTTPException(status_code=502, detail="Azure ID-scan gaf een ongeldig resultaatadres")
                while True:
                    retry_after = response.headers.get("Retry-After", "2")
                    delay = max(1, min(int(retry_after), 10)) if retry_after.isdigit() else 2
                    await asyncio.sleep(delay)
                    response = await client.get(operation, headers=headers)
                    if response.status_code != 200:
                        raise HTTPException(status_code=502, detail=f"Azure ID-scan fout ({response.status_code})")
                    try:
                        result = response.json()
                    except ValueError:
                        raise HTTPException(status_code=502, detail="Azure ID-scan gaf ongeldig JSON terug")
                    if not isinstance(result, dict):
                        raise HTTPException(status_code=502, detail="Azure ID-scan gaf een ongeldig resultaat terug")
                    status = result.get("status")
                    if status == "succeeded":
                        return _azure_fields(result)
                    if status not in ("notStarted", "running"):
                        raise HTTPException(status_code=502, detail="Azure ID-scan kon de foto niet verwerken")
    except TimeoutError:
        raise HTTPException(status_code=504, detail="Azure ID-scan duurde te lang")
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Azure ID-scan is niet bereikbaar")
