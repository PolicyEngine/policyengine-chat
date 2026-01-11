import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "https://v2.api.policyengine.org";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;

interface AgentRequest {
  question: string;
  history: { role: string; content: string }[];
  threadId: string;
}

export async function POST(request: NextRequest) {
  const body: AgentRequest = await request.json();
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Clear any old logs for this thread
        await supabase
          .from("agent_logs")
          .delete()
          .eq("thread_id", body.threadId);

        // Spawn the Modal function
        const modalResponse = await fetch(
          "https://nikhilwoodruff--policyengine-chat-agent-run-agent-web.modal.run",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              question: body.question,
              thread_id: body.threadId,
              api_base_url: API_BASE_URL,
              history: body.history,
            }),
          }
        );

        if (!modalResponse.ok) {
          // Modal function might be async, check if it returned a call ID
          const text = await modalResponse.text();
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "log", message: `Starting agent... ${text}` })}\n\n`
            )
          );
        }

        // Poll Supabase for logs and check for completion
        let lastLogCount = 0;
        let attempts = 0;
        const maxAttempts = 120; // 2 minutes max

        while (attempts < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          attempts++;

          // Get new logs
          const { data: logs } = await supabase
            .from("agent_logs")
            .select("*")
            .eq("thread_id", body.threadId)
            .order("created_at", { ascending: true });

          if (logs && logs.length > lastLogCount) {
            for (let i = lastLogCount; i < logs.length; i++) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "log", message: logs[i].message })}\n\n`
                )
              );
            }
            lastLogCount = logs.length;
          }

          // Check if agent completed (look for completion log)
          const hasCompleted = logs?.some((log) =>
            log.message.includes("[AGENT] Completed")
          );

          if (hasCompleted) {
            // Get the assistant message
            const { data: messages } = await supabase
              .from("messages")
              .select("*")
              .eq("thread_id", body.threadId)
              .eq("role", "assistant")
              .order("created_at", { ascending: false })
              .limit(1);

            if (messages && messages.length > 0) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "result", content: messages[0].content })}\n\n`
                )
              );
            }
            break;
          }
        }

        if (attempts >= maxAttempts) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "error", message: "Request timed out" })}\n\n`
            )
          );
        }
      } catch (error) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "error", message: String(error) })}\n\n`
          )
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
