import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import Events from "./pages/Events";
import Chat from "./pages/Chat";
import Marketing from "./pages/Marketing";
import NewCampaign from "./pages/NewCampaign";
import Checkout from "./pages/Checkout";
import CustomerRegister from "./pages/CustomerRegister";
import TransparentCheckout from "./pages/TransparentCheckout";
import Expedition from "./pages/Expedition";
import NotFound from "./pages/NotFound";
import LandingPage from "./pages/LandingPage";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/events" element={<Events />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/marketing" element={<Marketing />} />
          <Route path="/marketing/new" element={<NewCampaign />} />
          <Route path="/expedition" element={<Expedition />} />
          <Route path="/checkout/:paypalOrderId" element={<Checkout />} />
          <Route path="/checkout/order/:orderId" element={<TransparentCheckout />} />
          <Route path="/register/:orderId" element={<CustomerRegister />} />
          <Route path="/lp/:slug" element={<LandingPage />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
