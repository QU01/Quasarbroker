"""OSINT Investigation Agent — deepagents-powered conversational OSINT analyst.

Creates a LangGraph agent with all QuasarBroker tools, session management,
and SSE streaming support for the frontend InvestigationPanel.

Supports OpenRouter (default), Anthropic, and OpenAI as LLM providers.
API keys can be set via .env OR at runtime from the frontend.
"""
import os
import uuid
import json
import logging
import asyncio
import threading
from typing import AsyncGenerator
from cachetools import TTLCache

logger = logging.getLogger(__name__)

# Session store — 1 hour TTL, max 50 concurrent sessions
_sessions: TTLCache = TTLCache(maxsize=50, ttl=3600)

# Runtime credential store — keys set from frontend override .env
_runtime_config: dict = {}
_config_lock = threading.Lock()

# System prompt for the OSINT analyst agent
OSINT_SYSTEM_PROMPT = """You are SHADOW, an elite OSINT (Open Source Intelligence) analyst embedded in the QuasarBroker intelligence platform. You have access to powerful investigation tools that span person intelligence, live geospatial data, and web research.

## Your Capabilities

### Person Intelligence
- **person_lookup**: Full OSINT scan — Sherlock (150+ sites), email enum, GitHub, HIBP breaches, WHOIS, DNS, Wayback, pastes
- **sherlock_scan**: Username enumeration across 150+ websites
- **email_enumerate**: Check email registration across services
- **github_lookup**: Deep GitHub profile analysis
- **hibp_check**: Data breach exposure check
- **whois_lookup**: Domain RDAP/WHOIS registration data
- **dns_recon**: Subdomain enumeration + DNS records via Certificate Transparency
- **wayback_lookup**: Internet Archive snapshot check

### Live Intelligence Feeds
- **get_live_flights**: Real-time military, tracked, and private aircraft positions
- **get_live_ships**: AIS vessel tracking data
- **get_live_earthquakes**: USGS + Mexico SSN seismic data
- **get_live_news**: Geolocated risk-scored news from 30+ RSS feeds
- **get_live_conflicts**: GDELT + LiveUAMap incident data
- **get_mexico_data**: Mexican military, PEMEX, volcanoes, weather alerts, infrastructure
- **get_region_intelligence**: Country/region intelligence dossier for coordinates
- **search_flights_by_callsign**: Find specific aircraft by callsign
- **search_ships_by_name**: Find specific vessels by name or MMSI

### Web Research
- **web_search**: DuckDuckGo web search for any OSINT topic
- **web_search_news**: DuckDuckGo news search for recent mentions
- **web_scrape**: Extract readable text from any webpage

## Investigation Methodology

When investigating a person or entity:
1. **Start broad**: Use person_lookup for a comprehensive initial scan
2. **Cross-reference**: Found a GitHub username? Check repos for domains/emails. Found a domain? Run DNS recon and WHOIS.
3. **Go deeper**: Use web_search to find additional context, web_scrape to read relevant pages
4. **Correlate**: Link findings — usernames across platforms, email-to-domain connections, location patterns
5. **Report**: Synthesize findings into a clear, structured intelligence brief

## Response Guidelines

- Be direct and analytical. Present findings with confidence levels (confirmed, likely, unverified).
- Use markdown formatting: headers, tables, bullet points for clarity.
- When you find something interesting, explain its significance.
- If a tool returns no results, say so briefly and move on — don't apologize.
- Always cite the source tool/platform for each finding.
- For sensitive data (breaches, leaked credentials), present factually without judgment.
- Respond in the same language the user uses (Spanish, English, etc.).

## Important Notes
- All data comes from publicly available OSINT sources — no private databases.
- Sherlock scan takes ~20 seconds as it checks 150+ sites in parallel.
- Some tools require API keys (HIBP); if unavailable, note it and proceed with other tools.
- Live data feeds update every 60s (flights/ships) to 5min (news/earthquakes).
"""


def set_runtime_config(api_key: str = "", model: str = "", provider: str = "") -> dict:
    """Set LLM credentials at runtime (from frontend). Clears all sessions."""
    with _config_lock:
        if api_key:
            _runtime_config["api_key"] = api_key
        if model:
            _runtime_config["model"] = model
        if provider:
            _runtime_config["provider"] = provider.lower()

    # Clear all existing sessions so they pick up the new key
    _sessions.clear()

    available = is_agent_available()
    return {
        "configured": available,
        "provider": _get_provider(),
        "model": _get_model(),
    }


def get_agent_config() -> dict:
    """Return current agent config (without exposing the full key)."""
    key = _get_api_key()
    return {
        "available": bool(key),
        "provider": _get_provider(),
        "model": _get_model(),
        "key_set": bool(key),
        "key_preview": f"{key[:8]}...{key[-4:]}" if key and len(key) > 12 else ("***" if key else ""),
        "sessions": len(_sessions),
    }


def _get_api_key() -> str:
    """Get API key from runtime config, falling back to env vars."""
    with _config_lock:
        rt_key = _runtime_config.get("api_key", "")
    if rt_key:
        return rt_key
    # Fallback chain: OPENROUTER_API_KEY → ANTHROPIC_API_KEY → OPENAI_API_KEY
    return (
        os.environ.get("OPENROUTER_API_KEY", "")
        or os.environ.get("ANTHROPIC_API_KEY", "")
        or os.environ.get("OPENAI_API_KEY", "")
    )


def _get_provider() -> str:
    with _config_lock:
        rt = _runtime_config.get("provider", "")
    if rt:
        return rt
    return os.environ.get("AGENT_LLM_PROVIDER", "openrouter").lower()


def _get_model() -> str:
    with _config_lock:
        rt = _runtime_config.get("model", "")
    if rt:
        return rt
    return os.environ.get("AGENT_LLM_MODEL", "")


# Default models per provider
_DEFAULT_MODELS = {
    "openrouter": "anthropic/claude-sonnet-4",
    "anthropic": "claude-sonnet-4-20250514",
    "openai": "gpt-4o",
}


def _get_llm():
    """Initialize the LLM based on runtime/env configuration.

    Supports:
      - openrouter (default): Uses OpenAI-compatible API at openrouter.ai
      - anthropic: Direct Anthropic API
      - openai: Direct OpenAI API
    """
    provider = _get_provider()
    model_name = _get_model() or _DEFAULT_MODELS.get(provider, "anthropic/claude-sonnet-4")
    api_key = _get_api_key()

    if not api_key:
        raise ValueError("No API key configured. Set one via the Agent panel or backend .env")

    if provider == "openrouter":
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(
            model=model_name,
            api_key=api_key,
            base_url="https://openrouter.ai/api/v1",
            temperature=0.1,
            streaming=True,
            max_tokens=4096,
            default_headers={
                "HTTP-Referer": "https://quasarbroker.app",
                "X-Title": "QuasarBroker OSINT Agent",
            },
        )
    elif provider == "openai":
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(
            model=model_name,
            api_key=api_key,
            temperature=0.1,
            streaming=True,
        )
    else:  # anthropic
        from langchain_anthropic import ChatAnthropic
        return ChatAnthropic(
            model=model_name,
            api_key=api_key,
            temperature=0.1,
            streaming=True,
            max_tokens=4096,
        )


def is_agent_available() -> bool:
    """Check if the agent can be initialized (any API key is configured)."""
    return bool(_get_api_key())


def _create_agent():
    """Create a deepagents OSINT agent with all QuasarBroker tools."""
    from services.agent_tools import ALL_TOOLS

    try:
        # Try deepagents first
        from deepagents import create_deep_agent
        llm = _get_llm()
        agent = create_deep_agent(
            model=llm,
            tools=ALL_TOOLS,
            system_prompt=OSINT_SYSTEM_PROMPT,
        )
        logger.info("OSINT agent created via deepagents")
        return agent, "deepagents"
    except ImportError:
        logger.warning("deepagents not available, falling back to LangGraph ReAct agent")
    except Exception as e:
        logger.warning(f"deepagents failed ({e}), falling back to LangGraph ReAct agent")

    # Fallback: plain LangGraph ReAct agent
    try:
        from langgraph.prebuilt import create_react_agent
        llm = _get_llm()
        agent = create_react_agent(
            llm,
            tools=ALL_TOOLS,
            prompt=OSINT_SYSTEM_PROMPT,
        )
        logger.info("OSINT agent created via LangGraph ReAct (fallback)")
        return agent, "langgraph"
    except ImportError:
        logger.warning("LangGraph not available, falling back to basic LangChain agent")

    # Final fallback: basic LangChain AgentExecutor
    from langchain.agents import AgentExecutor, create_tool_calling_agent
    from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

    llm = _get_llm()
    prompt = ChatPromptTemplate.from_messages([
        ("system", OSINT_SYSTEM_PROMPT),
        MessagesPlaceholder(variable_name="chat_history", optional=True),
        ("human", "{input}"),
        MessagesPlaceholder(variable_name="agent_scratchpad"),
    ])
    agent = create_tool_calling_agent(llm, ALL_TOOLS, prompt)
    executor = AgentExecutor(
        agent=agent,
        tools=ALL_TOOLS,
        verbose=False,
        max_iterations=15,
        handle_parsing_errors=True,
    )
    logger.info("OSINT agent created via LangChain AgentExecutor (final fallback)")
    return executor, "langchain"


class AgentSession:
    """Manages a single agent conversation session."""

    def __init__(self):
        self.session_id = str(uuid.uuid4())
        self.messages: list[dict] = []
        self.agent, self.agent_type = _create_agent()
        self.token_count = 0
        self.max_tokens = 100_000
        self.provider = _get_provider()
        self.model = _get_model() or _DEFAULT_MODELS.get(self.provider, "")

    async def stream_response(self, user_message: str) -> AsyncGenerator[str, None]:
        """Stream the agent's response as SSE events."""
        self.messages.append({"role": "user", "content": user_message})

        try:
            if self.agent_type in ("deepagents", "langgraph"):
                async for event in self._stream_langgraph(user_message):
                    yield event
            else:
                async for event in self._stream_langchain(user_message):
                    yield event
        except Exception as e:
            logger.error(f"Agent error: {e}")
            yield f"event: error\ndata: {json.dumps({'error': str(e)})}\n\n"

        yield "event: done\ndata: {}\n\n"

    async def _stream_langgraph(self, user_message: str) -> AsyncGenerator[str, None]:
        """Stream from a LangGraph/deepagents agent."""
        from langchain_core.messages import HumanMessage

        input_messages = {"messages": [HumanMessage(content=user_message)]}
        config = {"configurable": {"thread_id": self.session_id}}

        full_response = ""

        try:
            # Try astream_events for token-level streaming
            async for event in self.agent.astream_events(input_messages, config=config, version="v2"):
                kind = event.get("event", "")

                if kind == "on_chat_model_stream":
                    chunk = event.get("data", {}).get("chunk")
                    if chunk and hasattr(chunk, "content") and chunk.content:
                        content = chunk.content
                        if isinstance(content, str):
                            full_response += content
                            yield f"event: token\ndata: {json.dumps({'content': content})}\n\n"

                elif kind == "on_tool_start":
                    tool_name = event.get("name", "unknown")
                    tool_input = event.get("data", {}).get("input", {})
                    yield f"event: tool_start\ndata: {json.dumps({'tool': tool_name, 'input': _summarize_input(tool_input)})}\n\n"

                elif kind == "on_tool_end":
                    tool_name = event.get("name", "unknown")
                    output = event.get("data", {}).get("output", "")
                    summary = _summarize_output(output)
                    yield f"event: tool_end\ndata: {json.dumps({'tool': tool_name, 'summary': summary})}\n\n"

        except NotImplementedError:
            # Fallback to non-streaming invoke in a thread
            result = await asyncio.to_thread(
                self.agent.invoke, input_messages, config
            )
            messages = result.get("messages", [])
            if messages:
                last = messages[-1]
                content = last.content if hasattr(last, "content") else str(last)
                full_response = content
                yield f"event: token\ndata: {json.dumps({'content': content})}\n\n"

        if full_response:
            self.messages.append({"role": "assistant", "content": full_response})

    async def _stream_langchain(self, user_message: str) -> AsyncGenerator[str, None]:
        """Stream from a basic LangChain AgentExecutor."""
        full_response = ""

        try:
            # AgentExecutor streaming
            async for event in self.agent.astream(
                {"input": user_message, "chat_history": self.messages[:-1]},
            ):
                if "output" in event:
                    content = event["output"]
                    full_response = content
                    yield f"event: token\ndata: {json.dumps({'content': content})}\n\n"
                elif "actions" in event:
                    for action in event["actions"]:
                        yield f"event: tool_start\ndata: {json.dumps({'tool': action.tool, 'input': _summarize_input(action.tool_input)})}\n\n"
                elif "steps" in event:
                    for step in event["steps"]:
                        summary = _summarize_output(step.observation)
                        yield f"event: tool_end\ndata: {json.dumps({'tool': step.action.tool, 'summary': summary})}\n\n"
        except Exception:
            # Final fallback: non-streaming
            result = await asyncio.to_thread(
                self.agent.invoke,
                {"input": user_message, "chat_history": self.messages[:-1]},
            )
            content = result.get("output", str(result))
            full_response = content
            yield f"event: token\ndata: {json.dumps({'content': content})}\n\n"

        if full_response:
            self.messages.append({"role": "assistant", "content": full_response})


def get_or_create_session(session_id: str = "") -> AgentSession:
    """Get an existing session or create a new one."""
    if session_id and session_id in _sessions:
        return _sessions[session_id]

    session = AgentSession()
    _sessions[session.session_id] = session
    return session


def clear_session(session_id: str) -> bool:
    """Clear a session's history."""
    if session_id in _sessions:
        del _sessions[session_id]
        return True
    return False


def _summarize_input(tool_input) -> str:
    """Create a brief summary of tool input for the SSE event."""
    if isinstance(tool_input, dict):
        parts = []
        for k, v in tool_input.items():
            if v:
                parts.append(f"{k}={str(v)[:50]}")
        return ", ".join(parts[:3])
    return str(tool_input)[:100]


def _summarize_output(output) -> str:
    """Create a brief summary of tool output for the SSE event."""
    if isinstance(output, str):
        try:
            data = json.loads(output)
            if isinstance(data, list):
                return f"{len(data)} results"
            if isinstance(data, dict):
                if "error" in data:
                    return f"Error: {data['error']}"
                keys = list(data.keys())[:5]
                return f"Keys: {', '.join(keys)}"
        except (json.JSONDecodeError, TypeError):
            pass
        return output[:100] + ("..." if len(output) > 100 else "")
    return str(output)[:100]
