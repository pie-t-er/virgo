import os
from google import genai

_client: genai.Client | None = None


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(api_key=os.environ["GOOGLE_API_KEY"])
    return _client


def embed_text(text: str) -> list[float]:
    client = _get_client()
    result = client.models.embed_content(
        model="models/gemini-embedding-2",
        contents=text,
    )
    return result.embeddings[0].values
