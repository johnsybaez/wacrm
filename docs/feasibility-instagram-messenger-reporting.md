# Análisis de factibilidad: Instagram DM, Facebook Messenger y módulo de reportería

**Fecha**: 2026-07-15
**Alcance**: evaluar qué tan viable es agregar Instagram Direct y Facebook Messenger como canales de mensajería adicionales (hoy wacrm solo soporta WhatsApp), y expandir la analítica actual (dashboard básico) a un módulo de reportería completo.
**Estado**: análisis únicamente — nada de esto se implementó todavía. Pensado para revisar y decidir alcance/orden antes de tocar código.

---

## Resumen ejecutivo

| Iniciativa | Factibilidad técnica | Bloqueador principal | Esfuerzo estimado |
|---|---|---|---|
| Instagram DM | Alta (reutiliza ~40% de la infraestructura Meta ya existente) | **App Review de Meta** (2-4+ semanas, fuera de nuestro control) | 3-4 semanas de desarrollo |
| Facebook Messenger | Alta (misma base que Instagram — Send API casi idéntica) | Mismo App Review, permiso distinto | 1-2 semanas adicionales *si se hace junto con Instagram* |
| Módulo de reportería | Alta (no depende de Meta, se puede empezar ya) | Deuda técnica de performance ya documentada en el código (agregación 100% en cliente) | 2-3 semanas para v1 |

**Recomendación de orden**: arrancar el **App Review de Meta primero** (es la parte que no controlamos y tiene el lead time más largo), en paralelo construir el **módulo de reportería** (no depende de nada de esto y ya hay UI/patrones reutilizables), y luego implementar **Messenger + Instagram juntos en un solo módulo** (no por separado — comparten casi toda la implementación técnica, ver sección 3).

---

## 1. Lo que ya existe hoy (contexto)

wacrm es 100% WhatsApp Business Cloud API. Todo el modelo de datos, webhook, cliente de envío y UI del inbox asumen un solo canal:

- **`contacts.phone`** es `NOT NULL`, con una columna generada (`phone_normalized`) y un índice único pensados exclusivamente para números telefónicos. No existe ningún campo de "canal" ni un identificador externo genérico.
- **`conversations`** es 1:1 con `contact_id`, sin columna de canal — no hay forma de tener dos hilos separados (uno de WhatsApp, uno de Instagram) para el mismo contacto.
- **`whatsapp_config`** tiene `UNIQUE(account_id)` — **una sola integración de mensajería por cuenta**, hardcodeado a nivel de esquema.
- El **webhook entrante** (`src/app/api/whatsapp/webhook/route.ts`) parsea directamente la forma `changes[].value.{messages,contacts,statuses}` de WhatsApp Cloud API, sin nunca leer `body.object` para bifurcar por producto.
- El **cliente saliente** (`src/lib/whatsapp/meta-api.ts`) hardcodea `messaging_product: 'whatsapp'` en cada request y expone funciones exclusivas de WhatsApp (message templates, registro de número, PIN 2FA).
- La **UI del inbox** llama directo a `/api/whatsapp/send` y `/api/whatsapp/react` en 4 lugares distintos de `message-thread.tsx`, sin ninguna capa de "enviar por el canal de esta conversación".
- Las **automatizaciones y flows** tienen mitad de sus pasos agnósticos de canal (tags, deals, asignación, condiciones, webhooks salientes) y mitad acoplados a WhatsApp (`send_template`, `send_buttons`, `send_list`, que dependen de `whatsapp_config`).

**Lo bueno**: hay piezas genuinamente genéricas y 100% reutilizables sin tocarlas:
- `verifyMetaWebhookSignature` (firma HMAC de webhooks) — funciona igual para WhatsApp, Messenger e Instagram porque los tres usan `X-Hub-Signature-256` con el mismo `META_APP_SECRET` de la misma App de Meta.
- `src/lib/whatsapp/encryption.ts` (AES-256-GCM) — ya es genérico, de hecho ya se reutiliza fuera de WhatsApp (API keys de IA).
- `META_APP_ID`/`META_APP_SECRET` — son propiedades de la App de Meta completa, no de un producto específico; la misma App puede tener WhatsApp + Messenger + Instagram habilitados a la vez.
- El patrón de flujo de `send-message.ts` (validar → resolver conversación/config → enviar → persistir → efectos secundarios) es un buen esqueleto a replicar, aunque su implementación interna es 100% WhatsApp.

---

## 2. Requisitos de Meta (lo que no depende de nuestro código)

### Instagram Messaging API
- Requiere una cuenta de **Instagram Business o Creator** vinculada a una Página de Facebook.
- Para enviar mensajes a usuarios reales (no solo hasta 25 test users) hace falta el permiso **`instagram_business_manage_messages`**, aprobado vía **App Review**.
- Requiere completar **Business Verification** en Meta Business Manager (documentos oficiales del negocio) y, por cada permiso, un video mostrando el uso real de la función, más política de privacidad y proceso de borrado de datos.
- Timeline típico: **2-4 semanas** para permisos estándar; permisos de mensajería suelen tardar más o pedir justificación adicional — en la práctica puede ser semanas a meses.
- Rate limit reportado (2026): ~200 DMs automatizados por hora por cuenta — **verificar el límite vigente al momento de implementar**, Meta los cambia con frecuencia.

Fuentes: [Meta Developer Docs — Instagram Platform Overview](https://developers.facebook.com/docs/instagram-platform/overview/), [Meta Developer Docs — Instagram Messaging API](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/), [Chatwoot — Instagram App Review](https://developers.chatwoot.com/self-hosted/instagram-app-review)

### Facebook Messenger Platform
- Requiere una **Página de Facebook** y el permiso **`pages_messaging`** vía App Review (mismo proceso de Business Verification que Instagram si ya se hizo, no hay que repetirlo desde cero).
- **Ventana de 24 horas**: mensajería estándar dentro de las 24h desde el último mensaje del usuario es gratis y libre (sin restricción de formato).
- **Fuera de la ventana de 24h**: cambios recientes de Meta (2026) retiraron los *Message Tags* legacy (`CONFIRMED_EVENT_UPDATE`, `POST_PURCHASE_UPDATE`, `ACCOUNT_UPDATE`) el 27 de abril de 2026 y las *Recurring Notifications* el 10 de febrero de 2026 (excepto AU/EU/JP/KR/UK), a favor de **Utility Templates** dentro de la nueva **Marketing Messages on Messenger API** — un flujo de plantillas con estructura y categoría, conceptualmente muy parecido al de WhatsApp Message Templates (buena noticia: el patrón mental y buena parte de la UI de aprobación/gestión de templates que ya existe para WhatsApp es reutilizable como *inspiración de diseño*, aunque el modelo de datos sería distinto).
- Existe también la extensión de **"1 mensaje humano manual hasta 7 días"** fuera de la ventana estándar.
- **Precio**: el modelo viejo cobraba por ventana de conversación de 24h; el modelo nuevo solo cobra cuando se entrega un *template message* — los mensajes normales dentro de la ventana abierta son gratis, sin tope mensual.

Fuentes: [Meta Developer Docs — Messenger Send API](https://developers.facebook.com/docs/messenger-platform/reference/send-api/), [Meta Developer Docs — Messenger Platform / IG Messaging policy](https://developers.facebook.com/documentation/business-messaging/messenger-platform/policy), [Blotato — Facebook API Pricing 2026](https://www.blotato.com/blog/facebook-api-pricing), [Chatimize — Facebook Messenger Rules 2026](https://chatimize.com/facebook-messenger-policy/)

### Diferencias técnicas de payload (webhook)
- WhatsApp Cloud API: `{ object: "whatsapp_business_account", entry: [{ changes: [{ value: { messages, contacts, statuses } }] }] }`.
- Messenger/Instagram: `{ object: "page" | "instagram", entry: [{ id: "<page_id>", messaging: [{ sender, recipient, timestamp, message }] }] }` — estructura distinta (`messaging[]` en vez de `changes[].value`), sin el array paralelo `contacts[]` (el remitente va embebido en cada evento).
- Para Instagram, los eventos de "echo" (mensajes que el propio negocio envió) llegan en el mismo webhook de `messages`, mientras que en Messenger es un campo de suscripción aparte.
- La firma (`X-Hub-Signature-256`) es idéntica en los tres — sin cambios ahí.

Fuente: [Meta Developer Docs — Instagram Platform Webhooks](https://developers.facebook.com/docs/instagram-platform/webhooks)

**Implicación clave**: como el timeline de App Review (semanas a meses) casi seguro va a ser más largo que el tiempo de desarrollo, **conviene iniciar el proceso de verificación/App Review en Meta cuanto antes**, en paralelo al desarrollo — no esperar a tener el código listo para recién ahí someterlo a revisión.

---

## 3. Por qué Messenger + Instagram se deberían construir juntos (no por separado)

El Send API de Messenger y el de Instagram Messaging son casi idénticos: ambos usan `POST /{id}/messages` con `{ recipient: { id }, message: {...} }` sobre Graph API, ambos comparten la misma forma de webhook (`entry[].messaging[]`), y ambos usan Page Access Token / token de cuenta de negocio de la misma naturaleza. La diferencia real entre ellos es más de **configuración y permisos de Meta** (qué ID se usa — page id vs. IG business account id — y qué scope de permiso se aprueba) que de arquitectura de código.

Construir un solo módulo `src/lib/meta-messaging/` (o similar) que sirva a ambos —con un parámetro de canal que decide el id de la entidad y el token a usar— cuesta poco más que construir solo Messenger, y evita duplicar el 90% del trabajo cuando se quiera agregar el segundo canal después. Es la recomendación central de este análisis.

---

## 4. Cambios de modelo de datos necesarios (aplican a ambos canales)

1. **`conversations`**: agregar columna `channel TEXT CHECK (channel IN ('whatsapp','messenger','instagram')) DEFAULT 'whatsapp'`, y cambiar la clave de búsqueda de `findOrCreateConversation` de `(account_id, contact_id)` a `(account_id, contact_id, channel)` — así un mismo contacto puede tener un hilo de WhatsApp y otro de Instagram sin pisarse.
2. **`contacts`**: `phone` debe pasar a nullable, y se necesita un identificador de canal genérico. Opción recomendada: tabla nueva `contact_channel_identities (contact_id, channel, external_id, created_at)` en vez de forzar el modelo de "un contacto = un teléfono" — permite unificar bajo un mismo contacto de CRM a alguien que escribe por varios canales, que es exactamente el valor de tener un CRM multicanal.
3. **Config por canal**: tablas nuevas `messenger_config` y `instagram_config` (mismo shape que `whatsapp_config` pero con sus propios campos: `page_id`/`ig_business_account_id`, `access_token` encriptado con el mismo `encrypt()` ya existente, `verify_token`, `status`). No conviene forzar todo dentro de `whatsapp_config` — tiene demasiadas columnas específicas de WhatsApp (PIN, registro, WABA).
4. **`messages`**: no necesita cambios de columnas — `content_type` ya cubre `text/image/video/audio/document/location`; simplemente no se usan los valores `template`/`interactive` para estos canales nuevos (son exclusivos de WhatsApp).
5. **Webhook**: nuevas rutas (`src/app/api/messenger/webhook`, `src/app/api/instagram/webhook`, o una sola `src/app/api/meta/webhook` que bifurque por `body.object`), reutilizando `verifyMetaWebhookSignature` tal cual, con parsers nuevos para la forma `entry[].messaging[]`.
6. **UI**: agregar un badge/ícono de canal en `conversation-list.tsx` y `message-bubble.tsx`; generalizar las llamadas hardcodeadas a `/api/whatsapp/send`/`/api/whatsapp/react` en `message-thread.tsx` para que dependan de `conversation.channel`.
7. **Automations/Flows**: los pasos `send_message`/`send_buttons`/`send_list` necesitan una capa de despacho por canal; `send_template` se queda como exclusivo de WhatsApp (ocultar/deshabilitar esa opción cuando la automatización aplica sobre conversaciones de Messenger/Instagram).

---

## 5. Módulo de reportería

### Qué existe hoy
- `src/lib/dashboard/queries.ts` — **toda la agregación es en JavaScript, en cliente/servidor Node, no hay ni una sola función RPC de Postgres**. El propio código ya documenta esto como deuda técnica: *"Perf is acceptable for the current scale (low thousands of messages) — if a tenant's dataset outgrows this, we'd migrate the heavy aggregations to SQL RPCs."*
- 5 funciones nada más: métricas del dashboard, serie de conversaciones (7/30/90 días), dona de pipeline, tiempo de respuesta, feed de actividad.
- El único filtro de fecha que existe es el selector 7/30/90 días del gráfico de conversaciones — no hay un filtro de rango de fechas aplicable a todo el dashboard.
- **No existe ninguna exportación de datos** (CSV/PDF/Excel) en toda la aplicación — ni en Contacts, ni Broadcasts, ni Automations, ni Dashboard. Todo lo que hay hoy es *importación* de CSV (contactos).
- **No existen reportes programados/enviados por email** — no hay infraestructura de envío de email para esto, ni cron dedicado.
- Ya existen datos de negocio suficientes para reportes más ricos sin nuevas tablas: `deals`/`pipeline_stages` (ventas), `ai_usage_log` (costo de IA, ya gateado a admin+), `automation_logs` (ejecuciones), `broadcasts`/`broadcast_recipients` (funnel de entrega/apertura/respuesta por difusión, con timestamps detallados).
- Recharts está instalado pero casi no se usa — solo el wrapper `src/components/tremor/bar-chart.tsx` (Tremor) lo consume; los gráficos de líneas y dona del dashboard actual están dibujados a mano en SVG crudo, no con una librería.
- **Gap de seguridad/permisos a corregir de paso**: hoy el dashboard principal no tiene ningún gate de rol — un `viewer` ve el valor monetario de los deals abiertos sin restricción, a diferencia del widget de uso de IA que sí está correctamente gateado a `admin+`. Un módulo de reportería nuevo debería decidir explícitamente qué reportes son sensibles (ventas/financiero → admin+, operativos → agent+) y aplicar `requireRole()` de forma consistente.

### Propuesta de alcance para v1
1. Sección nueva "Reports" (fuera del dashboard operativo actual, que se queda como está para el día a día).
2. Filtro de rango de fechas libre (no solo 7/30/90) + filtros por agente/canal/etiqueta/pipeline.
3. Categorías de reporte: conversaciones y tiempo de respuesta, ventas/pipeline, rendimiento de difusiones, productividad de agentes (esto conecta directo con el trabajo de estado de agente e histórico de asignaciones ya implementado en sesiones anteriores), costo de uso de IA.
4. Exportación a CSV en cada tabla de reporte (esfuerzo bajo: generación de blob CSV en cliente, sin backend nuevo).
5. Migrar las agregaciones pesadas (series de tiempo, tiempo de respuesta) a funciones RPC de Postgres — necesario porque un reporte típicamente pide rangos más amplios que los 90 días actuales, y la agregación en cliente no escala a eso.
6. Reportes programados por email (semanal/mensual) — **de mayor alcance**, requiere elegir un proveedor de email (Resend/Postmark, no hay ninguno integrado hoy) y un cron nuevo. Recomendado como fase separada, no parte de v1.
7. Aplicar `requireRole('admin')` a los reportes financieros/de ventas, siguiendo el patrón ya usado en `src/app/api/ai/usage/route.ts`.

---

## 6. Roadmap propuesto

1. **Ahora, en paralelo**: iniciar Business Verification + App Review en Meta for Developers para los permisos `pages_messaging` e `instagram_business_manage_messages` (lead time largo, no bloquea nada del código).
2. **Fase 0 — fundación de datos multicanal** (necesaria sin importar qué canal se haga primero): columna `channel` en `conversations`, tabla `contact_channel_identities`, tablas `messenger_config`/`instagram_config`.
3. **Fase 1 — módulo de reportería v1**: no depende de Meta ni de la Fase 0, se puede hacer en paralelo o incluso antes.
4. **Fase 2 — Messenger + Instagram juntos**: módulo compartido de envío/webhook, UI de badges de canal, generalización de las rutas de envío hardcodeadas, pasos de automations/flows con despacho por canal.
5. **Fase 3 (opcional, después)**: reportes programados por email; Utility Templates de Messenger para mensajería fuera de la ventana de 24h.

---

## 7. Riesgos y preguntas abiertas

- **Lead time de Meta**: no hay forma de acelerar el App Review — es el mayor riesgo de cronograma de todo este análisis, no el código.
- **¿La cuenta de Meta actual (la que ya tiene aprobado WhatsApp Business API) ya pasó Business Verification?** Si sí, el review de los nuevos permisos debería ser más rápido; si no, hay que sumar ese trámite al timeline.
- **Decisión de producto pendiente**: ¿un mismo contacto que escribe por WhatsApp e Instagram debe verse como *una sola conversación combinada* o como *dos hilos separados bajo el mismo contacto*? Este análisis asume "hilos separados" (más simple, más fiel a cómo funcionan las plataformas), pero es una decisión de UX que vale la pena confirmar antes de tocar el esquema.
- **Volumen esperado**: el rate limit de ~200 DMs/hora de Instagram puede ser una restricción real si se pretende usar para difusiones masivas — a diferencia de WhatsApp Business API, Messenger/Instagram no están pensados como canal de "broadcast" al mismo volumen.
