"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    const getOrCreateUser = async () => {
      // Check if this is a password recovery flow - don't sign in anonymously
      const isRecovery = typeof window !== "undefined" &&
        window.location.hash.includes("type=recovery");

      const { data: { user } } = await supabase.auth.getUser();

      if (user) {
        setUser(user);
        setIsLoading(false);
      } else if (isRecovery) {
        // Wait for recovery token to be processed, don't sign in anonymously
        setIsLoading(false);
      } else {
        // Sign in anonymously
        const { data, error } = await supabase.auth.signInAnonymously();
        if (error) {
          console.error("Anonymous sign-in failed:", error.message);
        } else if (data.user) {
          setUser(data.user);
        }
        setIsLoading(false);
      }
    };

    getOrCreateUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
        setIsLoading(false);
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, [supabase]);

  return (
    <AuthContext.Provider value={{ user, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}
