import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  CheckCircle2,
  ClipboardList,
  Eye,
  EyeOff,
  Heart,
  KeyRound,
  Loader2,
  LogOut,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  AUTH_SESSION_QUERY_KEY,
  USER_OVERVIEW_QUERY_KEY,
  useUserSpace,
} from "@/hooks/useUserSpace";
import {
  API_BASE_URL,
  type CaptchaHeaders,
  fetchAuthProviders,
  localizeAuthError,
  requestPasswordReset,
  resetPasswordWithToken,
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

const signUpSchema = z.object({
  name: z.string().min(2, "Ingresa tu nombre"),
  email: z.string().email("Ingresa un correo válido"),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
});

type SignInForm = z.infer<typeof signInSchema>;
type SignUpForm = z.infer<typeof signUpSchema>;

function readResetToken(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  return params.get("resetToken") ?? params.get("token") ?? null;
}

function clearResetTokenFromUrl() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.delete("resetToken");
  url.searchParams.delete("token");
  window.history.replaceState(
    {},
    "",
    `${url.pathname}${url.search}${url.hash}`
  );
}

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
  const [authSuccess, setAuthSuccess] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [captcha, setCaptcha] = useState<CaptchaHeaders | null>(null);
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [flow, setFlow] = useState<"auth" | "forgot" | "reset">("auth");
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSent, setForgotSent] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [resetDone, setResetDone] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (authOpen) {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      setMode(authMode);
      setAuthError(null);
      setAuthSuccess(null);
      setShowPassword(false);
      setCaptcha(null);
      setPrivacyAccepted(false);
      setCaptchaResetKey((k) => k + 1);
      setForgotSent(false);
      setResetDone(false);
      setNewPassword("");
      setFlow(readResetToken() ? "reset" : "auth");
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
    onSuccess: async (res) => {
      setAuthError(null);
      setAuthSuccess(
        `¡Sesión iniciada correctamente! Bienvenido${res.user?.name ? `, ${res.user.name}` : ""}. Entrando a Mi Espacio...`
      );
      setCaptcha(null);
      setCaptchaResetKey((k) => k + 1);
      if (res.user) {
        queryClient.setQueryData(AUTH_SESSION_QUERY_KEY, {
          user: res.user,
          session: null,
        });
      }
      await queryClient.refetchQueries({ queryKey: AUTH_SESSION_QUERY_KEY });
      await queryClient.invalidateQueries({ queryKey: USER_OVERVIEW_QUERY_KEY });
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null;
        setAuthOpen(false);
        setActiveView("mi-espacio");
      }, 900);
    },
    onError: (err) => {
      setAuthSuccess(null);
      setCaptcha(null);
      setCaptchaResetKey((k) => k + 1);
      setAuthError(
        localizeAuthError(
          err instanceof Error ? err.message : "",
          "Correo o contraseña incorrectos."
        )
      );
    },
  });

  const signUpMutation = useMutation({
    mutationFn: (vars: { data: SignUpForm; captcha: CaptchaHeaders }) =>
      signUpWithEmail(vars.data, vars.captcha),
    onSuccess: async (res) => {
      setAuthError(null);
      setAuthSuccess(
        `¡Cuenta creada correctamente! Bienvenido${res.user?.name ? `, ${res.user.name}` : ""}. Entrando a Mi Espacio...`
      );
      setCaptcha(null);
      setPrivacyAccepted(false);
      setCaptchaResetKey((k) => k + 1);
      if (res.user) {
        queryClient.setQueryData(AUTH_SESSION_QUERY_KEY, {
          user: res.user,
          session: null,
        });
      }
      await queryClient.refetchQueries({ queryKey: AUTH_SESSION_QUERY_KEY });
      await queryClient.invalidateQueries({ queryKey: USER_OVERVIEW_QUERY_KEY });
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null;
        setAuthOpen(false);
        setActiveView("mi-espacio");
      }, 900);
    },
    onError: (err) => {
      setAuthSuccess(null);
      setCaptcha(null);
      setCaptchaResetKey((k) => k + 1);
      setAuthError(
        localizeAuthError(
          err instanceof Error ? err.message : "",
          "No se pudo crear la cuenta. Intenta de nuevo."
        )
      );
    },
  });

  const resetToken = useMemo(
    () => (authOpen ? readResetToken() : null),
    [authOpen]
  );

  const providersQuery = useQuery({
    queryKey: ["auth-providers"],
    queryFn: fetchAuthProviders,
    staleTime: 300_000,
    retry: false,
  });

  const forgotMutation = useMutation({
    mutationFn: (vars: { email: string; captcha: CaptchaHeaders }) =>
      requestPasswordReset(vars.email, vars.captcha),
    onSuccess: () => {
      setAuthError(null);
      setForgotSent(true);
      setCaptcha(null);
      setCaptchaResetKey((k) => k + 1);
    },
    onError: (err) => {
      setCaptcha(null);
      setCaptchaResetKey((k) => k + 1);
      setAuthError(
        err instanceof Error
          ? err.message
          : "No pudimos enviar el enlace de recuperación."
      );
    },
  });

  const resetMutation = useMutation({
    mutationFn: (password: string) =>
      resetPasswordWithToken(resetToken ?? "", password),
    onSuccess: () => {
      setAuthError(null);
      setResetDone(true);
      clearResetTokenFromUrl();
    },
    onError: (err) => {
      setAuthError(
        err instanceof Error
          ? err.message
          : "No se pudo actualizar la contraseña."
      );
    },
  });

  const handleBackToAuth = () => {
    setFlow("auth");
    setAuthError(null);
    setCaptcha(null);
    setForgotSent(false);
    setCaptchaResetKey((k) => k + 1);
  };

  const googleSignInUrl = `${API_BASE_URL}/api/auth/sign-in/social?provider=google&callbackURL=${encodeURIComponent(
    typeof window !== "undefined" ? window.location.origin : ""
  )}`;

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
          ? "Mi cuenta en Regateo"
          : flow === "forgot"
          ? "Recupera tu contraseña"
          : flow === "reset"
          ? "Crea tu nueva contraseña"
          : mode === "signin"
          ? "Inicia sesión"
          : "Crea tu cuenta gratis"
      }
      description={
        user
          ? "Gestiona tus favoritos, listas de presupuesto y alertas de precio."
          : flow === "forgot"
          ? "Te enviaremos un enlace seguro a tu correo para crear una nueva contraseña."
          : flow === "reset"
          ? "Define tu nueva contraseña y vuelve a entrar a tu cuenta."
          : "Guarda favoritos con radar de bajadas, presupuestos y alertas en Panamá."
      }
    >
      <div className="p-5 sm:p-6">
        {authSuccess ? (
          <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-[#A7F3D0] bg-[#ECFDF5] p-3.5 text-xs font-semibold text-[#047857]">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="leading-relaxed">{authSuccess}</p>
          </div>
        ) : null}
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
            {flow === "forgot" ? (
              <div>
                <button
                  type="button"
                  onClick={handleBackToAuth}
                  className="mb-4 inline-flex items-center gap-1 text-xs font-semibold text-[#525866] hover:text-[#111315] cursor-pointer"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Volver a iniciar sesión
                </button>

                {forgotSent ? (
                  <div className="flex items-start gap-2.5 rounded-xl border border-[#A7F3D0] bg-[#ECFDF5] p-4 text-xs text-[#047857]">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                    <p className="leading-relaxed font-medium">
                      Te enviamos un enlace a <strong>{forgotEmail}</strong> para
                      crear una nueva contraseña. Revisa tu bandeja (y spam) en los
                      próximos minutos.
                    </p>
                  </div>
                ) : (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!captcha) {
                        setAuthError(
                          "Completa la verificación anti-bot para enviar el enlace."
                        );
                        return;
                      }
                      forgotMutation.mutate({ email: forgotEmail, captcha });
                    }}
                    className="space-y-3.5"
                    noValidate
                  >
                    <div>
                      <label
                        htmlFor="forgot-email"
                        className="mb-1 block text-xs font-semibold text-[#111315]"
                      >
                        Correo electrónico
                      </label>
                      <Input
                        id="forgot-email"
                        type="email"
                        placeholder="nombre@correo.com"
                        value={forgotEmail}
                        onChange={(e) => setForgotEmail(e.target.value)}
                        required
                      />
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
                      disabled={
                        forgotMutation.isPending ||
                        !forgotEmail.trim() ||
                        !captcha
                      }
                    >
                      {forgotMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Enviando...
                        </>
                      ) : (
                        "Enviar enlace de recuperación"
                      )}
                    </Button>
                  </form>
                )}
              </div>
            ) : flow === "reset" ? (
              <div>
                {resetDone ? (
                  <div className="space-y-4">
                    <div className="flex items-start gap-2.5 rounded-xl border border-[#A7F3D0] bg-[#ECFDF5] p-4 text-xs text-[#047857]">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                      <p className="leading-relaxed font-medium">
                        ¡Contraseña actualizada! Ya puedes iniciar sesión con tu
                        nueva contraseña.
                      </p>
                    </div>
                    <Button
                      variant="brand"
                      size="md"
                      className="w-full"
                      onClick={() => {
                        setFlow("auth");
                        setMode("signin");
                        setResetDone(false);
                      }}
                    >
                      Iniciar sesión
                    </Button>
                  </div>
                ) : (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (newPassword.length < 6) {
                        setAuthError(
                          "La nueva contraseña debe tener al menos 6 caracteres."
                        );
                        return;
                      }
                      resetMutation.mutate(newPassword);
                    }}
                    className="space-y-3.5"
                    noValidate
                  >
                    <div>
                      <label
                        htmlFor="reset-new-password"
                        className="mb-1 block text-xs font-semibold text-[#111315]"
                      >
                        Nueva contraseña
                      </label>
                      <div className="relative">
                        <Input
                          id="reset-new-password"
                          type={showPassword ? "text" : "password"}
                          placeholder="Mínimo 8 caracteres"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          className="pr-10"
                          required
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((v) => !v)}
                          aria-label={showPassword ? "Ocultar contraseña" : "Ver contraseña"}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#666D7C] hover:text-[#111315] cursor-pointer"
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>

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
                      disabled={resetMutation.isPending || newPassword.length < 6}
                    >
                      {resetMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Guardando...
                        </>
                      ) : (
                        <>
                          <KeyRound className="h-4 w-4" />
                          Guardar nueva contraseña
                        </>
                      )}
                    </Button>
                  </form>
                )}
              </div>
            ) : (
              <>

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
                  <div className="relative">
                    <Input
                      id="signin-password"
                      type={showPassword ? "text" : "password"}
                      placeholder="••••••••"
                      className="pr-10"
                      {...signInForm.register("password")}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? "Ocultar contraseña" : "Ver contraseña"}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#666D7C] hover:text-[#111315] cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {signInForm.formState.errors.password ? (
                    <p className="mt-1 text-xs text-[#DC2626]">
                      {signInForm.formState.errors.password.message}
                    </p>
                  ) : null}
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setFlow("forgot");
                      setAuthError(null);
                      setCaptcha(null);
                      setCaptchaResetKey((k) => k + 1);
                    }}
                    className="text-xs font-semibold text-[#E64825] hover:text-[#B83416] cursor-pointer"
                  >
                    ¿Olvidaste tu contraseña?
                  </button>
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
                  <div className="relative">
                    <Input
                      id="signup-password"
                      type={showPassword ? "text" : "password"}
                      placeholder="Mínimo 8 caracteres"
                      className="pr-10"
                      {...signUpForm.register("password")}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? "Ocultar contraseña" : "Ver contraseña"}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#666D7C] hover:text-[#111315] cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
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
            {providersQuery.data?.google ? (
              <>
                <div className="my-4 flex items-center gap-3 text-[11px] font-medium text-[#666D7C]">
                  <span className="h-px flex-1 bg-[#E7E5DF]" />
                  o
                  <span className="h-px flex-1 bg-[#E7E5DF]" />
                </div>
                <a
                  href={googleSignInUrl}
                  className="inline-flex h-10 w-full items-center justify-center gap-2.5 rounded-lg border border-[#E7E5DF] bg-white text-sm font-semibold text-[#111315] transition-colors hover:bg-[#F4F3EE]"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.57c2.08-1.92 3.27-4.74 3.27-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.76c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 4.75c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 1.94 14.97 1 12 1 8.02 1 4.53 3.47 2.18 7.05l3.66 2.84C6.71 7.31 9.14 4.75 12 4.75z"
                    />
                  </svg>
                  Continuar con Google
                </a>
              </>
            ) : null}
              </>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
