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
    tags: list[str],
    color: list[str] | None = None,
    occasion: list[str] | None = None,
    season: list[str] | None = None,
    brand: str = "",
    image_url: str = "",
    description: str = "",
    temp_min: int | None = None,
    temp_max: int | None = None,
) -> dict:
    """Add a new clothing item to the wardrobe. Returns the inserted item id.
    tags: style/occasion/season labels (e.g. ['casual', 'summer']).
    temp_min/temp_max: comfortable temperature range in °F."""
    all_tags = list(tags or []) + list(occasion or []) + list(season or [])
    # Auto-apply user's gender tag so the item appears in their filtered wardrobe
    from backend.db import get_profile as _get_profile
    _gender = _get_profile().get("gender", "")
    if _gender and _gender not in all_tags:
        all_tags.append(_gender)
    desc_for_embed = description or f"{name} {type} {' '.join(all_tags)}"
    embedding = embed_text(desc_for_embed)
    doc = {
        "name": name,
        "type": type.lower(),
        "color": color or [],
        "tags": all_tags,
        "occasion": occasion or tags or [],
        "season": season or [],
        "brand": brand,
        "image_url": image_url,
        "description": desc_for_embed,
        "embedding": embedding,
        "created_at": datetime.datetime.utcnow(),
    }
    if temp_min is not None:
        doc["temp_min"] = temp_min
    if temp_max is not None:
        doc["temp_max"] = temp_max
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


def semantic_search(query: str, top_k: int = 8, item_type: str = "") -> list[dict]:
    """Find clothing items semantically similar to the query using Atlas Vector Search.
    Use this to find items matching a natural language description, occasion, or style.
    Prefer this over get_wardrobe when looking for outfit recommendations.
    Pass item_type (e.g. 'top', 'bottom', 'shoes') to restrict results to one category."""
    from backend.db import get_profile
    try:
        embedding = embed_text(query)
    except Exception as e:
        return [{"error": f"Embedding service temporarily unavailable ({e}). Please try again in a moment."}]

    # Build post-filter for gender and optional type
    profile = get_profile()
    gender = profile.get("gender", "")
    match_filter: dict = {}
    if gender:
        match_filter["tags"] = {"$in": [gender]}
    if item_type:
        match_filter["type"] = item_type.lower()

    # Fetch extra candidates so post-filter $match has enough to work with
    pipeline: list = [
        {
            "$vectorSearch": {
                "index": "wardobe_vector_index",
                "path": "embedding",
                "queryVector": embedding,
                "numCandidates": top_k * 20,
                "limit": top_k * 4,
            }
        },
        # Post-filter by gender/type after vector search
        # (filter inside $vectorSearch requires index config changes)
        *([ {"$match": match_filter} ] if match_filter else []),
        {"$limit": top_k},
        {"$project": {
            "embedding": 0,
            "description": 0,
            "score": {"$meta": "vectorSearchScore"},
        }},
    ]

    try:
        docs = list(wardrobe_col().aggregate(pipeline))
        if not docs:
            type_hint = f" of type '{item_type}'" if item_type else ""
            return [{"error": f"No items found{type_hint}. Try adding more clothing to your wardrobe, or use get_wardrobe to see what's available."}]
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
    calendar_col().insert_one(doc)
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
    from backend.db import get_profile
    profile = get_profile()
    gender = profile.get("gender", "")

    # count items by type, filtered to the user's gender (same logic as semantic_search)
    match_stage: dict = {}
    if gender:
        match_stage = {"$match": {"tags": {"$in": [gender]}}}

    pipeline = []
    if match_stage:
        pipeline.append(match_stage)
    pipeline.append({"$group": {"_id": "$type", "count": {"$sum": 1}}})

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
# weather tool
# --------------------------------------------------------------------------- #

def get_weather(location: str, date: str = "") -> dict:
    """
    Get weather forecast for a location and optional date (YYYY-MM-DD).
    Returns temperature in °F and conditions. Uses forecast data for dates
    within 3 days; falls back to seasonal climate estimate beyond that.
    location: city name (e.g. 'Tampa, FL', 'New York').
    """
    import calendar as cal_mod
    import httpx as _httpx

    # Seasonal fallback helper
    def _seasonal(date_str: str, location: str) -> dict:
        try:
            dt = datetime.datetime.fromisoformat(date_str)
        except Exception:
            dt = datetime.datetime.utcnow()
        month = dt.month
        loc_lower = location.lower()
        # Very rough climate zones
        if any(w in loc_lower for w in ["fl", "florida", "miami", "tampa", "orlando",
                                         "la", "los angeles", "san diego", "phoenix", "az",
                                         "hawaii", "houston", "tx", "texas"]):
            base = {12:65,1:65,2:67,3:72,4:78,5:84,6:90,7:92,8:92,9:88,10:80,11:72}
        elif any(w in loc_lower for w in ["ny", "new york", "boston", "chicago", "il",
                                           "pa", "philadelphia", "dc", "washington"]):
            base = {12:35,1:32,2:35,3:45,4:55,5:67,6:77,7:83,8:81,9:72,10:60,11:48}
        elif any(w in loc_lower for w in ["ca", "california", "san francisco", "seattle",
                                           "portland", "wa", "oregon"]):
            base = {12:52,1:50,2:53,3:57,4:60,5:65,6:70,7:72,8:73,9:70,10:63,11:55}
        else:
            base = {12:40,1:38,2:42,3:52,4:62,5:72,6:80,7:85,8:83,9:75,10:63,11:50}
        avg_f = base.get(month, 65)
        season = {12:"winter",1:"winter",2:"winter",3:"spring",4:"spring",5:"spring",
                  6:"summer",7:"summer",8:"summer",9:"fall",10:"fall",11:"fall"}[month]
        return {"temp_f": avg_f, "feels_like_f": avg_f, "condition": f"Seasonal estimate ({season})",
                "source": "seasonal_estimate", "date": date_str or dt.strftime("%Y-%m-%d")}

    # Check if date is within forecast range (~3 days)
    target_dt = None
    if date:
        try:
            target_dt = datetime.datetime.fromisoformat(date)
        except Exception:
            pass

    days_ahead = (target_dt - datetime.datetime.utcnow()).days if target_dt else 0

    if days_ahead > 3:
        return _seasonal(date, location)

    try:
        url = f"https://wttr.in/{location.replace(' ', '+')}?format=j1"
        resp = _httpx.get(url, timeout=8, follow_redirects=True)
        resp.raise_for_status()
        data = resp.json()

        # wttr.in weather_desc and temp_C for current or forecast
        if days_ahead <= 0:
            cur = data["current_condition"][0]
            temp_c = float(cur["temp_C"])
            feels_c = float(cur["FeelsLikeC"])
            condition = cur["weatherDesc"][0]["value"]
        else:
            day_idx = min(days_ahead, len(data["weather"]) - 1)
            day = data["weather"][day_idx]
            temp_c = (float(day["mintempC"]) + float(day["maxtempC"])) / 2
            feels_c = temp_c
            condition = day["hourly"][4]["weatherDesc"][0]["value"]

        def c_to_f(c): return round(c * 9 / 5 + 32)
        return {
            "temp_f": c_to_f(temp_c),
            "feels_like_f": c_to_f(feels_c),
            "condition": condition,
            "source": "wttr.in",
            "date": date or datetime.datetime.utcnow().strftime("%Y-%m-%d"),
        }
    except Exception:
        return _seasonal(date or datetime.datetime.utcnow().strftime("%Y-%m-%d"), location)


# --------------------------------------------------------------------------- #
# ADK FunctionTool wrappers
# --------------------------------------------------------------------------- #

def set_user_location(location: str) -> dict:
    """Save the user's location to their profile so it persists across sessions."""
    from backend.db import save_profile
    save_profile({"location": location})
    return {"saved": True, "location": location}


ALL_TOOLS = [
    FunctionTool(add_clothing_item),
    FunctionTool(get_wardrobe),
    FunctionTool(semantic_search),
    FunctionTool(delete_clothing_item),
    FunctionTool(get_calendar),
    FunctionTool(plan_outfit),
    FunctionTool(remove_calendar_entry),
    FunctionTool(get_shopping_gaps),
    FunctionTool(get_weather),
    FunctionTool(set_user_location),
]
