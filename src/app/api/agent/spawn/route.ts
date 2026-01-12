import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "https://v2.api.policyengine.org";

interface SpawnRequest {
  question: string;
  history: { role: string; content: string }[];
  threadId: string;
  model?: string;
}

export const maxDuration = 300; // Allow up to 5 minutes

export async function POST(request: NextRequest) {
  const body: SpawnRequest = await request.json();

  // Get user ID from session
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  try {
    // Send request to Modal and wait for completion
    // Modal function streams logs to Supabase, frontend gets realtime updates
    const response = await fetch(
      "https://nikhilwoodruff--policyengine-chat-agent-run-agent-web.modal.run",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: body.question,
          thread_id: body.threadId,
          api_base_url: API_BASE_URL,
          history: body.history,
          user_id: user?.id,
          model: body.model || "claude-sonnet-4-5",
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Modal returned error:", response.status, errorText);
      return NextResponse.json({ status: "error", message: errorText }, { status: 500 });
    }

    const result = await response.json();
    return NextResponse.json({ status: "completed", ...result });
  } catch (error) {
    console.error("Failed to run agent:", error);
    return NextResponse.json({ status: "error", message: String(error) }, { status: 500 });
  }
}
