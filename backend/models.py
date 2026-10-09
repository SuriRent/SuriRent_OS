"""Pydantic-modellen die door server.py + route-modules gedeeld worden.

Gescheiden van server.py zodat het endpoint-bestand niet blijft groeien en
Pydantic klassen op één plek te vinden zijn. Modellen zijn puur data —
geen side-effects, geen db-import.
"""
from typing import List, Optional, Literal

from pydantic import BaseModel, EmailStr, Field


class RegisterIn(BaseModel):
    name: str
    email: EmailStr
    password: str = Field(min_length=6)
    company_name: Optional[str] = None  # If set, creates a new company with this user as admin
    # Slug (portal-URL) — moet expliciet worden opgegeven door de gebruiker.
    # Valideerd: 2-40 chars, kleine letters + cijfers + koppelteken. Auto-uniek
    # suffix (bijv. `-2`) wordt NIET meer toegepast — de gebruiker moet zelf
    # een vrije slug kiezen (409 conflict wanneer bezet).
    slug: Optional[str] = Field(default=None, min_length=2, max_length=40)
    telefoon: Optional[str] = ""
    address: Optional[str] = ""
    plan: Optional[Literal["starter", "professional"]] = "starter"
    kiosk_pin: Optional[str] = None  # 4 digits — set the kiosk PIN at registration
    country: Optional[Literal["SR", "NL"]] = None  # Explicit override; falls back to phone-based detection


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class PinIn(BaseModel):
    pin: str = Field(min_length=4, max_length=4)
    # Optioneel: bedrijfs-context. Op `/<slug>/login` stuurt frontend de slug
    # mee zodat de PIN alleen tegen die bedrijfs-PINs (en employees) gecheckt
    # wordt. Op de generieke `/login` (zonder slug) wordt PIN-login geweigerd.
    company_slug: Optional[str] = None
    company_id: Optional[str] = None


class SetPinIn(BaseModel):
    pin: str = Field(min_length=4, max_length=4)


class UserOut(BaseModel):
    id: str
    name: str
    email: EmailStr
    role: str
    created_at: str


class ApartmentIn(BaseModel):
    number: str
    address: Optional[str] = ""
    rent_amount: float
    currency: Literal["SRD", "USD", "EUR"] = "SRD"
    description: Optional[str] = ""
    location_id: Optional[str] = None
    photo_url: Optional[str] = ""
    # Wanneer True, toont de Kiosk appartement-picker de pasfoto/avatar
    # van de huidige huurder i.p.v. het standaard icoon. Beheerder zet
    # dit per appartement aan. Default False — opt-in per appartement.
    show_tenant_photo: Optional[bool] = False


class ApartmentOut(ApartmentIn):
    id: str
    status: Literal["vacant", "occupied"]
    tenant_id: Optional[str] = None
    tenant_name: Optional[str] = None
    shelly: Optional[dict] = None  # {device_id, channel, label} when bound
    created_at: str


class ShellyBindIn(BaseModel):
    device_id: Optional[str] = None  # None / "" unbinds
    channel: int = 0
    label: Optional[str] = ""


class ShellyControlIn(BaseModel):
    turn: Literal["on", "off", "toggle"]


class TenantIn(BaseModel):
    name: str
    phone: Optional[str] = ""
    email: Optional[str] = ""
    apartment_id: Optional[str] = None
    # Persoonsgegevens — komen automatisch in het huurcontract PDF
    birth_date: Optional[str] = ""   # YYYY-MM-DD
    id_number: Optional[str] = ""    # bv. FM008370
    id_photo_url: Optional[str] = ""  # ID-kaart voorkant, /api/landing/asset/{id}
    id_photo_back_url: Optional[str] = ""  # ID-kaart achterkant
    avatar_url: Optional[str] = ""  # Automatisch gecropte pasfoto uit ID-kaart
    signature_url: Optional[str] = ""  # Digitale handtekening (PNG)
    signature_signed_at: Optional[str] = ""


class TenantOut(TenantIn):
    id: str
    apartment_number: Optional[str] = None
    rent_amount: Optional[float] = None
    currency: Optional[str] = None
    nfc_card_id: Optional[str] = None
    created_at: str


class LocationIn(BaseModel):
    name: str
    address: Optional[str] = ""
    photo_url: Optional[str] = ""


class LocationOut(LocationIn):
    id: str
    apartments_total: int = 0
    apartments_occupied: int = 0
    created_at: str


class PaymentIn(BaseModel):
    tenant_id: str
    apartment_id: Optional[str] = None
    amount: float
    currency: Literal["SRD", "USD", "EUR"] = "SRD"
    method: Literal["contant", "bank", "creditcard", "ideal"] = "contant"
    stripe_payment_intent_id: Optional[str] = None
    category: Literal["huur", "servicekosten", "borg", "boete", "internet", "overig", "vooruitbetaling"] = "huur"
    period_month: Optional[int] = None
    period_year: Optional[int] = None
    note: Optional[str] = ""
    received_by: Optional[str] = ""  # naam medewerker die betaling ontving
    # Optioneel: specifieke factuur-IDs waarop de betaling moet worden
    # toegewezen. Wanneer leeg: backend gebruikt FIFO over alle open
    # facturen van de huurder. Wanneer gevuld: het bedrag wordt alleen
    # over deze facturen verdeeld (volgens periode-volgorde). Sinds
    # 2026-02-26 om huurders te laten kiezen welke maanden te betalen.
    invoice_ids: Optional[List[str]] = None


class PaymentOut(BaseModel):
    id: str
    tenant_id: str
    tenant_name: Optional[str] = None
    apartment_id: Optional[str] = None
    apartment_number: Optional[str] = None
    location_name: Optional[str] = None
    amount: float
    currency: str
    method: str
    category: str
    period_month: Optional[int] = None
    period_year: Optional[int] = None
    invoice_id: Optional[str] = None
    invoice_number: Optional[str] = None
    receipt_number: str
    paid_at: str
    note: Optional[str] = ""
    received_by: Optional[str] = ""
    approved_by: Optional[str] = ""
    # Approval workflow — alleen Kiosk-medewerkers triggeren pending state.
    # Beheerder/boekhouder betalingen krijgen direct status="approved".
    status: Optional[str] = "approved"  # approved | pending_approval | rejected
    kiosk_employee_id: Optional[str] = None
    kiosk_employee_name: Optional[str] = None
    approved_at: Optional[str] = None
    approved_by_user_id: Optional[str] = None
    signature_data_url: Optional[str] = None  # base64 PNG van handtekening
    rejected_reason: Optional[str] = None
    # Bankoverschrijving-velden (alleen aanwezig als method=="bank")
    bank_country: Optional[str] = None  # "SR" of "NL"
    bank_statement_id: Optional[str] = None
    bank_statement_filename: Optional[str] = None
    bank_statement_size: Optional[int] = None
    bank_statement_content_type: Optional[str] = None
    # OCR-resultaat (gevuld door achtergrond-task na bank upload)
    ocr_status: Optional[str] = None  # matched|mismatch|failed
    ocr_amount: Optional[float] = None
    ocr_currency: Optional[str] = None
    ocr_date_iso: Optional[str] = None
    ocr_payer_name: Optional[str] = None
    ocr_beneficiary: Optional[str] = None
    ocr_reference: Optional[str] = None
    ocr_confidence: Optional[float] = None
    ocr_mismatch_reasons: Optional[list] = None
    auto_approved: Optional[bool] = None


class PaymentApproveIn(BaseModel):
    signature_data_url: str  # base64 data URL van canvas handtekening


class PaymentRejectIn(BaseModel):
    reason: Optional[str] = ""
