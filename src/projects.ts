import { paths, type Lang } from './i18n';

export type Category = 'software' | 'web' | 'phone';

export interface Project {
  id: string;
  /** shown on the home page */
  featured: boolean;
  /** the big card on the home page (only one) */
  main?: boolean;
  category: Category[];
  image: string;
  imageW: number;
  imageH: number;
  /** describes the screenshot for image search; the image sits in a link hidden from assistive tech */
  imageAlt: Record<Lang, string>;
  href: Record<Lang, string>;
  client: Record<Lang, string>;
  title: Record<Lang, string>;
  text: Record<Lang, string>;
  metrics: Record<Lang, [string, string][]>;
}

/** Responsive variants generated next to each image: name-{320,480,640,800}.webp plus the 1200w original. */
export const srcset = (img: string) =>
  [320, 480, 640, 800].map((w) => `${img.replace(/\.webp$/, `-${w}.webp`)} ${w}w`).join(', ') + `, ${img} 1200w`;

/** Add new projects here. Order = order on /proyectos/. */
export const projects: Project[] = [
  {
    id: 'gonichea',
    featured: true,
    main: true,
    category: ['software'],
    image: '/img/gonichea-case.webp',
    imageW: 1200,
    imageH: 960,
    imageAlt: { es: 'Tienda en línea de Gonichea en escritorio y móvil, alimentada por su backend', en: 'Gonichea online store on desktop and mobile, fed by its backend' },
    href: { es: paths.es.case, en: paths.en.case },
    client: { es: 'Gonichea · Distribuidor HVAC y electrodomésticos', en: 'Gonichea · HVAC and appliance distributor' },
    title: { es: 'Ingeniería backend e integraciones', en: 'Backend engineering & integrations' },
    text: {
      es: 'El sistema que mueve 10 sedes en 7 estados: inventario, punto de venta, facturación, envíos y garantías, integrado con Square, eBay, Walmart, Shopify y FedEx.',
      en: 'The system that runs 10 locations in 7 states: inventory, point of sale, invoicing, shipping and warranties, integrated with Square, eBay, Walmart, Shopify and FedEx.',
    },
    metrics: {
      es: [['64,539', 'facturas'], ['42,312', 'envíos']],
      en: [['64,539', 'invoices'], ['42,312', 'shipments']],
    },
  },
  {
    id: 'sam-pbx',
    featured: true,
    category: ['phone', 'software'],
    image: '/img/sampbx-case.webp',
    imageW: 1200,
    imageH: 750,
    imageAlt: { es: 'Dashboard del portal de telefonía Sam PBX', en: 'Sam PBX phone portal dashboard' },
    href: { es: paths.es.casePbx, en: paths.en.casePbx },
    client: { es: 'Sam PBX · Producto propio', en: 'Sam PBX · Our own product' },
    title: { es: 'Portal de telefonía FusionPBX', en: 'FusionPBX phone portal' },
    text: {
      es: 'Llamadas por devolver, extensiones, horarios, SMS y teléfono web en una sola pantalla, en español e inglés.',
      en: 'Missed calls to return, extensions, hours, SMS and a web phone on one screen, in English and Spanish.',
    },
    metrics: {
      es: [['6', 'módulos'], ['2', 'idiomas']],
      en: [['6', 'modules'], ['2', 'languages']],
    },
  },
  {
    id: 'paellas-by-carlitin',
    featured: true,
    category: ['web'],
    image: '/img/paellas-case.webp',
    imageW: 1200,
    imageH: 960,
    imageAlt: { es: 'Sitio de Paellas by Carlitin en escritorio y móvil', en: 'Paellas by Carlitin website on desktop and mobile' },
    href: { es: paths.es.casePaellas, en: paths.en.casePaellas },
    client: { es: 'Paellas by Carlitin · Catering en Miami', en: 'Paellas by Carlitin · Catering in Miami' },
    title: { es: 'Sitio web en 5 idiomas', en: 'Website in 5 languages' },
    text: {
      es: 'Planificador interactivo de paellas, cotización en un toque y SEO local para Miami-Dade, Broward y los Cayos.',
      en: 'Interactive paella planner, one-tap quotes and local SEO for Miami-Dade, Broward and the Keys.',
    },
    metrics: {
      es: [['5', 'idiomas'], ['16', 'zonas de servicio']],
      en: [['5', 'languages'], ['16', 'service areas']],
    },
  },
];

export const categories: Record<Category, Record<Lang, string>> = {
  software: { es: 'Software e integraciones', en: 'Software & integrations' },
  web: { es: 'Sitios web', en: 'Websites' },
  phone: { es: 'Telefonía', en: 'Phone systems' },
};
