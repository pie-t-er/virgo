"""
One-time seed script: converts Macy's CSV data → wardrobe_items in MongoDB Atlas.
Also seeds outfit_templates for gap analysis.

Usage:
    python -m backend.seed

Reads from scripts/macysM.csv and scripts/macysW.csv.
Generates Gemini embeddings for each item (batched to avoid rate limits).
"""
from __future__ import annotations

import csv
import os
import random
import time
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from backend.db import get_db, templates_col, wardrobe_col
from backend.embeddings import embed_text

# --------------------------------------------------------------------------- #
# type mapping from CSV article column
# --------------------------------------------------------------------------- #

ARTICLE_TO_TYPE = {
    "Shoes": "shoes",
    "Shirts": "top",
    "Sweaters": "top",
    "Jackets": "outerwear",
    "Pants": "bottom",
    "Shorts": "bottom",
    "Dresses": "dress",
    "Skirts": "bottom",
    "Hats": "accessory",
}

# occasion inference from item name + article type
OCCASION_KEYWORDS = {
    "formal": ["formal", "gown", "tuxedo", "suit", "blazer", "oxford", "dress shirt",
               "button-down", "button down", "wing tip", "wingtip", "loafer", "derby",
               "chino", "slacks", "crepe", "ponte", "tailored"],
    "work":   ["office", "business", "career", "work", "professional", "stretch dress",
               "slim-fit dress", "slim fit dress", "dress pant", "pencil"],
    "casual": ["casual", "sneaker", "tee", "t-shirt", "jeans", "shorts", "loafer",
               "hoodie", "sweatshirt", "pullover", "crewneck", "graphic", "jersey"],
    "party":  ["party", "cocktail", "sequin", "glitter", "festive", "satin", "velvet"],
    "outdoor":["boot", "hiking", "trail", "fleece", "parka", "raincoat", "anorak"],
    "beach":  ["sandal", "swim", "linen", "tank", "espadrille"],
}

# Default occasions by article type when no keywords match
ARTICLE_DEFAULT_OCCASIONS = {
    "Shirts":   ["work", "casual"],
    "Sweaters": ["casual", "work"],
    "Jackets":  ["casual", "work"],
    "Pants":    ["casual", "work"],
    "Shorts":   ["casual", "beach"],
    "Dresses":  ["casual", "party"],
    "Skirts":   ["casual", "work"],
    "Shoes":    ["casual"],
    "Hats":     ["casual", "outdoor"],
}

SEASON_BY_TYPE = {
    "outerwear": ["fall", "winter"],
    "sweaters":  ["fall", "winter", "spring"],
    "shorts":    ["spring", "summer"],
    "dress":     ["spring", "summer"],
}

# Season keywords to scan in item names
SEASON_KEYWORDS = {
    "winter": ["wool", "fleece", "down", "puffer", "parka", "thermal", "cable knit",
               "cashmere", "heavyweight", "cozy", "flannel", "sherpa"],
    "summer": ["linen", "tank", "swim", "tropical", "resort", "lightweight", "breathable",
               "seersucker", "chambray"],
    "fall":   ["corduroy", "plaid", "tweed", "suede"],
    "spring": ["floral", "pastel", "rain", "trench"],
}

# Temperature comfort ranges (°F) by article type
TEMP_RANGE_BY_TYPE = {
    "Jackets":  (None, 65),    # outerwear: wear below 65°F
    "Sweaters": (None, 68),    # sweater: wear below 68°F
    "Shirts":   (50, None),    # shirt: wear above 50°F
    "Shorts":   (68, None),    # shorts: wear above 68°F
    "Pants":    (None, None),  # pants: any temp
    "Dresses":  (60, None),    # dress: wear above 60°F
    "Skirts":   (60, None),
    "Shoes":    (None, None),
    "Hats":     (None, None),
}


def infer_occasions(name: str, article: str) -> list[str]:
    name_lower = name.lower()
    occasions = set()
    for occ, kws in OCCASION_KEYWORDS.items():
        if any(kw in name_lower for kw in kws):
            occasions.add(occ)
    if not occasions:
        # Fall back to article-type defaults rather than always "casual"
        defaults = ARTICLE_DEFAULT_OCCASIONS.get(article, ["casual"])
        occasions.update(defaults)
    return list(occasions)


def infer_season(name: str, article: str) -> list[str]:
    """Infer seasons from article type defaults + name keyword scan."""
    seasons = set(SEASON_BY_TYPE.get(article.lower(), []))
    name_lower = name.lower()
    for season, kws in SEASON_KEYWORDS.items():
        if any(kw in name_lower for kw in kws):
            seasons.add(season)
    # Outerwear/sweaters: if no specific season found, default to fall/winter
    if article in ("Jackets", "Sweaters") and not seasons:
        seasons = {"fall", "winter"}
    # Lightweight items: if no specific season found, default to spring/summer
    if article in ("Shorts", "Dresses", "Skirts") and not seasons:
        seasons = {"spring", "summer"}
    # Everything else with no signal: all seasons
    return sorted(seasons) if seasons else ["spring", "summer", "fall", "winter"]


# Color keywords to scan for in the item name.
# CSV color labels are unreliable (K-means artefacts, lighting bias, "multicolor" overuse).
# Name-based extraction is more trustworthy.
COLOR_KEYWORDS = [
    "black", "white", "grey", "gray", "navy", "blue", "red", "green",
    "olive", "khaki", "tan", "beige", "cream", "ivory", "brown", "camel",
    "burgundy", "wine", "maroon", "pink", "blush", "rose", "coral",
    "yellow", "gold", "orange", "rust", "purple", "lavender", "lilac",
    "teal", "mint", "sage", "charcoal", "silver", "denim", "chambray",
    "plaid", "stripe", "striped", "floral", "leopard", "camo",
]


def extract_colors_from_name(name: str) -> list[str]:
    """Pull colour words out of the item name; fall back to ['multicolor']."""
    name_lower = name.lower()
    found = [c for c in COLOR_KEYWORDS if c in name_lower]
    return found if found else ["multicolor"]


def load_csv(path: Path, gender: str) -> list[dict]:
    items = []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            article = row.get("article", "").strip()
            if article not in ARTICLE_TO_TYPE:
                continue
            item_type = ARTICLE_TO_TYPE[article]
            name = row.get("name", "").strip()
            brand = row.get("brand", "").strip()
            image_url = row.get("image_url", "").strip()
            color = extract_colors_from_name(name)
            occasions = infer_occasions(name, article)
            season = infer_season(name, article)
            temp_min, temp_max = TEMP_RANGE_BY_TYPE.get(article, (None, None))

            color_phrase = " and ".join(color) if color != ["multicolor"] else ""
            desc_color = f"{color_phrase} " if color_phrase else ""
            tags = [item_type, gender] + occasions + color
            description = (
                f"{name} by {brand}. A {desc_color}{article.lower()} "
                f"suitable for {', '.join(occasions)} occasions."
            )

            item: dict = {
                "name": name,
                "type": item_type,
                "color": color,
                "tags": tags,
                "occasion": occasions,
                "season": season,
                "brand": brand,
                "image_url": image_url,
                "description": description,
                "gender": gender,
            }
            if temp_min is not None:
                item["temp_min"] = temp_min
            if temp_max is not None:
                item["temp_max"] = temp_max
            items.append(item)
    return items


def seed_templates() -> None:
    templates = [
        {
            "name": "Business casual",
            "required_types": ["top", "bottom", "shoes"],
            "optional_types": ["outerwear", "accessory"],
        },
        {
            "name": "Smart formal",
            "required_types": ["top", "bottom", "shoes", "outerwear"],
            "optional_types": ["accessory"],
        },
        {
            "name": "Casual everyday",
            "required_types": ["top", "bottom", "shoes"],
            "optional_types": ["outerwear", "accessory"],
        },
        {
            "name": "Summer casual",
            "required_types": ["top", "shoes"],
            "optional_types": ["bottom", "accessory"],
        },
        {
            "name": "Evening / party",
            "required_types": ["top", "bottom", "shoes"],
            "optional_types": ["outerwear", "accessory"],
        },
    ]
    col = templates_col()
    col.delete_many({})
    col.insert_many(templates)
    print(f"Seeded {len(templates)} outfit templates.")


def seed_wardrobe(max_per_type: int = 12) -> None:
    scripts_dir = Path(__file__).parent.parent / "scripts"
    men_path = scripts_dir / "macysM.csv"
    women_path = scripts_dir / "macysW.csv"

    all_items: list[dict] = []
    if men_path.exists():
        all_items += load_csv(men_path, "men")
    if women_path.exists():
        all_items += load_csv(women_path, "women")

    if not all_items:
        print("No CSV files found in scripts/. Copy macysM.csv and macysW.csv there.")
        return

    # limit per type so we get a balanced wardrobe
    by_type: dict[str, list[dict]] = {}
    for item in all_items:
        by_type.setdefault(item["type"], []).append(item)

    selected: list[dict] = []
    for t, items in by_type.items():
        random.shuffle(items)
        selected += items[:max_per_type]

    print(f"Selected {len(selected)} items across {len(by_type)} types. Generating embeddings…")

    col = wardrobe_col()
    col.delete_many({})  # fresh seed

    import datetime

    for i, item in enumerate(selected):
        embedding = embed_text(item["description"])
        item["embedding"] = embedding
        item["created_at"] = datetime.datetime.utcnow()
        col.insert_one(item)

        if (i + 1) % 10 == 0:
            print(f"  {i + 1}/{len(selected)} embedded and inserted")
        # small delay to respect rate limits
        time.sleep(0.3)

    print(f"Done. {len(selected)} wardrobe items seeded.")


if __name__ == "__main__":
    seed_templates()
    seed_wardrobe()
    print("Seed complete.")
