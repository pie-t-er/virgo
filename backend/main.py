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
        results.append(entry)
    return results


@api.delete("/calendar/{date}")
def delete_calendar_entry(date: str):
    dt = datetime.datetime.fromisoformat(date)
    result = calendar_col().delete_one({"date": dt})
    return {"deleted": result.deleted_count > 0}


@api.post("/visualize")
async def visualize_outfit(req: VisualizeRequest):
    """Generate an outfit visualization image using Gemini."""
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
        return {"error": "No valid items found"}, 400

    profile = get_profile()
    reference_photos = profile.get("reference_photos", [])

    try:
        image_b64 = generate_outfit_visualization(items, reference_photos or None)
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


@api.delete("/wardrobe/{item_id}")
def delete_wardrobe_item(item_id: str):
    result = wardrobe_col().delete_one({"_id": ObjectId(item_id)})
    return {"deleted": result.deleted_count > 0}


app.include_router(api)

# Serve built frontend (production / Cloud Run) — must come after API routes
_frontend_dist = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.isdir(_frontend_dist):
    app.mount("/", StaticFiles(directory=_frontend_dist, html=True), name="static")
