# Historias de Usuario con Criterios de Aceptación

> Basado en PRODUCT_BACKLOG_TESIS_V2.md

---

## HU-001 — Registro en la plataforma
**Historia:** Como cantante principiante quiero poder registrarme en la plataforma con mi correo y contraseña para acceder al flujo de evaluación inicial y ruta de aprendizaje.

**Escenarios:**
- **Escenario 1: Registro exitoso**
	- **Criterio:** Dado un correo válido y contraseña válida, cuando envío el formulario, entonces se crea la cuenta y se confirma el registro.
- **Escenario 2: Correo inválido**
	- **Criterio:** Dado un correo con formato inválido, cuando envío el formulario, entonces se muestra un mensaje de error y no se crea la cuenta.
- **Escenario 3: Campos obligatorios vacíos**
	- **Criterio:** Dado un formulario incompleto, cuando envío, entonces se indican los campos faltantes.

---

## HU-002 — Inicio de sesión
**Historia:** Como cantante principiante registrado quiero iniciar sesión con mi correo y contraseña para acceder a mi ruta de aprendizaje personalizada.

**Escenarios:**
- **Escenario 1: Login exitoso**
	- **Criterio:** Dado un usuario registrado, cuando ingresa credenciales correctas, entonces accede al sistema.
- **Escenario 2: Credenciales inválidas**
	- **Criterio:** Dado un usuario, cuando ingresa una contraseña incorrecta, entonces se muestra error.
- **Escenario 3: Sesión persistente**
	- **Criterio:** Dado un login exitoso, cuando recarga, entonces mantiene la sesión.

---

## HU-003 — Completar perfil inicial
**Historia:** Como cantante principiante que acaba de registrarse quiero completar mi perfil con información básica para que el sistema pueda personalizar mi evaluación y ruta.

**Escenarios:**
- **Escenario 1: Guardar perfil completo**
	- **Criterio:** Dado un perfil con datos válidos, cuando guardo, entonces se persisten los datos.
- **Escenario 2: Validación de campos**
	- **Criterio:** Dado un campo obligatorio vacío, cuando guardo, entonces se muestra error.

---

## HU-004 — Calibración de micrófono
**Historia:** Como cantante principiante quiero calibrar mi micrófono antes de la evaluación inicial para asegurar una captura confiable de mi voz.

**Escenarios:**
- **Escenario 1: Calibración exitosa**
	- **Criterio:** Dado acceso al micrófono, cuando la señal supera el umbral, entonces se valida.
- **Escenario 2: Permiso denegado**
	- **Criterio:** Dado que el usuario niega el permiso, cuando inicia calibración, entonces se muestra bloqueo.
- **Escenario 3: Señal insuficiente**
	- **Criterio:** Dado ruido muy bajo, cuando calibra, entonces no permite continuar.

---

## HU-023 — Cierre de sesión seguro
**Historia:** Como cantante principiante quiero poder cerrar sesión de forma segura para proteger mi privacidad en dispositivos compartidos.

**Escenarios:**
- **Escenario 1: Logout exitoso**
	- **Criterio:** Dado un usuario logueado, cuando cierra sesión, entonces se limpia la sesión y vuelve a login.

---

## HU-005 — Evaluación de rango vocal
**Historia:** Como cantante principiante quiero realizar una prueba de rango vocal en la evaluación inicial para que el sistema identifique mis notas cómodas.

**Escenarios:**
- **Escenario 1: Rango detectado**
	- **Criterio:** Dado que el usuario realiza la prueba, cuando completa, entonces se guarda su rango.
- **Escenario 2: Fallo de captura**
	- **Criterio:** Dado un micrófono inactivo, cuando intenta, entonces se solicita corregir.

---

## HU-006 — Evaluación de estabilidad vocal
**Historia:** Como cantante principiante quiero realizar una prueba de nota sostenida en la evaluación inicial para que el sistema mida mi estabilidad tonal.

**Escenarios:**
- **Escenario 1: Prueba exitosa**
	- **Criterio:** Dado que el usuario sostiene la nota, cuando termina, entonces se registra la estabilidad.
- **Escenario 2: Prueba fallida**
	- **Criterio:** Dado que la nota no se sostiene, cuando termina, entonces se marca fallo.

---

## HU-007 — Análisis con ML de métricas
**Historia:** Como cantante principiante quiero que el sistema analice mis métricas vocales y detecte mis carencias para generar un veredicto que alimente mi ruta de aprendizaje.

**Escenarios:**
- **Escenario 1: Veredicto generado**
	- **Criterio:** Dado métricas válidas, cuando se envían, entonces se recibe veredicto.
- **Escenario 2: Servicio ML no disponible**
	- **Criterio:** Dado un fallo del servicio, cuando se solicita, entonces se informa error.

---

## HU-025 — Stepper de progreso
**Historia:** Como cantante principiante quiero ver mi progreso en el flujo de evaluación inicial para saber en qué etapa estoy y cuántas faltan.

**Escenarios:**
- **Escenario 1: Progreso visible**
	- **Criterio:** Dado el flujo en ejecución, cuando se avanza, entonces el stepper actualiza el estado.

---

## HU-008 — Resultados de evaluación
**Historia:** Como cantante principiante quiero ver los resultados de mi evaluación inicial de forma clara para entender mis fortalezas y debilidades actuales.

**Escenarios:**
- **Escenario 1: Resultados visibles**
	- **Criterio:** Dado que la evaluación terminó, cuando se accede a resultados, entonces se muestran métricas y debilidades.

---

## HU-009 — Generación automática de ruta
**Historia:** Como cantante principiante quiero que el sistema genere automáticamente una ruta de aprendizaje basada en mi veredicto para enfocar mi práctica en mis áreas de mejora.

**Escenarios:**
- **Escenario 1: Plan generado**
	- **Criterio:** Dado un veredicto, cuando se genera la ruta, entonces se crea el plan semanal.

---

## HU-010 — Visualización de ruta semanal
**Historia:** Como cantante principiante quiero ver mi ruta de aprendizaje semanal de forma clara para saber qué ejercicios debo realizar en el momento que yo elija.

**Escenarios:**
- **Escenario 1: Ruta visible**
	- **Criterio:** Dado un plan activo, cuando accede al dashboard, entonces ve sus ejercicios por día.

---

## HU-021 — Navegación entre módulos
**Historia:** Como cantante principiante quiero poder navegar fácilmente entre evaluación, ruta y perfil para acceder rápidamente a las funcionalidades principales.

**Escenarios:**
- **Escenario 1: Navegación correcta**
	- **Criterio:** Dado el header, cuando selecciona una sección, entonces se redirige al módulo.

---

## HU-022 — Header condicional
**Historia:** Como cantante principiante quiero que el header se adapte según mi estado para no ver opciones antes de tener una ruta activa.

**Escenarios:**
- **Escenario 1: Sin ruta activa**
	- **Criterio:** Dado un usuario sin plan, cuando ingresa, entonces no ve opciones de entrenamiento.
- **Escenario 2: Con ruta activa**
	- **Criterio:** Dado un usuario con plan, cuando ingresa, entonces ve todas las opciones.

---

## HU-011 — Teoría CVT y EVM
**Historia:** Como cantante principiante quiero entender la teoría detrás de cada ejercicio (CVT y EVM) para comprender qué estoy trabajando y por qué es importante.

**Escenarios:**
- **Escenario 1: Teoría visible**
	- **Criterio:** Dado un ejercicio con teoría, cuando se ve el detalle, entonces se muestran las descripciones.

---

## HU-012 — Práctica segmentada
**Historia:** Como cantante principiante quiero practicar ejercicios de mi ruta de aprendizaje de forma segmentada para completar mis metas sin depender de un flujo continuo.

**Escenarios:**
- **Escenario 1: Inicio de ejercicio**
	- **Criterio:** Dado un ejercicio pendiente, cuando lo inicio, entonces se abre la práctica.

---

## HU-013 — Feedback visual en tiempo real
**Historia:** Como cantante principiante quiero ver feedback visual en tiempo real mientras canto para ajustar mi técnica inmediatamente.

**Escenarios:**
- **Escenario 1: Feedback activo**
	- **Criterio:** Dado que el usuario canta, cuando la app detecta la nota, entonces se actualizan indicadores.

---

## HU-014 — Reintentar ejercicio
**Historia:** Como cantante principiante quiero poder reintentar un ejercicio sin cambiar de vista para seguir practicando hasta lograr el objetivo.

**Escenarios:**
- **Escenario 1: Reintento exitoso**
	- **Criterio:** Dado un fallo, cuando reintento, entonces el ejercicio se reinicia.

---

## HU-015 — Marcar ejercicio como completado
**Historia:** Como cantante principiante quiero que el sistema marque automáticamente un ejercicio como completado para llevar un registro de mi progreso semanal.

**Escenarios:**
- **Escenario 1: Completado registrado**
	- **Criterio:** Dado un ejercicio exitoso, cuando finaliza, entonces se marca como completado.

---

## HU-016 — Progresión bloqueada por semana
**Historia:** Como cantante principiante quiero que el sistema me obligue a completar todos los ejercicios antes de avanzar para asegurarme de construir una base sólida.

**Escenarios:**
- **Escenario 1: Bloqueo activo**
	- **Criterio:** Dado ejercicios pendientes, cuando intento avanzar, entonces se bloquea.

---

## HU-018 — Prevención de duplicados
**Historia:** Como cantante principiante quiero que el sistema me impida completar un ejercicio duplicado para evitar inflar artificialmente mi progreso.

**Escenarios:**
- **Escenario 1: Duplicado prevenido**
	- **Criterio:** Dado un ejercicio ya completado, cuando intento repetir, entonces se bloquea el registro.

---

## HU-017 — Estadísticas de progreso
**Historia:** Como cantante principiante quiero ver estadísticas detalladas de mi progreso para motivarme y entender cuánto he avanzado.

**Escenarios:**
- **Escenario 1: Estadísticas visibles**
	- **Criterio:** Dado progreso registrado, cuando entro al dashboard, entonces veo estadísticas.

---

## HU-019 — Actualización de perfil
**Historia:** Como cantante principiante quiero poder actualizar mi información personal para mantener mi perfil actualizado.

**Escenarios:**
- **Escenario 1: Actualización exitosa**
	- **Criterio:** Dado datos válidos, cuando guardo, entonces se actualiza el perfil.

---

## HU-020 — Visualización de perfil
**Historia:** Como cantante principiante quiero ver mi información de perfil actual para confirmar que mis datos son correctos.

**Escenarios:**
- **Escenario 1: Perfil visible**
	- **Criterio:** Dado un usuario autenticado, cuando entra al perfil, entonces ve sus datos.

---

## HU-024 — Evaluación vocal periódica
**Historia:** Como cantante principiante con ruta activa quiero realizar una evaluación periódica después de 1 mes para medir mi mejora y generar una nueva ruta de aprendizaje si corresponde.

**Escenarios:**
- **Escenario 1: Evaluación habilitada**
	- **Criterio:** Dado un mes transcurrido, cuando entro, entonces puedo re-evaluar.
- **Escenario 2: Nueva ruta generada**
	- **Criterio:** Dado nuevo veredicto, cuando termina, entonces se actualiza el plan.

---

## HU-012 (Subcomponente) — Ejercicio genérico (nivel 1 y 2)
**Historia:** Como cantante principiante quiero que los ejercicios tengan niveles de dificultad para progresar gradualmente.

**Escenarios:**
- **Escenario 1: Nivel 1**
	- **Criterio:** Dado el nivel básico, cuando ejecuto, entonces se aplican tolerancias amplias.
- **Escenario 2: Nivel 2**
	- **Criterio:** Dado el nivel avanzado, cuando ejecuto, entonces se aplican tolerancias estrictas.
