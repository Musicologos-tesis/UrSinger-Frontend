import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { RouterLink, Router } from '@angular/router';
import { VocalRangeService, RangeMetrics } from '../../services/vocal-range.service';
import { StabilityService, StabilityMetrics } from '../../services/stability.service';
import { AudioPitchService } from '../../services/audio-pitch.service';

@Component({
  selector: 'app-checkup-results',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './results.html',
  styleUrl: './results.scss',
})
export class CheckupResultsComponent implements OnInit {
  private router = inject(Router);
  private vocalRange = inject(VocalRangeService);
  private stability = inject(StabilityService);
  private pitch = inject(AudioPitchService);

  // Datos que va a mostrar la UI
  rangeLabel = '---';
  precisionPercent: number | null = null;
  stabilityPercent: number | null = null;

  recommendationTitle = 'Ruta recomendada';
  recommendationText =
    'Completa las pruebas de rango y estabilidad para obtener una recomendación personalizada.';
  routeTag = 'Pendiente';

  checkupCompleted = false;

  ngOnInit(): void {
    const rangeMetrics = this.vocalRange.getCalculatedMetrics();
    const stabilityMetrics = this.stability.lastMetrics;

    // ---- RANGO VOCAL ----
    if (rangeMetrics) {
      this.rangeLabel = this.buildRangeLabel(rangeMetrics);
      this.checkupCompleted = true;
    }

    // ---- PRECISIÓN / ESTABILIDAD ----
    if (stabilityMetrics) {
      const { precisionCents, stabilityCents } = stabilityMetrics;

      if (precisionCents !== null) {
        this.precisionPercent = this.centsToScore(precisionCents);
      }

      if (stabilityCents !== null) {
        this.stabilityPercent = this.centsToScore(stabilityCents);
      }

      this.checkupCompleted = true;
    }

    this.buildRecommendation(rangeMetrics, stabilityMetrics);
  }

  private buildRangeLabel(metrics: RangeMetrics | undefined): string {
    if (!metrics || metrics.rangeMinMidi == null || metrics.rangeMaxMidi == null) {
      return 'Completa la prueba de rango vocal.';
    }

    const minName = this.pitch.midiToNoteName(metrics.rangeMinMidi);
    const maxName = this.pitch.midiToNoteName(metrics.rangeMaxMidi);
    const span = Math.round(metrics.rangeSpanSemitones ?? 0);

    return `${minName} – ${maxName} (${span} semitonos)`;
  }

  /** Convierte “error en cents” a un score de 0–100 (ajustable). */
  private centsToScore(cents: number): number {
    const raw = 100 - cents / 2; // mientras más error, menor score
    return Math.max(0, Math.min(100, Math.round(raw)));
  }

  /** Texto de la ruta recomendada según las métricas. */
  private buildRecommendation(
    rangeMetrics: RangeMetrics | undefined,
    stabilityMetrics: StabilityMetrics | undefined | null
  ) {
    if (!this.checkupCompleted) {
      this.recommendationText =
        'Realiza las pruebas de rango y estabilidad para que podamos recomendarte una ruta de práctica.';
      this.routeTag = 'Pendiente';
      return;
    }

    const span = rangeMetrics?.rangeSpanSemitones ?? null;
    const prec = this.precisionPercent ?? 0;
    const stab = this.stabilityPercent ?? 0;

    // Reglas simples para demo; luego las puede reemplazar el modelo ML
    if (span !== null && span < 12) {
      this.recommendationText =
        'Rango vocal aún reducido. Empezaremos con ejercicios suaves para ampliar tu extensión y ganar confianza en las notas extremas.';
      this.routeTag = 'Ruta · Extensión';
    } else if (prec < 65) {
      this.recommendationText =
        'Buena estabilidad pero desviaciones frecuentes en la afinación. Trabajaremos coordinación oído–voz y control tonal.';
      this.routeTag = 'Ruta · Afinación';
    } else if (stab < 70) {
      this.recommendationText =
        'Afinación aceptable pero variaciones en la estabilidad de la nota. Enfocaremos la práctica en sostener notas largas con apoyo respiratorio.';
      this.routeTag = 'Ruta · Estabilidad';
    } else {
      this.recommendationText =
        'Buen punto de partida: rango funcional y buen control tonal. Podremos avanzar hacia ejercicios más expresivos y repertorio.';
      this.routeTag = 'Ruta · Progresión';
    }
  }

  finishCheckup() {
    // TODO: ajusta esta ruta al dashboard / home que tengas
    this.router.navigate(['/']);
  }
}
