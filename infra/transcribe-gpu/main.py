import os
import tempfile
import asyncio
import time
import uuid
from typing import Optional
from dataclasses import dataclass, field

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel
import uvicorn
from deep_translator import GoogleTranslator

app = FastAPI(title="OpenReel Transcription API (GPU)")

ALLOWED_ORIGINS = [
    "https://openreel.video",
    "https://www.openreel.video",
    "https://app.openreel.video",
    "https://editor.openreel.video",
    "http://localhost:5173",
    "http://localhost:3000",
    "http://localhost:5174",
    "http://localhost:5175",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

whisper_model: Optional[WhisperModel] = None

MODEL_SIZE = os.environ.get("WHISPER_MODEL", "large-v3-turbo")
DEVICE = os.environ.get("WHISPER_DEVICE", "cuda")
COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "float16")

JOB_TTL_SECONDS = 600


@dataclass
class TranscriptionJob:
    id: str
    status: str = "processing"
    progress: float = 0
    result: Optional[dict] = None
    error: Optional[str] = None
    created_at: float = field(default_factory=time.time)


jobs: dict[str, TranscriptionJob] = {}


def cleanup_expired_jobs():
    now = time.time()
    expired = [
        jid for jid, job in jobs.items() if now - job.created_at > JOB_TTL_SECONDS
    ]
    for jid in expired:
        del jobs[jid]


def get_model() -> WhisperModel:
    global whisper_model
    if whisper_model is None:
        print(f"Loading Whisper model ({MODEL_SIZE}) on {DEVICE} ({COMPUTE_TYPE})...")
        whisper_model = WhisperModel(
            MODEL_SIZE, device=DEVICE, compute_type=COMPUTE_TYPE
        )
        print("Model loaded!")
    return whisper_model


@app.on_event("startup")
async def startup():
    get_model()


async def process_transcription(
    job_id: str,
    tmp_path: str,
    language: Optional[str],
    target_language: Optional[str],
):
    job = jobs[job_id]
    try:
        job.progress = 10

        model = get_model()

        transcribe_kwargs = {
            "word_timestamps": True,
            "vad_filter": True,
        }
        if language and isinstance(language, str) and len(language) <= 5:
            transcribe_kwargs["language"] = language

        use_whisper_translate = (
            target_language
            and target_language == "en"
            and (not language or language != "en")
        )
        if use_whisper_translate:
            transcribe_kwargs["task"] = "translate"

        job.progress = 20

        segments, info = model.transcribe(tmp_path, **transcribe_kwargs)

        words = []
        full_text = []

        job.progress = 50

        for segment in segments:
            full_text.append(segment.text.strip())
            if segment.words:
                for word in segment.words:
                    words.append(
                        {
                            "word": word.word.strip(),
                            "start": round(word.start, 2),
                            "end": round(word.end, 2),
                        }
                    )

        job.progress = 80

        text = " ".join(full_text)
        detected_language = info.language

        need_translation = (
            target_language
            and target_language != "en"
            and target_language != detected_language
            and not use_whisper_translate
        )

        if need_translation:
            try:
                translator = GoogleTranslator(
                    source=detected_language if detected_language else "auto",
                    target=target_language,
                )
                text = translator.translate(text)
                for w in words:
                    if len(w["word"]) > 1:
                        w["word"] = translator.translate(w["word"])
            except Exception as e:
                print(f"Translation failed: {e}")

        job.progress = 100
        job.status = "completed"
        job.result = {
            "text": text,
            "word_count": len(words),
            "words": words,
            "language": detected_language,
            "target_language": target_language,
            "duration": info.duration,
        }
    except Exception as e:
        job.status = "failed"
        job.error = str(e)
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


@app.post("/transcribe")
async def transcribe(
    request: Request,
    audio: UploadFile = File(...),
    language: Optional[str] = Form(None),
    target_language: Optional[str] = Form(None),
):
    if not audio.filename:
        raise HTTPException(status_code=400, detail="No audio file provided")

    cleanup_expired_jobs()

    suffix = os.path.splitext(audio.filename)[1] or ".wav"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        file_content = await audio.read()
        tmp.write(file_content)
        tmp_path = tmp.name

    job_id = str(uuid.uuid4())
    jobs[job_id] = TranscriptionJob(id=job_id)

    asyncio.get_event_loop().run_in_executor(
        None,
        lambda: asyncio.run(
            process_transcription(job_id, tmp_path, language, target_language)
        ),
    )

    return {"jobId": job_id, "status": "processing"}


@app.get("/jobs/{job_id}")
async def get_job(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    response = {
        "jobId": job.id,
        "status": job.status,
        "progress": job.progress,
    }

    if job.status == "completed":
        response["result"] = job.result
    elif job.status == "failed":
        response["error"] = job.error

    return response


@app.post("/")
async def transcribe_root(
    request: Request,
    audio: UploadFile = File(...),
    language: Optional[str] = Form(None),
    target_language: Optional[str] = Form(None),
):
    return await transcribe(request, audio, language, target_language)


@app.get("/health")
async def health():
    gpu_available = False
    gpu_name = None
    try:
        import torch

        gpu_available = torch.cuda.is_available()
        gpu_name = torch.cuda.get_device_name(0) if gpu_available else None
    except ImportError:
        pass

    return {
        "status": "ok",
        "model": MODEL_SIZE,
        "device": DEVICE,
        "compute_type": COMPUTE_TYPE,
        "gpu": gpu_name,
        "gpu_available": gpu_available,
        "ready": whisper_model is not None,
        "active_jobs": len(jobs),
    }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
