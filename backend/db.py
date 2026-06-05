import os
from pymongo import MongoClient
from pymongo.collection import Collection
from pymongo.database import Database

_client: MongoClient | None = None


def get_db() -> Database:
    global _client
    if _client is None:
        _client = MongoClient(os.environ["MONGODB_URI"])
    return _client[os.environ.get("MONGODB_DATABASE", "wardrobe")]


def wardrobe_col() -> Collection:
    return get_db()["wardrobe_items"]


def calendar_col() -> Collection:
    return get_db()["outfit_calendar"]


def templates_col() -> Collection:
    return get_db()["outfit_templates"]


def profile_col() -> Collection:
    return get_db()["user_profile"]


def get_profile() -> dict:
    doc = profile_col().find_one({"_id": "demo_user"})
    return doc or {}


def save_profile(data: dict) -> None:
    profile_col().update_one(
        {"_id": "demo_user"},
        {"$set": data},
        upsert=True,
    )
