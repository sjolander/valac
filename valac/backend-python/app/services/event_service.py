import asyncio
import logging

logger = logging.getLogger(__name__)

_subscribers: list[asyncio.Queue] = []


def subscribe() -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue()
    _subscribers.append(q)
    return q


def unsubscribe(q: asyncio.Queue) -> None:
    try:
        _subscribers.remove(q)
    except ValueError:
        pass


async def emit(event: str) -> None:
    logger.debug(f"Emitting {str}")
    for q in _subscribers:
        await q.put(event)