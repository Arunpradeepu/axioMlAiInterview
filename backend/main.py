from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from groq import Groq
import json

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

GROQ_KEY = "replace"
client = Groq(api_key=GROQ_KEY)

SYSTEM_PROMPT = """You are a professional interviewer conducting a SPOKEN ORAL phone interview.

ABSOLUTE RULES - NEVER BREAK:
1. NEVER ask the candidate to write, code, implement or build anything
2. NEVER use phrases: "write a function", "implement", "code this", "write a program"
3. Every question must be fully answerable by SPEAKING OUT LOUD
4. Ask only: definitions, explanations, comparisons, trade-offs, how things work conceptually
5. Keep questions SHORT and conversational - one focused question at a time
6. GOOD: "Explain how the virtual DOM works", "What is the difference between REST and GraphQL?", "How does event delegation work?", "When would you use Redis over a relational database?"
7. BAD (FORBIDDEN): "Write a function to...", "Implement a...", "Code a solution..."

Always respond in valid JSON only. No markdown, no code fences, no extra text."""


class GenerateQuestionRequest(BaseModel):
    domain: str
    difficulty: str = "medium"
    topic: str = ""
    previous_questions: list = []


class EvaluateAnswerRequest(BaseModel):
    question: str
    answer: str
    domain: str
    difficulty: str = "medium"
    attempt_number: int = 1


@app.get("/")
async def root():
    return {"message": "AI Interview Backend Running"}


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/generate-question")
async def generate_question(req: GenerateQuestionRequest):
    prev_q_text = ""
    if req.previous_questions:
        prev_q_text = f"Previously asked (do NOT repeat): {json.dumps(req.previous_questions)}"

    prompt = f"""Generate a {req.difficulty} difficulty oral interview question for domain: {req.domain}.
{f'Focus on topic: {req.topic}' if req.topic else ''}
{prev_q_text}

Respond ONLY with this exact JSON, no extra text:
{{
  "question": "the spoken question here",
  "topic": "specific topic being tested",
  "difficulty": "{req.difficulty}",
  "key_concepts": ["concept1", "concept2", "concept3"]
}}"""

    try:
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
            max_tokens=400
        )
        raw = response.choices[0].message.content.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        return json.loads(raw)
    except Exception as e:
        return {
            "question": f"Could not generate question: {str(e)}",
            "topic": req.domain,
            "difficulty": req.difficulty,
            "key_concepts": []
        }


@app.post("/evaluate-answer")
async def evaluate_answer(req: EvaluateAnswerRequest):
    prompt = f"""Evaluate this oral technical interview answer.

Domain: {req.domain}
Question: {req.question}
Candidate Answer: {req.answer}
Attempt: {req.attempt_number}

Respond ONLY with this exact JSON:
{{
  "score": 7,
  "confidence": "high",
  "feedback": "Conversational 2-3 sentence feedback spoken directly to the candidate.",
  "concepts_covered": ["concept1"],
  "concepts_missing": ["concept2"],
  "next_action": "next_question",
  "follow_up_question": null,
  "follow_up_type": null
}}

Rules:
- score: integer 0-10
- next_action: if score>=7 use "next_question"; if score 4-6 use "clarify" with follow_up_question; if score<=3 and attempt==1 use "simplify" with follow_up_question; if score<=3 and attempt>=2 use "move_topic"
- feedback must sound natural and spoken, not written — like a real interviewer talking"""

    try:
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,
            max_tokens=500
        )
        raw = response.choices[0].message.content.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        return json.loads(raw)
    except Exception as e:
        return {
            "score": 5,
            "confidence": "medium",
            "feedback": "Thanks for your answer. Let's keep going.",
            "concepts_covered": [],
            "concepts_missing": [],
            "next_action": "next_question",
            "follow_up_question": None,
            "follow_up_type": None
        }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)