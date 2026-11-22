import { describe, expect, test } from "bun:test";
import {
  canonicalGalaxyKey,
  canonicalIphoneKey,
  deriveIdentity,
  extractColor,
  inferBrandFromFamily,
  looksLikeModelToken,
  normalizeGtin,
} from "./matching";

const key = (title: string, storeSlug = "test", gtin?: string): string =>
  deriveIdentity({ title, storeSlug, gtin }).matchKey;

const identity = (title: string, storeSlug = "test") =>
  deriveIdentity({ title, storeSlug });

describe("iPhone: canonical family matching", () => {
  test("iPhone 17 512GB matches across stores even when one omits Apple", () => {
    expect(key("iPhone 17 512GB", "panafoto")).toBe(key("Apple iPhone 17 512GB", "multimax"));
  });

  test("iPhone 17 512GB is indexed under apple::iphone-17-512gb", () => {
    expect(key("iPhone 17 512GB", "panafoto")).toBe("apple::iphone-17-512gb");
  });

  test("iPhone 16 colors match (Titan Rosa vs Teal)", () => {
    expect(key("iPhone 16 128GB Rosa", "titan")).toBe(key("iPhone 16 128GB Teal", "titan"));
  });

  test("iPhone 16 SF suffix is not part of the key", () => {
    expect(key("iPhone 16 128GB SF", "titan")).toBe(key("iPhone 16 128GB Rosa", "titan"));
  });

  test("iPhone 17 Pro never matches iPhone 17", () => {
    expect(key("iPhone 17 Pro 256GB", "panafoto")).not.toBe(key("iPhone 17 256GB", "multimax"));
  });

  test("iPhone 17 Pro Max never matches iPhone 17 Pro", () => {
    expect(key("iPhone 17 Pro Max 512GB", "panafoto")).not.toBe(
      key("iPhone 17 Pro 512GB", "multimax")
    );
  });

  test("iPhone 17 256GB never matches iPhone 17 512GB", () => {
    expect(key("iPhone 17 256GB", "panafoto")).not.toBe(key("iPhone 17 512GB", "panafoto"));
  });

  test("iPhone 16e is a different tier than iPhone 16", () => {
    expect(key("iPhone 16E 128GB", "panafoto")).not.toBe(key("iPhone 16 128GB", "panafoto"));
  });

  test("iPhone 16 Plus is a different tier", () => {
    expect(key("iPhone 16 Plus 256GB", "panafoto")).not.toBe(key("iPhone 16 256GB", "panafoto"));
  });

  test("iPhone Air is a different tier", () => {
    expect(key("iPhone 17 Air 256GB", "panafoto")).not.toBe(key("iPhone 17 256GB", "panafoto"));
  });

  test("case/accessory for an iPhone never matches the phone", () => {
    expect(key("Funda iPhone 17 512GB", "panafoto")).not.toBe(key("iPhone 17 512GB", "panafoto"));
  });

  test("iPhone without storage cannot use the canonical key", () => {
    expect(canonicalIphoneKey("iPhone 17")).toBeNull();
  });

  test("generic 5G/E-SIM commercial noise does not change the iPhone key", () => {
    expect(key("iPhone 16 128GB 5G E-SIM Liberado", "titan")).toBe(
      key("iPhone 16 128GB Rosa", "titan")
    );
  });
});

describe("Samsung Galaxy: canonical family matching", () => {
  test("Galaxy S25 FE 512GB matches across stores", () => {
    expect(key("Galaxy S25 FE 512GB", "panafoto")).toBe(
      key("Samsung Galaxy S25 FE 512GB", "multimax")
    );
  });

  test("Galaxy S25 FE key is canonical", () => {
    expect(key("Galaxy S25 FE 512GB", "panafoto")).toBe("samsung::galaxy-s25-fe-512gb");
  });

  test("Galaxy S25 FE never matches Galaxy S25", () => {
    expect(key("Galaxy S25 FE 512GB", "panafoto")).not.toBe(key("Galaxy S25 256GB", "panafoto"));
  });

  test("Galaxy S25 Ultra never matches Galaxy S25", () => {
    expect(key("Galaxy S25 Ultra 512GB", "panafoto")).not.toBe(
      key("Galaxy S25 512GB", "panafoto")
    );
  });

  test("Galaxy S25 256GB never matches 512GB", () => {
    expect(key("Galaxy S25 256GB", "panafoto")).not.toBe(key("Galaxy S25 512GB", "panafoto"));
  });

  test("Galaxy S25+ equals Galaxy S25 Plus", () => {
    expect(key("Galaxy S25+ 256GB", "panafoto")).toBe(key("Galaxy S25 Plus 256GB", "panafoto"));
  });

  test("Galaxy Z Flip 6 has its own key", () => {
    expect(key("Galaxy Z Flip 6 256GB", "panafoto")).toBe("samsung::galaxy-z6-flip-256gb");
  });

  test("Galaxy Z Fold 6 never matches Galaxy Z Flip 6", () => {
    expect(key("Galaxy Z Fold 6 256GB", "panafoto")).not.toBe(
      key("Galaxy Z Flip 6 256GB", "panafoto")
    );
  });

  test("Galaxy A56 5G is canonical", () => {
    expect(key("Galaxy A56 5G 128GB", "panafoto")).toBe("samsung::galaxy-a56-128gb");
  });

  test("Samsung A17 without the Galaxy word still uses the canonical phone key", () => {
    expect(key("Celular Samsung A17 128GB 5G", "panafoto")).toBe(
      key("Samsung Galaxy A17 128GB", "multimax")
    );
  });

  test("Samsung A-series without phone cues is not forced into a phone key", () => {
    expect(canonicalGalaxyKey("Samsung A17 128GB")).toBe("samsung::galaxy-a17-128gb");
    expect(canonicalGalaxyKey("Samsung A17 Televisor")).toBeNull();
  });

  test("Galaxy without storage cannot use the canonical key", () => {
    expect(canonicalGalaxyKey("Galaxy S25 FE")).toBeNull();
  });

  test("storage is detected next to an explicit RAM spec", () => {
    expect(key("Celular Samsung Galaxy A37 128 GB 8 GB RAM Verde Oscuro", "titan")).toBe(
      "samsung::galaxy-a37-128gb"
    );
    expect(key("Celular Samsung A17 4GB RAM 128GB Azul Claro", "titan")).toBe(
      key("Samsung Galaxy A17 128GB", "panafoto")
    );
  });

  test("Galaxy colors do not change the key", () => {
    expect(key("Galaxy S25 256GB Negro", "titan")).toBe(key("Galaxy S25 256GB Azul", "panafoto"));
  });
});

describe("Brand family inference (store omits manufacturer)", () => {
  test("iPhone implies Apple", () => {
    expect(inferBrandFromFamily("iPhone 17 512GB")).toBe("Apple");
  });

  test("MacBook implies Apple", () => {
    expect(inferBrandFromFamily("MacBook Air M3 13")).toBe("Apple");
  });

  test("Galaxy implies Samsung", () => {
    expect(inferBrandFromFamily("Galaxy S25 FE")).toBe("Samsung");
  });

  test("Bravia implies Sony", () => {
    expect(inferBrandFromFamily('BRAVIA 8 OLED 65"')).toBe("Sony");
  });

  test("PlayStation implies Sony", () => {
    expect(inferBrandFromFamily("PlayStation 5 Slim")).toBe("Sony");
  });

  test("IdeaPad implies Lenovo", () => {
    expect(inferBrandFromFamily("IdeaPad Slim 3 15AMN8")).toBe("Lenovo");
  });

  test("Pavilion implies HP", () => {
    expect(inferBrandFromFamily("Pavilion 15")).toBe("HP");
  });

  test("Vivobook implies Asus", () => {
    expect(inferBrandFromFamily("Vivobook Go 15")).toBe("Asus");
  });

  test("Inspiron implies Dell", () => {
    expect(inferBrandFromFamily("Inspiron 15")).toBe("Dell");
  });

  test("Nitro implies Acer", () => {
    expect(inferBrandFromFamily("Nitro V15")).toBe("Acer");
  });

  test("InstaView implies LG", () => {
    expect(inferBrandFromFamily("Refrigeradora InstaView 20pc")).toBe("LG");
  });

  test("Nintendo Switch implies Nintendo", () => {
    expect(inferBrandFromFamily("Nintendo Switch OLED")).toBe("Nintendo");
  });

  test("Xbox implies Microsoft", () => {
    expect(inferBrandFromFamily("Xbox Series X 1TB")).toBe("Microsoft");
  });

  test("PowerShot implies Canon", () => {
    expect(inferBrandFromFamily("PowerShot V10")).toBe("Canon");
  });

  test("EcoTank implies Epson", () => {
    expect(inferBrandFromFamily("EcoTank L3250")).toBe("Epson");
  });

  test("Air Fryer Ninja implies Ninja", () => {
    expect(inferBrandFromFamily("Air Fryer Ninja 4QT")).toBe("Ninja");
  });

  test("unknown family returns null", () => {
    expect(inferBrandFromFamily("Cargador USB-C 65W")).toBeNull();
  });

  test("brand inferred from family is used in the key", () => {
    expect(identity("iPhone 17 512GB", "panafoto").brand).toBe("Apple");
  });

  test("explicit vendor wins over ambiguous panel terms", () => {
    expect(identity("Televisor QLED 55 4K", "titan").brand).toBe("Samsung");
    expect(
      deriveIdentity({ title: "Televisor QLED 55 4K", vendor: "TCL", storeSlug: "titan" }).brand
    ).toBe("TCL");
  });
});

describe("Model-code matching (same product across stores)", () => {
  test("HP 15-FC0287LA matches across stores", () => {
    const a = key("HP 15-FC0287LA | Ryzen 7 | 8GB RAM | 512GB SSD | 15.6\"", "multimax");
    const b = key("Laptop HP 15-FC0287LA con Procesador R7-7730U 8GB 512GB", "titan");
    const c = key("Laptop HP 15-FC0287LA | AMD Ryzen 7 7730U | 8 GB RAM | 512 GB SSD", "panafoto");
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  test("same HP model with 16GB RAM is not the same config", () => {
    expect(key("HP 15-FC0287LA | 8GB RAM | 512GB SSD", "multimax")).not.toBe(
      key("HP 15-FC0287LA | 16GB RAM | 512GB SSD", "titan")
    );
  });

  test("LG WK25BS6 matches", () => {
    expect(key("LG WK25BS6", "panafoto")).toBe(key("Lavadora LG WK25BS6", "multimax"));
  });

  test("Samsung U8000F 55\" matches across stores", () => {
    expect(key('Televisor Samsung 55" U8000F 4K', "titan")).toBe(
      key('Televisor Crystal UHD Samsung 55" U8000F Smart TV', "panafoto")
    );
  });

  test("Samsung U8000F 55\" never matches U8000F 65\"", () => {
    expect(key('Televisor Samsung 55" U8000F', "titan")).not.toBe(
      key('Televisor Samsung 65" U8000F', "panafoto")
    );
  });

  test("Canon PIXMA TS3610 matches", () => {
    expect(key("Impresora Canon PIXMA TS3610", "titan")).toBe(
      key("Impresora inalámbrica multifunción Canon TS3610", "panafoto")
    );
  });

  test("Samsung DV22C6370PP matches (laundry, 22kg)", () => {
    expect(key("Secadora Samsung DV22C6370PP | Gas | 22kg", "multimax")).toBe(
      key("Secadora a Gas Samsung 22kg DV22C6370PP/AP", "rodelag")
    );
  });

  test("LG LRGN6325Z matches (stove)", () => {
    expect(key("Estufa a Gas LG LRGN6325Z 30\"", "multimax")).toBe(
      key("Estufa a gas 30\" LRGN6325Z LG", "rodelag")
    );
  });

  test("Ninja BN300 matches", () => {
    expect(key("Licuadora Personal Ninja 700W BN300", "titan")).toBe(
      key("Licuadora personal Ninja Nutri-Blender BN300", "panafoto")
    );
  });

  test("Logitech H390 matches", () => {
    expect(key("Audífonos Logitech H390 USB", "titan")).toBe(
      key("Logitech H390 Headset USB", "panafoto")
    );
  });

  test("model code is normalized into the key", () => {
    expect(key("Canon PIXMA TS3610", "titan")).toBe("canon::ts3610");
  });
});

describe("Strict negatives (different products never merge)", () => {
  test("Sony BRAVIA 8 65\" OLED never merges with BRAVIA 2 65\" LED", () => {
    const bravia8 = key(
      'Televisor Sony BRAVIA 8 OLED 4K HDR de 65" con Google TV',
      "panafoto"
    );
    const bravia2 = key('Televisor Sony Bravia 2 65" Pulgadas Smart 4K', "titan");
    expect(bravia8).not.toBe(bravia2);
  });

  test("BRAVIA 8 55\" never merges with BRAVIA 8 65\"", () => {
    expect(key('Sony BRAVIA 8 | 55" | OLED', "multimax")).not.toBe(
      key('Sony BRAVIA 8 | 65" | OLED', "multimax")
    );
  });

  test("Samsung 55\" layer TV never merges with 65\"", () => {
    expect(key('Televisor Samsung 55" Crystal UHD Smart TV', "titan")).not.toBe(
      key('Televisor Samsung 65" Crystal UHD Smart TV', "titan")
    );
  });

  test("QLED and Neo QLED variants of the same model stay separate", () => {
    expect(key('Televisor Samsung QN85F 65" QLED', "panafoto")).not.toBe(
      key('Televisor Samsung QN85F 65" Neo QLED', "panafoto")
    );
  });

  test("Galaxy S25 FE 512GB never merges with Galaxy S25 256GB", () => {
    expect(key("Galaxy S25 FE 512GB", "panafoto")).not.toBe(key("Galaxy S25 256GB", "titan"));
  });

  test("iPhone 17 256GB never merges with iPhone 17 Pro 256GB", () => {
    expect(key("iPhone 17 256GB", "panafoto")).not.toBe(key("iPhone 17 Pro 256GB", "multimax"));
  });

  test("iPhone 16 128GB never merges with iPhone 16 256GB", () => {
    expect(key("iPhone 16 128GB Rosa", "titan")).not.toBe(key("iPhone 16 256GB Rosa", "titan"));
  });

  test("TV 55\" never merges with TV 65\" (same model family, no code)", () => {
    expect(key('Televisor LG 55" LED Smart 4K', "titan")).not.toBe(
      key('Televisor LG 65" LED Smart 4K', "titan")
    );
  });

  test("brandless signatures are scoped to their store", () => {
    expect(key("Cable HDMI 2 Metros", "titan")).not.toBe(key("Cable HDMI 2 Metros", "multimax"));
  });

  test("different 2.4GHz devices never merge on the frequency token", () => {
    expect(
      key("Teclado Numérico Inalámbrico 2.4GHz KNP-110", "ptytec")
    ).not.toBe(key("Cámara WiFi 2.4GHz 1080p ARG-SV-8090WT", "yoytec"));
  });

  test("TP-Link AX1800 adapter and router are not the same product", () => {
    expect(
      key("Adaptador Inalámbrico TP-Link AX1800 Archer TX20U", "yoytec")
    ).not.toBe(key("Router TP-LINK AX1800 Doble Banda Wi-Fi 6", "titan"));
  });

  test("accessory never merges with the device", () => {
    expect(key("Funda Samsung Galaxy S25 256GB", "panafoto")).not.toBe(
      key("Samsung Galaxy S25 256GB", "panafoto")
    );
  });
});

describe("GTIN matching", () => {
  test("same GTIN matches even with very different titles", () => {
    const a = deriveIdentity({ title: "iPhone 17 512GB", storeSlug: "panafoto", gtin: "0194253012345" });
    const b = deriveIdentity({
      title: "Apple iPhone 17 512 GB Titanio",
      storeSlug: "multimax",
      gtin: "0194253012345",
    });
    expect(a.matchKey).toBe(b.matchKey);
  });

  test("GTIN key format is gtin::<digits>", () => {
    expect(
      deriveIdentity({ title: "iPhone 17 512GB", storeSlug: "panafoto", gtin: "0194253012345" })
        .matchKey
    ).toBe("gtin::0194253012345");
  });

  test("different GTINs never match", () => {
    expect(
      deriveIdentity({ title: "Producto", storeSlug: "x", gtin: "0194253012345" }).matchKey
    ).not.toBe(
      deriveIdentity({ title: "Producto", storeSlug: "x", gtin: "0194253012346" }).matchKey
    );
  });

  test("invalid GTIN falls back to the normal matcher", () => {
    const withInvalid = deriveIdentity({ title: "iPhone 17 512GB", storeSlug: "x", gtin: "123" });
    expect(withInvalid.matchKey).toBe("apple::iphone-17-512gb");
  });

  test("normalizeGtin accepts 8..14 digits and rejects other values", () => {
    expect(normalizeGtin("0194253012345")).toBe("0194253012345");
    expect(normalizeGtin("019-4253-012345")).toBe("0194253012345");
    expect(normalizeGtin("1234567")).toBeNull();
    expect(normalizeGtin("abc")).toBeNull();
    expect(normalizeGtin(null)).toBeNull();
  });

  test("GTIN strategy is reported", () => {
    expect(
      deriveIdentity({ title: "iPhone 17 512GB", storeSlug: "x", gtin: "0194253012345" }).strategy
    ).toBe("gtin");
  });
});

describe("Colors and commercial noise", () => {
  test("extractColor detects Titan colors", () => {
    expect(extractColor("iPhone 16 128GB Rosa")).toBe("rosa");
    expect(extractColor("iPhone 16 128GB Teal")).toBe("teal");
    expect(extractColor("Galaxy S25 256GB Titanio")).toBe("titanio");
  });

  test("color is stored in specs", () => {
    const id = identity("iPhone 16 128GB Rosa", "titan");
    expect(id.specs.color).toBe("rosa");
  });

  test("color does not change signature keys", () => {
    expect(key("Bocina JBL Go 4 Rosa", "multimax")).toBe(key("Bocina JBL Go 4 Azul", "multimax"));
  });

  test("commercial noise does not change Galaxy keys", () => {
    expect(key("Galaxy S25 256GB 5G Liberado Dual SIM", "titan")).toBe(
      key("Galaxy S25 256GB", "panafoto")
    );
  });

  test("e-sim / desbloqueado noise is ignored", () => {
    expect(key("iPhone 16 128GB E-SIM Desbloqueado", "titan")).toBe(
      key("iPhone 16 128GB", "panafoto")
    );
  });
});

describe("Model token sanity", () => {
  test("rejects IP ratings (IP67, IPX4)", () => {
    expect(looksLikeModelToken("IP67")).toBe(false);
    expect(looksLikeModelToken("IPX4")).toBe(false);
  });

  test("rejects resolutions and refresh rates", () => {
    expect(looksLikeModelToken("1080P")).toBe(false);
    expect(looksLikeModelToken("165HZ")).toBe(false);
  });

  test("rejects CPUs and voltage ranges", () => {
    expect(looksLikeModelToken("I5-1235U")).toBe(false);
    expect(looksLikeModelToken("100V-240V")).toBe(false);
  });

  test("rejects frequency bands (2.4GHZ, 5GHZ)", () => {
    expect(looksLikeModelToken("2.4GHZ")).toBe(false);
    expect(looksLikeModelToken("5GHZ")).toBe(false);
  });

  test("rejects Wi-Fi speed classes (AX1800, AC1200, N300)", () => {
    expect(looksLikeModelToken("AX1800")).toBe(false);
    expect(looksLikeModelToken("AC1200")).toBe(false);
    expect(looksLikeModelToken("N300")).toBe(false);
  });

  test("keeps short router model codes (AX23)", () => {
    expect(looksLikeModelToken("AX23")).toBe(true);
  });

  test("accepts real model codes", () => {
    expect(looksLikeModelToken("TS3610")).toBe(true);
    expect(looksLikeModelToken("15-FC0287LA")).toBe(true);
    expect(looksLikeModelToken("LRGN6325Z")).toBe(true);
  });
});
