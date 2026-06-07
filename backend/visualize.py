"""
Outfit visualization using Gemini image generation.
Uses gemini-2.0-flash-exp with responseModalities=["IMAGE", "TEXT"].
If reference photos are stored in the user profile they are passed as
multimodal context for character consistency.
"""
from __future__ import annotations

import base64
import os

from google import genai
from google.genai import types


def _client() -> genai.Client:
    return genai.Client(api_key=os.environ["GOOGLE_API_KEY"])


def generate_outfit_visualization(
    items: list[dict],
    reference_photos: list[str] | None = None,
) -> str:
    """
    Generate an outfit visualization. Returns a base64-encoded PNG/JPEG string.
    reference_photos: list of base64-encoded image strings from user profile.
    """
    # Build outfit description from item metadata
    descriptions = []
    for item in items:
        colors = item.get("color", [])
        if isinstance(colors, str):
            colors = [colors]
        color_str = " and ".join(colors[:2]) if colors else ""
        brand = item.get("brand", "")
        name = item.get("name", item.get("type", "clothing item"))
        part = f"{color_str} {brand} {name}".strip()
        descriptions.append(part)

    outfit_str = ", ".join(descriptions)

    if reference_photos:
        prompt_text = (
            f"Using the person in the reference photo(s) as the subject, create a "
            f"stylish full-body fashion photograph of them wearing this outfit: {outfit_str}. "
            f"Studio lighting, clean white or neutral background, professional fashion editorial style."
        )
    else:
        prompt_text = (
            f"Create a stylish full-body fashion photograph of a person wearing: {outfit_str}. "
            f"Studio lighting, clean white or neutral background, professional fashion editorial style."
        )

    parts: list[types.Part] = []

    # Add up to 3 reference photos
    for b64 in (reference_photos or [])[:3]:
        try:
            image_bytes = base64.b64decode(b64)
            # Detect mime type from magic bytes
            mime = "image/jpeg"
            if image_bytes[:8] == b"\x89PNG\r\n\x1a\n":
                mime = "image/png"
            parts.append(
                types.Part.from_bytes(data=image_bytes, mime_type=mime)
            )
        except Exception:
            pass  # Skip malformed photos silently

    parts.append(types.Part.from_text(text=prompt_text))

    response = _client().models.generate_content(
        model="gemini-2.0-flash-exp",
        contents=parts,
        config=types.GenerateContentConfig(
            response_modalities=["IMAGE", "TEXT"],
        ),
    )

    for candidate in response.candidates or []:
        for part in candidate.content.parts or []:
            if part.inline_data and part.inline_data.data:
                raw = part.inline_data.data
                if isinstance(raw, (bytes, bytearray)):
                    return base64.b64encode(raw).decode()
                # Already a base64 string in some SDK versions
                return raw if isinstance(raw, str) else base64.b64encode(raw).decode()

    raise ValueError("Gemini returned no image — model may not support image generation in this region/key.")
