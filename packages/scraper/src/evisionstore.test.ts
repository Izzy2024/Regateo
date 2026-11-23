import { describe, expect, test } from "bun:test";
import type { PanamaStoreConfig } from "@regateo/shared";
import { createStoreAdapter } from "./adapters";
import {
  buildEvisionProductUrl,
  EVISION_DEFAULT_ALGOLIA,
  type EvisionAlgoliaHit,
  extractEvisionAlgoliaConfig,
  mapEvisionHit,
  normalizeEvisionBrand,
  parseEvisionHtml,
} from "./adapters/evisionstore";

const STORE: PanamaStoreConfig = {
  slug: "evisionstore",
  name: "eVision Store",
  baseUrl: "https://www.evisionstore.com",
  platform: "custom",
  color: "#0369A1",
  accentBg: "#F0F9FF",
  country: "PA",
  currency: "USD",
  enabled: true,
  scrapePaths: ["/products"],
  description: "Televisores, línea blanca, audio, cómputo y electrónica en Panamá.",
};

/** Hit real copiado del índice Algolia de eVision (recortado a lo relevante). */
const TCL_HIT: EvisionAlgoliaHit = {
  objectID: "26582",
  name: "AIRE ACONDICIONADO TCL 12000BTU INVERTER WI-FI R32 TAC12CSDIBWG",
  slug: "tcl-aire-acondicionado-de-12000btu-inverter-wi-fi-r32-tac12csdi-1",
  // Forma rota que devuelve Algolia: esta URL responde HTTP 404 en la tienda.
  url: "https://www.evisionstore.com/tcl-aire-acondicionado-de-12000btu-inverter-wi-fi-r32-tac12csdi-1",
  sku: "TAC12CSDIBWG",
  model_number: "TAC12CSDIBWG",
  price: 499.95,
  sale_price: 279.95,
  price_numeric: 279.95,
  is_on_sale: true,
  image: "https://d190evzgh8z6y5.cloudfront.net/products/final_69ca66fd98a06.webp",
  brand: "Tcl",
  categories: ["Línea Blanca", "Aires acondicionados", "Split"],
  specs: [
    "Capacidad aproximada: 12000btu",
    "Sistema de enfriamiento: Inverter",
    "Nivel de eficiencia (SEER): 17.0",
  ],
  spec_facets: { capacidad_aproximada: "12000btu", sistema_de_enfriamiento: "Inverter" },
  stock_status: { value: "in_stock", label: "In stock" },
  status: { value: "published", label: "Published" },
};

/* -------------------------------------------------------------------------- */
/* URL: /products/<slug> — la regla que evita los 404                         */
/* -------------------------------------------------------------------------- */

describe("buildEvisionProductUrl", () => {
  test("prefija /products/ al slug plano", () => {
    expect(buildEvisionProductUrl("https://www.evisionstore.com", "aire-tcl-12000")).toBe(
      "https://www.evisionstore.com/products/aire-tcl-12000",
    );
  });

  test("ignora slashes finales del baseUrl y del slug", () => {
    expect(buildEvisionProductUrl("https://www.evisionstore.com/", "aire-tcl-12000/")).toBe(
      "https://www.evisionstore.com/products/aire-tcl-12000",
    );
  });

  test("repara la URL raíz que devuelve Algolia (404 → 200)", () => {
    const hitUrl = TCL_HIT.url as string;
    const fixed = buildEvisionProductUrl("https://www.evisionstore.com", hitUrl) as string;
    expect(fixed).toBe(
      "https://www.evisionstore.com/products/tcl-aire-acondicionado-de-12000btu-inverter-wi-fi-r32-tac12csdi-1",
    );
    expect(fixed).not.toBe(hitUrl);
  });

  test("no duplica /products/ cuando la URL ya es canónica", () => {
    const url = "https://www.evisionstore.com/products/tcl-split";
    expect(buildEvisionProductUrl("https://www.evisionstore.com", url)).toBe(url);
    expect(buildEvisionProductUrl("https://www.evisionstore.com", "/products/tcl-split")).toBe(url);
  });

  test("descarta query/hash de URLs canónicas", () => {
    expect(
      buildEvisionProductUrl(
        "https://www.evisionstore.com",
        "https://www.evisionstore.com/products/tcl-split?utm=1#resenas",
      ),
    ).toBe("https://www.evisionstore.com/products/tcl-split");
  });

  test("devuelve null para entradas vacías o sin slug", () => {
    expect(buildEvisionProductUrl("https://www.evisionstore.com", null)).toBeNull();
    expect(buildEvisionProductUrl("https://www.evisionstore.com", "  ")).toBeNull();
    expect(buildEvisionProductUrl("", "algo")).toBeNull();
    expect(
      buildEvisionProductUrl("https://www.evisionstore.com", "https://www.evisionstore.com/"),
    ).toBeNull();
  });

  test("todos los productos mapeados viven bajo /products/", () => {
    const hits: EvisionAlgoliaHit[] = [
      { ...TCL_HIT, objectID: "1" },
      {
        ...TCL_HIT,
        objectID: "2",
        slug: "otro-producto",
        url: "https://www.evisionstore.com/otro-producto",
      },
      { ...TCL_HIT, objectID: "3", slug: null, url: "https://www.evisionstore.com/solo-url" },
    ];
    const urls = hits
      .map((hit) => mapEvisionHit(hit, STORE)?.url)
      .filter((url): url is string => Boolean(url));
    expect(urls).toHaveLength(3);
    for (const url of urls) {
      expect(url.startsWith("https://www.evisionstore.com/products/")).toBe(true);
      expect(url).not.toMatch(/evisionstore\.com\/products\/$/);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Config Algolia dinámica                                                    */
/* -------------------------------------------------------------------------- */

describe("extractEvisionAlgoliaConfig", () => {
  test("lee app/key desde el HTML del storefront", () => {
    const html = `<html><script>algolia = { app: 'ABCDEF1234', key: '0123456789abcdef0123456789abcdef' };</script></html>`;
    expect(extractEvisionAlgoliaConfig(html)).toEqual({
      appId: "ABCDEF1234",
      apiKey: "0123456789abcdef0123456789abcdef",
      indexName: "products",
    });
  });

  test("cae a los valores verificados cuando el snippet no existe", () => {
    expect(extractEvisionAlgoliaConfig("<html>nada</html>")).toEqual(EVISION_DEFAULT_ALGOLIA);
    expect(extractEvisionAlgoliaConfig(null)).toEqual(EVISION_DEFAULT_ALGOLIA);
    expect(EVISION_DEFAULT_ALGOLIA.appId).toBe("81JEEVCUGY");
  });
});

/* -------------------------------------------------------------------------- */
/* Mapeo de hits                                                              */
/* -------------------------------------------------------------------------- */

describe("mapEvisionHit", () => {
  test("hit verificado: precio de oferta, precio tachado y URL /products/", () => {
    const item = mapEvisionHit(TCL_HIT, STORE);
    expect(item).not.toBeNull();
    if (!item) return;

    expect(item.storeSlug).toBe("evisionstore");
    expect(item.externalId).toBe("26582");
    expect(item.title).toContain("AIRE ACONDICIONADO TCL");
    expect(item.priceCents).toBe(27_995);
    expect(item.originalPriceCents).toBe(49_995);
    expect(item.currency).toBe("USD");
    expect(item.inStock).toBe(true);
    expect(item.url).toBe(
      "https://www.evisionstore.com/products/tcl-aire-acondicionado-de-12000btu-inverter-wi-fi-r32-tac12csdi-1",
    );
    expect(item.imageUrl).toBe(
      "https://d190evzgh8z6y5.cloudfront.net/products/final_69ca66fd98a06.webp",
    );
    expect(item.brand).toBe("TCL");
    expect(item.sku).toBe("TAC12CSDIBWG");
    expect(item.modelNumber).toBe("TAC12CSDIBWG");
    expect(item.trustSkuModel).toBe(true);
    expect(item.productType).toBe("Línea Blanca / Aires acondicionados / Split");
  });

  test("sin price_numeric usa sale_price cuando is_on_sale", () => {
    const item = mapEvisionHit(
      { ...TCL_HIT, price_numeric: null, is_on_sale: true, sale_price: 279.95, price: 499.95 },
      STORE,
    );
    expect(item?.priceCents).toBe(27_995);
    expect(item?.originalPriceCents).toBe(49_995);
  });

  test("sin oferta: precio de lista y sin precio tachado", () => {
    const item = mapEvisionHit(
      { ...TCL_HIT, price_numeric: null, is_on_sale: false, sale_price: null, price: 349.5 },
      STORE,
    );
    expect(item?.priceCents).toBe(34_950);
    expect(item?.originalPriceCents).toBeNull();
  });

  test("precio de oferta menor que price_numeric gana como precio actual", () => {
    const item = mapEvisionHit(
      { ...TCL_HIT, price_numeric: 499.95, is_on_sale: true, sale_price: 279.95, price: 499.95 },
      STORE,
    );
    expect(item?.priceCents).toBe(27_995);
    expect(item?.originalPriceCents).toBe(49_995);
  });

  test("out_of_stock deja el producto fuera de stock", () => {
    const item = mapEvisionHit(
      { ...TCL_HIT, stock_status: { value: "out_of_stock", label: "Out of stock" } },
      STORE,
    );
    expect(item?.inStock).toBe(false);
  });

  test("descarta productos no publicados", () => {
    expect(
      mapEvisionHit({ ...TCL_HIT, status: { value: "draft", label: "Draft" } }, STORE),
    ).toBeNull();
  });

  test("descarta hits sin precio utilizable", () => {
    expect(
      mapEvisionHit({ ...TCL_HIT, price_numeric: null, sale_price: null, price: null }, STORE),
    ).toBeNull();
    expect(
      mapEvisionHit({ ...TCL_HIT, price_numeric: 0, sale_price: 0, price: 0 }, STORE),
    ).toBeNull();
  });

  test("conserva specs y spec_facets del índice", () => {
    const item = mapEvisionHit(TCL_HIT, STORE);
    const specs = item?.rawSpecs?.specs as Record<string, unknown> | null | undefined;
    expect(specs?.["Capacidad aproximada"]).toBe("12000btu");
    expect(specs?.["Sistema de enfriamiento"]).toBe("Inverter");
    expect(specs?.["Nivel de eficiencia (SEER)"]).toBe("17.0");
    expect(item?.rawSpecs?.platform).toBe("botble-algolia");
    expect(item?.rawSpecs?.isOnSale).toBe(true);
  });

  test("filtra misceláneos no-electrónica y precios fuera de rango", () => {
    expect(
      mapEvisionHit(
        {
          ...TCL_HIT,
          objectID: "900",
          name: "JUGUETE PELUCHE OSO PANDA 30CM",
          categories: ["Miscelaneos"],
          sku: null,
          model_number: null,
          brand: null,
          price: 19.99,
          sale_price: null,
          price_numeric: 19.99,
          is_on_sale: false,
        },
        STORE,
      ),
    ).toBeNull();

    // Menos de $5: accesorio suelto, fuera del rango del comparador.
    expect(
      mapEvisionHit(
        {
          ...TCL_HIT,
          objectID: "901",
          name: "CABLE HDMI 1.5M",
          price: 2.5,
          sale_price: null,
          price_numeric: 2.5,
          is_on_sale: false,
        },
        STORE,
      ),
    ).toBeNull();
  });

  test("normaliza la capitalización de la marca", () => {
    expect(normalizeEvisionBrand("Tcl")).toBe("TCL");
    expect(normalizeEvisionBrand("lg")).toBe("LG");
    expect(normalizeEvisionBrand("hp")).toBe("HP");
    expect(normalizeEvisionBrand("samsung")).toBe("Samsung");
    expect(normalizeEvisionBrand("Whirlpool")).toBe("Whirlpool");
    expect(normalizeEvisionBrand("  ")).toBeNull();
    expect(mapEvisionHit({ ...TCL_HIT, brand: "tcl" }, STORE)?.brand).toBe("TCL");
  });
});

/* -------------------------------------------------------------------------- */
/* Fallback HTML (Botble + Cheerio)                                           */
/* -------------------------------------------------------------------------- */

/** Tarjeta real de https://www.evisionstore.com/products?page=1 (id 27969). */
const CARD_NINTENDO = `
<div class="col-xxl-3 col-xl-3 col-lg-6 col-md-6 product-item-col"><div class="product-list-card">
  <div class="plc-badges"></div>
  <div class="plc-image">
    <a href="https://www.evisionstore.com/products/consola-nintendo-switch-2-bundle-mario-kart-world-3-meses-multijugador-online-bee001">
      <img src=https://d190evzgh8z6y5.cloudfront.net/imagenes-de-productos/rt1n250nmd/SWITCH2_MEMBRESIA_1-400x400.png alt="CONSOLA NINTENDO SWITCH 2" loading="lazy">
    </a>
  </div>
  <div class="plc-content">
    <div class="plc-category"><a href="https://www.evisionstore.com/categorias/video-juegos/consolas">Consolas</a></div>
    <h2 class="plc-title"><a href="https://www.evisionstore.com/products/consola-nintendo-switch-2-bundle-mario-kart-world-3-meses-multijugador-online-bee001" title="CONSOLA NINTENDO SWITCH 2 BUNDLE: MARIO KART WORLD + 3 MESES MULTIJUGADOR ONLINE BEE001">CONSOLA NINTENDO SWITCH 2 BUNDLE: MARIO KART WORLD + 3 MESES MULTIJUGADOR ONLINE BEE001</a></h2>
  </div>
  <div class="plc-right">
    <div class="plc-price">
      <span class="old-price">$749.95</span>
      <div class="product-price"><span class="" data-bb-value="product-price" >$679.95</span></div>
    </div>
    <a class="btn plc-btn-cart add-to-cart-button" data-bb-toggle="add-to-cart" data-id="27969" data-url="https://www.evisionstore.com/cart/add-to-cart" href="#">Añadir al carrito </a>
  </div>
</div></div>`;

/** Tarjeta real (id 27981): el filtro de relevancia la descarta. */
const CARD_ALARMA = `
<div class="product-item-col"><div class="product-list-card">
  <div class="plc-image"><a href="https://www.evisionstore.com/products/sistema-de-alarma-inalambrico"><img src="https://cdn.example.com/alarma.png" alt="ALARMA"></a></div>
  <div class="plc-content">
    <div class="plc-category"><a href="https://www.evisionstore.com/categorias/sistemas-de-seguridad">Sistemas de Seguridad</a></div>
    <h2 class="plc-title"><a href="https://www.evisionstore.com/products/sistema-de-alarma-inalambrico" title="SISTEMA DE ALARMA INALÁMBRICO MICROSIM Y WI-FI HIKVISION AX HOME DSPA201PSKIT16WB">SISTEMA DE ALARMA INALÁMBRICO MICROSIM Y WI-FI HIKVISION AX HOME DSPA201PSKIT16WB</a></h2>
  </div>
  <div class="plc-right"><div class="product-price"><span data-bb-value="product-price">$131.99</span></div>
    <a class="btn" data-bb-toggle="add-to-cart" data-id="27981" href="#">Añadir</a>
  </div>
</div></div>`;

const CARD_TV = `
<div class="product-item-col"><div class="product-list-card">
  <div class="plc-image"><a href="https://www.evisionstore.com/products/televisor-samsung-55-4k"><img data-src="https://cdn.example.com/tv.png" alt="TV"></a></div>
  <div class="plc-content">
    <div class="plc-category"><a href="https://www.evisionstore.com/categorias/televisores">Televisores</a></div>
    <h2 class="plc-title"><a href="https://www.evisionstore.com/products/televisor-samsung-55-4k">TELEVISOR SAMSUNG 55" 4K UHD SMART TV UN55U8000</a></h2>
  </div>
  <div class="plc-right"><div class="product-price"><span data-bb-value="product-price">$499.00</span></div></div>
</div></div>`;

const CARD_JUGUETE = `
<div class="product-item-col"><div class="product-list-card">
  <div class="plc-image"><a href="https://www.evisionstore.com/products/peluche-oso"><img src="https://cdn.example.com/oso.png" alt="Peluche"></a></div>
  <div class="plc-content">
    <div class="plc-category"><a href="https://www.evisionstore.com/categorias/miscelaneos">Miscelaneos</a></div>
    <h2 class="plc-title"><a href="https://www.evisionstore.com/products/peluche-oso">PELUCHE OSO PANDA 30CM</a></h2>
  </div>
  <div class="plc-right"><div class="product-price"><span data-bb-value="product-price">$19.99</span></div></div>
</div></div>`;

describe("parseEvisionHtml", () => {
  const html = `<html><body><div class="row product-grid-5">${CARD_NINTENDO}${CARD_TV}${CARD_ALARMA}${CARD_JUGUETE}</div></body></html>`;

  test("extrae título, URL canónica, precios e imagen", () => {
    const items = parseEvisionHtml(html, STORE, 10);
    const consola = items.find((item) => item.externalId === "27969");
    expect(consola).toBeDefined();
    if (!consola) return;

    expect(consola.title).toBe(
      "CONSOLA NINTENDO SWITCH 2 BUNDLE: MARIO KART WORLD + 3 MESES MULTIJUGADOR ONLINE BEE001",
    );
    expect(consola.url).toBe(
      "https://www.evisionstore.com/products/consola-nintendo-switch-2-bundle-mario-kart-world-3-meses-multijugador-online-bee001",
    );
    expect(consola.priceCents).toBe(67_995);
    expect(consola.originalPriceCents).toBe(74_995);
    expect(consola.imageUrl).toBe(
      "https://d190evzgh8z6y5.cloudfront.net/imagenes-de-productos/rt1n250nmd/SWITCH2_MEMBRESIA_1-400x400.png",
    );
    expect(consola.productType).toBe("Consolas");
    expect(consola.brand).toBe("Nintendo");
    expect(consola.inStock).toBe(true);
    expect(consola.rawSpecs?.platform).toBe("botble-html");
  });

  test("usa data-src cuando la imagen es lazy y cae al slug sin data-id", () => {
    const items = parseEvisionHtml(html, STORE, 10);
    const tv = items.find((item) => item.url.endsWith("/televisor-samsung-55-4k"));
    expect(tv).toBeDefined();
    if (!tv) return;
    expect(tv.imageUrl).toBe("https://cdn.example.com/tv.png");
    expect(tv.priceCents).toBe(49_900);
    expect(tv.originalPriceCents).toBeNull();
    expect(tv.externalId).toBe("televisor-samsung-55-4k");
  });

  test("filtra tarjetas no-electrónica y respeta el límite", () => {
    const items = parseEvisionHtml(html, STORE, 10);
    expect(items.some((item) => item.title.includes("PELUCHE"))).toBe(false);
    // "Sistema de alarma" cae en accesorios sin pista electrónica → fuera.
    expect(items.some((item) => item.externalId === "27981")).toBe(false);
    expect(items.every((item) => item.url.includes("/products/"))).toBe(true);
    expect(parseEvisionHtml(html, STORE, 1)).toHaveLength(1);
  });

  test("HTML vacío o basura devuelve lista vacía", () => {
    expect(parseEvisionHtml("", STORE, 10)).toEqual([]);
    expect(parseEvisionHtml("<html><body>sin productos</body></html>", STORE, 10)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Registro de adaptadores                                                    */
/* -------------------------------------------------------------------------- */

describe("createStoreAdapter", () => {
  test("resuelve evisionstore al adaptador de Algolia", () => {
    const adapter = createStoreAdapter(STORE);
    expect(adapter.slug).toBe("evisionstore");
    expect(adapter.engine).toBe("json-api");
  });
});
