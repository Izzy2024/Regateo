import type { ProductCategory } from "@regateo/shared";
import { ShoppingBag } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { CategoryIcon } from "@/components/CategoryIcon";

export function ProductThumb({
  imageUrl,
  alt,
  category,
  size = "md",
}: {
  imageUrl: string | null;
  alt: string;
  category?: ProductCategory;
  size?: "sm" | "md";
}) {
  const [failed, setFailed] = useState(false);
  const dimClass = size === "sm" ? "h-12 w-12" : "h-16 w-16";

  if (!imageUrl || failed) {
    return (
      <div
        className={cn(
          dimClass,
          "flex shrink-0 items-center justify-center rounded-lg border border-[#E7E5DF] bg-[#F7F6F2] text-[#666D7C]"
        )}
      >
        {category ? (
          <CategoryIcon category={category} className="h-5 w-5" />
        ) : (
          <ShoppingBag className="h-5 w-5" />
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        dimClass,
        "flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[#E7E5DF] bg-[#F7F6F2] p-1.5"
      )}
    >
      <img
        src={imageUrl}
        alt={alt}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className="max-h-full max-w-full object-contain mix-blend-multiply"
      />
    </div>
  );
}
