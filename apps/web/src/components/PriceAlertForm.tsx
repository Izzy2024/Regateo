import { zodResolver } from "@hookform/resolvers/zod";
import {
  type CreatePriceAlertInput,
  createPriceAlertSchema,
} from "@regateo/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { USER_OVERVIEW_QUERY_KEY } from "@/hooks/useUserSpace";
import {
  type CaptchaHeaders,
  createPriceAlert,
  getAuthSession,
} from "@/lib/api";
import { formatUsd } from "@/lib/utils";
import { useFilterStore } from "@/store/useFilterStore";
import { CaptchaWidget } from "./CaptchaWidget";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

interface PriceAlertFormProps {
  productId: string;
  currentBestPriceCents: number;
}

export function PriceAlertForm({
  productId,
  currentBestPriceCents,
}: PriceAlertFormProps) {
  const suggestedCents = Math.max(
    100,
    Math.round((currentBestPriceCents * 0.9) / 100) * 100
  );
  const [usdDisplay, setUsdDisplay] = useState((suggestedCents / 100).toFixed(2));
  const [savedTargetCents, setSavedTargetCents] = useState<number | null>(null);
  const [captcha, setCaptcha] = useState<CaptchaHeaders | null>(null);
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);

  const setActiveView = useFilterStore((s) => s.setActiveView);
  const closeProduct = useFilterStore((s) => s.closeProduct);
  const queryClient = useQueryClient();

  const { data: sessionData } = useQuery({
    queryKey: ["auth-session"],
    queryFn: getAuthSession,
    staleTime: 60_000,
    retry: false,
  });

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<CreatePriceAlertInput>({
    resolver: zodResolver(createPriceAlertSchema),
    defaultValues: {
      productId,
      email: sessionData?.user?.email ?? "",
      targetPriceCents: suggestedCents,
    },
  });

  useEffect(() => {
    setValue("productId", productId);
    setValue("targetPriceCents", suggestedCents);
    setUsdDisplay((suggestedCents / 100).toFixed(2));
    setSavedTargetCents(null);
    setLocalError(null);
    setCaptcha(null);
    setCaptchaResetKey((k) => k + 1);
  }, [productId, suggestedCents, setValue]);

  useEffect(() => {
    if (sessionData?.user?.email) {
      setValue("email", sessionData.user.email);
    }
  }, [sessionData?.user?.email, setValue]);

  const mutation = useMutation({
    mutationFn: (vars: {
      values: CreatePriceAlertInput;
      captcha: CaptchaHeaders;
    }) => createPriceAlert(vars.values, vars.captcha),
    onSuccess: (res) => {
      setLocalError(null);
      setSavedTargetCents(res.alert.targetPriceCents);
      setCaptcha(null);
      setCaptchaResetKey((k) => k + 1);
      void queryClient.invalidateQueries({ queryKey: USER_OVERVIEW_QUERY_KEY });
    },
    onError: () => {
      setCaptcha(null);
      setCaptchaResetKey((k) => k + 1);
    },
  });

  const onSubmit = (values: CreatePriceAlertInput) => {
    if (!captcha) {
      setLocalError("Completa la verificación anti-bot para crear tu alerta.");
      return;
    }
    setLocalError(null);
    mutation.mutate({ values, captcha });
  };

  const handleOpenPrivacy = () => {
    closeProduct();
    setActiveView("privacidad");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleUsdChange = (raw: string) => {
    setUsdDisplay(raw);
    const parsed = Number.parseFloat(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      setValue("targetPriceCents", Math.round(parsed * 100), { shouldValidate: true });
    } else {
      setValue("targetPriceCents", 0, { shouldValidate: true });
    }
  };

  return (
    <div className="rounded-xl border border-[#E7E5DF] bg-[#FAFAF7] p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#FEF2EE] text-[#E64825]">
          <Bell className="h-4 w-4" strokeWidth={2} />
        </span>
        <div>
          <h4 className="text-sm font-bold text-[#111315]">
            Avísame cuando baje de precio
          </h4>
          <p className="mt-0.5 text-xs text-[#525866]">
            Precio actual más bajo:{" "}
            <strong className="font-price text-[#047857]">
              {formatUsd(currentBestPriceCents)}
            </strong>
            . Te notificaremos en cuanto alguna tienda en Panamá alcance tu objetivo.
          </p>
        </div>
      </div>

      {savedTargetCents !== null ? (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-[#A7F3D0] bg-[#ECFDF5] px-3.5 py-3 text-xs text-[#047857]">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>
              Alerta activa: te escribiremos cuando baje a{" "}
              <strong className="font-price">{formatUsd(savedTargetCents)}</strong> o menos.
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setSavedTargetCents(null);
              setCaptcha(null);
              setCaptchaResetKey((k) => k + 1);
            }}
            className="shrink-0 font-semibold underline cursor-pointer"
          >
            Editar
          </button>
        </div>
      ) : (
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="mt-4 space-y-3"
          noValidate
        >
          <input type="hidden" {...register("productId")} />
          <input type="hidden" {...register("targetPriceCents", { valueAsNumber: true })} />

          <div className="grid gap-3 sm:grid-cols-[1fr_160px] sm:items-start">
            <div>
              <label
                htmlFor="alert-email"
                className="mb-1 block text-xs font-semibold text-[#111315]"
              >
                Correo electrónico
              </label>
              <Input
                id="alert-email"
                type="email"
                placeholder="tu@correo.com"
                {...register("email")}
              />
              {errors.email ? (
                <p className="mt-1 text-xs font-medium text-[#DC2626]">
                  {errors.email.message}
                </p>
              ) : null}
            </div>

            <div>
              <label
                htmlFor="alert-target-usd"
                className="mb-1 block text-xs font-semibold text-[#111315]"
              >
                Precio objetivo (USD)
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-[#666D7C]">
                  $
                </span>
                <Input
                  id="alert-target-usd"
                  type="number"
                  step="0.01"
                  min="1"
                  value={usdDisplay}
                  onChange={(e) => handleUsdChange(e.target.value)}
                  className="pl-7 font-mono tabular-nums"
                />
              </div>
              {errors.targetPriceCents ? (
                <p className="mt-1 text-xs font-medium text-[#DC2626]">
                  {errors.targetPriceCents.message}
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CaptchaWidget
              onChange={(next) => {
                setCaptcha(next);
                if (next) setLocalError(null);
              }}
              resetKey={captchaResetKey}
              compact
              className="flex-1 bg-white"
            />

            <Button
              type="submit"
              variant="brand"
              size="md"
              disabled={mutation.isPending || !captcha}
              className="w-full shrink-0 sm:w-auto"
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Guardando
                </>
              ) : (
                "Crear alerta"
              )}
            </Button>
          </div>

          {localError || mutation.isError ? (
            <p className="text-xs font-medium text-[#DC2626]">
              {localError ??
                (mutation.error instanceof Error
                  ? mutation.error.message
                  : "No se pudo guardar la alerta. Intenta nuevamente.")}
            </p>
          ) : null}

          <p className="text-[11px] leading-relaxed text-[#666D7C]">
            Solo usaremos tu correo para avisarte sobre este producto. Ver{" "}
            <button
              type="button"
              onClick={handleOpenPrivacy}
              className="font-semibold text-[#525866] underline hover:text-[#E64825] cursor-pointer"
            >
              Política de Privacidad
            </button>
            .
          </p>
        </form>
      )}
    </div>
  );
}
