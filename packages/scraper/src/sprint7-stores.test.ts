import { describe, expect, test } from "bun:test";
import { PANAMA_STORES, type PanamaStoreConfig } from "@regateo/shared";
import { createStoreAdapter } from "./adapters";
import { mapVtexProduct, pickVtexOffer, type VtexProduct } from "./adapters/lgshoppa";
import {
  buildPlayntradeUrl,
  isRelevantPlayntradeItem,
  mapPlayntradeProduct,
  type PlayntradeProduct,
  pickPlayntradePrice,
} from "./adapters/pntpanama";
import { mapRaencoProduct, RAENCO_DEPARTMENTS, type RaencoProduct } from "./adapters/raenco";
import { cleanSamsungSku, mapSamsungProduct, type SamsungProduct } from "./adapters/samsungpa";
import { isRelevantElectronicsProduct } from "./matching";

function store(slug: string): PanamaStoreConfig {
  const found = PANAMA_STORES.find((candidate) => candidate.slug === slug);
  if (!found) throw new Error(`Tienda no registrada en PANAMA_STORES: ${slug}`);
  return found;
}

const LG = store("lgshoppa");
const SAMSUNG = store("samsungpa");
const RAENCO = store("raenco");
const PNT = store("pntpanama");

/* -------------------------------------------------------------------------- */
/* LG Shop PA — VTEX Catalog Search                                           */
/* -------------------------------------------------------------------------- */

/** Producto real 131 del índice VTEX (respuesta HTTP 206). */
const LG_PRODUCT: VtexProduct = {
  productId: "131",
  productName:
    "Aire acondicionado DUAL INVERTER 12,000 BTU - VM122C31 - kW Manager | Conectividad LG ThinQ™",
  productTitle: "Aire Acondicionado LG 12,000 BTU DUAL INVERTER",
  brand: "LG",
  productReference: "VM122C31.SSP3",
  link: "https://www.lgshop.com.pa/aire-acondicionado-dual-inverter-12-000-btu-vm122c31-kw-manager-conectividad-lg-thinq-/p",
  categories: [
    "/Aire Acondicionado/Aire Acondicionado/Aire acondicionado Split Inverter/",
    "/Aire Acondicionado/Aire Acondicionado/",
    "/Aire Acondicionado/",
  ],
  items: [
    {
      itemId: "131",
      name: "VM122C31",
      ean: "8806096653272",
      images: [
        {
          imageUrl:
            "https://obspanama.vteximg.com.br/arquivos/ids/160498/VM122C31.png?v=639307941599070000",
          imageText: "VM122C31",
        },
      ],
      sellers: [
        {
          sellerId: "1",
          sellerName: "LG Shop",
          commertialOffer: {
            Price: 353.05,
            ListPrice: 499.05,
            IsAvailable: true,
            AvailableQuantity: 7,
          },
        },
      ],
    },
  ],
};

describe("lgshoppa (VTEX)", () => {
  test("mapea un producto VTEX verificado", () => {
    const item = mapVtexProduct(LG_PRODUCT, LG);
    expect(item).not.toBeNull();
    if (!item) return;

    expect(item.storeSlug).toBe("lgshoppa");
    expect(item.externalId).toBe("131");
    expect(item.title).toContain("Aire acondicionado DUAL INVERTER");
    expect(item.brand).toBe("LG");
    expect(item.priceCents).toBe(35_305);
    expect(item.originalPriceCents).toBe(49_905);
    expect(item.inStock).toBe(true);
    expect(item.gtin).toBe("8806096653272");
    expect(item.trustSkuModel).toBe(true);
    // `VM122C31.SSP3` → `VM122C31`: el sufijo regional rompe el match cruzado.
    expect(item.modelNumber).toBe("VM122C31");
    expect(item.sku).toBe("VM122C31.SSP3");
    expect(item.url).toBe(
      "https://www.lgshop.com.pa/aire-acondicionado-dual-inverter-12-000-btu-vm122c31-kw-manager-conectividad-lg-thinq-/p",
    );
    expect(item.imageUrl).toContain("VM122C31.png");
    expect(item.productType).toContain("Aire acondicionado Split Inverter");
    expect(item.productType).not.toContain("//");
  });

  test("prefiere el ítem con stock real sobre el agotado", () => {
    const candidate: VtexProduct = {
      ...LG_PRODUCT,
      items: [
        {
          itemId: "agotado",
          ean: "1111111111111",
          images: [{ imageUrl: "https://cdn.example.com/agotado.png" }],
          sellers: [
            {
              commertialOffer: {
                Price: 100,
                ListPrice: 100,
                IsAvailable: false,
                AvailableQuantity: 0,
              },
            },
          ],
        },
        {
          itemId: "disponible",
          ean: "2222222222222",
          images: [{ imageUrl: "https://cdn.example.com/disponible.png" }],
          sellers: [
            {
              commertialOffer: {
                Price: 353.05,
                ListPrice: 499.05,
                IsAvailable: true,
                AvailableQuantity: 3,
              },
            },
          ],
        },
      ],
    };

    const picked = pickVtexOffer(candidate);
    expect(picked?.item.itemId).toBe("disponible");

    const item = mapVtexProduct(candidate, LG);
    expect(item?.priceCents).toBe(35_305);
    expect(item?.inStock).toBe(true);
    expect(item?.gtin).toBe("2222222222222");
    expect(item?.imageUrl).toBe("https://cdn.example.com/disponible.png");
  });

  test("sin ofertas con precio no produce listing", () => {
    expect(
      pickVtexOffer({
        ...LG_PRODUCT,
        items: [
          {
            itemId: "sin-precio",
            sellers: [{ commertialOffer: { Price: 0, IsAvailable: false, AvailableQuantity: 0 } }],
          },
        ],
      }),
    ).toBeNull();
    expect(
      mapVtexProduct(
        {
          ...LG_PRODUCT,
          items: [{ itemId: "x", sellers: [{ commertialOffer: { Price: 0 } }] }],
        },
        LG,
      ),
    ).toBeNull();
  });

  test("descarta productos sin link http válido", () => {
    expect(mapVtexProduct({ ...LG_PRODUCT, link: "/relativo/p" }, LG)).toBeNull();
    expect(mapVtexProduct({ ...LG_PRODUCT, link: null }, LG)).toBeNull();
  });

  test("sin ListPrice no inventa precio anterior", () => {
    const item = mapVtexProduct(
      {
        ...LG_PRODUCT,
        items: [
          {
            itemId: "131",
            sellers: [
              { commertialOffer: { Price: 353.05, IsAvailable: true, AvailableQuantity: 1 } },
            ],
          },
        ],
      },
      LG,
    );
    expect(item?.originalPriceCents).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Samsung Shop PA — Magento 2 GraphQL                                        */
/* -------------------------------------------------------------------------- */

/** Producto real de la primera página (total_count 538). */
const SAMSUNG_PRODUCT: SamsungProduct = {
  id: 13005,
  sku: "SM-A185GZKPGTO-PA-1",
  name: "Galaxy A18 LTE 4GB 128GB ",
  url_key: "galaxy-a18-lte-4gb-128gb-pa",
  url_suffix: ".html",
  stock_status: "IN_STOCK",
  image: {
    url: "https://shop.samsung.com/latin/pub/media/catalog/product/cache/x/s/m/sm-a185glbpgto_001_thumb.png",
  },
  price_range: {
    minimum_price: {
      regular_price: { value: 277, currency: "USD" },
      final_price: { value: 259, currency: "USD" },
    },
  },
};

describe("samsungpa (Magento GraphQL)", () => {
  test("limpia el sufijo regional/colectivo del SKU", () => {
    expect(cleanSamsungSku("SM-A185GZKPGTO-PA-1")).toBe("SM-A185GZKPGTO");
    expect(cleanSamsungSku("UN65M80HAPXPA-PROMOS-PA")).toBe("UN65M80HAPXPA");
    expect(cleanSamsungSku("QN55Q60DAGXPA-PA")).toBe("QN55Q60DAGXPA");
    expect(cleanSamsungSku("RF29DB9950QDED-PROMOS-PA")).toBe("RF29DB9950QDED");
    expect(cleanSamsungSku("GP-TOU026PGABW-PA-1")).toBe("GP-TOU026PGABW");
    // Un código real que no es sufijo regional no se toca.
    expect(cleanSamsungSku("SM-S928BZKALTP")).toBe("SM-S928BZKALTP");
    expect(cleanSamsungSku(null)).toBeNull();
    expect(cleanSamsungSku("")).toBeNull();
  });

  test("mapea un producto verificado con precio de oferta", () => {
    const item = mapSamsungProduct(SAMSUNG_PRODUCT, SAMSUNG);
    expect(item).not.toBeNull();
    if (!item) return;

    expect(item.storeSlug).toBe("samsungpa");
    expect(item.externalId).toBe("SM-A185GZKPGTO-PA-1");
    expect(item.title).toBe("Galaxy A18 LTE 4GB 128GB");
    expect(item.brand).toBe("Samsung");
    expect(item.sku).toBe("SM-A185GZKPGTO-PA-1");
    expect(item.modelNumber).toBe("SM-A185GZKPGTO");
    expect(item.priceCents).toBe(25_900);
    expect(item.originalPriceCents).toBe(27_700);
    expect(item.inStock).toBe(true);
    expect(item.url).toBe("https://shop.samsung.com/latin/pa/galaxy-a18-lte-4gb-128gb-pa.html");
    expect(item.imageUrl).toContain("sm-a185glbpgto_001_thumb.png");
  });

  test("stock_status distinto de IN_STOCK deja el listing agotado", () => {
    const item = mapSamsungProduct({ ...SAMSUNG_PRODUCT, stock_status: "OUT_OF_STOCK" }, SAMSUNG);
    expect(item?.inStock).toBe(false);
  });

  test("usa .html cuando url_suffix viene vacío y descarta sin precio", () => {
    const item = mapSamsungProduct({ ...SAMSUNG_PRODUCT, url_suffix: null }, SAMSUNG);
    expect(item?.url.endsWith("/galaxy-a18-lte-4gb-128gb-pa.html")).toBe(true);
    expect(
      mapSamsungProduct(
        { ...SAMSUNG_PRODUCT, price_range: { minimum_price: { final_price: { value: 0 } } } },
        SAMSUNG,
      ),
    ).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Raenco — Magento GraphQL por departamento                                  */
/* -------------------------------------------------------------------------- */

const RAENCO_PRODUCT: RaencoProduct = {
  id: 120917,
  sku: "2930457",
  name: "AUDIFONO SONY WH-CH730N/LZUC NOISE CANCELLING  BLUET./ 50HORAS/ C.RAPIDA 3min: 1h/ AZUL",
  url_key: "audifono-sony-wh-ch730n-lzuc-noise-cancelling-bluet-50horas-c-rapida-3min-1h-azul",
  url_suffix: ".html",
  stock_status: "IN_STOCK",
  image: {
    url: "https://www.raenco.com/media/catalog/product/cache/x/sony-wh-ch730n.jpg",
  },
  price_range: {
    minimum_price: {
      regular_price: { value: 149.99, currency: "USD" },
      final_price: { value: 99.99, currency: "USD" },
    },
  },
};

describe("raenco (GraphQL por departamento)", () => {
  test("declara los 6 departamentos verificados", () => {
    expect(RAENCO_DEPARTMENTS.map((department) => department.uid)).toEqual([
      "MTI=",
      "MjY=",
      "MjI=",
      "MjM=",
      "MzY=",
      "MTgz",
    ]);
  });

  test("mapea un producto verificado de Audio y Video", () => {
    const item = mapRaencoProduct(RAENCO_PRODUCT, RAENCO, "Audio y Video");
    expect(item).not.toBeNull();
    if (!item) return;

    expect(item.storeSlug).toBe("raenco");
    expect(item.externalId).toBe("2930457");
    expect(item.title).toContain("AUDIFONO SONY WH-CH730N");
    expect(item.priceCents).toBe(9_999);
    expect(item.originalPriceCents).toBe(14_999);
    expect(item.inStock).toBe(true);
    expect(item.productType).toBe("Audio y Video");
    // El SKU de Raenco es interno, jamás un modelo de fabricante.
    expect(item.trustSkuModel).toBe(false);
    expect(item.modelNumber).toBeNull();
    expect(item.url).toBe(
      "https://www.raenco.com/audifono-sony-wh-ch730n-lzuc-noise-cancelling-bluet-50horas-c-rapida-3min-1h-azul.html",
    );
    expect(item.imageUrl).toContain("sony-wh-ch730n.jpg");
  });

  test("descarta la imagen placeholder de Magento", () => {
    const item = mapRaencoProduct(
      {
        ...RAENCO_PRODUCT,
        image: {
          url: "https://www.raenco.com/static/frontend/Dalda/cliente/es_ES/Magento_Catalog/images/product/placeholder/image.jpg",
        },
      },
      RAENCO,
      "Tecnología",
    );
    expect(item?.imageUrl).toBeNull();
  });

  test("sin precio o sin url_key no produce listing", () => {
    expect(
      mapRaencoProduct(
        { ...RAENCO_PRODUCT, price_range: { minimum_price: { final_price: { value: 0 } } } },
        RAENCO,
        "Tecnología",
      ),
    ).toBeNull();
    expect(mapRaencoProduct({ ...RAENCO_PRODUCT, url_key: null }, RAENCO, "Tecnología")).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* PlayNTrade — REST gaming                                                   */
/* -------------------------------------------------------------------------- */

/** Consola con depósito de reserva: el abono NUNCA debe ser el precio. */
const PNT_CONSOLE: PlayntradeProduct = {
  _id: "6abae98d291f2b4bb2613f66",
  sku: "pric_70001m",
  name: "CONSOLA PLAYSTATION 5 SLIM DIGITAL",
  slug: "consola-playstation-5-slim-digital",
  type: "console",
  enable: true,
  category: "CONSOLES",
  platform: "PLAYSTATION 5",
  coverpage: "https://storage.googleapis.com/prod-pntpanama-com/uploads/products/ps5.png",
  release: "2024",
  prices: [
    { name: "Reservar", type: "reserve", originalPrice: 10, discountPrice: 0, status: true },
    {
      name: "Nuevo",
      type: "new",
      originalPrice: 549.99,
      discountPrice: 0,
      inventory: 4,
      status: true,
    },
    {
      name: "Usado",
      type: "used",
      originalPrice: 399.99,
      discountPrice: 0,
      inventory: 1,
      status: true,
    },
  ],
};

describe("pntpanama (REST)", () => {
  test("prefiere el precio de venta sobre el abono de reserva y el usado", () => {
    const picked = pickPlayntradePrice(PNT_CONSOLE.prices);
    expect(picked.priceCents).toBe(54_999);
    expect(picked.priceType).toBe("new");
    expect(picked.inventory).toBe(4);
  });

  test("toma el abono sólo cuando no existe precio de venta completo", () => {
    const picked = pickPlayntradePrice([
      { type: "reserve", originalPrice: 10, status: true },
      { type: "used", originalPrice: 59.99, status: true },
    ]);
    expect(picked.priceCents).toBe(5_999);
    expect(picked.priceType).toBe("used");
  });

  test("usa discountPrice sólo si es un descuento real", () => {
    const withDiscount = pickPlayntradePrice([
      { type: "new", originalPrice: 69.99, discountPrice: 49.99, status: true },
    ]);
    expect(withDiscount.priceCents).toBe(4_999);
    expect(withDiscount.originalPriceCents).toBe(6_999);

    const withoutDiscount = pickPlayntradePrice([
      { type: "new", originalPrice: 69.99, discountPrice: 0, status: true },
    ]);
    expect(withoutDiscount.priceCents).toBe(6_999);
    expect(withoutDiscount.originalPriceCents).toBeNull();
  });

  test("ignora precios deshabilitados", () => {
    const picked = pickPlayntradePrice([
      { type: "new", originalPrice: 549.99, status: false },
      { type: "new", originalPrice: 599.99, discountPrice: 0, status: true },
    ]);
    expect(picked.priceCents).toBe(59_999);
    expect(pickPlayntradePrice([])).toEqual({
      priceCents: null,
      originalPriceCents: null,
      priceType: null,
      inventory: null,
    });
  });

  test("construye la URL canónica del router Nuxt", () => {
    expect(buildPlayntradeUrl(PNT.baseUrl, { sku: "pric_1", slug: "hades-2" })).toBe(
      "https://pntpanama.com/products/pric_1/hades-2",
    );
    expect(buildPlayntradeUrl(PNT.baseUrl, { sku: "pric_1", slug: null })).toBe(
      "https://pntpanama.com/products/pric_1",
    );
    expect(buildPlayntradeUrl(PNT.baseUrl, { sku: null, slug: "hades-2" })).toBe(
      "https://pntpanama.com/products/hades-2",
    );
    expect(buildPlayntradeUrl(PNT.baseUrl, {})).toBeNull();
  });

  test("mapea una consola con stock y precio real", () => {
    const item = mapPlayntradeProduct(PNT_CONSOLE, PNT);
    expect(item).not.toBeNull();
    if (!item) return;

    expect(item.storeSlug).toBe("pntpanama");
    expect(item.externalId).toBe("pric_70001m");
    expect(item.priceCents).toBe(54_999);
    expect(item.originalPriceCents).toBeNull();
    expect(item.inStock).toBe(true);
    expect(item.trustSkuModel).toBe(false);
    expect(item.modelNumber).toBeNull();
    expect(item.productType).toBe("CONSOLES PLAYSTATION 5 gaming");
    expect(item.url).toBe(
      "https://pntpanama.com/products/pric_70001m/consola-playstation-5-slim-digital",
    );
    expect(item.imageUrl).toBe(PNT_CONSOLE.coverpage);
    expect(item.rawSpecs?.priceType).toBe("new");
    expect(item.rawSpecs?.gamePlatform).toBe("PLAYSTATION 5");
  });

  test("inventario 0 deja el producto agotado y enable false lo descarta", () => {
    const agotada = mapPlayntradeProduct(
      {
        ...PNT_CONSOLE,
        prices: [{ type: "new", originalPrice: 549.99, inventory: 0, status: true }],
      },
      PNT,
    );
    expect(agotada?.inStock).toBe(false);
    expect(mapPlayntradeProduct({ ...PNT_CONSOLE, enable: false }, PNT)).toBeNull();
  });

  test("los juegos legacy del catálogo sobreviven a los filtros de relevancia", () => {
    const legacy: PlayntradeProduct = {
      sku: "pric_67813m",
      name: "FAR CRY 5 GAME - PS4",
      slug: "far-cry-5",
      category: "JUEGOS",
      platform: "MERCANCÍA",
      enable: true,
      type: "others",
      prices: [{ name: "Nuevo", type: "new", originalPrice: 29.99, status: true, inventory: 1 }],
    };

    const item = mapPlayntradeProduct(legacy, PNT);
    expect(item).not.toBeNull();
    if (!item) return;

    // El filtro genérico ya acepta estos títulos (verificado con 72 ítems
    // reales de las 3 primeras páginas: 0 falsos negativos) y el filtro gaming
    // queda como red de seguridad si la clasificación compartida cambia.
    expect(isRelevantElectronicsProduct(item)).toBe(true);
    expect(isRelevantPlayntradeItem(item)).toBe(true);
    expect(item.productType).toBe("JUEGOS MERCANCÍA gaming");
    expect(item.priceCents).toBe(2_999);
    expect(item.trustSkuModel).toBe(false);
  });

  test("isRelevantPlayntradeItem descarta precios fuera del rango del comparador", () => {
    const barato: PlayntradeProduct = {
      sku: "pric_1m",
      name: "STICKER GAMER",
      slug: "sticker-gamer",
      category: "ACCESSORIES",
      enable: true,
      prices: [{ type: "new", originalPrice: 2.5, status: true }],
    };
    const item = mapPlayntradeProduct(barato, PNT);
    expect(item).toBeNull();
  });

  test("un Amiibo entra como producto gaming", () => {
    const amiibo: PlayntradeProduct = {
      sku: "pric_64206m",
      name: "AMIIBO: SM-PEACH",
      slug: null,
      category: "AMIIBO",
      platform: "MERCANCÍA",
      enable: true,
      prices: [{ name: "Nuevo", type: "new", originalPrice: 19.99, inventory: 2, status: true }],
    };
    const item = mapPlayntradeProduct(amiibo, PNT);
    expect(item?.url).toBe("https://pntpanama.com/products/pric_64206m");
    expect(item?.priceCents).toBe(1_999);
  });
});

/* -------------------------------------------------------------------------- */
/* Registro de adaptadores                                                    */
/* -------------------------------------------------------------------------- */

describe("createStoreAdapter · sprint 7", () => {
  test("cada tienda nueva resuelve a su motor", () => {
    expect(createStoreAdapter(LG).engine).toBe("json-api");
    expect(createStoreAdapter(SAMSUNG).engine).toBe("magento-graphql");
    expect(createStoreAdapter(RAENCO).engine).toBe("magento-graphql");
    expect(createStoreAdapter(PNT).engine).toBe("json-api");
  });

  test("las 4 tiendas existen en PANAMA_STORES y están habilitadas", () => {
    for (const slug of ["raenco", "pntpanama", "samsungpa", "lgshoppa"]) {
      const config = store(slug);
      expect(config.enabled).toBe(true);
      expect(createStoreAdapter(config).slug).toBe(slug);
    }
  });
});
