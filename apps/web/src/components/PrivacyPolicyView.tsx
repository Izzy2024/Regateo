import {
  ArrowLeft,
  ArrowRight,
  Cookie,
  Database,
  ExternalLink,
  FileCheck2,
  Lock,
  Mail,
  Scale,
  Server,
  ShieldCheck,
} from "lucide-react";
import { useFilterStore } from "@/store/useFilterStore";
import { Button } from "./ui/button";

const SECTIONS = [
  { id: "responsable", number: "01", label: "Responsable y alcance" },
  { id: "datos", number: "02", label: "Datos que recopilamos" },
  { id: "finalidad", number: "03", label: "Finalidad del tratamiento" },
  { id: "derechos-arco", number: "04", label: "Base legal y Derechos ARCO" },
  { id: "cookies", number: "05", label: "Cookies y sesiones seguras" },
  { id: "proveedores", number: "06", label: "Proveedores y seguridad" },
  { id: "enlaces-externos", number: "07", label: "Precios y enlaces externos" },
] as const;

const PARTNER_STORES = [
  "Multimax",
  "Panafoto",
  "Rodelag",
  "Almacenes Titán",
  "Photura",
  "Do it Center",
  "Yoytec",
  "PTYTEC",
];

export function PrivacyPolicyView() {
  const setActiveView = useFilterStore((s) => s.setActiveView);

  const navigateTo = (view: "catalogo" | "mi-espacio") => {
    setActiveView(view);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="mx-auto max-w-[1360px] px-4 py-8 sm:px-6 lg:px-8">
      {/* Top breadcrumb / back bar */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => navigateTo("catalogo")}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#E7E5DF] bg-white px-3 py-1.5 text-xs font-semibold text-[#111315] transition-colors hover:bg-[#F4F3EE] cursor-pointer"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Volver al catálogo</span>
        </button>

        <span className="inline-flex items-center gap-1.5 rounded-full border border-[#A7F3D0] bg-[#ECFDF5] px-3 py-1 text-[11px] font-semibold text-[#047857]">
          <ShieldCheck className="h-3.5 w-3.5" />
          Ley 81 de 2019 · República de Panamá
        </span>
      </div>

      {/* Editorial Header */}
      <header className="rounded-2xl border border-[#E7E5DF] bg-white p-6 sm:p-8 card-elevation">
        <p className="text-xs font-bold tracking-[0.06em] text-[#E64825] uppercase">
          Privacidad y Protección de Datos
        </p>
        <h1 className="mt-2 text-2xl font-extrabold tracking-[-0.03em] text-[#111315] sm:text-3xl">
          Política de Privacidad de Regateo
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-[#525866] sm:text-[15px]">
          En <strong className="font-semibold text-[#111315]">Regateo</strong>{" "}
          creemos en la transparencia total: comparamos precios de tecnología en
          Panamá sin vender tus datos personales ni rastrear tu navegación con
          fines publicitarios. Este documento explica qué datos tratamos, para
          qué los usamos y cómo puedes ejercer tus Derechos ARCO bajo la
          legislación panameña.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-[#EFECE5] pt-4 text-xs text-[#666D7C]">
          <span>
            Jurisdicción:{" "}
            <strong className="font-semibold text-[#111315]">
              República de Panamá
            </strong>
          </span>
          <span>
            Marco legal:{" "}
            <strong className="font-semibold text-[#111315]">
              Ley 81 de 26 de marzo de 2019
            </strong>
          </span>
          <span>
            Contacto de privacidad:{" "}
            <a
              href="mailto:privacidad@regateoapp.com"
              className="font-semibold text-[#E64825] hover:underline"
            >
              privacidad@regateoapp.com
            </a>
          </span>
        </div>
      </header>

      {/* Mobile quick TOC */}
      <nav
        aria-label="Índice de secciones"
        className="mt-6 flex gap-2 overflow-x-auto pb-1 no-scrollbar lg:hidden"
      >
        {SECTIONS.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            className="shrink-0 rounded-full border border-[#E7E5DF] bg-white px-3 py-1.5 text-xs font-semibold text-[#525866] transition-colors hover:border-[#111315] hover:text-[#111315]"
          >
            <span className="mr-1 font-mono text-[11px] text-[#E64825]">
              {section.number}
            </span>
            {section.label}
          </a>
        ))}
      </nav>

      {/* Main 2-column editorial grid */}
      <div className="mt-7 grid items-start gap-7 lg:grid-cols-[260px_1fr]">
        {/* Desktop Sticky TOC */}
        <aside className="sticky top-22 hidden space-y-4 lg:block">
          <nav
            aria-label="Tabla de contenidos"
            className="rounded-xl border border-[#E7E5DF] bg-white p-4 card-elevation"
          >
            <h2 className="text-[11px] font-bold tracking-[0.05em] text-[#666D7C] uppercase">
              Tabla de contenidos
            </h2>
            <ol className="mt-3 space-y-1">
              {SECTIONS.map((section) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-[#525866] transition-colors hover:bg-[#FAFAF7] hover:text-[#111315]"
                  >
                    <span className="font-mono text-[11px] font-bold text-[#666D7C] group-hover:text-[#E64825]">
                      {section.number}
                    </span>
                    <span className="leading-snug">{section.label}</span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <div className="rounded-xl border border-[#A7F3D0] bg-[#ECFDF5]/70 p-4">
            <h3 className="flex items-center gap-1.5 text-xs font-bold text-[#047857]">
              <FileCheck2 className="h-4 w-4" />
              Compromiso rápido
            </h3>
            <ul className="mt-2.5 space-y-1.5 text-xs text-[#065F46]">
              <li>• Nunca pedimos tarjetas de crédito.</li>
              <li>• Nunca vendemos tu correo a terceros.</li>
              <li>• Cero píxeles publicitarios invasivos.</li>
              <li>• Control total sobre tus alertas y cuenta.</li>
            </ul>
          </div>
        </aside>

        {/* Policy Body */}
        <article className="space-y-6">
          {/* 1. Responsable y alcance */}
          <section
            id="responsable"
            className="scroll-mt-24 rounded-2xl border border-[#E7E5DF] bg-white p-6 sm:p-7 card-elevation"
          >
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FEF2EE] text-[#E64825]">
                <Scale className="h-4 w-4" />
              </span>
              <div>
                <span className="font-mono text-[11px] font-bold text-[#E64825]">
                  SECCIÓN 01
                </span>
                <h2 className="text-lg font-bold tracking-[-0.02em] text-[#111315]">
                  Responsable y alcance
                </h2>
              </div>
            </div>
            <div className="mt-4 space-y-3 text-sm leading-relaxed text-[#525866]">
              <p>
                <strong className="font-semibold text-[#111315]">
                  Regateo
                </strong>{" "}
                es una plataforma tecnológica independiente de comparación de
                precios de electrónica y cómputo que opera para usuarios en la
                República de Panamá.
              </p>
              <p>
                Regateo{" "}
                <strong className="font-semibold text-[#111315]">
                  no vende productos directamente, no gestiona inventarios ni
                  procesa tarjetas de crédito, transferencias o pagos en línea
                </strong>
                . Nuestro servicio se limita a recopilar información pública de
                precios en comercios locales y ofrecer herramientas personales de
                comparación, presupuestos y alertas.
              </p>
            </div>
          </section>

          {/* 2. Datos personales que recopilamos */}
          <section
            id="datos"
            className="scroll-mt-24 rounded-2xl border border-[#E7E5DF] bg-white p-6 sm:p-7 card-elevation"
          >
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FEF2EE] text-[#E64825]">
                <Database className="h-4 w-4" />
              </span>
              <div>
                <span className="font-mono text-[11px] font-bold text-[#E64825]">
                  SECCIÓN 02
                </span>
                <h2 className="text-lg font-bold tracking-[-0.02em] text-[#111315]">
                  Datos personales que recopilamos
                </h2>
              </div>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-[#525866]">
              Aplicamos el principio de minimización de datos: únicamente
              recopilamos la información estrictamente necesaria para brindarte
              cada función que elijas utilizar.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-[#E7E5DF] bg-[#FAFAF7] p-4">
                <h3 className="text-xs font-bold text-[#111315]">
                  Datos de cuenta
                </h3>
                <p className="mt-1.5 text-xs leading-relaxed text-[#525866]">
                  Nombre, correo electrónico y contraseña almacenada únicamente
                  mediante hash criptográfico seguro gestionado con{" "}
                  <strong className="text-[#111315]">Better Auth</strong>. Nunca
                  guardamos tu contraseña en texto plano.
                </p>
              </div>
              <div className="rounded-xl border border-[#E7E5DF] bg-[#FAFAF7] p-4">
                <h3 className="text-xs font-bold text-[#111315]">
                  Actividad en Mi Espacio
                </h3>
                <p className="mt-1.5 text-xs leading-relaxed text-[#525866]">
                  Productos guardados en favoritos (incluyendo el precio de
                  referencia al guardar), listas de presupuesto personalizadas y
                  alertas de precio con tu monto objetivo en USD.
                </p>
              </div>
              <div className="rounded-xl border border-[#E7E5DF] bg-[#FAFAF7] p-4">
                <h3 className="text-xs font-bold text-[#111315]">
                  Datos técnicos anti-bot
                </h3>
                <p className="mt-1.5 text-xs leading-relaxed text-[#525866]">
                  Dirección IP de forma temporal para control de frecuencia
                  (rate limiting) y señales mínimas de verificación mediante
                  Cloudflare Turnstile o desafío anti-bot firmado.
                </p>
              </div>
            </div>
          </section>

          {/* 3. Finalidad del tratamiento */}
          <section
            id="finalidad"
            className="scroll-mt-24 rounded-2xl border border-[#E7E5DF] bg-white p-6 sm:p-7 card-elevation"
          >
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FEF2EE] text-[#E64825]">
                <FileCheck2 className="h-4 w-4" />
              </span>
              <div>
                <span className="font-mono text-[11px] font-bold text-[#E64825]">
                  SECCIÓN 03
                </span>
                <h2 className="text-lg font-bold tracking-[-0.02em] text-[#111315]">
                  Finalidad del tratamiento
                </h2>
              </div>
            </div>
            <ul className="mt-4 space-y-2.5 text-sm leading-relaxed text-[#525866]">
              <li className="flex items-start gap-2.5">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#E64825]" />
                <span>
                  <strong className="font-semibold text-[#111315]">
                    Sincronización de Mi Espacio:
                  </strong>{" "}
                  mantener tus favoritos, listas de presupuesto y notas
                  disponibles entre tus dispositivos.
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#E64825]" />
                <span>
                  <strong className="font-semibold text-[#111315]">
                    Evaluación de bajadas y alertas de precio:
                  </strong>{" "}
                  comparar periódicamente el precio objetivo que configuraste y
                  avisarte a tu correo cuando alguna tienda alcance o mejore ese
                  precio.
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#E64825]" />
                <span>
                  <strong className="font-semibold text-[#111315]">
                    Asistente Regateo AI:
                  </strong>{" "}
                  procesar tu pregunta de búsqueda para recomendarte productos y
                  comparativas actualizadas del catálogo panameño.
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#E64825]" />
                <span>
                  <strong className="font-semibold text-[#111315]">
                    Seguridad e integridad del servicio:
                  </strong>{" "}
                  prevenir registros masivos, spam de alertas, ataques de fuerza
                  bruta y abuso automatizado mediante bots.
                </span>
              </li>
            </ul>
          </section>

          {/* 4. Base legal y Derechos ARCO (Ley 81 de 2019) */}
          <section
            id="derechos-arco"
            className="scroll-mt-24 rounded-2xl border border-[#E7E5DF] bg-white p-6 sm:p-7 card-elevation"
          >
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#ECFDF5] text-[#059669]">
                <ShieldCheck className="h-4 w-4" />
              </span>
              <div>
                <span className="font-mono text-[11px] font-bold text-[#059669]">
                  SECCIÓN 04
                </span>
                <h2 className="text-lg font-bold tracking-[-0.02em] text-[#111315]">
                  Base legal y Derechos ARCO (Ley 81 de 2019 de Panamá)
                </h2>
              </div>
            </div>
            <div className="mt-4 space-y-3 text-sm leading-relaxed text-[#525866]">
              <p>
                El tratamiento de tus datos personales se fundamenta en tu{" "}
                <strong className="font-semibold text-[#111315]">
                  consentimiento expreso e informado
                </strong>{" "}
                y en la ejecución de las funcionalidades que solicitas, en
                cumplimiento de la{" "}
                <strong className="font-semibold text-[#111315]">
                  Ley 81 de 26 de marzo de 2019
                </strong>{" "}
                sobre Protección de Datos Personales de la República de Panamá y
                su reglamentación vigente.
              </p>
              <p>
                Como titular de los datos tienes garantizados los siguientes
                derechos irrenunciables (ARCO + Portabilidad):
              </p>

              <div className="grid gap-2.5 pt-1 sm:grid-cols-2">
                <div className="rounded-xl border border-[#E7E5DF] bg-[#FAFAF7] p-3.5">
                  <strong className="text-xs font-bold text-[#111315]">
                    Acceso
                  </strong>
                  <p className="mt-1 text-xs text-[#525866]">
                    Conocer qué datos tuyos almacenamos, su origen y las
                    condiciones de su tratamiento.
                  </p>
                </div>
                <div className="rounded-xl border border-[#E7E5DF] bg-[#FAFAF7] p-3.5">
                  <strong className="text-xs font-bold text-[#111315]">
                    Rectificación
                  </strong>
                  <p className="mt-1 text-xs text-[#525866]">
                    Corregir o actualizar tus datos cuando sean inexactos,
                    incompletos o desactualizados.
                  </p>
                </div>
                <div className="rounded-xl border border-[#E7E5DF] bg-[#FAFAF7] p-3.5">
                  <strong className="text-xs font-bold text-[#111315]">
                    Cancelación
                  </strong>
                  <p className="mt-1 text-xs text-[#525866]">
                    Solicitar la eliminación de tus favoritos, alertas, listas o
                    el borrado total y definitivo de tu cuenta.
                  </p>
                </div>
                <div className="rounded-xl border border-[#E7E5DF] bg-[#FAFAF7] p-3.5">
                  <strong className="text-xs font-bold text-[#111315]">
                    Oposición y Portabilidad
                  </strong>
                  <p className="mt-1 text-xs text-[#525866]">
                    Oponerte a tratamientos específicos por motivos legítimos y
                    obtener una copia estructurada de tus datos personales.
                  </p>
                </div>
              </div>

              <div className="mt-3 rounded-xl border border-[#E7E5DF] bg-[#FAFAF7] p-4">
                <div className="flex items-start gap-2.5">
                  <Mail className="mt-0.5 h-4 w-4 shrink-0 text-[#E64825]" />
                  <div className="text-xs leading-relaxed text-[#525866]">
                    <p className="font-bold text-[#111315]">
                      ¿Cómo ejercer tus derechos o eliminar tu cuenta?
                    </p>
                    <p className="mt-1">
                      Puedes eliminar alertas, listas de presupuesto y favoritos
                      en cualquier momento directamente desde{" "}
                      <button
                        type="button"
                        onClick={() => navigateTo("mi-espacio")}
                        className="font-semibold text-[#E64825] underline hover:text-[#B83416] cursor-pointer"
                      >
                        Mi Espacio
                      </button>
                      . Para solicitar el borrado total de tu cuenta o ejercer
                      cualquier derecho ARCO, escríbenos a{" "}
                      <a
                        href="mailto:privacidad@regateoapp.com"
                        className="font-semibold text-[#111315] underline hover:text-[#E64825]"
                      >
                        privacidad@regateoapp.com
                      </a>{" "}
                      indicando tu correo registrado. Responderemos dentro de
                      los plazos legales establecidos por la Ley 81 (máximo 10
                      días hábiles para acceso y 5 días hábiles para
                      rectificación o cancelación).
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* 5. Cookies y sesiones seguras */}
          <section
            id="cookies"
            className="scroll-mt-24 rounded-2xl border border-[#E7E5DF] bg-white p-6 sm:p-7 card-elevation"
          >
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FEF2EE] text-[#E64825]">
                <Cookie className="h-4 w-4" />
              </span>
              <div>
                <span className="font-mono text-[11px] font-bold text-[#E64825]">
                  SECCIÓN 05
                </span>
                <h2 className="text-lg font-bold tracking-[-0.02em] text-[#111315]">
                  Cookies y sesiones seguras
                </h2>
              </div>
            </div>
            <div className="mt-4 space-y-3 text-sm leading-relaxed text-[#525866]">
              <p>
                Utilizamos exclusivamente{" "}
                <strong className="font-semibold text-[#111315]">
                  cookies técnicas esenciales de sesión
                </strong>{" "}
                configuradas con banderas de seguridad{" "}
                <code className="rounded bg-[#F4F3EE] px-1.5 py-0.5 font-mono text-xs text-[#111315]">
                  HttpOnly
                </code>{" "}
                y{" "}
                <code className="rounded bg-[#F4F3EE] px-1.5 py-0.5 font-mono text-xs text-[#111315]">
                  SameSite
                </code>{" "}
                para mantener tu sesión iniciada y proteger tu cuenta contra
                ataques CSRF/XSS.
              </p>
              <p>
                Si navegas como invitado sin crear cuenta, tus favoritos
                temporales y el comparador rápido se almacenan únicamente en el{" "}
                <code className="rounded bg-[#F4F3EE] px-1.5 py-0.5 font-mono text-xs text-[#111315]">
                  localStorage
                </code>{" "}
                de tu propio navegador.{" "}
                <strong className="font-semibold text-[#111315]">
                  No instalamos trackers publicitarios ni redes de retargeting
                  invasivas de terceros.
                </strong>
              </p>
            </div>
          </section>

          {/* 6. Proveedores tecnológicos y seguridad */}
          <section
            id="proveedores"
            className="scroll-mt-24 rounded-2xl border border-[#E7E5DF] bg-white p-6 sm:p-7 card-elevation"
          >
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FEF2EE] text-[#E64825]">
                <Server className="h-4 w-4" />
              </span>
              <div>
                <span className="font-mono text-[11px] font-bold text-[#E64825]">
                  SECCIÓN 06
                </span>
                <h2 className="text-lg font-bold tracking-[-0.02em] text-[#111315]">
                  Proveedores tecnológicos y seguridad
                </h2>
              </div>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-[#525866]">
              Para operar con alta disponibilidad y seguridad técnica, nos
              apoyamos en infraestructura especializada bajo medidas de cifrado
              en tránsito (TLS/HTTPS) y control de acceso estricto:
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-[#E7E5DF] bg-[#FAFAF7] p-4">
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#111315]">
                  <Lock className="h-3.5 w-3.5 text-[#059669]" />
                  PostgreSQL (Base de datos)
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-[#525866]">
                  Almacena el catálogo de precios, cuentas autenticadas,
                  favoritos, listas y alertas con conexiones cifradas en
                  tránsito.
                </p>
              </div>
              <div className="rounded-xl border border-[#E7E5DF] bg-[#FAFAF7] p-4">
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#111315]">
                  <Lock className="h-3.5 w-3.5 text-[#059669]" />
                  Upstash Redis (Caché y Rate Limit)
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-[#525866]">
                  Acelera consultas del catálogo y administra contadores
                  temporales de limitación de peticiones (rate limiting) para
                  evitar abusos.
                </p>
              </div>
              <div className="rounded-xl border border-[#E7E5DF] bg-[#FAFAF7] p-4">
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#111315]">
                  <Lock className="h-3.5 w-3.5 text-[#059669]" />
                  IA Gateway (DeepSeek / OpenRouter)
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-[#525866]">
                  Procesa únicamente el texto de tu consulta de búsqueda en
                  Regateo AI.{" "}
                  <strong className="text-[#111315]">
                    Nunca enviamos tu correo, contraseña ni datos personales de
                    tu cuenta al modelo de IA.
                  </strong>
                </p>
              </div>
              <div className="rounded-xl border border-[#E7E5DF] bg-[#FAFAF7] p-4">
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#111315]">
                  <Lock className="h-3.5 w-3.5 text-[#059669]" />
                  Cloudflare Turnstile / Desafío Anti-Bot
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-[#525866]">
                  Valida que el inicio de sesión, registro y creación de alertas
                  provengan de personas reales sin rastreo publicitario.
                </p>
              </div>
            </div>
          </section>

          {/* 7. Transparencia de precios y enlaces externos */}
          <section
            id="enlaces-externos"
            className="scroll-mt-24 rounded-2xl border border-[#E7E5DF] bg-white p-6 sm:p-7 card-elevation"
          >
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FEF2EE] text-[#E64825]">
                <ExternalLink className="h-4 w-4" />
              </span>
              <div>
                <span className="font-mono text-[11px] font-bold text-[#E64825]">
                  SECCIÓN 07
                </span>
                <h2 className="text-lg font-bold tracking-[-0.02em] text-[#111315]">
                  Transparencia de precios y enlaces externos
                </h2>
              </div>
            </div>
            <div className="mt-4 space-y-3 text-sm leading-relaxed text-[#525866]">
              <p>
                Los precios y disponibilidad mostrados en Regateo son{" "}
                <strong className="font-semibold text-[#111315]">
                  referenciales
                </strong>{" "}
                y corresponden al último barrido automatizado registrado. Los
                comercios pueden modificar sus precios, promociones, ITBMS o
                inventario en cualquier momento sin previo aviso.
              </p>
              <p>
                Al hacer clic en cualquier oferta para comprar o verificar un
                producto, abandonas Regateo y te diriges al sitio web oficial
                del comercio correspondiente, el cual opera bajo sus propios
                términos de venta y política de privacidad:
              </p>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {PARTNER_STORES.map((storeName) => (
                  <span
                    key={storeName}
                    className="rounded-lg border border-[#E7E5DF] bg-[#FAFAF7] px-2.5 py-1 text-xs font-semibold text-[#111315]"
                  >
                    {storeName}
                  </span>
                ))}
              </div>
            </div>
          </section>

          {/* Bottom CTA */}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#E7E5DF] bg-white p-5 sm:p-6">
            <div>
              <h3 className="text-sm font-bold text-[#111315]">
                ¿Listo para seguir comparando precios en Panamá?
              </h3>
              <p className="mt-0.5 text-xs text-[#525866]">
                Revisa el catálogo actualizado o administra tus alertas y listas
                en Mi Espacio.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigateTo("mi-espacio")}
              >
                Ir a Mi Espacio
              </Button>
              <Button
                variant="brand"
                size="sm"
                onClick={() => navigateTo("catalogo")}
              >
                <span>Explorar catálogo</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </article>
      </div>
    </div>
  );
}
