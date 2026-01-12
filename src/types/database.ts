export interface Thread {
  id: string;
  title: string;
  user_id: string | null;
  is_public: boolean;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  thread_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface AgentLog {
  id: string;
  thread_id: string;
  message: string;
  created_at: string;
}

export interface Database {
  public: {
    Tables: {
      threads: {
        Row: Thread;
        Insert: {
          id?: string;
          title?: string;
          user_id?: string;
          is_public?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          title?: string;
          user_id?: string;
          is_public?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      messages: {
        Row: Message;
        Insert: {
          id?: string;
          thread_id: string;
          role: "user" | "assistant";
          content: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          thread_id?: string;
          role?: "user" | "assistant";
          content?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "messages_thread_id_fkey";
            columns: ["thread_id"];
            referencedRelation: "threads";
            referencedColumns: ["id"];
          }
        ];
      };
      agent_logs: {
        Row: AgentLog;
        Insert: {
          id?: string;
          thread_id: string;
          message: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          thread_id?: string;
          message?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "agent_logs_thread_id_fkey";
            columns: ["thread_id"];
            referencedRelation: "threads";
            referencedColumns: ["id"];
          }
        ];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
