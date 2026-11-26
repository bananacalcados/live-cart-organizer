import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { canSeePhotos, parsePhotosMode } from "@/lib/productPhotos";

/** Reads the app_settings switch once (cached); 'off' => no further queries. */
export function useProductColorPhotosMode(enabled: boolean) {
  return useQuery({
    queryKey: ["product_color_photos_mode"],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("app_settings").select("value").eq("key", "product_color_photos_mode").maybeSingle();
      const mode = parsePhotosMode(data?.value);
      if (mode === "off") return { mode, visible: false };
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return { mode, visible: false };
      const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
      const isAdmin = (roles || []).some((r: any) => r.role === "admin");
      let hasInv = false;
      if (mode === "on" && !isAdmin) {
        const { data: ok } = await supabase.rpc("can_upload_product_photos" as any);
        hasInv = ok === true;
      }
      return { mode, visible: canSeePhotos(mode, isAdmin, hasInv) };
    },
  });
}
