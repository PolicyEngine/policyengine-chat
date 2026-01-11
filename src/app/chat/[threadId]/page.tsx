import { ChatInterface } from "@/components/ChatInterface";
import { AppLayout } from "@/components/AppLayout";

interface PageProps {
  params: Promise<{ threadId: string }>;
}

export default async function ChatPage({ params }: PageProps) {
  const { threadId } = await params;

  return (
    <AppLayout>
      <ChatInterface threadId={threadId} />
    </AppLayout>
  );
}
