"""Прокси к support_agent (Ollama/Qwen2.5 RAG-бот)."""

import os
import logging

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/support", tags=["support"])

SUPPORT_AGENT_URL = os.getenv("SUPPORT_AGENT_URL", "http://host.docker.internal:8080")


class SupportQuestion(BaseModel):
    text: str


@router.post("/ask")
async def ask_support(q: SupportQuestion):
    url = f"{SUPPORT_AGENT_URL}/ask"
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(url, json={"text": q.text})
            resp.raise_for_status()
            return resp.json()
    except httpx.ConnectError:
        logger.warning("support_agent недоступен: %s", url)
        raise HTTPException(status_code=502, detail="Ассистент поддержки недоступен. Проверьте, что support_agent запущен.")
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Ассистент поддержки не ответил вовремя.")
    except Exception as e:
        logger.exception("support proxy error: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/health")
async def support_health():
    """Проверка доступности support_agent."""
    url = f"{SUPPORT_AGENT_URL}/"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(url)
            return {"status": "ok", "agent_url": SUPPORT_AGENT_URL}
    except Exception:
        return {"status": "unavailable", "agent_url": SUPPORT_AGENT_URL}
