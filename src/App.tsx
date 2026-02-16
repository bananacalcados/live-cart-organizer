import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import Home from "./pages/Home";
import Index from "./pages/Index";
import Events from "./pages/Events";
import Chat from "./pages/Chat";
import Marketing from "./pages/Marketing";
import NewCampaign from "./pages/NewCampaign";
import Checkout from "./pages/Checkout";
import CustomerRegister from "./pages/CustomerRegister";
import TransparentCheckout from "./pages/TransparentCheckout";
import Expedition from "./pages/Expedition";
import POS from "./pages/POS";
import Inventory from "./pages/Inventory";
import Management from "./pages/Management";
import Admin from "./pages/Admin";
import NotFound from "./pages/NotFound";
import LandingPage from "./pages/LandingPage";
import BananaLanding from "./pages/BananaLanding";
import BananaLandingGV from "./pages/BananaLandingGV";
import Login from "./pages/Login";
import LiveCommerce from "./pages/LiveCommerce";
import { TeamChat } from "./components/TeamChat";

const queryClient = new QueryClient();

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            {/* Public routes */}
            <Route path="/login" element={<Login />} />
            <Route path="/checkout/:paypalOrderId" element={<Checkout />} />
            <Route path="/checkout/order/:orderId" element={<TransparentCheckout />} />
            <Route path="/register/:orderId" element={<CustomerRegister />} />
            <Route path="/lp/:slug" element={<LandingPage />} />
            <Route path="/banana-verao" element={<BananaLanding />} />
            <Route path="/banana-verao-gv" element={<BananaLandingGV />} />
            <Route path="/live" element={<LiveCommerce />} />

            {/* Protected routes */}
            <Route path="/" element={<ProtectedRoute><Home /></ProtectedRoute>} />
            <Route path="/dashboard" element={<ProtectedRoute requiredModule="dashboard"><Index /></ProtectedRoute>} />
            <Route path="/events" element={<ProtectedRoute requiredModule="events"><Events /></ProtectedRoute>} />
            <Route path="/chat" element={<ProtectedRoute requiredModule="chat"><Chat /></ProtectedRoute>} />
            <Route path="/marketing" element={<ProtectedRoute requiredModule="marketing"><Marketing /></ProtectedRoute>} />
            <Route path="/marketing/new" element={<ProtectedRoute requiredModule="marketing"><NewCampaign /></ProtectedRoute>} />
            <Route path="/expedition" element={<ProtectedRoute requiredModule="expedition"><Expedition /></ProtectedRoute>} />
            <Route path="/pos" element={<ProtectedRoute requiredModule="pos"><POS /></ProtectedRoute>} />
            <Route path="/inventory" element={<ProtectedRoute requiredModule="inventory"><Inventory /></ProtectedRoute>} />
            <Route path="/management" element={<ProtectedRoute requiredModule="management"><Management /></ProtectedRoute>} />
            <Route path="/admin" element={<ProtectedRoute requiredModule="admin"><Admin /></ProtectedRoute>} />

            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
          <TeamChat />
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
