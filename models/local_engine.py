#!/usr/bin/env python3
"""
Hafiz Bel'Amya — Built-in Direct Local Disk Inference Engine
Runs local weights directly on the user's machine (NO external API server required):
  - .gguf LLMs via llama-cpp-python
  - HuggingFace CausalLMs / Seq2Seq directories via transformers + torch
  - CTranslate2 Whisper & HuggingFace ASR & Whisper .pt via faster-whisper / transformers
  - Piper .onnx & HuggingFace TTS & Coqui XTTS-v2 via piper / transformers / TTS
  - Coqui XTTS-v2 local voice cloning directory

Supports two modes:
  1) Inspection mode: `python3 models/local_engine.py --inspect <modelPath> [slotId]`
  2) Execution mode:  reads JSON payload from stdin, writes JSON result to stdout.
"""

import base64
import gc
import importlib.util
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import wave
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple


ACTIVE_MODEL_CACHE: Dict[str, Any] = {
    "key": None,
    "instance": None,
}


def free_gpu_memory() -> None:
    """Explicitly release Python objects and flush PyTorch CUDA / MPS VRAM caches."""
    gc.collect()
    if importlib.util.find_spec("torch") is not None:
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
                if hasattr(torch.cuda, "ipc_collect"):
                    torch.cuda.ipc_collect()
            if hasattr(torch, "mps") and hasattr(torch.mps, "empty_cache"):
                torch.mps.empty_cache()
        except Exception:
            pass


def unload_active_model() -> Optional[str]:
    """Unload any currently cached model from RAM/VRAM immediately."""
    prev_key = ACTIVE_MODEL_CACHE.get("key")
    ACTIVE_MODEL_CACHE["key"] = None
    ACTIVE_MODEL_CACHE["instance"] = None
    free_gpu_memory()
    return prev_key


def apply_vram_limit_percent(percent: Optional[float]) -> None:
    """Constrain PyTorch CUDA per-process memory allocation so GPU stays stable without freezing desktop."""
    if percent is None:
        return
    try:
        frac = max(0.25, min(0.98, float(percent) / 100.0))
    except (TypeError, ValueError):
        return
    if importlib.util.find_spec("torch") is not None:
        try:
            import torch

            if torch.cuda.is_available() and hasattr(torch.cuda, "set_per_process_memory_fraction"):
                torch.cuda.set_per_process_memory_fraction(frac, 0)
        except Exception:
            pass


def get_or_load_single_model(cache_key: str, loader: Callable[[], Any]) -> Any:
    """Guarantee only ONE model exists in RAM/VRAM at a time."""
    if ACTIVE_MODEL_CACHE.get("key") == cache_key and ACTIVE_MODEL_CACHE.get("instance") is not None:
        return ACTIVE_MODEL_CACHE["instance"]
    unload_active_model()
    instance = loader()
    ACTIVE_MODEL_CACHE["key"] = cache_key
    ACTIVE_MODEL_CACHE["instance"] = instance
    return instance


PACKAGE_IMPORT_MAP = {
    "llama_cpp": "llama-cpp-python",
    "transformers": "transformers",
    "accelerate": "accelerate",
    "safetensors": "safetensors",
    "torch": "torch",
    "faster_whisper": "faster-whisper",
    "whisper": "openai-whisper",
    "piper": "piper-tts",
    "onnxruntime": "onnxruntime",
    "TTS": "TTS",
    "omnivoice": "omnivoice",
    "soundfile": "soundfile",
    "librosa": "librosa",
    "numpy": "numpy",
}


def sanitize_path_str(raw: str) -> str:
    s = (raw or "").strip()
    if len(s) >= 2 and ((s[0] == '"' and s[-1] == '"') or (s[0] == "'" and s[-1] == "'")):
        s = s[1:-1].strip()
    return s


def resolve_hf_snapshot_dir(p: Path) -> Path:
    """If user points to a HuggingFace cache root (models--org--name), resolve snapshots/<hash>."""
    snaps = p / "snapshots"
    if snaps.is_dir():
        candidates = [d for d in sorted(snaps.iterdir(), reverse=True) if d.is_dir()]
        if candidates:
            return candidates[0]
    return p


def has_pkg(mod_name: str) -> bool:
    return importlib.util.find_spec(mod_name) is not None


def strip_think_blocks(text: str) -> str:
    return re.sub(r"<think>[\s\S]*?</think>", "", text, flags=re.IGNORECASE).strip()


def extract_json_from_text(raw_text: str) -> Any:
    cleaned = strip_think_blocks(raw_text)
    cleaned = re.sub(r"^```json\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"^```\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"```\s*$", "", cleaned, flags=re.IGNORECASE).strip()
    try:
        return json.loads(cleaned)
    except Exception:
        first_brace = cleaned.find("{")
        last_brace = cleaned.rfind("}")
        if first_brace != -1 and last_brace > first_brace:
            return json.loads(cleaned[first_brace : last_brace + 1])
        raise ValueError(f"Model output is not valid JSON: {cleaned[:200]}")


def get_dir_size_bytes(p: Path) -> int:
    if p.is_file():
        return p.stat().st_size
    total = 0
    for root, _, files in os.walk(p):
        for fn in files:
            try:
                total += os.path.getsize(os.path.join(root, fn))
            except OSError:
                pass
    return total


def detect_model_kind(model_path_str: str, slot_id: str = "") -> Tuple[str, List[str]]:
    """Classify a local file or directory into a runnable engine type + required Python modules."""
    p = resolve_hf_snapshot_dir(Path(sanitize_path_str(model_path_str)))
    name_lower = p.name.lower()
    full_lower = str(p).lower()

    if p.is_file():
        if name_lower.endswith(".py"):
            return "python_script", []
        if name_lower.endswith(".gguf"):
            return "gguf", ["llama_cpp"]
        if name_lower.endswith(".onnx"):
            if slot_id == "tts_reader" or Path(f"{model_path_str}.json").exists():
                return "piper_onnx", ["piper"]
            return "onnx_generic", ["onnxruntime"]
        if name_lower.endswith(".pt") or name_lower.endswith(".pth"):
            if slot_id == "asr_diacritics":
                return "whisper_pt", ["whisper"]
            if slot_id == "voice_clone":
                return "rvc_or_pth_voice", ["torch"]
            return "torch_checkpoint", ["torch"]
        if name_lower.endswith(".safetensors") or name_lower.endswith(".bin"):
            if "omnivoice" in full_lower:
                return "omnivoice", ["omnivoice", "torch", "transformers", "soundfile"]
            parent = p.parent
            if (parent / "config.json").exists():
                return detect_model_kind(str(parent), slot_id)
            return "raw_weight_file", ["torch", "safetensors"]
        return "unknown_file", []

    if p.is_dir():
        files_lower = {f.name.lower() for f in p.iterdir() if f.is_file()}

        # OmniVoice TTS & Zero-Shot Voice Cloning folder
        if "omnivoice" in full_lower and any(f.endswith((".safetensors", ".bin", ".pt")) for f in files_lower):
            return "omnivoice", ["omnivoice", "torch", "transformers", "soundfile"]

        # CTranslate2 Whisper directory
        if "model.bin" in files_lower and (
            slot_id == "asr_diacritics"
            or "vocabulary.json" in files_lower
            or "vocabulary.txt" in files_lower
            or "whisper" in name_lower
        ):
            return "ct2_whisper", ["faster_whisper"]

        # Coqui XTTS-v2 / TTS directory
        if (
            "speakers_xtts.pth" in files_lower
            or "xtts" in name_lower
            or (slot_id == "voice_clone" and "config.json" in files_lower and "vocab.json" in files_lower)
        ):
            return "coqui_xtts", ["TTS"]

        # HuggingFace directory
        if "config.json" in files_lower:
            if slot_id == "asr_diacritics":
                return "hf_asr", ["transformers", "torch", "soundfile"]
            if slot_id == "tts_reader":
                return "hf_tts", ["transformers", "torch", "soundfile"]
            return "hf_llm", ["transformers", "torch"]

        # Directory containing a .gguf inside
        ggufs = list(p.glob("*.gguf"))
        if ggufs:
            return "gguf", ["llama_cpp"]

        # Directory containing custom script
        for script_name in ("predict.py", "infer.py", "synthesize.py"):
            if (p / script_name).exists():
                return "python_script", []

    return "unknown", []


def inspect_model(model_path_str: str, slot_id: str = "") -> Dict[str, Any]:
    cleaned = sanitize_path_str(model_path_str)
    if not cleaned:
        return {
            "ok": False,
            "modelExists": False,
            "modelPath": "",
            "modelKind": "none",
            "requiredPackages": [],
            "installedPackages": {},
            "missingPackages": [],
            "sizeBytes": 0,
            "error": "No modelPath provided.",
        }

    p = Path(cleaned)
    if not p.is_absolute():
        p = Path.cwd() / p

    if not p.exists():
        return {
            "ok": False,
            "modelExists": False,
            "modelPath": str(p),
            "modelKind": "missing",
            "requiredPackages": [],
            "installedPackages": {},
            "missingPackages": [],
            "sizeBytes": 0,
            "error": f"Model path does not exist on disk: {p}",
        }

    resolved_p = resolve_hf_snapshot_dir(p)
    kind, req_mods = detect_model_kind(str(resolved_p), slot_id)
    installed = {m: has_pkg(m) for m in req_mods}
    missing = [PACKAGE_IMPORT_MAP.get(m, m) for m, ok in installed.items() if not ok]
    size_bytes = get_dir_size_bytes(resolved_p)

    notes = []
    if kind in ("raw_weight_file", "unknown_file", "unknown", "torch_checkpoint", "rvc_or_pth_voice"):
        notes.append(
            f"Detected '{kind}'. If this is a standalone checkpoint (.pt/.pth/.safetensors without config.json), "
            "either place a full HuggingFace/GGUF/CT2/Piper/XTTS folder or add a custom infer.py/predict.py script."
        )

    ok = len(missing) == 0 and kind not in ("unknown", "unknown_file")
    if missing:
        err_msg = (
            f"Model '{p.name}' ({kind}) found on disk ({round(size_bytes / (1024*1024), 1)} MB), "
            f"but required Python libraries are not installed: {', '.join(missing)}. "
            f"Run: pip install {' '.join(missing)}"
        )
    elif not ok:
        err_msg = " ".join(notes) or f"Unsupported model layout at {p}"
    else:
        err_msg = None

    return {
        "ok": ok,
        "modelExists": True,
        "modelPath": str(p),
        "modelKind": kind,
        "requiredPackages": [PACKAGE_IMPORT_MAP.get(m, m) for m in req_mods],
        "installedPackages": installed,
        "missingPackages": missing,
        "sizeBytes": size_bytes,
        "message": f"{kind} ready ({round(size_bytes / (1024*1024), 1)} MB)" if ok else (err_msg or ""),
        "error": err_msg,
    }


def resolve_gguf_file(p: Path) -> Path:
    if p.is_file():
        return p
    ggufs = sorted(p.glob("*.gguf"))
    if not ggufs:
        raise FileNotFoundError(f"No .gguf file found inside {p}")
    return ggufs[0]


def convert_to_wav_if_needed(audio_path: str, work_dir: str) -> str:
    """Convert non-WAV audio via ffmpeg if available; otherwise return original path."""
    lower = audio_path.lower()
    if lower.endswith(".wav"):
        return audio_path
    ffmpeg_bin = shutil.which("ffmpeg")
    if ffmpeg_bin:
        out_wav = os.path.join(work_dir, "converted_input.wav")
        proc = subprocess.run(
            [ffmpeg_bin, "-y", "-i", audio_path, "-ar", "16000", "-ac", "1", out_wav],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        if proc.returncode == 0 and os.path.exists(out_wav):
            return out_wav
    return audio_path


def run_llm(model_path: Path, kind: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    system_prompt = payload.get("systemPrompt") or "You are an expert Egyptian Arabic assistant."
    user_prompt = payload.get("userPrompt") or payload.get("text") or ""
    expect_json = bool(payload.get("expectJson"))
    temperature = float(payload.get("temperature", 0.35))

    if kind == "gguf":
        if not has_pkg("llama_cpp"):
            raise RuntimeError(
                "Missing 'llama-cpp-python'. Install it on your machine via: pip install llama-cpp-python"
            )
        from llama_cpp import Llama

        gguf_path = resolve_gguf_file(model_path)
        n_ctx = int(os.environ.get("LLAMA_N_CTX", "4096"))
        n_gpu_layers = int(os.environ.get("LLAMA_GPU_LAYERS", "-1"))

        def _load_llama() -> Any:
            try:
                return Llama(model_path=str(gguf_path), n_ctx=n_ctx, n_gpu_layers=n_gpu_layers, verbose=False)
            except Exception:
                return Llama(model_path=str(gguf_path), n_ctx=n_ctx, n_gpu_layers=0, verbose=False)

        llm = get_or_load_single_model(f"gguf:{gguf_path}", _load_llama)

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]
        response_kwargs: Dict[str, Any] = {
            "messages": messages,
            "temperature": temperature,
            "max_tokens": 1536,
        }
        if expect_json:
            response_kwargs["response_format"] = {"type": "json_object"}

        try:
            out = llm.create_chat_completion(**response_kwargs)
        except Exception:
            response_kwargs.pop("response_format", None)
            out = llm.create_chat_completion(**response_kwargs)

        raw = out["choices"][0]["message"]["content"] or ""
        cleaned = strip_think_blocks(raw)
        if expect_json:
            return extract_json_from_text(cleaned)
        return {"text": cleaned}

    if kind == "hf_llm":
        if not has_pkg("transformers") or not has_pkg("torch"):
            raise RuntimeError(
                "Missing 'transformers' or 'torch'. Install via: pip install transformers torch accelerate"
            )
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer

        def _load_hf_llm() -> Tuple[Any, Any]:
            tok = AutoTokenizer.from_pretrained(str(model_path), trust_remote_code=True)
            dtype = torch.float16 if torch.cuda.is_available() else torch.float32
            mdl = AutoModelForCausalLM.from_pretrained(
                str(model_path),
                torch_dtype=dtype,
                device_map="auto" if torch.cuda.is_available() else None,
                trust_remote_code=True,
            )
            return tok, mdl

        tokenizer, model = get_or_load_single_model(f"hf_llm:{model_path}", _load_hf_llm)

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]
        if hasattr(tokenizer, "apply_chat_template"):
            prompt_str = tokenizer.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True
            )
        else:
            prompt_str = f"System:\n{system_prompt}\n\nUser:\n{user_prompt}\n\nAssistant:\n"

        inputs = tokenizer(prompt_str, return_tensors="pt")
        if torch.cuda.is_available():
            inputs = {k: v.to(model.device) for k, v in inputs.items()}

        with torch.no_grad():
            output_ids = model.generate(
                **inputs,
                max_new_tokens=1024,
                do_sample=temperature > 0.05,
                temperature=max(temperature, 0.01),
            )
        generated_ids = output_ids[0][inputs["input_ids"].shape[1] :]
        cleaned = strip_think_blocks(tokenizer.decode(generated_ids, skip_special_tokens=True))
        if expect_json:
            return extract_json_from_text(cleaned)
        return {"text": cleaned}

    raise RuntimeError(f"Model kind '{kind}' cannot be run as a text LLM.")


def run_asr(model_path: Path, kind: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    audio_file = payload.get("audioFilePath")
    if not audio_file or not os.path.exists(audio_file):
        raise RuntimeError("No audioFilePath provided to ASR local engine.")

    lang_pref = payload.get("language", "ar")
    lang_code = "ar" if lang_pref == "ar" or payload.get("mode") in ("egyptian", "clean_standard") else None

    with tempfile.TemporaryDirectory() as tmpdir:
        decoded_audio = convert_to_wav_if_needed(audio_file, tmpdir)

        if kind == "ct2_whisper":
            if not has_pkg("faster_whisper"):
                raise RuntimeError(
                    "Missing 'faster-whisper'. Install on your machine via: pip install faster-whisper"
                )
            from faster_whisper import WhisperModel

            try:
                import torch
                device = "cuda" if torch.cuda.is_available() else "cpu"
            except Exception:
                device = "cpu"
            compute_type = "float16" if device == "cuda" else "int8"

            model = get_or_load_single_model(
                f"ct2_whisper:{model_path}",
                lambda: WhisperModel(str(model_path), device=device, compute_type=compute_type),
            )
            segments, _info = model.transcribe(
                decoded_audio,
                language=lang_code,
                vad_filter=True,
                beam_size=5,
            )
            transcript = " ".join(seg.text.strip() for seg in segments if seg.text).strip()
            return {"text": transcript}

        if kind == "whisper_pt":
            if not has_pkg("whisper"):
                raise RuntimeError(
                    "Missing 'openai-whisper'. Install via: pip install openai-whisper"
                )
            import whisper

            model = get_or_load_single_model(
                f"whisper_pt:{model_path}",
                lambda: whisper.load_model(str(model_path)),
            )
            res = model.transcribe(decoded_audio, language=lang_code)
            return {"text": (res.get("text") or "").strip()}

        if kind == "hf_asr":
            if not has_pkg("transformers") or not has_pkg("torch"):
                raise RuntimeError(
                    "Missing 'transformers' or 'torch'. Install via: pip install transformers torch soundfile librosa"
                )
            import torch
            from transformers import pipeline

            device = 0 if torch.cuda.is_available() else -1
            asr_pipe = get_or_load_single_model(
                f"hf_asr:{model_path}",
                lambda: pipeline(
                    "automatic-speech-recognition",
                    model=str(model_path),
                    device=device,
                    trust_remote_code=True,
                ),
            )
            audio_input: Any = decoded_audio
            if has_pkg("soundfile"):
                try:
                    import soundfile as sf
                    import numpy as np

                    samples, sr = sf.read(decoded_audio, dtype="float32")
                    if samples.ndim > 1:
                        samples = np.mean(samples, axis=1)
                    if sr != 16000 and has_pkg("librosa"):
                        import librosa
                        samples = librosa.resample(samples, orig_sr=sr, target_sr=16000)
                        sr = 16000
                    audio_input = {"array": samples, "sampling_rate": sr}
                except Exception:
                    audio_input = decoded_audio

            gen_kwargs = {"language": "arabic"} if lang_code == "ar" else {}
            try:
                res = asr_pipe(audio_input, chunk_length_s=30, generate_kwargs=gen_kwargs)
            except Exception:
                try:
                    res = asr_pipe(audio_input, generate_kwargs=gen_kwargs)
                except Exception:
                    res = asr_pipe(audio_input)

            if isinstance(res, str):
                text_out = res.strip()
            elif isinstance(res, list):
                text_out = " ".join(
                    (item.get("text") if isinstance(item, dict) else str(item or "")).strip()
                    for item in res
                ).strip()
            elif isinstance(res, dict):
                text_out = (res.get("text") or "").strip()
            else:
                text_out = str(res or "").strip()
            return {"text": text_out}

        if kind == "gguf":
            model_dir = model_path.parent if model_path.is_file() else model_path
            for script_name in ("transcribe.py", "infer.py", "predict.py"):
                custom_script = model_dir / script_name
                if custom_script.exists():
                    proc = subprocess.run(
                        [sys.executable, str(custom_script)],
                        input=json.dumps({**payload, "audioFilePath": decoded_audio}, ensure_ascii=False),
                        text=True,
                        capture_output=True,
                        timeout=180,
                    )
                    if proc.returncode == 0 and proc.stdout.strip():
                        out_raw = proc.stdout.strip()
                        try:
                            return json.loads(out_raw)
                        except Exception:
                            return {"text": out_raw}
                    raise RuntimeError(proc.stderr.strip() or f"{script_name} failed for {model_path.name}")
            whisper_cli = shutil.which("whisper-cli") or shutil.which("whisper-cpp")
            if whisper_cli:
                gguf_file = resolve_gguf_file(model_path)
                cmd = [whisper_cli, "-m", str(gguf_file), "-f", decoded_audio, "--no-timestamps"]
                if lang_code:
                    cmd.extend(["-l", lang_code])
                proc = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
                if proc.returncode == 0 and proc.stdout.strip():
                    return {"text": proc.stdout.strip()}
            raise RuntimeError(
                f"ASR GGUF '{model_path.name}' needs a whisper.cpp / transcribe.py decoder. "
                "For direct automatic Egyptian Speech-to-Diacritized-Text, select NAMAA-Space/Cohere-Speech-Tashkeel-2B or faster-whisper-large-v3-turbo in asr_diacritics."
            )

    raise RuntimeError(f"Unsupported ASR model kind '{kind}'. Expected Cohere-Speech-Tashkeel HF folder, CTranslate2 Whisper folder, or Whisper .pt.")


def array_to_wav_base64(audio_array: Any, sampling_rate: int) -> str:
    import numpy as np

    arr = np.asarray(audio_array, dtype=np.float32).squeeze()
    max_val = float(np.max(np.abs(arr))) if arr.size > 0 else 1.0
    if max_val > 1.0:
        arr = arr / max_val
    pcm16 = (np.clip(arr, -1.0, 1.0) * 32767.0).astype(np.int16)

    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(int(sampling_rate))
        wf.writeframes(pcm16.tobytes())
    return base64.b64encode(buf.getvalue()).decode("ascii")


_DIACRITIC_RE = re.compile(r"[\u064B-\u065F\u0670\u0640]")


def _smart_convert_qaf_word(raw_word: str) -> str:
    if not raw_word or "ق" not in raw_word:
        return raw_word
    punct_set = set("،,.!?؟:؛\"'()[]{}«»")
    lead = ""
    trail = ""
    w = raw_word
    while w and w[0] in punct_set:
        lead += w[0]
        w = w[1:]
    while w and w[-1] in punct_set:
        trail = w[-1] + trail
        w = w[:-1]
    if "ق" not in w:
        return raw_word

    w = re.sub(r"^(و|ف|ب)?(ي|ت|ن)َقُ?و?ل(وا|ون|ه|ها|ك|ي|هم)?", lambda m: f"{m.group(1) or ''}{m.group(2)}ِئُوْ{'ل' + (m.group(3) or '')}", w)
    w = re.sub(r"دَقِيق(ة|ه)?", lambda m: "دِئِيئ" + ("َه" if m.group(1) else ""), w)
    w = re.sub(r"حَقِيق(ة|ه)?", lambda m: "حَئِيئ" + ("َه" if m.group(1) else ""), w)
    w = re.sub(r"بَقِي([تتن]?)", r"بَئِي\1", w)
    w = re.sub(r"لَقِي([تتن]?)", r"لِئِي\1", w)
    w = re.sub(r"مَعْ?قُول", "مَعْءُول", w)
    w = re.sub(r"مَخْ?لُوق(ة|ه)?", lambda m: "مَخْلُوءَه" if m.group(1) else "مَخْلُوء", w)
    if "ق" not in w:
        return lead + w + trail

    tokens: List[List[str]] = []
    for ch in w:
        if _DIACRITIC_RE.match(ch):
            if tokens:
                tokens[-1][1] += ch
        else:
            tokens.append([ch, ""])

    kasra, damma, sukoon, shadda = "\u0650", "\u064F", "\u0652", "\u0651"
    for i, tok in enumerate(tokens):
        if tok[0] != "ق":
            continue
        prev = tokens[i - 1] if i > 0 else None
        prev2 = tokens[i - 2] if i > 1 else None
        prev3 = tokens[i - 3] if i > 2 else None
        nxt = tokens[i + 1] if i < len(tokens) - 1 else None

        after_al = i == 2 and prev and prev[0] == "ل" and prev2 and prev2[0] in ("ا", "أ", "إ")
        after_pal = i == 3 and prev and prev[0] == "ل" and prev2 and prev2[0] in ("ا", "أ", "إ") and prev3 and prev3[0] in ("و", "ف", "ب", "ك", "ل")
        after_ll = i == 2 and prev and prev[0] == "ل" and prev2 and prev2[0] == "ل"
        if i == 0 or after_al or after_pal or after_ll:
            tok[0] = "أ"
        elif i == len(tokens) - 1:
            if shadda in tok[1] or (prev and prev[0] in ("ا", "و", "ي", "ى")) or (prev and sukoon in prev[1]) or (prev and damma in prev[1]):
                tok[0] = "ء"
            elif prev and kasra in prev[1]:
                tok[0] = "ئ"
            else:
                tok[0] = "أ"
        else:
            if (
                kasra in tok[1]
                or (prev and kasra in prev[1])
                or (prev and prev[0] in ("ي", "ى", "ئ"))
                or (nxt and nxt[0] in ("ي", "ى", "ئ"))
            ):
                tok[0] = "ئ"
            elif (prev and prev[0] == "ا") or (shadda in tok[1]) or (prev and prev[0] == "و") or (nxt and nxt[0] == "و") or (damma in tok[1]) or (prev and damma in prev[1]):
                tok[0] = "ء"
            else:
                tok[0] = "أ"

    return lead + "".join(b + m for b, m in tokens) + trail


def smart_convert_egyptian_qaf(text: str) -> str:
    if not text or "ق" not in text:
        return text
    out_lines = []
    for line in text.splitlines():
        st = line.strip()
        if not st or st.startswith("[") or (st.startswith("*") and st.endswith("*")):
            out_lines.append(line)
            continue
        out_lines.append(" ".join(_smart_convert_qaf_word(w) if "ق" in w else w for w in line.split(" ")))
    return "\n".join(out_lines)


def run_tts(model_path: Path, kind: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    text = (payload.get("text") or "").strip()
    if not text:
        raise RuntimeError("No text provided for TTS synthesis.")
    if payload.get("language", "ar") == "ar" and payload.get("egyptianQafToHamza", True) is not False:
        text = smart_convert_egyptian_qaf(text)

    if kind == "piper_onnx":
        if not has_pkg("piper"):
            raise RuntimeError("Missing 'piper-tts'. Install via: pip install piper-tts")
        from piper.voice import PiperVoice

        voice = get_or_load_single_model(
            f"piper_onnx:{model_path}",
            lambda: PiperVoice.load(str(model_path)),
        )
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wav_file:
            voice.synthesize(text, wav_file)
        b64 = base64.b64encode(buf.getvalue()).decode("ascii")
        return {
            "audioBase64": b64,
            "mimeType": "audio/wav",
            "textResult": text,
            "fallbackToBrowserSpeech": False,
        }

    if kind == "hf_tts":
        if not has_pkg("transformers") or not has_pkg("torch"):
            raise RuntimeError(
                "Missing 'transformers' / 'torch'. Install via: pip install transformers torch numpy"
            )
        from transformers import pipeline

        tts_pipe = get_or_load_single_model(
            f"hf_tts:{model_path}",
            lambda: pipeline("text-to-speech", model=str(model_path)),
        )
        out = tts_pipe(text)
        b64 = array_to_wav_base64(out["audio"], int(out["sampling_rate"]))
        return {
            "audioBase64": b64,
            "mimeType": "audio/wav",
            "textResult": text,
            "fallbackToBrowserSpeech": False,
        }

    if kind == "coqui_xtts":
        if not has_pkg("TTS"):
            raise RuntimeError("Missing 'TTS' (Coqui TTS). Install via: pip install TTS")
        from TTS.api import TTS

        tts = get_or_load_single_model(
            f"coqui_xtts:{model_path}",
            lambda: TTS(model_path=str(model_path), config_path=str(model_path / "config.json")),
        )
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tf:
            out_path = tf.name
        try:
            tts.tts_to_file(text=text, language=payload.get("language", "ar"), file_path=out_path)
            b64 = base64.b64encode(Path(out_path).read_bytes()).decode("ascii")
        finally:
            if os.path.exists(out_path):
                os.unlink(out_path)
        return {
            "audioBase64": b64,
            "mimeType": "audio/wav",
            "textResult": text,
            "fallbackToBrowserSpeech": False,
        }

    if kind == "omnivoice":
        if not has_pkg("omnivoice"):
            raise RuntimeError(
                "OmniVoice model detected, but 'omnivoice' runtime is not installed. Run: pip install omnivoice"
            )
        from omnivoice import OmniVoice  # type: ignore

        model_dir = model_path.parent if model_path.is_file() else model_path
        ov = get_or_load_single_model(f"omnivoice:{model_dir}", lambda: OmniVoice.from_pretrained(str(model_dir)))
        with tempfile.TemporaryDirectory() as tmpdir:
            out_wav = os.path.join(tmpdir, "omnivoice_tts.wav")
            audio_out = ov.generate(text=text)
            if hasattr(audio_out, "save"):
                audio_out.save(out_wav)
                b64 = base64.b64encode(Path(out_wav).read_bytes()).decode("ascii")
            else:
                b64 = array_to_wav_base64(audio_out, 24000)
        return {
            "audioBase64": b64,
            "mimeType": "audio/wav",
            "textResult": text,
            "fallbackToBrowserSpeech": False,
        }

    if kind == "gguf":
        model_dir = model_path.parent if model_path.is_file() else model_path
        for script_name in ("synthesize.py", "infer.py"):
            custom_script = model_dir / script_name
            if custom_script.exists():
                proc = subprocess.run(
                    [sys.executable, str(custom_script)],
                    input=json.dumps(payload, ensure_ascii=False),
                    text=True,
                    capture_output=True,
                    timeout=180,
                )
                if proc.returncode == 0 and proc.stdout.strip():
                    return json.loads(proc.stdout.strip())
                raise RuntimeError(proc.stderr.strip() or f"{script_name} failed for {model_path.name}")
        raise RuntimeError(
            f"TTS GGUF '{model_path.name}' requires an accompanying audio-codec decoder script (synthesize.py) or OmniVoice/Piper .onnx model in tts_reader."
        )

    raise RuntimeError(f"Unsupported TTS model kind '{kind}'. Expected OmniVoice, Piper .onnx, HF TTS folder, or Coqui TTS folder.")


def run_voice_clone(model_path: Path, kind: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    src_path = payload.get("sourceAudioFilePath")
    tgt_path = payload.get("targetAudioFilePath")
    lyrics = (payload.get("lyrics") or "").strip()
    language = payload.get("language", "ar")

    if not src_path or not os.path.exists(src_path):
        raise RuntimeError("No sourceAudioFilePath provided for Voice Clone.")

    if kind == "coqui_xtts":
        if not has_pkg("TTS"):
            raise RuntimeError("Missing 'TTS' (Coqui XTTS-v2). Install via: pip install TTS")
        from TTS.api import TTS

        tts = get_or_load_single_model(
            f"coqui_xtts:{model_path}",
            lambda: TTS(model_path=str(model_path), config_path=str(model_path / "config.json")),
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            src_wav = convert_to_wav_if_needed(src_path, tmpdir)
            out_wav = os.path.join(tmpdir, "cloned_output.wav")
            if lyrics:
                tts.tts_to_file(
                    text=lyrics,
                    speaker_wav=src_wav,
                    language="ar" if language == "ar" else "en",
                    file_path=out_wav,
                )
            elif tgt_path and os.path.exists(tgt_path):
                tgt_wav = convert_to_wav_if_needed(tgt_path, tmpdir)
                if hasattr(tts, "tts_with_vc_to_file"):
                    tts.tts_with_vc_to_file(
                        text="تجربة التحويل الصوتي",
                        speaker_wav=src_wav,
                        file_path=out_wav,
                    )
                else:
                    tts.tts_to_file(
                        text="أهلاً بِكُم فِي اسْتُودْيُو حَافِظ بِالْعَامِّيَّة",
                        speaker_wav=src_wav,
                        language="ar" if language == "ar" else "en",
                        file_path=out_wav,
                    )
            else:
                raise RuntimeError("Please provide target lyrics or target melody audio.")

            b64 = base64.b64encode(Path(out_wav).read_bytes()).decode("ascii")
            return {
                "audioBase64": b64,
                "mimeType": "audio/wav",
                "text": lyrics or "تم تنفيذ استنساخ الصوت محلياً عبر Coqui XTTS-v2 بنجاح.",
            }

    if kind == "omnivoice":
        if not has_pkg("omnivoice"):
            raise RuntimeError(
                "OmniVoice model detected on disk, but the 'omnivoice' Python runtime is not installed. "
                "Install it via: pip install omnivoice (or place an infer.py wrapper inside models/voice-clone/)."
            )
        from omnivoice import OmniVoice  # type: ignore

        model_dir = model_path.parent if model_path.is_file() else model_path
        ov = get_or_load_single_model(f"omnivoice:{model_dir}", lambda: OmniVoice.from_pretrained(str(model_dir)))
        target_text = lyrics or "أهلاً بِكُم فِي اسْتُودْيُو حَافِظ بِالْعَامِّيَّة"
        with tempfile.TemporaryDirectory() as tmpdir:
            src_wav = convert_to_wav_if_needed(src_path, tmpdir)
            out_wav = os.path.join(tmpdir, "omnivoice_out.wav")
            audio_out = ov.generate(text=target_text, ref_audio=src_wav)
            if hasattr(audio_out, "save"):
                audio_out.save(out_wav)
                b64 = base64.b64encode(Path(out_wav).read_bytes()).decode("ascii")
            else:
                b64 = array_to_wav_base64(audio_out, 24000)
            return {
                "audioBase64": b64,
                "mimeType": "audio/wav",
                "text": lyrics or "تم تنفيذ استنساخ الصوت محلياً عبر OmniVoice بنجاح.",
            }

    if kind == "rvc_or_pth_voice":
        raise RuntimeError(
            "Standalone RVC .pth file detected without an inference pipeline script. "
            "To run RVC .pth models, either select a Coqui XTTS-v2 folder or place your RVC infer.py inside models/voice-clone/."
        )

    raise RuntimeError(f"Unsupported voice clone model kind '{kind}'.")


def preload_model_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Warm-load a single model back into RAM/VRAM without running inference."""
    model_path_str = sanitize_path_str(payload.get("modelPath") or "")
    slot_id = payload.get("slotId", "")
    if not model_path_str:
        raise RuntimeError("modelPath is required for preload.")

    model_path = Path(model_path_str)
    if not model_path.is_absolute():
        model_path = Path.cwd() / model_path
    if not model_path.exists():
        raise FileNotFoundError(f"Selected local model does not exist on disk: {model_path}")
    model_path = resolve_hf_snapshot_dir(model_path)

    apply_vram_limit_percent(payload.get("gpuMemoryLimitPercent"))
    kind, _req = detect_model_kind(str(model_path), slot_id)

    if kind == "gguf":
        if not has_pkg("llama_cpp"):
            raise RuntimeError("Missing 'llama-cpp-python'")
        from llama_cpp import Llama
        gguf_path = resolve_gguf_file(model_path)
        n_ctx = int(os.environ.get("LLAMA_N_CTX", "4096"))
        n_gpu_layers = int(os.environ.get("LLAMA_GPU_LAYERS", "-1"))
        def _load() -> Any:
            try:
                return Llama(model_path=str(gguf_path), n_ctx=n_ctx, n_gpu_layers=n_gpu_layers, verbose=False)
            except Exception:
                return Llama(model_path=str(gguf_path), n_ctx=n_ctx, n_gpu_layers=0, verbose=False)
        get_or_load_single_model(f"gguf:{gguf_path}", _load)
        return {"preloaded": f"gguf:{gguf_path}"}

    if kind == "hf_llm":
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer
        def _load() -> Tuple[Any, Any]:
            tok = AutoTokenizer.from_pretrained(str(model_path), trust_remote_code=True)
            dtype = torch.float16 if torch.cuda.is_available() else torch.float32
            mdl = AutoModelForCausalLM.from_pretrained(
                str(model_path),
                torch_dtype=dtype,
                device_map="auto" if torch.cuda.is_available() else None,
                trust_remote_code=True,
            )
            return tok, mdl
        get_or_load_single_model(f"hf_llm:{model_path}", _load)
        return {"preloaded": f"hf_llm:{model_path}"}

    if kind == "ct2_whisper":
        from faster_whisper import WhisperModel
        device = "cpu"
        try:
            import torch
            device = "cuda" if torch.cuda.is_available() else "cpu"
        except Exception:
            pass
        compute_type = "float16" if device == "cuda" else "int8"
        get_or_load_single_model(
            f"ct2_whisper:{model_path}",
            lambda: WhisperModel(str(model_path), device=device, compute_type=compute_type),
        )
        return {"preloaded": f"ct2_whisper:{model_path}"}

    if kind == "omnivoice" and has_pkg("omnivoice"):
        from omnivoice import OmniVoice  # type: ignore
        model_dir = model_path.parent if model_path.is_file() else model_path
        get_or_load_single_model(f"omnivoice:{model_dir}", lambda: OmniVoice.from_pretrained(str(model_dir)))
        return {"preloaded": f"omnivoice:{model_dir}"}

    return {"preloaded": None}


def execute_inference_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    apply_vram_limit_percent(payload.get("gpuMemoryLimitPercent"))
    slot_id = payload.get("slotId", "")
    model_path_str = sanitize_path_str(payload.get("modelPath") or "")
    if not model_path_str:
        raise RuntimeError("modelPath is required for local_disk execution.")

    model_path = Path(model_path_str)
    if not model_path.is_absolute():
        model_path = Path.cwd() / model_path

    if not model_path.exists():
        raise FileNotFoundError(f"Selected local model does not exist on disk: {model_path}")

    model_path = resolve_hf_snapshot_dir(model_path)
    kind, _req = detect_model_kind(str(model_path), slot_id)

    if slot_id == "asr_diacritics":
        return run_asr(model_path, kind, payload)
    if slot_id == "tts_reader":
        return run_tts(model_path, kind, payload)
    if slot_id == "voice_clone":
        return run_voice_clone(model_path, kind, payload)
    return run_llm(model_path, kind, payload)


def run_worker_loop() -> int:
    """
    Persistent Single-Model JSON-Lines Worker:
    Holds AT MOST ONE model in GPU/RAM and flushes VRAM immediately upon:
      - switching to a different modelPath / slot
      - receiving {"action": "unload"} or {"action": "refresh"}
      - EOF / process termination
    """
    real_stdout = sys.stdout
    sys.stdout = sys.stderr
    try:
        for raw_line in sys.stdin:
            line = raw_line.strip()
            if not line:
                continue
            req_id = None
            try:
                req = json.loads(line)
                req_id = req.get("id")
                action = req.get("action", "infer")

                if action == "unload":
                    prev = unload_active_model()
                    resp = {"id": req_id, "ok": True, "result": {"unloaded": prev}}
                elif action == "refresh":
                    free_gpu_memory()
                    resp = {
                        "id": req_id,
                        "ok": True,
                        "result": {"refreshed": True, "activeKey": ACTIVE_MODEL_CACHE.get("key")},
                    }
                elif action == "preload":
                    payload = req.get("payload") if "payload" in req else req
                    res = preload_model_payload(payload)
                    resp = {"id": req_id, "ok": True, "result": res}
                elif action == "status":
                    resp = {
                        "id": req_id,
                        "ok": True,
                        "result": {"activeKey": ACTIVE_MODEL_CACHE.get("key")},
                    }
                else:
                    payload = req.get("payload") if "payload" in req else req
                    result = execute_inference_payload(payload)
                    resp = {"id": req_id, "ok": True, "result": result}
            except Exception as exc:
                resp = {"id": req_id, "ok": False, "error": str(exc)}

            real_stdout.write(json.dumps(resp, ensure_ascii=False) + "\n")
            real_stdout.flush()
    finally:
        sys.stdout = real_stdout
        unload_active_model()
    return 0


def main() -> int:
    # Mode 1: CLI Inspection
    if len(sys.argv) >= 2 and sys.argv[1] == "--inspect":
        model_path_arg = sys.argv[2] if len(sys.argv) > 2 else ""
        slot_arg = sys.argv[3] if len(sys.argv) > 3 else ""
        res = inspect_model(model_path_arg, slot_arg)
        sys.stdout.write(json.dumps(res, ensure_ascii=False))
        return 0 if res.get("ok") else 1

    # Mode 2: Managed Single-Model Worker Daemon (--worker)
    if len(sys.argv) >= 2 and sys.argv[1] == "--worker":
        return run_worker_loop()

    # Mode 3: One-shot Stdin JSON Inference
    try:
        raw_input = sys.stdin.read()
        payload = json.loads(raw_input) if raw_input.strip() else {}
    except Exception as exc:
        sys.stderr.write(f"Invalid stdin JSON payload: {exc}\n")
        return 2

    try:
        result = execute_inference_payload(payload)
        sys.stdout.write(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as exc:
        sys.stderr.write(f"{exc}\n")
        return 1
    finally:
        unload_active_model()


if __name__ == "__main__":
    raise SystemExit(main())
