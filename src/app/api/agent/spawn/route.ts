import { NextRequest, NextResponse } from "next/server";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "https://v2.api.policyengine.org";

interface SpawnRequest {
  question: string;
  history: { role: string; content: string }[];
  threadId: string;
}

export async function POST(request: NextRequest) {
  const body: SpawnRequest = await request.json();

  // Fire off the Modal function without waiting
  // The Modal function will write logs to Supabase as it runs
  // The frontend subscribes to realtime updates
  fetch("https://nikhilwoodruff--policyengine-chat-agent-run-agent-web.modal.run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question: body.question,
      thread_id: body.threadId,
      api_base_url: API_BASE_URL,
      history: body.history,
    }),
  }).catch((error) => {
    console.error("Failed to spawn agent:", error);
  });

  return NextResponse.json({ status: "spawned" });
}
