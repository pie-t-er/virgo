"""
Virgo FastAPI application.
Provides:
  POST /chat              — agent conversation (with automatic model rotation)
  POST /reset             — clear conversation history
  GET  /wardrobe          — raw wardrobe items (for WardrobeGrid)
  GET  /calendar          — calendar entries for a date range (for CalendarView)
  GET  /health            — liveness probe
"""
from __future__ import annotations

import datetime
import os
from contextlib import asynccontextmanager
from typing import Any

from dotenv import load_dotenv

load_dotenv()

from bson import ObjectId
from fastapi import APIRouter, FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from backend.agent import get_state, init_state, run_turn
from backend.db import calendar_col, get_profile, save_profile, wardrobe_col
from backend.tools import _serialize
from backend.visualize import generate_outfit_visualization


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_state()
    # One-time idempotent cleanup: remove "multicolor" fallback labels seeded from CSV
    wardrobe_col().update_many({}, {"$pull": {"color": "multicolor", "tags": "multicolor"}})
    yield


app = FastAPI(title="Virgo Wardrobe Agent", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

api = APIRouter(prefix="/api")


# --------------------------------------------------------------------------- #
# models
# --------------------------------------------------------------------------- #

class ChatRequest(BaseModel):
    message: str


class ChatResponse(BaseModel):
    response: str
    model: str = ""
    items: list = []
    candidates: dict = {}


class VisualizeRequest(BaseModel):
    item_ids: list[str]


class PhotosRequest(BaseModel):
    photos: list[str]  # base64-encoded images


# --------------------------------------------------------------------------- #
# routes
# --------------------------------------------------------------------------- #

@api.get("/health")
def health():
    state = get_state()
    return {"status": "ok", "model": state.current_model}


@api.post("/reset")
async def reset_session():
    """Clear conversation history; keep current model."""
    await get_state().reset()
    return {"status": "reset"}


@api.post("/demo/reset")
async def demo_reset():
    """Full demo reset: wipe profile, calendar entries, and agent session."""
    from backend.db import profile_col
    # Wipe entire profile so onboarding runs fresh
    profile_col().delete_one({"_id": "demo_user"})
    # Clear all calendar entries
    calendar_col().delete_many({})
    await get_state().reset(rebuild=True)
    return {"status": "demo_reset"}


@api.get("/profile")
def read_profile():
    p = get_profile()
    p.pop("_id", None)
    return p


@api.put("/profile")
async def update_profile(data: dict):
    save_profile(data)
    await get_state().reset(rebuild=True)
    return {"status": "ok"}


@api.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    state = get_state()
    result = await run_turn(req.message)
    return ChatResponse(
        response=result["text"],
        items=result["items"],
        candidates=result.get("candidates", {}),
        model=state.current_model,
    )


@api.get("/wardrobe")
def get_wardrobe(
    type: str = Query(""),
    color: str = Query(""),
    occasion: str = Query(""),
    gender: str = Query(""),
    limit: int = Query(200),
):
    query: dict[str, Any] = {}
    if type:
        query["type"] = type.lower()
    if color:
        query["color"] = {"$in": [color.lower()]}
    if occasion:
        query["occasion"] = {"$in": [occasion.lower()]}
    if gender:
        query["tags"] = {"$in": [gender.lower()]}
    docs = wardrobe_col().find(query, {"embedding": 0}).limit(limit)
    return [_serialize(d) for d in docs]


@api.get("/calendar")
def get_calendar(
    start: str = Query(..., description="YYYY-MM-DD"),
    end: str = Query(..., description="YYYY-MM-DD"),
):
    start_dt = datetime.datetime.fromisoformat(start)
    end_dt = datetime.datetime.fromisoformat(end) + datetime.timedelta(days=1)
    docs = calendar_col().find({"date": {"$gte": start_dt, "$lt": end_dt}})
    results = []
    for doc in docs:
        entry = _serialize(doc)
        items = []
        for item_id in doc.get("items", []):
            item = wardrobe_col().find_one({"_id": item_id}, {"embedding": 0})
            if item:
                items.append(_serialize(item))
        entry["items"] = items
        # Prefix stored base64 so the frontend can use it directly as a src
        if entry.get("visualization_image"):
            entry["visualization_image"] = (
                "data:image/png;base64," + entry["visualization_image"]
            )
        results.append(entry)
    return results


class CalendarSaveRequest(BaseModel):
    date: str                        # YYYY-MM-DD
    occasion: str = ""
    item_ids: list[str] = []
    visualization_image: str = ""    # base64, no data-URL prefix


@api.post("/calendar")
def save_calendar_entry(req: CalendarSaveRequest):
    """Save an outfit to the calendar.
    If a visualization is included and an entry for the same date already has
    the same item set, update that entry in-place instead of inserting a duplicate.
    """
    dt = datetime.datetime.fromisoformat(req.date)
    item_ids = []
    for raw_id in req.item_ids:
        try:
            item_ids.append(ObjectId(raw_id))
        except Exception:
            pass

    # If a visualization is being saved, check for an existing entry with the same items
    if req.visualization_image and item_ids:
        new_set = {str(i) for i in item_ids}
        for entry in calendar_col().find({"date": dt}):
            existing_set = {str(i) for i in entry.get("items", [])}
            if existing_set == new_set:
                calendar_col().update_one(
                    {"_id": entry["_id"]},
                    {"$set": {
                        "visualization_image": req.visualization_image,
                        **({"occasion": req.occasion} if req.occasion else {}),
                    }},
                )
                return {"status": "updated", "_id": str(entry["_id"])}

    doc: dict = {"date": dt, "occasion": req.occasion, "items": item_ids}
    if req.visualization_image:
        doc["visualization_image"] = req.visualization_image
    result = calendar_col().insert_one(doc)
    return {"status": "ok", "_id": str(result.inserted_id)}


@api.delete("/calendar/entry/{entry_id}")
def delete_calendar_entry_by_id(entry_id: str):
    """Delete a specific outfit entry by its MongoDB _id."""
    result = calendar_col().delete_one({"_id": ObjectId(entry_id)})
    return {"deleted": result.deleted_count > 0}


@api.delete("/calendar/{date}")
def delete_calendar_entry(date: str):
    dt = datetime.datetime.fromisoformat(date)
    result = calendar_col().delete_one({"date": dt})
    return {"deleted": result.deleted_count > 0}


@api.post("/visualize")
async def visualize_outfit(req: VisualizeRequest):
    """Generate an outfit visualization image using Gemini."""
    import asyncio
    from bson import ObjectId as ObjId
    items = []
    for item_id in req.item_ids:
        try:
            doc = wardrobe_col().find_one({"_id": ObjId(item_id)}, {"embedding": 0})
            if doc:
                items.append(_serialize(doc))
        except Exception:
            pass

    if not items:
        return {"error": "No valid items found"}

    profile = get_profile()
    reference_photos = profile.get("reference_photos") or None

    try:
        image_b64 = await asyncio.to_thread(
            generate_outfit_visualization, items, reference_photos
        )
        return {"image": image_b64}
    except Exception as e:
        return {"error": str(e)}


@api.post("/profile/photos")
async def upload_reference_photos(req: PhotosRequest):
    """Store user reference photos for outfit visualization."""
    save_profile({"reference_photos": req.photos[:3]})
    return {"count": len(req.photos[:3])}


@api.get("/profile/photos")
def get_reference_photos():
    profile = get_profile()
    photos = profile.get("reference_photos", [])
    return {"count": len(photos), "has_photos": len(photos) > 0}


class WardrobeAddRequest(BaseModel):
    name: str
    type: str
    brand: str = ""
    tags: list = []
    temp_min: int | None = None
    temp_max: int | None = None
    image_url: str = ""


@api.post("/wardrobe")
async def add_wardrobe_item(req: WardrobeAddRequest):
    """Directly add a clothing item — bypasses the agent, handles embedding server-side."""
    import asyncio
    import datetime
    from backend.embeddings import embed_text

    profile = get_profile()
    gender = profile.get("gender", "")

    all_tags = list(req.tags)
    if gender and gender not in all_tags:
        all_tags.append(gender)
    if req.type.lower() not in all_tags:
        all_tags.append(req.type.lower())

    description = (
        f"{req.name} by {req.brand}. A {req.type} suitable for {', '.join(req.tags)} occasions."
        if req.tags
        else f"{req.name}. A {req.type}."
    )

    def _insert():
        embedding = embed_text(description)
        doc: dict = {
            "name": req.name,
            "type": req.type.lower(),
            "color": [],
            "tags": all_tags,
            "occasion": req.tags,
            "season": [],
            "brand": req.brand,
            "image_url": req.image_url,
            "description": description,
            "embedding": embedding,
            "created_at": datetime.datetime.utcnow(),
        }
        if req.temp_min is not None:
            doc["temp_min"] = req.temp_min
        if req.temp_max is not None:
            doc["temp_max"] = req.temp_max
        result = wardrobe_col().insert_one(doc)
        return str(result.inserted_id)

    item_id = await asyncio.to_thread(_insert)
    return {"id": item_id, "name": req.name}


@api.delete("/wardrobe/{item_id}")
def delete_wardrobe_item(item_id: str):
    result = wardrobe_col().delete_one({"_id": ObjectId(item_id)})
    return {"deleted": result.deleted_count > 0}


app.include_router(api)

# Serve built frontend (production / Cloud Run) — must come after API routes
_frontend_dist = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.isdir(_frontend_dist):
    app.mount("/", StaticFiles(directory=_frontend_dist, html=True), name="static")
