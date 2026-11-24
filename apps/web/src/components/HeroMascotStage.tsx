import type { ProductCategory } from "@regateo/shared";
import { Radar, Sparkles, Tag } from "lucide-react";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "motion/react";
import { useMemo, useState } from "react";
import { cn, getCategoryShortLabel } from "@/lib/utils";
import { useFilterStore } from "@/store/useFilterStore";
import { CategoryIcon } from "./CategoryIcon";

interface CategoryPersona {
  label: string;
  badge: string;
  speech: string;
  accent: string;
  softBg: string;
  border: string;
  ring: string;
  aiPrompt: string;
}

const DEFAULT_PERSONA: CategoryPersona = {
  label: "Rega · IA",
  badge: "Asistente Regateo AI",
  speech: "¡Hola! Soy Rega. Tócame y te busco el mejor precio entre todas las tiendas.",
  accent: "#E64825",
  softBg: "#FEF2EE",
  border: "#FBCFC3",
  ring: "rgba(230, 72, 37, 0.16)",
  aiPrompt: "¿Cuáles son las mejores ofertas reales en Panamá hoy?",
};

const CATEGORY_PERSONAS: Record<ProductCategory, CategoryPersona> = {
  televisores: {
    label: "Televisores",
    badge: "4K · QLED · OLED",
    speech: "¿TV 4K u OLED? Te cazo el precio real sin descuentos inflados.",
    accent: "#4F46E5",
    softBg: "#EEF2FF",
    border: "#C7D2FE",
    ring: "rgba(79, 70, 229, 0.16)",
    aiPrompt: "Recomiéndame los mejores televisores 4K con mejor precio en Panamá hoy.",
  },
  computadoras: {
    label: "Computadoras",
    badge: "Laptops · PCs",
    speech: "Buscando laptops con buena RAM y stock verificado en Panamá.",
    accent: "#2563EB",
    softBg: "#EFF6FF",
    border: "#BFDBFE",
    ring: "rgba(37, 99, 235, 0.16)",
    aiPrompt: "¿Qué laptops tienen mejor relación calidad-precio en Panamá ahora mismo?",
  },
  celulares: {
    label: "Celulares",
    badge: "iPhone · Galaxy",
    speech: "Comparando celulares desbloqueados con stock real hoy.",
    accent: "#E11D48",
    softBg: "#FFF1F2",
    border: "#FECDD3",
    ring: "rgba(225, 29, 72, 0.16)",
    aiPrompt: "Compara los mejores precios de celulares en tiendas de Panamá hoy.",
  },
  "linea-blanca": {
    label: "Línea Blanca",
    badge: "Ahorro top",
    speech: "Lavadoras y refris comparadas: aquí es donde más ahorras.",
    accent: "#059669",
    softBg: "#ECFDF5",
    border: "#A7F3D0",
    ring: "rgba(5, 150, 105, 0.16)",
    aiPrompt: "¿Qué lavadoras o refrigeradoras tienen mayor ahorro entre tiendas en Panamá?",
  },
  gaming: {
    label: "Gaming",
    badge: "Modo Gamer",
    speech: "Consolas, monitores y combos gamer sin sobreprecio local.",
    accent: "#7C3AED",
    softBg: "#F5F3FF",
    border: "#DDD6FE",
    ring: "rgba(124, 58, 237, 0.16)",
    aiPrompt: "Muéstrame las mejores ofertas en productos gaming disponibles en Panamá.",
  },
  "aires-acondicionados": {
    label: "Aires A/C",
    badge: "Inverter BTU",
    speech: "¡Para el calor de Panamá! Aires Inverter al mejor precio real.",
    accent: "#0891B2",
    softBg: "#ECFEFF",
    border: "#A5F3FC",
    ring: "rgba(8, 145, 178, 0.16)",
    aiPrompt: "¿Cuál es el mejor precio de aire acondicionado Inverter en Panamá hoy?",
  },
  audio: {
    label: "Audio",
    badge: "Hi-Fi · ANC",
    speech: "Audífonos y barras de sonido verificados tienda por tienda.",
    accent: "#D97706",
    softBg: "#FFFBEB",
    border: "#FDE68A",
    ring: "rgba(217, 119, 6, 0.16)",
    aiPrompt: "Recomiéndame los mejores audífonos o parlantes en oferta en Panamá.",
  },
  perifericos: {
    label: "Periféricos",
    badge: "Setup Pro",
    speech: "Teclados, mouse y webcams comparados en Yoytec, PTYTEC y más.",
    accent: "#0D9488",
    softBg: "#F0FDFA",
    border: "#99F6E4",
    ring: "rgba(13, 148, 136, 0.16)",
    aiPrompt: "¿Qué mouse o teclados tienen el mejor precio hoy en Panamá?",
  },
  electrodomesticos: {
    label: "Cocina & Hogar",
    badge: "Hogar inteligente",
    speech: "Airfryers, cafeteras y microondas con precio real en USD.",
    accent: "#EA580C",
    softBg: "#FFF7ED",
    border: "#FED7AA",
    ring: "rgba(234, 88, 12, 0.16)",
    aiPrompt: "¿Cuáles son los electrodomésticos con mejor descuento real hoy en Panamá?",
  },
  accesorios: {
    label: "Accesorios",
    badge: "Esenciales",
    speech: "Cargadores, cables y accesorios sin pagar de más en caja.",
    accent: "#475569",
    softBg: "#F8FAFC",
    border: "#CBD5E1",
    ring: "rgba(71, 85, 105, 0.16)",
    aiPrompt: "Muéstrame buenos accesorios de tecnología al mejor precio en Panamá.",
  },
};

const QUICK_STAGE_CATEGORIES: ProductCategory[] = [
  "televisores",
  "computadoras",
  "celulares",
  "linea-blanca",
  "gaming",
];

interface HeroMascotStageProps {
  searchDraft: string;
  monitoredStoresCount: number;
}

export function HeroMascotStage({
  searchDraft,
  monitoredStoresCount,
}: HeroMascotStageProps) {
  const activeCategory = useFilterStore((s) => s.category);
  const setCategory = useFilterStore((s) => s.setCategory);
  const setAiOpen = useFilterStore((s) => s.setAiOpen);
  const prefersReducedMotion = useReducedMotion();

  const [hoveredCat, setHoveredCat] = useState<ProductCategory | null>(null);
  const [pokeCount, setPokeCount] = useState(0);

  // 3D subtle pointer parallax on desktop stage
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const springX = useSpring(pointerX, { stiffness: 180, damping: 20 });
  const springY = useSpring(pointerY, { stiffness: 180, damping: 20 });
  const rotateY = useTransform(springX, [-0.5, 0.5], [-8, 8]);
  const rotateX = useTransform(springY, [-0.5, 0.5], [6, -6]);
  const badgeShiftX = useTransform(springX, [-0.5, 0.5], [-6, 8]);
  const badgeShiftY = useTransform(springY, [-0.5, 0.5], [-5, 5]);

  const effectiveCategory = hoveredCat ?? activeCategory;
  const trimmedSearch = searchDraft.trim();
  const isSearching = trimmedSearch.length > 0 && !hoveredCat;

  const persona = useMemo<CategoryPersona>(() => {
    if (effectiveCategory && CATEGORY_PERSONAS[effectiveCategory]) {
      return CATEGORY_PERSONAS[effectiveCategory];
    }
    return DEFAULT_PERSONA;
  }, [effectiveCategory]);

  const speechText = isSearching
    ? `Escaneando «${trimmedSearch.slice(0, 26)}${trimmedSearch.length > 26 ? "…" : ""}» en ${monitoredStoresCount} tiendas…`
    : effectiveCategory
    ? persona.speech
    : `¡Hola! Soy Rega. Tócame y te busco el mejor precio en ${monitoredStoresCount} tiendas.`;

  const speechKey = isSearching
    ? `search-${trimmedSearch.slice(0, 12).toLowerCase()}`
    : (effectiveCategory ?? "default");

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (prefersReducedMotion) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width - 0.5;
    const ny = (e.clientY - rect.top) / rect.height - 0.5;
    pointerX.set(nx);
    pointerY.set(ny);
  };

  const handlePointerLeave = () => {
    pointerX.set(0);
    pointerY.set(0);
    setHoveredCat(null);
  };

  const handleMascotClick = () => {
    setPokeCount((n) => n + 1);
  };

  const handleOpenAiFromMascot = () => {
    const prompt = isSearching
      ? `Ayúdame a comparar opciones y encontrar el mejor precio en Panamá para: ${trimmedSearch}`
      : persona.aiPrompt;
    setAiOpen(true, prompt);
  };

  return (
    <>
      {/* Compact Mobile & Tablet Companion Strip (< lg) */}
      <div className="mt-5 flex items-center gap-3.5 rounded-2xl border border-[#E7E5DF] bg-[#FAFAF7] p-3 lg:hidden">
        <button
          type="button"
          onClick={handleOpenAiFromMascot}
          className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border bg-white p-1.5 cursor-pointer"
          style={{ borderColor: persona.border }}
          aria-label="Hablar con Regateo AI"
        >
          <span
            className="pointer-events-none absolute inset-1 rounded-lg opacity-60 transition-colors duration-300"
            style={{
              background: `radial-gradient(circle, ${persona.ring} 0%, transparent 72%)`,
            }}
          />
          <img
            src="/mascota-hero.webp"
            alt="Mascota de Regateo"
            width={556}
            height={549}
            decoding="async"
            className="relative z-10 h-14 w-14 object-contain drop-shadow-[0_4px_8px_rgba(17,19,21,0.12)]"
          />
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-tight transition-colors duration-300"
              style={{
                backgroundColor: persona.softBg,
                borderColor: persona.border,
                color: persona.accent,
              }}
            >
              {effectiveCategory ? (
                <CategoryIcon category={effectiveCategory} className="h-2.5 w-2.5" />
              ) : (
                <Radar className="h-2.5 w-2.5" />
              )}
              <span>{isSearching ? "Buscando" : persona.label}</span>
            </span>
            <span className="font-mono text-[10px] text-[#666D7C]">
              · {monitoredStoresCount} tiendas
            </span>
          </div>
          <p className="mt-1 text-xs leading-snug font-medium text-[#111315]">
            {speechText}
          </p>
          <button
            type="button"
            onClick={handleOpenAiFromMascot}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[#E64825] px-2.5 py-1 text-[11px] font-bold text-white shadow-xs transition-colors hover:bg-[#CC3B1B] cursor-pointer"
          >
            <Sparkles className="h-3 w-3" />
            Pregúntale a Rega (IA)
          </button>
        </div>
      </div>

      {/* Desktop Interactive Category-Reactive Mascot Stage (>= lg) */}
      <div
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        className="relative hidden lg:flex lg:flex-col lg:items-center lg:justify-between rounded-2xl border border-[#E7E5DF] bg-[#FAFAF7] p-4 pb-3.5 transition-colors duration-300 select-none"
        style={{
          boxShadow:
            "0 1px 2px rgba(17,19,21,0.03), 0 10px 28px rgba(17,19,21,0.04)",
        }}
      >
        {/* Subtle category-tinted ambient halo */}
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl"
        >
          <motion.div
            animate={{
              background: `radial-gradient(circle at 52% 54%, ${persona.ring} 0%, rgba(250,250,247,0) 68%)`,
            }}
            transition={{ duration: 0.45, ease: "easeOut" }}
            className="absolute inset-0"
          />
          {/* Subtle architectural dot grid */}
          <div
            className="absolute inset-0 opacity-35"
            style={{
              backgroundImage:
                "radial-gradient(#D5D2C9 1px, transparent 1px)",
              backgroundSize: "18px 18px",
              maskImage:
                "radial-gradient(circle at 52% 52%, black 22%, transparent 74%)",
              WebkitMaskImage:
                "radial-gradient(circle at 52% 52%, black 22%, transparent 74%)",
            }}
          />
        </motion.div>

        {/* Speech Bubble with AnimatePresence */}
        <div className="relative z-20 w-full min-h-[60px]">
          <AnimatePresence mode="wait">
            <motion.div
              key={speechKey}
              initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -5, scale: 0.97 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              className="relative rounded-xl border bg-white px-3.5 py-2.5 shadow-[0_2px_10px_rgba(17,19,21,0.05)]"
              style={{ borderColor: persona.border }}
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className="inline-flex items-center gap-1.5 text-[10px] font-bold tracking-[0.04em] uppercase"
                  style={{ color: isSearching ? "#059669" : persona.accent }}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      !prefersReducedMotion && "animate-pulse"
                    )}
                    style={{
                      backgroundColor: isSearching ? "#059669" : persona.accent,
                    }}
                  />
                  {isSearching ? "Radar en vivo" : persona.badge}
                </span>
                <button
                  type="button"
                  onClick={handleOpenAiFromMascot}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold text-[#525866] transition-colors hover:bg-[#F4F3EE] hover:text-[#111315] cursor-pointer"
                  title="Abrir asistente Regateo AI"
                >
                  <Sparkles className="h-2.5 w-2.5 text-[#E64825]" />
                  <span>AI</span>
                </button>
              </div>
              <p className="mt-1 text-[12.5px] leading-snug font-semibold text-[#111315]">
                {speechText}
              </p>
              {/* Crisp speech bubble tail pointing down to mascot */}
              <span
                aria-hidden="true"
                className="absolute -bottom-[6px] left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 border-r border-b bg-white"
                style={{ borderColor: persona.border }}
              />
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Mascot Showcase Area */}
        <div
          className="relative z-10 mt-1 flex h-[188px] w-full items-center justify-center"
          style={{ perspective: 800 }}
        >
          {/* Category-reactive concentric radar rings */}
          <motion.div
            aria-hidden="true"
            animate={
              prefersReducedMotion
                ? undefined
                : {
                    scale: isSearching ? [0.92, 1.09, 0.92] : [0.96, 1.03, 0.96],
                    opacity: isSearching ? [0.55, 0.2, 0.55] : [0.4, 0.22, 0.4],
                  }
            }
            transition={{
              duration: isSearching ? 1.8 : 3.8,
              repeat: Number.POSITIVE_INFINITY,
              ease: "easeInOut",
            }}
            className="pointer-events-none absolute h-[162px] w-[162px] rounded-full border border-dashed"
            style={{ borderColor: persona.border }}
          />
          <motion.div
            aria-hidden="true"
            animate={{ borderColor: persona.border }}
            transition={{ duration: 0.35 }}
            className="pointer-events-none absolute h-[126px] w-[126px] rounded-full border bg-white/55"
          />

          {/* Floating Category Badge right above the mascot's pointing index finger! */}
          <motion.div
            style={{
              x: prefersReducedMotion ? 0 : badgeShiftX,
              y: prefersReducedMotion ? 0 : badgeShiftY,
            }}
            className="pointer-events-none absolute top-2 right-1 z-30"
          >
            <AnimatePresence mode="wait">
              <motion.div
                key={effectiveCategory ?? "all"}
                initial={
                  prefersReducedMotion
                    ? { opacity: 0 }
                    : { opacity: 0, scale: 0.72, y: 8, rotate: -6 }
                }
                animate={{ opacity: 1, scale: 1, y: 0, rotate: 0 }}
                exit={
                  prefersReducedMotion
                    ? { opacity: 0 }
                    : { opacity: 0, scale: 0.8, y: -6, rotate: 6 }
                }
                transition={{
                  type: "spring",
                  stiffness: 420,
                  damping: 22,
                }}
                className="flex items-center gap-1.5 rounded-full border bg-white px-2.5 py-1 shadow-[0_6px_16px_rgba(17,19,21,0.10)]"
                style={{ borderColor: persona.border }}
              >
                <span
                  className="flex h-5 w-5 items-center justify-center rounded-full"
                  style={{
                    backgroundColor: persona.softBg,
                    color: persona.accent,
                  }}
                >
                  {effectiveCategory ? (
                    <CategoryIcon category={effectiveCategory} className="h-3 w-3" />
                  ) : (
                    <Tag className="h-3 w-3" />
                  )}
                </span>
                <span className="text-[11px] font-bold tracking-tight text-[#111315]">
                  {persona.label}
                </span>
              </motion.div>
            </AnimatePresence>
          </motion.div>

          {/* Grounded shadow synced with levitation */}
          <motion.div
            aria-hidden="true"
            animate={
              prefersReducedMotion
                ? undefined
                : {
                    scaleX: [1, 0.86, 1],
                    opacity: [0.18, 0.1, 0.18],
                  }
            }
            transition={{
              duration: 3.8,
              repeat: Number.POSITIVE_INFINITY,
              ease: "easeInOut",
            }}
            className="pointer-events-none absolute bottom-2 h-3 w-28 rounded-full bg-[#111315] blur-[5px]"
          />

          {/* Interactive Mascot Character: 1 click opens Regateo AI */}
          <motion.button
            type="button"
            onClick={() => {
              handleMascotClick();
              handleOpenAiFromMascot();
            }}
            aria-label="Rega — Mascota de Regateo AI. Haz clic para preguntar precios."
            title="Haz clic en Rega para preguntarle a Regateo AI"
            style={{
              rotateX: prefersReducedMotion ? 0 : rotateX,
              rotateY: prefersReducedMotion ? 0 : rotateY,
              transformStyle: "preserve-3d",
            }}
            whileHover={prefersReducedMotion ? undefined : { scale: 1.05 }}
            whileTap={prefersReducedMotion ? undefined : { scale: 0.94, rotate: -3 }}
            className="relative z-20 flex items-center justify-center focus:outline-none cursor-pointer"
          >
            <motion.div
              key={`${effectiveCategory ?? "all"}-${pokeCount}`}
              initial={
                prefersReducedMotion
                  ? false
                  : { scale: 0.92, y: 7, rotate: -3.5 }
              }
              animate={{ scale: 1, y: 0, rotate: 0 }}
              transition={{
                type: "spring",
                stiffness: 420,
                damping: 18,
              }}
            >
              <motion.img
                src="/mascota-hero.webp"
                alt="Mascota oficial de Regateo cazando descuentos en Panamá"
                width={556}
                height={549}
                fetchPriority="high"
                decoding="async"
                animate={
                  prefersReducedMotion
                    ? undefined
                    : {
                        y: [0, -7, 0],
                        rotate: [-0.9, 1.1, -0.9],
                      }
                }
                transition={{
                  duration: 3.8,
                  repeat: Number.POSITIVE_INFINITY,
                  ease: "easeInOut",
                }}
                className="h-[168px] w-[170px] object-contain drop-shadow-[0_10px_18px_rgba(17,19,21,0.14)]"
              />
            </motion.div>
          </motion.button>
        </div>

        {/* Prominent CTA button so visitors immediately discover Rega / Regateo AI */}
        <button
          type="button"
          onClick={handleOpenAiFromMascot}
          className="relative z-20 mt-1 flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#111315] px-3 py-2 text-xs font-bold text-white shadow-xs transition-all hover:bg-[#E64825] cursor-pointer"
        >
          <Sparkles className="h-3.5 w-3.5 text-[#FDBA74]" />
          <span>Pregúntale a Rega (IA)</span>
        </button>

        {/* Category-Reactive Mini Dock right below the mascot */}
        <div className="relative z-20 mt-2 flex w-full items-center justify-between gap-1 rounded-xl border border-[#E7E5DF] bg-white px-1.5 py-1">
          {QUICK_STAGE_CATEGORIES.map((cat) => {
            const isSelected = activeCategory === cat;
            const catPersona = CATEGORY_PERSONAS[cat];
            return (
              <button
                key={cat}
                type="button"
                onMouseEnter={() => setHoveredCat(cat)}
                onMouseLeave={() => setHoveredCat(null)}
                onFocus={() => setHoveredCat(cat)}
                onBlur={() => setHoveredCat(null)}
                onClick={() => setCategory(isSelected ? undefined : cat)}
                title={`Explorar ${getCategoryShortLabel(cat)}`}
                aria-label={`Filtrar categoría ${getCategoryShortLabel(cat)}`}
                aria-pressed={isSelected}
                className={cn(
                  "group relative flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-semibold transition-all cursor-pointer",
                  isSelected
                    ? "text-white shadow-xs"
                    : "text-[#525866] hover:bg-[#F4F3EE] hover:text-[#111315]"
                )}
                style={
                  isSelected
                    ? { backgroundColor: catPersona.accent }
                    : undefined
                }
              >
                <CategoryIcon
                  category={cat}
                  className={cn(
                    "h-3.5 w-3.5 shrink-0 transition-transform group-hover:scale-110",
                    isSelected ? "text-white" : ""
                  )}
                />
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
