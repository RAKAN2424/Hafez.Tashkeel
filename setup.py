#!/usr/bin/env python3
"""
Hafiz Bel'Amya (حَافِظ بِالْعَامِّيَّة) - Backend Python Environment Setup
Install all local AI backends:
  pip install -e .
Or selective groups:
  pip install -e .[gguf,asr,tts]
  pip install -e .[all]
"""

from pathlib import Path
from setuptools import find_packages, setup

ROOT = Path(__file__).parent
README = (ROOT / "models" / "README.md").read_text(encoding="utf-8") if (ROOT / "models" / "README.md").exists() else ""

CORE_REQUIREMENTS = [
    "llama-cpp-python>=0.3.2",
    "torch>=2.3.0",
    "torchaudio>=2.3.0",
    "transformers>=4.46.0",
    "accelerate>=0.34.0",
    "safetensors>=0.4.5",
    "sentencepiece>=0.2.0",
    "protobuf>=4.25.0",
    "huggingface_hub>=0.25.0",
    "einops>=0.8.0",
    "peft>=0.12.0",
    "faster-whisper>=1.0.3",
    "ctranslate2>=4.4.0",
    "piper-tts>=1.2.0",
    "onnxruntime>=1.19.0",
    "soundfile>=0.12.1",
    "librosa>=0.10.2",
    "scipy>=1.13.0",
    "numpy>=1.26.0,<2.3.0",
    "requests>=2.32.0",
]

EXTRAS = {
    "gguf": ["llama-cpp-python>=0.3.2"],
    "hf": [
        "torch>=2.3.0",
        "torchaudio>=2.3.0",
        "transformers>=4.46.0",
        "accelerate>=0.34.0",
        "safetensors>=0.4.5",
        "sentencepiece>=0.2.0",
        "protobuf>=4.25.0",
        "huggingface_hub>=0.25.0",
        "einops>=0.8.0",
        "peft>=0.12.0",
    ],
    "asr": ["faster-whisper>=1.0.3", "ctranslate2>=4.4.0", "soundfile>=0.12.1", "librosa>=0.10.2"],
    "whisper_pt": ["openai-whisper>=20231117"],
    "tts": ["piper-tts>=1.2.0", "onnxruntime>=1.19.0", "soundfile>=0.12.1"],
    "voice_clone": ["TTS>=0.22.0; python_version < '3.12'"],
    "all": [
        "openai-whisper>=20231117",
        "TTS>=0.22.0; python_version < '3.12'",
    ],
}

setup(
    name="hafiz-belamya-backends",
    version="1.4.0",
    description="Local Disk AI Inference Backends for Hafiz Bel'Amya (GGUF, HuggingFace, Whisper, Piper, OmniVoice, XTTS)",
    long_description=README,
    long_description_content_type="text/markdown",
    author="Abdelrahman Amr",
    python_requires=">=3.10",
    packages=find_packages(exclude=("node_modules", "dist", "src", "public")),
    install_requires=CORE_REQUIREMENTS,
    extras_require=EXTRAS,
    entry_points={
        "console_scripts": [
            "hafiz-engine=models.local_engine:main",
        ]
    },
    include_package_data=True,
)
