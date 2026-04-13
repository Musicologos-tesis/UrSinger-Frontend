import { Injectable } from '@angular/core';

export interface VoiceProfile {
  avgRmsDb: number;
  noiseFloorDbfs: number;
  snrDb: number;
  pitchValidRate: number;
  avgConfidence: number;
  medianPitch: number;
  pitchStd: number;
  avgMinRmsDb?: number;
  minConfidenceLow?: number;
}

export interface VoiceSample {
  frequency: number;
  confidence: number;
  midiNote: number;
  rms: number;
}

export interface VoiceDetectionOptions {
  minVoiceRmsDb: number;
  minFrequencyHz?: number;
  maxFrequencyHz?: number;
  minConfidence?: number;
}

@Injectable({ providedIn: 'root' })
export class VoiceDetectionService {
  private readonly HUMAN_VOICE_MIN_HZ = 80;
  private readonly HUMAN_VOICE_MAX_HZ = 880;

  readVoiceProfile(): VoiceProfile | null {
    const profileStr = localStorage.getItem('ursinger.calibration.voiceProfile');
    if (!profileStr) return null;
    try {
      return JSON.parse(profileStr) as VoiceProfile;
    } catch {
      return null;
    }
  }

  updateVoiceProfile(update: Partial<VoiceProfile>) {
    const current = this.readVoiceProfile();
    if (!current) return;
    const nextProfile = {
      ...current,
      ...update,
    } satisfies VoiceProfile;
    localStorage.setItem('ursinger.calibration.voiceProfile', JSON.stringify(nextProfile));
  }

  buildMinVoiceRmsDb(noiseFloorDb: number, avgRmsDb: number, profile?: VoiceProfile | null): number {
    const snrDb = profile?.snrDb ?? Math.abs(noiseFloorDb - avgRmsDb);
    const rmsFromNoise = noiseFloorDb + 6;
    const rmsFromSnr = noiseFloorDb + Math.max(8, snrDb * 0.35);
    return profile?.avgMinRmsDb ?? Math.max(rmsFromNoise, rmsFromSnr);
  }

  isValidVocalSample(sample: VoiceSample, options: VoiceDetectionOptions): boolean {
    const minFrequency = options.minFrequencyHz ?? this.HUMAN_VOICE_MIN_HZ;
    const maxFrequency = options.maxFrequencyHz ?? this.HUMAN_VOICE_MAX_HZ;
    const minConfidence = options.minConfidence ?? 0;

    const isAboveNoise = sample.rms > options.minVoiceRmsDb;
    const isHumanVoiceRange = sample.frequency >= minFrequency && sample.frequency <= maxFrequency;

    return (
      isAboveNoise &&
      isHumanVoiceRange &&
      sample.confidence > minConfidence &&
      sample.frequency > 0 &&
      sample.midiNote > 0
    );
  }
}
