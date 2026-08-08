// Gerado originalmente pelo Supabase. Só o types.ts vizinho é reescrito
// por `npm run gen:types` — este arquivo é editado à mão.
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

// As variáveis passam por src/lib/config.ts, que estoura um erro legível
// se alguma faltar. Sem isso, uma env ausente vira `undefined` e só se
// manifesta como um "Failed to fetch" opaco na primeira query.
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '@/lib/config';

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  }
});