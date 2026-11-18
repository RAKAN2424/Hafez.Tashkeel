import express from 'express';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import path from 'path';
import ytdl from '@distube/ytdl-core';
import 'dotenv/config';

import fs from 'fs';
import {
  applyLocalLlmPreset,
  autoAssignModels,
  autoUpdateBackendsOnline,
  checkBackendUpdatesOnline,
  discoverLocalLlms,
  dispatchModelTask,
  extractJsonFromText,
  getAllModelsStatus,
  getBackendsManifest,
  getCachedStartupUpdateReport,
  getLastPartitionScanSummary,
  getLocalModelsRoot,
  getMachineEnvironment,
  getSearchRoots,
  getVramStatus,
  installPythonBackends,
  loadModelRegistry,
  refreshGpuVram,
  resolveModelSlotStatus,
  runModelPipeline,
  setLocalModelsRoot,
  setSearchRoots,
  testModelSlotConnection,
  unloadAllModels,
  updateModelSlotConfig,
  updateVramPolicy,
  type ModelSlotId,
  type ProviderType,
} from './models/runner.ts';
import {
  runDiacriticsSearchScript,
  verifyTextWordsViaWebLexicon,
} from './models/scripts/diacritics_search.ts';
import { runSunoResearchScript } from './models/scripts/suno_research_agent.ts';
import { fetchWebsiteContent, searchWebForLyrics } from './models/scripts/web_scraper_agent.ts';
import {
  PHONETIC_ENCODING_RULES,
  ensureConnectedDiacriticsRules,
  ensureEgyptianPhoneticRules,
  ensureSmartLightDiacriticsRules,
} from './src/utils/arabicDiacritics.ts';

let aiClient: GoogleGenAI | null = null;
const getAiClient = () => {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || !apiKey.trim()) {
      throw new Error(
        'لم يتم ضبط GEMINI_API_KEY، كما أن هذا المنفذ غير مربوط بموديل محلي (Ollama / LM Studio / Python). اربطه من تبويب خريطة الموديلات.'
      );
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
};

function pcmToWavBase64(base64Pcm: string, sampleRate = 24000): string {
  const pcmBuffer = Buffer.from(base64Pcm, 'base64');
  const wavHeader = Buffer.alloc(44);

  wavHeader.write('RIFF', 0);
  wavHeader.writeUInt32LE(36 + pcmBuffer.length, 4);
  wavHeader.write('WAVE', 8);
  wavHeader.write('fmt ', 12);
  wavHeader.writeUInt32LE(16, 16);
  wavHeader.writeUInt16LE(1, 20);
  wavHeader.writeUInt16LE(1, 22);
  wavHeader.writeUInt32LE(sampleRate, 24);
  wavHeader.writeUInt32LE(sampleRate * 2, 28);
  wavHeader.writeUInt16LE(2, 32);
  wavHeader.writeUInt16LE(16, 34);
  wavHeader.write('data', 36);
  wavHeader.writeUInt32LE(pcmBuffer.length, 40);

  const fullWavBuffer = Buffer.concat([wavHeader, pcmBuffer]);
  return `data:audio/wav;base64,${fullWavBuffer.toString('base64')}`;
}

const modelCooldowns: Record<string, number> = {};

function getCandidateModels(): string[] {
  const allModels = ['gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-flash-latest'];
  const now = Date.now();
  const available = allModels.filter((m) => (modelCooldowns[m] || 0) <= now);
  return available.length > 0 ? available : allModels;
}

async function generateWithFallback(ai: GoogleGenAI, contents: any, config: any) {
  const models = getCandidateModels();
  let lastError: any = null;

  for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents,
          config,
        });
        if (response && response.text) {
          return response.text;
        }
      } catch (err: any) {
        lastError = err;
        const errMsg = err?.message || String(err);
        const is503 = errMsg.includes('503') || err?.status === 'UNAVAILABLE' || err?.code === 503;
        const is429 = errMsg.includes('429') || err?.status === 'RESOURCE_EXHAUSTED' || err?.code === 429;

        if (is429) {
          const isDaily = errMsg.includes('GenerateRequestsPerDay') || errMsg.includes('limit: 20');
          modelCooldowns[model] = Date.now() + (isDaily ? 60 * 60 * 1000 : 30 * 1000);
          break;
        }

        if (is503) {
          if (attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
            continue;
          }
          modelCooldowns[model] = Date.now() + 20 * 1000;
          break;
        }

        break;
      }
    }
  }

  const errStr = lastError?.message || String(lastError);
  if (errStr.includes('429') || lastError?.status === 'RESOURCE_EXHAUSTED') {
    throw new Error('تم بلوغ حد الاستهلاك المؤقت. يرجى الانتظار بضع لحظات أو تفعيل موديلك المحلي (Ollama / LM Studio).');
  }
  if (errStr.includes('503') || lastError?.status === 'UNAVAILABLE') {
    throw new Error('خوادم الذكاء الاصطناعي تشهد ضغطاً مؤقتاً في هذه اللحظة. يرجى إعادة المحاولة أو استخدام موديل محلي.');
  }

  throw lastError || new Error('تعذر توليد المحتوى، يرجى المحاولة بعد قليل.');
}

async function generateTTSWithFallback(ai: GoogleGenAI, promptText: string, voiceName?: string): Promise<string> {
  const ttsModels = ['gemini-3.8-flash-lite-tts', 'gemini-3.1-flash-tts-preview', 'gemini-3.8-flash-tts'];
  let lastError: any = null;

  for (const model of ttsModels) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: [{ parts: [{ text: promptText }] }],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voiceName || 'Kore' },
            },
          },
        },
      });

      const data = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (data) {
        return pcmToWavBase64(data);
      }
    } catch (err: any) {
      lastError = err;
    }
  }

  throw lastError || new Error('تعذر توليد الصوت بالذكاء الاصطناعي.');
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));
  app.use(express.text({ type: 'text/plain', limit: '1mb' }));

  // ============================================================================
  // PLUGGABLE MODELS & LOCAL LLM MACHINE BACKEND API (/api/models/*)
  // ============================================================================

  // 1. Live Model Slots, Registry Status & Real Host Machine Capabilities
  app.get('/api/models/status', async (_req, res) => {
    try {
      const models = getAllModelsStatus();
      const machine = getMachineEnvironment();
      const vramStatus = await getVramStatus();
      res.json({
        models,
        machine,
        localModelsRoot: getLocalModelsRoot(),
        searchRoots: getSearchRoots(),
        partitionScan: getLastPartitionScanSummary(),
        vramStatus,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to read models registry' });
    }
  });

  // 1-vram-a. Get Live GPU / VRAM Occupancy & Policy
  app.get('/api/models/vram-status', async (_req, res) => {
    try {
      const vramStatus = await getVramStatus();
      res.json({ vramStatus });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to read VRAM status' });
    }
  });

  // 1-vram-b. Update Single-Model, Park/Restore, Multi-Model Refresh & GPU RAM Tuning Policy
  app.post('/api/models/vram-policy', async (req, res) => {
    try {
      const {
        singleModelOnly,
        restorePreviousModel,
        refreshAfterMultiModel,
        gpuMemoryLimitPercent,
        minFreeVramMb,
        idleUnloadSeconds,
        unloadOnExit,
      } = req.body || {};
      updateVramPolicy({
        ...(typeof singleModelOnly === 'boolean' ? { singleModelOnly } : {}),
        ...(typeof restorePreviousModel === 'boolean' ? { restorePreviousModel } : {}),
        ...(typeof refreshAfterMultiModel === 'boolean' ? { refreshAfterMultiModel } : {}),
        ...(gpuMemoryLimitPercent !== undefined
          ? { gpuMemoryLimitPercent: Number(gpuMemoryLimitPercent) }
          : {}),
        ...(minFreeVramMb !== undefined ? { minFreeVramMb: Number(minFreeVramMb) } : {}),
        ...(idleUnloadSeconds !== undefined ? { idleUnloadSeconds: Number(idleUnloadSeconds) } : {}),
        ...(typeof unloadOnExit === 'boolean' ? { unloadOnExit } : {}),
      });
      const vramStatus = await getVramStatus();
      res.json({ vramStatus });
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Failed to update VRAM policy' });
    }
  });

  // 1-vram-c. Immediately Unload All Models From GPU VRAM (Manual / Window Exit)
  app.post('/api/models/unload-all', async (req, res) => {
    try {
      let reason = 'manual';
      if (req.body && typeof req.body === 'object' && typeof req.body.reason === 'string') {
        reason = req.body.reason;
      } else if (typeof req.body === 'string' && req.body.trim()) {
        try {
          const parsed = JSON.parse(req.body);
          if (typeof parsed?.reason === 'string') reason = parsed.reason;
        } catch {
          // ignore
        }
      }
      const vramStatus = await unloadAllModels(reason);
      res.json({ ok: true, vramStatus });
    } catch (error: any) {
      res.status(500).json({ ok: false, error: error.message || 'Failed to unload GPU models' });
    }
  });

  // 1-vram-d. Refresh GPU VRAM Cache & Strip Excess Load
  app.post('/api/models/vram-refresh', async (req, res) => {
    try {
      const reason = typeof req.body?.reason === 'string' ? req.body.reason : 'manual_refresh';
      const clearAllLoaded =
        typeof req.body?.clearAllLoaded === 'boolean' ? req.body.clearAllLoaded : true;
      const vramStatus = await refreshGpuVram(reason, clearAllLoaded);
      res.json({ ok: true, vramStatus });
    } catch (error: any) {
      res.status(500).json({ ok: false, error: error.message || 'Failed to refresh GPU VRAM' });
    }
  });

  // 1a. Set & Rescan Custom Local Models Root Directory on Disk
  app.post('/api/models/local-root', (req, res) => {
    try {
      const { localModelsRoot = '' } = req.body;
      const result = setLocalModelsRoot(String(localModelsRoot ?? ''));
      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Invalid local models directory' });
    }
  });

  // 1a-2. Update & Rescan Fixed Model Search Roots
  app.post('/api/models/search-roots', (req, res) => {
    try {
      const { searchRoots = [] } = req.body;
      if (!Array.isArray(searchRoots)) {
        return res.status(400).json({ error: 'searchRoots array is required' });
      }
      const result = setSearchRoots(searchRoots.map((s: any) => String(s)));
      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Failed to update searchRoots' });
    }
  });

  // 1a-3. Auto-Search & Auto-Assign Best Local Models for Each Slot (Across All Partitions)
  app.post('/api/models/auto-assign', (req, res) => {
    try {
      const overwriteExisting = Boolean(req.body?.overwriteExisting);
      const fixMismatches = req.body?.fixMismatches !== false;
      const scanAllPartitions = req.body?.scanAllPartitions !== false;
      const result = autoAssignModels({ overwriteExisting, fixMismatches, scanAllPartitions });
      res.json({
        ...result,
        machine: getMachineEnvironment(),
        searchRoots: getSearchRoots(),
        partitionScan: getLastPartitionScanSummary(),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to auto-assign models' });
    }
  });

  // 1a-4. Deep Cross-Partition Auto-Scan (C:, D:, E:, ...) & Automatic Model Binding
  app.post('/api/models/scan-partitions', (req, res) => {
    try {
      const overwriteExisting = Boolean(req.body?.overwriteExisting);
      const result = autoAssignModels({
        overwriteExisting,
        fixMismatches: true,
        scanAllPartitions: true,
      });
      res.json({
        ...result,
        machine: getMachineEnvironment(),
        searchRoots: getSearchRoots(),
        partitionScan: getLastPartitionScanSummary(),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to scan partitions for models' });
    }
  });

  // 1s-1. First-Launch Setup, Dependencies Readiness & Manifest Status
  app.get('/api/setup/status', (_req, res) => {
    try {
      const machine = getMachineEnvironment();
      const manifest = getBackendsManifest();
      const models = getAllModelsStatus();
      const searchRoots = getSearchRoots();
      const coreRequiredIds = (manifest.backends || [])
        .filter((b: any) => !b.optional)
        .map((b: any) => b.id);
      const missingCorePackages = coreRequiredIds.filter(
        (id: string) => !machine.pythonPackages?.[id]
      );
      res.json({
        machine,
        manifest,
        models,
        searchRoots,
        missingCorePackages,
        partitionScan: getLastPartitionScanSummary(),
        updateReport: getCachedStartupUpdateReport(),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to read setup status' });
    }
  });

  // 1s-1b. Live Online Update Check Across Backends, Speed Accelerators & CUDA
  app.get('/api/setup/check-updates', async (req, res) => {
    try {
      const force = req.query.force === '1' || req.query.force === 'true';
      const updateReport = await checkBackendUpdatesOnline(force);
      res.json({ updateReport });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to check backend updates online' });
    }
  });

  // 1s-1c. Auto-Update Outdated Backends, Speed Libraries & CUDA Wheels Online
  app.post('/api/setup/auto-update', async (req, res) => {
    try {
      const packages = Array.isArray(req.body?.packages)
        ? req.body.packages.map((p: any) => String(p).trim()).filter(Boolean)
        : undefined;
      const includeMissingCore = req.body?.includeMissingCore !== false;
      const result = await autoUpdateBackendsOnline({ packages, includeMissingCore });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ ok: false, error: error.message || 'Failed to auto-update backends' });
    }
  });

  // 1s-2. Install Missing Python ML Backends via pip
  app.post('/api/setup/install-python', async (req, res) => {
    try {
      const packages = Array.isArray(req.body?.packages)
        ? req.body.packages.map((p: any) => String(p).trim()).filter(Boolean)
        : undefined;
      const result = await installPythonBackends(packages);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ ok: false, error: error.message || 'Failed to run pip install' });
    }
  });

  // 1s-3. Download Requirements, Setup, Launcher & Manifest Files
  app.get('/api/setup/download/:filename', (req, res) => {
    const allowed: Record<string, string> = {
      'setup.exe': path.join(process.cwd(), 'setup.exe'),
      'requirements.txt': path.join(process.cwd(), 'requirements.txt'),
      'setup.py': path.join(process.cwd(), 'setup.py'),
      'start_hafiz.bat': path.join(process.cwd(), 'start_hafiz.bat'),
      'start_hafiz.sh': path.join(process.cwd(), 'start_hafiz.sh'),
      'backends_manifest.json': path.join(process.cwd(), 'models', 'backends_manifest.json'),
    };
    const fileKey = req.params.filename;
    const targetPath = allowed[fileKey];
    if (!targetPath || !fs.existsSync(targetPath)) {
      return res.status(404).json({ error: 'Setup file not found' });
    }
    res.download(targetPath, fileKey);
  });

  // 1b. Discover Real Local LLM Servers Running on This Machine (Ollama / LM Studio / llama.cpp / vLLM)
  app.get('/api/models/discover-local', async (req, res) => {
    try {
      const customUrl = typeof req.query.customUrl === 'string' ? req.query.customUrl : undefined;
      const servers = await discoverLocalLlms(customUrl);
      res.json({ servers, machine: getMachineEnvironment() });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to discover local LLM servers' });
    }
  });

  // 1c. Update Single Model Slot Configuration
  app.post('/api/models/config', (req, res) => {
    try {
      const {
        slotId,
        internetAccess,
        endpointUrl,
        providerType,
        modelName,
        selectedModelPath,
        apiKey,
        strictLocal,
      } = req.body;
      if (!slotId) {
        return res.status(400).json({ error: 'slotId is required' });
      }
      const updated = updateModelSlotConfig(slotId as ModelSlotId, {
        internetAccess,
        endpointUrl,
        providerType: providerType as ProviderType | undefined,
        modelName,
        selectedModelPath,
        apiKey,
        strictLocal,
      });
      res.json({ model: updated });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to update model config' });
    }
  });

  // 1d. 1-Click Bind Local LLM Preset Across All LLM Slots
  app.post('/api/models/apply-local-llm', (req, res) => {
    try {
      const {
        providerType = 'ollama',
        endpointUrl,
        modelName,
        apiKey = '',
        strictLocal = true,
        slotIds,
      } = req.body;

      if (!endpointUrl || !String(endpointUrl).trim()) {
        return res.status(400).json({ error: 'endpointUrl is required' });
      }
      if (providerType === 'ollama' && (!modelName || !String(modelName).trim())) {
        return res.status(400).json({ error: 'modelName is required for Ollama' });
      }

      const models = applyLocalLlmPreset({
        providerType,
        endpointUrl: String(endpointUrl),
        modelName: String(modelName || ''),
        apiKey: String(apiKey || ''),
        strictLocal: Boolean(strictLocal),
        slotIds,
      });

      res.json({ models, machine: getMachineEnvironment() });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to apply Local LLM preset' });
    }
  });

  // 1e. Live Connection & Inference Ping Test for Any Slot
  app.post('/api/models/test', async (req, res) => {
    try {
      const { slotId } = req.body;
      if (!slotId) {
        return res.status(400).json({ error: 'slotId is required' });
      }
      const result = await testModelSlotConnection(slotId as ModelSlotId, async () => {
        const ai = getAiClient();
        const text = await generateWithFallback(ai, 'قل: جاهز', {});
        return (text || 'OK').trim();
      });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ ok: false, error: error.message || 'Test failed' });
    }
  });

  // 2. ASR Model: Hear Spoken Egyptian Colloquial Audio & Transcribe WITH Diacritics
  app.post('/api/models/asr', async (req, res) => {
    try {
      const { audioBase64, mimeType = 'audio/webm', mode = 'egyptian', language = 'ar' } = req.body;
      if (!audioBase64) {
        return res.status(400).json({ error: 'audioBase64 is required' });
      }

      const { result, engine } = await dispatchModelTask({
        slotId: 'asr_diacritics',
        payload: { audioBase64, mimeType, mode, language },
        fallback: async () => {
          const ai = getAiClient();
          const audioPart = { inlineData: { data: audioBase64, mimeType } };

          let sysPrompt = '';
          let promptText = '';

          if (mode === 'clean_standard') {
            sysPrompt = `أنت خبير التدقيق اللغوي والتفريغ الصوتي للعامية المصرية.
مهمتك:
1. استمع بدقة للمقطع الصوتي وفرغ الكلام بالعامية المصرية السليمة.
2. تصحيح أي أخطاء لفظية بدون وضع أي حركات أو تشكيل على الإطلاق (نص نظيف وخالٍ 100% من أي حركة).
أخرج النص المفرغ النظيف فقط بدون أي تشكيل أو مقدمات.`;
            promptText = 'فرغ هذا الصوت بالعامية المصرية بدقة تامة بدون أي تشكيل.';
          } else if (mode === 'general') {
            sysPrompt = `أنت خبير في تفريغ الصوتيات بجميع اللغات واللهجات.
استمع للملف الصوتي، اكتب الكلام بدقة إملائية وضع التشكيل المناسب للغة أو اللهجة.
إذا كان أغنية، ضع أسماء المقاطع بين أقواس مربعة مثل [Intro], [Verse], [Chorus].
أخرج النص فقط بدون مقدمات.`;
            promptText = 'قم بتفريغ هذا الصوت واكتبه مع التشكيل المناسب.';
          } else {
            sysPrompt = `أنت 'حَافِظ'، نموذج استماع وتفريغ صوتي متخصص في تحويل الكلام العامي المصري المنطوق إلى نص مكتوب بالتشكيل الصوتي الدقيق مباشرة.
استمع بدقة شديدة للكلام المنطوق وفرغه كما نُطق بالعامية المصرية الحية مع تطبيق التشكيل والضبط الصوتي الكامل (فتحة، كسرة، ضمة، شدة، وسكون على آخر الكلمات)، مع الحفاظ على النطق الفعلي للمتحدث.
أخرج النص المفرغ والمشكل مباشرة دون أي شروحات أو مقدمات.`;
            promptText =
              language === 'ar'
                ? 'استمع لما قيل وفرغ الكلام بالعامية المصرية بالتشكيل الدقيق كما نُطق.'
                : 'Transcribe the spoken audio into diacritized Egyptian Arabic exactly as pronounced.';
          }

          const text = await generateWithFallback(ai, [audioPart, promptText], {
            systemInstruction: sysPrompt,
          });
          return { text: (text || '').trim() };
        },
      });

      const finalText = typeof result === 'string' ? result : result?.text || '';
      res.json({ text: finalText, engine });
    } catch (error: any) {
      console.error('Error in /api/models/asr:', error);
      res.status(500).json({ error: error.message || 'Error in ASR transcription' });
    }
  });

  // 3. TTS Reader Model: Read Diacritized Text Faithfully As Written
  app.post('/api/models/tts', async (req, res) => {
    try {
      const { text, voiceName = 'Kore', language = 'ar', refreshAfterPipeline = false } = req.body;
      if (!text || !String(text).trim()) {
        return res.status(400).json({ error: 'text is required' });
      }

      const cleanText = String(text).replace(/\[.*?\]/g, '').trim();

      const executeTts = () =>
        dispatchModelTask({
          slotId: 'tts_reader',
          payload: { text: cleanText, voiceName, language },
          fallback: async () => {
            try {
              const ai = getAiClient();
              const prompt =
                language === 'ar'
                  ? `اقرأ النص التالي بالضبط كما هو مكتوب مع الالتزام الحرفي بكل حركة تشكيل (الفتحة والكسرة والضمة والسكون والشدة) بدون أي تغيير أو زيادة:\n${cleanText}`
                  : cleanText;
              const audioUrl = await generateTTSWithFallback(ai, prompt, voiceName);
              return { audioUrl, textResult: cleanText, fallbackToBrowserSpeech: false };
            } catch {
              return { audioUrl: null, textResult: cleanText, fallbackToBrowserSpeech: true };
            }
          },
        });

      const { result, engine } = refreshAfterPipeline
        ? await runModelPipeline('studio_tts_autoread', executeTts, ['studio_previous_model'])
        : await executeTts();

      res.json({
        audioUrl: result?.audioUrl || null,
        textResult: result?.textResult || cleanText,
        fallbackToBrowserSpeech: Boolean(result?.fallbackToBrowserSpeech ?? !result?.audioUrl),
        engine,
      });
    } catch (error: any) {
      console.error('Error in /api/models/tts:', error);
      res.status(500).json({ error: error.message || 'Error in TTS reader' });
    }
  });

  // 4. Smart Studio Model: Diacritics Modes & Cleaning (Full Local LLM Support)
  app.post('/api/models/diacritics', async (req, res) => {
    try {
      const {
        text,
        mode = 'smart_light',
        genderPreference = 'auto',
        language = 'ar',
      } = req.body;

      if (!text || !String(text).trim()) {
        return res.status(400).json({ error: 'text is required' });
      }

      const registry = loadModelRegistry();
      const smartInternetEnabled = registry.smart_studio?.internetAccess !== false;
      const lexiconVerification = await verifyTextWordsViaWebLexicon(String(text), {
        enableWebSearch: smartInternetEnabled,
        maxWords: 4,
      });

      const genderInstruction =
        genderPreference === 'feminine'
          ? 'السياق موجه للمؤنث حتماً: كاف الخطاب مكسورة ومسكونة (ـِكْ مثل: يِهْدِيْكِ، قَلْبِكْ، شُفْتِكْ، مَعَاكِ)، وضمير المخاطب (إِنْتِ).'
          : genderPreference === 'masculine'
          ? 'السياق موجه للمذكر حتماً: كاف الخطاب مفتوحة ومسكونة (ـَكْ مثل: يِهْدِيْكْ، قَلْبَكْ، شُفْتَكْ، مَعَاكْ)، وضمير المخاطب (إِنْتَ).'
          : 'افهم بذكاء تام من سياق الجملة هل المخاطب مذكر (يِهْدِيْكْ، قَلْبَكْ، إِنْتَ) أم مؤنث (يِهْدِيْكِ، قَلْبِكْ، إِنْتِ).';

      let sysPrompt = '';
      let promptText = '';

      if (mode === 'phonetic_suno') {
        sysPrompt = `أنت 'حَافِظ'، خبير التشفير والتشكيل الصوتي للعامية المصرية ونصوص الأغاني وسونو.
1. سكون إلزامي صريح على آخر كل كلمة (ْ).
2. استبدال حرف القاف (ق) تماماً بهمزات صوتية (ء أو ئـ/ئ).
3. التشكيل الصوتي التام وكسر همزة الوصل صراحة.
${PHONETIC_ENCODING_RULES}${lexiconVerification.webVerificationDirective}
أخرج النص المشفر فقط بدون أي مقدمات.`;
        promptText = `شكّل هذا النص بالتشفير الصوتي الأصلي (سكون آخر كل كلمة وهمزة القاف): "${text}"`;
      } else if (mode === 'connected') {
        sysPrompt = `أنت خبير ضبط وتشكيل العامية المصرية للأغاني والقصائد.
1. سكون صريح (ْ) في آخر كل كلمة بلا استثناء (100%).
2. ممنوع إعراب الفصحى على أواخر الكلمات.
3. حرف القاف (ق) يظل حرف قاف (ق) كما هو ولا يُحوّل إلى همزة.
4. التفرقة الذكية بين المذكر والمؤنث: ${genderInstruction}${lexiconVerification.webVerificationDirective}
أخرج النص المشكل فقط بدون أي شروحات.`;
        promptText = `شكّل بالعامية المصرية مع سكون آخر كل كلمة وحفظ القاف: "${text}"`;
      } else if (mode === 'clean_standard') {
        sysPrompt = `أنت خبير التدقيق والتصحيح اللغوي للعامية المصرية.
1. تصحيح الكلمات وتنسيقها بالعامية المصرية السليمة بدون أخطاء إملائية شائعة.
2. مسح وإزالة أي تشكيل أو حركات نهائياً (نص نظيف تماماً خالٍ 100% من أي حركة).
3. لا تغير الكلمات إلى فصحى متكلفة.${lexiconVerification.webVerificationDirective}
أخرج النص المصحح النظيف فقط بدون أي مقدمات.`;
        promptText = `صحح الكلمات بالعامية وامسح أي تشكيل بالكامل: "${text}"`;
      } else {
        sysPrompt = `أنت 'حَافِظ'، خبير قواعد التشكيل الصوتي والذكي للعامية المصرية والشعر والأغاني.
1. [الأساس الصارم]: سكون صريح (ْ) في آخر كل كلمة بلا استثناء (100%).
2. [التشكيل الصوتي الغنائي الكامل لكل كلمة]: ضبط الحركات (فتحة، ضمة، كسرة، شدة، سكون) بدقة لوزن القراءة والغناء.
3. [التفرقة بين المذكر والمؤنث]: ${genderInstruction}
4. [حرف القاف ق يظل قاف ق أصيلاً 100% ولا يُمس].
5. [ممنوع إعراب الفصحى على الأواخر].${lexiconVerification.webVerificationDirective}
أخرج النص المشكل فقط بدون أي مقدمات أو شروحات.`;
        promptText = `شكّل هذا النص بالتشكيل الذكي الغنائي (سكون آخر كل كلمة وبقاء القاف ق وتفرقة المذكر/المؤنث): "${text}"`;
      }

      const { result, engine } = await dispatchModelTask({
        slotId: 'smart_studio',
        payload: {
          task: `diacritics_${mode}`,
          text,
          genderPreference,
          language,
          enableWebSearch: smartInternetEnabled,
          webResearchContext: lexiconVerification,
        },
        llmPrompt: {
          systemPrompt: sysPrompt,
          userPrompt: promptText,
          expectJson: false,
          temperature: 0.25,
        },
        fallback: async () => {
          const ai = getAiClient();
          let rawText = '';
          if (smartInternetEnabled) {
            try {
              rawText = await generateWithFallback(ai, promptText, {
                systemInstruction: sysPrompt,
                tools: [{ googleSearch: {} }],
              });
            } catch {
              rawText = await generateWithFallback(ai, promptText, { systemInstruction: sysPrompt });
            }
          } else {
            rawText = await generateWithFallback(ai, promptText, { systemInstruction: sysPrompt });
          }
          return { text: (rawText || '').trim() };
        },
      });

      let processed = (typeof result === 'string' ? result : result?.text || '').trim();
      if (!(result as any)?.skipPostProcess) {
        if (mode === 'phonetic_suno') {
          processed = ensureEgyptianPhoneticRules(processed);
        } else if (mode === 'connected') {
          processed = ensureConnectedDiacriticsRules(processed, text, genderPreference);
        } else if (mode === 'smart_light') {
          processed = ensureSmartLightDiacriticsRules(processed, text, genderPreference);
        } else if (mode === 'clean_standard') {
          processed = processed.replace(/[\u064B-\u065F\u0670\u0640]/g, '');
        }
      }

      res.json({
        text: processed,
        engine,
        internetConnected: lexiconVerification.internetConnected,
        sourcesChecked: lexiconVerification.sourcesChecked,
      });
    } catch (error: any) {
      console.error('Error in /api/models/diacritics:', error);
      res.status(500).json({ error: error.message || 'Error processing diacritics' });
    }
  });

  // 5. Diacritics Search Script + Unified Smart Model ("هات تشكيل")
  app.post('/api/models/diacritics-search', async (req, res) => {
    try {
      const { word, language = 'ar', enableWebSearch } = req.body;
      if (!word || !String(word).trim()) {
        return res.status(400).json({ error: 'word is required' });
      }

      const registry = loadModelRegistry();
      const smartInternet = registry.smart_studio?.internetAccess !== false;
      const searchSlotInternet = registry.diacritics_search?.internetAccess !== false;
      const shouldUseWeb =
        typeof enableWebSearch === 'boolean' ? enableWebSearch : smartInternet && searchSlotInternet;

      const scriptContext = await runDiacriticsSearchScript(String(word), {
        enableWebSearch: shouldUseWeb,
      });
      const sysPrompt = `أنت باحث لغوي متخصص في جمع جميع أنواع التشكيل الممكنة للكلمات بالعامية المصرية والعربية الفصحى والتشفير الصوتي.
${scriptContext.searchDirectivePrompt}`;
      const userPrompt =
        language === 'ar'
          ? `ابحث وأحضر كل أنواع التشكيل الممكنة لكلمة: "${scriptContext.normalizedQuery}" بصيغة JSON فقط.`
          : `Search and return all diacritization types for: "${scriptContext.normalizedQuery}" in JSON only.`;

      const { result, engine } = await dispatchModelTask({
        slotId: 'diacritics_search',
        payload: {
          word: scriptContext.normalizedQuery,
          language,
          enableWebSearch: shouldUseWeb,
          scriptContext,
        },
        llmPrompt: {
          systemPrompt: sysPrompt,
          userPrompt,
          expectJson: true,
          temperature: 0.2,
        },
        fallback: async () => {
          const ai = getAiClient();
          let rawJson = '';
          if (shouldUseWeb) {
            try {
              rawJson = await generateWithFallback(ai, userPrompt, {
                systemInstruction: sysPrompt,
                responseMimeType: 'application/json',
                tools: [{ googleSearch: {} }],
              });
            } catch {
              rawJson = await generateWithFallback(ai, userPrompt, {
                systemInstruction: sysPrompt,
                responseMimeType: 'application/json',
              });
            }
          } else {
            rawJson = await generateWithFallback(ai, userPrompt, {
              systemInstruction: sysPrompt,
              responseMimeType: 'application/json',
            });
          }
          return extractJsonFromText(rawJson);
        },
      });

      const parsed = typeof result === 'string' ? extractJsonFromText(result) : result || {};
      const existingWords = new Set((parsed.suggestions || []).map((s: any) => s.word));
      const mergedSuggestions = [...(parsed.suggestions || [])];
      for (const hit of scriptContext.lexiconHits) {
        if (!existingWords.has(hit.word)) {
          mergedSuggestions.push({
            word: hit.word,
            type: hit.type,
            typeLabel: language === 'ar' ? hit.typeLabelAr : hit.typeLabelEn,
            meaning: hit.meaning,
            source: hit.source,
          });
        }
      }

      const mergedSources = Array.from(
        new Set([...(scriptContext.sourcesChecked || []), ...(Array.isArray(parsed.sourcesChecked) ? parsed.sourcesChecked : [])])
      );

      res.json({
        suggestions: mergedSuggestions,
        synonyms: parsed.synonyms || [],
        antonyms: parsed.antonyms || [],
        sourcesChecked: mergedSources,
        morphologicalHints: parsed.morphologicalHints || scriptContext.morphologicalHints,
        internetConnected: scriptContext.internetConnected || shouldUseWeb,
        engine,
      });
    } catch (error: any) {
      console.error('Error in /api/models/diacritics-search:', error);
      res.status(500).json({ error: error.message || 'Error searching diacritics' });
    }
  });

  // 6. Rhymes Model (Full Local LLM Support)
  app.post('/api/models/rhymes', async (req, res) => {
    try {
      const { word, language = 'ar' } = req.body;
      if (!word || !String(word).trim()) {
        return res.status(400).json({ error: 'word is required' });
      }

      const sysPrompt = `أنت شاعر مصري خبير في القوافي الشعرية للعامية المصرية الموزونة.
أعطني قائمة بكلمات مصرية عامية (لغة الشارع والمهرجانات والراب والشعر) لها نفس وزن وقافية الكلمة المطلوبة.
الشروط:
1. عامية مصرية 100%.
2. القافية مطابقة تماماً ونفس عدد المقاطع الصوتية.
أخرج النتيجة بصيغة JSON فقط بدون أي نص إضافي:
{ "rhymes": ["كلمة1", "كلمة2", "كلمة3", "كلمة4", "كلمة5", "كلمة6"] }
${PHONETIC_ENCODING_RULES}`;

      const userPrompt =
        language === 'ar'
          ? `هات كلمات عامية مصرية لها نفس القافية والوزن لكلمة: "${word}" بصيغة JSON.`
          : `Get Egyptian colloquial rhymes with matching meter for: "${word}" in JSON.`;

      const { result, engine } = await dispatchModelTask({
        slotId: 'rhyme_rewrite',
        payload: { task: 'rhymes', word, language },
        llmPrompt: {
          systemPrompt: sysPrompt,
          userPrompt,
          expectJson: true,
          temperature: 0.6,
        },
        fallback: async () => {
          const ai = getAiClient();
          const rawJson = await generateWithFallback(ai, userPrompt, {
            systemInstruction: sysPrompt,
            responseMimeType: 'application/json',
          });
          return extractJsonFromText(rawJson);
        },
      });

      const parsed = typeof result === 'string' ? extractJsonFromText(result) : result || {};
      res.json({ rhymes: parsed.rhymes || [], engine });
    } catch (error: any) {
      console.error('Error in /api/models/rhymes:', error);
      res.status(500).json({ error: error.message || 'Error finding rhymes' });
    }
  });

  // 7. Line Rewrite Model (Full Local LLM Support)
  app.post('/api/models/rewrite', async (req, res) => {
    try {
      const { line, context = '', language = 'ar' } = req.body;
      if (!line || !String(line).trim()) {
        return res.status(400).json({ error: 'line is required' });
      }

      const sysPrompt = `أنت شاعر وكاتب أغاني مصري محترف (مهرجانات، شعبي، راب، تراب).
مهمتك: إعادة صياغة السطر ليكون أقوى وأكثر جاذبية مع الحفاظ الصارم على:
1. نفس القافية (نفس الحرفين الأخيرين).
2. نفس الوزن والرتم الموسيقي وتفعيلات السطر.
3. العامية المصرية الأصيلة.
أخرج السطر الجديد فقط دون أي مقدمات أو شروحات.
${PHONETIC_ENCODING_RULES}`;

      const userPrompt = context.trim()
        ? `أعد صياغة هذا السطر مع الحفاظ الصارم على وزنه وقافيته بالعامية المصرية: "${line}"\nالسياق العام: "${context}"`
        : `أعد صياغة هذا السطر مع الحفاظ الصارم على وزنه وقافيته بالعامية المصرية: "${line}"`;

      const { result, engine } = await dispatchModelTask({
        slotId: 'rhyme_rewrite',
        payload: { task: 'rewrite', line, context, language },
        llmPrompt: {
          systemPrompt: sysPrompt,
          userPrompt,
          expectJson: false,
          temperature: 0.6,
        },
        fallback: async () => {
          const ai = getAiClient();
          const text = await generateWithFallback(ai, userPrompt, { systemInstruction: sysPrompt });
          return { text: (text || '').trim() };
        },
      });

      const finalText = typeof result === 'string' ? result : result?.text || '';
      res.json({ text: finalText, engine });
    } catch (error: any) {
      console.error('Error in /api/models/rewrite:', error);
      res.status(500).json({ error: error.message || 'Error rewriting line' });
    }
  });

  // 8. Music Prompt Generator Model (Suno / Udio + Live Suno Research Script + Local LLM Support)
  app.post('/api/models/prompt', async (req, res) => {
    try {
      const { genre, mood, lyrics = '', enableWebSearch, language = 'ar' } = req.body;
      if (!genre || !mood) {
        return res.status(400).json({ error: 'genre and mood are required' });
      }

      const registry = loadModelRegistry();
      const smartInternet = registry.smart_studio?.internetAccess !== false;
      const promptInternet = registry.prompt_generator?.internetAccess !== false;
      const slotInternetEnabled = smartInternet && promptInternet;
      const shouldUseWeb = typeof enableWebSearch === 'boolean' ? enableWebSearch : slotInternetEnabled;

      const [sunoResearch, lyricsVerification] = await Promise.all([
        runSunoResearchScript({
          enableWebSearch: shouldUseWeb,
          genre,
          mood,
        }),
        shouldUseWeb && lyrics.trim()
          ? verifyTextWordsViaWebLexicon(lyrics, { enableWebSearch: true, maxWords: 3 })
          : Promise.resolve(null),
      ]);

      const sysPrompt = `أنت خبير هندسة البرومبتات (Prompt Engineering) لأدوات توليد الموسيقى بالذكاء الاصطناعي مثل Suno AI و Udio.
${sunoResearch.sunoPromptDirective}
${lyricsVerification?.webVerificationDirective || ''}
المعطيات المطلوبة:
النوع الموسيقي: ${genre}
الحالة: ${mood}
${lyrics.trim() ? `كلمات الأغنية:\n${lyrics.trim()}` : ''}

يجب أن يتضمن البرومبت:
1. [Style]: وصف دقيق للنمط وأحدث جودة صوتية مدعومة في Suno.
2. [Instruments]: الآلات المناسبة بدقة.
3. [Vocal Style]: أسلوب الغناء والأداء.
4. [Atmosphere & Mix]: الجو العام وهندسة الصوت.

أخرج البرومبت الإنجليزي الجاهز للنسخ في Suno، وأضف شرحاً مختصراً بالعربية يوضح أحدث إصدار وميزات Suno التي تم الاستناد إليها.`;

      const promptMsg = shouldUseWeb
        ? `استناداً لبيانات الإنترنت الحية والمراجع المرفقة، اكتب برومبت Suno احترافي لنوع ${genre} وحالة ${mood}.`
        : `اكتب برومبت Suno احترافي لنوع ${genre} وحالة ${mood}.`;

      const { result, engine } = await dispatchModelTask({
        slotId: 'prompt_generator',
        payload: {
          genre,
          mood,
          lyrics,
          enableWebSearch: shouldUseWeb,
          sunoResearchContext: sunoResearch,
          webResearchContext: lyricsVerification,
          language,
        },
        llmPrompt: {
          systemPrompt: sysPrompt,
          userPrompt: promptMsg,
          expectJson: false,
          temperature: 0.5,
        },
        fallback: async () => {
          const ai = getAiClient();
          let text = '';
          if (shouldUseWeb) {
            try {
              text = await generateWithFallback(ai, promptMsg, {
                systemInstruction: sysPrompt,
                tools: [{ googleSearch: {} }],
              });
            } catch {
              text = await generateWithFallback(ai, promptMsg, { systemInstruction: sysPrompt });
            }
          } else {
            text = await generateWithFallback(ai, promptMsg, { systemInstruction: sysPrompt });
          }
          return { text: (text || '').trim() };
        },
      });

      const finalText = typeof result === 'string' ? result : result?.text || '';
      const mergedSources = Array.from(
        new Set([...sunoResearch.sourcesChecked, ...(lyricsVerification?.sourcesChecked || [])])
      );
      res.json({
        text: finalText,
        engine,
        internetConnected: sunoResearch.internetConnected,
        sourcesChecked: mergedSources,
        liveSnippets: sunoResearch.liveSnippets,
      });
    } catch (error: any) {
      console.error('Error in /api/models/prompt:', error);
      res.status(500).json({ error: error.message || 'Error generating prompt' });
    }
  });

  // 9. Smart Studio Lyrics & Composition Tasks (Pre-flight Web Lexicon + Suno Search + Local LLM)
  app.post('/api/models/lyrics', async (req, res) => {
    try {
      const {
        task,
        text,
        genre = 'mahraganat',
        genreTitle = '',
        enableWebSearch,
        language = 'ar',
      } = req.body;
      if (!text || !String(text).trim()) {
        return res.status(400).json({ error: 'text is required' });
      }

      const registry = loadModelRegistry();
      const slotInternetEnabled = registry.smart_studio?.internetAccess !== false;
      const shouldUseWeb =
        typeof enableWebSearch === 'boolean' ? enableWebSearch : slotInternetEnabled;

      const [sunoResearch, lexiconVerification] = await Promise.all([
        task === 'compose_song' || task === 'analyze_lyrics'
          ? runSunoResearchScript({ enableWebSearch: shouldUseWeb, genre: genreTitle || genre })
          : Promise.resolve(null),
        shouldUseWeb
          ? verifyTextWordsViaWebLexicon(String(text), { enableWebSearch: true, maxWords: 4 })
          : Promise.resolve(null),
      ]);

      let sysPrompt = '';
      let promptText = '';
      let applyPhonetic = false;
      const webDir = lexiconVerification?.webVerificationDirective || '';

      if (task === 'write_lyrics') {
        applyPhonetic = true;
        sysPrompt = `أنت 'حَافِظ'، المؤلف المحترف لأغاني العامية المصرية.
1. استخدم العامية المصرية 100% بطريقة طبيعية.
2. ألف كلمات أصلية من الصفر وقسمها: [Intro], [Verse], [Chorus], [Outro].
3. قوافٍ قوية ومترابطة، بدون مقدمات أو شروحات.
${PHONETIC_ENCODING_RULES}${webDir}`;
        promptText = `ألف كلمات أغنية مصرية عن:\n"${text}"`;
      } else if (task === 'compose_song') {
        applyPhonetic = true;
        const metaTags = `[Style: ${genreTitle || genre}, Egyptian Street Colloquial, Authentic Cairo Accent, 130 BPM, Dynamic Groove, Live Tabla, Synth Leads]
[Vocal Delivery: Authentic Egyptian Street Accent, Expressive Melodic Delivery, High Energy]
[Pronunciation: Colloquial Egyptian Phonetics & Syllables]`;
        sysPrompt = `أنت 'حَافِظ'، مؤلف الأغاني المصرية وخبير التشفير الصوتي لـ Suno AI.
${sunoResearch ? `${sunoResearch.sunoPromptDirective}\n` : ''}${webDir}
ضع أكواد الميتا الإنجليزية في البداية:
${metaTags}
قسم الأغنية إلى: [Intro], [Verse 1], [Chorus], [Verse 2], [Chorus], [Outro].
وطبق التشفير الصوتي المصري الأصيل:
${PHONETIC_ENCODING_RULES}
أخرج الأغنية مباشرة بدون مقدمات.`;
        promptText = `قم بترتيب وتأليف الأغنية باحترافية بناءً على: "${text}" بنمط "${genreTitle || genre}".`;
      } else if (task === 'format_lyrics') {
        sysPrompt = `أنت شاعر ومنسق أغاني محترف.
قسّم ونسّق الكلمات لتكون جاهزة للهندسة الصوتية باستخدام: [Intro], [Verse 1], [Pre-Chorus], [Chorus], [Verse 2], [Chorus 2], [Bridge], [Outro].
حافظ على الكلمات الأصلية وقسمها بشكل موزون.${webDir}`;
        promptText = text;
      } else {
        sysPrompt = `أنت منتج فني (A&R) متخصص في الموسيقى المصرية الحديثة.
${sunoResearch ? `${sunoResearch.sunoPromptDirective}\n` : ''}${webDir}
1. حلل مود الكلمات.
2. اقترح 3 أنواع موسيقية مصرية تليق بها.
3. اكتب برومبت Suno AI إنجليزي احترافي يجمع بين الروح المصرية والتقنيات العالمية.`;
        promptText = text;
      }

      const { result, engine } = await dispatchModelTask({
        slotId: 'smart_studio',
        payload: {
          task,
          text,
          genre,
          genreTitle,
          enableWebSearch: shouldUseWeb,
          sunoResearchContext: sunoResearch,
          webResearchContext: lexiconVerification,
          language,
        },
        llmPrompt: {
          systemPrompt: sysPrompt,
          userPrompt: promptText,
          expectJson: false,
          temperature: 0.6,
        },
        fallback: async () => {
          const ai = getAiClient();
          let rawText = '';
          if (shouldUseWeb) {
            try {
              rawText = await generateWithFallback(ai, promptText, {
                systemInstruction: sysPrompt,
                tools: [{ googleSearch: {} }],
              });
            } catch {
              rawText = await generateWithFallback(ai, promptText, { systemInstruction: sysPrompt });
            }
          } else {
            rawText = await generateWithFallback(ai, promptText, { systemInstruction: sysPrompt });
          }
          return { text: (rawText || '').trim() };
        },
      });

      let finalText = (typeof result === 'string' ? result : result?.text || '').trim();
      if (applyPhonetic && !(result as any)?.skipPostProcess) {
        finalText = ensureEgyptianPhoneticRules(finalText);
      }

      const mergedSources = Array.from(
        new Set([...(sunoResearch?.sourcesChecked || []), ...(lexiconVerification?.sourcesChecked || [])])
      );

      res.json({
        text: finalText,
        engine,
        internetConnected: Boolean(
          sunoResearch?.internetConnected || lexiconVerification?.internetConnected || shouldUseWeb
        ),
        sourcesChecked: mergedSources,
      });
    } catch (error: any) {
      console.error('Error in /api/models/lyrics:', error);
      res.status(500).json({ error: error.message || 'Error in lyrics studio task' });
    }
  });

  // 10. Audio Music Analysis (Uploaded file or YouTube URL + ASR-to-Local-LLM pipeline)
  app.post('/api/models/audio-analyze', async (req, res) => {
    try {
      const { audioBase64, mimeType, youtubeUrl, mode = 'deep_analysis' } = req.body;

      if (!audioBase64 && !youtubeUrl) {
        return res.status(400).json({ error: 'audioBase64 or youtubeUrl is required' });
      }

      let base64Data = audioBase64;
      let resolvedMime = mimeType || 'audio/webm';

      if (!base64Data && youtubeUrl) {
        const info = await ytdl.getInfo(youtubeUrl);
        const audioFormat = ytdl.chooseFormat(info.formats, { quality: 'highestaudio' });
        const stream = ytdl.downloadFromInfo(info, { format: audioFormat });

        const chunks: Uint8Array[] = [];
        let currentSize = 0;
        for await (const chunk of stream) {
          chunks.push(chunk);
          currentSize += chunk.length;
          if (currentSize > 6 * 1024 * 1024) {
            stream.destroy();
            throw new Error('المقطع طويل جداً (أكبر من 6 ميجابايت). يرجى اختيار مقطع أقصر أو رفع الملف مباشرة.');
          }
        }
        const buffer = Buffer.concat(chunks);
        base64Data = buffer.toString('base64');
        resolvedMime = audioFormat.mimeType ? audioFormat.mimeType.split(';')[0] : 'audio/webm';
      }

      const registry = loadModelRegistry();
      const smartStatus = resolveModelSlotStatus(registry.smart_studio);
      const isTextOnlyLocalLlm =
        smartStatus.activeAdapter === 'ollama' ||
        smartStatus.activeAdapter === 'openai_compatible' ||
        smartStatus.activeAdapter === 'local_disk';

      const sysPrompt =
        mode === 'suno_1000'
          ? `أنت منتج موسيقي وخبير (A&R).
1. فرغ الكلمات وقسمها بين أقواس مربعة [Intro], [Verse], [Chorus].
2. حدد النوع الموسيقي والوايب والآلات والـ BPM.
3. اكتب برومبت Suno AI إنجليزي مكون من حوالي 1000 حرف يشرح التركيبة الصوتية والموسيقية بدقة داخل [Suno Prompt: ...].`
          : `أنت مهندس صوت ومنتج موسيقي وموزع عالمي.
حلل المقطع الصوتي تحليلاً وتفكيكاً موسيقياً شاملاً:
1. النوع الموسيقي الدقيق (Exact Genre / Sub-genre).
2. الروح والمود العام.
3. التركيبة والتوزيع، الآلات الموسيقية، وإعداد الـ Drums/Bass.
4. المقام أو السلم الموسيقي وسرعة الإيقاع (BPM).
5. برومبت إنجليزي فائق الدقة صالح لـ Suno AI أو Udio مع شرح بالعربية.
6. أمثلة لأعمال مشابهة بدقة.`;

      const pipelineOut = await runModelPipeline('audio_analyze', async () => {
        // If smart_studio is a text-only Local LLM, chain ASR first so the Local LLM receives real lyrics!
        let transcribedForLocalLlm = '';
        if (isTextOnlyLocalLlm) {
          const asrOut = await dispatchModelTask({
            slotId: 'asr_diacritics',
            payload: { audioBase64: base64Data, mimeType: resolvedMime, mode: 'general', language: 'ar' },
            fallback: async () => {
              const ai = getAiClient();
              const t = await generateWithFallback(
                ai,
                [{ inlineData: { data: base64Data, mimeType: resolvedMime } }, 'فرغ كلمات هذا المقطع الصوتي بدقة.'],
                {}
              );
              return { text: (t || '').trim() };
            },
          });
          transcribedForLocalLlm =
            typeof asrOut.result === 'string' ? asrOut.result : asrOut.result?.text || '';
        }

        const localLlmUserPrompt =
          mode === 'suno_1000'
            ? `الكلمات المفرغة من الصوت:\n${transcribedForLocalLlm}\n\nنسقها واكتب برومبت Suno مفصل من 1000 حرف.`
            : `الكلمات المفرغة من الصوت:\n${transcribedForLocalLlm}\n\nقم بالتحليل الموسيقي والأسلوب المقترح وبرومبت Suno/Udio الدقيق.`;

        return dispatchModelTask({
          slotId: 'smart_studio',
          payload: { task: `audio_${mode}`, audioBase64: base64Data, mimeType: resolvedMime },
          llmPrompt: isTextOnlyLocalLlm
            ? {
                systemPrompt: sysPrompt,
                userPrompt: localLlmUserPrompt,
                expectJson: false,
                temperature: 0.4,
              }
            : undefined,
          fallback: async () => {
            const ai = getAiClient();
            const audioPart = { inlineData: { data: base64Data, mimeType: resolvedMime } };
            const promptText =
              mode === 'suno_1000'
                ? 'حلل المقطع باحترافية واكتب كلماته وبرومبت Suno مفصل من 1000 حرف.'
                : 'أعطني تحليلاً وتفكيكاً موسيقياً شاملاً ودقيقاً للغاية لهذا المقطع الصوتي.';

            const text = await generateWithFallback(ai, [audioPart, promptText], {
              systemInstruction: sysPrompt,
            });
            return { text: (text || '').trim() };
          },
        });
      });

      const finalText =
        typeof pipelineOut.result === 'string' ? pipelineOut.result : pipelineOut.result?.text || '';
      res.json({ result: finalText, engine: pipelineOut.engine });
    } catch (error: any) {
      console.error('Error in /api/models/audio-analyze:', error);
      res.status(500).json({ error: error.message || 'Error analyzing audio' });
    }
  });

  // 11. Real Voice Clone Synthesis Route (Routes to `voice_clone` Slot First, Honest Fallback)
  app.post('/api/models/voice-clone', async (req, res) => {
    try {
      const { sourceAudio, targetAudio, lyrics = '', language = 'ar' } = req.body;
      if (!sourceAudio?.data || !targetAudio?.data) {
        return res.status(400).json({ error: 'sourceAudio and targetAudio are required' });
      }

      let isReferenceGuide = false;

      const { result, engine } = await runModelPipeline('voice_clone', () =>
        dispatchModelTask({
          slotId: 'voice_clone',
          payload: { sourceAudio, targetAudio, lyrics, language },
          fallback: async () => {
            isReferenceGuide = true;
            const ai = getAiClient();
            const sysPrompt = `أنت مهندس صوت متخصص في تحليل خامة الأصوات والمقامات الموسيقية.
حلل الملف الصوتي الأول (البصمة الصوتية للمؤدي: طبقة الصوت، الترددات، البحة، النبرة) والملف الثاني (اللحن والأداء المطلوب: الإيقاع، المقام، العرب).
مهم جداً: لا تدّعِ أنك أجريت استنساخاً صوتياً فعلياً إذا لم يكن موديل RVC/XTTS مثبتاً؛ قدّم تقريراً هندسياً واقعياً لخامة الصوت وكيفية ضبطها.`;

            const targetWords = lyrics.trim() || 'تجربة الأداء الصوتي المرجعي';
            const resText = await generateWithFallback(
              ai,
              [
                { inlineData: { data: sourceAudio.data, mimeType: sourceAudio.mimeType } },
                { inlineData: { data: targetAudio.data, mimeType: targetAudio.mimeType } },
                `حلل البصمة الصوتية وخريطة اللحن بدقة للكلمات: "${targetWords}"`,
              ],
              { systemInstruction: sysPrompt }
            );

            let audioUrl: string | null = null;
            try {
              const ttsDispatch = await dispatchModelTask({
                slotId: 'tts_reader',
                payload: { text: targetWords, voiceName: 'Kore', language },
                fallback: async () => {
                  const wav = await generateTTSWithFallback(ai, targetWords, 'Kore');
                  return { audioUrl: wav };
                },
              });
              audioUrl = ttsDispatch.result?.audioUrl || null;
            } catch {
              audioUrl = null;
            }

            const notice =
              language === 'ar'
                ? '⚠️ تنبيه واقعي: لا يوجد حالياً موديل استنساخ أصوات (RVC / XTTS-v2) مربوط في منفذ models/voice-clone/، لذا المقطع الصوتي المرفق هو «قراءة مرجعية تجريبية» فقط، والتقرير أدناه تحليل صوتي حقيقي للعينتين.\n\n'
                : '⚠️ Honest Notice: No RVC/XTTS-v2 voice clone model is currently mounted in models/voice-clone/. The attached audio is a reference guide reading, paired with real acoustic analysis below.\n\n';

            return { text: notice + (resText || '').trim(), audioUrl };
          },
        })
      );

      res.json({
        text: typeof result === 'string' ? result : result?.text || '',
        audioUrl: result?.audioUrl || null,
        engine,
        isReferenceGuide,
      });
    } catch (error: any) {
      console.error('Error in /api/models/voice-clone:', error);
      res.status(500).json({ error: error.message || 'Error in voice synthesis' });
    }
  });

  // 12. Web Lyrics & Website Research AI Agent (Slot: web_lyrics_agent + Local LLM Support)
  app.post('/api/models/web-agent', async (req, res) => {
    try {
      const {
        mode = 'url',
        url = '',
        query = '',
        task = 'extract_lyrics',
        customInstruction = '',
        language = 'ar',
      } = req.body;

      if (mode === 'url' && !String(url).trim()) {
        return res.status(400).json({ error: 'url is required' });
      }
      if (mode === 'search' && !String(query).trim()) {
        return res.status(400).json({ error: 'query is required' });
      }

      const registry = loadModelRegistry();
      if (registry.web_lyrics_agent && registry.web_lyrics_agent.internetAccess === false) {
        return res.status(403).json({
          error:
            language === 'ar'
              ? 'الاتصال بالإنترنت معطّل لإيجنت الويب في خريطة الموديلات. فعّله من تبويب الموديلات.'
              : 'Internet access is disabled for Web Agent in the Models Map.',
        });
      }

      let fetchedPage: Awaited<ReturnType<typeof fetchWebsiteContent>> | null = null;
      let searchHits: Awaited<ReturnType<typeof searchWebForLyrics>> = [];

      if (mode === 'url') {
        fetchedPage = await fetchWebsiteContent(String(url));
      } else {
        searchHits = await searchWebForLyrics(String(query));
        if (searchHits.length > 0 && searchHits[0].url?.startsWith('http')) {
          try {
            fetchedPage = await fetchWebsiteContent(searchHits[0].url);
          } catch {
            // Proceed with search hits
          }
        }
      }

      const taskInstruction =
        task === 'diacritize_smart'
          ? 'استخرج كلمات الأغنية صافية ثم طبّق عليها التشكيل الذكي بالعامية المصرية (سكون آخر كل كلمة مع بقاء القاف ق وتفرقة المذكر/المؤنث).'
          : task === 'phonetic_suno'
          ? `استخرج كلمات الأغنية صافية ثم طبّق عليها التشفير الصوتي لـ Suno:\n${PHONETIC_ENCODING_RULES}`
          : task === 'analyze_and_prompt'
          ? 'استخرج كلمات الأغنية، حلل أسلوبها الموسيقي والمقام/الإيقاع، واكتب برومبت Suno AI إنجليزي احترافي مناسب لها.'
          : task === 'custom' && customInstruction.trim()
          ? customInstruction.trim()
          : 'استخرج كلمات الأغنية أو المعلومات المطلوبة من المصدر بشكل نظيف ومنظم، مع ذكر عنوان الأغنية والفنان إن وجد، وحذف أي نصوص إعلانات أو قوائم موقع.';

      const sourceBlock = [
        fetchedPage
          ? `محتوى صفحة الويب المستخرج (${fetchedPage.url}):\nالعنوان: ${fetchedPage.title}\nالوصف: ${fetchedPage.description}\nالنص:\n${fetchedPage.extractedText}`
          : '',
        searchHits.length > 0
          ? `نتائج البحث على الويب:\n${searchHits.map((h, i) => `${i + 1}. ${h.title} (${h.url})\n${h.snippet}`).join('\n\n')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n---\n\n');

      const sysPrompt = `أنت 'إيجنت حَافِظ للويب والأغاني'، وكيل ذكاء اصطناعي متصل بالإنترنت لاستخراج كلمات الأغاني وتحليل مواقع الموسيقى.
مهمتك:
${taskInstruction}
تأكد من الإخراج المرتب والواضح بالاعتماد على المحتوى الفعلي المرفق.`;

      const userMsg =
        mode === 'url'
          ? `نفّذ المهمة على هذا الموقع (${url}):\n\n${sourceBlock}`
          : `ابحث ونفّذ المهمة عن: "${query}"\n\n${sourceBlock || 'لا تتوفر نتائج نصية من الصفحة؛ استخرج أدق ما أمكن.'}`;

      const { result, engine } = await dispatchModelTask({
        slotId: 'web_lyrics_agent',
        payload: {
          mode,
          url,
          query,
          task,
          customInstruction,
          fetchedPage,
          searchHits,
          language,
        },
        llmPrompt: {
          systemPrompt: sysPrompt,
          userPrompt: userMsg,
          expectJson: false,
          temperature: 0.3,
        },
        fallback: async () => {
          const ai = getAiClient();
          let text = '';
          try {
            text = await generateWithFallback(ai, userMsg, {
              systemInstruction: sysPrompt,
              tools: [{ googleSearch: {} }],
            });
          } catch {
            text = await generateWithFallback(ai, userMsg, { systemInstruction: sysPrompt });
          }
          return { text: (text || '').trim() };
        },
      });

      let finalText = (typeof result === 'string' ? result : result?.text || '').trim();
      if (!(result as any)?.skipPostProcess) {
        if (task === 'diacritize_smart') {
          finalText = ensureSmartLightDiacriticsRules(finalText, undefined, 'auto');
        } else if (task === 'phonetic_suno') {
          finalText = ensureEgyptianPhoneticRules(finalText);
        }
      }

      res.json({
        text: finalText,
        engine,
        fetchedPage: fetchedPage
          ? {
              url: fetchedPage.url,
              title: fetchedPage.title,
              charCount: fetchedPage.charCount,
            }
          : null,
        searchHits,
      });
    } catch (error: any) {
      console.error('Error in /api/models/web-agent:', error);
      res.status(500).json({ error: error.message || 'Error running Web Agent' });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        watch: {
          // Ignore models/registry.json & dropped weights so saving a model never reloads the page
          ignored: ['**/models/**'],
        },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  try {
    const startupScan = autoAssignModels({
      overwriteExisting: false,
      fixMismatches: true,
      scanAllPartitions: true,
    });
    console.log(
      `[Hafiz Auto-Models] Scanned partitions (${startupScan.scannedPartitions.join(', ')}), discovered ${startupScan.discoveredCount} model(s) across ${startupScan.discoveredRoots.length} root(s), auto-bound ${startupScan.assigned.length} slot(s).`
    );
    if (startupScan.assigned.length > 0) {
      console.log(
        `[Hafiz Auto-Models] Bound slots: ${startupScan.assigned.map((a) => `${a.slotId}->${a.modelName}`).join(', ')}`
      );
    }
  } catch {
    // Non-fatal if partitions/drives are inaccessible
  }

  void checkBackendUpdatesOnline(true)
    .then(async (report) => {
      if (report.outdatedCount > 0 || report.cudaUpgradeCount > 0) {
        console.log(
          `[Hafiz Online Updater] Found ${report.outdatedCount} PyPI update(s) and ${report.cudaUpgradeCount} CUDA upgrade(s).`
        );
        if (process.env.AUTO_UPDATE_ON_START === '1') {
          const upd = await autoUpdateBackendsOnline({ includeMissingCore: true });
          console.log(
            `[Hafiz Online Updater] Auto-updated: ${upd.updatedPackages.join(', ') || 'none'}`
          );
        }
      } else if (report.onlineReachable) {
        console.log('[Hafiz Online Updater] All backends & CUDA wheels are up to date.');
      }
    })
    .catch(() => {
      // Non-fatal when offline
    });

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  let shuttingDown = false;
  const handleShutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await Promise.race([
        unloadAllModels(`app_shutdown:${signal}`),
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
    } catch {
      // ignore unload errors on exit
    }
    server.close(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 1500).unref();
  };

  process.once('SIGINT', () => void handleShutdown('SIGINT'));
  process.once('SIGTERM', () => void handleShutdown('SIGTERM'));
  process.once('SIGUSR2', () => void handleShutdown('SIGUSR2'));
}

startServer();