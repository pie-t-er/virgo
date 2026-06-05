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
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
]

SYSTEM_PROMPT = """You are Virgo, a friendly and knowledgeable personal wardrobe assistant.
You help users manage their clothing collection, plan outfits, and discover gaps in their wardrobe.

Your capabilities:
- Add new clothing items to their wardrobe catalog
- Search for clothes semantically (e.g. "something casual for a beach day")
- Recommend complete outfits composed of items they already own
- Plan outfits on their weekly calendar, avoiding repeat combinations
- Identify missing wardrobe pieces based on common outfit templates

STRICT RULES — follow these exactly:
- NEVER suggest or mention a clothing item that was not returned by a tool call in this conversation turn. Do not invent, imagine, or recall items from prior turns.
- When recommending an outfit, you MUST call semantic_search at least twice (once for a top, once for a bottom or shoes) and only recommend items that appear in those results. Name each item exactly as it appears in the tool output.
- If a tool returns fewer items than needed for a complete outfit, tell the user which piece is missing from their wardrobe rather than inventing one.
- ALWAYS use semantic_search to find items — it searches the actual wardrobe database. Never assume what the user owns.
- Only use get_wardrobe when the user explicitly asks to browse by type (e.g. "show me all my shoes") — always pass a type filter.
- When planning calendar outfits, first call get_calendar for the current week to check for repeats.
- Keep responses concise and friendly. Use bullet points for outfit recommendations.
- Reference item names exactly as returned by tools (e.g. "Khaki Pants by Dockers" not "some khaki trousers").
- If the user asks to add an item, call add_clothing_item immediately with the details provided.
- Dates must be YYYY-MM-DD format when calling tools.
- If a tool returns an error field, tell the user and suggest an alternative action.
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

        profile_lines = []
        if name:
            profile_lines.append(f"The user's name is {name}.")
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

async def run_turn(user_message: str) -> str:
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
            async for event in state.runner.run_async(
                user_id="demo_user",
                session_id=state.session_id,
                new_message=content,
            ):
                if event.is_final_response() and event.content:
                    for part in event.content.parts:
                        if part.text:
                            response_parts.append(part.text)
            return "\n".join(response_parts) or "I couldn't process that request."

        except (ClientError, ServerError) as e:
            msg = str(e)
            is_quota = "429" in msg or "RESOURCE_EXHAUSTED" in msg
            is_unavail = "503" in msg or "UNAVAILABLE" in msg
            if not (is_quota or is_unavail):
                raise

            # Try next model in rotation
            next_model = state.switch_model()
            if state.model_index in tried:
                break  # full loop exhausted
            # small pause before retrying
            await asyncio.sleep(1)
            continue

    return (
        "All models are currently at capacity. Please wait a moment and use "
        "the ↺ retry button to try again."
    )
