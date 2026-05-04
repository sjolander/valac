"""
Personalization service for Valac.

Handles storage and retrieval of user-specific facts, preferences,
constraints, and habits extracted from conversations.

TODO: Implement full personalization pipeline including:
  - Versioned fact storage with timestamps
  - Conflict detection and meta-observation generation
  - Separate Qdrant collection for user facts
"""

import logging
from app.models import StoredMemory

logger = logging.getLogger(__name__)


async def search_personal_facts(
    query_vector: list[float],
    user_id: str,
    limit: int = 10,
) -> list:
    """
    Retrieve user facts relevant to the current query.
    TODO: Implement semantic search against user_facts Qdrant collection.
    """
    return []


def format_personal_facts_for_prompt(facts: list) -> str:
    """
    Format retrieved user facts for injection into the system prompt.
    TODO: Implement formatting with versioning awareness.
    """
    return ""


async def extract_and_store_personal_facts(
    user_message: str,
    user_id: str,
    conversation_id: str,
) -> None:
    """
    Extract personal facts from user message and store them.
    Handles both new facts and updates to existing ones (versioned).
    TODO: Implement extraction pipeline and versioned Qdrant upsert.
    """
    pass