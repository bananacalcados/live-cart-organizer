/**
 * EventCatalogPage — /evento/:slug
 * Reuses the CatalogLeadPage component directly since both routes use :slug param.
 */
import CatalogLeadPageComponent from "./CatalogLeadPage";

export default function EventCatalogPage() {
  return <CatalogLeadPageComponent />;
}
