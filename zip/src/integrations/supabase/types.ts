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
      attendances: {
        Row: {
          checked_in_at: string
          checked_in_by: string | null
          event_id: string
          event_type: string
          id: string
          user_id: string
        }
        Insert: {
          checked_in_at?: string
          checked_in_by?: string | null
          event_id: string
          event_type: string
          id?: string
          user_id: string
        }
        Update: {
          checked_in_at?: string
          checked_in_by?: string | null
          event_id?: string
          event_type?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      certificates: {
        Row: {
          arquivo_url: string | null
          atividade: string
          carga_horaria: number
          created_at: string
          data_liberacao: string | null
          email_sent_at: string | null
          event_id: string | null
          event_source: string | null
          id: string
          user_id: string
          verification_code: string | null
          verification_count: number
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          arquivo_url?: string | null
          atividade: string
          carga_horaria: number
          created_at?: string
          data_liberacao?: string | null
          email_sent_at?: string | null
          event_id?: string | null
          event_source?: string | null
          id?: string
          user_id: string
          verification_code?: string | null
          verification_count?: number
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          arquivo_url?: string | null
          atividade?: string
          carga_horaria?: number
          created_at?: string
          data_liberacao?: string | null
          email_sent_at?: string | null
          event_id?: string | null
          event_source?: string | null
          id?: string
          user_id?: string
          verification_code?: string | null
          verification_count?: number
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "certificates_profile_fk"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      congress_registrations: {
        Row: {
          created_at: string
          id: string
          status: Database["public"]["Enums"]["registration_status"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          status?: Database["public"]["Enums"]["registration_status"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          status?: Database["public"]["Enums"]["registration_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "congress_registrations_profile_fk"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      minicourse_registrations: {
        Row: {
          created_at: string
          id: string
          minicourse_id: string
          status: Database["public"]["Enums"]["registration_status"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          minicourse_id: string
          status?: Database["public"]["Enums"]["registration_status"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          minicourse_id?: string
          status?: Database["public"]["Enums"]["registration_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "minicourse_registrations_minicourse_id_fkey"
            columns: ["minicourse_id"]
            isOneToOne: false
            referencedRelation: "minicourses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "minicourse_registrations_profile_fk"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      minicourses: {
        Row: {
          carga_horaria: number
          certificate_template_url: string | null
          created_at: string
          data: string
          descricao: string | null
          horario_fim: string
          horario_inicio: string
          id: string
          local: string
          ministrante: string
          nome: string
          vagas: number
        }
        Insert: {
          carga_horaria?: number
          certificate_template_url?: string | null
          created_at?: string
          data: string
          descricao?: string | null
          horario_fim: string
          horario_inicio: string
          id?: string
          local: string
          ministrante: string
          nome: string
          vagas: number
        }
        Update: {
          carga_horaria?: number
          certificate_template_url?: string | null
          created_at?: string
          data?: string
          descricao?: string | null
          horario_fim?: string
          horario_inicio?: string
          id?: string
          local?: string
          ministrante?: string
          nome?: string
          vagas?: number
        }
        Relationships: []
      }
      notification_reads: {
        Row: {
          notification_id: string
          read_at: string
          user_id: string
        }
        Insert: {
          notification_id: string
          read_at?: string
          user_id: string
        }
        Update: {
          notification_id?: string
          read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_reads_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          audience: string
          body: string
          created_at: string
          created_by: string | null
          id: string
          link: string | null
          title: string
          user_id: string | null
        }
        Insert: {
          audience?: string
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
          link?: string | null
          title: string
          user_id?: string | null
        }
        Update: {
          audience?: string
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          link?: string | null
          title?: string
          user_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          cpf: string
          created_at: string
          curso: string | null
          email: string
          foto_perfil: string | null
          id: string
          instituicao: string | null
          nome: string
          telefone: string | null
          updated_at: string
        }
        Insert: {
          cpf: string
          created_at?: string
          curso?: string | null
          email: string
          foto_perfil?: string | null
          id: string
          instituicao?: string | null
          nome: string
          telefone?: string | null
          updated_at?: string
        }
        Update: {
          cpf?: string
          created_at?: string
          curso?: string | null
          email?: string
          foto_perfil?: string | null
          id?: string
          instituicao?: string | null
          nome?: string
          telefone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      schedule: {
        Row: {
          categoria: string
          certificate_template_url: string | null
          created_at: string
          data: string
          descricao: string | null
          horario_fim: string
          horario_inicio: string
          id: string
          local: string
          palestrante: string | null
          titulo: string
        }
        Insert: {
          categoria: string
          certificate_template_url?: string | null
          created_at?: string
          data: string
          descricao?: string | null
          horario_fim: string
          horario_inicio: string
          id?: string
          local: string
          palestrante?: string | null
          titulo: string
        }
        Update: {
          categoria?: string
          certificate_template_url?: string | null
          created_at?: string
          data?: string
          descricao?: string | null
          horario_fim?: string
          horario_inicio?: string
          id?: string
          local?: string
          palestrante?: string | null
          titulo?: string
        }
        Relationships: []
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
      certificate_verifications: {
        Row: {
          atividade: string | null
          carga_horaria: number | null
          data_liberacao: string | null
          participante_instituicao: string | null
          participante_nome: string | null
          verification_code: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      close_event_and_issue_certificates: {
        Args: { _carga_horaria: number; _event_id: string; _event_type: string }
        Returns: {
          certificate_id: string
          created: boolean
          user_id: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      mark_attendance: {
        Args: { _event_id: string; _event_type: string; _user_id: string }
        Returns: {
          already: boolean
          checked_in_at: string
          evento_titulo: string
          participante_email: string
          participante_nome: string
        }[]
      }
      verify_and_mark_certificate: {
        Args: { _code: string }
        Returns: {
          atividade: string
          carga_horaria: number
          data_liberacao: string
          participante_instituicao: string
          participante_nome: string
          verification_code: string
          verification_count: number
          verified_at: string
        }[]
      }
      verify_certificate: {
        Args: { _code: string }
        Returns: {
          atividade: string
          carga_horaria: number
          data_liberacao: string
          participante_instituicao: string
          participante_nome: string
          verification_code: string
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "participant"
      registration_status: "pending" | "approved" | "cancelled"
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
      app_role: ["admin", "participant"],
      registration_status: ["pending", "approved", "cancelled"],
    },
  },
} as const
