"""
Outfit visualization using the Gemini REST API directly.
Bypasses the google-genai SDK to avoid conflicts with the ADK's client lifecycle.

Approach:
  - Pass user reference photos so the model can see the person's face/build
  - Pass each clothing item's product image so the model sees the exact garment
  - Prompt instructs the model to dress the person in those specific items
  - Text descriptions serve as fallback labels only, not the primary visual signal
"""
from __future__ import annotations

import base64
import os

import httpx

_IMAGE_MODELS = [
    "gemini-2.5-flash-image",
    "gemini-3.1-flash-image",
    "gemini-3.1-flash-image-preview",
]

# Maps dominant outfit colors to a harmonious backdrop tone
_BACKDROP_MAP = {
    "black":    "warm ivory (#F5F0E8)",
    "white":    "soft charcoal (#4A4A4A)",
    "navy":     "warm sand (#E8DCC8)",
    "blue":     "warm sand (#E8DCC8)",
    "grey":     "warm light gray (#D8D4CE)",
    "gray":     "warm light gray (#D8D4CE)",
    "brown":    "soft sage green (#D4DDD0)",
    "beige":    "dusty rose (#D4B8B0)",
    "khaki":    "muted slate blue (#B8C4D0)",
    "green":    "warm sand (#E8DCC8)",
    "olive":    "soft blush (#E8D4CC)",
    "red":      "warm ivory (#F5F0E8)",
    "burgundy": "warm ivory (#F5F0E8)",
    "pink":     "soft sage (#D0DDD4)",
    "yellow":   "muted lavender (#C8C0D4)",
    "orange":   "soft teal (#C0D4D0)",
    "purple":   "warm sand (#E8DCC8)",
    "teal":     "warm sand (#E8DCC8)",
    "coral":    "soft sage (#D0DDD4)",
}
_DEFAULT_BACKDROP = "warm light gray (#D8D4CE)"

_SKIP_COLORS = {"multicolor", "multi", "various", "assorted", "mixed", "pattern", "print"}


def _pick_backdrop(items: list[dict]) -> str:
    for item in items:
        colors = item.get("color", [])
        if isinstance(colors, str):
            colors = [colors]
        for c in colors:
            key = c.lower().strip()
            if key in _BACKDROP_MAP:
                return _BACKDROP_MAP[key]
    return _DEFAULT_BACKDROP


def _gemini_url(model: str) -> str:
    return (
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    )


def _fetch_image_as_part(url: str) -> dict | None:
    """Fetch an image URL and return a Gemini inlineData part, or None on failure."""
    try:
        resp = httpx.get(url, timeout=10, follow_redirects=True)
        resp.raise_for_status()
        content_type = resp.headers.get("content-type", "image/jpeg").split(";")[0].strip()
        if not content_type.startswith("image/"):
            content_type = "image/jpeg"
        b64 = base64.b64encode(resp.content).decode()
        return {"inlineData": {"mimeType": content_type, "data": b64}}
    except Exception:
        return None


def generate_outfit_visualization(
    items: list[dict],
    reference_photos: list[str] | None = None,
) -> str:
    """
    Generate an outfit visualization. Returns a base64-encoded image string.
    items: wardrobe item dicts (should include image_url where available).
    reference_photos: list of base64-encoded images of the user.
    """
    backdrop = _pick_backdrop(items)

    # Build labeled item list for the prompt
    item_labels = []
    for item in items:
        colors = item.get("color", [])
        if isinstance(colors, str):
            colors = [colors]
        meaningful = [c for c in colors if c.lower().strip() not in _SKIP_COLORS]
        color_str = " and ".join(meaningful[:2]) if meaningful else ""
        brand = item.get("brand", "")
        name = item.get("name", item.get("type", "item"))
        type_label = item.get("type", "item").capitalize()
        desc = f"{color_str} {brand} {name}".strip()
        item_labels.append(f"  • {type_label}: {desc}")

    outfit_label_block = "\n".join(item_labels)

    # ------------------------------------------------------------------ #
    # Build the parts array
    # Order: prompt text → reference photos → product images
    # ------------------------------------------------------------------ #
    parts: list[dict] = []

    has_reference = bool(reference_photos)
    has_product_images = any(item.get("image_url") for item in items)

    if has_reference and has_product_images:
        prompt_text = (
            "TASK: Photo compositing — edit the [PERSON REFERENCE] photo to dress "
            "the person in the specified outfit. This is an edit of the reference "
            "photo, not a new generation.\n"
            "\n"
            "SUBJECT: The exact person from [PERSON REFERENCE].\n"
            "  • PRESERVE without ANY change: their face, hair, skin tone, facial "
            "features, and body proportions — copy them pixel-for-pixel from the "
            "reference photo. The face must be indistinguishable from the original.\n"
            "  • CHANGE ONLY the clothing.\n"
            "  • Do NOT re-render, stylize, or alter the face in any way.\n"
            "\n"
            "FORMAT:\n"
            f"  • Background: plain {backdrop} studio backdrop, solid color only\n"
            "  • Portrait orientation, 3/4 body or full body, subject centered\n"
            "  • Soft, even studio lighting — keep face well-lit and clearly visible\n"
            "\n"
            "OUTFIT — dress the person in EXACTLY the garments shown in the "
            "[GARMENT] images below:\n"
            f"{outfit_label_block}\n"
            "\n"
            "CRITICAL:\n"
            "  • The face must look like a photograph of the same real person — "
            "not an illustration or AI avatar.\n"
            "  • Each garment must match its [GARMENT] image exactly.\n"
            "  • Do NOT carry over any clothing from the reference photos.\n"
            "  • Do NOT invent patterns, colors, or garments not shown."
        )
    elif has_reference:
        prompt_text = (
            "TASK: Photo compositing — edit the [PERSON REFERENCE] photo to dress "
            "the person in the specified outfit.\n"
            "\n"
            "SUBJECT: The exact person from [PERSON REFERENCE].\n"
            "  • PRESERVE without ANY change: their face, hair, skin tone, and "
            "facial features — copy them from the reference photo exactly. "
            "The face must be indistinguishable from the original photograph.\n"
            "  • CHANGE ONLY the clothing.\n"
            "\n"
            "FORMAT:\n"
            f"  • Background: plain {backdrop} studio backdrop, solid color only\n"
            "  • Portrait orientation, 3/4 body or full body, subject centered\n"
            "  • Soft, even studio lighting — face clearly visible and well-lit\n"
            "\n"
            "OUTFIT — render EVERY item below, matching colors precisely:\n"
            f"{outfit_label_block}\n"
            "\n"
            "CRITICAL: The face must look like a real photograph of the same person, "
            "not an illustration. Do NOT add garments or colors not listed above."
        )
    else:
        subject = "A person, fashion editorial style"
        if has_product_images:
            subject = (
                "A person. Dress them in EXACTLY the garments shown in the product images below, "
                "reproducing exact colors, cut, and style from each image"
            )
        prompt_text = (
            "TASK: Fashion editorial photograph.\n"
            "\n"
            "FORMAT (follow exactly):\n"
            "  • Portrait orientation — TALLER than wide\n"
            "  • Full body head-to-toe, subject centered, tightly framed\n"
            f"  • Background: plain {backdrop} studio backdrop, solid color only\n"
            "  • Soft studio lighting, clean fashion editorial\n"
            "\n"
            f"SUBJECT: {subject}\n"
            "\n"
            "OUTFIT:\n"
            f"{outfit_label_block}\n"
            "\n"
            "CRITICAL: Do NOT add patterns or colors not listed or shown above."
        )

    # Reference photos FIRST — anchor the model to the person's identity before anything else
    ref_parts: list[dict] = []
    for i, b64 in enumerate((reference_photos or [])[:3]):
        try:
            raw = base64.b64decode(b64)
            mime = "image/png" if raw[:8] == b"\x89PNG\r\n\x1a\n" else "image/jpeg"
            ref_parts.append({"text": f"[PERSON REFERENCE {i+1} — BASE IMAGE. This is the person to edit. Preserve their face, hair, and skin tone exactly — do not alter or regenerate the face:]"})
            ref_parts.append({"inlineData": {"mimeType": mime, "data": b64}})
        except Exception:
            pass

    parts.extend(ref_parts)
    parts.append({"text": prompt_text})

    # Product images — labeled inline so the model knows these are the garments
    for item in items:
        url = item.get("image_url")
        if url:
            part = _fetch_image_as_part(url)
            if part:
                type_label = item.get("type", "item").capitalize()
                name = item.get("name", "")
                parts.append({"text": f"[GARMENT — {type_label}: {name} — reproduce this garment exactly on the subject:]"})
                parts.append(part)

    payload = {
        "contents": [{"parts": parts}],
        "generationConfig": {"responseModalities": ["IMAGE", "TEXT"]},
    }

    api_key = os.environ["GOOGLE_API_KEY"]
    last_error: Exception | None = None

    for model in _IMAGE_MODELS:
        try:
            resp = httpx.post(
                _gemini_url(model),
                params={"key": api_key},
                json=payload,
                timeout=90,
            )
            resp.raise_for_status()
            data = resp.json()

            for candidate in data.get("candidates", []):
                for part in candidate.get("content", {}).get("parts", []):
                    inline = part.get("inlineData")
                    if inline and inline.get("data"):
                        return inline["data"]

            last_error = ValueError(f"{model} returned no image parts. Response: {data}")
        except httpx.HTTPStatusError as e:
            if e.response.status_code in (404, 503):
                last_error = e
                continue
            raise
        except httpx.TimeoutException as e:
            last_error = e
            continue

    raise last_error or ValueError("No image generation model available on this API key.")
