import httpx
import logging
import os
from bs4 import BeautifulSoup

SEARXNG_HOST = os.getenv("SEARXNG_HOST", "http://searxng:8080")

logger = logging.getLogger(__name__)


async def search(query: str, max_results: int = 5) -> list[dict]:
    """
    Run a query against SearXNG and return cleaned results.
    Each result is {"title": str, "url": str, "snippet": str}
    """
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(
                f"{SEARXNG_HOST}/search",
                params={
                    "q": query,
                    "format": "json",
                    "categories": "general",
                    "language": "en",
                },
            )
            response.raise_for_status()

        data = response.json()
        results = []

        for r in data.get("results", [])[:max_results]:
            snippet = r.get("content", "") or r.get("snippet", "")
            # Strip any residual HTML tags from snippets
            if snippet:
                snippet = BeautifulSoup(snippet, "html.parser").get_text()
            results.append({
                "title":   r.get("title", "").strip(),
                "url":     r.get("url", ""),
                "snippet": snippet.strip(),
            })

        logger.debug(f"SearXNG returned {len(results)} results for: {query!r}")
        return results

    except Exception as e:
        logger.warning(f"Search failed for {query!r}: {e}")
        return []


def format_search_results(results: list[dict]) -> str:
    """Format search results for injection into the system prompt."""
    if not results:
        return ""

    lines = ["## Current web search results"]
    for i, r in enumerate(results, 1):
        lines.append(f"{i}. **{r['title']}**")
        if r["snippet"]:
            lines.append(f"   {r['snippet']}")
        lines.append(f"   Source: {r['url']}")

    return "\n".join(lines)