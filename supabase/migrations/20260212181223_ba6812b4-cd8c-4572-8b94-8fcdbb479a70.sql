-- Table to store display names and seller associations for authenticated users
CREATE TABLE public.user_profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  seller_id UUID REFERENCES public.pos_sellers(id) ON DELETE SET NULL,
  store_id UUID REFERENCES public.pos_stores(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- Everyone authenticated can read profiles (needed for chat)
CREATE POLICY "Authenticated users can read all profiles"
ON public.user_profiles FOR SELECT
TO authenticated
USING (true);

-- Users can update their own profile
CREATE POLICY "Users can update own profile"
ON public.user_profiles FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

-- Users can insert their own profile
CREATE POLICY "Users can insert own profile"
ON public.user_profiles FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Allow anon read for team chat display
CREATE POLICY "Anon can read profiles"
ON public.user_profiles FOR SELECT
TO anon
USING (true);

-- Allow anon insert/update (since app may not use auth strictly)
CREATE POLICY "Anon can insert profiles"
ON public.user_profiles FOR INSERT
TO anon
WITH CHECK (true);

CREATE POLICY "Anon can update profiles"
ON public.user_profiles FOR UPDATE
TO anon
USING (true);

-- Trigger for updated_at
CREATE TRIGGER update_user_profiles_updated_at
BEFORE UPDATE ON public.user_profiles
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for chat identity updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_profiles;