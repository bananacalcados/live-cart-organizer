import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
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
import NotFound from "./pages/NotFound";
import LandingPage from "./pages/LandingPage";
import Login from "./pages/Login";
import { TeamChat } from "./components/TeamChat";

const queryClient = new QueryClient();

const App = () => (
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

          {/* Protected routes */}
          <Route path="/" element={<ProtectedRoute><Home /></ProtectedRoute>} />
          <Route path="/dashboard" element={<ProtectedRoute><Index /></ProtectedRoute>} />
          <Route path="/events" element={<ProtectedRoute><Events /></ProtectedRoute>} />
          <Route path="/chat" element={<ProtectedRoute><Chat /></ProtectedRoute>} />
          <Route path="/marketing" element={<ProtectedRoute><Marketing /></ProtectedRoute>} />
          <Route path="/marketing/new" element={<ProtectedRoute><NewCampaign /></ProtectedRoute>} />
          <Route path="/expedition" element={<ProtectedRoute><Expedition /></ProtectedRoute>} />
          <Route path="/pos" element={<ProtectedRoute><POS /></ProtectedRoute>} />
          <Route path="/inventory" element={<ProtectedRoute><Inventory /></ProtectedRoute>} />
          <Route path="/management" element={<ProtectedRoute><Management /></ProtectedRoute>} />

          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
        <TeamChat />
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
