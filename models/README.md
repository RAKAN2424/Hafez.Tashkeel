# خريطة ومجلد الموديلات — حَافِظ بِالْعَامِّيَّة (Models & Local LLM Architecture)

تم تصميم المجلد والباك إند لتوصيل موديلاتك المحلية بمرونة كاملة عبر **Ollama** أو **LM Studio / vLLM / llama.cpp (OpenAI-Compatible)** أو **سيرفر HTTP مخصص (FastAPI/Flask)** أو **سكريبت Python محلي (`predict.py` / `infer.py`)**، مع وجود **الوضع المحلي الصارم (`strictLocal`)** لمنع أي اعتماد على السحابة إذا أردت تشغيل البرنامج 100% على جهازك.

## خريطة الموديلات والأدوار (8 منافذ حقيقية مستقلة)

| # | المعرف | المجلد | الدور في المشروع | يدعم Local LLM؟ | الاتصال بالإنترنت | نقطة الـ API |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `asr_diacritics` | `models/asr-diacritics/` | سمع الكلام العامي وكتابته بالتشكيل (أو عبر Whisper `/v1/audio/transcriptions`) | صوتي (Audio / Python / Whisper) | غير مطلوب | `POST /api/models/asr` |
| 2 | `tts_reader` | `models/tts-reader/` | قراءة الكلام بالتشكيل المكتوب (أو عبر `/v1/audio/speech` مثل Kokoro/XTTS/Piper) | صوتي (Audio / Python / HTTP WAV) | غير مطلوب | `POST /api/models/tts` |
| 3 | `smart_studio` | `models/smart-studio/` | التشكيل الذكي/الصوتي/المتصل، التصحيح، التأليف، التنسيق، التحليل | نعم (Ollama / OpenAI / HTTP / Python) | اختياري (متاح) | `POST /api/models/diacritics` & `/api/models/lyrics` & `/api/models/audio-analyze` |
| 4 | `rhyme_rewrite` | `models/rhyme-rewrite/` | توليد القوافي وإعادة صياغة الجمل بنفس الوزن والقافية | نعم (Ollama / OpenAI / HTTP / Python) | غير مطلوب | `POST /api/models/rhymes` & `/api/models/rewrite` |
| 5 | `prompt_generator` | `models/prompt-generator/` | البحث عن أحدث موديلات Suno وبناء البرومبت الموسيقي | نعم (Ollama / OpenAI / HTTP / Python) | مفعّل (قابل للتبديل) | `POST /api/models/prompt` |
| 6 | `diacritics_search` | `models/diacritics-search/` | جلب جميع أنواع التشكيل للكلمة من المعاجم والويب والصرف | نعم (Ollama / OpenAI / HTTP / Python) | مفعّل | `POST /api/models/diacritics-search` |
| 7 | `web_lyrics_agent` | `models/web-agent/` | جلب كلمات الأغاني والبحث في أي موقع ويب للموديل الذكي | نعم (Ollama / OpenAI / HTTP / Python) | مفعّل | `POST /api/models/web-agent` |
| 8 | `voice_clone` | `models/voice-clone/` | استنساخ خامة الصوت وتركيبها على اللحن (RVC / XTTS-v2 / Seed-VC) | صوتي (Python / FastAPI WAV) | غير مطلوب | `POST /api/models/voice-clone` |

---

## طرق الربط المدعومة مباشرة من الباك إند والواجهة
1. **Ollama المحلي:** اختر `ollama` وضع الرابط `http://127.0.0.1:11434` واسم الموديل مثل `qwen2.5:14b` أو `aya-expanse:8b`.
2. **LM Studio / llama.cpp / vLLM:** اختر `openai_compatible` وضع الرابط مثل `http://127.0.0.1:1234/v1` واسم الموديل.
3. **سيرفرات الصوت المحلية (Whisper / Kokoro / XTTS):** اختر `openai_audio` أو `http_custom` — الباك إند يدعم رفع ملفات الصوت `multipart/form-data` واستقبال ملفات `audio/wav` الثنائية مباشرة.
4. **سكريبت بايثون محلي:** ضع وزن الموديل داخل المجلد المناسب، وسمِّ ملف التشغيل حسب `scriptPath` (`predict.py` / `infer.py` / `synthesize.py`).
