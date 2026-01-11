"use client";

import { createClient } from "./supabase/client";

// Re-export for backwards compatibility
export const supabase = createClient();
