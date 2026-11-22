import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Bell,
  CheckCircle2,
  ClipboardList,
  Heart,
  Loader2,
  LogOut,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  AUTH_SESSION_QUERY_KEY,
  USER_OVERVIEW_QUERY_KEY,
  useUserSpace,
} from "@/hooks/useUserSpace";
import {
  type CaptchaHeaders,
  signInWithEmail,
  signUpWithEmail,
} from "@/lib/api";
import { cn, formatUsd } from "@/lib/utils";
import { useFilterStore } from "@/store/useFilterStore";
import { CaptchaWidget } from "./CaptchaWidget";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Input } from "./ui/input";

const signInSchema = z.object({
  email: z.string().email("Ingresa un correo válido"),
  password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres"),
});

const signUpSchema = signInSchema.extend({
  name: z.string().min(2, "Ingresa tu nombre"),
});

type SignInForm = z.infer<typeof signInSchema>;
type SignUpForm = z.infer<typeof signUpSchema>;

export function AuthModal() {
  const authOpen = useFilterStore((s) => s.authOpen);
  const authMode = useFilterStore((s) => s.authMode);
  const authHint = useFilterStore((s) => s.authHint);
  const setAuthOpen = useFilterStore((s) => s.setAuthOpen);
  const setActiveView = useFilterStore((s) => s.setActiveView);
  const openProduct = useFilterStore((s) => s.openProduct);
  const queryClient = useQueryClient();

  const { user, overview, alerts, signOut } = useUserSpace();

  const [mode, setMode] = useState<"signin" | "signup">(authMode);
  const [authError, setAuthError] = useState<string | null>(null);
  const [captcha, setCaptcha] = useState<CaptchaHeaders | null>(null);
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);

  useEffect(() => {
    if (authOpen) {
      setMode(authMode);
      setAuthError(null);
      setCaptcha(null);
      setPrivacyAccepted(false);
      setCaptchaResetKey((k) => k + 1);
    }
  }, [authOpen, authMode]);

  const signInForm = useForm<SignInForm>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
  });

  const signUpForm = useForm<SignUpForm>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { name: "", email: "", password: "" },
  });

  const signInMutation = useMutation({
    mutationFn: (vars: { data: SignInForm; captcha: CaptchaHeaders }) =>
      signInWithEmail(vars.data, vars.captcha),
    onSuccess: async () => {
      setAuthError(null);
      setCaptcha(null);
      setCaptchaResetKey((k) => k + 1);
      await queryClient.invalidateQueries({ queryKey: AUTH_SESSION_QUERY_KEY });
      await queryClient.invalidateQueries({ queryKey: USER_OVERVIEW_QUERY_KEY });
      setAuthOpen(false);
    },
    onError: (err) => {
      setCaptcha(null);
      setCaptchaResetKey((k) => k + 1);
      setAuthError(
        err instanceof Error ? err.message : "Credenciales incorrectas."
      );
    },
  });

  const signUpMutation = useMutation({
    mutationFn: (vars: { data: SignUpForm; captcha: CaptchaHeaders }) =>
      signUpWithEmail(vars.data, vars.captcha),
    onSuccess: async () => {
      setAuthError(null);
      setCaptcha(null);
      setPrivacyAccepted(false);
      setCaptchaResetKey((k) => k + 1);
      await queryClient.invalidateQueries({ queryKey: AUTH_SESSION_QUERY_KEY });
      await queryClient.invalidateQueries({ queryKey: USER_OVERVIEW_QUERY_KEY });
      setAuthOpen(false);
    },
    onError: (err) => {
      setCaptcha(null);
      setCaptchaResetKey((k) => k + 1);
      setAuthError(
        err instanceof Error ? err.message : "No se pudo crear la cuenta."
      );
    },
  });

  const handleOpenPrivacy = () => {
    setAuthOpen(false);
    setActiveView("privacidad");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSignOut = async () => {
    await signOut();
    setAuthOpen(false);
  };

  const handleGoToSpace = () => {
    setAuthOpen(false);
    setActiveView("mi-espacio");
  };

  return (
    <Dialog
      open={authOpen}
      onClose={() => setAuthOpen(false)}
      maxWidthClass="max-w-md"
      title={
        user
          ? "Mi cuenta en RegateoApp"
          : mode === "signin"
          ? "Inicia sesión"
          : "Crea tu cuenta gratis"
      }
      description={
        user
          ? "Gestiona tus favoritos, listas de presupuesto y alertas de precio."
          : "Guarda favoritos con radar de bajadas, presupuestos y alertas en Panamá."
      }
    >
      <div className="p-5 sm:p-6">
        {user ? (
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-[#E7E5DF] bg-[#FAFAF7] p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-sm font-bold text-[#111315]">
                  <CheckCircle2 className="h-4 w-4 text-[#059669]" />
                  <span className="truncate">{user.name || "Usuario"}</span>
                </div>
                <p className="mt-0.5 truncate text-xs text-[#525866]">
                  {user.email}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleSignOut()}
              >
                <LogOut className="h-3.5 w-3.5" />
                Cerrar sesión
              </Button>
            </div>

            {overview ? (
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg border border-[#E7E5DF] bg-white p-2.5">
                  <Heart className="mx-auto h-3.5 w-3.5 text-[#E64825]" />
                  <span className="mt-1 block font-price text-base font-bold text-[#111315]">
                    {overview.stats.favoritesCount}
                  </span>
                  <span className="text-[10px] text-[#666D7C]">Favoritos</span>
                </div>
                <div className="rounded-lg border border-[#E7E5DF] bg-white p-2.5">
                  <ClipboardList className="mx-auto h-3.5 w-3.5 text-[#111315]" />
                  <span className="mt-1 block font-price text-base font-bold text-[#111315]">
                    {overview.stats.listsCount}
                  </span>
                  <span className="text-[10px] text-[#666D7C]">Listas</span>
                </div>
                <div className="rounded-lg border border-[#E7E5DF] bg-white p-2.5">
                  <Bell className="mx-auto h-3.5 w-3.5 text-[#059669]" />
                  <span className="mt-1 block font-price text-base font-bold text-[#111315]">
                    {overview.stats.activeAlertsCount}
                  </span>
                  <span className="text-[10px] text-[#666D7C]">Alertas</span>
                </div>
              </div>
            ) : null}

            <Button
              variant="brand"
              size="md"
              className="w-full"
              onClick={handleGoToSpace}
            >
              <span>Ir a Mi Espacio</span>
              <ArrowRight className="h-4 w-4" />
            </Button>

            {alerts.length > 0 ? (
              <div>
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold text-[#525866] uppercase">
                  <Bell className="h-3.5 w-3.5 text-[#E64825]" />
                  Alertas recientes ({alerts.length})
                </h3>
                <div className="space-y-2">
                  {alerts.slice(0, 3).map((alert) => (
                    <div
                      key={alert.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-[#E7E5DF] bg-white px-3 py-2 text-xs"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setAuthOpen(false);
                          openProduct(alert.product.slug);
                        }}
                        className="truncate text-left font-semibold text-[#111315] hover:text-[#E64825] cursor-pointer"
                      >
                        {alert.product.canonicalName}
                      </button>
                      <span className="shrink-0 font-price font-bold text-[#047857]">
                        ≤ {formatUsd(alert.targetPriceCents)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div>
            {authHint ? (
              <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-[#FBCFC3] bg-[#FEF2EE] p-3 text-xs text-[#B83416]">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[#E64825]" />
                <p className="leading-relaxed font-medium">{authHint}</p>
              </div>
            ) : null}

            {/* Mode toggle */}
            <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl border border-[#E7E5DF] bg-[#FAFAF7] p-1">
              <button
                type="button"
                onClick={() => {
                  setMode("signin");
                  setAuthError(null);
                  setCaptcha(null);
                  setCaptchaResetKey((k) => k + 1);
                }}
                className={cn(
                  "rounded-lg py-1.5 text-xs font-semibold transition-colors cursor-pointer",
                  mode === "signin"
                    ? "bg-white text-[#111315] shadow-xs"
                    : "text-[#525866] hover:text-[#111315]"
                )}
              >
                Iniciar sesión
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("signup");
                  setAuthError(null);
                  setCaptcha(null);
                  setCaptchaResetKey((k) => k + 1);
                }}
                className={cn(
                  "rounded-lg py-1.5 text-xs font-semibold transition-colors cursor-pointer",
                  mode === "signup"
                    ? "bg-white text-[#111315] shadow-xs"
                    : "text-[#525866] hover:text-[#111315]"
                )}
              >
                Crear cuenta
              </button>
            </div>

            {mode === "signin" ? (
              <form
                onSubmit={signInForm.handleSubmit((data) => {
                  if (!captcha) {
                    setAuthError(
                      "Completa la verificación anti-bot antes de ingresar."
                    );
                    return;
                  }
                  signInMutation.mutate({ data, captcha });
                })}
                className="space-y-3.5"
                noValidate
              >
                <div>
                  <label
                    htmlFor="signin-email"
                    className="mb-1 block text-xs font-semibold text-[#111315]"
                  >
                    Correo electrónico
                  </label>
                  <Input
                    id="signin-email"
                    type="email"
                    placeholder="nombre@correo.com"
                    {...signInForm.register("email")}
                  />
                  {signInForm.formState.errors.email ? (
                    <p className="mt-1 text-xs text-[#DC2626]">
                      {signInForm.formState.errors.email.message}
                    </p>
                  ) : null}
                </div>

                <div>
                  <label
                    htmlFor="signin-password"
                    className="mb-1 block text-xs font-semibold text-[#111315]"
                  >
                    Contraseña
                  </label>
                  <Input
                    id="signin-password"
                    type="password"
                    placeholder="••••••••"
                    {...signInForm.register("password")}
                  />
                  {signInForm.formState.errors.password ? (
                    <p className="mt-1 text-xs text-[#DC2626]">
                      {signInForm.formState.errors.password.message}
                    </p>
                  ) : null}
                </div>

                <CaptchaWidget
                  onChange={setCaptcha}
                  resetKey={captchaResetKey}
                />

                {authError ? (
                  <p className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-xs font-medium text-[#B91C1C]">
                    {authError}
                  </p>
                ) : null}

                <Button
                  type="submit"
                  variant="brand"
                  size="md"
                  className="w-full"
                  disabled={signInMutation.isPending || !captcha}
                >
                  {signInMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Ingresando...
                    </>
                  ) : (
                    "Ingresar"
                  )}
                </Button>
              </form>
            ) : (
              <form
                onSubmit={signUpForm.handleSubmit((data) => {
                  if (!privacyAccepted) {
                    setAuthError(
                      "Debes aceptar la Política de Privacidad para crear tu cuenta."
                    );
                    return;
                  }
                  if (!captcha) {
                    setAuthError(
                      "Completa la verificación anti-bot para continuar."
                    );
                    return;
                  }
                  signUpMutation.mutate({ data, captcha });
                })}
                className="space-y-3.5"
                noValidate
              >
                <div>
                  <label
                    htmlFor="signup-name"
                    className="mb-1 block text-xs font-semibold text-[#111315]"
                  >
                    Nombre
                  </label>
                  <Input
                    id="signup-name"
                    type="text"
                    placeholder="Tu nombre"
                    {...signUpForm.register("name")}
                  />
                  {signUpForm.formState.errors.name ? (
                    <p className="mt-1 text-xs text-[#DC2626]">
                      {signUpForm.formState.errors.name.message}
                    </p>
                  ) : null}
                </div>

                <div>
                  <label
                    htmlFor="signup-email"
                    className="mb-1 block text-xs font-semibold text-[#111315]"
                  >
                    Correo electrónico
                  </label>
                  <Input
                    id="signup-email"
                    type="email"
                    placeholder="nombre@correo.com"
                    {...signUpForm.register("email")}
                  />
                  {signUpForm.formState.errors.email ? (
                    <p className="mt-1 text-xs text-[#DC2626]">
                      {signUpForm.formState.errors.email.message}
                    </p>
                  ) : null}
                </div>

                <div>
                  <label
                    htmlFor="signup-password"
                    className="mb-1 block text-xs font-semibold text-[#111315]"
                  >
                    Contraseña
                  </label>
                  <Input
                    id="signup-password"
                    type="password"
                    placeholder="Mínimo 6 caracteres"
                    {...signUpForm.register("password")}
                  />
                  {signUpForm.formState.errors.password ? (
                    <p className="mt-1 text-xs text-[#DC2626]">
                      {signUpForm.formState.errors.password.message}
                    </p>
                  ) : null}
                </div>

                <CaptchaWidget
                  onChange={setCaptcha}
                  resetKey={captchaResetKey}
                />

                <label className="flex items-start gap-2.5 rounded-xl border border-[#E7E5DF] bg-[#FAFAF7] p-3 text-xs leading-relaxed text-[#525866] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={privacyAccepted}
                    onChange={(e) => {
                      setPrivacyAccepted(e.target.checked);
                      if (e.target.checked) setAuthError(null);
                    }}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-[#D5D2C9] accent-[#E64825] cursor-pointer"
                  />
                  <span>
                    Acepto la{" "}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        handleOpenPrivacy();
                      }}
                      className="font-semibold text-[#E64825] underline hover:text-[#B83416] cursor-pointer"
                    >
                      Política de Privacidad
                    </button>{" "}
                    y el tratamiento de mis datos personales (Ley 81 de Panamá).
                  </span>
                </label>

                {authError ? (
                  <p className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-xs font-medium text-[#B91C1C]">
                    {authError}
                  </p>
                ) : null}

                <Button
                  type="submit"
                  variant="brand"
                  size="md"
                  className="w-full"
                  disabled={
                    signUpMutation.isPending || !captcha || !privacyAccepted
                  }
                >
                  {signUpMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Creando cuenta...
                    </>
                  ) : (
                    "Crear cuenta gratis"
                  )}
                </Button>
              </form>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
