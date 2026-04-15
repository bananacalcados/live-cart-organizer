import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Suspense, lazy } from "react";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";
import { TeamChat } from "./components/TeamChat";
import { InstallPrompt } from "./components/InstallPrompt";

// Lazy-loaded modules
const Home = lazy(() => import("./pages/Home"));
const Index = lazy(() => import("./pages/Index"));
const Events = lazy(() => import("./pages/Events"));
const Chat = lazy(() => import("./pages/Chat"));
const Marketing = lazy(() => import("./pages/Marketing"));
const NewCampaign = lazy(() => import("./pages/NewCampaign"));
const Checkout = lazy(() => import("./pages/Checkout"));
const CustomerRegister = lazy(() => import("./pages/CustomerRegister"));
const TransparentCheckout = lazy(() => import("./pages/TransparentCheckout"));
const Expedition = lazy(() => import("./pages/Expedition"));
const ExpeditionBeta = lazy(() => import("./pages/ExpeditionBeta"));
const POS = lazy(() => import("./pages/POS"));
const Inventory = lazy(() => import("./pages/Inventory"));
const Management = lazy(() => import("./pages/Management"));
const Admin = lazy(() => import("./pages/Admin"));
const LandingPage = lazy(() => import("./pages/LandingPage"));
const BananaLanding = lazy(() => import("./pages/BananaLanding"));
const BananaLandingGV = lazy(() => import("./pages/BananaLandingGV"));
const LiveCommerce = lazy(() => import("./pages/LiveCommerce"));
const DoseTriplaCatalog = lazy(() => import("./pages/DoseTriplaCatalog"));
const StoreCheckout = lazy(() => import("./pages/StoreCheckout"));
const LinkPageView = lazy(() => import("./pages/LinkPageView"));
const VipGroupRedirectPage = lazy(() => import("./pages/VipGroupRedirectPage"));
const LiveConsumidorLP = lazy(() => import("./pages/LiveConsumidorLP"));
const CatalogLeadPage = lazy(() => import("./pages/CatalogLeadPage"));
const EventCatalogPage = lazy(() => import("./pages/EventCatalogPage"));
const EmailMarketing = lazy(() => import("./pages/EmailMarketing"));
const LiveOrtopedicosLP = lazy(() => import("./pages/LiveOrtopedicosLP"));
const LiveOrtopedicosAbrilLP = lazy(() => import("./pages/LiveOrtopedicosAbrilLP"));
const PresenterDashboard = lazy(() => import("./pages/PresenterDashboard"));

const queryClient = new QueryClient();

const LazyFallback = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
  </div>
);

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <InstallPrompt />
        <BrowserRouter>
          <Suspense fallback={<LazyFallback />}>
            <Routes>
              {/* Public routes */}
              <Route path="/login" element={<Login />} />
              <Route path="/checkout/order/:orderId" element={<TransparentCheckout />} />
              <Route path="/checkout/live" element={<TransparentCheckout />} />
              <Route path="/checkout/:paypalOrderId" element={<Checkout />} />
              <Route path="/checkout-loja/:storeId/:saleId" element={<StoreCheckout />} />
              <Route path="/register/:orderId" element={<CustomerRegister />} />
              <Route path="/lp/:slug" element={<LandingPage />} />
              <Route path="/banana-verao" element={<BananaLanding />} />
              <Route path="/banana-verao-gv" element={<BananaLandingGV />} />
              <Route path="/live" element={<LiveCommerce />} />
              <Route path="/dose-tripla" element={<DoseTriplaCatalog />} />
              <Route path="/catalogo/:slug" element={<DoseTriplaCatalog />} />
              <Route path="/l/:slug" element={<LinkPageView />} />
              <Route path="/cat/:slug" element={<CatalogLeadPage />} />
              <Route path="/evento/:slug" element={<EventCatalogPage />} />
              <Route path="/vip/:slug" element={<VipGroupRedirectPage />} />
              <Route path="/live-consumidor" element={<LiveConsumidorLP />} />
              <Route path="/live-ortopedicos" element={<LiveOrtopedicosLP />} />
              <Route path="/live-ortopedicos-abril" element={<LiveOrtopedicosAbrilLP />} />

              {/* Protected routes */}
              <Route path="/" element={<ProtectedRoute><Home /></ProtectedRoute>} />
              <Route path="/dashboard" element={<ProtectedRoute requiredModule={["dashboard", "events"]}><Index /></ProtectedRoute>} />
              <Route path="/events" element={<ProtectedRoute requiredModule="events"><Events /></ProtectedRoute>} />
              <Route path="/chat" element={<ProtectedRoute requiredModule="chat"><Chat /></ProtectedRoute>} />
              <Route path="/marketing" element={<ProtectedRoute requiredModule="marketing"><Marketing /></ProtectedRoute>} />
              <Route path="/marketing/new" element={<ProtectedRoute requiredModule="marketing"><NewCampaign /></ProtectedRoute>} />
              <Route path="/marketing/email-marketing" element={<ProtectedRoute requiredModule="marketing"><EmailMarketing /></ProtectedRoute>} />
              <Route path="/expedition" element={<ProtectedRoute requiredModule="expedition"><Expedition /></ProtectedRoute>} />
              <Route path="/expedition-beta" element={<ProtectedRoute requiredModule="expedition"><ExpeditionBeta /></ProtectedRoute>} />
              <Route path="/pos" element={<ProtectedRoute requiredModule="pos"><POS /></ProtectedRoute>} />
              <Route path="/inventory" element={<ProtectedRoute requiredModule="inventory"><Inventory /></ProtectedRoute>} />
              <Route path="/management" element={<ProtectedRoute requiredModule="management"><Management /></ProtectedRoute>} />
              <Route path="/admin" element={<ProtectedRoute requiredModule="admin"><Admin /></ProtectedRoute>} />
              <Route path="/presenter/:eventId" element={<ProtectedRoute requiredModule="events"><PresenterDashboard /></ProtectedRoute>} />

              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}

              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
          <TeamChat />
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
