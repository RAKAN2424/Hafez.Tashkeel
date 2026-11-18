import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn, execFileSync, execFile, type ChildProcessWithoutNullStreams } from 'child_process';
import { AsyncLocalStorage } from 'async_hooks';
import { GoogleGenAI } from '@google/genai';

export type ModelSlotId =
  | 'asr_diacritics'
  | 'tts_reader'
  | 'smart_studio'
  | 'rhyme_rewrite'
  | 'prompt_generator'
  | 'diacritics_search'
  | 'web_lyrics_agent'
  | 'voice_clone';

export type ProviderType =
  | 'auto'
  | 'local_disk'
  | 'python_cli'
  | 'ollama'
  | 'openai_compatible'
  | 'openai_audio'
  | 'http_custom'
  | 'fallback_ai';

export type ResolvedAdapter =
  | 'local_disk'
  | 'python_cli'
  | 'ollama'
  | 'openai_compatible'
  | 'openai_audio'
  | 'http'
  | 'fallback_ai';

export interface LocalDiskModel {
  id: string;
  name: string;
  path: string;
  relativePath: string;
  kind:
    | 'gguf'
    | 'hf_dir'
    | 'ct2_whisper'
    | 'coqui_xtts'
    | 'onnx'
    | 'pytorch'
    | 'python_script'
    | 'weight_file';
  sizeBytes: number;
  sizeLabel: string;
  source: 'slot_folder' | 'models_root' | 'models_shared';
}

export interface ModelRegistryEntry {
  id: ModelSlotId;
  nameAr: string;
  nameEn: string;
  roleAr: string;
  roleEn: string;
  folder: string;
  apiEndpoint: string;
  adapter?: string;
  providerType?: ProviderType;
  endpointUrl?: string;
  modelName?: string;
  selectedModelPath?: string;
  apiKey?: string;
  strictLocal?: boolean;
  supportsLocalLlm?: boolean;
  envVar?: string;
  scriptPath: string;
  helperScript?: string;
  supportsInternet: boolean;
  internetAccess: boolean;
  inputType: string;
  outputType: string;
}

export interface ModelSlotStatus {
  id: ModelSlotId;
  nameAr: string;
  nameEn: string;
  roleAr: string;
  roleEn: string;
  folder: string;
  apiEndpoint: string;
  providerType: ProviderType;
  activeAdapter: ResolvedAdapter;
  configuredEndpoint: string | null;
  modelName: string;
  selectedModelPath: string;
  availableLocalModels: LocalDiskModel[];
  hasApiKey: boolean;
  strictLocal: boolean;
  supportsLocalLlm: boolean;
  scriptDetected: boolean;
  detectedFiles: string[];
  helperScript?: string;
  supportsInternet: boolean;
  internetAccess: boolean;
  inheritedFrom?: ModelSlotId | null;
  effectiveModelPath?: string;
  effectiveModelLabel?: string;
  readyForCustomModel: boolean;
}

export interface MachineEnvironment {
  platform: string;
  arch: string;
  cpuCores: number;
  totalMemoryGb: number;
  freeMemoryGb: number;
  nodeVersion: string;
  pythonBin: string;
  pythonAvailable: boolean;
  pythonVersion: string | null;
  pipAvailable: boolean;
  ffmpegAvailable: boolean;
  nvidiaGpuAvailable: boolean;
  nvidiaGpuName: string | null;
  pythonPackages: Record<string, boolean>;
  localModelsRoot: string;
  searchRoots: string[];
  geminiKeyConfigured: boolean;
}

export interface LocalLlmDiscovery {
  id: string;
  label: string;
  providerType: 'ollama' | 'openai_compatible';
  baseUrl: string;
  online: boolean;
  models: string[];
  error?: string;
}

export interface VramPolicyConfig {
  singleModelOnly: boolean;
  restorePreviousModel: boolean;
  refreshAfterMultiModel: boolean;
  gpuMemoryLimitPercent: number;
  minFreeVramMb: number;
  idleUnloadSeconds: number;
  unloadOnExit: boolean;
}

export interface ActiveLoadedModelInfo {
  slotId: ModelSlotId;
  adapter: ResolvedAdapter;
  modelKey: string;
  modelLabel: string;
  modelPath?: string;
  endpointUrl?: string;
  loadedAt: number;
  lastUsedAt: number;
}

export interface GpuHardwareInfo {
  available: boolean;
  name: string | null;
  vramFreeMb: number | null;
  vramTotalMb: number | null;
}

export interface VramStatus {
  policy: VramPolicyConfig;
  activeLoadedModel: ActiveLoadedModelInfo | null;
  suspendedModel: ActiveLoadedModelInfo | null;
  activePipelineName: string | null;
  idleSecondsRemaining: number | null;
  ollamaLoadedModels: Array<{ baseUrl: string; name: string; sizeVramBytes?: number }>;
  pythonWorkerRunning: boolean;
  lastUnloadReport: {
    timestamp: number;
    reason: string;
    unloaded: string[];
  } | null;
  gpuInfo: GpuHardwareInfo;
}

export interface LlmPromptContext {
  systemPrompt: string;
  userPrompt: string;
  expectJson?: boolean;
  temperature?: number;
}

export interface DispatchOptions<T> {
  slotId: ModelSlotId;
  payload: Record<string, any>;
  llmPrompt?: LlmPromptContext;
  fallback: () => Promise<T>;
}

const WEIGHT_EXTENSIONS = ['.gguf', '.safetensors', '.pt', '.pth', '.onnx', '.bin', '.ckpt', '.h5', '.pkl'];
const IGNORED_FILES = new Set(['adapter.example.py', 'model.config.json', 'requirements.txt', 'local_engine.py', 'registry.json', 'runner.ts', 'README.md']);

const DEFAULT_VRAM_POLICY: VramPolicyConfig = {
  singleModelOnly: true,
  restorePreviousModel: true,
  refreshAfterMultiModel: true,
  gpuMemoryLimitPercent: 80,
  minFreeVramMb: 1024,
  idleUnloadSeconds: 60,
  unloadOnExit: true,
};

function sanitizePathInput(p: string): string {
  let s = (p || '').trim();
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

export function resolvePythonExecutable(): string {
  const winVenv = path.join(process.cwd(), '.venv', 'Scripts', 'python.exe');
  if (fs.existsSync(winVenv)) return winVenv;
  const unixVenv = path.join(process.cwd(), '.venv', 'bin', 'python');
  if (fs.existsSync(unixVenv)) return unixVenv;
  if (process.env.PYTHON_BIN && process.env.PYTHON_BIN.trim()) {
    return process.env.PYTHON_BIN.trim();
  }
  return process.platform === 'win32' ? 'python' : 'python3';
}

function getRegistryPath(): string {
  return path.join(process.cwd(), 'models', 'registry.json');
}

function getManifestPath(): string {
  return path.join(process.cwd(), 'models', 'backends_manifest.json');
}

export function getBackendsManifest(): any {
  try {
    const mp = getManifestPath();
    if (fs.existsSync(mp)) {
      return JSON.parse(fs.readFileSync(mp, 'utf-8'));
    }
  } catch {
    // ignore
  }
  return {
    version: '1.4.0',
    defaultSearchRoots: ['D:\\AI\\LMStudio-Models\\local', 'E:\\OmniVoice'],
    backends: [],
    slotRecommendations: {},
  };
}

function readRegistryFile(): {
  version?: string;
  description?: string;
  localModelsRoot?: string;
  searchRoots?: string[];
  vramPolicy?: Partial<VramPolicyConfig>;
  models: Record<ModelSlotId, ModelRegistryEntry>;
} {
  const regPath = getRegistryPath();
  const raw = fs.readFileSync(regPath, 'utf-8');
  return JSON.parse(raw);
}

export function getVramPolicy(): VramPolicyConfig {
  try {
    const parsed = readRegistryFile();
    const vp = parsed.vramPolicy || {};
    const idleSec = Number(vp.idleUnloadSeconds);
    const gpuPct = Number(vp.gpuMemoryLimitPercent);
    const minFree = Number(vp.minFreeVramMb);
    return {
      singleModelOnly:
        vp.singleModelOnly !== undefined ? Boolean(vp.singleModelOnly) : DEFAULT_VRAM_POLICY.singleModelOnly,
      restorePreviousModel:
        vp.restorePreviousModel !== undefined
          ? Boolean(vp.restorePreviousModel)
          : DEFAULT_VRAM_POLICY.restorePreviousModel,
      refreshAfterMultiModel:
        vp.refreshAfterMultiModel !== undefined
          ? Boolean(vp.refreshAfterMultiModel)
          : DEFAULT_VRAM_POLICY.refreshAfterMultiModel,
      gpuMemoryLimitPercent:
        Number.isFinite(gpuPct) && gpuPct >= 50 && gpuPct <= 98
          ? Math.round(gpuPct)
          : DEFAULT_VRAM_POLICY.gpuMemoryLimitPercent,
      minFreeVramMb:
        Number.isFinite(minFree) && minFree >= 256 && minFree <= 16384
          ? Math.round(minFree)
          : DEFAULT_VRAM_POLICY.minFreeVramMb,
      idleUnloadSeconds:
        Number.isFinite(idleSec) && idleSec >= 0
          ? Math.min(3600, Math.round(idleSec))
          : DEFAULT_VRAM_POLICY.idleUnloadSeconds,
      unloadOnExit:
        vp.unloadOnExit !== undefined ? Boolean(vp.unloadOnExit) : DEFAULT_VRAM_POLICY.unloadOnExit,
    };
  } catch {
    return { ...DEFAULT_VRAM_POLICY };
  }
}

export function updateVramPolicy(updates: Partial<VramPolicyConfig>): VramPolicyConfig {
  const regPath = getRegistryPath();
  const parsed = readRegistryFile();
  const current = getVramPolicy();
  const nextIdle =
    updates.idleUnloadSeconds !== undefined && Number.isFinite(Number(updates.idleUnloadSeconds))
      ? Math.max(0, Math.min(3600, Math.round(Number(updates.idleUnloadSeconds))))
      : current.idleUnloadSeconds;
  const nextGpuPct =
    updates.gpuMemoryLimitPercent !== undefined && Number.isFinite(Number(updates.gpuMemoryLimitPercent))
      ? Math.max(50, Math.min(98, Math.round(Number(updates.gpuMemoryLimitPercent))))
      : current.gpuMemoryLimitPercent;
  const nextMinFree =
    updates.minFreeVramMb !== undefined && Number.isFinite(Number(updates.minFreeVramMb))
      ? Math.max(256, Math.min(16384, Math.round(Number(updates.minFreeVramMb))))
      : current.minFreeVramMb;

  const nextPolicy: VramPolicyConfig = {
    singleModelOnly:
      typeof updates.singleModelOnly === 'boolean' ? updates.singleModelOnly : current.singleModelOnly,
    restorePreviousModel:
      typeof updates.restorePreviousModel === 'boolean'
        ? updates.restorePreviousModel
        : current.restorePreviousModel,
    refreshAfterMultiModel:
      typeof updates.refreshAfterMultiModel === 'boolean'
        ? updates.refreshAfterMultiModel
        : current.refreshAfterMultiModel,
    gpuMemoryLimitPercent: nextGpuPct,
    minFreeVramMb: nextMinFree,
    idleUnloadSeconds: nextIdle,
    unloadOnExit:
      typeof updates.unloadOnExit === 'boolean' ? updates.unloadOnExit : current.unloadOnExit,
  };

  parsed.vramPolicy = nextPolicy;
  fs.writeFileSync(regPath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
  return nextPolicy;
}

export function getLocalModelsRoot(): string {
  const parsed = readRegistryFile();
  return sanitizePathInput(parsed.localModelsRoot || '');
}

export function getSearchRoots(): string[] {
  const parsed = readRegistryFile();
  const manifest = getBackendsManifest();
  const roots = new Set<string>();
  const primary = sanitizePathInput(parsed.localModelsRoot || '');
  if (primary) roots.add(primary);
  const configured = Array.isArray(parsed.searchRoots)
    ? parsed.searchRoots
    : Array.isArray(manifest.defaultSearchRoots)
    ? manifest.defaultSearchRoots
    : [];
  for (const r of configured) {
    const clean = sanitizePathInput(String(r || ''));
    if (clean) roots.add(clean);
  }
  return Array.from(roots);
}

export function setSearchRoots(roots: string[]): {
  searchRoots: string[];
  catalog: LocalDiskModel[];
  models: ModelSlotStatus[];
  machine: MachineEnvironment;
} {
  const cleaned = Array.from(
    new Set(
      roots
        .map((r) => sanitizePathInput(String(r || '')))
        .filter(Boolean)
    )
  );
  const regPath = getRegistryPath();
  const parsed = readRegistryFile();
  parsed.searchRoots = cleaned;
  if (cleaned.length > 0 && !sanitizePathInput(parsed.localModelsRoot || '')) {
    parsed.localModelsRoot = cleaned[0];
  }
  fs.writeFileSync(regPath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
  const catalog = collectAllRootModels(cleaned);
  return {
    searchRoots: cleaned,
    catalog,
    models: getAllModelsStatus(),
    machine: getMachineEnvironment(),
  };
}

export interface PartitionScanSummary {
  scannedAt: number;
  scannedPartitions: string[];
  discoveredRoots: string[];
  discoveredCount: number;
}

const KNOWN_AI_ROOT_SUBDIRS = [
  'models',
  'Models',
  path.join('models', 'local'),
  'AI',
  path.join('AI', 'Models'),
  path.join('AI', 'LMStudio-Models'),
  path.join('AI', 'LMStudio-Models', 'local'),
  'LMStudio',
  'LMStudio-Models',
  path.join('LMStudio-Models', 'local'),
  'LM-Studio',
  path.join('LM-Studio', 'models'),
  'LocalModels',
  'LLM',
  'LLMs',
  'HuggingFace',
  'OmniVoice',
  path.join('OmniVoice', 'models'),
  path.join('ComfyUI', 'models'),
];

const KNOWN_MODEL_KEYWORDS = [
  'namaa-space',
  'cohere-speech-tashkeel',
  'cohere-transcribe',
  'faster-whisper',
  'mobiuslabsgmbh',
  'qwencleo',
  'qwen3-asr',
  'moss-transcribe',
  'omnivoice',
  'voicetut',
  'nile-chat',
  'qwen3.5',
  'qwen3-8b',
  'qwen3-4b',
  'qwen3.8',
  'qwen2.5',
  'gemma-4',
  'gpt-oss',
  'llama-3.2',
  'yue2',
  'xtts',
  'piper',
  'seed-vc',
  'lmstudio-models',
  'huggingface',
  'localmodels',
];

const PARTITION_SKIP_DIRS = new Set([
  'windows',
  '$recycle.bin',
  '$windows.~bt',
  'system volume information',
  'program files',
  'program files (x86)',
  'programdata',
  'recovery',
  'perflogs',
  'msocache',
  'appdata',
  'node_modules',
  '.git',
  '__pycache__',
  '.venv',
  'venv',
  'blobs',
  'refs',
  '.no_exist',
  'xet',
  'boot',
  'intel',
  'amd',
  'nvidia',
  'tmp',
  'temp',
]);

let lastPartitionScan: PartitionScanSummary | null = null;
let cachedPartitionModels: { timestamp: number; roots: string[]; models: LocalDiskModel[]; partitions: string[] } | null = null;

export function getLastPartitionScanSummary(): PartitionScanSummary | null {
  return lastPartitionScan;
}

export function getMountedPartitions(): string[] {
  const partitions: string[] = [];
  const seen = new Set<string>();
  const addPart = (p: string) => {
    const clean = (p || '').trim();
    if (!clean) return;
    const key = process.platform === 'win32' ? clean.toLowerCase() : clean;
    if (!seen.has(key)) {
      seen.add(key);
      partitions.push(clean);
    }
  };

  if (process.env.HAFIZ_EXTRA_SCAN_ROOTS) {
    for (const seg of process.env.HAFIZ_EXTRA_SCAN_ROOTS.split(path.delimiter)) {
      const clean = sanitizePathInput(seg);
      if (clean && fs.existsSync(clean)) addPart(clean);
    }
  }

  if (process.platform === 'win32') {
    const appDrive = path.parse(process.cwd()).root;
    if (appDrive && fs.existsSync(appDrive)) addPart(appDrive);
    for (let code = 67; code <= 90; code++) {
      // C:\ through Z:\
      const drive = `${String.fromCharCode(code)}:\\`;
      try {
        if (fs.existsSync(drive)) addPart(drive);
      } catch {
        // ignore unready drives
      }
    }
  } else {
    const home = os.homedir();
    if (home && fs.existsSync(home)) addPart(home);
    addPart(process.cwd());
  }

  return partitions;
}

export function discoverPartitionModelRoots(options?: {
  force?: boolean;
  timeBudgetMs?: number;
}): {
  scannedPartitions: string[];
  discoveredRoots: string[];
  discoveredModels: LocalDiskModel[];
} {
  if (
    !options?.force &&
    cachedPartitionModels &&
    Date.now() - cachedPartitionModels.timestamp < 2 * 60 * 1000
  ) {
    return {
      scannedPartitions: cachedPartitionModels.partitions,
      discoveredRoots: cachedPartitionModels.roots,
      discoveredModels: cachedPartitionModels.models,
    };
  }

  const startMs = Date.now();
  const timeBudgetMs = options?.timeBudgetMs ?? 4500;
  const partitions = getMountedPartitions();
  const candidateRoots: string[] = [];
  const seenRoots = new Set<string>();

  const addCandidateRoot = (dirPath: string) => {
    const clean = sanitizePathInput(dirPath);
    if (!clean) return;
    const key = process.platform === 'win32' ? clean.toLowerCase() : clean;
    if (seenRoots.has(key)) return;
    try {
      if (fs.existsSync(clean) && fs.statSync(clean).isDirectory()) {
        seenRoots.add(key);
        candidateRoots.push(clean);
      }
    } catch {
      // ignore permission errors
    }
  };

  // 1. User home AI stores (.lmstudio, .cache/huggingface, .ollama, Documents)
  const home = os.homedir();
  if (home) {
    addCandidateRoot(path.join(home, '.lmstudio', 'models'));
    addCandidateRoot(path.join(home, '.cache', 'huggingface', 'hub'));
    addCandidateRoot(path.join(home, '.ollama', 'models'));
    addCandidateRoot(path.join(home, 'Documents', 'LM Studio', 'models'));
    addCandidateRoot(path.join(home, 'Models'));
    addCandidateRoot(path.join(home, 'AI'));
  }

  // 2. App's own models folder + known AI locations across EVERY mounted partition (C:\, D:\, E:\, ...)
  addCandidateRoot(path.join(process.cwd(), 'models', 'local'));
  for (const part of partitions) {
    for (const sub of KNOWN_AI_ROOT_SUBDIRS) {
      addCandidateRoot(path.join(part, sub));
    }
  }

  // 3. Targeted fast partition walk (depth <= 3) to catch models dropped anywhere on C:, D:, E:, F:...
  const modelDirMatches: LocalDiskModel[] = [];
  const seenModelPaths = new Set<string>();
  const pushModel = (m: LocalDiskModel) => {
    const key = process.platform === 'win32' ? m.path.toLowerCase() : m.path;
    if (!seenModelPaths.has(key)) {
      seenModelPaths.add(key);
      modelDirMatches.push(m);
    }
  };

  const quickPartitionCrawl = (dir: string, depth: number) => {
    if (Date.now() - startMs > timeBudgetMs) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (Date.now() - startMs > timeBudgetMs) return;
      if (!entry.isDirectory()) continue;
      const lower = entry.name.toLowerCase();
      if (lower.startsWith('.') || lower.startsWith('$') || PARTITION_SKIP_DIRS.has(lower)) continue;

      const full = path.join(dir, entry.name);
      const isKnownKeyword = KNOWN_MODEL_KEYWORDS.some((kw) => lower.includes(kw));

      if (isKnownKeyword) {
        addCandidateRoot(full);
        const dirKind = classifyModelDirKind(full);
        if (dirKind) {
          const sizeBytes = getDirTotalSize(full);
          pushModel({
            id: full,
            name: entry.name,
            path: full,
            relativePath: full,
            kind: dirKind,
            sizeBytes,
            sizeLabel: formatBytes(sizeBytes),
            source: 'models_root',
          });
        } else {
          for (const found of scanDirectoryForModels(full, 'models_root', 4)) {
            pushModel(found);
          }
        }
        continue;
      }

      if (depth < 3) {
        quickPartitionCrawl(full, depth + 1);
      }
    }
  };

  for (const part of partitions) {
    if (Date.now() - startMs > timeBudgetMs) break;
    quickPartitionCrawl(part, 0);
  }

  // 4. Deep-scan all confirmed AI candidate roots
  for (const rootDir of candidateRoots) {
    const selfKind = classifyModelDirKind(rootDir);
    if (selfKind) {
      const sizeBytes = getDirTotalSize(rootDir);
      pushModel({
        id: rootDir,
        name: path.basename(rootDir),
        path: rootDir,
        relativePath: rootDir,
        kind: selfKind,
        sizeBytes,
        sizeLabel: formatBytes(sizeBytes),
        source: 'models_root',
      });
    }
    for (const m of scanDirectoryForModels(rootDir, 'models_root', 5)) {
      pushModel(m);
    }
  }

  // Filter discoveredRoots down to those that actually contain at least one discovered model (plus existing searchRoots)
  const populatedRoots = new Set<string>();
  for (const rootDir of candidateRoots) {
    const rootLower = process.platform === 'win32' ? rootDir.toLowerCase() : rootDir;
    if (
      modelDirMatches.some((m) => {
        const mp = process.platform === 'win32' ? m.path.toLowerCase() : m.path;
        return mp === rootLower || mp.startsWith(rootLower + path.sep);
      })
    ) {
      populatedRoots.add(rootDir);
    }
  }

  const rootsList = Array.from(populatedRoots);
  cachedPartitionModels = {
    timestamp: Date.now(),
    roots: rootsList,
    models: modelDirMatches,
    partitions,
  };
  lastPartitionScan = {
    scannedAt: cachedPartitionModels.timestamp,
    scannedPartitions: partitions,
    discoveredRoots: rootsList,
    discoveredCount: modelDirMatches.length,
  };

  return {
    scannedPartitions: partitions,
    discoveredRoots: rootsList,
    discoveredModels: modelDirMatches,
  };
}

function collectAllRootModels(roots: string[], includePartitions = false): LocalDiskModel[] {
  const seen = new Set<string>();
  const all: LocalDiskModel[] = [];
  for (const r of roots) {
    const clean = sanitizePathInput(r);
    if (!clean) continue;
    const resolved = path.isAbsolute(clean) ? clean : path.resolve(process.cwd(), clean);
    if (!fs.existsSync(resolved)) continue;
    const selfKind = classifyModelDirKind(resolved);
    if (selfKind) {
      const sizeBytes = getDirTotalSize(resolved);
      if (!seen.has(resolved)) {
        seen.add(resolved);
        all.push({
          id: resolved,
          name: path.basename(resolved),
          path: resolved,
          relativePath: resolved,
          kind: selfKind,
          sizeBytes,
          sizeLabel: formatBytes(sizeBytes),
          source: 'models_root',
        });
      }
    }
    for (const m of scanDirectoryForModels(resolved, 'models_root', 5)) {
      if (!seen.has(m.path)) {
        seen.add(m.path);
        all.push(m);
      }
    }
  }

  if (includePartitions || all.length === 0) {
    const partScan = discoverPartitionModelRoots();
    for (const m of partScan.discoveredModels) {
      if (!seen.has(m.path)) {
        seen.add(m.path);
        all.push(m);
      }
    }
  }

  return all;
}

export function loadModelRegistry(): Record<ModelSlotId, ModelRegistryEntry> {
  return readRegistryFile().models;
}

export function setLocalModelsRoot(rootPath: string): {
  localModelsRoot: string;
  searchRoots: string[];
  catalog: LocalDiskModel[];
  models: ModelSlotStatus[];
  machine: MachineEnvironment;
} {
  const trimmed = sanitizePathInput(rootPath);
  let resolved = '';
  if (trimmed) {
    resolved = path.isAbsolute(trimmed) ? trimmed : path.resolve(process.cwd(), trimmed);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error(`المجلد غير موجود على الجهاز: ${resolved}`);
    }
  }

  const regPath = getRegistryPath();
  const parsed = readRegistryFile();
  parsed.localModelsRoot = trimmed ? resolved : '';
  const currentRoots = Array.isArray(parsed.searchRoots) ? parsed.searchRoots.map(sanitizePathInput).filter(Boolean) : [];
  if (resolved && !currentRoots.includes(resolved)) {
    currentRoots.unshift(resolved);
  }
  parsed.searchRoots = currentRoots;
  fs.writeFileSync(regPath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');

  const catalog = collectAllRootModels(getSearchRoots());
  return {
    localModelsRoot: parsed.localModelsRoot || '',
    searchRoots: parsed.searchRoots,
    catalog,
    models: getAllModelsStatus(),
    machine: getMachineEnvironment(),
  };
}

export function updateModelSlotConfig(
  slotId: ModelSlotId,
  updates: {
    internetAccess?: boolean;
    endpointUrl?: string;
    providerType?: ProviderType;
    modelName?: string;
    selectedModelPath?: string;
    apiKey?: string;
    strictLocal?: boolean;
  }
): ModelSlotStatus {
  const regPath = getRegistryPath();
  const parsed = readRegistryFile();

  if (!parsed.models || !parsed.models[slotId]) {
    throw new Error(`Unknown model slot: ${slotId}`);
  }

  const slot = parsed.models[slotId];
  if (typeof updates.internetAccess === 'boolean') {
    slot.internetAccess = updates.internetAccess;
  }
  if (typeof updates.endpointUrl === 'string') {
    slot.endpointUrl = updates.endpointUrl.trim();
  }
  if (typeof updates.providerType === 'string') {
    slot.providerType = updates.providerType;
  }
  if (typeof updates.modelName === 'string') {
    slot.modelName = updates.modelName.trim();
  }
  if (typeof updates.selectedModelPath === 'string') {
    slot.selectedModelPath = sanitizePathInput(updates.selectedModelPath);
    if (slot.selectedModelPath && (!slot.providerType || slot.providerType === 'auto')) {
      slot.providerType = slot.selectedModelPath.toLowerCase().endsWith('.py') ? 'python_cli' : 'local_disk';
    }
  }
  if (typeof updates.apiKey === 'string') {
    slot.apiKey = updates.apiKey.trim();
  }
  if (typeof updates.strictLocal === 'boolean') {
    slot.strictLocal = updates.strictLocal;
  }

  fs.writeFileSync(regPath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
  return resolveModelSlotStatus(slot, undefined, undefined, undefined, parsed.models);
}

export function applyLocalLlmPreset(config: {
  providerType: 'ollama' | 'openai_compatible';
  endpointUrl: string;
  modelName: string;
  apiKey?: string;
  strictLocal?: boolean;
  slotIds?: ModelSlotId[];
}): ModelSlotStatus[] {
  const regPath = getRegistryPath();
  const raw = fs.readFileSync(regPath, 'utf-8');
  const parsed = JSON.parse(raw);

  const entries = Object.values(parsed.models) as ModelRegistryEntry[];
  for (const entry of entries) {
    const shouldApply =
      Array.isArray(config.slotIds) && config.slotIds.length > 0
        ? config.slotIds.includes(entry.id)
        : Boolean(entry.supportsLocalLlm);

    if (shouldApply) {
      entry.providerType = config.providerType;
      entry.endpointUrl = config.endpointUrl.trim();
      entry.modelName = config.modelName.trim();
      if (typeof config.apiKey === 'string') {
        entry.apiKey = config.apiKey.trim();
      }
      if (typeof config.strictLocal === 'boolean') {
        entry.strictLocal = config.strictLocal;
      }
    }
  }

  fs.writeFileSync(regPath, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
  return Object.values(parsed.models as Record<ModelSlotId, ModelRegistryEntry>).map((entry) =>
    resolveModelSlotStatus(entry, undefined, undefined, undefined, parsed.models)
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${bytes} B`;
}

function getDirTotalSize(dirPath: string): number {
  let total = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dirPath, entry.name);
      if (entry.isFile()) {
        total += fs.statSync(full).size;
      } else if (entry.isDirectory()) {
        total += getDirTotalSize(full);
      }
    }
  } catch {
    // ignore permission errors
  }
  return total;
}

function classifyModelFileKind(fileName: string): LocalDiskModel['kind'] {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.gguf')) return 'gguf';
  if (lower.endsWith('.onnx')) return 'onnx';
  if (lower.endsWith('.pt') || lower.endsWith('.pth')) return 'pytorch';
  if (lower.endsWith('.py')) return 'python_script';
  return 'weight_file';
}

function classifyModelDirKind(dirPath: string): LocalDiskModel['kind'] | null {
  try {
    const files = fs.readdirSync(dirPath).map((f) => f.toLowerCase());
    const fullLower = dirPath.toLowerCase();
    if (
      fullLower.includes('omnivoice') &&
      files.some((f) => f.endsWith('.safetensors') || f.endsWith('.bin') || f.endsWith('.pt'))
    ) {
      return 'coqui_xtts';
    }
    if (files.includes('speakers_xtts.pth') || (fullLower.includes('xtts') && files.includes('config.json'))) {
      return 'coqui_xtts';
    }
    if (files.includes('model.bin') && (files.includes('vocabulary.json') || files.includes('vocabulary.txt') || fullLower.includes('whisper'))) {
      return 'ct2_whisper';
    }
    if (files.includes('config.json') && files.some((f) => f.endsWith('.safetensors') || f.endsWith('.bin') || f.endsWith('.pt') || f === 'tokenizer.json')) {
      return 'hf_dir';
    }
    if (files.includes('config.json')) {
      return 'hf_dir';
    }
  } catch {
    // ignore
  }
  return null;
}

const SLOT_SUBFOLDER_NAMES = new Set([
  'asr-diacritics',
  'tts-reader',
  'smart-studio',
  'rhyme-rewrite',
  'prompt-generator',
  'diacritics-search',
  'web-agent',
  'voice-clone',
  'scripts',
]);

const SKIP_SCAN_DIRS = new Set(['.git', '__pycache__', 'node_modules', 'blobs', 'refs', '.no_exist', 'xet']);

export function scanDirectoryForModels(
  baseDir: string,
  source: LocalDiskModel['source'],
  maxDepth = 4,
  skipSlotSubfolders = false
): LocalDiskModel[] {
  if (!fs.existsSync(baseDir)) return [];
  const results: LocalDiskModel[] = [];

  const walk = (dir: string, depth: number) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (IGNORED_FILES.has(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);
      const rel = path.relative(process.cwd(), fullPath) || fullPath;

      if (entry.isDirectory()) {
        if (SKIP_SCAN_DIRS.has(entry.name)) continue;
        if (skipSlotSubfolders && depth === 0 && SLOT_SUBFOLDER_NAMES.has(entry.name)) {
          continue;
        }
        const dirKind = classifyModelDirKind(fullPath);
        if (dirKind) {
          const sizeBytes = getDirTotalSize(fullPath);
          const parentName = path.basename(path.dirname(fullPath));
          const grandParentName = path.basename(path.dirname(path.dirname(fullPath)));
          const displayName =
            parentName === 'snapshots' && grandParentName.startsWith('models--')
              ? grandParentName.replace(/^models--/, '').replace(/--/g, '/')
              : entry.name;
          results.push({
            id: fullPath,
            name: displayName,
            path: fullPath,
            relativePath: rel,
            kind: dirKind,
            sizeBytes,
            sizeLabel: formatBytes(sizeBytes),
            source,
          });
          continue; // Do not descend into internal shards of a packaged model folder
        }
        if (depth < maxDepth) {
          walk(fullPath, depth + 1);
        }
      } else if (entry.isFile()) {
        const lower = entry.name.toLowerCase();
        const isWeight = WEIGHT_EXTENSIONS.some((ext) => lower.endsWith(ext));
        const isRunnerScript = lower === 'predict.py' || lower === 'infer.py' || lower === 'synthesize.py';
        if (isWeight || isRunnerScript) {
          const sizeBytes = fs.statSync(fullPath).size;
          results.push({
            id: fullPath,
            name: entry.name,
            path: fullPath,
            relativePath: rel,
            kind: classifyModelFileKind(entry.name),
            sizeBytes,
            sizeLabel: formatBytes(sizeBytes),
            source,
          });
        }
      }
    }
  };

  walk(baseDir, 0);
  return results;
}

function listFolderFiles(folderRel: string): string[] {
  const abs = path.join(process.cwd(), folderRel);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs)
    .filter((f) => !f.startsWith('.') && !IGNORED_FILES.has(f));
}

function inferAdapterFromEndpoint(endpoint: string, supportsLocalLlm: boolean): ResolvedAdapter {
  const lower = endpoint.toLowerCase();
  if (lower.includes('/audio/transcriptions') || lower.includes('/audio/speech')) {
    return 'openai_audio';
  }
  if ((lower.includes('11434') && !lower.includes('/v1')) || lower.endsWith('/api/chat')) {
    return 'ollama';
  }
  if (
    lower.endsWith('/v1') ||
    lower.includes('/v1/chat/completions') ||
    lower.includes('/chat/completions') ||
    (supportsLocalLlm && Boolean(process.env.LOCAL_LLM_URL) && endpoint === process.env.LOCAL_LLM_URL)
  ) {
    return 'openai_compatible';
  }
  return 'http';
}

function resolveDiskPath(p: string): string {
  const trimmed = sanitizePathInput(p);
  if (!trimmed) return '';
  return path.isAbsolute(trimmed) ? trimmed : path.resolve(process.cwd(), trimmed);
}

function resolveDirectModelSlotStatus(
  entry: ModelRegistryEntry,
  cachedLocalRoot?: string,
  cachedRootModels?: LocalDiskModel[],
  cachedSharedModels?: LocalDiskModel[]
): ModelSlotStatus {
  const envEndpoint = entry.envVar ? process.env[entry.envVar] : undefined;
  const globalLlmUrl = entry.supportsLocalLlm ? process.env.LOCAL_LLM_URL : undefined;
  const endpoint = (envEndpoint || entry.endpointUrl || globalLlmUrl || '').trim();

  const globalModel = entry.supportsLocalLlm ? process.env.LOCAL_LLM_MODEL : undefined;
  const modelName = (entry.modelName || globalModel || '').trim();

  const scriptAbs = path.join(process.cwd(), entry.scriptPath);
  const scriptExists = fs.existsSync(scriptAbs);
  const detectedFiles = listFolderFiles(entry.folder);

  // Scan local weights/folders inside slot folder + shared models/ + all fixed/configured searchRoots
  const slotFolderAbs = path.join(process.cwd(), entry.folder);
  const slotModels = scanDirectoryForModels(slotFolderAbs, 'slot_folder', 3);
  const rootModels =
    cachedRootModels !== undefined
      ? cachedRootModels
      : collectAllRootModels(cachedLocalRoot ? [cachedLocalRoot, ...getSearchRoots()] : getSearchRoots());
  const sharedModels =
    cachedSharedModels !== undefined
      ? cachedSharedModels
      : scanDirectoryForModels(path.join(process.cwd(), 'models'), 'models_shared', 5, true);

  const seenPaths = new Set<string>();
  const availableLocalModels: LocalDiskModel[] = [];
  for (const m of [...slotModels, ...sharedModels, ...rootModels]) {
    if (!seenPaths.has(m.path)) {
      seenPaths.add(m.path);
      availableLocalModels.push(m);
    }
  }

  const selectedModelPath = sanitizePathInput(entry.selectedModelPath || '');
  const selectedAbs = selectedModelPath ? resolveDiskPath(selectedModelPath) : '';
  const selectedExists = Boolean(selectedAbs && fs.existsSync(selectedAbs));
  const autoSlotWeight = slotModels.find((m) => m.kind !== 'python_script');

  const requestedProvider: ProviderType = entry.providerType || 'auto';
  let activeAdapter: ResolvedAdapter = 'fallback_ai';

  if (requestedProvider === 'fallback_ai') {
    activeAdapter = 'fallback_ai';
  } else if (requestedProvider === 'local_disk') {
    if (selectedExists && selectedAbs.toLowerCase().endsWith('.py')) {
      activeAdapter = 'python_cli';
    } else if (selectedExists || autoSlotWeight) {
      activeAdapter = 'local_disk';
    } else {
      activeAdapter = 'fallback_ai';
    }
  } else if (requestedProvider === 'python_cli') {
    activeAdapter = (selectedExists && selectedAbs.toLowerCase().endsWith('.py')) || scriptExists ? 'python_cli' : 'fallback_ai';
  } else if (requestedProvider === 'ollama') {
    activeAdapter = endpoint ? 'ollama' : 'fallback_ai';
  } else if (requestedProvider === 'openai_compatible') {
    activeAdapter = endpoint ? 'openai_compatible' : 'fallback_ai';
  } else if (requestedProvider === 'openai_audio') {
    activeAdapter = endpoint ? 'openai_audio' : 'fallback_ai';
  } else if (requestedProvider === 'http_custom') {
    activeAdapter = endpoint ? 'http' : 'fallback_ai';
  } else {
    // auto resolution: prioritize explicitly selected local disk model, then endpoint, then slot script, then dropped weights in slot folder
    if (selectedExists) {
      activeAdapter = selectedAbs.toLowerCase().endsWith('.py') ? 'python_cli' : 'local_disk';
    } else if (endpoint) {
      activeAdapter = inferAdapterFromEndpoint(endpoint, Boolean(entry.supportsLocalLlm));
    } else if (scriptExists) {
      activeAdapter = 'python_cli';
    } else if (autoSlotWeight) {
      activeAdapter = 'local_disk';
    } else {
      activeAdapter = 'fallback_ai';
    }
  }

  const effectiveModelPath =
    activeAdapter === 'local_disk'
      ? selectedModelPath || autoSlotWeight?.path || ''
      : activeAdapter === 'python_cli'
      ? selectedModelPath && selectedModelPath.toLowerCase().endsWith('.py')
        ? selectedModelPath
        : entry.scriptPath
      : '';

  const effectiveModelLabel =
    activeAdapter === 'local_disk'
      ? path.basename(effectiveModelPath || 'local')
      : activeAdapter === 'python_cli'
      ? path.basename(effectiveModelPath || entry.scriptPath)
      : modelName || (endpoint ? activeAdapter : '');

  return {
    id: entry.id,
    nameAr: entry.nameAr,
    nameEn: entry.nameEn,
    roleAr: entry.roleAr || '',
    roleEn: entry.roleEn || '',
    folder: entry.folder,
    apiEndpoint: entry.apiEndpoint || '',
    providerType: requestedProvider,
    activeAdapter,
    configuredEndpoint: endpoint || null,
    modelName,
    selectedModelPath,
    availableLocalModels,
    hasApiKey: Boolean((entry.apiKey || '').trim()),
    strictLocal: Boolean(entry.strictLocal),
    supportsLocalLlm: Boolean(entry.supportsLocalLlm),
    scriptDetected: scriptExists,
    detectedFiles,
    helperScript: entry.helperScript,
    supportsInternet: Boolean(entry.supportsInternet),
    internetAccess: entry.supportsInternet ? entry.internetAccess !== false : Boolean(entry.internetAccess),
    inheritedFrom: null,
    effectiveModelPath,
    effectiveModelLabel,
    readyForCustomModel: true,
  };
}

export function resolveModelSlotStatus(
  entry: ModelRegistryEntry,
  cachedLocalRoot?: string,
  cachedRootModels?: LocalDiskModel[],
  cachedSharedModels?: LocalDiskModel[],
  registryModels?: Record<string, ModelRegistryEntry>
): ModelSlotStatus {
  const direct = resolveDirectModelSlotStatus(
    entry,
    cachedLocalRoot,
    cachedRootModels,
    cachedSharedModels
  );

  // Unified Smart Model ownership:
  // If diacritics_search ("هات تشكيل") or prompt_generator ("برومبتات") has no standalone override,
  // automatically delegate to the user's configured Smart Studio model (`smart_studio`).
  if (
    (entry.id === 'diacritics_search' || entry.id === 'prompt_generator') &&
    entry.providerType !== 'fallback_ai' &&
    direct.activeAdapter === 'fallback_ai'
  ) {
    const modelsMap = registryModels || loadModelRegistry();
    const smartEntry = modelsMap.smart_studio;
    if (smartEntry) {
      const smartDirect = resolveDirectModelSlotStatus(
        smartEntry,
        cachedLocalRoot,
        cachedRootModels,
        cachedSharedModels
      );
      if (smartDirect.activeAdapter !== 'fallback_ai') {
        return {
          ...direct,
          activeAdapter: smartDirect.activeAdapter,
          configuredEndpoint: smartDirect.configuredEndpoint,
          modelName: smartDirect.modelName,
          hasApiKey: smartDirect.hasApiKey,
          strictLocal: smartDirect.strictLocal,
          internetAccess: smartDirect.internetAccess && direct.internetAccess,
          inheritedFrom: 'smart_studio',
          effectiveModelPath: smartDirect.effectiveModelPath,
          effectiveModelLabel: smartDirect.effectiveModelLabel,
        };
      }
      return {
        ...direct,
        internetAccess: smartDirect.internetAccess && direct.internetAccess,
        inheritedFrom: 'smart_studio',
      };
    }
  }

  return direct;
}

export function getAllModelsStatus(): ModelSlotStatus[] {
  const parsed = readRegistryFile();
  const roots = getSearchRoots();
  const rootModels = collectAllRootModels(roots, true);
  const sharedModels = scanDirectoryForModels(path.join(process.cwd(), 'models'), 'models_shared', 5, true);

  // If any primary slot is still unbound and models were dropped into ./models/ or any partition, auto-bind them silently
  const primarySlots: ModelSlotId[] = [
    'asr_diacritics',
    'tts_reader',
    'smart_studio',
    'rhyme_rewrite',
    'web_lyrics_agent',
    'voice_clone',
  ];
  const hasUnboundPrimary = primarySlots.some((id) => {
    const e = parsed.models[id];
    if (!e || e.providerType === 'fallback_ai' || (e.endpointUrl || '').trim()) return false;
    const cleaned = sanitizePathInput(e.selectedModelPath || '');
    return !cleaned || !fs.existsSync(resolveDiskPath(cleaned));
  });
  if (hasUnboundPrimary && (sharedModels.length > 0 || rootModels.length > 0)) {
    const res = autoAssignModels({ overwriteExisting: false, fixMismatches: true, scanAllPartitions: true });
    return res.models;
  }

  return Object.values(parsed.models).map((entry) =>
    resolveModelSlotStatus(entry, roots[0] || '', rootModels, sharedModels, parsed.models)
  );
}

export function autoAssignModels(options?: {
  overwriteExisting?: boolean;
  fixMismatches?: boolean;
  scanAllPartitions?: boolean;
}): {
  assigned: Array<{ slotId: ModelSlotId; modelName: string; path: string; reason: string }>;
  models: ModelSlotStatus[];
  discoveredCount: number;
  scannedPartitions: string[];
  discoveredRoots: string[];
} {
  const parsed = readRegistryFile();
  const manifest = getBackendsManifest();
  const recs: Record<string, { preferredPatterns?: string[]; excludePatterns?: string[] }> =
    manifest.slotRecommendations || {};

  let modified = false;
  const doPartitionScan = options?.scanAllPartitions !== false;
  const partScan = doPartitionScan ? discoverPartitionModelRoots({ force: true }) : null;

  // Merge newly discovered active partition roots into registry searchRoots cleanly
  const existingRoots = getSearchRoots();
  const mergedRootsSet = new Set<string>(existingRoots);
  if (partScan) {
    for (const r of partScan.discoveredRoots) {
      mergedRootsSet.add(r);
    }
    const mergedRoots = Array.from(mergedRootsSet);
    if (JSON.stringify(mergedRoots) !== JSON.stringify(parsed.searchRoots || [])) {
      parsed.searchRoots = mergedRoots;
      modified = true;
    }
    const curLocalRoot = sanitizePathInput(parsed.localModelsRoot || '');
    if ((!curLocalRoot || !fs.existsSync(resolveDiskPath(curLocalRoot))) && partScan.discoveredRoots.length > 0) {
      parsed.localModelsRoot = partScan.discoveredRoots[0];
      modified = true;
    }
  }

  const roots = Array.from(mergedRootsSet);
  const rootModels = collectAllRootModels(roots, doPartitionScan);
  const sharedModels = scanDirectoryForModels(path.join(process.cwd(), 'models'), 'models_shared', 5, true);
  const allCatalog: LocalDiskModel[] = [];
  const seen = new Set<string>();
  for (const m of [...sharedModels, ...rootModels, ...(partScan?.discoveredModels || [])]) {
    if (!seen.has(m.path)) {
      seen.add(m.path);
      allCatalog.push(m);
    }
  }

  const assigned: Array<{ slotId: ModelSlotId; modelName: string; path: string; reason: string }> = [];
  const primarySlots: ModelSlotId[] = [
    'asr_diacritics',
    'tts_reader',
    'smart_studio',
    'rhyme_rewrite',
    'web_lyrics_agent',
    'voice_clone',
  ];

  const cwdPrefix = path.resolve(process.cwd()) + path.sep;

  for (const slotId of primarySlots) {
    const entry = parsed.models[slotId];
    if (!entry) continue;
    if (entry.providerType === 'fallback_ai' && !options?.overwriteExisting) continue;

    // Sanitize quotes from existing selectedModelPath first
    const cleanedExisting = sanitizePathInput(entry.selectedModelPath || '');
    if (cleanedExisting !== (entry.selectedModelPath || '')) {
      entry.selectedModelPath = cleanedExisting;
      modified = true;
    }

    const existingExists = Boolean(cleanedExisting && fs.existsSync(resolveDiskPath(cleanedExisting)));
    const rec = recs[slotId] || {};
    const excludes = (rec.excludePatterns || []).map((p) => p.toLowerCase());
    const isMismatched =
      Boolean(options?.fixMismatches) &&
      Boolean(cleanedExisting) &&
      excludes.some((ex) => cleanedExisting.toLowerCase().includes(ex));

    if (existingExists && !options?.overwriteExisting && !isMismatched) {
      continue;
    }

    const slotFolderAbs = path.join(process.cwd(), entry.folder);
    const slotModels = scanDirectoryForModels(slotFolderAbs, 'slot_folder', 4).filter(
      (m) => m.kind !== 'python_script'
    );
    const candidates = [...slotModels, ...allCatalog];
    const preferred = (rec.preferredPatterns || []).map((p) => p.toLowerCase());

    let bestMatch: LocalDiskModel | undefined;
    for (const pat of preferred) {
      const matching = candidates.filter((c) => {
        const hay = `${c.name} ${c.path}`.toLowerCase();
        if (!hay.includes(pat)) return false;
        if (hay.includes('mmproj') || hay.includes('imatrix') || hay.includes('tokenizer')) return false;
        if (excludes.some((ex) => hay.includes(ex))) return false;
        return true;
      });
      if (matching.length > 0) {
        // Prefer local app ./models/ first, otherwise pick largest valid weight file/folder
        matching.sort((a, b) => {
          const aLocal = a.source !== 'models_root' ? 1 : 0;
          const bLocal = b.source !== 'models_root' ? 1 : 0;
          if (aLocal !== bLocal) return bLocal - aLocal;
          return (b.sizeBytes || 0) - (a.sizeBytes || 0);
        });
        bestMatch = matching[0];
        break;
      }
    }

    if (bestMatch) {
      const absMatch = path.resolve(bestMatch.path);
      const storedPath = absMatch.startsWith(cwdPrefix)
        ? path.relative(process.cwd(), absMatch).replace(/\\/g, '/')
        : bestMatch.path;
      entry.selectedModelPath = storedPath;
      entry.providerType = bestMatch.kind === 'python_script' ? 'python_cli' : 'local_disk';
      entry.strictLocal = true;
      modified = true;
      assigned.push({
        slotId,
        modelName: bestMatch.name,
        path: storedPath,
        reason: isMismatched ? 'mismatch_repaired' : 'auto_matched',
      });
    }
  }

  // Inherited smart slots: repair bad paths if requested, otherwise keep inheriting smart_studio
  for (const inheritedSlot of ['diacritics_search', 'prompt_generator'] as ModelSlotId[]) {
    const entry = parsed.models[inheritedSlot];
    if (!entry) continue;
    const cleaned = sanitizePathInput(entry.selectedModelPath || '');
    if (cleaned !== (entry.selectedModelPath || '')) {
      entry.selectedModelPath = cleaned;
      modified = true;
    }
    if (options?.overwriteExisting) {
      entry.selectedModelPath = '';
      entry.providerType = 'auto';
      modified = true;
    }
  }

  if (modified) {
    fs.writeFileSync(getRegistryPath(), JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
  }

  const finalModels = Object.values(parsed.models).map((entry) =>
    resolveModelSlotStatus(entry, roots[0] || '', rootModels, sharedModels, parsed.models)
  );

  return {
    assigned,
    models: finalModels,
    discoveredCount: allCatalog.length,
    scannedPartitions: partScan?.scannedPartitions || getMountedPartitions(),
    discoveredRoots: partScan?.discoveredRoots || roots,
  };
}

export function getMachineEnvironment(): MachineEnvironment {
  const pythonBin = resolvePythonExecutable();
  let pythonAvailable = false;
  let pythonVersion: string | null = null;
  let pipAvailable = false;
  let ffmpegAvailable = false;
  let nvidiaGpuAvailable = false;
  let nvidiaGpuName: string | null = null;
  let pythonPackages: Record<string, boolean> = {
    llama_cpp: false,
    transformers: false,
    accelerate: false,
    safetensors: false,
    torch: false,
    faster_whisper: false,
    TTS: false,
    omnivoice: false,
    piper: false,
    onnxruntime: false,
    soundfile: false,
    librosa: false,
  };

  try {
    const gpuOut = execFileSync('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'], {
      encoding: 'utf-8',
      timeout: 1500,
    }).trim();
    if (gpuOut) {
      nvidiaGpuAvailable = true;
      nvidiaGpuName = gpuOut.split('\n')[0].trim() || null;
    }
  } catch {
    nvidiaGpuAvailable = false;
  }

  try {
    execFileSync('ffmpeg', ['-version'], { encoding: 'utf-8', timeout: 1500 });
    ffmpegAvailable = true;
  } catch {
    ffmpegAvailable = false;
  }

  try {
    const out = execFileSync(pythonBin, ['--version'], {
      encoding: 'utf-8',
      timeout: 2000,
    }).trim();
    pythonAvailable = true;
    pythonVersion = out || 'Python';

    try {
      execFileSync(pythonBin, ['-m', 'pip', '--version'], { encoding: 'utf-8', timeout: 2000 });
      pipAvailable = true;
    } catch {
      pipAvailable = false;
    }

    const pkgProbe = execFileSync(
      pythonBin,
      [
        '-c',
        "import importlib.util, json; mods=['llama_cpp','transformers','accelerate','safetensors','torch','faster_whisper','TTS','omnivoice','piper','onnxruntime','soundfile','librosa']; print(json.dumps({m: importlib.util.find_spec(m) is not None for m in mods}))",
      ],
      { encoding: 'utf-8', timeout: 4000 }
    ).trim();
    pythonPackages = JSON.parse(pkgProbe);
  } catch {
    pythonAvailable = false;
  }

  return {
    platform: `${os.platform()} (${os.release()})`,
    arch: os.arch(),
    cpuCores: os.cpus().length,
    totalMemoryGb: Number((os.totalmem() / (1024 * 1024 * 1024)).toFixed(1)),
    freeMemoryGb: Number((os.freemem() / (1024 * 1024 * 1024)).toFixed(1)),
    nodeVersion: process.version,
    pythonBin,
    pythonAvailable,
    pythonVersion,
    pipAvailable,
    ffmpegAvailable,
    nvidiaGpuAvailable,
    nvidiaGpuName,
    pythonPackages,
    localModelsRoot: getLocalModelsRoot(),
    searchRoots: getSearchRoots(),
    geminiKeyConfigured: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()),
  };
}

export async function installPythonBackends(packages?: string[]): Promise<{
  ok: boolean;
  command: string;
  stdout: string;
  stderr: string;
  machine: MachineEnvironment;
}> {
  const pythonBin = resolvePythonExecutable();
  const reqFile = path.join(process.cwd(), 'requirements.txt');
  const args =
    Array.isArray(packages) && packages.length > 0
      ? ['-m', 'pip', 'install', '--upgrade', ...packages]
      : fs.existsSync(reqFile)
      ? ['-m', 'pip', 'install', '-r', reqFile]
      : ['-m', 'pip', 'install', 'llama-cpp-python', 'torch', 'transformers', 'faster-whisper', 'piper-tts', 'soundfile'];

  const cmdStr = `${pythonBin} ${args.join(' ')}`;

  return new Promise((resolve) => {
    execFile(
      pythonBin,
      args,
      { cwd: process.cwd(), timeout: 300000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({
          ok: !err,
          command: cmdStr,
          stdout: (stdout || '').slice(-4000),
          stderr: (stderr || (err ? err.message : '')).slice(-4000),
          machine: getMachineEnvironment(),
        });
      }
    );
  });
}

export interface BackendUpdateItem {
  id: string;
  pipName: string;
  category: string;
  optional: boolean;
  installedVersion: string | null;
  latestVersion: string | null;
  status: 'up_to_date' | 'update_available' | 'cuda_upgrade_needed' | 'not_installed' | 'offline_unknown';
  cudaNote?: string | null;
  downloadUrl?: string;
}

export interface BackendUpdateReport {
  checkedAt: number;
  onlineReachable: boolean;
  cudaStatus: {
    nvidiaGpuAvailable: boolean;
    nvidiaGpuName: string | null;
    nvidiaDriverCuda: string | null;
    torchCudaVersion: string | null;
    torchCudaActive: boolean;
    llamaGpuOffloadSupported: boolean | null;
    needsCudaUpgrade: boolean;
  };
  outdatedCount: number;
  missingCoreCount: number;
  cudaUpgradeCount: number;
  items: BackendUpdateItem[];
}

let cachedUpdateReport: BackendUpdateReport | null = null;

export function getCachedStartupUpdateReport(): BackendUpdateReport | null {
  return cachedUpdateReport;
}

function normalizeSemverParts(v: string): number[] {
  const core = v.split('+')[0].split(/[a-zA-Z-]/)[0];
  return core
    .split('.')
    .map((p) => {
      const n = parseInt(p, 10);
      return Number.isFinite(n) ? n : 0;
    });
}

function compareVersions(installed: string, latest: string): number {
  const a = normalizeSemverParts(installed);
  const b = normalizeSemverParts(latest);
  const len = Math.max(a.length, b.length, 3);
  for (let i = 0; i < len; i++) {
    const av = a[i] || 0;
    const bv = b[i] || 0;
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  return 0;
}

async function fetchPyPiLatestVersion(pipName: string): Promise<string | null> {
  try {
    const res = await fetch(`https://pypi.org/pypi/${encodeURIComponent(pipName)}/json`, {
      method: 'GET',
      signal: AbortSignal.timeout(4500),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    return typeof data?.info?.version === 'string' ? data.info.version : null;
  } catch {
    return null;
  }
}

export async function checkBackendUpdatesOnline(force = false): Promise<BackendUpdateReport> {
  if (!force && cachedUpdateReport && Date.now() - cachedUpdateReport.checkedAt < 5 * 60 * 1000) {
    return cachedUpdateReport;
  }

  const manifest = getBackendsManifest();
  const manifestBackends: Array<any> = Array.isArray(manifest.backends) ? manifest.backends : [];

  // Ensure ctranslate2 & torchaudio accelerators are also checked
  const trackedSpecs = [...manifestBackends];
  if (!trackedSpecs.some((b) => b.pipName === 'ctranslate2')) {
    trackedSpecs.push({
      id: 'ctranslate2',
      pipName: 'ctranslate2',
      category: 'asr_accelerator',
      optional: false,
      downloadUrl: 'https://pypi.org/project/ctranslate2/#files',
    });
  }

  const pythonBin = resolvePythonExecutable();
  let nvidiaGpuAvailable = false;
  let nvidiaGpuName: string | null = null;
  let nvidiaDriverCuda: string | null = null;

  try {
    const smi = execFileSync('nvidia-smi', { encoding: 'utf-8', timeout: 2000 });
    nvidiaGpuAvailable = true;
    const cudaMatch = smi.match(/CUDA Version:\s*([\d.]+)/i);
    if (cudaMatch) nvidiaDriverCuda = cudaMatch[1];
    const nameOut = execFileSync('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'], {
      encoding: 'utf-8',
      timeout: 1500,
    }).trim();
    if (nameOut) nvidiaGpuName = nameOut.split('\n')[0].trim() || null;
  } catch {
    nvidiaGpuAvailable = false;
  }

  let localVersions: Record<string, string | null> = {};
  let torchCudaVersion: string | null = null;
  let torchCudaActive = false;
  let llamaGpuOffloadSupported: boolean | null = null;

  try {
    const namesJson = JSON.stringify(trackedSpecs.map((b) => b.pipName));
    const pyScript = [
      'import importlib.metadata as md, json',
      `names = ${namesJson}`,
      'vers = {}',
      'for n in names:',
      '  try:',
      '    if n == "onnxruntime":',
      '      try: vers[n] = md.version("onnxruntime-gpu")',
      '      except Exception: vers[n] = md.version("onnxruntime")',
      '    else:',
      '      vers[n] = md.version(n)',
      '  except Exception:',
      '    vers[n] = None',
      't_cuda, t_active, l_gpu = None, False, None',
      'try:',
      '  import torch',
      '  t_cuda = getattr(torch.version, "cuda", None)',
      '  t_active = bool(torch.cuda.is_available())',
      'except Exception: pass',
      'try:',
      '  import llama_cpp',
      '  fn = getattr(llama_cpp, "llama_supports_gpu_offload", None)',
      '  if callable(fn): l_gpu = bool(fn())',
      'except Exception: pass',
      'print(json.dumps({"vers": vers, "torchCuda": t_cuda, "torchActive": t_active, "llamaGpu": l_gpu}))',
    ].join('\n');

    const raw = execFileSync(pythonBin, ['-c', pyScript], { encoding: 'utf-8', timeout: 6000 }).trim();
    const parsed = JSON.parse(raw);
    localVersions = parsed.vers || {};
    torchCudaVersion = parsed.torchCuda || null;
    torchCudaActive = Boolean(parsed.torchActive);
    llamaGpuOffloadSupported = typeof parsed.llamaGpu === 'boolean' ? parsed.llamaGpu : null;
  } catch {
    // Python unavailable or probe failed cleanly
  }

  const latestEntries = await Promise.all(
    trackedSpecs.map(async (spec) => ({
      pipName: spec.pipName,
      latest: await fetchPyPiLatestVersion(spec.pipName),
    }))
  );
  const latestMap = new Map(latestEntries.map((e) => [e.pipName, e.latest]));
  const onlineReachable = latestEntries.some((e) => e.latest !== null);

  const items: BackendUpdateItem[] = [];
  let outdatedCount = 0;
  let missingCoreCount = 0;
  let cudaUpgradeCount = 0;

  for (const spec of trackedSpecs) {
    const installedVersion = localVersions[spec.pipName] || null;
    const latestVersion = latestMap.get(spec.pipName) || null;
    const isOptional = Boolean(spec.optional);

    let status: BackendUpdateItem['status'] = 'up_to_date';
    let cudaNote: string | null = null;

    if (!installedVersion) {
      status = 'not_installed';
      if (!isOptional) missingCoreCount += 1;
    } else {
      const torchNeedsCuda = spec.pipName === 'torch' && nvidiaGpuAvailable && !torchCudaVersion;
      const llamaNeedsCuda =
        spec.pipName === 'llama-cpp-python' && nvidiaGpuAvailable && llamaGpuOffloadSupported === false;

      if (torchNeedsCuda || llamaNeedsCuda) {
        status = 'cuda_upgrade_needed';
        cudaNote =
          spec.pipName === 'torch'
            ? 'CPU-only PyTorch detected while NVIDIA GPU is available (switch to CUDA 12.4 wheel)'
            : 'llama-cpp-python lacks GPU offload (switch to CUDA 12.4 wheel for faster inference)';
        cudaUpgradeCount += 1;
      } else if (latestVersion && compareVersions(installedVersion, latestVersion) < 0) {
        status = 'update_available';
        outdatedCount += 1;
      } else if (!latestVersion) {
        status = 'offline_unknown';
      } else {
        status = 'up_to_date';
      }
    }

    items.push({
      id: spec.id || spec.pipName,
      pipName: spec.pipName,
      category: spec.category || 'backend',
      optional: isOptional,
      installedVersion,
      latestVersion,
      status,
      cudaNote,
      downloadUrl: spec.downloadUrl || spec.pypiUrl,
    });
  }

  const report: BackendUpdateReport = {
    checkedAt: Date.now(),
    onlineReachable,
    cudaStatus: {
      nvidiaGpuAvailable,
      nvidiaGpuName,
      nvidiaDriverCuda,
      torchCudaVersion,
      torchCudaActive,
      llamaGpuOffloadSupported,
      needsCudaUpgrade: cudaUpgradeCount > 0,
    },
    outdatedCount,
    missingCoreCount,
    cudaUpgradeCount,
    items,
  };
  cachedUpdateReport = report;
  return report;
}

function runPipExec(pythonBin: string, args: string[]): Promise<{ ok: boolean; command: string; log: string }> {
  const command = `${pythonBin} ${args.join(' ')}`;
  return new Promise((resolve) => {
    execFile(
      pythonBin,
      args,
      { cwd: process.cwd(), timeout: 360000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const log = [stdout, stderr, err ? err.message : ''].filter(Boolean).join('\n').trim().slice(-4000);
        resolve({ ok: !err, command, log });
      }
    );
  });
}

export async function autoUpdateBackendsOnline(options?: {
  packages?: string[];
  includeMissingCore?: boolean;
}): Promise<{
  ok: boolean;
  updatedPackages: string[];
  commands: string[];
  log: string;
  updateReport: BackendUpdateReport;
  machine: MachineEnvironment;
}> {
  const report = await checkBackendUpdatesOnline(true);
  const pythonBin = resolvePythonExecutable();
  const hasNvidia = report.cudaStatus.nvidiaGpuAvailable;
  const includeMissingCore = options?.includeMissingCore !== false;

  const requested = Array.isArray(options?.packages) && options.packages.length > 0
    ? new Set(options.packages.map((p) => p.toLowerCase()))
    : null;

  const targets = report.items.filter((item) => {
    if (requested && !requested.has(item.pipName.toLowerCase()) && !requested.has(item.id.toLowerCase())) {
      return false;
    }
    if (item.status === 'update_available' || item.status === 'cuda_upgrade_needed') return true;
    if (includeMissingCore && !item.optional && item.status === 'not_installed') return true;
    return false;
  });

  if (targets.length === 0) {
    return {
      ok: true,
      updatedPackages: [],
      commands: [],
      log: 'All installed backends and CUDA wheels are already up to date.',
      updateReport: report,
      machine: getMachineEnvironment(),
    };
  }

  const commands: string[] = [];
  const logs: string[] = [];
  let allOk = true;
  const updatedPackages: string[] = [];

  const cudaTorchTargets = hasNvidia ? targets.filter((t) => t.pipName === 'torch') : [];
  const cudaLlamaTargets = hasNvidia ? targets.filter((t) => t.pipName === 'llama-cpp-python') : [];
  const standardTargets = targets.filter(
    (t) =>
      !(hasNvidia && (t.pipName === 'torch' || t.pipName === 'llama-cpp-python'))
  );

  if (cudaTorchTargets.length > 0) {
    const r = await runPipExec(pythonBin, [
      '-m',
      'pip',
      'install',
      '--upgrade',
      'torch',
      'torchaudio',
      '--index-url',
      'https://download.pytorch.org/whl/cu124',
    ]);
    commands.push(r.command);
    if (r.log) logs.push(r.log);
    if (r.ok) updatedPackages.push('torch (CUDA 12.4)');
    else allOk = false;
  }

  if (cudaLlamaTargets.length > 0) {
    const r = await runPipExec(pythonBin, [
      '-m',
      'pip',
      'install',
      '--upgrade',
      'llama-cpp-python',
      '--extra-index-url',
      'https://abetlen.github.io/llama-cpp-python/whl/cu124',
    ]);
    commands.push(r.command);
    if (r.log) logs.push(r.log);
    if (r.ok) updatedPackages.push('llama-cpp-python (CUDA)');
    else allOk = false;
  }

  if (standardTargets.length > 0) {
    const pkgs = standardTargets.map((t) =>
      t.pipName === 'onnxruntime' && hasNvidia ? 'onnxruntime-gpu' : t.pipName
    );
    const r = await runPipExec(pythonBin, ['-m', 'pip', 'install', '--upgrade', ...pkgs]);
    commands.push(r.command);
    if (r.log) logs.push(r.log);
    if (r.ok) updatedPackages.push(...pkgs);
    else allOk = false;
  }

  const freshReport = await checkBackendUpdatesOnline(true);
  return {
    ok: allOk,
    updatedPackages,
    commands,
    log: logs.join('\n\n').slice(-4000) || (allOk ? 'Updated cleanly.' : 'Some updates failed.'),
    updateReport: freshReport,
    machine: getMachineEnvironment(),
  };
}

export async function discoverLocalLlms(customUrl?: string): Promise<LocalLlmDiscovery[]> {
  const candidates: Array<{
    id: string;
    label: string;
    providerType: 'ollama' | 'openai_compatible';
    baseUrl: string;
    probeUrl: string;
  }> = [
    {
      id: 'ollama',
      label: 'Ollama (Local)',
      providerType: 'ollama',
      baseUrl: (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/+$/, ''),
      probeUrl: `${(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '')}/api/tags`,
    },
    {
      id: 'lmstudio',
      label: 'LM Studio (Local OpenAI API)',
      providerType: 'openai_compatible',
      baseUrl: (process.env.LMSTUDIO_BASE_URL || 'http://127.0.0.1:1234/v1').replace(/\/+$/, ''),
      probeUrl: `${(process.env.LMSTUDIO_BASE_URL || 'http://127.0.0.1:1234/v1').replace(/\/+$/, '').replace(/\/chat\/completions$/, '')}/models`,
    },
    {
      id: 'llamacpp',
      label: 'llama.cpp Server',
      providerType: 'openai_compatible',
      baseUrl: 'http://127.0.0.1:8080/v1',
      probeUrl: 'http://127.0.0.1:8080/v1/models',
    },
    {
      id: 'vllm',
      label: 'vLLM / LocalAI / OpenAI Server',
      providerType: 'openai_compatible',
      baseUrl: 'http://127.0.0.1:8000/v1',
      probeUrl: 'http://127.0.0.1:8000/v1/models',
    },
  ];

  if (customUrl && customUrl.trim()) {
    const clean = customUrl.trim().replace(/\/+$/, '');
    const isOllama = clean.includes('11434') && !clean.includes('/v1');
    candidates.unshift({
      id: 'custom_probe',
      label: 'Custom Local Server',
      providerType: isOllama ? 'ollama' : 'openai_compatible',
      baseUrl: clean,
      probeUrl: isOllama
        ? `${clean.replace(/\/api\/chat$/, '')}/api/tags`
        : `${clean.replace(/\/chat\/completions$/, '')}${clean.endsWith('/v1') ? '' : '/v1'}/models`,
    });
  }

  const results = await Promise.all(
    candidates.map(async (c): Promise<LocalLlmDiscovery> => {
      try {
        const res = await fetch(c.probeUrl, {
          method: 'GET',
          signal: AbortSignal.timeout(1500),
        });
        if (!res.ok) {
          return {
            id: c.id,
            label: c.label,
            providerType: c.providerType,
            baseUrl: c.baseUrl,
            online: false,
            models: [],
            error: `HTTP ${res.status}`,
          };
        }
        const data: any = await res.json();
        const models: string[] =
          c.providerType === 'ollama'
            ? (data.models || []).map((m: any) => m.name || m.model).filter(Boolean)
            : (data.data || []).map((m: any) => m.id).filter(Boolean);
        return {
          id: c.id,
          label: c.label,
          providerType: c.providerType,
          baseUrl: c.baseUrl,
          online: true,
          models,
        };
      } catch (err: any) {
        return {
          id: c.id,
          label: c.label,
          providerType: c.providerType,
          baseUrl: c.baseUrl,
          online: false,
          models: [],
          error: err?.name === 'TimeoutError' ? 'Offline / Timeout' : err?.message || 'Offline',
        };
      }
    })
  );

  return results;
}

function stripThinkBlocks(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

export function extractJsonFromText(rawText: string): any {
  const cleaned = stripThinkBlocks(rawText)
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    }
    throw new Error('Local LLM did not return valid JSON');
  }
}

async function invokeOllama(
  endpointUrl: string,
  modelName: string,
  promptCtx: LlmPromptContext,
  keepAlive?: string | number
): Promise<any> {
  if (!modelName) {
    throw new Error('يجب تحديد اسم الموديل المحلي لـ Ollama (مثال: qwen2.5:14b أو llama3.1).');
  }
  const cleanBase = cleanOllamaBaseUrl(endpointUrl);
  seenOllamaBases.add(cleanBase);
  const url = `${cleanBase}/api/chat`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelName,
      messages: [
        { role: 'system', content: promptCtx.systemPrompt },
        { role: 'user', content: promptCtx.userPrompt },
      ],
      stream: false,
      ...(keepAlive !== undefined ? { keep_alive: keepAlive } : {}),
      ...(promptCtx.expectJson ? { format: 'json' } : {}),
      options: {
        temperature: promptCtx.temperature ?? 0.4,
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Ollama error (${response.status}): ${errText}`);
  }

  const data: any = await response.json();
  const content = stripThinkBlocks(data?.message?.content || data?.response || '');
  if (!content) {
    throw new Error('Ollama returned an empty response');
  }
  if (promptCtx.expectJson) {
    return extractJsonFromText(content);
  }
  return { text: content };
}

async function invokeOpenAiCompatible(
  endpointUrl: string,
  modelName: string,
  apiKey: string,
  promptCtx: LlmPromptContext
): Promise<any> {
  let cleanUrl = endpointUrl.replace(/\/+$/, '');
  if (!cleanUrl.includes('/chat/completions')) {
    cleanUrl = cleanUrl.endsWith('/v1') ? `${cleanUrl}/chat/completions` : `${cleanUrl}/v1/chat/completions`;
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const body: Record<string, any> = {
    model: modelName || 'local-model',
    messages: [
      { role: 'system', content: promptCtx.systemPrompt },
      { role: 'user', content: promptCtx.userPrompt },
    ],
    temperature: promptCtx.temperature ?? 0.4,
    stream: false,
  };

  const response = await fetch(cleanUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Local OpenAI-compatible server error (${response.status}): ${errText}`);
  }

  const data: any = await response.json();
  const content = stripThinkBlocks(data?.choices?.[0]?.message?.content || '');
  if (!content) {
    throw new Error('Local OpenAI-compatible server returned an empty response');
  }
  if (promptCtx.expectJson) {
    return extractJsonFromText(content);
  }
  return { text: content };
}

async function invokeOpenAiAudio(
  slotId: ModelSlotId,
  endpointUrl: string,
  modelName: string,
  apiKey: string,
  payload: Record<string, any>
): Promise<any> {
  const headers: Record<string, string> = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  if (slotId === 'asr_diacritics') {
    let url = endpointUrl.replace(/\/+$/, '');
    if (!url.includes('/audio/transcriptions')) {
      url = url.endsWith('/v1') ? `${url}/audio/transcriptions` : `${url}/v1/audio/transcriptions`;
    }
    const audioBuffer = Buffer.from(payload.audioBase64, 'base64');
    const mimeType = payload.mimeType || 'audio/webm';
    const ext = mimeType.includes('wav') ? 'wav' : mimeType.includes('mp3') || mimeType.includes('mpeg') ? 'mp3' : 'webm';
    const form = new FormData();
    form.append('file', new Blob([audioBuffer], { type: mimeType }), `audio.${ext}`);
    form.append('model', modelName || 'whisper-1');
    if (payload.language === 'ar') {
      form.append('language', 'ar');
    }

    const res = await fetch(url, { method: 'POST', headers, body: form });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Local ASR endpoint error (${res.status}): ${text}`);
    }
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const json: any = await res.json();
      return { text: json.text || '' };
    }
    return { text: (await res.text()).trim() };
  }

  if (slotId === 'tts_reader') {
    let url = endpointUrl.replace(/\/+$/, '');
    if (!url.includes('/audio/speech')) {
      url = url.endsWith('/v1') ? `${url}/audio/speech` : `${url}/v1/audio/speech`;
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelName || 'tts-1',
        input: payload.text,
        voice: payload.voiceName || 'alloy',
        response_format: 'wav',
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Local TTS endpoint error (${res.status}): ${text}`);
    }
    const ct = res.headers.get('content-type') || 'audio/wav';
    if (ct.includes('application/json')) {
      return res.json();
    }
    const arrayBuf = await res.arrayBuffer();
    const base64 = Buffer.from(arrayBuf).toString('base64');
    return {
      audioUrl: `data:${ct.split(';')[0]};base64,${base64}`,
      textResult: payload.text,
      fallbackToBrowserSpeech: false,
    };
  }

  return invokeHttpEndpoint(endpointUrl, payload, apiKey);
}

async function invokeHttpEndpoint(
  url: string,
  payload: Record<string, any>,
  apiKey?: string
): Promise<any> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Custom model HTTP error (${response.status}): ${text}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.startsWith('audio/') || contentType.includes('application/octet-stream')) {
    const buf = Buffer.from(await response.arrayBuffer());
    const mime = contentType.startsWith('audio/') ? contentType.split(';')[0] : 'audio/wav';
    return {
      audioUrl: `data:${mime};base64,${buf.toString('base64')}`,
      textResult: payload.text || '',
      fallbackToBrowserSpeech: false,
    };
  }

  const data: any = await response.json();
  if (data && !data.audioUrl && typeof data.audioBase64 === 'string') {
    const mime = data.mimeType || 'audio/wav';
    data.audioUrl = `data:${mime};base64,${data.audioBase64}`;
  }
  return data;
}

async function invokePythonCli(scriptPathInput: string, payload: Record<string, any>): Promise<any> {
  const absScript = path.isAbsolute(scriptPathInput)
    ? scriptPathInput
    : path.join(process.cwd(), scriptPathInput);
  const pythonBin = resolvePythonExecutable();

  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin, [absScript], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to start Python model engine (${scriptPathInput}): ${err.message}`));
    });

    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(stderr.trim() || stdout.trim() || `Python exited with code ${code}`));
      }
      try {
        const trimmed = stdout.trim();
        const json = JSON.parse(trimmed);
        if (json && !json.audioUrl && typeof json.audioBase64 === 'string') {
          json.audioUrl = `data:${json.mimeType || 'audio/wav'};base64,${json.audioBase64}`;
        }
        resolve(json);
      } catch {
        resolve({ text: stdout.trim() });
      }
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

function attachTempAudioPaths(
  entryId: string,
  payload: Record<string, any>,
  targetPayload: Record<string, any>,
  tempFiles: string[]
) {
  const writeAudioTemp = (label: string, base64: string, mime?: string): string => {
    const ext = (mime || 'audio/webm').includes('wav')
      ? 'wav'
      : (mime || '').includes('mp3') || (mime || '').includes('mpeg')
      ? 'mp3'
      : 'webm';
    const p = path.join(os.tmpdir(), `hafiz_${entryId}_${label}_${Date.now()}.${ext}`);
    fs.writeFileSync(p, Buffer.from(base64, 'base64'));
    tempFiles.push(p);
    return p;
  };

  if (typeof payload.audioBase64 === 'string' && payload.audioBase64) {
    targetPayload.audioFilePath = writeAudioTemp('audio', payload.audioBase64, payload.mimeType);
  }
  if (payload.sourceAudio?.data) {
    targetPayload.sourceAudioFilePath = writeAudioTemp(
      'src',
      payload.sourceAudio.data,
      payload.sourceAudio.mimeType
    );
  }
  if (payload.targetAudio?.data) {
    targetPayload.targetAudioFilePath = writeAudioTemp(
      'tgt',
      payload.targetAudio.data,
      payload.targetAudio.mimeType
    );
  }
}

// ============================================================================
// VRAM LIFECYCLE MANAGER (Single-Model Park/Restore + Multi-Model GPU Refresh)
// ============================================================================

interface PipelineContext {
  name: string;
  modelsUsed: Set<string>;
}

const pipelineStorage = new AsyncLocalStorage<PipelineContext>();

let activeLoadedModel: ActiveLoadedModelInfo | null = null;
let suspendedModel: ActiveLoadedModelInfo | null = null;
let activeInferenceCount = 0;
let concurrentBatchModels = new Set<string>();
let lastUnloadReport: VramStatus['lastUnloadReport'] = null;
const seenOllamaBases = new Set<string>();

let pythonWorker: ChildProcessWithoutNullStreams | null = null;
let pythonWorkerBuffer = '';
let pythonWorkerReqCounter = 0;
let pythonWorkerQueue: Promise<any> = Promise.resolve();
let singleModelDispatchTail: Promise<void> = Promise.resolve();
const pythonWorkerPending = new Map<
  number,
  { resolve: (val: any) => void; reject: (err: Error) => void }
>();

async function withSingleModelLock<T>(enabled: boolean, fn: () => Promise<T>): Promise<T> {
  if (!enabled) return fn();
  let release!: () => void;
  const next = new Promise<void>((res) => {
    release = res;
  });
  const prev = singleModelDispatchTail;
  singleModelDispatchTail = prev.then(
    () => next,
    () => next
  );
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

function cleanOllamaBaseUrl(endpoint: string): string {
  return endpoint
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/api\/(chat|generate|tags|ps)$/, '');
}

function collectKnownOllamaBases(): string[] {
  const bases = new Set<string>();
  const envBase = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').trim();
  if (envBase) bases.add(cleanOllamaBaseUrl(envBase));
  for (const s of seenOllamaBases) {
    if (s) bases.add(cleanOllamaBaseUrl(s));
  }
  try {
    const reg = loadModelRegistry();
    for (const entry of Object.values(reg)) {
      const ep = (entry.endpointUrl || '').trim();
      if (!ep) continue;
      if (entry.providerType === 'ollama' || inferAdapterFromEndpoint(ep, Boolean(entry.supportsLocalLlm)) === 'ollama') {
        bases.add(cleanOllamaBaseUrl(ep));
      }
    }
  } catch {
    // ignore
  }
  return Array.from(bases);
}

async function listOllamaLoadedModels(
  baseUrl: string
): Promise<Array<{ baseUrl: string; name: string; sizeVramBytes?: number }>> {
  try {
    const res = await fetch(`${cleanOllamaBaseUrl(baseUrl)}/api/ps`, {
      method: 'GET',
      signal: AbortSignal.timeout(1200),
    });
    if (!res.ok) return [];
    const data: any = await res.json();
    const list = Array.isArray(data?.models) ? data.models : [];
    return list
      .map((m: any) => ({
        baseUrl: cleanOllamaBaseUrl(baseUrl),
        name: String(m.name || m.model || '').trim(),
        sizeVramBytes: typeof m.size_vram === 'number' ? m.size_vram : undefined,
      }))
      .filter((m: any) => Boolean(m.name));
  } catch {
    return [];
  }
}

async function evictOllamaModel(baseUrl: string, modelName: string): Promise<boolean> {
  if (!modelName) return false;
  try {
    const res = await fetch(`${cleanOllamaBaseUrl(baseUrl)}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelName, prompt: '', keep_alive: 0 }),
      signal: AbortSignal.timeout(3500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function preloadOllamaModel(baseUrl: string, modelName: string, keepAlive: string | number): Promise<boolean> {
  if (!modelName) return false;
  try {
    const cleanBase = cleanOllamaBaseUrl(baseUrl);
    seenOllamaBases.add(cleanBase);
    const res = await fetch(`${cleanBase}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelName, prompt: '', keep_alive: keepAlive }),
      signal: AbortSignal.timeout(15000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function tryUnloadLmStudio(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('lms', ['unload', '--all'], { timeout: 2500 }, (err) => {
      resolve(!err);
    });
  });
}

export function getGpuInfo(): Promise<GpuHardwareInfo> {
  return new Promise((resolve) => {
    execFile(
      'nvidia-smi',
      ['--query-gpu=name,memory.free,memory.total', '--format=csv,noheader,nounits'],
      { timeout: 1200 },
      (err, stdout) => {
        if (err || !stdout) {
          return resolve({ available: false, name: null, vramFreeMb: null, vramTotalMb: null });
        }
        const firstLine = stdout
          .trim()
          .split(/\r?\n/)
          .find((l) => l.trim().length > 0);
        if (!firstLine) {
          return resolve({ available: false, name: null, vramFreeMb: null, vramTotalMb: null });
        }
        const parts = firstLine.split(',').map((p) => p.trim());
        const name = parts[0] || null;
        const freeMb = Number(parts[1]);
        const totalMb = Number(parts[2]);
        resolve({
          available: true,
          name,
          vramFreeMb: Number.isFinite(freeMb) ? freeMb : null,
          vramTotalMb: Number.isFinite(totalMb) ? totalMb : null,
        });
      }
    );
  });
}

function rejectAllPendingWorker(reason: string) {
  for (const [, waiter] of pythonWorkerPending) {
    waiter.reject(new Error(reason));
  }
  pythonWorkerPending.clear();
}

function ensurePythonWorker(): ChildProcessWithoutNullStreams {
  if (pythonWorker && !pythonWorker.killed && pythonWorker.exitCode === null) {
    return pythonWorker;
  }

  const pythonBin = resolvePythonExecutable();
  const engineScript = path.join(process.cwd(), 'models', 'local_engine.py');
  const child = spawn(pythonBin, [engineScript, '--worker'], {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  pythonWorkerBuffer = '';
  let workerStderr = '';

  child.stdout.on('data', (chunk) => {
    pythonWorkerBuffer += chunk.toString();
    let newlineIdx = pythonWorkerBuffer.indexOf('\n');
    while (newlineIdx !== -1) {
      const line = pythonWorkerBuffer.slice(0, newlineIdx).trim();
      pythonWorkerBuffer = pythonWorkerBuffer.slice(newlineIdx + 1);
      if (line) {
        try {
          const msg = JSON.parse(line);
          const id = Number(msg.id);
          const waiter = pythonWorkerPending.get(id);
          if (waiter) {
            pythonWorkerPending.delete(id);
            if (msg.ok) {
              const res = msg.result;
              if (res && !res.audioUrl && typeof res.audioBase64 === 'string') {
                res.audioUrl = `data:${res.mimeType || 'audio/wav'};base64,${res.audioBase64}`;
              }
              waiter.resolve(res);
            } else {
              waiter.reject(new Error(msg.error || 'Local disk engine error'));
            }
          }
        } catch {
          // ignore any malformed partial line
        }
      }
      newlineIdx = pythonWorkerBuffer.indexOf('\n');
    }
  });

  child.stderr.on('data', (chunk) => {
    workerStderr = (workerStderr + chunk.toString()).slice(-2000);
  });

  child.on('error', (err) => {
    pythonWorker = null;
    rejectAllPendingWorker(`Failed to start Python worker: ${err.message}`);
  });

  child.on('close', (code) => {
    pythonWorker = null;
    rejectAllPendingWorker(workerStderr.trim() || `Python worker exited (${code ?? 'terminated'})`);
  });

  pythonWorker = child;
  return child;
}

function sendPythonWorkerRequest(
  action: 'infer' | 'unload' | 'refresh' | 'preload' | 'status',
  payload?: Record<string, any>
): Promise<any> {
  const run = () =>
    new Promise<any>((resolve, reject) => {
      try {
        const worker = ensurePythonWorker();
        const id = ++pythonWorkerReqCounter;
        pythonWorkerPending.set(id, { resolve, reject });
        const line = JSON.stringify({ id, action, ...(payload ? { payload } : {}) }) + '\n';
        worker.stdin.write(line);
      } catch (err: any) {
        reject(err);
      }
    });

  const chained = pythonWorkerQueue.then(run, run);
  pythonWorkerQueue = chained.catch(() => undefined);
  return chained;
}

async function unloadPythonWorker(killProcess = false): Promise<string | null> {
  if (!pythonWorker || pythonWorker.killed || pythonWorker.exitCode !== null) {
    pythonWorker = null;
    return null;
  }

  let unloadedKey: string | null = null;
  try {
    const res = await Promise.race([
      sendPythonWorkerRequest('unload'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('unload timeout')), 2500)),
    ]);
    unloadedKey = res?.unloaded || null;
  } catch {
    // fallback to terminating process cleanly below
  }

  if (killProcess && pythonWorker) {
    const proc = pythonWorker;
    pythonWorker = null;
    try {
      proc.stdin.end();
      proc.kill('SIGTERM');
    } catch {
      // ignore
    }
    unloadedKey = unloadedKey || 'python_worker_process';
  }

  return unloadedKey;
}

async function restoreModelToVram(parked: ActiveLoadedModelInfo): Promise<boolean> {
  const policy = getVramPolicy();
  if (policy.idleUnloadSeconds === 0) return false;

  try {
    if (parked.adapter === 'ollama' && parked.endpointUrl) {
      const ok = await preloadOllamaModel(
        parked.endpointUrl,
        parked.modelLabel,
        `${policy.idleUnloadSeconds}s`
      );
      if (ok) {
        activeLoadedModel = { ...parked, lastUsedAt: Date.now() };
      }
      return ok;
    }

    if (parked.adapter === 'local_disk' && parked.modelPath) {
      await sendPythonWorkerRequest('preload', {
        slotId: parked.slotId,
        modelPath: parked.modelPath,
        gpuMemoryLimitPercent: policy.gpuMemoryLimitPercent,
      });
      activeLoadedModel = { ...parked, lastUsedAt: Date.now() };
      return true;
    }
  } catch {
    // Non-fatal: inference for the requested service already succeeded
  }
  return false;
}

/**
 * Refreshes GPU VRAM: clears CUDA/MPS cache fragmentation in Python and evicts
 * excess loaded models after multi-model pipelines or under low VRAM headroom.
 */
export async function refreshGpuVram(
  reason = 'manual_refresh',
  clearAllLoaded = true
): Promise<VramStatus> {
  const refreshed: string[] = [];

  if (pythonWorker && !pythonWorker.killed && pythonWorker.exitCode === null) {
    if (clearAllLoaded) {
      const pyUnloaded = await unloadPythonWorker(true);
      if (pyUnloaded) refreshed.push(`local_disk:${pyUnloaded}`);
    } else {
      try {
        await Promise.race([
          sendPythonWorkerRequest('refresh'),
          new Promise((_, rej) => setTimeout(() => rej(new Error('refresh timeout')), 2000)),
        ]);
        refreshed.push('python_cuda_cache_cleared');
      } catch {
        // ignore
      }
    }
  }

  if (clearAllLoaded) {
    const bases = collectKnownOllamaBases();
    for (const base of bases) {
      const loaded = await listOllamaLoadedModels(base);
      for (const m of loaded) {
        const ok = await evictOllamaModel(m.baseUrl, m.name);
        if (ok) refreshed.push(`ollama:${m.name}`);
      }
    }
    if (activeLoadedModel?.adapter === 'openai_compatible') {
      const lmsOk = await tryUnloadLmStudio();
      if (lmsOk) refreshed.push(`lmstudio:${activeLoadedModel.modelLabel}`);
    }
    activeLoadedModel = null;
  }

  lastUnloadReport = {
    timestamp: Date.now(),
    reason,
    unloaded: refreshed.length > 0 ? refreshed : ['gpu_cache_refreshed'],
  };

  return getVramStatus();
}

/**
 * Wraps multi-model pipelines (e.g. ASR -> LLM, Voice Clone -> TTS, Diacritics -> Auto-Read TTS).
 * When 2+ distinct models participate, automatically refreshes GPU VRAM once the pipeline finishes
 * so excess model load never stays fragmented on the card.
 */
export async function runModelPipeline<T>(
  name: string,
  fn: () => Promise<T>,
  seedModelKeys: string[] = []
): Promise<T> {
  const existing = pipelineStorage.getStore();
  if (existing) {
    for (const k of seedModelKeys) {
      if (k) existing.modelsUsed.add(k);
    }
    return fn();
  }

  const ctx: PipelineContext = {
    name,
    modelsUsed: new Set(seedModelKeys.filter(Boolean)),
  };

  return pipelineStorage.run(ctx, async () => {
    try {
      return await fn();
    } finally {
      const policy = getVramPolicy();
      if (policy.refreshAfterMultiModel && ctx.modelsUsed.size >= 2) {
        await refreshGpuVram(`pipeline_complete:${name}`, true);
      }
    }
  });
}

async function prepareVramForModel(params: {
  slotId: ModelSlotId;
  adapter: ResolvedAdapter;
  modelKey: string;
  modelLabel: string;
  endpointUrl?: string;
  ollamaModelName?: string;
  allowParkForRestore?: boolean;
}): Promise<string[]> {
  const policy = getVramPolicy();
  const gpuInfo = await getGpuInfo();
  const lowVramDetected =
    gpuInfo.available &&
    gpuInfo.vramFreeMb !== null &&
    gpuInfo.vramFreeMb < policy.minFreeVramMb;

  const mustEvictOthers = policy.singleModelOnly || lowVramDetected;
  if (!mustEvictOthers) {
    return [];
  }

  const evicted: string[] = [];

  // Park previous model temporarily if singleModelOnly + restorePreviousModel + switching to a different model outside an explicit pipeline
  if (
    params.allowParkForRestore &&
    policy.singleModelOnly &&
    policy.restorePreviousModel &&
    policy.idleUnloadSeconds > 0 &&
    activeLoadedModel &&
    activeLoadedModel.modelKey !== params.modelKey &&
    !suspendedModel
  ) {
    suspendedModel = { ...activeLoadedModel };
  }

  // 1. If Python worker is running and we're switching to another runtime OR another local model
  if (pythonWorker && (params.adapter !== 'local_disk' || activeLoadedModel?.modelKey !== params.modelKey)) {
    const killWorker = params.adapter !== 'local_disk';
    const res = await unloadPythonWorker(killWorker);
    if (res) evicted.push(`local_disk:${res}`);
  }

  // 2. Evict any Ollama model loaded in /api/ps unless it matches the exact target model
  const bases = collectKnownOllamaBases();
  for (const base of bases) {
    const loaded = await listOllamaLoadedModels(base);
    for (const m of loaded) {
      const isSameTarget =
        params.adapter === 'ollama' &&
        params.ollamaModelName &&
        m.name === params.ollamaModelName &&
        cleanOllamaBaseUrl(params.endpointUrl || '') === m.baseUrl;
      if (!isSameTarget) {
        const ok = await evictOllamaModel(m.baseUrl, m.name);
        if (ok) evicted.push(`ollama:${m.name}`);
      }
    }
  }

  // 3. If switching away from an OpenAI-compatible runtime (LM Studio), invoke `lms unload --all` best-effort
  if (activeLoadedModel?.adapter === 'openai_compatible' && activeLoadedModel.modelKey !== params.modelKey) {
    const ok = await tryUnloadLmStudio();
    if (ok) evicted.push(`lmstudio:${activeLoadedModel.modelLabel}`);
  }

  if (evicted.length > 0) {
    lastUnloadReport = {
      timestamp: Date.now(),
      reason: lowVramDetected
        ? `low_vram_guard_switch:${params.modelLabel}`
        : `auto_switch_to:${params.modelLabel}`,
      unloaded: evicted,
    };
  }

  return evicted;
}

export async function getVramStatus(): Promise<VramStatus> {
  const policy = getVramPolicy();
  const bases = collectKnownOllamaBases();
  const ollamaNested = await Promise.all(bases.map((b) => listOllamaLoadedModels(b)));
  const ollamaLoadedModels = ollamaNested.flat();
  const gpuInfo = await getGpuInfo();
  const pipelineCtx = pipelineStorage.getStore();

  let idleSecondsRemaining: number | null = null;
  if (activeLoadedModel && policy.idleUnloadSeconds > 0) {
    const elapsed = (Date.now() - activeLoadedModel.lastUsedAt) / 1000;
    idleSecondsRemaining = Math.max(0, Math.ceil(policy.idleUnloadSeconds - elapsed));
  }

  return {
    policy,
    activeLoadedModel,
    suspendedModel,
    activePipelineName: pipelineCtx?.name || null,
    idleSecondsRemaining,
    ollamaLoadedModels,
    pythonWorkerRunning: Boolean(pythonWorker && !pythonWorker.killed && pythonWorker.exitCode === null),
    lastUnloadReport,
    gpuInfo,
  };
}

export async function unloadAllModels(reason = 'manual'): Promise<VramStatus> {
  const unloaded: string[] = [];
  suspendedModel = null;

  // 1. Unload and terminate Python local disk worker
  const pyRes = await unloadPythonWorker(true);
  if (pyRes) unloaded.push(`local_disk:${pyRes}`);

  // 2. Evict all loaded models across all known Ollama servers
  const bases = collectKnownOllamaBases();
  const evictedOllama = new Set<string>();
  for (const base of bases) {
    const loaded = await listOllamaLoadedModels(base);
    for (const m of loaded) {
      const ok = await evictOllamaModel(m.baseUrl, m.name);
      if (ok) {
        evictedOllama.add(`${m.baseUrl}|${m.name}`);
        unloaded.push(`ollama:${m.name}`);
      }
    }
  }
  if (activeLoadedModel?.adapter === 'ollama' && activeLoadedModel.endpointUrl) {
    const key = `${cleanOllamaBaseUrl(activeLoadedModel.endpointUrl)}|${activeLoadedModel.modelLabel}`;
    if (!evictedOllama.has(key)) {
      const ok = await evictOllamaModel(activeLoadedModel.endpointUrl, activeLoadedModel.modelLabel);
      if (ok) unloaded.push(`ollama:${activeLoadedModel.modelLabel}`);
    }
  }

  // 3. Best-effort LM Studio unload
  if (activeLoadedModel?.adapter === 'openai_compatible' || reason === 'manual' || reason === 'app_shutdown') {
    const lmsOk = await tryUnloadLmStudio();
    if (lmsOk) unloaded.push('lmstudio:all');
  }

  activeLoadedModel = null;
  lastUnloadReport = {
    timestamp: Date.now(),
    reason,
    unloaded,
  };

  return getVramStatus();
}

const idleVramTimer = setInterval(() => {
  if (activeInferenceCount > 0 || !activeLoadedModel) return;
  const policy = getVramPolicy();
  if (policy.idleUnloadSeconds <= 0) return;
  const idleSec = (Date.now() - activeLoadedModel.lastUsedAt) / 1000;
  if (idleSec >= policy.idleUnloadSeconds) {
    unloadAllModels('idle_timeout').catch(() => undefined);
  }
}, 5000);
idleVramTimer.unref();

/**
 * Dispatches a task to the user's selected Local Disk model, Python CLI script,
 * Ollama/LM Studio server, custom HTTP endpoint, or fallback engine.
 * Enforces single-model park/restore, multi-model GPU refresh, and idle cleanup policy.
 */
export async function dispatchModelTask<T = any>({
  slotId,
  payload,
  llmPrompt,
  fallback,
}: DispatchOptions<T>): Promise<{ result: T; engine: string }> {
  const registry = loadModelRegistry();
  const entry = registry[slotId];
  if (!entry) {
    const result = await fallback();
    return { result, engine: 'fallback_ai' };
  }

  const status = resolveModelSlotStatus(entry, undefined, undefined, undefined, registry);
  const effectiveEntry = status.inheritedFrom ? registry[status.inheritedFrom] || entry : entry;
  const effectiveSlotId = effectiveEntry.id;
  const apiKey = (effectiveEntry.apiKey || '').trim();
  const active = status.activeAdapter;

  if (status.strictLocal && active === 'fallback_ai') {
    throw new Error(
      `الوضع المحلي الصارم مفعّل لمنفذ "${entry.nameAr}" ولم يتم اختيار موديل محلي من الجهاز بعد.`
    );
  }

  if (active === 'fallback_ai') {
    const result = await fallback();
    return { result, engine: 'fallback_ai' };
  }

  const policy = getVramPolicy();
  const pipelineCtx = pipelineStorage.getStore();
  const effectiveLocalModel =
    active === 'local_disk'
      ? status.effectiveModelPath ||
        status.selectedModelPath ||
        status.availableLocalModels.find((m) => m.source === 'slot_folder' && m.kind !== 'python_script')?.path ||
        ''
      : '';

  const modelLabel =
    active === 'local_disk'
      ? path.basename(effectiveLocalModel || 'local')
      : active === 'python_cli'
      ? path.basename(
          status.effectiveModelPath ||
            (status.selectedModelPath && status.selectedModelPath.toLowerCase().endsWith('.py')
              ? status.selectedModelPath
              : effectiveEntry.scriptPath)
        )
      : status.modelName || effectiveSlotId;

  const modelKey = `${active}:${effectiveLocalModel || status.configuredEndpoint || ''}:${modelLabel}`;
  if (pipelineCtx) {
    pipelineCtx.modelsUsed.add(modelKey);
  }

  return withSingleModelLock(policy.singleModelOnly, async () => {
    await prepareVramForModel({
      slotId,
      adapter: active,
      modelKey,
      modelLabel,
      endpointUrl: status.configuredEndpoint || undefined,
      ollamaModelName: active === 'ollama' ? status.modelName : undefined,
      allowParkForRestore: !pipelineCtx,
    });

    activeInferenceCount += 1;
    concurrentBatchModels.add(modelKey);

    try {
    if (active === 'local_disk') {
      if (!effectiveLocalModel) {
        throw new Error(`لا يوجد ملف أو مجلد موديل محدد للمنفذ "${entry.nameAr}".`);
      }

      const tempFiles: string[] = [];
      try {
        const enginePayload: Record<string, any> = {
          slotId,
          modelPath: effectiveLocalModel,
          gpuMemoryLimitPercent: policy.gpuMemoryLimitPercent,
          ...payload,
          ...(llmPrompt
            ? {
                systemPrompt: llmPrompt.systemPrompt,
                userPrompt: llmPrompt.userPrompt,
                expectJson: Boolean(llmPrompt.expectJson),
                temperature: llmPrompt.temperature ?? 0.35,
              }
            : {}),
        };
        attachTempAudioPaths(entry.id, payload, enginePayload, tempFiles);

        let raw: any;
        if (policy.idleUnloadSeconds === 0) {
          raw = await invokePythonCli('models/local_engine.py', enginePayload);
          activeLoadedModel = null;
          lastUnloadReport = {
            timestamp: Date.now(),
            reason: 'immediate_after_use',
            unloaded: [`local_disk:${modelLabel}`],
          };
        } else {
          raw = await sendPythonWorkerRequest('infer', enginePayload);
          const now = Date.now();
          activeLoadedModel = {
            slotId,
            adapter: 'local_disk',
            modelKey,
            modelLabel,
            modelPath: effectiveLocalModel,
            loadedAt: activeLoadedModel?.modelKey === modelKey ? activeLoadedModel.loadedAt : now,
            lastUsedAt: now,
          };
        }

        return { result: raw as T, engine: `local_disk:${modelLabel}` };
      } finally {
        for (const f of tempFiles) {
          if (fs.existsSync(f)) {
            try {
              fs.unlinkSync(f);
            } catch {
              // ignore
            }
          }
        }
      }
    }

    if (active === 'python_cli') {
      const tempFiles: string[] = [];
      try {
        const cliPayload: Record<string, any> = {
          slotId,
          ...payload,
          ...(llmPrompt
            ? {
                systemPrompt: llmPrompt.systemPrompt,
                userPrompt: llmPrompt.userPrompt,
                expectJson: Boolean(llmPrompt.expectJson),
              }
            : {}),
        };
        attachTempAudioPaths(entry.id, payload, cliPayload, tempFiles);

        const scriptToRun =
          status.effectiveModelPath ||
          (status.selectedModelPath && status.selectedModelPath.toLowerCase().endsWith('.py')
            ? status.selectedModelPath
            : effectiveEntry.scriptPath);

        const raw = await invokePythonCli(scriptToRun, cliPayload);
        return { result: raw as T, engine: `python_cli:${path.basename(scriptToRun)}` };
      } finally {
        for (const f of tempFiles) {
          if (fs.existsSync(f)) {
            try {
              fs.unlinkSync(f);
            } catch {
              // ignore
            }
          }
        }
      }
    }

    if (active === 'ollama' && status.configuredEndpoint) {
      if (!llmPrompt) {
        throw new Error(
          `منفذ "${entry.nameAr}" يتطلب موديلاً متخصصاً على الجهاز (أو Python CLI / OpenAI Audio) وليس نموذج نصوص Ollama فقط.`
        );
      }
      const keepAliveVal = policy.idleUnloadSeconds === 0 ? 0 : `${policy.idleUnloadSeconds}s`;
      const raw = await invokeOllama(status.configuredEndpoint, status.modelName, llmPrompt, keepAliveVal);
      const now = Date.now();
      if (policy.idleUnloadSeconds === 0) {
        await unloadAllModels('immediate_after_use');
      } else {
        activeLoadedModel = {
          slotId,
          adapter: 'ollama',
          modelKey,
          modelLabel: status.modelName || 'local',
          endpointUrl: status.configuredEndpoint,
          loadedAt: activeLoadedModel?.modelKey === modelKey ? activeLoadedModel.loadedAt : now,
          lastUsedAt: now,
        };
      }
      return { result: raw as T, engine: `ollama:${status.modelName || 'local'}` };
    }

    if (active === 'openai_compatible' && status.configuredEndpoint) {
      if (!llmPrompt) {
        throw new Error(
          `منفذ "${entry.nameAr}" يتطلب موديلاً متخصصاً على الجهاز (أو Python CLI / OpenAI Audio).`
        );
      }
      const raw = await invokeOpenAiCompatible(
        status.configuredEndpoint,
        status.modelName,
        apiKey,
        llmPrompt
      );
      const now = Date.now();
      if (policy.idleUnloadSeconds === 0) {
        await unloadAllModels('immediate_after_use');
      } else {
        activeLoadedModel = {
          slotId,
          adapter: 'openai_compatible',
          modelKey,
          modelLabel: status.modelName || 'local',
          endpointUrl: status.configuredEndpoint,
          loadedAt: activeLoadedModel?.modelKey === modelKey ? activeLoadedModel.loadedAt : now,
          lastUsedAt: now,
        };
      }
      return { result: raw as T, engine: `openai_compatible:${status.modelName || 'local'}` };
    }

    if (active === 'openai_audio' && status.configuredEndpoint) {
      const raw = await invokeOpenAiAudio(
        slotId,
        status.configuredEndpoint,
        status.modelName,
        apiKey,
        payload
      );
      return { result: raw as T, engine: `openai_audio:${status.modelName || entry.id}` };
    }

    if (active === 'http' && status.configuredEndpoint) {
      const fullPayload = {
        slotId,
        modelName: status.modelName || undefined,
        ...payload,
        ...(llmPrompt
          ? {
              systemPrompt: llmPrompt.systemPrompt,
              userPrompt: llmPrompt.userPrompt,
              expectJson: Boolean(llmPrompt.expectJson),
            }
          : {}),
      };
      const raw = await invokeHttpEndpoint(status.configuredEndpoint, fullPayload, apiKey);
      return { result: raw as T, engine: `custom_http:${entry.id}` };
    }

    const result = await fallback();
    return { result, engine: 'fallback_ai' };
  } finally {
    activeInferenceCount = Math.max(0, activeInferenceCount - 1);

    if (activeInferenceCount === 0) {
      const distinctBatchCount = concurrentBatchModels.size;
      concurrentBatchModels.clear();

      // 1. If 2+ models ran concurrently together (outside an explicit pipeline), refresh GPU to strip excess load
      if (!pipelineCtx && distinctBatchCount >= 2 && policy.refreshAfterMultiModel) {
        await refreshGpuVram('multi_model_batch_complete', true);
      } else if (!pipelineCtx && suspendedModel && policy.singleModelOnly && policy.restorePreviousModel) {
        // 2. Temporary model finished in single-model mode: flush temporary model & restore parked previous model
        const toRestore = suspendedModel;
        suspendedModel = null;
        await refreshGpuVram(`restore_previous:${toRestore.modelLabel}`, true);
        await restoreModelToVram(toRestore);
      }
    }
    }
  });
}

export async function testModelSlotConnection(
  slotId: ModelSlotId,
  fallbackCheck: () => Promise<string>
): Promise<{
  ok: boolean;
  engine: string;
  latencyMs: number;
  sampleOutput?: string;
  error?: string;
}> {
  const start = Date.now();
  try {
    const registry = loadModelRegistry();
    const entry = registry[slotId];
    if (!entry) throw new Error(`Unknown model slot: ${slotId}`);
    const status = resolveModelSlotStatus(entry, undefined, undefined, undefined, registry);
    const effectiveEntry = status.inheritedFrom ? registry[status.inheritedFrom] || entry : entry;

    if (status.activeAdapter === 'local_disk') {
      const env = getMachineEnvironment();
      if (!env.pythonAvailable) {
        throw new Error(`Python runtime (${env.pythonBin}) not found on this machine.`);
      }
      const effectiveModel =
        status.effectiveModelPath ||
        status.selectedModelPath ||
        status.availableLocalModels.find((m) => m.source === 'slot_folder' && m.kind !== 'python_script')?.path ||
        '';
      if (!effectiveModel) {
        throw new Error('No local model file/folder selected.');
      }

      const inspectOut = execFileSync(
        env.pythonBin,
        [path.join(process.cwd(), 'models', 'local_engine.py'), '--inspect', effectiveModel, effectiveEntry.id],
        { encoding: 'utf-8', timeout: 5000 }
      );
      const parsed = JSON.parse(inspectOut);
      if (!parsed.ok) {
        throw new Error(parsed.error || 'Local model inspection failed');
      }
      return {
        ok: true,
        engine: `local_disk:${path.basename(effectiveModel)}`,
        latencyMs: Date.now() - start,
        sampleOutput: parsed.message || 'Model & libraries verified ready',
      };
    }

    if (status.activeAdapter === 'python_cli') {
      const env = getMachineEnvironment();
      if (!env.pythonAvailable) {
        throw new Error(`Python executable (${env.pythonBin}) not found`);
      }
      const scriptUsed =
        status.effectiveModelPath ||
        (status.selectedModelPath && status.selectedModelPath.toLowerCase().endsWith('.py')
          ? status.selectedModelPath
          : effectiveEntry.scriptPath);
      return {
        ok: true,
        engine: `python_cli:${path.basename(scriptUsed)}`,
        latencyMs: Date.now() - start,
        sampleOutput: `${env.pythonVersion || 'Python'} · ${scriptUsed} ready`,
      };
    }

    if (status.activeAdapter === 'ollama' && status.configuredEndpoint) {
      const policy = getVramPolicy();
      const modelLabel = status.modelName || 'local';
      const modelKey = `ollama:${status.configuredEndpoint}:${modelLabel}`;
      await prepareVramForModel({
        slotId,
        adapter: 'ollama',
        modelKey,
        modelLabel,
        endpointUrl: status.configuredEndpoint,
        ollamaModelName: status.modelName,
      });
      const out = await invokeOllama(
        status.configuredEndpoint,
        status.modelName,
        {
          systemPrompt: 'Reply in 3 words confirming readiness.',
          userPrompt: 'Ping',
          temperature: 0,
        },
        policy.idleUnloadSeconds === 0 ? 0 : `${policy.idleUnloadSeconds}s`
      );
      const now = Date.now();
      if (policy.idleUnloadSeconds === 0) {
        await unloadAllModels('immediate_after_use');
      } else {
        activeLoadedModel = {
          slotId,
          adapter: 'ollama',
          modelKey,
          modelLabel,
          endpointUrl: status.configuredEndpoint,
          loadedAt: now,
          lastUsedAt: now,
        };
      }
      return {
        ok: true,
        engine: `ollama:${modelLabel}`,
        latencyMs: Date.now() - start,
        sampleOutput: String(out.text || 'OK').slice(0, 120),
      };
    }

    if (status.activeAdapter === 'openai_compatible' && status.configuredEndpoint) {
      const policy = getVramPolicy();
      const modelLabel = status.modelName || 'local';
      const modelKey = `openai_compatible:${status.configuredEndpoint}:${modelLabel}`;
      await prepareVramForModel({
        slotId,
        adapter: 'openai_compatible',
        modelKey,
        modelLabel,
        endpointUrl: status.configuredEndpoint,
      });
      const out = await invokeOpenAiCompatible(
        status.configuredEndpoint,
        status.modelName,
        entry.apiKey || '',
        {
          systemPrompt: 'Reply in 3 words confirming readiness.',
          userPrompt: 'Ping',
          temperature: 0,
        }
      );
      const now = Date.now();
      if (policy.idleUnloadSeconds === 0) {
        await unloadAllModels('immediate_after_use');
      } else {
        activeLoadedModel = {
          slotId,
          adapter: 'openai_compatible',
          modelKey,
          modelLabel,
          endpointUrl: status.configuredEndpoint,
          loadedAt: now,
          lastUsedAt: now,
        };
      }
      return {
        ok: true,
        engine: `openai_compatible:${modelLabel}`,
        latencyMs: Date.now() - start,
        sampleOutput: String(out.text || 'OK').slice(0, 120),
      };
    }

    if (status.activeAdapter === 'openai_audio' && status.configuredEndpoint) {
      const base = status.configuredEndpoint
        .replace(/\/+$/, '')
        .replace(/\/audio\/(transcriptions|speech)$/, '');
      const probeRes = await fetch(`${base}/models`, {
        method: 'GET',
        headers: entry.apiKey ? { Authorization: `Bearer ${entry.apiKey}` } : {},
        signal: AbortSignal.timeout(2500),
      });
      if (!probeRes.ok) {
        throw new Error(`Audio server responded with HTTP ${probeRes.status}`);
      }
      return {
        ok: true,
        engine: `openai_audio:${status.modelName || slotId}`,
        latencyMs: Date.now() - start,
        sampleOutput: 'Audio server /models reachable',
      };
    }

    if (status.activeAdapter === 'http' && status.configuredEndpoint) {
      const res = await fetch(status.configuredEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(entry.apiKey ? { Authorization: `Bearer ${entry.apiKey}` } : {}),
        },
        body: JSON.stringify({ ping: true, slotId, text: 'اختبار' }),
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return {
        ok: true,
        engine: `custom_http:${slotId}`,
        latencyMs: Date.now() - start,
        sampleOutput: `HTTP ${res.status} OK`,
      };
    }

    if (status.strictLocal) {
      throw new Error('Strict Local mode is enabled and no local disk model or endpoint is selected.');
    }

    const fbOut = await fallbackCheck();
    return {
      ok: true,
      engine: 'fallback_ai',
      latencyMs: Date.now() - start,
      sampleOutput: fbOut.slice(0, 120),
    };
  } catch (err: any) {
    // execFileSync puts stdout on err.stdout when exit code is non-zero
    if (err?.stdout) {
      try {
        const parsed = JSON.parse(String(err.stdout));
        if (parsed?.error) {
          return {
            ok: false,
            engine: 'local_disk',
            latencyMs: Date.now() - start,
            error: parsed.error,
          };
        }
      } catch {
        // ignore JSON parse failure
      }
    }
    return {
      ok: false,
      engine: 'error',
      latencyMs: Date.now() - start,
      error: err?.message || 'Connection test failed',
    };
  }
}

export type { GoogleGenAI };
