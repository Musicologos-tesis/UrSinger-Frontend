import { Component, OnDestroy, signal, effect } from '@angular/core';
import { AudioAnalyzerService } from '../../services/audio.analyzer.service';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-preparation',
  imports: [FormsModule],
  templateUrl: './preparation.html',
  styleUrl: './preparation.scss',
})
export class PreparationComponent implements OnDestroy {
  state = signal<'idle' | 'requesting' | 'active' | 'error'>('idle');
  micLevel = signal(0);
  devices: MediaDeviceInfo[] = [];
  selectedDeviceId: string | null = null;

  constructor(private audio: AudioAnalyzerService, private router: Router) {
    effect(() => {
      // solo para demo de animación; no requiere zone fiddling
      document.documentElement.style.setProperty('--mic-scale', String(1 + this.micLevel() * 0.8));
    });
    navigator.mediaDevices?.addEventListener?.('devicechange', () => this.refreshDevices());
    this.refreshDevices();
  }

  async refreshDevices() {
    try { this.devices = await this.audio.listInputDevices(); } catch { /* ignore */ }
  }

  async activateMic() {
    this.state.set('requesting');
    try {
      await this.audio.requestMic(this.selectedDeviceId ?? undefined);
      this.audio.level$.subscribe(v => this.micLevel.set(v));
      this.state.set('active');
    } catch (e) {
      this.state.set('error');
    }
  }

  startCheck() {
    this.router.navigate(['/checkup/calibration'], {
      state: { sampleRate: Number(localStorage.getItem('ursinger.prep.sampleRate') || 0) }
    });
  }

  ngOnDestroy() { 
    // NO detenemos el audio aquí porque se necesita en calibración
    // Se detendrá después de la calibración
  }
}
