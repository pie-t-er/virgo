"""
ADK tool implementations backed by MongoDB Atlas (via pymongo).
All heavy reasoning is delegated to the Gemini agent; these tools
handle data access and vector search only.
"""
from __future__ import annotations

import datetime
from typing import Any

from bson import ObjectId
from google.adk.tools import FunctionTool

from backend.db import calendar_col, templates_col, wardrobe_col
from backend.embeddings import embed_text


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #

def _serialize(doc: dict) -> dict:
    """Convert ObjectId fields to strings for JSON serialisation."""
    out = {}
    for k, v in doc.items():
        if isinstance(v, ObjectId):
            out[k] = str(v)
        elif isinstance(v, datetime.datetime):
            out[k] = v.isoformat()
        elif k == "embedding":
            # never send 768-dim vectors back to the LLM
            continue
        else:
            out[k] = v
    return out


# --------------------------------------------------------------------------- #
# wardrobe tools
# --------------------------------------------------------------------------- #

def add_clothing_item(
    name: str,
    type: str,
    color: list[str],
    tags: list[str],
    occasion: list[str],
    season: list[str],
    brand: str = "",
    image_url: str = "",
    description: str = "",
) -> dict:
    """Add a new clothing item to the wardrobe. Returns the inserted item id."""
    desc_for_embed = description or f"{name} {type} {' '.join(color)} {' '.join(tags)}"
    embedding = embed_text(desc_for_embed)
    doc = {
        "name": name,
        "type": type.lower(),
        "color": color,
        "tags": tags,
        "occasion": occasion,
        "season": season,
        "brand": brand,
        "image_url": image_url,
        "description": desc_for_embed,
        "embedding": embedding,
        "created_at": datetime.datetime.utcnow(),
    }
    result = wardrobe_col().insert_one(doc)
    return {"id": str(result.inserted_id), "name": name}


def get_wardrobe(
    type: str = "",
    color: str = "",
    occasion: str = "",
    limit: int = 20,
) -> list[dict]:
    """Return wardrobe items, optionally filtered by type, color, or occasion.
    Always use filters — avoid calling with no arguments as it returns too many items.
    For finding items matching a description, prefer semantic_search instead."""
    query: dict[str, Any] = {}
    if type:
        query["type"] = type.lower()
    if color:
        query["color"] = {"$in": [color.lower()]}
    if occasion:
        query["occasion"] = {"$in": [occasion.lower()]}
    docs = wardrobe_col().find(query, {"embedding": 0, "description": 0}).limit(limit)
    # Return only the fields the model needs to reason about
    slim_fields = {"_id", "name", "type", "color", "brand", "occasion", "season", "image_url"}
    results = []
    for d in docs:
        s = _serialize(d)
        results.append({k: v for k, v in s.items() if k in slim_fields})
    return results


def semantic_search(query: str, top_k: int = 8) -> list[dict]:
    """Find clothing items semantically similar to the query using Atlas Vector Search.
    Use this to find items matching a natural language description, occasion, or style.
    Prefer this over get_wardrobe when looking for outfit recommendations."""
    embedding = embed_text(query)
    pipeline = [
        {
            "$vectorSearch": {
                "index": "wardobe_vector_index",
                "path": "embedding",
                "queryVector": embedding,
                "numCandidates": top_k * 10,
                "limit": top_k,
            }
        },
        {
            "$project": {
                "embedding": 0,
                "description": 0,
                "score": {"$meta": "vectorSearchScore"},
            }
        },
    ]
    try:
        docs = list(wardrobe_col().aggregate(pipeline))
        if not docs:
            return [{"error": "No results found. The vector index may still be building — try again in a moment, or use get_wardrobe with a type filter instead."}]
        slim_fields = {"_id", "name", "type", "color", "brand", "occasion", "season", "image_url", "score"}
        return [{k: v for k, v in _serialize(d).items() if k in slim_fields} for d in docs]
    except Exception as e:
        return [{"error": f"Vector search failed: {str(e)}. Try get_wardrobe with a type filter instead."}]


def delete_clothing_item(item_id: str) -> dict:
    """Remove a clothing item from the wardrobe by its id."""
    result = wardrobe_col().delete_one({"_id": ObjectId(item_id)})
    return {"deleted": result.deleted_count > 0}


# --------------------------------------------------------------------------- #
# calendar tools
# --------------------------------------------------------------------------- #

def get_calendar(start_date: str, end_date: str) -> list[dict]:
    """
    Return planned outfits between start_date and end_date (YYYY-MM-DD strings).
    """
    start = datetime.datetime.fromisoformat(start_date)
    end = datetime.datetime.fromisoformat(end_date) + datetime.timedelta(days=1)
    docs = calendar_col().find({"date": {"$gte": start, "$lt": end}})
    results = []
    for doc in docs:
        entry = _serialize(doc)
        # resolve item ids to full item docs
        items = []
        for item_id in doc.get("items", []):
            item = wardrobe_col().find_one({"_id": item_id}, {"embedding": 0})
            if item:
                items.append(_serialize(item))
        entry["items"] = items
        results.append(entry)
    return results


def plan_outfit(
    date: str,
    occasion: str,
    item_ids: list[str],
    notes: str = "",
) -> dict:
    """
    Assign an outfit (list of item ids) to a specific date.
    Replaces any existing plan for that date.
    """
    dt = datetime.datetime.fromisoformat(date)
    object_ids = [ObjectId(i) for i in item_ids]
    doc = {
        "date": dt,
        "day_label": dt.strftime("%A"),
        "occasion": occasion,
        "items": object_ids,
        "notes": notes,
        "created_at": datetime.datetime.utcnow(),
    }
    calendar_col().replace_one({"date": dt}, doc, upsert=True)
    return {"date": date, "day_label": doc["day_label"], "item_count": len(item_ids)}


def remove_calendar_entry(date: str) -> dict:
    """Remove a planned outfit from the calendar for a given date."""
    dt = datetime.datetime.fromisoformat(date)
    result = calendar_col().delete_one({"date": dt})
    return {"deleted": result.deleted_count > 0}


# --------------------------------------------------------------------------- #
# shopping gap analysis
# --------------------------------------------------------------------------- #

def get_shopping_gaps() -> dict:
    """
    Analyse the wardrobe against outfit templates and return missing item types
    along with a count of what the user already has per category.
    """
    # count items by type
    pipeline = [{"$group": {"_id": "$type", "count": {"$sum": 1}}}]
    owned = {doc["_id"]: doc["count"] for doc in wardrobe_col().aggregate(pipeline)}

    templates = list(templates_col().find())
    gaps = []
    for tmpl in templates:
        missing_required = [
            t for t in tmpl.get("required_types", []) if owned.get(t, 0) == 0
        ]
        missing_optional = [
            t for t in tmpl.get("optional_types", []) if owned.get(t, 0) == 0
        ]
        if missing_required or missing_optional:
            gaps.append(
                {
                    "template": tmpl["name"],
                    "missing_required": missing_required,
                    "missing_optional": missing_optional,
                }
            )

    return {"owned_counts": owned, "gaps": gaps}


# --------------------------------------------------------------------------- #
# ADK FunctionTool wrappers
# --------------------------------------------------------------------------- #

ALL_TOOLS = [
    FunctionTool(add_clothing_item),
    FunctionTool(get_wardrobe),
    FunctionTool(semantic_search),
    FunctionTool(delete_clothing_item),
    FunctionTool(get_calendar),
    FunctionTool(plan_outfit),
    FunctionTool(remove_calendar_entry),
    FunctionTool(get_shopping_gaps),
]
