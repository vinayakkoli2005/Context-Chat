import os from 'node:os';
import { spawnSync } from 'node:child_process';
import type { HardwareInfo } from '../src/shared/types';

// Conservative VRAM estimate. On Windows we try nvidia-smi first;
// if missing or unparseable, fall back to a heuristic based on system RAM.
// This is used to decide whether to recommend AirLLM fallback inference.
const estimateVramGb = (totalRamGb: number): number => {
  try {
    const r = spawnSync(
      'nvidia-smi',
      ['--query-gpu=memory.total', '--format=csv,noheader,nounits'],
      { encoding: 'utf8', windowsHide: true, timeout: 2000 }
    );
    if (r.status === 0 && r.stdout) {
      const firstLine = r.stdout.trim().split('\n')[0];
      const mb = parseInt(firstLine, 10);
      if (!Number.isNaN(mb) && mb > 0) {
        return Math.round(mb / 1024);
      }
    }
  } catch { /* nvidia-smi not available — fall through */ }

  // No discrete GPU detected — assume integrated GPU shares ~1/4 of RAM
  return Math.max(2, Math.round(totalRamGb / 4));
};

// Rough heuristic: estimate the RAM/VRAM a given Ollama model needs.
// Used by the AirLLM fallback decision in airllm-bridge.ts.
const estimateModelRamGb = (modelName: string): number => {
  const m = modelName.match(/(\d+)b/i);
  if (!m) return 0;
  const paramsB = parseInt(m[1], 10);
  // Q4 quantization rule of thumb: ~0.6 GB per billion parameters
  return paramsB * 0.6;
};

export const recommendModels = (totalRamGb: number): HardwareInfo => {
  const estimatedVramGb = estimateVramGb(totalRamGb);
  const base = (() => {
    if (totalRamGb < 8) {
      return { recommendedTextModel: 'moondream', recommendedVisionModel: 'moondream' };
    }
    if (totalRamGb <= 16) {
      return { recommendedTextModel: 'llama3.2', recommendedVisionModel: 'llava' };
    }
    return { recommendedTextModel: 'llama3.1:8b', recommendedVisionModel: 'llava:13b' };
  })();

  const recommendedRam = estimateModelRamGb(base.recommendedTextModel);
  const shouldRecommendAirLlm = recommendedRam > 0 && recommendedRam > estimatedVramGb * 1.2;

  return {
    totalRamGb,
    estimatedVramGb,
    shouldRecommendAirLlm,
    ...base
  };
};

export const detectHardware = (): HardwareInfo => {
  const totalRamGb = Math.round(os.totalmem() / (1024 ** 3));
  return recommendModels(totalRamGb);
};
