import React, { useState, useEffect, useRef } from 'react';
import {
  Mic,
  MicOff,
  Copy,
  Trash2,
  Music,
  RefreshCw,
  Check,
  AlertCircle,
  Info,
  Feather,
  Volume2,
  VolumeX,
  Search,
  BookOpen,
  Download,
  Save,
  FolderOpen,
  X,
  Headphones,
  Upload,
  FileAudio,
  Moon,
  Sun,
  Languages,
  History as HistoryIcon,
  Pause,
  Play,
  CheckCircle2,
  Youtube,
  Eraser,
  Cpu,
  Sliders,
  AudioLines,
  ChevronDown,
  Sparkles,
  Globe,
  Send,
  ExternalLink,
  Server,
  Zap,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { useVirtualizer } from '@tanstack/react-virtual';

import { translations } from './translations';

type ActiveTab = 'setup' | 'studio' | 'audio' | 'models';
type ToolSubTab = 'rhymes' | 'rewrite';
type WebAgentTask = 'extract_lyrics' | 'diacritize_smart' | 'phonetic_suno' | 'analyze_and_prompt' | 'custom';
type ProviderType =
  | 'auto'
  | 'local_disk'
  | 'python_cli'
  | 'ollama'
  | 'openai_compatible'
  | 'openai_audio'
  | 'http_custom'
  | 'fallback_ai';

interface LocalDiskModel {
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

interface ModelSlotInfo {
  id: string;
  nameAr: string;
  nameEn: string;
  roleAr?: string;
  roleEn?: string;
  folder: string;
  apiEndpoint?: string;
  providerType?: ProviderType;
  activeAdapter:
    | 'local_disk'
    | 'python_cli'
    | 'ollama'
    | 'openai_compatible'
    | 'openai_audio'
    | 'http'
    | 'fallback_ai';
  configuredEndpoint: string | null;
  modelName?: string;
  selectedModelPath?: string;
  availableLocalModels?: LocalDiskModel[];
  hasApiKey?: boolean;
  strictLocal?: boolean;
  supportsLocalLlm?: boolean;
  scriptDetected: boolean;
  detectedFiles: string[];
  helperScript?: string;
  supportsInternet?: boolean;
  internetAccess?: boolean;
  inheritedFrom?: string | null;
  effectiveModelPath?: string;
  effectiveModelLabel?: string;
}

interface MachineEnvironment {
  platform: string;
  arch: string;
  cpuCores: number;
  totalMemoryGb: number;
  freeMemoryGb: number;
  nodeVersion: string;
  pythonBin: string;
  pythonAvailable: boolean;
  pythonVersion: string | null;
  pipAvailable?: boolean;
  ffmpegAvailable?: boolean;
  nvidiaGpuAvailable?: boolean;
  nvidiaGpuName?: string | null;
  pythonPackages?: Record<string, boolean>;
  localModelsRoot?: string;
  searchRoots?: string[];
  geminiKeyConfigured: boolean;
}

interface LocalLlmDiscovery {
  id: string;
  label: string;
  providerType: 'ollama' | 'openai_compatible';
  baseUrl: string;
  online: boolean;
  models: string[];
  error?: string;
}

interface VramStatusInfo {
  policy: {
    singleModelOnly: boolean;
    restorePreviousModel: boolean;
    refreshAfterMultiModel: boolean;
    gpuMemoryLimitPercent: number;
    minFreeVramMb: number;
    idleUnloadSeconds: number;
    unloadOnExit: boolean;
  };
  activeLoadedModel: {
    slotId: string;
    adapter: string;
    modelKey: string;
    modelLabel: string;
    endpointUrl?: string;
    loadedAt: number;
    lastUsedAt: number;
  } | null;
  suspendedModel: {
    slotId: string;
    adapter: string;
    modelKey: string;
    modelLabel: string;
  } | null;
  activePipelineName: string | null;
  idleSecondsRemaining: number | null;
  ollamaLoadedModels: Array<{ baseUrl: string; name: string; sizeVramBytes?: number }>;
  pythonWorkerRunning: boolean;
  lastUnloadReport: {
    timestamp: number;
    reason: string;
    unloaded: string[];
  } | null;
  gpuInfo: {
    available: boolean;
    name: string | null;
    vramFreeMb: number | null;
    vramTotalMb: number | null;
  };
}

interface BackendUpdateItem {
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

interface BackendUpdateReport {
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

type UpdateScheduleMode = 'off' | 'hourly_6' | 'daily' | 'weekly';

interface UpdatePolicyInfo {
  schedule: UpdateScheduleMode;
  notifyCriticalOnly: boolean;
  autoUpdateOnLaunch: boolean;
  lastCheckedAt: number;
}

interface PartitionScanInfo {
  scannedAt: number;
  scannedPartitions: string[];
  discoveredRoots: string[];
  discoveredModelsCount: number;
  durationMs: number;
}

const BRAND_IMAGE_URL = 'https://i.ibb.co/ZRDHCGHz/Untitled-1080-x-1080-px.jpg';

const App = () => {
  const userInteractedTabRef = useRef(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>(() => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('hafiz_active_tab');
      if (saved === 'setup' || saved === 'studio' || saved === 'audio' || saved === 'models') {
        return saved;
      }
      if (!localStorage.getItem('hafiz_setup_done')) {
        return 'setup';
      }
    }
    return 'studio';
  });
  const navigateToTab = (tab: ActiveTab) => {
    userInteractedTabRef.current = true;
    setActiveTab(tab);
  };
  const [toolSubTab, setToolSubTab] = useState<ToolSubTab>('rhymes');

  const [inputText, setInputText] = useState('');
  const [outputResult, setOutputResult] = useState('');
  const [outputType, setOutputType] = useState('');
  const [genderPreference, setGenderPreference] = useState<'auto' | 'masculine' | 'feminine'>('auto');
  const [autoRead, setAutoRead] = useState(false);

  // Word Inspector state
  const [searchWord, setSearchWord] = useState('');
  const [wordSuggestions, setWordSuggestions] = useState<any>(null);
  const [isSearchingWord, setIsSearchingWord] = useState(false);

  // TTS Reader state
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [ttsAudioUrl, setTtsAudioUrl] = useState<string | null>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);

  // Suno Modal & Internet Research state
  const [showSunoModal, setShowSunoModal] = useState(false);
  const [sunoMood, setSunoMood] = useState('');
  const [sunoGenre, setSunoGenre] = useState('mahraganat');
  const [sunoWebSearch, setSunoWebSearch] = useState(true);
  const [lastSourcesChecked, setLastSourcesChecked] = useState<string[]>([]);
  const [lastInternetUsed, setLastInternetUsed] = useState(false);
  const [lastEngineUsed, setLastEngineUsed] = useState('');

  // Voice Clone Modal state
  const [showVoiceCloneModal, setShowVoiceCloneModal] = useState(false);
  const [voiceFile, setVoiceFile] = useState<File | null>(null);
  const [targetAudioFile, setTargetAudioFile] = useState<File | null>(null);
  const [generatedAudioUrl, setGeneratedAudioUrl] = useState<string | null>(null);
  const [cloneTargetText, setCloneTargetText] = useState('');

  // Audio, YouTube & Web Lyrics Agent state
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [youtubeLink, setYoutubeLink] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [webAgentMode, setWebAgentMode] = useState<'url' | 'search'>('url');
  const [webAgentUrl, setWebAgentUrl] = useState('');
  const [webAgentQuery, setWebAgentQuery] = useState('');
  const [webAgentTask, setWebAgentTask] = useState<WebAgentTask>('extract_lyrics');
  const [webAgentCustomInstruction, setWebAgentCustomInstruction] = useState('');
  const [webSearchHits, setWebSearchHits] = useState<{ title: string; url: string; snippet: string }[]>([]);

  // Speech Recording (ASR Model via MediaRecorder) + Live Dictation
  const [isRecordingASR, setIsRecordingASR] = useState(false);
  const [isDictatingLive, setIsDictatingLive] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<any>(null);

  // Rhymes & Rewrite state
  const [rhymeWord, setRhymeWord] = useState('');
  const [lineToRewrite, setLineToRewrite] = useState('');

  // Models Registry, Direct Disk Models, Local LLM Discovery & Host Machine state
  const [modelSlots, setModelSlots] = useState<ModelSlotInfo[]>([]);
  const [machineEnv, setMachineEnv] = useState<MachineEnvironment | null>(null);
  const [localModelsRootInput, setLocalModelsRootInput] = useState('');
  const [isScanningDisk, setIsScanningDisk] = useState(false);
  const [showLocalApiPanel, setShowLocalApiPanel] = useState(false);
  const [localServers, setLocalServers] = useState<LocalLlmDiscovery[]>([]);
  const [isScanningLocal, setIsScanningLocal] = useState(false);
  const [customProbeUrl, setCustomProbeUrl] = useState('');
  const [quickProvider, setQuickProvider] = useState<'ollama' | 'openai_compatible'>('ollama');
  const [quickEndpoint, setQuickEndpoint] = useState('http://127.0.0.1:11434');
  const [quickModel, setQuickModel] = useState('');
  const [quickApiKey, setQuickApiKey] = useState('');
  const [quickStrictLocal, setQuickStrictLocal] = useState(true);
  const [isApplyingQuickLocal, setIsApplyingQuickLocal] = useState(false);

  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [endpointDrafts, setEndpointDrafts] = useState<Record<string, string>>({});
  const [providerDrafts, setProviderDrafts] = useState<Record<string, ProviderType>>({});
  const [modelNameDrafts, setModelNameDrafts] = useState<Record<string, string>>({});
  const [selectedPathDrafts, setSelectedPathDrafts] = useState<Record<string, string>>({});
  const [savingSlotId, setSavingSlotId] = useState<string | null>(null);
  const [testingSlotId, setTestingSlotId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, { ok: boolean; engine: string; latencyMs: number; sampleOutput?: string; error?: string }>
  >({});
  const [vramStatus, setVramStatus] = useState<VramStatusInfo | null>(null);
  const [isUnloadingGpu, setIsUnloadingGpu] = useState(false);
  const [isRefreshingGpu, setIsRefreshingGpu] = useState(false);
  const [isUpdatingVramPolicy, setIsUpdatingVramPolicy] = useState(false);

  // First-Run Setup, Manifest & Auto-Assign state
  const [setupManifest, setSetupManifest] = useState<any>(null);
  const [missingCorePackages, setMissingCorePackages] = useState<string[]>([]);
  const [searchRootsDraft, setSearchRootsDraft] = useState('');
  const [isSavingRoots, setIsSavingRoots] = useState(false);
  const [isAutoAssigning, setIsAutoAssigning] = useState(false);
  const [isScanningPartitions, setIsScanningPartitions] = useState(false);
  const [partitionScan, setPartitionScan] = useState<PartitionScanInfo | null>(null);
  const [autoAssignNotice, setAutoAssignNotice] = useState<string | null>(null);
  const [isInstallingPip, setIsInstallingPip] = useState(false);
  const [installingPkgId, setInstallingPkgId] = useState<string | null>(null);
  const [pipInstallLog, setPipInstallLog] = useState<{ ok: boolean; command: string; log: string } | null>(null);
  const [updateReport, setUpdateReport] = useState<BackendUpdateReport | null>(null);
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
  const [isAutoUpdating, setIsAutoUpdating] = useState(false);
  const [updatePolicy, setUpdatePolicy] = useState<UpdatePolicyInfo>(() => {
    let savedSchedule: UpdateScheduleMode = 'daily';
    let savedNotifyCritical = true;
    let savedAutoLaunch = false;
    if (typeof window !== 'undefined') {
      const s = localStorage.getItem('hafiz_update_schedule');
      if (s === 'off' || s === 'hourly_6' || s === 'daily' || s === 'weekly') {
        savedSchedule = s;
      }
      const n = localStorage.getItem('hafiz_notify_critical_only');
      if (n === '0') savedNotifyCritical = false;
      savedAutoLaunch = localStorage.getItem('hafiz_auto_update_on_launch') === '1';
    }
    return {
      schedule: savedSchedule,
      notifyCriticalOnly: savedNotifyCritical,
      autoUpdateOnLaunch: savedAutoLaunch,
      lastCheckedAt: 0,
    };
  });
  const [isSavingUpdatePolicy, setIsSavingUpdatePolicy] = useState(false);
  const [setupStatusLoaded, setSetupStatusLoaded] = useState(false);
  const [updateNotificationDismissed, setUpdateNotificationDismissed] = useState(false);
  const [autoUpdateNotice, setAutoUpdateNotice] = useState<string | null>(null);
  const autoUpdateTriggeredRef = useRef(false);
  const scheduledCheckTriggeredRef = useRef(false);

  // UI & Theme state
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState(false);
  const [brandImgFailed, setBrandImgFailed] = useState(false);
  const [genre, setGenre] = useState('mahraganat');
  const [language, setLanguage] = useState<'ar' | 'en'>('ar');
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return true;
  });

  const [history, setHistory] = useState<
    { id: string; type: string; input: string; output: string; timestamp: number }[]
  >(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('hafiz_history');
        return saved ? JSON.parse(saved) : [];
      } catch {
        return [];
      }
    }
    return [];
  });

  const outputRef = useRef<HTMLDivElement>(null);
  const t = translations[language];

  useEffect(() => {
    localStorage.setItem('hafiz_history', JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('hafiz_active_tab', activeTab);
    }
  }, [activeTab]);

  useEffect(() => {
    document.documentElement.setAttribute('lang', language);
    document.documentElement.setAttribute('dir', language === 'ar' ? 'rtl' : 'ltr');
  }, [language]);

  useEffect(() => {
    if (outputResult && outputRef.current) {
      outputRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [outputResult]);

  // Setup optional browser SpeechRecognition for live dictation
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = language === 'ar' ? 'ar-EG' : 'en-US';

      recognitionRef.current.onresult = (event: any) => {
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) finalTranscript += event.results[i][0].transcript;
        }
        if (finalTranscript) {
          setInputText((prev) => prev + (prev ? ' ' : '') + finalTranscript);
        }
      };
      recognitionRef.current.onerror = () => setIsDictatingLive(false);
      recognitionRef.current.onend = () => setIsDictatingLive(false);
    }
  }, [language]);

  const syncSlotDrafts = (models: ModelSlotInfo[]) => {
    const epDrafts: Record<string, string> = {};
    const provDrafts: Record<string, ProviderType> = {};
    const modDrafts: Record<string, string> = {};
    const pathDrafts: Record<string, string> = {};
    for (const m of models) {
      epDrafts[m.id] = m.configuredEndpoint || '';
      provDrafts[m.id] = m.providerType || 'auto';
      modDrafts[m.id] = m.modelName || '';
      pathDrafts[m.id] = m.selectedModelPath || '';
    }
    setEndpointDrafts(epDrafts);
    setProviderDrafts(provDrafts);
    setModelNameDrafts(modDrafts);
    setSelectedPathDrafts(pathDrafts);
  };

  const fetchSetupStatus = async () => {
    try {
      const res = await fetch('/api/setup/status');
      const data = await res.json();
      if (res.ok) {
        if (data.manifest) setSetupManifest(data.manifest);
        if (Array.isArray(data.missingCorePackages)) setMissingCorePackages(data.missingCorePackages);
        if (Array.isArray(data.searchRoots)) setSearchRootsDraft(data.searchRoots.join('\n'));
        if (data.machine) setMachineEnv(data.machine);
        if (data.partitionScan) setPartitionScan(data.partitionScan);
        if (data.updateReport) setUpdateReport(data.updateReport);
        if (data.updatePolicy) {
          setUpdatePolicy(data.updatePolicy);
          if (typeof window !== 'undefined') {
            localStorage.setItem('hafiz_update_schedule', data.updatePolicy.schedule);
            localStorage.setItem(
              'hafiz_notify_critical_only',
              data.updatePolicy.notifyCriticalOnly ? '1' : '0'
            );
            localStorage.setItem(
              'hafiz_auto_update_on_launch',
              data.updatePolicy.autoUpdateOnLaunch ? '1' : '0'
            );
          }
        }
        setSetupStatusLoaded(true);
        if (Array.isArray(data.models)) {
          setModelSlots(data.models);
          syncSlotDrafts(data.models);
        }
        // If dependencies and primary local models from partitions are already auto-bound on initial launch,
        // enter Studio automatically without overriding any explicit user tab navigation.
        if (
          typeof window !== 'undefined' &&
          !userInteractedTabRef.current &&
          !sessionStorage.getItem('hafiz_active_tab') &&
          !localStorage.getItem('hafiz_setup_done') &&
          Array.isArray(data.missingCorePackages) &&
          data.missingCorePackages.length === 0 &&
          Array.isArray(data.models) &&
          data.models.some((m: any) => m.id === 'smart_studio' && m.activeAdapter !== 'fallback_ai')
        ) {
          localStorage.setItem('hafiz_setup_done', '1');
          const boundNames = data.models
            .filter((m: any) => !m.inheritedFrom && m.activeAdapter !== 'fallback_ai' && m.effectiveModelLabel)
            .map((m: any) => `${language === 'ar' ? m.nameAr : m.nameEn}: ${m.effectiveModelLabel}`)
            .slice(0, 4);
          if (boundNames.length > 0) {
            setAutoAssignNotice(`${t.autoAssignedReadyNotice} ${boundNames.join(' · ')}`);
          }
          setActiveTab('studio');
        }
      }
    } catch {
      setSetupStatusLoaded(true);
    }
  };

  const handleAutoUpdateAll = async (includeMissingCore = true) => {
    setIsAutoUpdating(true);
    setError(null);
    try {
      const res = await fetch('/api/setup/auto-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ includeMissingCore }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Auto-update failed');
      if (data.updateReport) setUpdateReport(data.updateReport);
      if (data.machine) setMachineEnv(data.machine);
      const updatedList: string[] = Array.isArray(data.updatedPackages) ? data.updatedPackages : [];
      if (updatedList.length > 0) {
        setAutoUpdateNotice(
          language === 'ar'
            ? `تم تحديث وترقية الباك إند/CUDA تلقائياً: ${updatedList.join(' · ')}`
            : `Auto-updated backends & CUDA: ${updatedList.join(' · ')}`
        );
      }
      if (Array.isArray(data.commands) && data.commands.length > 0) {
        setPipInstallLog({
          ok: Boolean(data.ok),
          command: data.commands.join(' && '),
          log: data.log || (data.ok ? 'OK' : 'Completed with warnings'),
        });
      }
      await fetchSetupStatus();
    } catch (err: any) {
      setError(err.message || 'Auto-update failed');
    } finally {
      setIsAutoUpdating(false);
    }
  };

  const getScheduleIntervalMs = (schedule: UpdateScheduleMode): number => {
    if (schedule === 'hourly_6') return 6 * 60 * 60 * 1000;
    if (schedule === 'daily') return 24 * 60 * 60 * 1000;
    if (schedule === 'weekly') return 7 * 24 * 60 * 60 * 1000;
    return 0;
  };

  const checkBackendUpdates = async (force = false, triggerAutoIfEnabled = false) => {
    setIsCheckingUpdates(true);
    try {
      const res = await fetch(`/api/setup/check-updates${force ? '?force=1' : ''}`);
      const data = await res.json();
      if (res.ok && data.updateReport) {
        const rep: BackendUpdateReport = data.updateReport;
        setUpdateReport(rep);
        const policy: UpdatePolicyInfo = data.updatePolicy || updatePolicy;
        if (data.updatePolicy) {
          setUpdatePolicy(data.updatePolicy);
        }
        const criticalFound = (rep.cudaUpgradeCount || 0) + (rep.missingCoreCount || 0) > 0;
        if (force || criticalFound) {
          setUpdateNotificationDismissed(false);
        }
        if (
          triggerAutoIfEnabled &&
          policy.autoUpdateOnLaunch &&
          !autoUpdateTriggeredRef.current &&
          rep.onlineReachable &&
          (rep.outdatedCount > 0 || rep.cudaUpgradeCount > 0)
        ) {
          autoUpdateTriggeredRef.current = true;
          await handleAutoUpdateAll(false);
        }
      }
    } catch {
      // ignore if server offline
    } finally {
      setIsCheckingUpdates(false);
    }
  };

  const handleSaveUpdatePolicy = async (
    updates: Partial<{ schedule: UpdateScheduleMode; notifyCriticalOnly: boolean; autoUpdateOnLaunch: boolean }>
  ) => {
    setIsSavingUpdatePolicy(true);
    setUpdatePolicy((prev) => {
      const optimistic = { ...prev, ...updates };
      if (typeof window !== 'undefined') {
        localStorage.setItem('hafiz_update_schedule', optimistic.schedule);
        localStorage.setItem('hafiz_notify_critical_only', optimistic.notifyCriticalOnly ? '1' : '0');
        localStorage.setItem('hafiz_auto_update_on_launch', optimistic.autoUpdateOnLaunch ? '1' : '0');
      }
      return optimistic;
    });
    if (updates.notifyCriticalOnly !== undefined) {
      setUpdateNotificationDismissed(false);
    }
    try {
      const res = await fetch('/api/setup/update-policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (res.ok && data.updatePolicy) {
        setUpdatePolicy(data.updatePolicy);
      }
    } catch {
      // ignore offline save fallback (localStorage already synced)
    } finally {
      setIsSavingUpdatePolicy(false);
    }
  };

  const fetchModelsStatus = async () => {
    setIsLoadingModels(true);
    try {
      const res = await fetch('/api/models/status');
      const data = await res.json();
      if (res.ok && Array.isArray(data.models)) {
        setModelSlots(data.models);
        syncSlotDrafts(data.models);
      }
      if (res.ok && data.machine) {
        setMachineEnv(data.machine);
        if (typeof data.localModelsRoot === 'string') {
          setLocalModelsRootInput(data.localModelsRoot);
        }
        if (Array.isArray(data.machine.searchRoots)) {
          setSearchRootsDraft(data.machine.searchRoots.join('\n'));
        }
      }
      if (res.ok && data.partitionScan) {
        setPartitionScan(data.partitionScan);
      }
      if (res.ok && data.vramStatus) {
        setVramStatus(data.vramStatus);
      }
      await fetchSetupStatus();
    } catch {
      // ignore initial background fetch errors
    } finally {
      setIsLoadingModels(false);
    }
  };

  const handleSaveSearchRoots = async () => {
    setIsSavingRoots(true);
    setError(null);
    try {
      const roots = searchRootsDraft
        .split(/\r?\n/)
        .map((r) => r.trim())
        .filter(Boolean);
      const res = await fetch('/api/models/search-roots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ searchRoots: roots }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save search folders');
      if (Array.isArray(data.models)) {
        setModelSlots(data.models);
        syncSlotDrafts(data.models);
      }
      if (data.machine) setMachineEnv(data.machine);
      if (Array.isArray(data.searchRoots)) setSearchRootsDraft(data.searchRoots.join('\n'));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSavingRoots(false);
    }
  };

  const handleAutoAssignModels = async (overwriteExisting = true) => {
    setIsAutoAssigning(true);
    setError(null);
    setAutoAssignNotice(null);
    try {
      const roots = searchRootsDraft
        .split(/\r?\n/)
        .map((r) => r.trim())
        .filter(Boolean);
      if (roots.length > 0) {
        await fetch('/api/models/search-roots', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ searchRoots: roots }),
        });
      }
      const res = await fetch('/api/models/auto-assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overwriteExisting, fixMismatches: true, scanAllPartitions: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Auto-assign failed');
      if (Array.isArray(data.models)) {
        setModelSlots(data.models);
        syncSlotDrafts(data.models);
      }
      if (data.machine) setMachineEnv(data.machine);
      if (data.partitionScan) setPartitionScan(data.partitionScan);
      if (Array.isArray(data.searchRoots)) setSearchRootsDraft(data.searchRoots.join('\n'));
      const assignedList = Array.isArray(data.assigned) ? data.assigned : [];
      const scannedDrives = Array.isArray(data.scannedPartitions) ? data.scannedPartitions.join(', ') : '';
      if (assignedList.length > 0) {
        setAutoAssignNotice(
          `${t.setupAssignedMsg} ${assignedList.map((a: any) => `${a.slotId} → ${a.modelName}`).join(' · ')}${
            scannedDrives ? ` (${scannedDrives})` : ''
          }`
        );
      } else {
        setAutoAssignNotice(
          language === 'ar'
            ? `تم فحص البارتيشن والمسارات (${scannedDrives || 'local'}) — عدد المكتشف: ${data.discoveredCount ?? 0}. تأكد من وجود مجلدات الموديلات.`
            : `Scanned partitions & roots (${scannedDrives || 'local'}): ${data.discoveredCount ?? 0} model(s) found.`
        );
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsAutoAssigning(false);
    }
  };

  const handleScanPartitions = async (overwriteExisting = true) => {
    setIsScanningPartitions(true);
    setError(null);
    setAutoAssignNotice(null);
    try {
      const res = await fetch('/api/models/scan-partitions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overwriteExisting }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Partition scan failed');
      if (Array.isArray(data.models)) {
        setModelSlots(data.models);
        syncSlotDrafts(data.models);
      }
      if (data.machine) setMachineEnv(data.machine);
      if (data.partitionScan) setPartitionScan(data.partitionScan);
      if (Array.isArray(data.searchRoots)) setSearchRootsDraft(data.searchRoots.join('\n'));
      const assignedList = Array.isArray(data.assigned) ? data.assigned : [];
      const scannedDrives = Array.isArray(data.scannedPartitions) ? data.scannedPartitions.join(', ') : '';
      if (assignedList.length > 0) {
        setAutoAssignNotice(
          `${t.autoAssignedReadyNotice} ${assignedList.map((a: any) => `${a.slotId} → ${a.modelName}`).join(' · ')}${
            scannedDrives ? ` · [${scannedDrives}]` : ''
          }`
        );
      } else {
        setAutoAssignNotice(
          language === 'ar'
            ? `تم مسح البارتيشن (${scannedDrives || 'C:, D:, E:'}) واكتشاف ${data.discoveredCount ?? 0} موديل في ${
                data.discoveredRoots?.length ?? 0
              } مسار.`
            : `Scanned partitions (${scannedDrives || 'C:, D:, E:'}) and discovered ${data.discoveredCount ?? 0} model(s) across ${
                data.discoveredRoots?.length ?? 0
              } root(s).`
        );
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsScanningPartitions(false);
    }
  };

  const handleInstallPythonBackends = async () => {
    setIsInstallingPip(true);
    setError(null);
    setPipInstallLog(null);
    try {
      const res = await fetch('/api/setup/install-python', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      setPipInstallLog({
        ok: Boolean(data.ok),
        command: data.command || 'pip install -r requirements.txt',
        log: [data.stdout, data.stderr, data.error].filter(Boolean).join('\n').trim() || (data.ok ? 'OK' : 'Failed'),
      });
      if (data.machine) setMachineEnv(data.machine);
      await fetchSetupStatus();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsInstallingPip(false);
    }
  };

  const handleInstallSingleBackend = async (pkgId: string, pipInstallSpec: string) => {
    setInstallingPkgId(pkgId);
    setError(null);
    try {
      const useCudaAware =
        pkgId === 'torch' || pkgId === 'llama_cpp' || pkgId === 'onnxruntime' || Boolean(updateReport);
      const res = await fetch(useCudaAware ? '/api/setup/auto-update' : '/api/setup/install-python', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          useCudaAware
            ? { packages: [pkgId], includeMissingCore: true }
            : { packages: [pipInstallSpec] }
        ),
      });
      const data = await res.json();
      setPipInstallLog({
        ok: Boolean(data.ok),
        command:
          (Array.isArray(data.commands) ? data.commands.join(' && ') : data.command) ||
          `pip install --upgrade ${pipInstallSpec}`,
        log:
          [data.log, data.stdout, data.stderr, data.error].filter(Boolean).join('\n').trim() ||
          (data.ok ? 'OK' : 'Failed'),
      });
      if (data.updateReport) setUpdateReport(data.updateReport);
      if (data.machine) setMachineEnv(data.machine);
      await fetchSetupStatus();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setInstallingPkgId(null);
    }
  };

  const handleEnterStudioFromSetup = () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('hafiz_setup_done', '1');
    }
    navigateToTab('studio');
  };

  const fetchVramStatus = async () => {
    try {
      const res = await fetch('/api/models/vram-status');
      const data = await res.json();
      if (res.ok && data.vramStatus) {
        setVramStatus(data.vramStatus);
      }
    } catch {
      // ignore background poll errors
    }
  };

  const handleUpdateVramPolicy = async (
    updates: Partial<{
      singleModelOnly: boolean;
      restorePreviousModel: boolean;
      refreshAfterMultiModel: boolean;
      gpuMemoryLimitPercent: number;
      minFreeVramMb: number;
      idleUnloadSeconds: number;
      unloadOnExit: boolean;
    }>
  ) => {
    setIsUpdatingVramPolicy(true);
    setError(null);
    try {
      const res = await fetch('/api/models/vram-policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update VRAM policy');
      if (data.vramStatus) setVramStatus(data.vramStatus);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsUpdatingVramPolicy(false);
    }
  };

  const handleRefreshGpuVram = async (reason = 'manual_refresh') => {
    setIsRefreshingGpu(true);
    setError(null);
    try {
      const res = await fetch('/api/models/vram-refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, clearAllLoaded: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to refresh GPU VRAM');
      if (data.vramStatus) setVramStatus(data.vramStatus);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsRefreshingGpu(false);
    }
  };

  const handleUnloadAllGpu = async (reason = 'manual') => {
    setIsUnloadingGpu(true);
    setError(null);
    try {
      const res = await fetch('/api/models/unload-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to unload GPU models');
      if (data.vramStatus) setVramStatus(data.vramStatus);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsUnloadingGpu(false);
    }
  };

  const handleSetLocalModelsRoot = async () => {
    setIsScanningDisk(true);
    setError(null);
    try {
      const res = await fetch('/api/models/local-root', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ localModelsRoot: localModelsRootInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to scan disk folder');
      if (Array.isArray(data.models)) {
        setModelSlots(data.models);
        syncSlotDrafts(data.models);
      }
      if (data.machine) {
        setMachineEnv(data.machine);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsScanningDisk(false);
    }
  };

  const refreshSlotsMetadataOnly = async () => {
    try {
      const res = await fetch('/api/models/status');
      const data = await res.json();
      if (res.ok && Array.isArray(data.models)) {
        setModelSlots(data.models);
      }
      if (res.ok && data.vramStatus) {
        setVramStatus(data.vramStatus);
      }
    } catch {
      // ignore silent refresh error
    }
  };

  const handleSelectSlotModel = async (slotId: string, selectedModelPath: string) => {
    setSelectedPathDrafts((prev) => ({ ...prev, [slotId]: selectedModelPath }));
    const nextProvider: ProviderType = selectedModelPath
      ? selectedModelPath.toLowerCase().endsWith('.py')
        ? 'python_cli'
        : 'local_disk'
      : 'auto';
    setProviderDrafts((prev) => ({ ...prev, [slotId]: nextProvider }));
    setSavingSlotId(slotId);
    setError(null);
    try {
      const res = await fetch('/api/models/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slotId,
          selectedModelPath,
          providerType: nextProvider,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to select model');
      if (data.model) {
        setModelSlots((prev) => prev.map((m) => (m.id === slotId ? data.model : m)));
        if (slotId === 'smart_studio') {
          await refreshSlotsMetadataOnly();
        }
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingSlotId(null);
    }
  };

  const handleScanLocalLlms = async () => {
    setIsScanningLocal(true);
    setError(null);
    try {
      const q = customProbeUrl.trim() ? `?customUrl=${encodeURIComponent(customProbeUrl.trim())}` : '';
      const res = await fetch(`/api/models/discover-local${q}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to scan local servers');
      if (Array.isArray(data.servers)) {
        setLocalServers(data.servers);
      }
      if (data.machine) {
        setMachineEnv(data.machine);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsScanningLocal(false);
    }
  };

  const handleApplyLocalLlmPreset = async () => {
    setIsApplyingQuickLocal(true);
    setError(null);
    try {
      const res = await fetch('/api/models/apply-local-llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerType: quickProvider,
          endpointUrl: quickEndpoint.trim(),
          modelName: quickModel.trim(),
          apiKey: quickApiKey.trim(),
          strictLocal: quickStrictLocal,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to bind Local LLM');
      if (Array.isArray(data.models)) {
        setModelSlots(data.models);
        syncSlotDrafts(data.models);
      }
      if (data.machine) setMachineEnv(data.machine);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsApplyingQuickLocal(false);
    }
  };

  const handleToggleModelInternet = async (slotId: string, nextVal: boolean) => {
    setSavingSlotId(slotId);
    setError(null);
    try {
      const res = await fetch('/api/models/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotId, internetAccess: nextVal }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update internet access');
      if (data.model) {
        setModelSlots((prev) => prev.map((m) => (m.id === slotId ? data.model : m)));
        if (slotId === 'smart_studio') {
          await refreshSlotsMetadataOnly();
        }
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingSlotId(null);
    }
  };

  const handleToggleStrictLocal = async (slotId: string, nextVal: boolean) => {
    setSavingSlotId(slotId);
    setError(null);
    try {
      const res = await fetch('/api/models/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotId, strictLocal: nextVal }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update strict local setting');
      if (data.model) {
        setModelSlots((prev) => prev.map((m) => (m.id === slotId ? data.model : m)));
        if (slotId === 'smart_studio') {
          await refreshSlotsMetadataOnly();
        }
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingSlotId(null);
    }
  };

  const handleSaveModelConfig = async (slotId: string) => {
    setSavingSlotId(slotId);
    setError(null);
    try {
      const endpointUrl = (endpointDrafts[slotId] ?? '').trim();
      const providerType = providerDrafts[slotId] ?? 'auto';
      const modelName = (modelNameDrafts[slotId] ?? '').trim();
      const selectedModelPath = (selectedPathDrafts[slotId] ?? '').trim();
      const res = await fetch('/api/models/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotId, providerType, endpointUrl, modelName, selectedModelPath }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update model config');
      if (data.model) {
        setModelSlots((prev) => prev.map((m) => (m.id === slotId ? data.model : m)));
        if (slotId === 'smart_studio') {
          await refreshSlotsMetadataOnly();
        }
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingSlotId(null);
    }
  };

  const handleTestModelSlot = async (slotId: string) => {
    setTestingSlotId(slotId);
    try {
      const res = await fetch('/api/models/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotId }),
      });
      const data = await res.json();
      setTestResults((prev) => ({
        ...prev,
        [slotId]: {
          ok: Boolean(data.ok),
          engine: data.engine || 'unknown',
          latencyMs: Number(data.latencyMs || 0),
          sampleOutput: data.sampleOutput,
          error: data.error,
        },
      }));
    } catch (err: any) {
      setTestResults((prev) => ({
        ...prev,
        [slotId]: {
          ok: false,
          engine: 'error',
          latencyMs: 0,
          error: err.message || 'Test request failed',
        },
      }));
    } finally {
      setTestingSlotId(null);
    }
  };

  useEffect(() => {
    fetchModelsStatus();
  }, []);

  useEffect(() => {
    if (!setupStatusLoaded) return;
    if (updatePolicy.schedule === 'off') return;
    const intervalMs = getScheduleIntervalMs(updatePolicy.schedule);
    if (!intervalMs) return;

    const elapsed = Date.now() - (updatePolicy.lastCheckedAt || 0);
    if (!scheduledCheckTriggeredRef.current && (updatePolicy.lastCheckedAt === 0 || elapsed >= intervalMs)) {
      scheduledCheckTriggeredRef.current = true;
      checkBackendUpdates(false, updatePolicy.autoUpdateOnLaunch);
    }

    const bgTimer = setInterval(() => {
      checkBackendUpdates(true, false);
    }, intervalMs);
    return () => clearInterval(bgTimer);
  }, [setupStatusLoaded, updatePolicy.schedule, updatePolicy.lastCheckedAt, updatePolicy.autoUpdateOnLaunch]);

  useEffect(() => {
    if (!isLoading && lastEngineUsed) {
      fetchVramStatus();
    }
  }, [isLoading, lastEngineUsed]);

  useEffect(() => {
    const hasLoadedModel =
      Boolean(vramStatus?.activeLoadedModel) ||
      Boolean(vramStatus?.pythonWorkerRunning) ||
      (vramStatus?.ollamaLoadedModels?.length || 0) > 0;

    if (activeTab !== 'models' && !hasLoadedModel) return;

    const timer = setInterval(() => {
      fetchVramStatus();
    }, 6000);
    return () => clearInterval(timer);
  }, [
    activeTab,
    vramStatus?.activeLoadedModel,
    vramStatus?.pythonWorkerRunning,
    vramStatus?.ollamaLoadedModels?.length,
  ]);

  useEffect(() => {
    const onBeforeUnload = () => {
      if (vramStatus?.policy?.unloadOnExit !== false) {
        const blob = new Blob([JSON.stringify({ reason: 'window_closed' })], {
          type: 'application/json',
        });
        navigator.sendBeacon?.('/api/models/unload-all', blob);
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [vramStatus?.policy?.unloadOnExit]);

  const addToHistory = (type: string, input: string, output: string) => {
    const newItem = {
      id: Math.random().toString(36).slice(2, 11),
      type,
      input,
      output,
      timestamp: Date.now(),
    };
    setHistory((prev) => [newItem, ...prev].slice(0, 30));
  };

  const fileToBase64 = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result.split(',')[1]);
        }
      };
      reader.onerror = reject;
    });

  // ============================================================================
  // ASR SPEECH-TO-DIACRITIZED-TEXT (Mic Recording -> /api/models/asr)
  // ============================================================================
  const toggleASRRecording = async () => {
    if (isRecordingASR) {
      mediaRecorderRef.current?.stop();
      setIsRecordingASR(false);
      return;
    }

    setError(null);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError(t.micError);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const audioBlob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        if (audioBlob.size === 0) return;

        setIsLoading(true);
        try {
          const base64 = await fileToBase64(audioBlob);
          const res = await fetch('/api/models/asr', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              audioBase64: base64,
              mimeType: audioBlob.type || 'audio/webm',
              mode: 'egyptian',
              language,
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || t.audioError);
          if (data.text) {
            setInputText((prev) => (prev.trim() ? `${prev.trim()}\n${data.text}` : data.text));
          }
        } catch (err: any) {
          setError(err.message || t.audioError);
        } finally {
          setIsLoading(false);
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecordingASR(true);
    } catch {
      setError(t.micError);
    }
  };

  const toggleLiveDictation = () => {
    if (isDictatingLive) {
      recognitionRef.current?.stop();
      setIsDictatingLive(false);
    } else {
      setError(null);
      try {
        recognitionRef.current?.start();
        setIsDictatingLive(true);
      } catch {
        setError(t.micError);
      }
    }
  };

  // ============================================================================
  // TTS DIACRITIC-FAITHFUL READER (/api/models/tts + Web Speech fallback)
  // ============================================================================
  const stopSpeaking = () => {
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current.currentTime = 0;
    }
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
    setIsPaused(false);
  };

  const pauseSpeaking = () => {
    if (ttsAudioRef.current && !ttsAudioRef.current.paused) {
      ttsAudioRef.current.pause();
      setIsPaused(true);
      return;
    }
    if (window.speechSynthesis) {
      window.speechSynthesis.pause();
      setIsPaused(true);
    }
  };

  const resumeSpeaking = () => {
    if (ttsAudioRef.current && ttsAudioRef.current.paused && ttsAudioUrl) {
      ttsAudioRef.current.play();
      setIsPaused(false);
      return;
    }
    if (window.speechSynthesis) {
      window.speechSynthesis.resume();
      setIsPaused(false);
    }
  };

  const speakWithBrowser = (cleanText: string) => {
    if (!window.speechSynthesis) {
      setError(t.speechError);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = language === 'ar' ? 'ar-EG' : 'en-US';
    const voices = window.speechSynthesis.getVoices();
    const targetVoice =
      voices.find((v) => v.lang.includes(language === 'ar' ? 'ar-EG' : 'en-US')) ||
      voices.find((v) => v.lang.includes(language));
    if (targetVoice) utterance.voice = targetVoice;
    utterance.rate = 0.85;
    utterance.onstart = () => {
      setIsSpeaking(true);
      setIsPaused(false);
    };
    utterance.onend = () => {
      setIsSpeaking(false);
      setIsPaused(false);
    };
    utterance.onerror = () => {
      setIsSpeaking(false);
      setIsPaused(false);
    };
    window.speechSynthesis.speak(utterance);
  };

  const speakText = async (textToSpeak: string, refreshAfterPipeline = false) => {
    if (!textToSpeak.trim()) return;
    stopSpeaking();
    setTtsAudioUrl(null);
    const cleanText = textToSpeak.replace(/\[.*?\]/g, '').trim();
    if (!cleanText) return;

    setIsSpeaking(true);
    try {
      const res = await fetch('/api/models/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: cleanText, language, refreshAfterPipeline }),
      });
      const data = await res.json();
      fetchVramStatus();
      if (res.ok && data.audioUrl) {
        setTtsAudioUrl(data.audioUrl);
        setTimeout(() => {
          if (ttsAudioRef.current) {
            ttsAudioRef.current.onended = () => {
              setIsSpeaking(false);
              setIsPaused(false);
            };
            ttsAudioRef.current.play().catch(() => {
              speakWithBrowser(cleanText);
            });
          }
        }, 50);
        return;
      }
      speakWithBrowser(cleanText);
    } catch {
      speakWithBrowser(cleanText);
    }
  };

  // ============================================================================
  // STUDIO ACTIONS (Routed cleanly to /api/models/*)
  // ============================================================================
  const handleDiacriticsAction = async (
    mode: 'smart_light' | 'phonetic_suno' | 'connected' | 'clean_standard'
  ) => {
    if (!inputText.trim()) return;
    setIsLoading(true);
    setError(null);
    setOutputResult('');
    setGeneratedAudioUrl(null);
    setLastInternetUsed(false);
    setLastSourcesChecked([]);
    setLastEngineUsed('');
    const nextOutputType =
      mode === 'clean_standard'
        ? 'clean'
        : mode === 'smart_light'
        ? 'light_diacritics'
        : 'tashkeel';
    setOutputType(nextOutputType);

    try {
      const res = await fetch('/api/models/diacritics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: inputText,
          mode,
          genderPreference,
          language,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error processing diacritics');

      setOutputResult(data.text);
      setLastEngineUsed(data.engine || '');
      setLastInternetUsed(Boolean(data.internetConnected));
      setLastSourcesChecked(Array.isArray(data.sourcesChecked) ? data.sourcesChecked : []);
      addToHistory(nextOutputType, inputText, data.text);
      if (autoRead) {
        speakText(data.text, true);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLyricsAction = async (
    task: 'write_lyrics' | 'compose_song' | 'format_lyrics' | 'analyze_lyrics'
  ) => {
    const sourceText =
      task === 'format_lyrics' || task === 'analyze_lyrics'
        ? outputResult.trim() || inputText.trim()
        : inputText.trim();
    if (!sourceText) return;

    setIsLoading(true);
    setError(null);
    setGeneratedAudioUrl(null);
    setLastInternetUsed(false);
    setLastSourcesChecked([]);
    setLastEngineUsed('');
    const nextType =
      task === 'compose_song'
        ? 'song'
        : task === 'analyze_lyrics'
        ? 'analysis'
        : 'lyrics_format';
    setOutputType(nextType);

    const genreTitle = t.genres[genre as keyof typeof t.genres] || genre;

    try {
      const res = await fetch('/api/models/lyrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task,
          text: sourceText,
          genre,
          genreTitle,
          enableWebSearch: task === 'compose_song' ? sunoWebSearch : undefined,
          language,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error in songwriting task');

      setOutputResult(data.text);
      setLastEngineUsed(data.engine || '');
      setLastInternetUsed(Boolean(data.internetConnected));
      setLastSourcesChecked(Array.isArray(data.sourcesChecked) ? data.sourcesChecked : []);
      addToHistory(nextType, sourceText.slice(0, 60), data.text);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveAllDiacritics = () => {
    const diacriticsRegex = /[\u064B-\u065F\u0670\u0640]/g;
    if (inputText) setInputText(inputText.replace(diacriticsRegex, ''));
    if (outputResult) setOutputResult(outputResult.replace(diacriticsRegex, ''));
  };

  const handleWordSearch = async (overrideWord?: string) => {
    const targetWord = (overrideWord ?? searchWord).trim();
    if (!targetWord) return;
    setIsSearchingWord(true);
    setWordSuggestions(null);

    try {
      const res = await fetch('/api/models/diacritics-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word: targetWord, language }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Search error');
      setWordSuggestions(data);
      addToHistory('search', targetWord, JSON.stringify(data.suggestions || []));
    } catch {
      setWordSuggestions({
        suggestions: [
          {
            word: language === 'ar' ? 'تعذر البحث' : 'Search Failed',
            meaning:
              language === 'ar'
                ? 'حدث خطأ أثناء جلب التشكيلات، حاول مجدداً.'
                : 'Error fetching diacritics, please try again.',
          },
        ],
      });
    } finally {
      setIsSearchingWord(false);
    }
  };

  const handleFindRhymes = async () => {
    if (!rhymeWord.trim()) return;
    setIsLoading(true);
    setError(null);
    setLastEngineUsed('');
    setLastInternetUsed(false);
    setLastSourcesChecked([]);
    setOutputType('rhymes');

    try {
      const res = await fetch('/api/models/rhymes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word: rhymeWord, language }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error finding rhymes');

      const formatted =
        language === 'ar'
          ? `القوافي المقترحة لـ "${rhymeWord}":\n${(data.rhymes || []).join('\n')}`
          : `Suggested rhymes for "${rhymeWord}":\n${(data.rhymes || []).join('\n')}`;
      setOutputResult(formatted);
      setLastEngineUsed(data.engine || '');
      addToHistory('rhymes', rhymeWord, formatted);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRewriteLine = async () => {
    if (!lineToRewrite.trim()) return;
    setIsLoading(true);
    setError(null);
    setLastEngineUsed('');
    setLastInternetUsed(false);
    setLastSourcesChecked([]);
    setOutputType('rewrite');

    try {
      const res = await fetch('/api/models/rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ line: lineToRewrite, context: inputText, language }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error rewriting line');

      const formatted =
        language === 'ar' ? `السطر الجديد:\n${data.text}` : `Rewritten line:\n${data.text}`;
      setOutputResult(formatted);
      setLastEngineUsed(data.engine || '');
      addToHistory('rewrite', lineToRewrite, formatted);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateMusicPrompt = async () => {
    if (!sunoGenre.trim() || !sunoMood.trim()) {
      setError(
        language === 'ar'
          ? 'الرجاء اختيار نوع الموسيقى وكتابة الحالة.'
          : 'Please select genre and write mood.'
      );
      return;
    }
    setShowSunoModal(false);
    setIsLoading(true);
    setError(null);
    setOutputResult('');
    setLastInternetUsed(false);
    setLastSourcesChecked([]);
    setLastEngineUsed('');
    setOutputType('music_prompt');

    try {
      const res = await fetch('/api/models/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          genre: sunoGenre,
          mood: sunoMood,
          lyrics: inputText,
          enableWebSearch: sunoWebSearch,
          language,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error generating prompt');

      setOutputResult(data.text);
      setLastEngineUsed(data.engine || '');
      setLastInternetUsed(Boolean(data.internetConnected));
      setLastSourcesChecked(Array.isArray(data.sourcesChecked) ? data.sourcesChecked : []);
      addToHistory('music_prompt', `${sunoGenre} · ${sunoMood}`, data.text);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRunWebAgent = async () => {
    const targetInput = webAgentMode === 'url' ? webAgentUrl.trim() : webAgentQuery.trim();
    if (!targetInput) return;

    setIsLoading(true);
    setError(null);
    setOutputResult('');
    setWebSearchHits([]);
    setLastInternetUsed(false);
    setLastSourcesChecked([]);
    setLastEngineUsed('');
    setOutputType(webAgentTask === 'analyze_and_prompt' ? 'music_prompt' : 'lyrics_format');

    try {
      const res = await fetch('/api/models/web-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: webAgentMode,
          url: webAgentMode === 'url' ? targetInput : '',
          query: webAgentMode === 'search' ? targetInput : '',
          task: webAgentTask,
          customInstruction: webAgentCustomInstruction.trim(),
          language,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error running web agent');

      setOutputResult(data.text || '');
      setLastEngineUsed(data.engine || '');
      const hits = Array.isArray(data.searchHits) ? data.searchHits : [];
      setWebSearchHits(hits);
      setLastInternetUsed(true);
      setLastSourcesChecked(
        data.fetchedPage?.url
          ? [data.fetchedPage.url]
          : hits.slice(0, 3).map((h: any) => h.url).filter(Boolean)
      );
      addToHistory('web_agent', targetInput.slice(0, 60), data.text || '');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAudioUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setAudioFile(e.target.files[0]);
    }
  };

  const processAudioASR = async (mode: 'general' | 'egyptian' | 'clean_standard') => {
    if (!audioFile) return;
    setIsLoading(true);
    setError(null);
    setOutputResult('');
    setLastEngineUsed('');
    setLastInternetUsed(false);
    setLastSourcesChecked([]);
    setOutputType('transcription');

    try {
      const audioBase64 = await fileToBase64(audioFile);
      const res = await fetch('/api/models/asr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioBase64,
          mimeType: audioFile.type || 'audio/mpeg',
          mode,
          language,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t.audioError);

      setOutputResult(data.text);
      setLastEngineUsed(data.engine || '');
      addToHistory(mode, audioFile.name, data.text);
    } catch (err: any) {
      setError(err.message || t.audioError);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAudioMusicAnalysis = async (mode: 'suno_1000' | 'deep_analysis') => {
    if (!audioFile && !youtubeLink.trim()) return;
    setIsLoading(true);
    setError(null);
    setOutputResult('');
    setLastEngineUsed('');
    setLastInternetUsed(false);
    setLastSourcesChecked([]);
    setOutputType('analysis');

    try {
      const audioBase64 = audioFile ? await fileToBase64(audioFile) : undefined;
      const res = await fetch('/api/models/audio-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioBase64,
          mimeType: audioFile?.type,
          youtubeUrl: !audioBase64 ? youtubeLink.trim() : undefined,
          mode,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t.audioError);

      setOutputResult(data.result);
      setLastEngineUsed(data.engine || '');
      addToHistory('analysis', audioFile?.name || youtubeLink, data.result);
    } catch (err: any) {
      setError(err.message || t.audioError);
    } finally {
      setIsLoading(false);
    }
  };

  const handleVoiceClone = async () => {
    if (!voiceFile || !targetAudioFile) {
      setError(
        language === 'ar'
          ? 'يرجى رفع عينة صوت الشخص وعينة اللحن/الأداء.'
          : 'Please upload both voice and melody samples.'
      );
      return;
    }

    setShowVoiceCloneModal(false);
    setIsLoading(true);
    setError(null);
    setOutputResult('');
    setLastEngineUsed('');
    setLastInternetUsed(false);
    setLastSourcesChecked([]);
    setOutputType('voice_clone');
    setGeneratedAudioUrl(null);

    try {
      const sourceVoiceData = await fileToBase64(voiceFile);
      const targetMelodyData = await fileToBase64(targetAudioFile);

      const res = await fetch('/api/models/voice-clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceAudio: { data: sourceVoiceData, mimeType: voiceFile.type },
          targetAudio: { data: targetMelodyData, mimeType: targetAudioFile.type },
          lyrics: cloneTargetText || '',
          language,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t.audioError);

      setOutputResult(data.text);
      setGeneratedAudioUrl(data.audioUrl || null);
      setLastEngineUsed(data.engine || '');
      addToHistory('voice_clone', `${voiceFile.name} → ${targetAudioFile.name}`, data.text);
    } catch (err: any) {
      setError(err.message || t.audioError);
    } finally {
      setIsLoading(false);
    }
  };

  // ============================================================================
  // UTILITY HANDLERS
  // ============================================================================
  const copyToClipboard = () => {
    if (!outputResult) return;
    navigator.clipboard?.writeText(outputResult).then(
      () => {
        setCopyStatus(true);
        setTimeout(() => setCopyStatus(false), 2000);
      },
      () => {
        const textArea = document.createElement('textarea');
        textArea.value = outputResult;
        document.body.appendChild(textArea);
        textArea.select();
        try {
          document.execCommand('copy');
          setCopyStatus(true);
          setTimeout(() => setCopyStatus(false), 2000);
        } catch {
          // ignore
        }
        document.body.removeChild(textArea);
      }
    );
  };

  const saveInput = () => localStorage.setItem('rika_saved_input', inputText);
  const loadInput = () => {
    const saved = localStorage.getItem('rika_saved_input');
    if (saved) setInputText(saved);
  };

  const downloadOutput = () => {
    if (!outputResult) return;
    const blob = new Blob([outputResult], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hafiz_output_${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadOutputDocx = async () => {
    if (!outputResult) return;
    const doc = new Document({
      sections: [
        {
          properties: {},
          children: outputResult.split('\n').map(
            (line) =>
              new Paragraph({
                children: [new TextRun({ text: line, rightToLeft: language === 'ar' })],
              })
          ),
        },
      ],
    });
    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hafiz_output_${Date.now()}.docx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadResultPackage = () => {
    if (generatedAudioUrl) {
      const a = document.createElement('a');
      a.href = generatedAudioUrl;
      a.download = `hafiz-audio-${Date.now()}.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }
    downloadOutput();
  };

  // Virtualized Output Renderer
  const VirtualizedOutput = ({ text, type }: { text: string; type: string }) => {
    const parentRef = useRef<HTMLDivElement>(null);
    const lines = text.split('\n');

    const rowVirtualizer = useVirtualizer({
      count: lines.length,
      getScrollElement: () => parentRef.current,
      estimateSize: () => 40,
    });

    return (
      <div ref={parentRef} className="max-h-[56vh] overflow-y-auto pe-2 custom-scrollbar">
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const line = lines[virtualRow.index];
            let content: React.ReactNode = line;

            if (type === 'song' || type === 'lyrics_format') {
              if (line.match(/^\[Style:.*\]|^\[Vocal Delivery:.*\]|^\[Pronunciation.*\]/i)) {
                content = (
                  <span
                    className="block font-mono text-xs my-1.5 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/60 px-2.5 py-1.5 rounded-lg w-fit"
                    dir="ltr"
                  >
                    {line}
                  </span>
                );
              } else if (line.match(/^\[(.*?)\]$/)) {
                content = (
                  <span className="inline-block text-xs font-bold tracking-wider uppercase text-indigo-600 dark:text-indigo-400 mt-4 mb-1">
                    {line}
                  </span>
                );
              } else if (line.trim() === '') {
                content = <br />;
              } else {
                content = <span className="block mb-1 text-slate-900 dark:text-slate-100">{line}</span>;
              }
            } else if (type === 'music_prompt' || type === 'analysis') {
              if (line.match(/\[(.*?)\]/)) {
                content = (
                  <span
                    className="block font-mono text-xs my-1.5 bg-slate-100 dark:bg-slate-800/80 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 px-3 py-2 rounded-lg"
                    dir="ltr"
                  >
                    {line}
                  </span>
                );
              } else if (line.trim() === '') {
                content = <br />;
              } else {
                content = <span className="block mb-1 text-slate-800 dark:text-slate-200">{line}</span>;
              }
            } else {
              content =
                line.trim() === '' ? (
                  <br />
                ) : (
                  <span className="block mb-1 text-slate-900 dark:text-slate-100">{line}</span>
                );
            }

            return (
              <div
                key={virtualRow.index}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {content}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ============================================================================
  // SHARED OUTPUT CARD COMPONENT
  // ============================================================================
  const renderOutputPanel = () => {
    if (!outputResult && !isLoading) return null;

    return (
      <section
        ref={outputRef}
        className="bg-white dark:bg-[#13161C] border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm transition-colors"
      >
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-[#0E1015] flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <AudioLines size={18} className="text-indigo-600 dark:text-indigo-400" />
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">{t.finalResult}</h2>
            {lastEngineUsed && !isLoading && (
              <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400" dir="ltr">
                · {lastEngineUsed}
              </span>
            )}
            {(lastInternetUsed || lastSourcesChecked.length > 0) && !isLoading && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                <Globe size={12} />
                <span>{t.internetOn}</span>
                {lastSourcesChecked.length > 0 && (
                  <span className="text-slate-400 dark:text-slate-500">
                    · {lastSourcesChecked.slice(0, 2).join(' · ')}
                  </span>
                )}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!isLoading && outputResult && (
              <>
                {isSpeaking ? (
                  <>
                    <button
                      onClick={isPaused ? resumeSpeaking : pauseSpeaking}
                      className="h-9 px-3 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-1.5 transition-colors whitespace-nowrap"
                    >
                      {isPaused ? <Play size={14} /> : <Pause size={14} />}
                      <span>{isPaused ? t.resumeBtn : t.pauseBtn}</span>
                    </button>
                    <button
                      onClick={stopSpeaking}
                      className="h-9 px-3 rounded-lg text-xs font-semibold border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 flex items-center gap-1.5 transition-colors whitespace-nowrap"
                    >
                      <VolumeX size={14} />
                      <span>{t.stopSpeakBtn}</span>
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => speakText(outputResult)}
                    className="h-9 px-3.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1.5 transition-colors whitespace-nowrap"
                  >
                    <Volume2 size={14} />
                    <span>{t.speakBtn}</span>
                  </button>
                )}

                <button
                  onClick={() => {
                    setInputText(outputResult);
                    setActiveTab('studio');
                  }}
                  className="h-9 px-3 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-1.5 transition-colors whitespace-nowrap"
                >
                  <Send size={13} />
                  <span>{t.sendToEditor}</span>
                </button>

                <button
                  onClick={copyToClipboard}
                  className="h-9 px-3 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-1.5 transition-colors whitespace-nowrap"
                >
                  {copyStatus ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                  <span>{copyStatus ? t.copied : t.copy}</span>
                </button>

                <button
                  onClick={downloadOutput}
                  className="h-9 px-3 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-1.5 transition-colors whitespace-nowrap"
                >
                  <Download size={14} />
                  <span>TXT</span>
                </button>

                <button
                  onClick={downloadOutputDocx}
                  className="h-9 px-3 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-1.5 transition-colors whitespace-nowrap"
                >
                  <Download size={14} />
                  <span>DOCX</span>
                </button>
              </>
            )}

            <button
              onClick={() => {
                setOutputResult('');
                setLastEngineUsed('');
                setLastInternetUsed(false);
                setLastSourcesChecked([]);
                stopSpeaking();
              }}
              className="h-9 w-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-500 hover:text-red-500 flex items-center justify-center transition-colors"
              aria-label={t.close}
            >
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="p-5 md:p-6">
          {ttsAudioUrl && (
            <div className="mb-4 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0D11]">
              <audio ref={ttsAudioRef} src={ttsAudioUrl} controls className="w-full h-9" />
            </div>
          )}

          {isLoading ? (
            <div className="py-10 flex flex-col items-center justify-center gap-4">
              <RefreshCw size={24} className="text-indigo-600 dark:text-indigo-400 animate-spin" />
              <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                {outputType === 'voice_clone'
                  ? t.voiceCloneRunning
                  : outputType === 'song'
                  ? t.loadingComposing
                  : outputType === 'tashkeel' || outputType === 'light_diacritics'
                  ? t.loadingDiacritics
                  : outputType === 'clean'
                  ? t.loadingCorrecting
                  : outputType === 'analysis'
                  ? t.loadingAnalyzing
                  : t.loadingProcessing}
              </p>
            </div>
          ) : (
            <div className="text-lg md:text-xl leading-[2.1] font-arabic">
              {generatedAudioUrl && (
                <div className="mb-5 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0D11]">
                  <audio src={generatedAudioUrl} controls className="w-full" />
                </div>
              )}
              <VirtualizedOutput text={outputResult} type={outputType} />
            </div>
          )}

          {outputResult && outputType === 'voice_clone' && !isLoading && (
            <div className="mt-6 pt-5 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 size={20} className="text-emerald-600 dark:text-emerald-400" />
                <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {t.downloadReady}
                </span>
              </div>
              <button
                onClick={downloadResultPackage}
                className="h-10 px-5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold flex items-center gap-2 transition-colors"
              >
                <Download size={16} />
                <span>{t.exportBtn}</span>
              </button>
            </div>
          )}
        </div>

        {(outputType === 'song' || outputType === 'voice_clone') && !isLoading && (
          <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0E1015] flex items-center gap-2.5 text-xs text-slate-600 dark:text-slate-400">
            <Info size={15} className="shrink-0 text-indigo-500" />
            <span>
              <strong className="text-slate-800 dark:text-slate-200">{t.note}</strong>{' '}
              {outputType === 'song' ? t.noteText : t.voiceMatchNote}
            </span>
          </div>
        )}
      </section>
    );
  };

  const renderInlineSlotSelector = (slotId: string, customLabel?: string) => {
    const slot = modelSlots.find((m) => m.id === slotId);
    if (!slot) return null;
    const diskModels = slot.availableLocalModels || [];
    const currentValue = slot.selectedModelPath || '';
    const externalLabel =
      !currentValue && slot.inheritedFrom === 'smart_studio'
        ? `${t.inheritedFromSmartStudio}${
            slot.effectiveModelLabel ? ` (${slot.effectiveModelLabel})` : ''
          }`
        : !currentValue && slot.activeAdapter !== 'fallback_ai'
        ? `${slot.activeAdapter}${slot.modelName ? `: ${slot.modelName}` : ''}`
        : t.defaultBuiltInFallback;

    return (
      <div className="inline-flex items-center gap-1.5 min-w-0">
        <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap">
          {customLabel || t.activeModelLabel}
        </span>
        <div className="relative">
          <select
            value={currentValue}
            onChange={(e) => handleSelectSlotModel(slotId, e.target.value)}
            disabled={savingSlotId === slotId}
            aria-label={language === 'ar' ? slot.nameAr : slot.nameEn}
            className="h-8 max-w-[210px] ps-2.5 pe-6 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0D11] text-[11px] font-medium text-slate-800 dark:text-slate-200 appearance-none cursor-pointer truncate disabled:opacity-50"
          >
            <option value="">{externalLabel}</option>
            {diskModels.map((m) => (
              <option key={m.path} value={m.path}>
                {m.name} ({m.sizeLabel})
              </option>
            ))}
          </select>
          <ChevronDown
            size={12}
            className="pointer-events-none absolute top-1/2 -translate-y-1/2 end-2 text-slate-400"
          />
        </div>
      </div>
    );
  };

  return (
    <div
      className="min-h-screen flex flex-col bg-[#F8FAFC] dark:bg-[#0B0D11] text-slate-900 dark:text-slate-100 transition-colors duration-200"
      dir={language === 'ar' ? 'rtl' : 'ltr'}
    >
      {/* Hidden audio element for TTS reader playback */}
      {ttsAudioUrl && <audio ref={ttsAudioRef} src={ttsAudioUrl} className="hidden" />}

      {/* ===================================================================== */}
      {/* TOP BAR CONTRACT: 3 Clean Zones (Brand — Nav Tabs — Language & Theme) */}
      {/* ===================================================================== */}
      <header className="sticky top-0 z-30 bg-white/95 dark:bg-[#111318]/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4 sm:gap-8">
          {/* Zone 1: Exact Brand Image + Exact Name */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-10 h-10 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 shrink-0 flex items-center justify-center">
              {!brandImgFailed ? (
                <img
                  src={BRAND_IMAGE_URL}
                  alt={`${t.title} ${t.subtitle}`}
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                  onError={() => setBrandImgFailed(true)}
                />
              ) : (
                <Feather size={20} className="text-indigo-600 dark:text-indigo-400" />
              )}
            </div>
            <span className="font-ruqaa text-2xl font-bold text-slate-900 dark:text-white whitespace-nowrap shrink-0 leading-none">
              {t.title} <span className="text-indigo-600 dark:text-indigo-400">{t.subtitle}</span>
            </span>
          </div>

          {/* Zone 2: Clean Single-Line Navigation Links */}
          <nav className="hidden md:flex items-center gap-6">
            <button
              onClick={() => navigateToTab('studio')}
              className={`py-5 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'studio'
                  ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {t.navStudio}
            </button>
            <button
              onClick={() => navigateToTab('audio')}
              className={`py-5 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'audio'
                  ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {t.navAudio}
            </button>
            <button
              onClick={() => {
                navigateToTab('models');
                fetchModelsStatus();
              }}
              className={`py-5 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'models'
                  ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {t.navModels}
            </button>
            <button
              onClick={() => {
                navigateToTab('setup');
                fetchSetupStatus();
              }}
              className={`py-5 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'setup'
                  ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {t.navSetup}
            </button>
          </nav>

          {/* Zone 3: Language & Theme Controls */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')}
              className="h-10 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
              aria-label={t.switchLang}
            >
              <Languages size={16} />
              <span>{t.switchLang}</span>
            </button>
            <button
              onClick={() => setDarkMode(!darkMode)}
              className="h-10 w-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-center transition-colors shrink-0"
              aria-label={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {darkMode ? <Sun size={17} /> : <Moon size={17} />}
            </button>
          </div>
        </div>

        {/* Mobile Tab Switcher */}
        <div className="flex md:hidden border-t border-slate-200 dark:border-slate-800 px-4 gap-2 overflow-x-auto">
          {(['studio', 'audio', 'models', 'setup'] as ActiveTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => {
                navigateToTab(tab);
                if (tab === 'models') fetchModelsStatus();
                if (tab === 'setup') fetchSetupStatus();
              }}
              className={`py-2.5 px-3 text-xs font-semibold border-b-2 whitespace-nowrap shrink-0 ${
                activeTab === tab
                  ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                  : 'border-transparent text-slate-500'
              }`}
            >
              {tab === 'studio'
                ? t.navStudio
                : tab === 'audio'
                ? t.navAudio
                : tab === 'models'
                ? t.navModels
                : t.navSetup}
            </button>
          ))}
        </div>
      </header>

      {/* ===================================================================== */}
      {/* MAIN WORKSPACE CONTENT                                                */}
      {/* ===================================================================== */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Scheduled Background Update & Essential CUDA Upgrade Notification Banner */}
        {(() => {
          const criticalUpgradeCount =
            (updateReport?.cudaUpgradeCount ?? 0) + (updateReport?.missingCoreCount ?? 0);
          const optionalOutdatedCount = updateReport?.outdatedCount ?? 0;
          const shouldShowBanner =
            !updateNotificationDismissed &&
            (isAutoUpdating ||
              Boolean(autoUpdateNotice) ||
              (Boolean(updateReport) &&
                (updatePolicy.notifyCriticalOnly
                  ? criticalUpgradeCount > 0
                  : optionalOutdatedCount > 0 || criticalUpgradeCount > 0)));
          if (!shouldShowBanner) return null;

          const isCritical = criticalUpgradeCount > 0;
          return (
            <div
              className={`p-3.5 rounded-xl border flex flex-wrap items-center justify-between gap-3 text-xs ${
                isCritical
                  ? 'border-amber-200 dark:border-amber-900/70 bg-amber-50/80 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200'
                  : 'border-indigo-200 dark:border-indigo-900/70 bg-indigo-50/70 dark:bg-indigo-950/30 text-indigo-800 dark:text-indigo-200'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <RefreshCw size={15} className={`shrink-0 ${isAutoUpdating ? 'animate-spin' : ''}`} />
                <span className="font-semibold">
                  {isAutoUpdating
                    ? t.setupUpdatesUpdating
                    : autoUpdateNotice
                    ? autoUpdateNotice
                    : isCritical
                    ? `${t.setupCriticalUpgradeBanner} (${updateReport?.cudaUpgradeCount ?? 0} CUDA · ${
                        updateReport?.missingCoreCount ?? 0
                      } ${language === 'ar' ? 'مكتبة أساسية' : 'core'})`
                    : language === 'ar'
                    ? `متاح أونلاين: ${optionalOutdatedCount} تحديث اختياري للمكتبات.`
                    : `Optional updates available: ${optionalOutdatedCount} package(s).`}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {updateReport && (optionalOutdatedCount > 0 || criticalUpgradeCount > 0) && (
                  <button
                    type="button"
                    onClick={() => handleAutoUpdateAll(isCritical)}
                    disabled={isAutoUpdating}
                    className={`h-8 px-3 rounded-lg text-white font-semibold disabled:opacity-40 whitespace-nowrap ${
                      isCritical ? 'bg-amber-600 hover:bg-amber-500' : 'bg-indigo-600 hover:bg-indigo-500'
                    }`}
                  >
                    {isAutoUpdating ? t.setupUpdatesUpdating : t.setupUpdatesAutoBtn}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setUpdateNotificationDismissed(true);
                    setAutoUpdateNotice(null);
                  }}
                  className="p-1 opacity-75 hover:opacity-100"
                  aria-label={t.close}
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          );
        })()}

        {/* Startup Auto-Bound Partition Models Notice (inside Studio/Audio) */}
        {autoAssignNotice && (activeTab === 'studio' || activeTab === 'audio') && (
          <div className="p-3.5 rounded-xl border border-emerald-200 dark:border-emerald-900/70 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200 flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2.5 min-w-0">
              <CheckCircle2 size={15} className="shrink-0" />
              <span className="font-semibold">{autoAssignNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => setAutoAssignNotice(null)}
              className="p-1 text-emerald-600 hover:text-emerald-800 dark:hover:text-white shrink-0"
              aria-label={t.close}
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Global Error Banner */}
        {error && (
          <div className="p-4 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-sm font-medium">
              <AlertCircle size={18} className="shrink-0" />
              <span>{error}</span>
            </div>
            <button
              onClick={() => setError(null)}
              className="p-1 text-red-500 hover:text-red-700"
              aria-label={t.close}
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Slim Live VRAM Occupancy Bar (visible only while a local model is loaded in GPU/RAM) */}
        {vramStatus &&
          (vramStatus.activeLoadedModel ||
            vramStatus.pythonWorkerRunning ||
            vramStatus.ollamaLoadedModels.length > 0) &&
          activeTab !== 'models' && (
            <div className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#13161C] flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex flex-wrap items-center gap-2.5 text-slate-700 dark:text-slate-300">
                <Cpu size={14} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
                <span className="font-semibold">{t.activeInVramLabel}</span>
                <span className="font-mono font-semibold text-slate-900 dark:text-white" dir="ltr">
                  {vramStatus.activeLoadedModel
                    ? `${vramStatus.activeLoadedModel.adapter}:${vramStatus.activeLoadedModel.modelLabel}`
                    : vramStatus.ollamaLoadedModels.map((m) => `ollama:${m.name}`).join(', ') ||
                      'local_disk:worker'}
                </span>
                {vramStatus.idleSecondsRemaining !== null && (
                  <span className="text-slate-500 dark:text-slate-400 tabular-nums">
                    · {t.autoUnloadInLabel} {vramStatus.idleSecondsRemaining} {t.unloadSecondsOption}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleUnloadAllGpu('manual_bar')}
                disabled={isUnloadingGpu}
                className="h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 transition-colors disabled:opacity-40 whitespace-nowrap"
              >
                <Zap size={13} className="text-amber-500" />
                <span>{isUnloadingGpu ? t.unloadingGpu : t.unloadAllNowBtn}</span>
              </button>
            </div>
          )}

        {/* =================================================================== */}
        {/* TAB 1: STUDIO (2-Column Workbench + Linguistic Tools Sidebar)       */}
        {/* =================================================================== */}
        {activeTab === 'studio' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Primary Studio Column (8 cols) */}
            <div className="lg:col-span-8 space-y-6">
              <section className="bg-white dark:bg-[#13161C] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-sm space-y-5">
                {/* Editor Top Bar: Title + Gender Selector + Utility Icons */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      {t.mainInputLabel}
                    </span>

                    {/* Gender Segmented Control */}
                    <div className="inline-flex items-center p-0.5 rounded-lg bg-slate-100 dark:bg-[#0B0D11] border border-slate-200 dark:border-slate-800">
                      {(
                        [
                          { id: 'auto', label: t.genderAuto },
                          { id: 'masculine', label: t.genderMasculine },
                          { id: 'feminine', label: t.genderFeminine },
                        ] as const
                      ).map((g) => (
                        <button
                          key={g.id}
                          type="button"
                          onClick={() => setGenderPreference(g.id)}
                          className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                            genderPreference === g.id
                              ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                          }`}
                        >
                          {g.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Studio Smart Model Selector + Editor Utility Icons */}
                  <div className="flex flex-wrap items-center gap-2">
                    {renderInlineSlotSelector('smart_studio')}
                    <div className="flex items-center gap-1.5">
                    <button
                      onClick={handleRemoveAllDiacritics}
                      disabled={!inputText.trim() && !outputResult.trim()}
                      title={t.clearDiacriticsInstant}
                      aria-label={t.clearDiacriticsInstant}
                      className="h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0D11] text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 disabled:opacity-40 flex items-center gap-1.5 text-xs font-medium transition-colors whitespace-nowrap"
                    >
                      <Eraser size={15} />
                      <span className="hidden sm:inline">{t.clearDiacriticsInstant}</span>
                    </button>
                    <button
                      onClick={loadInput}
                      title={t.loadSaved}
                      aria-label={t.loadSaved}
                      className="h-9 w-9 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0D11] text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 flex items-center justify-center transition-colors"
                    >
                      <FolderOpen size={15} />
                    </button>
                    <button
                      onClick={saveInput}
                      title={t.saveText}
                      aria-label={t.saveText}
                      className="h-9 w-9 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0D11] text-slate-600 dark:text-slate-300 hover:text-emerald-600 dark:hover:text-emerald-400 flex items-center justify-center transition-colors"
                    >
                      <Save size={15} />
                    </button>
                    <button
                      onClick={() => setInputText('')}
                      title={t.clear}
                      aria-label={t.clear}
                      className="h-9 w-9 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0D11] text-slate-600 dark:text-slate-300 hover:text-red-500 flex items-center justify-center transition-colors"
                    >
                      <Trash2 size={15} />
                    </button>
                    </div>
                  </div>
                </div>

                {/* Main Textarea */}
                <textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder={t.mainInputPlaceholder}
                  rows={5}
                  className="w-full min-h-[168px] p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0D11] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-600 text-lg leading-[2] font-arabic resize-y focus:border-indigo-500 transition-colors"
                  aria-label={t.mainInputLabel}
                />

                {/* Voice Recording Bar (ASR Model + Live Dictation) & Quick Examples */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={toggleASRRecording}
                      disabled={isLoading}
                      className={`h-10 px-4 rounded-xl text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 ${
                        isRecordingASR
                          ? 'bg-red-600 hover:bg-red-500 text-white'
                          : 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white'
                      }`}
                    >
                      {isRecordingASR ? <MicOff size={15} /> : <Mic size={15} />}
                      <span>{isRecordingASR ? t.stopRecording : t.startRecording}</span>
                    </button>

                    <button
                      onClick={toggleLiveDictation}
                      className={`h-10 px-3.5 rounded-xl text-xs font-semibold border transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                        isDictatingLive
                          ? 'border-red-500 bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400'
                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/70 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      <AudioLines size={14} />
                      <span>{t.dictateLive}</span>
                    </button>

                    <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-400 cursor-pointer ps-2 select-none">
                      <input
                        type="checkbox"
                        checked={autoRead}
                        onChange={(e) => setAutoRead(e.target.checked)}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span>{t.autoReadLabel}</span>
                    </label>
                  </div>

                  {/* Clean inline example shortcuts */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span className="text-slate-400 dark:text-slate-500 font-medium">{t.examples}</span>
                    {[
                      {
                        label: t.exDiacritics,
                        text:
                          language === 'ar'
                            ? 'ده اللي خلقنا مش هينسانا، قادر يقوينا على ما بلانا، اللي قدر في يوم لقانا قادر يهديك زي ما هدانا'
                            : 'This is an Egyptian colloquial sentence for smart diacritics',
                      },
                      {
                        label: t.exSong,
                        text:
                          language === 'ar'
                            ? 'قصة شاب بيكافح في زحمة القاهرة وعنده طموح كبير'
                            : 'Story of a young man struggling in Cairo traffic with big ambition',
                      },
                      {
                        label: t.exMahragan,
                        text:
                          language === 'ar'
                            ? 'اكتب مهرجان عن الصحاب الجدعة والرجولة في وقت الشدة'
                            : 'Write a Mahragan about loyal friends in tough times',
                      },
                    ].map((ex, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setInputText(ex.text)}
                        className="text-indigo-600 dark:text-indigo-400 hover:underline font-medium whitespace-nowrap"
                      >
                        {ex.label}
                      </button>
                    ))}
                  </div>
                </div>

                <hr className="border-slate-200 dark:border-slate-800" />

                {/* =========================================================== */}
                {/* ORGANIZED STUDIO ACTION BAR 1: Diacritics & Proofreading    */}
                {/* =========================================================== */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400">
                      {t.diacriticsSection}
                    </h3>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <button
                      onClick={() => handleDiacriticsAction('smart_light')}
                      disabled={isLoading || !inputText.trim()}
                      className="h-11 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-40 whitespace-nowrap"
                    >
                      <Sparkles size={15} className="shrink-0" />
                      <span className="truncate">{t.lightDiacriticsBtn}</span>
                    </button>

                    <button
                      onClick={() => handleDiacriticsAction('phonetic_suno')}
                      disabled={isLoading || !inputText.trim()}
                      className="h-11 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-40 whitespace-nowrap"
                    >
                      <Feather size={15} className="shrink-0 text-indigo-500" />
                      <span className="truncate">{t.phoneticDiacriticsBtn}</span>
                    </button>

                    <button
                      onClick={() => handleDiacriticsAction('connected')}
                      disabled={isLoading || !inputText.trim()}
                      className="h-11 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-40 whitespace-nowrap"
                    >
                      <Sliders size={15} className="shrink-0 text-indigo-500" />
                      <span className="truncate">{t.connectedDiacriticsBtn}</span>
                    </button>

                    <button
                      onClick={() => handleDiacriticsAction('clean_standard')}
                      disabled={isLoading || !inputText.trim()}
                      className="h-11 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-40 whitespace-nowrap"
                    >
                      <Check size={15} className="shrink-0 text-indigo-500" />
                      <span className="truncate">{t.cleanStandardBtn}</span>
                    </button>
                  </div>
                </div>

                {/* =========================================================== */}
                {/* ORGANIZED STUDIO ACTION BAR 2: Songwriting & Music Tools    */}
                {/* =========================================================== */}
                <div className="space-y-3 pt-1">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400">
                      {t.songwritingSection}
                    </h3>

                    {/* Clean Compact Genre Dropdown replacing the 19-button wall */}
                    <div className="flex items-center gap-2">
                      <label
                        htmlFor="studio-genre-select"
                        className="text-xs font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap"
                      >
                        {t.genreLabel}:
                      </label>
                      <div className="relative">
                        <select
                          id="studio-genre-select"
                          value={genre}
                          onChange={(e) => setGenre(e.target.value)}
                          className="h-9 ps-3 pe-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0D11] text-xs font-semibold text-slate-800 dark:text-slate-200 appearance-none cursor-pointer"
                        >
                          {Object.entries(t.genres).map(([id, label]) => (
                            <option key={id} value={id}>
                              {label}
                            </option>
                          ))}
                        </select>
                        <ChevronDown
                          size={14}
                          className="pointer-events-none absolute top-1/2 -translate-y-1/2 end-2.5 text-slate-400"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {t.genreDescriptions[genre as keyof typeof t.genreDescriptions]}
                    </p>
                    <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-400 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={sunoWebSearch}
                        onChange={(e) => setSunoWebSearch(e.target.checked)}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <Globe size={13} className="text-indigo-500 shrink-0" />
                      <span>{t.sunoWebSearchLabel}</span>
                    </label>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    <button
                      onClick={() => handleLyricsAction('compose_song')}
                      disabled={isLoading || !inputText.trim()}
                      className="h-11 px-3 rounded-xl border border-indigo-600/30 dark:border-indigo-500/40 bg-indigo-50 dark:bg-indigo-950/30 hover:bg-indigo-100 dark:hover:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-40 whitespace-nowrap"
                    >
                      <Music size={15} className="shrink-0" />
                      <span className="truncate">{t.composeBtn}</span>
                    </button>

                    <button
                      onClick={() => handleLyricsAction('write_lyrics')}
                      disabled={isLoading || !inputText.trim()}
                      className="h-11 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-40 whitespace-nowrap"
                    >
                      <Feather size={15} className="shrink-0 text-slate-500" />
                      <span className="truncate">{t.writeLyricsBtn}</span>
                    </button>

                    <button
                      onClick={() => handleLyricsAction('format_lyrics')}
                      disabled={isLoading || (!inputText.trim() && !outputResult.trim())}
                      className="h-11 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-40 whitespace-nowrap"
                    >
                      <BookOpen size={15} className="shrink-0 text-slate-500" />
                      <span className="truncate">{t.formatLyricsBtn}</span>
                    </button>

                    <button
                      onClick={() => handleLyricsAction('analyze_lyrics')}
                      disabled={isLoading || (!inputText.trim() && !outputResult.trim())}
                      className="h-11 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-40 whitespace-nowrap"
                    >
                      <Search size={15} className="shrink-0 text-slate-500" />
                      <span className="truncate">{t.analyzeLyricsBtn}</span>
                    </button>

                    <button
                      onClick={() => setShowSunoModal(true)}
                      disabled={isLoading}
                      className="h-11 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-40 whitespace-nowrap"
                    >
                      <Headphones size={15} className="shrink-0 text-slate-500" />
                      <span className="truncate">{t.sunoPromptBtn}</span>
                    </button>

                    <button
                      onClick={() => setShowVoiceCloneModal(true)}
                      disabled={isLoading}
                      className="h-11 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-40 whitespace-nowrap"
                    >
                      <Mic size={15} className="shrink-0 text-slate-500" />
                      <span className="truncate">{t.voiceCloneBtn}</span>
                    </button>
                  </div>
                </div>
              </section>

              {/* Output Panel */}
              {renderOutputPanel()}
            </div>

            {/* Linguistic Tools & History Sidebar (4 cols) */}
            <aside className="lg:col-span-4 space-y-6">
              {/* 1. Diacritics Inspector (Script + Search Model) */}
              <section className="bg-white dark:bg-[#13161C] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <Search size={16} className="text-indigo-600 dark:text-indigo-400" />
                    <span>{t.inspectorTitle}</span>
                  </h2>
                  {renderInlineSlotSelector('diacritics_search')}
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={searchWord}
                    onChange={(e) => setSearchWord(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleWordSearch();
                    }}
                    placeholder={t.inspectorPlaceholder}
                    className="flex-1 h-10 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0D11] text-sm text-slate-900 dark:text-slate-100 focus:border-indigo-500"
                  />
                  <button
                    onClick={() => handleWordSearch()}
                    disabled={isSearchingWord || !searchWord.trim()}
                    className="h-10 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-40 whitespace-nowrap shrink-0"
                  >
                    {isSearchingWord ? (
                      <RefreshCw size={14} className="animate-spin" />
                    ) : (
                      <BookOpen size={14} />
                    )}
                    <span>{t.getDiacritics}</span>
                  </button>
                </div>

                <AnimatePresence mode="wait">
                  {wordSuggestions && (
                    <motion.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="space-y-3 pt-1"
                    >
                      {wordSuggestions.suggestions && (
                        <div className="space-y-2 max-h-80 overflow-y-auto pe-1 custom-scrollbar">
                          {wordSuggestions.suggestions.map((item: any, idx: number) => (
                            <div
                              key={idx}
                              className="flex items-start justify-between gap-2 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0D11]"
                            >
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-baseline gap-2">
                                  <span className="text-lg font-bold text-indigo-600 dark:text-indigo-400 font-arabic">
                                    {item.word}
                                  </span>
                                  {item.typeLabel && (
                                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                      · {item.typeLabel}
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                                  {item.meaning}
                                </p>
                              </div>
                              <button
                                onClick={() => speakText(item.word)}
                                className="h-9 w-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 flex items-center justify-center shrink-0 transition-colors"
                                aria-label={t.speakBtn}
                              >
                                <Volume2 size={15} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {wordSuggestions.synonyms?.length > 0 && (
                        <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
                          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">
                            {t.synonyms}
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {wordSuggestions.synonyms.map((s: string, i: number) => (
                              <button
                                key={i}
                                onClick={() => {
                                  setSearchWord(s);
                                  handleWordSearch(s);
                                }}
                                className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 text-xs font-medium text-slate-700 dark:text-slate-200 hover:border-indigo-500 transition-colors"
                              >
                                {s}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {wordSuggestions.antonyms?.length > 0 && (
                        <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
                          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">
                            {t.antonyms}
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {wordSuggestions.antonyms.map((a: string, i: number) => (
                              <button
                                key={i}
                                onClick={() => {
                                  setSearchWord(a);
                                  handleWordSearch(a);
                                }}
                                className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 text-xs font-medium text-slate-700 dark:text-slate-200 hover:border-indigo-500 transition-colors"
                              >
                                {a}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {wordSuggestions.sourcesChecked?.length > 0 && (
                        <p className="text-[11px] text-slate-400 dark:text-slate-500 pt-1">
                          {t.sourcesChecked}: {wordSuggestions.sourcesChecked.join(' · ')}
                        </p>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </section>

              {/* 2. Rhymes & Line Rewriter (Tabbed Unified Card) */}
              <section className="bg-white dark:bg-[#13161C] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                    {toolSubTab === 'rhymes' ? t.rhymesTab : t.rewriteTab}
                  </span>
                  {renderInlineSlotSelector('rhyme_rewrite')}
                </div>
                <div className="flex items-center p-1 rounded-xl bg-slate-100 dark:bg-[#0B0D11] border border-slate-200 dark:border-slate-800">
                  <button
                    onClick={() => setToolSubTab('rhymes')}
                    className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors ${
                      toolSubTab === 'rhymes'
                        ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                  >
                    {t.rhymesTab}
                  </button>
                  <button
                    onClick={() => setToolSubTab('rewrite')}
                    className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors ${
                      toolSubTab === 'rewrite'
                        ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                  >
                    {t.rewriteTab}
                  </button>
                </div>

                {toolSubTab === 'rhymes' ? (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={rhymeWord}
                      onChange={(e) => setRhymeWord(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleFindRhymes();
                      }}
                      placeholder={t.rhymePlaceholder}
                      className="flex-1 h-10 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0D11] text-sm text-slate-900 dark:text-slate-100 focus:border-indigo-500"
                    />
                    <button
                      onClick={handleFindRhymes}
                      disabled={isLoading || !rhymeWord.trim()}
                      className="h-10 px-4 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white text-xs font-semibold transition-colors disabled:opacity-40 whitespace-nowrap shrink-0"
                    >
                      {t.rhymes}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    <input
                      type="text"
                      value={lineToRewrite}
                      onChange={(e) => setLineToRewrite(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRewriteLine();
                      }}
                      placeholder={t.rewritePlaceholder}
                      className="w-full h-10 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0D11] text-sm text-slate-900 dark:text-slate-100 focus:border-indigo-500"
                    />
                    <button
                      onClick={handleRewriteLine}
                      disabled={isLoading || !lineToRewrite.trim()}
                      className="w-full h-10 px-4 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white text-xs font-semibold transition-colors disabled:opacity-40"
                    >
                      {t.rewrite}
                    </button>
                  </div>
                )}
              </section>

              {/* 3. Recent History (Single Clean List — No Duplication!) */}
              {history.length > 0 && (
                <section className="bg-white dark:bg-[#13161C] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                      <HistoryIcon size={16} className="text-slate-500" />
                      <span>{t.recentHistory}</span>
                    </h2>
                    <button
                      onClick={() => setHistory([])}
                      className="text-xs font-medium text-red-500 hover:underline"
                    >
                      {t.clearHistory}
                    </button>
                  </div>

                  <div className="space-y-2 max-h-72 overflow-y-auto pe-1 custom-scrollbar">
                    {history.slice(0, 12).map((item) => (
                      <button
                        key={item.id}
                        onClick={() => {
                          setInputText(item.input);
                          setOutputResult(item.output);
                          setOutputType(item.type);
                        }}
                        className="w-full text-start p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0D11] hover:border-indigo-500/60 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                          <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                            {item.type}
                          </span>
                          <span className="font-mono tabular-nums">
                            {new Date(item.timestamp).toLocaleTimeString(
                              language === 'ar' ? 'ar-EG' : 'en-US',
                              { hour: '2-digit', minute: '2-digit' }
                            )}
                          </span>
                        </div>
                        <p className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate">
                          {item.input}
                        </p>
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </aside>
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 2: AUDIO, YOUTUBE & WEB LYRICS AGENT                            */}
        {/* =================================================================== */}
        {activeTab === 'audio' && (
          <div className="max-w-4xl mx-auto space-y-6">
            <section className="bg-white dark:bg-[#13161C] border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
                {renderInlineSlotSelector('asr_diacritics', language === 'ar' ? 'موديل السمع (ASR):' : 'ASR Model:')}
                {renderInlineSlotSelector('tts_reader', language === 'ar' ? 'موديل القراءة (TTS):' : 'TTS Model:')}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full h-12 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0D11] hover:bg-slate-100 dark:hover:bg-slate-800 text-sm font-semibold text-slate-800 dark:text-slate-100 flex items-center justify-center gap-2 transition-colors"
                  >
                    <Upload size={17} />
                    <span>{audioFile ? t.changeAudio : t.uploadAudio}</span>
                  </button>
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleAudioUpload}
                    accept="audio/*"
                    className="hidden"
                    aria-label={t.uploadAudio}
                  />
                  {audioFile && (
                    <div className="mt-2 flex items-center justify-between text-xs text-emerald-600 dark:text-emerald-400 font-medium px-1">
                      <span className="truncate">{audioFile.name}</span>
                      <span className="font-mono tabular-nums" dir="ltr">
                        {audioFile.size >= 1024 * 1024
                          ? `${(audioFile.size / (1024 * 1024)).toFixed(1)} MB`
                          : `${Math.max(1, Math.round(audioFile.size / 1024))} KB`}
                      </span>
                    </div>
                  )}
                </div>

                <div className="relative">
                  <input
                    type="text"
                    value={youtubeLink}
                    onChange={(e) => setYoutubeLink(e.target.value)}
                    placeholder={t.youtubeLinkPlaceholder}
                    className="w-full h-12 ps-10 pe-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0D11] text-sm text-slate-900 dark:text-slate-100 focus:border-indigo-500"
                  />
                  <Youtube
                    size={18}
                    className="absolute top-1/2 -translate-y-1/2 start-3.5 text-slate-400"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 pt-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  onClick={() => processAudioASR('egyptian')}
                  disabled={isLoading || !audioFile}
                  className="h-11 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-40 whitespace-nowrap"
                >
                  <FileAudio size={15} />
                  <span>{t.transcribeEgyptian}</span>
                </button>

                <button
                  onClick={() => processAudioASR('general')}
                  disabled={isLoading || !audioFile}
                  className="h-11 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-40 whitespace-nowrap"
                >
                  <FileAudio size={15} />
                  <span>{t.transcribeGeneral}</span>
                </button>

                <button
                  onClick={() => processAudioASR('clean_standard')}
                  disabled={isLoading || !audioFile}
                  className="h-11 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-40 whitespace-nowrap"
                >
                  <Eraser size={15} />
                  <span>{t.cleanStandardAudioBtn}</span>
                </button>

                <button
                  onClick={() => handleAudioMusicAnalysis('suno_1000')}
                  disabled={isLoading || (!audioFile && !youtubeLink.trim())}
                  className="h-11 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-40 whitespace-nowrap"
                >
                  <Music size={15} />
                  <span>{t.analyzeMusic}</span>
                </button>

                <button
                  onClick={() => handleAudioMusicAnalysis('deep_analysis')}
                  disabled={isLoading || (!audioFile && !youtubeLink.trim())}
                  className="h-11 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-40 whitespace-nowrap"
                >
                  <Search size={15} />
                  <span>{t.deepMusicAnalysisBtn}</span>
                </button>
              </div>
            </section>

            {/* Web Lyrics & Song Scraper AI Agent Card */}
            <section className="bg-white dark:bg-[#13161C] border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Globe size={18} className="text-indigo-600 dark:text-indigo-400" />
                    <span>{t.webAgentTitle}</span>
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t.webAgentSubtitle}</p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {renderInlineSlotSelector('web_lyrics_agent')}
                  <div className="inline-flex items-center p-0.5 rounded-lg bg-slate-100 dark:bg-[#0B0D11] border border-slate-200 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setWebAgentMode('url')}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                      webAgentMode === 'url'
                        ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {t.webAgentModeUrl}
                  </button>
                  <button
                    type="button"
                    onClick={() => setWebAgentMode('search')}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                      webAgentMode === 'search'
                        ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {t.webAgentModeSearch}
                  </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                <div className="md:col-span-7">
                  <input
                    type={webAgentMode === 'url' ? 'url' : 'text'}
                    value={webAgentMode === 'url' ? webAgentUrl : webAgentQuery}
                    onChange={(e) =>
                      webAgentMode === 'url'
                        ? setWebAgentUrl(e.target.value)
                        : setWebAgentQuery(e.target.value)
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRunWebAgent();
                    }}
                    placeholder={
                      webAgentMode === 'url' ? t.webAgentUrlPlaceholder : t.webAgentQueryPlaceholder
                    }
                    dir={webAgentMode === 'url' ? 'ltr' : undefined}
                    className="w-full h-11 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0D11] text-sm text-slate-900 dark:text-slate-100 focus:border-indigo-500"
                  />
                </div>

                <div className="md:col-span-5 flex gap-2">
                  <div className="relative flex-1">
                    <select
                      value={webAgentTask}
                      onChange={(e) => setWebAgentTask(e.target.value as WebAgentTask)}
                      aria-label={t.webAgentTaskLabel}
                      className="w-full h-11 ps-3 pe-8 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0D11] text-xs font-semibold text-slate-800 dark:text-slate-200 appearance-none cursor-pointer"
                    >
                      <option value="extract_lyrics">{t.webAgentTaskExtract}</option>
                      <option value="diacritize_smart">{t.webAgentTaskSmart}</option>
                      <option value="phonetic_suno">{t.webAgentTaskPhonetic}</option>
                      <option value="analyze_and_prompt">{t.webAgentTaskPrompt}</option>
                      <option value="custom">{t.webAgentTaskCustom}</option>
                    </select>
                    <ChevronDown
                      size={14}
                      className="pointer-events-none absolute top-1/2 -translate-y-1/2 end-2.5 text-slate-400"
                    />
                  </div>

                  <button
                    onClick={handleRunWebAgent}
                    disabled={
                      isLoading ||
                      (webAgentMode === 'url' ? !webAgentUrl.trim() : !webAgentQuery.trim())
                    }
                    className="h-11 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs sm:text-sm font-semibold flex items-center gap-2 transition-colors disabled:opacity-40 whitespace-nowrap shrink-0"
                  >
                    <Globe size={15} />
                    <span>{t.webAgentRunBtn}</span>
                  </button>
                </div>
              </div>

              {webAgentTask === 'custom' && (
                <input
                  type="text"
                  value={webAgentCustomInstruction}
                  onChange={(e) => setWebAgentCustomInstruction(e.target.value)}
                  placeholder={t.webAgentCustomPlaceholder}
                  className="w-full h-10 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0D11] text-sm text-slate-900 dark:text-slate-100 focus:border-indigo-500"
                />
              )}

              {webSearchHits.length > 0 && (
                <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
                  {webSearchHits.slice(0, 4).map((hit, i) => (
                    <div
                      key={i}
                      className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0D11] flex items-start justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <a
                          href={hit.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1"
                        >
                          <span className="truncate">{hit.title}</span>
                          <ExternalLink size={12} className="shrink-0" />
                        </a>
                        {hit.snippet && (
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                            {hit.snippet}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setWebAgentMode('url');
                          setWebAgentUrl(hit.url);
                        }}
                        className="h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:border-indigo-500 whitespace-nowrap shrink-0"
                      >
                        {t.webAgentModeUrl}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {renderOutputPanel()}
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 3: DIRECT LOCAL DISK MODELS, HOST MACHINE & 8-SLOT SELECTORS    */}
        {/* =================================================================== */}
        {activeTab === 'models' && (
          <div className="max-w-6xl mx-auto space-y-6">
            {/* 1. Direct Local Disk Models Hub (Zero External API Needed) */}
            <section className="bg-white dark:bg-[#13161C] border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="max-w-2xl">
                  <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <FolderOpen size={18} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
                    <span>{t.localDiskHubTitle}</span>
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
                    {t.localDiskHubSubtitle}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleScanPartitions(true)}
                    disabled={isScanningPartitions || isAutoAssigning}
                    className="h-10 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-2 transition-colors disabled:opacity-40 whitespace-nowrap"
                  >
                    <Zap size={14} />
                    <span>{isScanningPartitions ? t.scanningPartitions : t.scanAllPartitionsBtn}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAutoAssignModels(true)}
                    disabled={isAutoAssigning || isScanningPartitions}
                    className="h-10 px-3.5 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 text-xs font-semibold flex items-center gap-2 transition-colors disabled:opacity-40 whitespace-nowrap"
                  >
                    <span>{isAutoAssigning ? t.autoAssignRunning : t.autoAssignBtn}</span>
                  </button>
                  <button
                    onClick={fetchModelsStatus}
                    disabled={isLoadingModels}
                    className="h-10 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap"
                  >
                    <RefreshCw size={14} className={isLoadingModels ? 'animate-spin' : ''} />
                    <span>{t.refreshModels}</span>
                  </button>
                </div>
              </div>

              {partitionScan && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
                  <span className="font-semibold">{t.partitionsScannedLabel}</span>
                  <span className="font-mono font-semibold text-slate-900 dark:text-slate-100" dir="ltr">
                    {partitionScan.scannedPartitions.join(' · ')}
                  </span>
                  <span className="font-mono tabular-nums" dir="ltr">
                    ({partitionScan.discoveredModelsCount} models · {partitionScan.discoveredRoots.length} roots · {partitionScan.durationMs}ms)
                  </span>
                </div>
              )}

              {autoAssignNotice && (
                <div className="p-3 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/30 text-xs text-emerald-700 dark:text-emerald-300 font-medium">
                  {autoAssignNotice}
                </div>
              )}

              {/* Local Models Folder Root Path Input + Scan */}
              <div className="flex flex-wrap items-center gap-2.5">
                <label
                  htmlFor="local-models-root-input"
                  className="text-xs font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap"
                >
                  {t.localModelsRootLabel}
                </label>
                <input
                  id="local-models-root-input"
                  type="text"
                  value={localModelsRootInput}
                  onChange={(e) => setLocalModelsRootInput(e.target.value)}
                  placeholder={t.localModelsRootPlaceholder}
                  dir="ltr"
                  className="flex-1 min-w-[240px] h-10 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0D11] text-xs font-mono text-slate-800 dark:text-slate-200 focus:border-indigo-500"
                />
                <button
                  type="button"
                  onClick={handleSetLocalModelsRoot}
                  disabled={isScanningDisk}
                  className="h-10 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-2 transition-colors disabled:opacity-40 whitespace-nowrap shrink-0"
                >
                  <RefreshCw size={14} className={isScanningDisk ? 'animate-spin' : ''} />
                  <span>{isScanningDisk ? t.scanningDiskModels : t.scanDiskModelsBtn}</span>
                </button>
              </div>

              {/* Real Host Machine Facts & Python ML Packages Readiness */}
              {machineEnv && (
                <div className="space-y-4 pt-3 border-t border-slate-200 dark:border-slate-800">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                    <div>
                      <span className="text-slate-500 dark:text-slate-400 block mb-0.5">{t.cpuCores}</span>
                      <span className="font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums" dir="ltr">
                        {machineEnv.cpuCores} Cores · {machineEnv.arch}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 dark:text-slate-400 block mb-0.5">{t.ramMemory}</span>
                      <span className="font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums" dir="ltr">
                        {machineEnv.freeMemoryGb} / {machineEnv.totalMemoryGb} GB
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 dark:text-slate-400 block mb-0.5">{t.pythonRuntime}</span>
                      <span
                        className={`font-mono font-semibold ${
                          machineEnv.pythonAvailable
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-amber-600 dark:text-amber-400'
                        }`}
                        dir="ltr"
                      >
                        {machineEnv.pythonAvailable
                          ? machineEnv.pythonVersion || t.pythonReady
                          : t.pythonNotFound}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 dark:text-slate-400 block mb-0.5">{t.cloudFallbackKey}</span>
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {machineEnv.geminiKeyConfigured ? t.keyActive : t.keyMissing}
                      </span>
                    </div>
                  </div>

                  {machineEnv.pythonPackages && (
                    <div className="pt-3 border-t border-slate-200/70 dark:border-slate-800/70 flex flex-wrap items-center justify-between gap-3">
                      <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                        {t.pythonLibrariesLabel}:
                      </span>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs font-mono" dir="ltr">
                        {Object.entries(machineEnv.pythonPackages).map(([pkg, installed]) => (
                          <span
                            key={pkg}
                            className={
                              installed
                                ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                                : 'text-slate-500 dark:text-slate-400'
                            }
                          >
                            {pkg}: {installed ? t.libInstalled : t.libMissing}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Optional Collapsible External Local Server Connector (Ollama / LM Studio / llama.cpp) */}
              <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowLocalApiPanel((prev) => !prev)}
                  className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1.5"
                >
                  <Server size={14} />
                  <span>{t.optionalApiServerToggle}</span>
                  <ChevronDown
                    size={14}
                    className={`transition-transform ${showLocalApiPanel ? 'rotate-180' : ''}`}
                  />
                </button>

                {showLocalApiPanel && (
                  <div className="mt-4 space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="url"
                        value={customProbeUrl}
                        onChange={(e) => setCustomProbeUrl(e.target.value)}
                        placeholder={t.customProbePlaceholder}
                        dir="ltr"
                        className="h-10 flex-1 min-w-[220px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0D11] text-xs font-mono text-slate-800 dark:text-slate-200"
                      />
                      <button
                        type="button"
                        onClick={handleScanLocalLlms}
                        disabled={isScanningLocal}
                        className="h-10 px-4 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white text-xs font-semibold flex items-center gap-2 transition-colors disabled:opacity-40 whitespace-nowrap shrink-0"
                      >
                        <RefreshCw size={14} className={isScanningLocal ? 'animate-spin' : ''} />
                        <span>{isScanningLocal ? t.scanningLocal : t.scanLocalBtn}</span>
                      </button>
                    </div>

                    {localServers.length > 0 && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {localServers.map((srv) => (
                          <div
                            key={srv.id}
                            className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0D11] space-y-2"
                          >
                            <div className="flex items-center justify-between gap-2" dir="ltr">
                              <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                                {srv.label}
                              </span>
                              <span
                                className={`text-[11px] font-semibold ${
                                  srv.online
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : 'text-slate-400 dark:text-slate-500'
                                }`}
                              >
                                {srv.online ? t.serverOnline : `${t.serverOffline} (${srv.error || '—'})`}
                              </span>
                            </div>
                            <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400" dir="ltr">
                              {srv.baseUrl}
                            </p>
                            {srv.online && (
                              <div className="flex flex-wrap gap-1.5 pt-1" dir="ltr">
                                {srv.models.length > 0 ? (
                                  srv.models.map((mName) => (
                                    <button
                                      key={mName}
                                      type="button"
                                      onClick={() => {
                                        setQuickProvider(srv.providerType);
                                        setQuickEndpoint(srv.baseUrl);
                                        setQuickModel(mName);
                                      }}
                                      className="px-2.5 py-1 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 text-[11px] font-mono hover:bg-indigo-100 dark:hover:bg-indigo-900/60 transition-colors"
                                    >
                                      {mName}
                                    </button>
                                  ))
                                ) : (
                                  <span className="text-[11px] text-slate-400">{t.noLocalModels}</span>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5" dir="ltr">
                      <select
                        value={quickProvider}
                        onChange={(e) => {
                          const val = e.target.value as 'ollama' | 'openai_compatible';
                          setQuickProvider(val);
                          if (val === 'ollama' && quickEndpoint.includes('1234')) {
                            setQuickEndpoint('http://127.0.0.1:11434');
                          } else if (val === 'openai_compatible' && quickEndpoint.includes('11434')) {
                            setQuickEndpoint('http://127.0.0.1:1234/v1');
                          }
                        }}
                        className="h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0D11] text-xs font-semibold text-slate-800 dark:text-slate-200"
                      >
                        <option value="ollama">{t.providerOptions.ollama}</option>
                        <option value="openai_compatible">{t.providerOptions.openai_compatible}</option>
                      </select>

                      <input
                        type="url"
                        value={quickEndpoint}
                        onChange={(e) => setQuickEndpoint(e.target.value)}
                        placeholder={t.endpointPlaceholder}
                        className="h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0D11] text-xs font-mono text-slate-800 dark:text-slate-200"
                      />

                      <input
                        type="text"
                        value={quickModel}
                        onChange={(e) => setQuickModel(e.target.value)}
                        placeholder={t.modelNamePlaceholder}
                        className="h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0D11] text-xs font-mono text-slate-800 dark:text-slate-200"
                      />

                      <input
                        type="password"
                        value={quickApiKey}
                        onChange={(e) => setQuickApiKey(e.target.value)}
                        placeholder={t.apiKeyPlaceholder}
                        className="h-10 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0D11] text-xs font-mono text-slate-800 dark:text-slate-200"
                      />
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={quickStrictLocal}
                          onChange={(e) => setQuickStrictLocal(e.target.checked)}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span>{t.strictLocalLabel}</span>
                      </label>

                      <button
                        type="button"
                        onClick={handleApplyLocalLlmPreset}
                        disabled={isApplyingQuickLocal || !quickEndpoint.trim()}
                        className="h-10 px-4 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white text-xs font-semibold flex items-center gap-2 transition-colors disabled:opacity-40 whitespace-nowrap shrink-0"
                      >
                        <Zap size={14} />
                        <span>{t.applyLocalAllBtn}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* 1.5 GPU / VRAM Lifecycle, Park/Restore & Tuning Manager */}
            {vramStatus && (
              <section className="bg-white dark:bg-[#13161C] border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="max-w-2xl">
                    <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <Zap size={18} className="text-amber-500 shrink-0" />
                      <span>{t.vramTitle}</span>
                    </h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
                      {t.vramSubtitle}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleRefreshGpuVram('manual_refresh')}
                      disabled={isRefreshingGpu || isUnloadingGpu}
                      className="h-10 px-4 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 text-xs font-semibold flex items-center gap-2 transition-colors disabled:opacity-40 whitespace-nowrap"
                    >
                      <RefreshCw size={14} className={isRefreshingGpu ? 'animate-spin' : ''} />
                      <span>{isRefreshingGpu ? t.refreshingGpu : t.refreshGpuNowBtn}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleUnloadAllGpu('manual')}
                      disabled={isUnloadingGpu || isRefreshingGpu}
                      className="h-10 px-4 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white text-xs font-semibold flex items-center gap-2 transition-colors disabled:opacity-40 whitespace-nowrap"
                    >
                      <Trash2 size={14} />
                      <span>{isUnloadingGpu ? t.unloadingGpu : t.unloadAllNowBtn}</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-3 border-t border-slate-200 dark:border-slate-800 text-xs">
                  <div>
                    <span className="text-slate-500 dark:text-slate-400 block mb-0.5">{t.activeInVramLabel}</span>
                    <span
                      className={`font-mono font-semibold ${
                        vramStatus.activeLoadedModel ||
                        vramStatus.pythonWorkerRunning ||
                        vramStatus.ollamaLoadedModels.length > 0
                          ? 'text-indigo-600 dark:text-indigo-400'
                          : 'text-emerald-600 dark:text-emerald-400'
                      }`}
                      dir="ltr"
                    >
                      {vramStatus.activeLoadedModel
                        ? `${vramStatus.activeLoadedModel.adapter}:${vramStatus.activeLoadedModel.modelLabel}${
                            vramStatus.idleSecondsRemaining !== null
                              ? ` (${vramStatus.idleSecondsRemaining}s)`
                              : ''
                          }`
                        : vramStatus.ollamaLoadedModels.length > 0
                        ? vramStatus.ollamaLoadedModels.map((m) => m.name).join(', ')
                        : vramStatus.pythonWorkerRunning
                        ? 'local_disk:worker'
                        : t.noModelInVram}
                    </span>
                    {vramStatus.suspendedModel && (
                      <span className="block text-[11px] font-mono text-amber-600 dark:text-amber-400 mt-0.5" dir="ltr">
                        {t.parkedModelLabel} {vramStatus.suspendedModel.modelLabel}
                      </span>
                    )}
                  </div>

                  <div>
                    <span className="text-slate-500 dark:text-slate-400 block mb-0.5">{t.gpuHardwareLabel}</span>
                    <span className="font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums" dir="ltr">
                      {vramStatus.gpuInfo.available
                        ? `${vramStatus.gpuInfo.name || 'GPU'} · ${vramStatus.gpuInfo.vramFreeMb ?? '?'} / ${
                            vramStatus.gpuInfo.vramTotalMb ?? '?'
                          } MB`
                        : t.noNvidiaGpuLabel}
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-500 dark:text-slate-400 block mb-0.5">{t.lastFlushLabel}</span>
                    <span className="font-mono text-slate-700 dark:text-slate-300" dir="ltr">
                      {vramStatus.lastUnloadReport
                        ? `${vramStatus.lastUnloadReport.reason} (${vramStatus.lastUnloadReport.unloaded.length})`
                        : '—'}
                    </span>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                    <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={vramStatus.policy.singleModelOnly}
                        onChange={(e) => handleUpdateVramPolicy({ singleModelOnly: e.target.checked })}
                        disabled={isUpdatingVramPolicy}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span>{t.singleModelOnlyLabel}</span>
                    </label>

                    <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={vramStatus.policy.restorePreviousModel}
                        onChange={(e) => handleUpdateVramPolicy({ restorePreviousModel: e.target.checked })}
                        disabled={isUpdatingVramPolicy || !vramStatus.policy.singleModelOnly}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-40"
                      />
                      <span>{t.restorePreviousLabel}</span>
                    </label>

                    <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={vramStatus.policy.refreshAfterMultiModel}
                        onChange={(e) => handleUpdateVramPolicy({ refreshAfterMultiModel: e.target.checked })}
                        disabled={isUpdatingVramPolicy}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span>{t.refreshAfterMultiLabel}</span>
                    </label>

                    <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={vramStatus.policy.unloadOnExit}
                        onChange={(e) => handleUpdateVramPolicy({ unloadOnExit: e.target.checked })}
                        disabled={isUpdatingVramPolicy}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span>{t.unloadOnExitLabel}</span>
                    </label>
                  </div>

                  <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-slate-200/70 dark:border-slate-800/70">
                    <div className="inline-flex items-center gap-2">
                      <label
                        htmlFor="vram-idle-select"
                        className="text-xs font-semibold text-slate-600 dark:text-slate-400 whitespace-nowrap"
                      >
                        {t.idleUnloadLabel}
                      </label>
                      <select
                        id="vram-idle-select"
                        value={String(vramStatus.policy.idleUnloadSeconds)}
                        onChange={(e) =>
                          handleUpdateVramPolicy({ idleUnloadSeconds: Number(e.target.value) })
                        }
                        disabled={isUpdatingVramPolicy}
                        className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0D11] text-xs font-semibold text-slate-800 dark:text-slate-200 cursor-pointer"
                      >
                        <option value="0">{t.unloadImmediateOption}</option>
                        <option value="30">30 {t.unloadSecondsOption}</option>
                        <option value="60">60 {t.unloadSecondsOption}</option>
                        <option value="120">120 {t.unloadSecondsOption}</option>
                        <option value="300">300 {t.unloadSecondsOption}</option>
                      </select>
                    </div>

                    <div className="inline-flex items-center gap-2">
                      <label
                        htmlFor="vram-limit-select"
                        className="text-xs font-semibold text-slate-600 dark:text-slate-400 whitespace-nowrap"
                      >
                        {t.gpuLimitLabel}
                      </label>
                      <select
                        id="vram-limit-select"
                        value={String(vramStatus.policy.gpuMemoryLimitPercent)}
                        onChange={(e) =>
                          handleUpdateVramPolicy({ gpuMemoryLimitPercent: Number(e.target.value) })
                        }
                        disabled={isUpdatingVramPolicy}
                        className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0D11] text-xs font-mono font-semibold text-slate-800 dark:text-slate-200 cursor-pointer"
                      >
                        <option value="65">65%</option>
                        <option value="75">75%</option>
                        <option value="80">80%</option>
                        <option value="85">85%</option>
                        <option value="90">90%</option>
                        <option value="95">95%</option>
                      </select>
                    </div>

                    <div className="inline-flex items-center gap-2">
                      <label
                        htmlFor="vram-headroom-select"
                        className="text-xs font-semibold text-slate-600 dark:text-slate-400 whitespace-nowrap"
                      >
                        {t.minFreeVramLabel}
                      </label>
                      <select
                        id="vram-headroom-select"
                        value={String(vramStatus.policy.minFreeVramMb)}
                        onChange={(e) =>
                          handleUpdateVramPolicy({ minFreeVramMb: Number(e.target.value) })
                        }
                        disabled={isUpdatingVramPolicy}
                        className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0D11] text-xs font-mono font-semibold text-slate-800 dark:text-slate-200 cursor-pointer"
                      >
                        <option value="512">512 MB</option>
                        <option value="1024">1024 MB</option>
                        <option value="2048">2048 MB</option>
                        <option value="4096">4096 MB</option>
                      </select>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* 2. 8-Slot Architecture & Per-Service Model Picker */}
            <section className="bg-white dark:bg-[#13161C] border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Cpu size={20} className="text-indigo-600 dark:text-indigo-400" />
                    <span>{t.modelsTitle}</span>
                  </h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t.modelsSubtitle}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {modelSlots.map((slot) => {
                  const slotTest = testResults[slot.id];
                  const diskModels = slot.availableLocalModels || [];
                  return (
                    <div
                      key={slot.id}
                      className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0D11] space-y-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                            {language === 'ar' ? slot.nameAr : slot.nameEn}
                          </h3>
                          {(slot.roleAr || slot.roleEn) && (
                            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                              {language === 'ar' ? slot.roleAr : slot.roleEn}
                            </p>
                          )}
                        </div>
                        <span
                          className={`text-[11px] font-mono font-semibold shrink-0 whitespace-nowrap ${
                            slot.activeAdapter === 'fallback_ai'
                              ? 'text-slate-500 dark:text-slate-400'
                              : 'text-emerald-600 dark:text-emerald-400'
                          }`}
                          dir="ltr"
                        >
                          {slot.activeAdapter}
                        </span>
                      </div>

                      <div className="text-xs font-mono text-slate-500 dark:text-slate-400 space-y-1" dir="ltr">
                        <div>
                          Folder: <span className="text-slate-800 dark:text-slate-200">{slot.folder}/</span>
                          {slot.apiEndpoint && (
                            <>
                              {' · '}API:{' '}
                              <span className="text-indigo-600 dark:text-indigo-400">{slot.apiEndpoint}</span>
                            </>
                          )}
                        </div>
                        {slot.helperScript && (
                          <div>
                            Script: <span className="text-indigo-600 dark:text-indigo-400">{slot.helperScript}</span>
                          </div>
                        )}
                      </div>

                      {/* Prominent Per-Service Local Disk Model Picker */}
                      <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2">
                        <label
                          htmlFor={`slot-disk-select-${slot.id}`}
                          className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                        >
                          {t.selectModelForService}
                        </label>
                        <div className="relative">
                          <select
                            id={`slot-disk-select-${slot.id}`}
                            value={selectedPathDrafts[slot.id] ?? slot.selectedModelPath ?? ''}
                            onChange={(e) => handleSelectSlotModel(slot.id, e.target.value)}
                            disabled={savingSlotId === slot.id}
                            className="w-full h-10 ps-3 pe-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#13161C] text-xs font-semibold text-slate-900 dark:text-slate-100 appearance-none cursor-pointer"
                          >
                            <option value="">
                              {slot.inheritedFrom === 'smart_studio'
                                ? `${t.inheritedFromSmartStudio}${
                                    slot.effectiveModelLabel ? ` (${slot.effectiveModelLabel})` : ''
                                  }`
                                : t.defaultBuiltInFallback}
                            </option>
                            {diskModels.map((m) => (
                              <option key={m.path} value={m.path}>
                                {m.name} · {m.kind.toUpperCase()} · {m.sizeLabel} ({m.source === 'slot_folder' ? slot.folder : m.relativePath})
                              </option>
                            ))}
                          </select>
                          <ChevronDown
                            size={14}
                            className="pointer-events-none absolute top-1/2 -translate-y-1/2 end-2.5 text-slate-400"
                          />
                        </div>

                        {diskModels.length === 0 && (
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            {t.noDiskModelsFound}
                          </p>
                        )}

                        <input
                          type="text"
                          value={selectedPathDrafts[slot.id] ?? ''}
                          onChange={(e) =>
                            setSelectedPathDrafts((prev) => ({ ...prev, [slot.id]: e.target.value }))
                          }
                          placeholder={t.selectedModelPathPlaceholder}
                          dir="ltr"
                          className="w-full h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#13161C] text-xs font-mono text-slate-800 dark:text-slate-200 focus:border-indigo-500"
                        />

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" dir="ltr">
                          <select
                            value={providerDrafts[slot.id] ?? slot.providerType ?? 'auto'}
                            onChange={(e) =>
                              setProviderDrafts((prev) => ({
                                ...prev,
                                [slot.id]: e.target.value as ProviderType,
                              }))
                            }
                            aria-label={t.providerLabel}
                            className="h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#13161C] text-xs font-medium text-slate-800 dark:text-slate-200"
                          >
                            <option value="auto">{t.providerOptions.auto}</option>
                            <option value="local_disk">{t.providerOptions.local_disk}</option>
                            <option value="python_cli">{t.providerOptions.python_cli}</option>
                            {slot.supportsLocalLlm && (
                              <>
                                <option value="ollama">{t.providerOptions.ollama}</option>
                                <option value="openai_compatible">{t.providerOptions.openai_compatible}</option>
                              </>
                            )}
                            {!slot.supportsLocalLlm && (
                              <option value="openai_audio">{t.providerOptions.openai_audio}</option>
                            )}
                            <option value="http_custom">{t.providerOptions.http_custom}</option>
                            <option value="fallback_ai">{t.providerOptions.fallback_ai}</option>
                          </select>

                          <input
                            type="text"
                            value={modelNameDrafts[slot.id] ?? ''}
                            onChange={(e) =>
                              setModelNameDrafts((prev) => ({ ...prev, [slot.id]: e.target.value }))
                            }
                            placeholder={t.modelNamePlaceholder}
                            className="h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#13161C] text-xs font-mono text-slate-800 dark:text-slate-200 focus:border-indigo-500"
                          />
                        </div>

                        <div className="flex gap-2" dir="ltr">
                          <input
                            type="url"
                            value={endpointDrafts[slot.id] ?? ''}
                            onChange={(e) =>
                              setEndpointDrafts((prev) => ({ ...prev, [slot.id]: e.target.value }))
                            }
                            placeholder={t.endpointPlaceholder}
                            className="flex-1 h-9 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#13161C] text-xs font-mono text-slate-800 dark:text-slate-200 focus:border-indigo-500"
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveModelConfig(slot.id)}
                            disabled={savingSlotId === slot.id}
                            className="h-9 px-3 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white text-xs font-semibold transition-colors disabled:opacity-40 whitespace-nowrap shrink-0"
                          >
                            {t.saveEndpoint}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleTestModelSlot(slot.id)}
                            disabled={testingSlotId === slot.id}
                            className="h-9 px-3 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 text-xs font-semibold transition-colors disabled:opacity-40 whitespace-nowrap shrink-0"
                          >
                            {testingSlotId === slot.id ? t.testingConnection : t.testConnectionBtn}
                          </button>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                          <label className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-600 dark:text-slate-400 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={Boolean(slot.strictLocal)}
                              onChange={(e) => handleToggleStrictLocal(slot.id, e.target.checked)}
                              disabled={savingSlotId === slot.id}
                              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            <span>{t.strictLocalLabel}</span>
                          </label>

                          {slot.supportsInternet && (
                            <button
                              type="button"
                              onClick={() => handleToggleModelInternet(slot.id, !slot.internetAccess)}
                              disabled={savingSlotId === slot.id}
                              className={`h-7 px-2.5 rounded-lg border text-[11px] font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                                slot.internetAccess
                                  ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                              }`}
                            >
                              <Globe size={12} />
                              <span>{slot.internetAccess ? t.internetOn : t.internetOff}</span>
                            </button>
                          )}
                        </div>

                        {slotTest && (
                          <div
                            className={`p-2.5 rounded-lg text-xs font-mono border ${
                              slotTest.ok
                                ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
                                : 'border-red-200 dark:border-red-900/60 bg-red-50/70 dark:bg-red-950/30 text-red-700 dark:text-red-300'
                            }`}
                            dir="ltr"
                          >
                            {slotTest.ok
                              ? `OK · ${slotTest.engine} (${slotTest.latencyMs}ms) → ${slotTest.sampleOutput}`
                              : `FAIL (${slotTest.latencyMs}ms) → ${slotTest.error}`}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 4: FIRST-RUN SETUP, INSTALLER & MODEL PLACEMENT AUDIT           */}
        {/* =================================================================== */}
        {activeTab === 'setup' && (
          <div className="max-w-6xl mx-auto space-y-6">
            {/* Top Setup Header Bar */}
            <section className="bg-white dark:bg-[#13161C] border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm flex flex-wrap items-center justify-between gap-4">
              <div className="max-w-2xl">
                <h1 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Download size={20} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
                  <span>{t.setupTitle}</span>
                </h1>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
                  {t.setupSubtitle}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={handleInstallPythonBackends}
                  disabled={isInstallingPip || !machineEnv?.pythonAvailable}
                  className="h-10 px-4 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 text-xs font-semibold flex items-center gap-2 transition-colors disabled:opacity-40 whitespace-nowrap"
                >
                  <RefreshCw size={14} className={isInstallingPip ? 'animate-spin' : ''} />
                  <span>{isInstallingPip ? t.setupRunningPip : t.setupRunPipBtn}</span>
                </button>
                <button
                  type="button"
                  onClick={handleEnterStudioFromSetup}
                  className="h-10 px-5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs sm:text-sm font-semibold flex items-center gap-2 transition-colors whitespace-nowrap"
                >
                  <CheckCircle2 size={15} />
                  <span>{t.setupSkipToStudio}</span>
                </button>
              </div>
            </section>

            {pipInstallLog && (
              <section className="bg-white dark:bg-[#13161C] border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-2">
                <div className="flex items-center justify-between gap-3 text-xs font-mono" dir="ltr">
                  <span className={pipInstallLog.ok ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-red-600 dark:text-red-400 font-semibold'}>
                    {pipInstallLog.ok ? 'pip install succeeded' : 'pip install finished with warnings/errors'}
                  </span>
                  <span className="text-slate-500 dark:text-slate-400 truncate">{pipInstallLog.command}</span>
                </div>
                <pre
                  dir="ltr"
                  className="max-h-48 overflow-y-auto p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0D11] text-[11px] font-mono text-slate-700 dark:text-slate-300 whitespace-pre-wrap"
                >
                  {pipInstallLog.log}
                </pre>
              </section>
            )}

            {/* Section 0: Online PyPI Backends, Speed Accelerators & CUDA Upgrade Checker */}
            <section className="bg-white dark:bg-[#13161C] border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="max-w-2xl">
                  <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Zap size={18} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
                    <span>{t.setupUpdatesTitle}</span>
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t.setupUpdatesSubtitle}</p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => checkBackendUpdates(true, false)}
                    disabled={isCheckingUpdates || isAutoUpdating}
                    className="h-9 px-3.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-40 whitespace-nowrap"
                  >
                    <RefreshCw size={13} className={isCheckingUpdates ? 'animate-spin' : ''} />
                    <span>{isCheckingUpdates ? t.setupUpdatesChecking : t.setupUpdatesCheckBtn}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAutoUpdateAll(true)}
                    disabled={isAutoUpdating || isCheckingUpdates || !machineEnv?.pythonAvailable}
                    className="h-9 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-40 whitespace-nowrap"
                  >
                    <Zap size={13} />
                    <span>{isAutoUpdating ? t.setupUpdatesUpdating : t.setupUpdatesAutoBtn}</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-slate-200 dark:border-slate-800 text-xs">
                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0D11]">
                  <div className="text-slate-500 dark:text-slate-400">NVIDIA CUDA</div>
                  <div
                    className={`font-mono font-semibold mt-1 ${
                      updateReport?.cudaStatus.needsCudaUpgrade
                        ? 'text-amber-600 dark:text-amber-400'
                        : updateReport?.cudaStatus.nvidiaGpuAvailable
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-slate-700 dark:text-slate-300'
                    }`}
                    dir="ltr"
                  >
                    {updateReport
                      ? updateReport.cudaStatus.nvidiaGpuAvailable
                        ? `${updateReport.cudaStatus.nvidiaGpuName || 'NVIDIA'} · Driver CUDA ${
                            updateReport.cudaStatus.nvidiaDriverCuda || '?'
                          } · torch ${updateReport.cudaStatus.torchCudaVersion || 'CPU'}`
                        : t.noNvidiaGpuLabel
                      : '—'}
                  </div>
                </div>

                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0D11]">
                  <div className="text-slate-500 dark:text-slate-400">{t.setupUpdateAvailable}</div>
                  <div className="font-mono font-semibold mt-1 tabular-nums text-slate-900 dark:text-slate-100" dir="ltr">
                    {updateReport
                      ? `${updateReport.outdatedCount} outdated · ${updateReport.cudaUpgradeCount} CUDA upgrade(s)`
                      : '—'}
                  </div>
                </div>

                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0D11] space-y-1.5">
                  <label className="block text-slate-500 dark:text-slate-400 font-medium">
                    {t.setupUpdateScheduleLabel}
                  </label>
                  <select
                    value={updatePolicy.schedule}
                    disabled={isSavingUpdatePolicy}
                    onChange={(e) =>
                      handleSaveUpdatePolicy({ schedule: e.target.value as UpdateScheduleMode })
                    }
                    className="w-full h-9 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#13161C] text-xs font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="off">{t.setupScheduleOff}</option>
                    <option value="hourly_6">{t.setupSchedule6h}</option>
                    <option value="daily">{t.setupScheduleDaily}</option>
                    <option value="weekly">{t.setupScheduleWeekly}</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <label className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0D11] flex items-start gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={updatePolicy.notifyCriticalOnly}
                    disabled={isSavingUpdatePolicy}
                    onChange={(e) => handleSaveUpdatePolicy({ notifyCriticalOnly: e.target.checked })}
                    className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="font-medium text-slate-700 dark:text-slate-300 leading-relaxed">
                    {t.setupNotifyCriticalOnlyLabel}
                  </span>
                </label>

                <label className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0D11] flex items-start gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={updatePolicy.autoUpdateOnLaunch}
                    disabled={isSavingUpdatePolicy}
                    onChange={(e) => handleSaveUpdatePolicy({ autoUpdateOnLaunch: e.target.checked })}
                    className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="font-medium text-slate-700 dark:text-slate-300 leading-relaxed">
                    {t.setupUpdatesAutoLaunchLabel}
                  </span>
                </label>
              </div>

              {updateReport && updateReport.items.some((i) => i.status === 'update_available' || i.status === 'cuda_upgrade_needed') && (
                <div className="space-y-1.5 pt-2">
                  {updateReport.items
                    .filter((i) => i.status === 'update_available' || i.status === 'cuda_upgrade_needed')
                    .map((item) => (
                      <div
                        key={`upd-${item.id}`}
                        className="px-3.5 py-2 rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/20 flex flex-wrap items-center justify-between gap-2 text-xs"
                        dir="ltr"
                      >
                        <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                          {item.pipName}: {item.installedVersion || '?'} → {item.latestVersion || 'CUDA 12.4'}
                        </span>
                        <span className="text-amber-700 dark:text-amber-300 font-medium">
                          {item.cudaNote || t.setupUpdateAvailable}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </section>

            {/* Section 1: Standalone setup.exe & Setup Package Files */}
            <section className="bg-white dark:bg-[#13161C] border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">
                    {t.setupDownloadFilesTitle}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t.setupDownloadFilesDesc}</p>
                </div>
                <a
                  href="/api/setup/download/setup.exe"
                  download="setup.exe"
                  className="h-10 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
                  dir="ltr"
                >
                  <Download size={15} />
                  <span>setup.exe (Windows Installer)</span>
                </a>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3" dir="ltr">
                {[
                  {
                    file: 'setup.exe',
                    label: 'setup.exe',
                    featured: true,
                    descAr: 'ملف التثبيت التنفيذي الوحيد لنظام ويندوز — يثبت كل النواقص ويربط الموديلات ويفتح البرنامج',
                    descEn: 'Standalone Windows .exe installer & launcher',
                  },
                  {
                    file: 'requirements.txt',
                    label: 'requirements.txt',
                    featured: false,
                    descAr: 'كل مكتبات Python المطلوبة للـ GGUF و HF و ASR و TTS',
                    descEn: 'All Python ML dependencies',
                  },
                  {
                    file: 'setup.py',
                    label: 'setup.py',
                    featured: false,
                    descAr: 'ملف حزمة التثبيت (pip install -e .)',
                    descEn: 'Python package installer',
                  },
                  {
                    file: 'backends_manifest.json',
                    label: 'models/backends_manifest.json',
                    featured: false,
                    descAr: 'ملف الداتا للمكتبات ومسارات الموديلات وتوصيات التوزيع',
                    descEn: 'Backends & auto-assign data manifest',
                  },
                  {
                    file: 'start_hafiz.bat',
                    label: 'start_hafiz.bat',
                    featured: false,
                    descAr: 'تشغيل سريع مباشر للبرنامج على localhost:3000',
                    descEn: 'Quick Windows studio launcher',
                  },
                ].map((item) => (
                  <a
                    key={item.file}
                    href={`/api/setup/download/${encodeURIComponent(item.file)}`}
                    download={item.file}
                    className={`p-3.5 rounded-xl border transition-colors flex flex-col justify-between gap-2 ${
                      item.featured
                        ? 'border-indigo-500/70 bg-indigo-50/70 dark:bg-indigo-950/30 hover:border-indigo-400'
                        : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0D11] hover:border-indigo-500/70'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-mono font-bold text-slate-900 dark:text-slate-100 truncate">
                          {item.label}
                        </span>
                        <Download size={14} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1" dir={language === 'ar' ? 'rtl' : 'ltr'}>
                        {language === 'ar' ? item.descAr : item.descEn}
                      </p>
                    </div>
                  </a>
                ))}
              </div>

              {/* Automatic Missing Requirements & Direct Download Links */}
              {(() => {
                const missingTools = (setupManifest?.systemPrerequisites || []).filter((tool: any) => {
                  if (tool.id === 'python') return !machineEnv?.pythonAvailable;
                  if (tool.id === 'ffmpeg') return !machineEnv?.ffmpegAvailable;
                  if (tool.id === 'cuda') return !machineEnv?.nvidiaGpuAvailable;
                  return false;
                });
                const missingPkgs = (setupManifest?.backends || []).filter(
                  (b: any) => !machineEnv?.pythonPackages?.[b.id]
                );
                const unboundSlots = modelSlots.filter(
                  (s) => s.activeAdapter === 'fallback_ai' && !s.inheritedFrom
                );
                const totalMissing = missingTools.length + missingPkgs.length + unboundSlots.length;

                return (
                  <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                          {t.setupMissingLinksTitle}
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          {totalMissing === 0 ? t.setupAllReadyMsg : t.setupMissingLinksDesc}
                        </p>
                      </div>
                    </div>

                    {totalMissing > 0 && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                        {missingTools.map((tool: any) => (
                          <div
                            key={`tool-${tool.id}`}
                            className="p-3 rounded-xl border border-amber-300/70 dark:border-amber-800/70 bg-amber-50/50 dark:bg-amber-950/20 flex items-center justify-between gap-3"
                          >
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-slate-900 dark:text-slate-100" dir="ltr">
                                {tool.name}
                              </div>
                              <p className="text-[11px] text-slate-600 dark:text-slate-400 truncate">
                                {language === 'ar' ? tool.descAr : tool.descEn}
                              </p>
                            </div>
                            <a
                              href={tool.downloadUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="h-8 px-3 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-semibold inline-flex items-center gap-1.5 shrink-0 whitespace-nowrap"
                            >
                              <ExternalLink size={12} />
                              <span>{t.setupDirectDownloadBtn}</span>
                            </a>
                          </div>
                        ))}

                        {missingPkgs.map((pkg: any) => {
                          const isThisInstalling = installingPkgId === pkg.id;
                          return (
                            <div
                              key={`pkg-${pkg.id}`}
                              className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0D11] flex items-center justify-between gap-2.5"
                            >
                              <div className="min-w-0">
                                <div className="text-xs font-mono font-bold text-slate-900 dark:text-slate-100 truncate" dir="ltr">
                                  {pkg.pipName} &gt;= {pkg.minVersion}
                                </div>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                  {language === 'ar' ? pkg.requiredForAr : pkg.requiredForEn}
                                </p>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  type="button"
                                  disabled={isThisInstalling || isInstallingPip || !machineEnv?.pythonAvailable}
                                  onClick={() => handleInstallSingleBackend(pkg.id, pkg.pipInstallSpec || pkg.pipName)}
                                  className="h-8 px-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold disabled:opacity-40 whitespace-nowrap"
                                >
                                  {isThisInstalling ? t.setupInstallingPkg : t.setupInstallNowBtn}
                                </button>
                                {pkg.downloadUrl && (
                                  <a
                                    href={pkg.downloadUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-indigo-500 text-slate-700 dark:text-slate-200 text-[11px] font-semibold inline-flex items-center gap-1 whitespace-nowrap"
                                  >
                                    <ExternalLink size={12} />
                                    <span>{t.setupDirectDownloadBtn}</span>
                                  </a>
                                )}
                              </div>
                            </div>
                          );
                        })}

                        {unboundSlots.map((slot) => {
                          const rec = setupManifest?.slotRecommendations?.[slot.id];
                          if (!rec?.downloadUrl) return null;
                          return (
                            <div
                              key={`slot-${slot.id}`}
                              className="p-3 rounded-xl border border-indigo-200 dark:border-indigo-900/70 bg-indigo-50/40 dark:bg-indigo-950/20 flex items-center justify-between gap-2.5"
                            >
                              <div className="min-w-0">
                                <div className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                                  {language === 'ar' ? slot.nameAr : slot.nameEn}
                                </div>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                  {rec.downloadLabel} — {t.setupModelsDropHint}
                                </p>
                              </div>
                              <a
                                href={rec.downloadUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="h-8 px-3 rounded-lg border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-slate-900 hover:border-indigo-500 text-indigo-700 dark:text-indigo-300 text-[11px] font-semibold inline-flex items-center gap-1 shrink-0 whitespace-nowrap"
                              >
                                <ExternalLink size={12} />
                                <span>{t.setupDirectDownloadBtn}</span>
                              </a>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}
            </section>

            {/* Section 2: Fixed Model Paths & Auto-Assign Control */}
            <section className="bg-white dark:bg-[#13161C] border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <FolderOpen size={18} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
                    <span>{t.setupSearchRootsTitle}</span>
                  </h2>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleScanPartitions(true)}
                    disabled={isScanningPartitions || isAutoAssigning}
                    className="h-9 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-40 whitespace-nowrap"
                  >
                    <Zap size={14} />
                    <span>{isScanningPartitions ? t.scanningPartitions : t.scanAllPartitionsBtn}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveSearchRoots}
                    disabled={isSavingRoots}
                    className="h-9 px-3.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-semibold transition-colors disabled:opacity-40 whitespace-nowrap"
                  >
                    {t.setupSaveRootsBtn}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAutoAssignModels(true)}
                    disabled={isAutoAssigning || isScanningPartitions}
                    className="h-9 px-3.5 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-40 whitespace-nowrap"
                  >
                    <span>{isAutoAssigning ? t.autoAssignRunning : t.setupApplyAuditBtn}</span>
                  </button>
                </div>
              </div>

              {partitionScan && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
                  <span className="font-semibold">{t.partitionsScannedLabel}</span>
                  <span className="font-mono font-semibold text-slate-900 dark:text-slate-100" dir="ltr">
                    {partitionScan.scannedPartitions.join(' · ')}
                  </span>
                  <span className="font-mono tabular-nums" dir="ltr">
                    ({partitionScan.discoveredModelsCount} models · {partitionScan.discoveredRoots.length} roots)
                  </span>
                </div>
              )}

              <textarea
                value={searchRootsDraft}
                onChange={(e) => setSearchRootsDraft(e.target.value)}
                rows={3}
                dir="ltr"
                placeholder={'D:\\AI\\LMStudio-Models\\local\nE:\\OmniVoice'}
                className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0D11] text-xs font-mono text-slate-800 dark:text-slate-200 focus:border-indigo-500"
              />

              {autoAssignNotice && (
                <div className="p-3 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/30 text-xs text-emerald-700 dark:text-emerald-300 font-medium">
                  {autoAssignNotice}
                </div>
              )}
            </section>

            {/* Section 2b: Visual Models Folder Tree Guide (models/local/) */}
            <section className="bg-white dark:bg-[#13161C] border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <FolderOpen size={18} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
                    <span>{t.setupTreeTitle}</span>
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t.setupTreeSubtitle}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const treeText = [
                      'Hafiz-BelAmya/',
                      '├── setup.exe',
                      '├── requirements.txt',
                      '└── models/',
                      '    └── local/',
                      '        ├── NAMAA-Space/Cohere-Speech-Tashkeel-2B/            -> ASR (السماع بالتشكيل)',
                      '        ├── models--mobiuslabsgmbh--faster-whisper-large-v3-turbo/ -> ASR السريع',
                      '        ├── Qwen3.5-9B-Q4_K_M-GGUF/                         -> الموديل الذكي + القوافي + الويب + هات تشكيل + البرومبت',
                      '        ├── Nile-Chat-4B-GGUF/                              -> اختياري: عامية مصرية للقوافي وإعادة الصياغة',
                      '        ├── VoiceTut-Egyptian-Tashkeel-GGUF/                -> اختياري: تشكيل نصي فقط (لا يوضع في القراءة الصوتية)',
                      '        ├── OmniVoice/models/OmniVoice/model.safetensors    -> القراءة الصوتية TTS + استنساخ الأصوات',
                      '        └── VoiceTut-TTS-GGUF/                              -> موديل صوتي إضافي لخانة القراءة',
                    ].join('\n');
                    navigator.clipboard?.writeText(treeText);
                  }}
                  className="h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:border-indigo-500 text-xs font-semibold inline-flex items-center gap-1.5 shrink-0"
                >
                  <Copy size={13} />
                  <span>{t.setupTreeCopyBtn}</span>
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                <pre
                  dir="ltr"
                  className="lg:col-span-7 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0D11] text-[11px] sm:text-xs font-mono text-slate-800 dark:text-slate-200 overflow-x-auto leading-relaxed"
                >{`Hafiz-BelAmya/
├── setup.exe                   # ملف التسطيب والتشغيل الوحيد
└── models/
    └── local/                  # ضع كل موديل بفولدره هنا
        ├── NAMAA-Space/
        │   └── Cohere-Speech-Tashkeel-2B/
        ├── models--mobiuslabsgmbh--faster-whisper-large-v3-turbo/
        ├── Qwen3.5-9B-Q4_K_M-GGUF/
        ├── Nile-Chat-4B-GGUF/
        ├── VoiceTut-Egyptian-Tashkeel-GGUF/
        ├── OmniVoice/
        │   └── models/OmniVoice/model.safetensors
        └── VoiceTut-TTS-GGUF/`}</pre>

                <div className="lg:col-span-5 space-y-2">
                  {[
                    {
                      folder: 'NAMAA-Space/Cohere-Speech-Tashkeel-2B',
                      slotAr: 'السماع والكتابة بالتشكيل (ASR)',
                      slotEn: 'Speech-to-Diacritized ASR',
                    },
                    {
                      folder: 'Qwen3.5-9B-Q4_K_M-GGUF',
                      slotAr: 'الموديل الذكي + القوافي + إيجنت الويب + هات تشكيل + البرومبتات',
                      slotEn: 'Smart Core + Rhymes + Web Agent + Search + Prompts',
                    },
                    {
                      folder: 'OmniVoice (أو VoiceTut-TTS-GGUF)',
                      slotAr: 'القراءة الصوتية بالتشكيل (TTS) + استنساخ الأصوات',
                      slotEn: 'Diacritic TTS Reader + Voice Clone',
                    },
                    {
                      folder: 'Nile-Chat-4B-GGUF / VoiceTut-Egyptian-Tashkeel-GGUF',
                      slotAr: 'اختياري: مهام النص والقوافي فقط (ممنوع للـ TTS)',
                      slotEn: 'Optional text/rhyme models (never put in TTS)',
                    },
                  ].map((row) => (
                    <div
                      key={row.folder}
                      className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0B0D11]"
                    >
                      <div className="text-[11px] font-mono font-bold text-indigo-600 dark:text-indigo-400 truncate" dir="ltr">
                        models/local/{row.folder}
                      </div>
                      <div className="text-xs text-slate-700 dark:text-slate-300 mt-1">
                        {language === 'ar' ? row.slotAr : row.slotEn}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* Section 3: Model Placement Audit Table (From Your Disk & Screenshots) */}
            {setupManifest?.slotRecommendations && (
              <section className="bg-white dark:bg-[#13161C] border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
                <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">
                    {t.setupAuditTitle}
                  </h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-start">
                    <thead className="bg-slate-50 dark:bg-[#0E1015] border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                      <tr>
                        <th className="py-3 px-4 font-semibold text-start">{t.setupSlotCol}</th>
                        <th className="py-3 px-4 font-semibold text-start">{t.activeModelLabel}</th>
                        <th className="py-3 px-4 font-semibold text-start">{t.setupAdviceCol}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {modelSlots.map((slot) => {
                        const rec = setupManifest.slotRecommendations[slot.id];
                        return (
                          <tr key={slot.id} className="hover:bg-slate-50/70 dark:hover:bg-[#0E1015]/60">
                            <td className="py-3 px-4 font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                              {language === 'ar' ? slot.nameAr : slot.nameEn}
                            </td>
                            <td className="py-3 px-4 font-mono text-slate-700 dark:text-slate-300 max-w-[220px] truncate" dir="ltr">
                              {slot.effectiveModelLabel || slot.activeAdapter}
                            </td>
                            <td className="py-3 px-4 text-slate-600 dark:text-slate-300 leading-relaxed">
                              {rec ? (language === 'ar' ? rec.adviceAr : rec.adviceEn) : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Section 4: Python Libraries Readiness Matrix */}
            {setupManifest?.backends && (
              <section className="bg-white dark:bg-[#13161C] border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
                <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">
                    {t.setupMatrixTitle}
                  </h2>
                  {machineEnv && (
                    <span className="text-xs font-mono text-slate-500 dark:text-slate-400 tabular-nums" dir="ltr">
                      {machineEnv.pythonAvailable ? machineEnv.pythonVersion : 'Python Missing'} · Missing core: {missingCorePackages.length}
                    </span>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-start">
                    <thead className="bg-slate-50 dark:bg-[#0E1015] border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                      <tr>
                        <th className="py-3 px-4 font-semibold text-start">{t.setupPkgCol}</th>
                        <th className="py-3 px-4 font-semibold text-start">{t.setupStatusCol}</th>
                        <th className="py-3 px-4 font-semibold text-start">{t.setupVersionCol}</th>
                        <th className="py-3 px-4 font-semibold text-start">{t.setupLatestCol}</th>
                        <th className="py-3 px-4 font-semibold text-start">{t.setupPurposeCol}</th>
                        <th className="py-3 px-4 font-semibold text-start">{t.setupActionCol}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {setupManifest.backends.map((b: any) => {
                        const installed = Boolean(machineEnv?.pythonPackages?.[b.id]);
                        const isThisInstalling = installingPkgId === b.id;
                        const updItem = updateReport?.items.find((it) => it.id === b.id || it.pipName === b.pipName);
                        const hasUpgrade = updItem?.status === 'update_available' || updItem?.status === 'cuda_upgrade_needed';
                        return (
                          <tr key={b.id} className="hover:bg-slate-50/70 dark:hover:bg-[#0E1015]/60">
                            <td className="py-3 px-4 font-mono font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap" dir="ltr">
                              {b.pipName} &gt;= {b.minVersion}
                            </td>
                            <td className="py-3 px-4 whitespace-nowrap">
                              <span
                                className={`font-semibold ${
                                  updItem?.status === 'cuda_upgrade_needed'
                                    ? 'text-amber-600 dark:text-amber-400'
                                    : updItem?.status === 'update_available'
                                    ? 'text-indigo-600 dark:text-indigo-400'
                                    : installed
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : b.optional
                                    ? 'text-slate-500 dark:text-slate-400'
                                    : 'text-amber-600 dark:text-amber-400'
                                }`}
                              >
                                {updItem?.status === 'cuda_upgrade_needed'
                                  ? t.setupCudaUpgradeNeeded
                                  : updItem?.status === 'update_available'
                                  ? t.setupUpdateAvailable
                                  : installed
                                  ? t.setupInstalled
                                  : t.setupMissing}
                              </span>
                            </td>
                            <td className="py-3 px-4 font-mono text-slate-600 dark:text-slate-400 whitespace-nowrap tabular-nums" dir="ltr">
                              {updItem?.installedVersion || (installed ? '—' : '—')}
                            </td>
                            <td className="py-3 px-4 font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap tabular-nums" dir="ltr">
                              {updItem?.latestVersion || (updateReport && !updateReport.onlineReachable ? t.setupOfflineStatus : '—')}
                            </td>
                            <td className="py-3 px-4 text-slate-600 dark:text-slate-300 leading-relaxed">
                              {language === 'ar' ? b.requiredForAr : b.requiredForEn}
                            </td>
                            <td className="py-3 px-4 whitespace-nowrap">
                              {installed && !hasUpgrade ? (
                                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">—</span>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    disabled={isThisInstalling || isInstallingPip || isAutoUpdating || !machineEnv?.pythonAvailable}
                                    onClick={() => handleInstallSingleBackend(b.id, b.pipInstallSpec || b.pipName)}
                                    className="h-7 px-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold disabled:opacity-40"
                                  >
                                    {isThisInstalling
                                      ? t.setupInstallingPkg
                                      : hasUpgrade
                                      ? t.setupUpdateAvailable
                                      : t.setupInstallNowBtn}
                                  </button>
                                  {(b.downloadUrl || b.pypiUrl) && (
                                    <a
                                      href={b.downloadUrl || b.pypiUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="h-7 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-indigo-500 text-slate-700 dark:text-slate-200 text-[11px] font-semibold inline-flex items-center gap-1"
                                    >
                                      <ExternalLink size={11} />
                                      <span>{t.setupDirectDownloadBtn}</span>
                                    </a>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </div>
        )}
      </main>

      {/* ===================================================================== */}
      {/* MODALS: Suno Prompt Generator & Voice Synthesis Lab                   */}
      {/* ===================================================================== */}
      <AnimatePresence>
        {showSunoModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#13161C] shadow-xl overflow-hidden"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Headphones size={18} className="text-indigo-600 dark:text-indigo-400" />
                  <span>{t.sunoModalTitle}</span>
                </h3>
                <button
                  onClick={() => setShowSunoModal(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="p-5 space-y-4">
                <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200 dark:border-slate-800">
                  {renderInlineSlotSelector('prompt_generator')}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                    {t.sunoGenreAction}
                  </label>
                  <select
                    value={sunoGenre}
                    onChange={(e) => setSunoGenre(e.target.value)}
                    className="w-full h-11 px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0D11] text-sm text-slate-900 dark:text-white"
                  >
                    {Object.entries(t.genres).map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                    {t.sunoMoodPlaceholder}
                  </label>
                  <textarea
                    value={sunoMood}
                    onChange={(e) => setSunoMood(e.target.value)}
                    placeholder={t.sunoMoodPlaceholder}
                    rows={3}
                    className="w-full p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0D11] text-sm text-slate-900 dark:text-white resize-none"
                  />
                </div>
                <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={sunoWebSearch}
                    onChange={(e) => setSunoWebSearch(e.target.checked)}
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <Globe size={14} className="text-indigo-500 shrink-0" />
                  <span>{t.sunoWebSearchLabel}</span>
                </label>
                <button
                  onClick={handleGenerateMusicPrompt}
                  disabled={!sunoMood.trim() || !sunoGenre.trim()}
                  className="w-full h-11 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-40"
                >
                  <Sparkles size={16} />
                  <span>{t.sunoPromptBtn}</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showVoiceCloneModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#13161C] shadow-xl overflow-hidden"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Mic size={18} className="text-indigo-600 dark:text-indigo-400" />
                  <span>{t.voiceCloneModalTitle}</span>
                </h3>
                <button
                  onClick={() => setShowVoiceCloneModal(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="p-5 space-y-4">
                <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200 dark:border-slate-800">
                  {renderInlineSlotSelector('voice_clone')}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="flex flex-col items-center justify-center p-4 border-2 border-dashed rounded-xl cursor-pointer border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0D11] hover:border-indigo-500 transition-colors text-center">
                    <Mic size={22} className="mb-2 text-indigo-500" />
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      {t.uploadSourceVoice}
                    </span>
                    <span className="text-[11px] text-slate-500 mt-1 truncate max-w-full">
                      {voiceFile ? voiceFile.name : t.uploadAudio}
                    </span>
                    <input
                      type="file"
                      className="hidden"
                      accept="audio/*"
                      onChange={(e) => setVoiceFile(e.target.files?.[0] || null)}
                    />
                  </label>

                  <label className="flex flex-col items-center justify-center p-4 border-2 border-dashed rounded-xl cursor-pointer border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0D11] hover:border-indigo-500 transition-colors text-center">
                    <Music size={22} className="mb-2 text-indigo-500" />
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      {t.uploadTargetPerformance}
                    </span>
                    <span className="text-[11px] text-slate-500 mt-1 truncate max-w-full">
                      {targetAudioFile ? targetAudioFile.name : t.uploadAudio}
                    </span>
                    <input
                      type="file"
                      className="hidden"
                      accept="audio/*"
                      onChange={(e) => setTargetAudioFile(e.target.files?.[0] || null)}
                    />
                  </label>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                    {t.enterTargetLyrics}
                  </label>
                  <textarea
                    value={cloneTargetText}
                    onChange={(e) => setCloneTargetText(e.target.value)}
                    placeholder={t.enterTargetLyrics}
                    rows={2}
                    className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#0B0D11] text-sm text-slate-900 dark:text-white resize-none"
                  />
                </div>

                <button
                  onClick={handleVoiceClone}
                  disabled={!voiceFile || !targetAudioFile}
                  className="w-full h-11 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-40"
                >
                  <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
                  <span>{t.cloneAction}</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Quiet Footer */}
      <footer className="py-6 text-center text-xs text-slate-500 dark:text-slate-500 border-t border-slate-200/70 dark:border-slate-800/70">
        {language === 'ar' ? 'تم التطوير بواسطة عبدالرحمن عمرو' : 'Developed by Abdelrahman Amr'}
      </footer>
    </div>
  );
};

export default App;
