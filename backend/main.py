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
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from backend.agent import get_state, init_state, run_turn
from backend.db import calendar_col, get_profile, save_profile, wardrobe_col
from backend.tools import _serialize


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


# --------------------------------------------------------------------------- #
# models
# --------------------------------------------------------------------------- #

class ChatRequest(BaseModel):
    message: str


class ChatResponse(BaseModel):
    response: str
    model: str = ""


# --------------------------------------------------------------------------- #
# routes
# --------------------------------------------------------------------------- #

@app.get("/health")
def health():
    state = get_state()
    return {"status": "ok", "model": state.current_model}


@app.post("/reset")
async def reset_session():
    """Clear conversation history; keep current model."""
    await get_state().reset()
    return {"status": "reset"}


@app.get("/profile")
def read_profile():
    p = get_profile()
    p.pop("_id", None)
    return p


@app.put("/profile")
async def update_profile(data: dict):
    save_profile(data)
    # Rebuild runner so new profile is injected, then reset session
    await get_state().reset(rebuild=True)
    return {"status": "ok"}


@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    state = get_state()
    reply = await run_turn(req.message)
    return ChatResponse(response=reply, model=state.current_model)


@app.get("/wardrobe")
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


@app.get("/calendar")
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


@app.delete("/calendar/{date}")
def delete_calendar_entry(date: str):
    dt = datetime.datetime.fromisoformat(date)
    result = calendar_col().delete_one({"date": dt})
    return {"deleted": result.deleted_count > 0}


@app.delete("/wardrobe/{item_id}")
def delete_wardrobe_item(item_id: str):
    result = wardrobe_col().delete_one({"_id": ObjectId(item_id)})
    return {"deleted": result.deleted_count > 0}


# Serve built frontend (production / Cloud Run)
_frontend_dist = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.isdir(_frontend_dist):
    app.mount("/", StaticFiles(directory=_frontend_dist, html=True), name="static")
