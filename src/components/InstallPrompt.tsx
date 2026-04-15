import { useState, useEffect } from "react";
import { X, Download, Share } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showBanner, setShowBanner] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    // Check if dismissed recently
    const dismissed = localStorage.getItem("pwa-install-dismissed");
    if (dismissed) {
      const dismissedAt = parseInt(dismissed, 10);
      if (Date.now() - dismissedAt < 7 * 24 * 60 * 60 * 1000) return;
    }

    // Check if already installed
    if (window.matchMedia("(display-mode: standalone)").matches) return;

    // iOS detection
    const ua = navigator.userAgent;
    const isIOSDevice = /iPhone|iPad|iPod/.test(ua) && !(window as any).MSStream;
    if (isIOSDevice && !(navigator as any).standalone) {
      setIsIOS(true);
      setShowBanner(true);
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setShowBanner(true);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setShowBanner(false);
    }
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setShowBanner(false);
    localStorage.setItem("pwa-install-dismissed", Date.now().toString());
  };

  if (!showBanner) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] bg-[#1a2942] text-white px-4 py-3 flex items-center gap-3 shadow-lg">
      <Download className="h-5 w-5 text-[#00a884] shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">Instale o Banana Gestor no seu celular</p>
        {isIOS && (
          <p className="text-xs text-white/70 mt-0.5 flex items-center gap-1">
            Toque em <Share className="h-3 w-3 inline" /> Compartilhar e depois "Adicionar à Tela de Início"
          </p>
        )}
      </div>
      {!isIOS && (
        <Button
          size="sm"
          onClick={handleInstall}
          className="bg-[#00a884] hover:bg-[#00a884]/90 text-[#111b21] font-medium h-8 px-4 text-xs shrink-0"
        >
          Instalar
        </Button>
      )}
      <button onClick={handleDismiss} className="shrink-0 p-1 hover:bg-white/10 rounded">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
