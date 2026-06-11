"""
Virgo wardrobe agent — powered by Google ADK + Gemini.

Model rotation: when a model hits 429/503, the runner automatically
advances to the next model in MODEL_ROTATION and retries within the
same request, preserving session history.
"""
from __future__ import annotations

import asyncio
import os

from google.adk.agents import Agent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types as genai_types
from google.genai.errors import ClientError, ServerError

from backend.tools import ALL_TOOLS

# --------------------------------------------------------------------------- #
# Model rotation pool — each is a distinct quota bucket on the free tier.
# Ordered roughly best→most-available.
# --------------------------------------------------------------------------- #
MODEL_ROTATION = [
    "gemini-2.5-flash",       # primary — best reasoning, billing unlocked
    "gemini-2.5-flash-lite",  # fallback 1 — cheaper, still capable
    "gemini-3.5-flash",       # fallback 2
    "gemini-3.1-flash-lite",  # fallback 3
    "gemini-2.0-flash-lite",  # fallback 4 — last resort
]

SYSTEM_PROMPT = """You are Virgo, a friendly and knowledgeable personal wardrobe assistant.
You help users manage their clothing collection, plan outfits, and discover gaps in their wardrobe.

Your capabilities:
- Add new clothing items to their wardrobe catalog
- Search for clothes semantically (e.g. "something casual for a beach day")
- Recommend complete outfits composed of items they already own
- Plan outfits on their weekly calendar, avoiding repeat combinations
- Identify missing wardrobe pieces based on common outfit templates and style cohesion

STRICT RULES — follow these exactly:
- NEVER suggest or mention a clothing item that was not returned by a tool call in this conversation turn. Do not invent, imagine, or recall items from prior turns.
- When recommending an outfit, you MUST call semantic_search for EACH of these categories separately: top, bottom, shoes. That is a minimum of THREE semantic_search calls per outfit recommendation.
- If the weather temperature is at or below 60°F / 15°C, you MUST also call semantic_search for outerwear and include a jacket or coat.
- A complete outfit ALWAYS includes: top (or dress), bottom (unless dress), and shoes. Never omit shoes.
- When the user explicitly asks to accessorize an outfit, call get_wardrobe with the type filter set to "accessory" to retrieve all accessories, then suggest which ones complement the outfit. Do not call semantic_search for accessories.
- If a tool returns fewer items than needed for a complete outfit, tell the user which piece is missing from their wardrobe rather than inventing one.
- ALWAYS use semantic_search to find items — it searches the actual wardrobe database. Never assume what the user owns.
- Only use get_wardrobe when the user explicitly asks to browse by type (e.g. "show me all my shoes") — always pass a type filter.
- When planning calendar outfits, first call get_calendar for the current week to check for repeats. When planning outfits for multiple days at once (a full week, several days): (1) Strongly prefer not to reuse the same top or bottom across two different days — use a different style/occasion angle for each day's semantic_search calls (e.g. "smart casual Monday", "relaxed weekend", "sporty active day", "evening out look") so the results differ. (2) If the wardrobe is too small to avoid reuse entirely, it is acceptable to reuse a piece rather than skip an outfit — note the limitation briefly and suggest adding more items. Always plan SOMETHING for each day rather than skipping days entirely. (3) Confirm the full plan briefly in text only — do NOT append a standalone outfit recommendation or list items as "here's what to wear today." The calendar view already displays the saved outfits.
- Keep responses concise and friendly. Use bullet points for outfit recommendations.
- Reference item names exactly as returned by tools (e.g. "Khaki Pants by Dockers" not "some khaki trousers").
- If the user asks to add an item, call add_clothing_item immediately with the details provided.
- Dates must be YYYY-MM-DD format when calling tools.
- Never plan or schedule outfits for dates in the past. If the user asks to plan an outfit for a past date, politely decline and offer to plan for today or a future date instead.
- If a tool returns an error field, tell the user and suggest an alternative action.
- When the user asks about wardrobe gaps, missing pieces, or what to buy next, perform a FULL gap analysis. End your response after the analysis — do NOT suggest or recommend any specific outfits or item combinations at the end. Gap analysis responses are shopping/planning advice only.
  1. Call get_shopping_gaps to check which clothing types are missing from their wardrobe.
  2. Call get_wardrobe three times — once filtered by occasion "formal", once by "work", once by "casual" — to audit occasion coverage. If any occasion has fewer than 2 complete outfits worth of items, flag it as a style gap.
  3. Look for cohesion mismatches: e.g. the user has 8 casual tops but only 1 pair of casual shoes — the shoes are a bottleneck. Or they have formal shirts but no dress shoes. Name specific imbalances like this.
  4. Check seasonal gaps: if no outerwear exists for fall/winter, flag it.
  5. Summarize findings in sections: **Structural Gaps** (missing types), **Occasion Gaps** (underserved styles), **Cohesion Gaps** (items with no matching partners). Always be specific — name the actual counts and the specific missing piece, not vague advice.
- TRUST ALL TOOL RESULTS COMPLETELY. Never apologise for, question, or cast doubt on what a tool returns. Never say the tool "might not be accurate" or ask the user to manually correct tool output. If a tool says the wardrobe has X items of a type, present that as fact.
- Never ask the user to describe their own wardrobe — always use tools to look it up.
- When the user asks to visualize an outfit (e.g. "visualize what I'm wearing today", "show me what this looks like"), call get_calendar to find the relevant day's outfit, then list those items by name in your response. An outfit panel with a Visualize button will automatically appear in the UI for the user to click — tell them to click the ✨ Visualize button that appears below your message.
- When recommending outfits for a specific date or "today"/"tomorrow", try to call get_weather first if the user's location is known. If no location is set, proceed with the outfit recommendation without weather — you may briefly note that temperature wasn't factored in. Never block or delay an outfit recommendation just to ask for a location.
- If the user mentions their city or location in conversation, immediately call set_user_location to save it so it persists to their profile for future sessions.
"""


# --------------------------------------------------------------------------- #
# State shared across the app lifetime
# --------------------------------------------------------------------------- #

class AgentState:
    def __init__(self) -> None:
        self.session_service = InMemorySessionService()
        self.session_id: str = ""
        self.model_index: int = 0
        self.runner: Runner | None = None

    @property
    def current_model(self) -> str:
        return MODEL_ROTATION[self.model_index % len(MODEL_ROTATION)]

    def advance_model(self) -> str:
        self.model_index = (self.model_index + 1) % len(MODEL_ROTATION)
        return self.current_model

    def _build_runner(self) -> Runner:
        import datetime
        from backend.db import get_profile
        today = datetime.date.today().isoformat()
        profile = get_profile()
        gender = profile.get("gender", "")
        name = profile.get("name", "")

        location = profile.get("location", "")
        profile_lines = []
        if name:
            profile_lines.append(f"The user's name is {name}.")
        if location:
            profile_lines.append(f"The user's location is {location}. Use this when calling get_weather.")
        if gender:
            gender_label = {"men": "men's", "women": "women's"}.get(gender, "")
            if gender_label:
                profile_lines.append(
                    f"The user wears {gender_label} clothing. "
                    f"When recommending outfits, ONLY suggest items tagged for '{gender}' or unisex. "
                    f"Never mix men's and women's items in the same outfit."
                )
        profile_ctx = ("\n\nUser profile:\n" + "\n".join(profile_lines)) if profile_lines else \
            "\n\nNo gender preference is set yet. If the user asks for outfit recommendations, " \
            "first ask them whether they wear men's or women's clothing so you can filter correctly."

        instruction = SYSTEM_PROMPT + profile_ctx + f"\n\nToday's date is {today}. Use this when the user says 'tonight', 'tomorrow', 'this week', etc."
        agent = Agent(
            model=self.current_model,
            name="virgo",
            description="Personal wardrobe management and outfit recommendation agent",
            instruction=instruction,
            tools=ALL_TOOLS,
        )
        return Runner(
            agent=agent,
            app_name="virgo",
            session_service=self.session_service,
        )

    async def initialise(self) -> None:
        self.runner = self._build_runner()
        session = await self.session_service.create_session(
            app_name="virgo",
            user_id="demo_user",
        )
        self.session_id = session.id

    async def reset(self, rebuild: bool = False) -> None:
        """Create a fresh session (clears history). Pass rebuild=True to reload profile."""
        self.model_index = 0  # always restart from the primary model
        if rebuild:
            self.runner = self._build_runner()
        session = await self.session_service.create_session(
            app_name="virgo",
            user_id="demo_user",
        )
        self.session_id = session.id

    def switch_model(self) -> str:
        """Advance to next model and rebuild the runner (session preserved)."""
        new_model = self.advance_model()
        self.runner = self._build_runner()
        return new_model


_state: AgentState | None = None


def get_state() -> AgentState:
    assert _state is not None, "AgentState not initialised"
    return _state


async def init_state() -> AgentState:
    global _state
    _state = AgentState()
    await _state.initialise()
    return _state


# --------------------------------------------------------------------------- #
# Run a conversation turn with automatic model rotation on quota errors
# --------------------------------------------------------------------------- #

async def run_turn(user_message: str) -> dict:
    """
    Returns {"text": str, "items": list[dict]} where items are wardrobe
    items surfaced by tool calls during this turn (for inline card display).
    """
    state = get_state()
    content = genai_types.Content(
        role="user",
        parts=[genai_types.Part(text=user_message)],
    )

    tried: set[int] = set()

    while len(tried) < len(MODEL_ROTATION):
        tried.add(state.model_index)
        try:
            response_parts: list[str] = []
            surfaced_items: list[dict] = []
            seen_ids: set[str] = set()
            tools_called: set[str] = set()

            async for event in state.runner.run_async(
                user_id="demo_user",
                session_id=state.session_id,
                new_message=content,
            ):
                # Collect text from final response
                if event.is_final_response() and event.content and event.content.parts:
                    for part in event.content.parts:
                        if part.text:
                            response_parts.append(part.text)

                # Track which tools the model called (role="model", function_call parts)
                if (
                    event.content
                    and event.content.role == "model"
                    and event.content.parts
                ):
                    for part in event.content.parts:
                        if part.function_call:
                            tools_called.add(part.function_call.name)

                # Harvest wardrobe items from tool responses
                # ADK uses role="user" for function responses (not "tool")
                if (
                    event.content
                    and event.content.role == "user"
                    and event.content.parts
                ):
                    for part in event.content.parts:
                        if not part.function_response:
                            continue
                        result = part.function_response.response
                        # result is a dict like {"result": [...]} or the list itself
                        rows = result.get("result", result) if isinstance(result, dict) else result
                        if not isinstance(rows, list):
                            continue

                        def _harvest(obj: dict) -> None:
                            """Add obj if it's a wardrobe item; also recurse into nested items lists."""
                            item_id = obj.get("_id")
                            if item_id and item_id not in seen_ids and obj.get("name"):
                                seen_ids.add(item_id)
                                surfaced_items.append(obj)
                            # Calendar entries nest items under an "items" key
                            for nested in obj.get("items", []):
                                if isinstance(nested, dict):
                                    _harvest(nested)

                        for row in rows:
                            if isinstance(row, dict):
                                _harvest(row)

            text = "\n".join(response_parts) or "I couldn't process that request."

            # Suppress the outfit panel for planning and gap-analysis turns.
            # Use tool-call evidence first; fall back to keyword+search signal
            # to catch cases where the agent searched but never reached plan_outfit
            # (e.g. wardrobe too small to complete a day's outfit).
            _msg_lower = user_message.lower()
            _planning_keywords = (
                "plan outfit", "plan an outfit", "plan outfits",
                "outfit for the week", "outfits for next", "outfits for this",
                "next week", "this week", "outfit for monday", "outfit for tuesday",
                "outfit for wednesday", "outfit for thursday", "outfit for friday",
                "outfit for saturday", "outfit for sunday",
            )
            _is_planning_msg = any(kw in _msg_lower for kw in _planning_keywords)
            _suppress_panel = bool(
                tools_called & {"plan_outfit", "get_shopping_gaps"}
            ) or (_is_planning_msg and "semantic_search" in tools_called)

            if _suppress_panel:
                selected_items: list[dict] = []
                surfaced_items = []
            else:
                # Selected = items the agent actually named in its response
                text_lower = text.lower()
                selected_items = [
                    item for item in surfaced_items
                    if item.get("name", "").lower() in text_lower
                ]
                if not selected_items:
                    selected_items = surfaced_items[:6]

                # Belt-and-suspenders: more than 6 items still means bulk operation
                if len(selected_items) > 6:
                    selected_items = []
                    surfaced_items = []

            # Build candidate pool: all surfaced items grouped by type,
            # with the selected item for each type placed first so the
            # frontend can offer swaps without another API call.
            candidates: dict[str, list] = {}
            for item in surfaced_items:
                t = item.get("type", "other")
                candidates.setdefault(t, []).append(item)

            # Move selected items to front of their type bucket
            selected_ids = {i.get("_id") for i in selected_items}
            for t, pool in candidates.items():
                pool.sort(key=lambda x: (0 if x.get("_id") in selected_ids else 1))

            return {"text": text, "items": selected_items, "candidates": candidates}

        except Exception as e:
            msg = str(e)

            # Tool hallucination — LLM called a non-existent function name
            if (
                isinstance(e, ValueError)
                and "not found" in msg.lower()
                and "available tools" in msg.lower()
            ):
                state.switch_model()
                if state.model_index in tried:
                    return {
                        "text": "I got confused and tried to use a tool that doesn't exist. "
                                "Please try rephrasing your request.",
                        "items": [],
                        "candidates": {},
                    }
                await asyncio.sleep(1)
                continue

            # Quota / availability / deprecation — covers ClientError, ServerError,
            # and ADK-internal wrappers like _ResourceExhaustedError whose class
            # hierarchy may not include google.genai error types.
            is_quota      = "429" in msg or "RESOURCE_EXHAUSTED" in msg
            is_unavail    = "503" in msg or "UNAVAILABLE" in msg
            is_deprecated = "404" in msg or "NOT_FOUND" in msg

            if not (is_quota or is_unavail or is_deprecated):
                raise  # genuine unexpected error — let it surface

            state.switch_model()
            if state.model_index in tried:
                break
            # For quota errors, respect the retry delay hint if present
            import re as _re
            _delay_match = _re.search(r"retry in (\d+(?:\.\d+)?)s", msg)
            _sleep = min(float(_delay_match.group(1)), 10.0) if _delay_match else 2.0
            await asyncio.sleep(_sleep)
            continue

    return {
        "text": "All models are currently at capacity. Please wait a moment and use the ↺ retry button to try again.",
        "items": [],
    }
