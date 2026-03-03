from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from groq import Groq
from typing import Optional, List
import json

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

GROQ_KEY = GROQ_API_KEY
client = Groq(api_key=GROQ_KEY)


# ─────────────────────────────────────────────────────────────────────────────
# MODELS
# ─────────────────────────────────────────────────────────────────────────────
class GenerateQuestionRequest(BaseModel):
    domain: str
    difficulty: str = "mid"
    previous_questions: List[str] = []
    covered_topics: List[str] = []
    candidate_name: str = ""
    job_role: str = ""
    experience_level: str = ""

class EvaluateAnswerRequest(BaseModel):
    question: str
    answer: str
    domain: str
    job_role: str = ""
    experience_level: str = ""
    difficulty: str = "mid"
    attempt_number: int = 1
    is_follow_up: bool = False

class SufficiencyRequest(BaseModel):
    question: str
    answer: str


# ─────────────────────────────────────────────────────────────────────────────
# HEALTH
# ─────────────────────────────────────────────────────────────────────────────
@app.get("/")
async def root():
    return {"message": "AI Interview Backend Running"}

@app.get("/health")
async def health():
    return {"status": "ok"}


# ─────────────────────────────────────────────────────────────────────────────
# GENERATE QUESTION
# ─────────────────────────────────────────────────────────────────────────────
@app.post("/generate-question")
async def generate_question(req: GenerateQuestionRequest):
    prev_text    = json.dumps(req.previous_questions[-6:]) if req.previous_questions else "none"
    topics_text  = ", ".join(req.covered_topics) if req.covered_topics else "none"

    system = f"""You are a professional technical interviewer conducting a SPOKEN ORAL interview.
You are interviewing a {req.experience_level} candidate applying for a {req.job_role} position.

STRICT RULES:
1. Ask only role-relevant questions for a {req.job_role}.
2. Scale difficulty to {req.experience_level} level:
   - Fresher: foundational concepts, simple definitions
   - Mid-level: applied knowledge, trade-offs
   - Senior: architecture, design decisions, depth
3. Questions must be answerable by SPEAKING — no coding, no writing.
4. Keep questions SHORT: 1–2 sentences, under 35 words.
5. Do NOT repeat these topics already covered: {topics_text}
6. Vary the type: mix technical, conceptual, and behavioural questions.
7. Previously asked (do NOT repeat): {prev_text}

Respond in valid JSON only. No markdown, no code fences."""

    prompt = f"""Generate one interview question for {req.candidate_name or "the candidate"}.

Respond ONLY with this JSON:
{{
  "question": "short spoken question here",
  "topic": "one-word or two-word topic label (e.g. 'CSS Flexbox', 'System Design', 'Behavioral')",
  "difficulty": "{req.difficulty}",
  "key_concepts": ["concept1", "concept2"]
}}"""

    try:
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role":"system","content":system}, {"role":"user","content":prompt}],
            temperature=0.75,
            max_tokens=300,
        )
        raw = response.choices[0].message.content.strip()
        raw = _clean_json(raw)
        data = json.loads(raw)
        # Hard-trim question to 40 words
        words = data.get("question","").split()
        if len(words) > 40:
            data["question"] = " ".join(words[:40]).rstrip(",.") + "?"
        return data
    except Exception as e:
        return {
            "question": f"Can you explain a key concept you use regularly as a {req.job_role}?",
            "topic": req.domain,
            "difficulty": req.difficulty,
            "key_concepts": [],
        }


# ─────────────────────────────────────────────────────────────────────────────
# EVALUATE ANSWER
# ─────────────────────────────────────────────────────────────────────────────
@app.post("/evaluate-answer")
async def evaluate_answer(req: EvaluateAnswerRequest):
    follow_note = ""
    if req.is_follow_up:
        follow_note = "\nIMPORTANT: This is a follow-up. ALWAYS set next_action='next_question' and follow_up_question=null."

    system = f"""You are evaluating a spoken oral interview answer.
The candidate is a {req.experience_level} applying for {req.job_role}.
Score relative to that level — expect more from Senior, be lenient with Fresher.
Feedback must be 1–2 short spoken sentences, natural and direct."""

    prompt = f"""Question: {req.question}
Candidate Answer: {req.answer}
{follow_note}

Reply ONLY with this JSON:
{{
  "score": 7,
  "feedback": "Short spoken 1-2 sentence feedback.",
  "concepts_covered": ["concept1"],
  "concepts_missing": ["concept2"],
  "next_action": "next_question",
  "follow_up_question": null
}}

next_action rules:
- score >= 7 → "next_question", follow_up_question = null
- score 4–6 AND NOT follow_up → "clarify", provide a SHORT 1-sentence follow_up_question
- score <= 3 AND NOT follow_up → "simplify", provide a SHORT 1-sentence follow_up_question
- is_follow_up = true → ALWAYS "next_question", follow_up_question = null

feedback style: Conversational. Start with "Good", "That's right", "Not quite —", etc. Never say "your answer"."""

    try:
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role":"system","content":system}, {"role":"user","content":prompt}],
            temperature=0.3,
            max_tokens=400,
        )
        raw = _clean_json(response.choices[0].message.content.strip())
        data = json.loads(raw)
        # Safety: force next_question on follow-ups
        if req.is_follow_up:
            data["next_action"] = "next_question"
            data["follow_up_question"] = None
        # Trim follow-up question
        fq = data.get("follow_up_question")
        if fq:
            words = fq.split()
            if len(words) > 30:
                data["follow_up_question"] = " ".join(words[:30]).rstrip(",.") + "?"
        return data
    except Exception:
        return {
            "score": 5,
            "feedback": "Thanks for that answer. Let's move on.",
            "concepts_covered": [],
            "concepts_missing": [],
            "next_action": "next_question",
            "follow_up_question": None,
        }


# ─────────────────────────────────────────────────────────────────────────────
# SMART SUFFICIENCY CHECK
# Returns {"sufficient": true/false}
# Used to decide whether a follow-up is actually needed.
# ─────────────────────────────────────────────────────────────────────────────
@app.post("/check-sufficiency")
async def check_sufficiency(req: SufficiencyRequest):
    prompt = f"""Question: "{req.question}"
Answer: "{req.answer}"

Was this answer sufficient and reasonably complete for the question asked?
Reply with ONLY one word: YES or NO"""

    try:
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": "You are a strict but fair interview evaluator. Reply only YES or NO."},
                {"role": "user",   "content": prompt},
            ],
            temperature=0.0,
            max_tokens=5,
        )
        word = response.choices[0].message.content.strip().upper()
        return {"sufficient": word.startswith("Y")}
    except Exception:
        return {"sufficient": True}  # default: treat as sufficient


# ─────────────────────────────────────────────────────────────────────────────
# HELPER
# ─────────────────────────────────────────────────────────────────────────────
def _clean_json(raw: str) -> str:
    """Strip markdown code fences if present."""
    if raw.startswith("```"):
        parts = raw.split("```")
        raw = parts[1] if len(parts) > 1 else raw
        if raw.startswith("json"):
            raw = raw[4:]
    return raw.strip()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)