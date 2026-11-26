import { useEffect, useReducer } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { parsePhotosMode } from "@/lib/productPhotos";
import { itemPhotoCache } from "@/lib/pos/itemPhotoCache";

/** Reads only the switch (cached 5 min). 'off' => no photo queries and no thumbnails at all. */
export function usePosPhotosEnabled() {
  const { data } = useQuery({
    queryKey: ["product_color_photos_mode_raw"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("app_settings").select("value").eq("key", "product_color_photos_mode").maybeSingle();
      return parsePhotosMode(data?.value);
    },
  });
  return data !== undefined && data !== "off";
}

/** Requests photos for visible keys in one batch; re-renders when the batch lands. */
export function useItemPhotos(keys: string[]) {
  const enabled = usePosPhotosEnabled();
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const sig = enabled ? keys.filter(Boolean).sort().join("|") : "";
  useEffect(() => itemPhotoCache.subscribe(bump), []);
  useEffect(() => { if (sig) itemPhotoCache.request(sig.split("|")); }, [sig]);
  return { enabled, get: itemPhotoCache.get };
}
