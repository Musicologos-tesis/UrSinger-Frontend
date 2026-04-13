# Plan de implementación de ejercicios (UrSinger)

## 1) Verificación de viabilidad con tecnologías actuales
Sí es posible implementar todos los ejercicios descritos usando la base técnica existente. Actualmente ya cuentas con:
- Captura de audio y análisis en tiempo real (AudioContext + Analyser).
- Detección de pitch con CREPE (TensorFlow.js) y métricas auxiliares como RMS y centroide espectral.
- Flujo de entrenamiento completo: dashboard → detalle → práctica → completion.
- Backend que entrega plan activo, detalle de ejercicio y permite marcar completado.

Con lo anterior, los ejercicios pueden modelarse como “estrategias de validación” que consumen pitch, RMS y tiempos, sin requerir nuevas librerías.

## 2) Estado actual del código (lo que ya habilita esto)
- Práctica genérica con validación de nota objetivo, tiempo y tolerancia de pitch.
- Detección en tiempo real de pitch + confidence.
- Cálculo de RMS y centroide espectral para ejercicios de dinámica/ruido.
- Plan de entrenamiento ya vinculado a ejercicio y nivel.

Esto permite convertir cada ejercicio en una variante de validación.

## 3) Gaps identificados (necesarios para completar todos los ejercicios)
1) **Mapeo ejercicio → tipo de práctica**
   - Falta un “registro” que diga qué lógica usa cada `exerciseId` y `level`.
2) **Parámetros por nivel**
   - Tolerancias, duración, secuencias, cantidad de repeticiones, etc.
3) **Motor común de validación**
   - Reutilizar reglas básicas (ruido, rango humano, pitch válido, etc.).
4) **Tipos de ejercicio avanzados**
   - Vibrato, dinámicas (RMS), glissando, onset, intervalos.
5) **Persistencia de intentos y métricas (opcional)**
   - Si quieres tracking avanzado, se recomienda registrar métricas por intento.

## 4) Plan de construcción por fases

### Fase A — Normalización de la arquitectura
1) Crear un “registro de ejercicios” (en frontend o backend) con:
   - `exerciseId`, `exerciseNumber`, `groupNumber`, `level`, `type`, `params`.
2) Definir una interfaz común de evaluación:
   - `start()`, `update(frame)`, `finish()`, `successCriteria`.
3) Separar UI de lógica:
   - UI genérica + panel específico según `type`.

### Fase B — Implementación de tipos base
Implementar primero los ejercicios más cercanos a lo ya existente:
- **Pitch Target / Steady Tone**: mantener nota con tolerancia.
- **Breath Flow Hold**: similar, pero con énfasis en estabilidad de RMS.
- **Single Burst**: controlar RMS alto en ventana corta.

### Fase C — Tipos intermedios
- **Pitch Steps**: secuencia de 2 notas y validación por pasos.
- **Volume Rise**: RMS ascendente, pitch estable.
- **Loud–Soft Alternance**: patrón de RMS alternante en tiempos definidos.

### Fase D — Tipos avanzados
- **Pitch Glide / Vocal Glide**: pendiente continua y rango mínimo.
- **Controlled Vibrato**: modulación periódica de pitch (≈5–7 Hz, profundidad controlada).
- **Clean Onset**: tiempo para alcanzar pitch objetivo < umbral y sin overshoot.
- **S–Z Balance**: distinguir fricativa sorda (sin pitch) vs sonora (con pitch) y comparar duración.
- **Mix Coordination / Step Expansion**: secuencias más largas + continuidad de pitch.

### Fase E — Ajustes finales
- Afinar tolerancias por nivel.
- Optimizar feedback visual y mensajería.
- Agregar persistencia opcional de métricas por intento.

## 5) Propuesta de mapeo ejercicio → tipo de validación

### Grupo 1 — Soporte respiratorio y control del aire
1) **Breath Flow Hold** → `sustain_pitch + rms_stability`
2) **S–Z Balance** → `unvoiced_vs_voiced_duration`
3) **Dynamic Wave** → `rms_waveform + pitch_stable`

### Grupo 2 — Afinación y oído tonal
1) **Pitch Target** → `target_pitch_reps`
2) **Pitch Steps** → `interval_sequence`
3) **Pitch Glide** → `pitch_continuity`

### Grupo 3 — Estabilidad y vibrato controlado
1) **Steady Tone** → `pitch_stability`
2) **Controlled Vibrato** → `pitch_modulation`
3) **Clean Onset** → `onset_accuracy`

### Grupo 4 — Potencia y control dinámico
1) **Single Burst** → `short_power_burst`
2) **Volume Rise** → `rms_ramp`
3) **Loud–Soft Alternance** → `rms_pattern`

### Grupo 5 — Rango y flexibilidad vocal
1) **Vocal Glide** → `pitch_continuity_range`
2) **Step Expansion** → `scale_sequence`
3) **Mix Coordination** → `register_transition_continuity`

## 6) Interacción requerida con backend (recomendado)
Para que la plataforma sea consistente con la ruta de aprendizaje:
- **Opción A (mínima):** el frontend mantiene un mapa interno de `exerciseId + level → tipo y parámetros`.
- **Opción B (mejor):** el backend entrega el `type` y `params` del ejercicio en el detalle de ejercicio. Así los cambios se controlan desde el servidor.

### Datos recomendados en la respuesta de backend
- `exerciseId`, `exerciseLevelId`, `groupNumber`, `level`
- `type` (por ejemplo `pitch_target`, `vibrato`, `rms_ramp`)
- `params` (duración, tolerancia, repeticiones, intervalos, rango mínimo, etc.)

## 7) Conclusión
Con el stack actual (Angular + WebAudio + TensorFlow.js/CREPE) es viable programar todos los ejercicios. La clave es estandarizar los “tipos de ejercicio” y sus parámetros por nivel, y hacer que el motor de práctica sea extensible.
