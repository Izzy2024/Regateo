import type { ProductCategory } from "@regateo/shared";
import {
  Cable,
  Gamepad2,
  Headphones,
  Laptop,
  Microwave,
  Mouse,
  Smartphone,
  Tv,
  WashingMachine,
  Wind,
} from "lucide-react";

interface CategoryIconProps {
  category: ProductCategory;
  className?: string;
}

export function CategoryIcon({ category, className = "h-4 w-4" }: CategoryIconProps) {
  switch (category) {
    case "computadoras":
      return <Laptop className={className} strokeWidth={1.75} />;
    case "celulares":
      return <Smartphone className={className} strokeWidth={1.75} />;
    case "televisores":
      return <Tv className={className} strokeWidth={1.75} />;
    case "linea-blanca":
      return <WashingMachine className={className} strokeWidth={1.75} />;
    case "audio":
      return <Headphones className={className} strokeWidth={1.75} />;
    case "perifericos":
      return <Mouse className={className} strokeWidth={1.75} />;
    case "gaming":
      return <Gamepad2 className={className} strokeWidth={1.75} />;
    case "aires-acondicionados":
      return <Wind className={className} strokeWidth={1.75} />;
    case "electrodomesticos":
      return <Microwave className={className} strokeWidth={1.75} />;
    case "accesorios":
    default:
      return <Cable className={className} strokeWidth={1.75} />;
  }
}
