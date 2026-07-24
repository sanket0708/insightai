import json

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from agents import build_reader_agent, build_search_agent, critic_chain, writer_chain
from pipeline import run_research_pipeline

load_dotenv()


class ResearchRequest(BaseModel):
    topic: str


def serialize_content(value) -> str:
    if isinstance(value, str):
        return value

    if isinstance(value, list):
        parts = []
        for item in value:
            if isinstance(item, dict):
                text = item.get("text")
                if text and str(text).strip():
                    parts.append(str(text).strip())
            else:
                item_text = str(item).strip()
                if item_text:
                    parts.append(item_text)
        return "\n".join(parts)

    if isinstance(value, dict):
        text = value.get("text")
        if text and str(text).strip():
            return str(text).strip()
        return ""

    return str(value)


def event_line(payload: dict) -> str:
    return json.dumps(payload) + "\n"


app = FastAPI(title="InsightAI API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://insightai-backend-dv6i.onrender.com"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/research")
def research(req: ResearchRequest) -> dict:
    topic = req.topic.strip()
    if not topic:
        raise HTTPException(status_code=400, detail="Topic is required.")

    result = run_research_pipeline(topic)
    return {
        "topic": topic,
        "search_results": serialize_content(result.get("search_results", "")),
        "scraped_content": serialize_content(result.get("scraped_content", "")),
        "report": serialize_content(result.get("report", "")),
        "feedback": serialize_content(result.get("feedback", "")),
    }


@app.post("/research/stream")
def research_stream(req: ResearchRequest):
    topic = req.topic.strip()
    if not topic:
        raise HTTPException(status_code=400, detail="Topic is required.")

    def generate():
        state = {
            "topic": topic,
            "search_results": "",
            "scraped_content": "",
            "report": "",
            "feedback": "",
        }

        try:
            yield event_line(
                {
                    "event": "status",
                    "step": "start",
                    "message": f"Starting research on '{topic}'.",
                }
            )

            search_agent = build_search_agent()
            yield event_line(
                {
                    "event": "status",
                    "step": "search",
                    "message": "Step 1 of 4: searching the web for relevant sources.",
                }
            )
            search_result = search_agent.invoke(
                {
                    "messages": [
                        (
                            "user",
                            f"Find recent, reliable and detailed information about: {topic}",
                        )
                    ]
                }
            )
            state["search_results"] = serialize_content(
                search_result["messages"][-1].content
            )
            yield event_line(
                {
                    "event": "step_complete",
                    "step": "search",
                    "title": "Search results",
                    "content": state["search_results"],
                }
            )

            reader_agent = build_reader_agent()
            yield event_line(
                {
                    "event": "status",
                    "step": "reader",
                    "message": "Step 2 of 4: reading the best source in more depth.",
                }
            )
            reader_result = reader_agent.invoke(
                {
                    "messages": [
                        (
                            "user",
                            f"Based on the following search results about '{topic}', "
                            "pick the most relevant URL and scrape it for deeper content.\n\n"
                            f"Search Results:\n{state['search_results'][:800]}",
                        )
                    ]
                }
            )
            state["scraped_content"] = serialize_content(
                reader_result["messages"][-1].content
            )
            yield event_line(
                {
                    "event": "step_complete",
                    "step": "reader",
                    "title": "Scraped content",
                    "content": state["scraped_content"],
                }
            )

            yield event_line(
                {
                    "event": "status",
                    "step": "writer",
                    "message": "Step 3 of 4: drafting the research report.",
                }
            )
            research_combined = (
                f"SEARCH RESULTS:\n{state['search_results']}\n\n"
                f"DETAILED SCRAPED CONTENT:\n{state['scraped_content']}"
            )
            state["report"] = serialize_content(
                writer_chain.invoke({"topic": topic, "research": research_combined})
            )
            yield event_line(
                {
                    "event": "step_complete",
                    "step": "writer",
                    "title": "Final report",
                    "content": state["report"],
                }
            )

            yield event_line(
                {
                    "event": "status",
                    "step": "critic",
                    "message": "Step 4 of 4: reviewing the report critically.",
                }
            )
            state["feedback"] = serialize_content(
                critic_chain.invoke({"report": state["report"]})
            )
            yield event_line(
                {
                    "event": "step_complete",
                    "step": "critic",
                    "title": "Critic feedback",
                    "content": state["feedback"],
                }
            )

            yield event_line(
                {
                    "event": "done",
                    "topic": topic,
                    "result": state,
                }
            )
        except Exception as exc:
            yield event_line(
                {
                    "event": "error",
                    "message": str(exc),
                }
            )

    return StreamingResponse(generate(), media_type="application/x-ndjson")
