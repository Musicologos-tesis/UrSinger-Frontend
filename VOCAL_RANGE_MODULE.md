# 🎵 Módulo de Rango Vocal - UrSinger Frontend

**Implementación:** Completa ✅  
**Fecha:** 9 de Noviembre, 2025  
**Versión:** 1.0.0  
**Paso:** 3 de 5 en el flujo de Checkup

---

## 📋 Resumen

El módulo de **Rango Vocal** es el tercer paso del flujo de evaluación de UrSinger. Captura el rango vocal completo del usuario (nota mínima a máxima) mediante un sistema de 3 fases:

1. **Fase A - Barrido Continuo** (25s): Usuario canta desde su nota más grave a la más aguda
2. **Fase B1 - Confirmar Mínimo** (~5-10s): Sostener la nota más grave identificada
3. **Fase B2 - Confirmar Máximo** (~5-10s): Sostener la nota más aguda identificada

---

## 🏗️ Arquitectura

### Archivos del Módulo

```
src/app/modules/checkup/
├── services/
│   ├── audio-pitch.service.ts         # Detección de pitch con autocorrelación (YIN)
│   ├── audio-pitch.service.spec.ts
│   ├── vocal-range.service.ts         # Lógica del ejercicio y cálculo de métricas
│   └── vocal-range.service.spec.ts
└── pages/
    └── vocal-range/
        ├── vocal-range.ts             # Componente UI
        ├── vocal-range.html           # Vista con 5 fases
        ├── vocal-range.scss           # Estilos modulares
        └── vocal-range.spec.ts
```

---

## 🎯 Flujo del Ejercicio

### Diagrama de Estados

```
     ┌─────────────┐
     │    IDLE     │
     │ (Inicio)    │
     └──────┬──────┘
            │ startSweepPhase()
            ▼
     ┌─────────────┐
     │    SWEEP    │ ← Captura cada 100ms durante ~25s
     │  (Fase A)   │   Calcula: min/max provisional
     └──────┬──────┘
            │ completeSweepPhase()
            ▼
   ┌────────────────┐
   │  CONFIRM_MIN   │ ← Validación con 4 checks
   │    (Fase B1)   │   Requiere sostener 1s
   └────────┬───────┘
            │ confirmCurrentExtreme()
            ▼
   ┌────────────────┐
   │  CONFIRM_MAX   │ ← Validación con 4 checks
   │    (Fase B2)   │   Requiere sostener 1s
   └────────┬───────┘
            │ confirmCurrentExtreme()
            ▼
     ┌────────────┐
     │  COMPLETE  │ ← Calcula métricas y envía a BD
     └────────────┘
```

---

## 🔬 Detección de Pitch

### AudioPitchService

**Algoritmo:** Autocorrelación simplificada (basado en YIN)

**Características:**
- ✅ No requiere librerías externas (usa Web Audio API nativa)
- ✅ Rango: 80Hz (E2) - 1200Hz (D6)
- ✅ Precision: Interpolación parabólica
- ✅ Confianza: 0-1 (invierte la diferencia normalizada)

**Ventajas:**
- Rápido y eficiente para producción
- No depende de TensorFlow.js (reduce bundle size)

**Limitaciones:**
- Menos preciso que CREPE en frecuencias muy bajas (<100Hz)
- Puede tener problemas con ruido ambiental alto

**Migración futura a CREPE:**
```typescript
// Reemplazar en AudioPitchService.detectPitch()
import { CREPE } from '@crepe/crepe';
const crepe = new CREPE({ model: 'tiny', sampleRate: 44100 });
const result = await crepe.predict(this.timeDataArray);
```

### Métricas Calculadas en Tiempo Real

| Métrica | Descripción | Uso |
|---------|-------------|-----|
| `frequency` | Frecuencia fundamental (Hz) | Conversión a MIDI |
| `confidence` | Confianza de detección (0-1) | Filtro de calidad (>0.8) |
| `midiNote` | Nota MIDI (69 = A4) | Almacenamiento y cálculos |
| `rms` | Volumen en dBFS | Validación de RMS |
| `spectralCentroid` | Brillo del sonido (Hz) | Feature de ML |

---

## 📊 Fases del Ejercicio

### Fase A: Barrido Continuo (SWEEP)

**Objetivo:** Capturar el rango bruto y features globales

**Duración:** ~25 segundos

**Captura:**
- Intervalo: 100ms
- Filtro: `confidence > 0.8`
- Datos guardados: `PitchSample[]` (midi, frequency, confidence, rms, spectralCentroid, timestamp)

**Procesamiento al finalizar:**
1. **Suavizado:** Ventana móvil de 5 samples
2. **Trimming:** Descartar 2.5% de extremos (outliers)
3. **Extremos provisionales:**
   - `provisionalMin = trimmedData[0]`
   - `provisionalMax = trimmedData[last]`

**Cálculos preliminares:**
- `tessituraCenterMidi`: Mediana de todos los pitches
- `spectralCentroid`: Promedio de centroides espectrales
- `dynamicRangeDb`: max(RMS) - min(RMS)
- `registerShifts`: Saltos > 3 semitonos en serie suavizada

---

### Fase B: Confirmación de Extremos

#### Fase B1: Confirmar Mínimo (CONFIRM_MIN)

**Objetivo:** Validar que el usuario puede sostener la nota mínima de forma funcional

**Target:** `provisionalMin` (calculado en Fase A)

**Validación (4 checks):**
1. ✅ **Pitch OK:** `±50 cents` del target
2. ✅ **Confianza OK:** `> 0.8`
3. ✅ **RMS OK:** `> (noiseFloorDb + 6dB)` (evita falsete/emisión débil)
4. ✅ **Sostenido:** Los 3 checks anteriores durante `≥ 1.0 segundo`

**UI:**
- Semáforo con los 4 checks en tiempo real (verde/rojo)
- Barra de progreso de sostenimiento (0-100%)
- Botón "Confirmar Mínimo" habilitado solo cuando `sustained = true`

**Salida:**
- `confirmedMin = extremeTarget`

---

#### Fase B2: Confirmar Máximo (CONFIRM_MAX)

**Objetivo:** Validar que el usuario puede sostener la nota máxima de forma funcional

**Target:** `provisionalMax` (calculado en Fase A)

**Validación:** Igual que B1 (4 checks)

**Salida:**
- `confirmedMax = extremeTarget`

---

### Fase C: Complete (COMPLETE)

**Cálculo de métricas finales:**

```typescript
interface RangeMetrics {
  sessionId: string;                  // ✅ REQUERIDO
  rangeSpanSemitones: number;         // ✅ REQUERIDO: confirmedMax - confirmedMin
  rangeMinMidi: number;               // ✅ REQUERIDO: confirmedMin
  rangeMaxMidi: number;               // ✅ REQUERIDO: confirmedMax
  
  // Opcionales (calculados si hay datos)
  meanRmsDb?: number;                 // Promedio de RMS del barrido
  rmsConsistency?: number;            // 1 - (stdDev / |mean|)
  durationSeconds?: number;           // Duración total del ejercicio
  voiceType?: string;                 // bass | tenor | alto | soprano
  tessituraCenterMidi?: number;       // Mediana de pitches
  spectralCentroid?: number;          // Promedio de centroide espectral
  dynamicRangeDb?: number;            // max(RMS) - min(RMS)
  registerShifts?: number;            // Saltos > 3 semitonos
}
```

**Clasificación de Tipo de Voz:**
```typescript
if (tessituraCenterMidi < 55) → 'bass'       // < G3
if (tessituraCenterMidi < 60) → 'tenor'      // < C4
if (tessituraCenterMidi < 65) → 'alto'       // < F4
else → 'soprano'                             // >= F4
```

**Envío al Backend:**
```typescript
POST /metrics/range
Content-Type: application/json

{
  "sessionId": "abc-123-def-456",
  "rangeSpanSemitones": 24.5,
  "rangeMinMidi": 55.2,
  "rangeMaxMidi": 79.7,
  "meanRmsDb": -25.3,
  "rmsConsistency": 0.85,
  "durationSeconds": 30.5,
  "voiceType": "tenor",
  "tessituraCenterMidi": 65.5,
  "spectralCentroid": 1200.5,
  "dynamicRangeDb": 15.2,
  "registerShifts": 3
}
```

**Respuesta esperada:**
```json
{
  "id": 123,
  "sessionId": "abc-123-def-456",
  "exerciseType": "range",
  "rangeSpanSemitones": 24.5,
  ...
}
```

---

## 🎨 Interfaz de Usuario

### Vista por Fase

#### IDLE - Instrucciones
- Icono: 🎤
- Título: "Bienvenido al Ejercicio de Rango Vocal"
- Lista de instrucciones (3 fases)
- Consejos: vocalizaciones, volumen, comodidad
- Botón: "Comenzar Ejercicio"

#### SWEEP - Barrido Continuo
- Indicadores en tiempo real:
  - **Nota Actual:** Nombre (C4) + MIDI
  - **Confianza:** Barra de progreso + %
  - **Volumen (RMS):** VU meter + dB
- **Progreso del Barrido:** 0-100%
- Botones: "Cancelar" | "Finalizar Barrido" (habilitado en 80%)

#### CONFIRM_MIN/MAX - Confirmación
- **Target destacado:** Nota en grande con gradiente
- **Nota actual:** Mostrando en tiempo real
- **Semáforo de validación:**
  - ✓/✗ Pitch correcto (±50 cents)
  - ✓/✗ Confianza alta (>80%)
  - ✓/✗ Volumen adecuado (>ruido+6dB)
  - ✓/✗ Sostenido 1 segundo
- **Barra de sostenimiento:** 0-100%
- Botones: "Reintentar" | "Confirmar Mínimo/Máximo" (habilitado cuando sustained = true)

#### COMPLETE - Resultados
- Icono: ✅
- Título: "¡Ejercicio Completado!"
- **Grid de métricas:**
  - Tipo de Voz
  - Rango Total (semitonos)
  - Nota Mínima (MIDI)
  - Nota Máxima (MIDI)
  - Tessitura (MIDI)
  - Cambios de Registro
- Botón: "Continuar al Ejercicio de Estabilidad →"

#### ERROR - Manejo de Errores
- Icono: ❌
- Mensaje de error destacado
- Botones: "Volver a Calibración" | "Reintentar Ejercicio"

---

## 🔧 API del Servicio

### VocalRangeService

#### Signals Reactivos (BehaviorSubject)

```typescript
phase$: BehaviorSubject<RangePhase>           // Estado actual
currentNote$: BehaviorSubject<string>         // Nota actual (ej: "A4")
currentMidi$: BehaviorSubject<number>         // MIDI actual
currentConfidence$: BehaviorSubject<number>   // Confianza 0-1
currentRms$: BehaviorSubject<number>          // RMS en dBFS
progress$: BehaviorSubject<number>            // Progreso 0-1
errorMessage$: BehaviorSubject<string | null> // Mensaje de error
tip$: BehaviorSubject<string | null>          // Consejo para el usuario

extremeValidation$: BehaviorSubject<ExtremeValidation> // Estado de los 4 checks
```

#### Métodos Públicos

```typescript
// Iniciar ejercicio
async startSweepPhase(analyser: AnalyserNode): Promise<void>

// Completar barrido y calcular extremos provisionales
completeSweepPhase(): void

// Confirmar extremo actual (min o max)
confirmCurrentExtreme(): void

// Reintentar desde un punto específico
retryFrom(phase: 'sweep' | 'min' | 'max'): void

// Resetear todo el ejercicio
reset(): void

// Obtener métricas calculadas
getCalculatedMetrics(): RangeMetrics | undefined
```

#### Métodos Privados (Cálculos)

```typescript
private movingAverage(data: number[], windowSize: number): number[]
private calculateMean(values: number[]): number
private calculateMedian(values: number[]): number
private calculateConsistency(values: number[]): number
private detectRegisterShifts(smoothedPitches: number[]): number
private calculateVoiceType(avgMidi: number): string
private calculateMetrics(): RangeMetrics
private submitMetrics(metrics: RangeMetrics): Promise<void>
```

---

## 🧪 Casos de Uso

### Flujo Normal (Happy Path)

1. Usuario llega desde Calibración con `sessionId` en localStorage
2. Click en "Comenzar Ejercicio"
3. **Fase A:** Usuario canta desde grave a agudo (~25s)
4. Click en "Finalizar Barrido" → sistema calcula extremos provisionales
5. **Fase B1:** Usuario sostiene nota mínima hasta que los 4 checks estén en verde (1s)
6. Click en "Confirmar Mínimo"
7. **Fase B2:** Usuario sostiene nota máxima hasta que los 4 checks estén en verde (1s)
8. Click en "Confirmar Máximo"
9. Sistema calcula métricas y envía a `POST /metrics/range`
10. Muestra resumen y botón "Continuar al Ejercicio de Estabilidad"

### Casos de Error

#### Error 1: No hay sessionId
```typescript
Error: 'No hay sessionId. Completa la calibración primero.'
Acción: Redirigir a /checkup/calibration
```

#### Error 2: Micrófono inactivo
```typescript
Error: 'El micrófono no está activo'
Acción: Redirigir a /checkup/preparation
```

#### Error 3: Datos insuficientes en barrido
```typescript
Error: 'No hay suficientes datos. Intenta nuevamente cantando de forma continua.'
Acción: Permitir reintentar con botón "Reintentar Ejercicio"
```

#### Error 4: No puede sostener extremo
```typescript
// Usuario no logra mantener los 4 checks en verde durante 1s
Acción: Permitir ajustar target ±1 semitono y reintentar (futuro)
Acción: Botón "Reintentar" reinicia la fase de confirmación
```

#### Error 5: Fallo de red al enviar métricas
```typescript
Error: 'Error al enviar métricas: [mensaje]'
Acción: Mostrar toast de error y botón para reintentar envío
```

---

## 🎯 Criterios de Aceptación (QA)

### ✅ Funcionales

- [ ] El ejercicio usa el `sessionId` de la calibración (no genera nuevos)
- [ ] La captura se realiza cada 100ms con filtro `confidence > 0.8`
- [ ] El barrido se puede completar después de 80% de progreso
- [ ] Los extremos provisionales se calculan con trimming de 2.5%
- [ ] Los 4 checks de validación funcionan correctamente:
  - [ ] Pitch ±50 cents
  - [ ] Confianza >0.8
  - [ ] RMS >ruido+6dB
  - [ ] Sostenido ≥1s
- [ ] El botón de confirmar extremo solo se habilita cuando `sustained = true`
- [ ] Las métricas se calculan correctamente:
  - [ ] `rangeSpanSemitones` = confirmedMax - confirmedMin
  - [ ] `tessituraCenterMidi` = mediana de pitches
  - [ ] `voiceType` se clasifica según tessitura
  - [ ] `registerShifts` cuenta saltos >3 semitonos
- [ ] El payload enviado a `/metrics/range` es válido según DTO
- [ ] La respuesta del backend se procesa correctamente
- [ ] Se puede reintentar cualquier fase

### ✅ No Funcionales

- [ ] El componente carga en <2s
- [ ] La detección de pitch tiene latencia <150ms
- [ ] La UI se actualiza en tiempo real (100ms)
- [ ] No hay memory leaks (limpieza en ngOnDestroy)
- [ ] El bundle size es <500KB con lazy loading
- [ ] Funciona en Chrome, Firefox, Safari, Edge

### ✅ UX

- [ ] Las instrucciones son claras y concisas
- [ ] Los indicadores en tiempo real son legibles
- [ ] El semáforo de validación es intuitivo (verde/rojo)
- [ ] Los botones están deshabilitados apropiadamente
- [ ] Los mensajes de error son informativos
- [ ] La transición entre fases es suave
- [ ] Se muestra feedback visual durante cálculos

---

## 🚀 Optimizaciones Implementadas

### Performance

1. **Throttling de captura:** 100ms (balance entre precisión y CPU)
2. **Filtro de confianza:** Solo guarda samples con `confidence > 0.8`
3. **Lazy loading:** Componente cargado bajo demanda
4. **Suavizado eficiente:** Ventana móvil sin recálculo completo
5. **Signals:** Reactividad optimizada con Angular Signals

### Bundle Size

- ❌ **No usa TensorFlow.js** (ahorra ~1MB)
- ❌ **No usa CREPE** (ahorra ~500KB)
- ✅ **Algoritmo YIN nativo:** Solo Web Audio API
- ✅ **Lazy components:** Solo carga cuando se necesita

### Memoria

- Limpieza automática en `ngOnDestroy`
- Detención de `setInterval` en todas las salidas
- Sin referencias circulares en servicios

---

## 📈 Métricas de Éxito

| Métrica | Target | Estado |
|---------|--------|--------|
| Tasa de completado | >90% | 🟡 Por medir |
| Tiempo promedio | <60s | 🟡 Por medir |
| Reintentos promedio | <2 | 🟡 Por medir |
| Precisión de detección | >80% | 🟡 Por medir |
| Satisfacción del usuario | >4/5 | 🟡 Por medir |

---

## 🔮 Roadmap Futuro

### Mejoras Planificadas

- [ ] **CREPE Integration:** Migrar a @crepe/crepe para mayor precisión
- [ ] **Ajuste dinámico de extremos:** ±1 semitono si usuario no puede sostener
- [ ] **Visualización de forma de onda:** Canvas con audio en tiempo real
- [ ] **Gráfica de rango:** Mostrar distribución de notas cantadas
- [ ] **Comparación con referencias:** Mostrar rango típico por tipo de voz
- [ ] **Guía vocal:** Audio de referencia para el target
- [ ] **Modo avanzado:** Permitir exploración de zonas específicas (falsete, fry)
- [ ] **Exportar datos:** Descargar CSV con todas las samples

### Optimizaciones Pendientes

- [ ] Web Worker para cálculos pesados (evitar bloqueo del main thread)
- [ ] IndexedDB para cache de samples (reintento sin recaptura)
- [ ] Service Worker para funcionamiento offline
- [ ] WebAssembly para algoritmos de pitch (mayor velocidad)

---

## 🐛 Troubleshooting

### Problema: "Pitch detection no funciona"
**Causas posibles:**
- Ruido ambiental muy alto
- Volumen del micrófono muy bajo
- Frecuencias fuera del rango (80-1200 Hz)

**Solución:**
- Verificar calibración previa
- Aumentar volumen del micrófono
- Cantar en el rango medio (C3-C5)

### Problema: "No puede sostener extremos"
**Causas posibles:**
- Nota muy grave/aguda para el usuario
- RMS demasiado bajo (falsete)
- Pitch inestable

**Solución:**
- Reintentar con técnica vocal adecuada
- Ajustar target ±1 semitono (futuro)
- Verificar que el check de RMS esté verde

### Problema: "Ejercicio muy largo"
**Causas posibles:**
- Usuario no sabe cuándo terminar barrido
- Dificultad para sostener extremos

**Solución:**
- Reducir duración de barrido a 20s
- Reducir tiempo de sostenimiento a 0.75s
- Agregar contador regresivo

---

## 📚 Referencias

- [YIN Pitch Detection Algorithm](http://audition.ens.fr/adc/pdf/2002_JASA_YIN.pdf)
- [Web Audio API - AnalyserNode](https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode)
- [MIDI Note Numbers](https://en.wikipedia.org/wiki/MIDI_tuning_standard)
- [Voice Types](https://en.wikipedia.org/wiki/Voice_type)
- [Spectral Centroid](https://en.wikipedia.org/wiki/Spectral_centroid)

---

**Estado:** ✅ Implementación Completa  
**Próximo paso:** Ejercicio de Estabilidad  
**Autor:** Sistema UrSinger  
**Versión:** 1.0.0
