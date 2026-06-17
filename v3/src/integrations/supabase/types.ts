export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      avaliacoes: {
        Row: {
          avaliador_id: string
          created_at: string
          data_atribuicao: string
          id: string
          status: Database["public"]["Enums"]["avaliacao_status"]
          trabalho_id: string
        }
        Insert: {
          avaliador_id: string
          created_at?: string
          data_atribuicao?: string
          id?: string
          status?: Database["public"]["Enums"]["avaliacao_status"]
          trabalho_id: string
        }
        Update: {
          avaliador_id?: string
          created_at?: string
          data_atribuicao?: string
          id?: string
          status?: Database["public"]["Enums"]["avaliacao_status"]
          trabalho_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "avaliacoes_avaliador_id_fkey"
            columns: ["avaliador_id"]
            isOneToOne: false
            referencedRelation: "avaliadores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "avaliacoes_trabalho_id_fkey"
            columns: ["trabalho_id"]
            isOneToOne: false
            referencedRelation: "trabalhos"
            referencedColumns: ["id"]
          },
        ]
      }
      avaliadores: {
        Row: {
          created_at: string
          email: string
          id: string
          instituicao: string
          nome: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          instituicao: string
          nome: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          instituicao?: string
          nome?: string
          user_id?: string | null
        }
        Relationships: []
      }
      categorias: {
        Row: {
          created_at: string
          id: string
          nome: string
        }
        Insert: {
          created_at?: string
          id?: string
          nome: string
        }
        Update: {
          created_at?: string
          id?: string
          nome?: string
        }
        Relationships: []
      }
      criterios: {
        Row: {
          categoria_id: string
          created_at: string
          id: string
          ordem: number
          titulo: string
        }
        Insert: {
          categoria_id: string
          created_at?: string
          id?: string
          ordem?: number
          titulo: string
        }
        Update: {
          categoria_id?: string
          created_at?: string
          id?: string
          ordem?: number
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "criterios_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias"
            referencedColumns: ["id"]
          },
        ]
      }
      estudantes: {
        Row: {
          id: string
          user_id: string | null
          nome: string
          email: string
          matricula: string | null
          periodo: string | null
          curso: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id?: string | null
          nome: string
          email: string
          matricula?: string | null
          periodo?: string | null
          curso?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string | null
          nome?: string
          email?: string
          matricula?: string | null
          periodo?: string | null
          curso?: string | null
          created_at?: string
        }
        Relationships: []
      }
      professores: {
        Row: {
          id: string
          user_id: string | null
          nome: string
          email: string
          departamento: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id?: string | null
          nome: string
          email: string
          departamento: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string | null
          nome?: string
          email?: string
          departamento?: string
          created_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          id: string
          nome: string
        }
        Insert: {
          created_at?: string
          email: string
          id: string
          nome: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          nome?: string
        }
        Relationships: []
      }
      trabalhos: {
        Row: {
          aluno_id: string | null
          autores: string
          categoria_id: string
          coautores: Json
          created_at: string
          data_submissao: string
          id: string
          orientador_email: string | null
          pdf_url: string | null
          resumo: string
          status: string
          titulo: string
        }
        Insert: {
          aluno_id?: string | null
          autores: string
          categoria_id: string
          coautores?: Json
          created_at?: string
          data_submissao?: string
          id?: string
          orientador_email?: string | null
          pdf_url?: string | null
          resumo: string
          status?: string
          titulo: string
        }
        Update: {
          aluno_id?: string | null
          autores?: string
          categoria_id?: string
          coautores?: Json
          created_at?: string
          data_submissao?: string
          id?: string
          orientador_email?: string | null
          pdf_url?: string | null
          resumo?: string
          status?: string
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "trabalhos_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_aluno_dono_trabalho: {
        Args: { _trabalho_id: string; _user_id: string }
        Returns: boolean
      }
      is_avaliador_de_trabalho: {
        Args: { _trabalho_id: string; _user_id: string }
        Returns: boolean
      }
      is_avaliador_user: {
        Args: { _avaliador_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "aluno" | "avaliador" | "gestor"
      avaliacao_status: "pendente" | "em_avaliacao" | "concluida"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["aluno", "avaliador", "gestor"],
      avaliacao_status: ["pendente", "em_avaliacao", "concluida"],
    },
  },
} as const
