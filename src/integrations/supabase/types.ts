// Gerado automaticamente por `npm run gen:types` a partir do schema do banco.
// NÃO editar à mão — rode o script novamente após cada migration aplicada.

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
      _migrations: {
        Row: {
          applied_at: string | null
          filename: string
          id: number
        }
        Insert: {
          applied_at?: string | null
          filename: string
          id?: number
        }
        Update: {
          applied_at?: string | null
          filename?: string
          id?: number
        }
        Relationships: []
      }
      allowed_email_domains: {
        Row: {
          created_at: string
          domain: string
          role: string
        }
        Insert: {
          created_at?: string
          domain: string
          role?: string
        }
        Update: {
          created_at?: string
          domain?: string
          role?: string
        }
        Relationships: []
      }
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
      avaliacoes: {
        Row: {
          avaliador_id: string
          comentarios: string | null
          created_at: string
          data_atribuicao: string
          data_avaliacao: string | null
          decisao: string | null
          id: string
          nota_geral: number | null
          notas: Json
          status: Database["public"]["Enums"]["avaliacao_status"]
          trabalho_id: string
        }
        Insert: {
          avaliador_id: string
          comentarios?: string | null
          created_at?: string
          data_atribuicao?: string
          data_avaliacao?: string | null
          decisao?: string | null
          id?: string
          nota_geral?: number | null
          notas?: Json
          status?: Database["public"]["Enums"]["avaliacao_status"]
          trabalho_id: string
        }
        Update: {
          avaliador_id?: string
          comentarios?: string | null
          created_at?: string
          data_atribuicao?: string
          data_avaliacao?: string | null
          decisao?: string | null
          id?: string
          nota_geral?: number | null
          notas?: Json
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
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          instituicao: string
          nome: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          instituicao?: string
          nome?: string
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
        Relationships: []
      }
      configuracoes: {
        Row: {
          alerta_horas: number
          atualizado_em: string
          atualizado_por: string | null
          edital: string
          id: boolean
          link_codigo_etica: string
          link_diretrizes_avaliacao: string
          link_edital_congresso: string
          link_manual_revisor: string
          link_normas_formatacao: string
          link_template_latex: string
          link_template_slides: string
          link_template_word: string
          max_coautores: number
          parecer_min_caracteres: number
          submissoes_abertura: string | null
          submissoes_encerramento: string | null
        }
        Insert: {
          alerta_horas?: number
          atualizado_em?: string
          atualizado_por?: string | null
          edital?: string
          id?: boolean
          link_codigo_etica?: string
          link_diretrizes_avaliacao?: string
          link_edital_congresso?: string
          link_manual_revisor?: string
          link_normas_formatacao?: string
          link_template_latex?: string
          link_template_slides?: string
          link_template_word?: string
          max_coautores?: number
          parecer_min_caracteres?: number
          submissoes_abertura?: string | null
          submissoes_encerramento?: string | null
        }
        Update: {
          alerta_horas?: number
          atualizado_em?: string
          atualizado_por?: string | null
          edital?: string
          id?: boolean
          link_codigo_etica?: string
          link_diretrizes_avaliacao?: string
          link_edital_congresso?: string
          link_manual_revisor?: string
          link_normas_formatacao?: string
          link_template_latex?: string
          link_template_slides?: string
          link_template_word?: string
          max_coautores?: number
          parecer_min_caracteres?: number
          submissoes_abertura?: string | null
          submissoes_encerramento?: string | null
        }
        Relationships: []
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
          created_at: string | null
          curso: string | null
          email: string
          id: string
          matricula: string | null
          nome: string
          periodo: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          curso?: string | null
          email: string
          id?: string
          matricula?: string | null
          nome: string
          periodo?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          curso?: string | null
          email?: string
          id?: string
          matricula?: string | null
          nome?: string
          periodo?: string | null
          user_id?: string | null
        }
        Relationships: []
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
      pareceres: {
        Row: {
          comentario_geral: string | null
          created_at: string
          id: string
          itens: Json
          resultado: string
          revisor_email: string
          revisor_nome: string | null
          trabalho_id: string
          updated_at: string
        }
        Insert: {
          comentario_geral?: string | null
          created_at?: string
          id?: string
          itens?: Json
          resultado: string
          revisor_email: string
          revisor_nome?: string | null
          trabalho_id: string
          updated_at?: string
        }
        Update: {
          comentario_geral?: string | null
          created_at?: string
          id?: string
          itens?: Json
          resultado?: string
          revisor_email?: string
          revisor_nome?: string | null
          trabalho_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pareceres_trabalho_id_fkey"
            columns: ["trabalho_id"]
            isOneToOne: false
            referencedRelation: "trabalhos"
            referencedColumns: ["id"]
          },
        ]
      }
      professores: {
        Row: {
          created_at: string | null
          departamento: string
          email: string
          id: string
          nome: string
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          departamento: string
          email: string
          id?: string
          nome: string
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          departamento?: string
          email?: string
          id?: string
          nome?: string
          user_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          cpf: string | null
          created_at: string
          curso: string | null
          email: string | null
          email_confirmado_em: string | null
          foto_perfil: string | null
          id: string
          instituicao: string | null
          nome: string
          telefone: string | null
          updated_at: string | null
        }
        Insert: {
          cpf?: string | null
          created_at?: string
          curso?: string | null
          email?: string | null
          email_confirmado_em?: string | null
          foto_perfil?: string | null
          id: string
          instituicao?: string | null
          nome?: string
          telefone?: string | null
          updated_at?: string | null
        }
        Update: {
          cpf?: string | null
          created_at?: string
          curso?: string | null
          email?: string | null
          email_confirmado_em?: string | null
          foto_perfil?: string | null
          id?: string
          instituicao?: string | null
          nome?: string
          telefone?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          hits: number
          key: string
          window_start: string
        }
        Insert: {
          hits?: number
          key: string
          window_start?: string
        }
        Update: {
          hits?: number
          key?: string
          window_start?: string
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
      tokens_email: {
        Row: {
          created_at: string
          email: string
          expires_at: string
          message_id: string | null
          proposito: string
          token_hash: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          email: string
          expires_at: string
          message_id?: string | null
          proposito: string
          token_hash: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          expires_at?: string
          message_id?: string | null
          proposito?: string
          token_hash?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      trabalho_revisores: {
        Row: {
          created_at: string
          id: string
          revisor_email: string
          revisor_nome: string | null
          tipo: string
          trabalho_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          revisor_email: string
          revisor_nome?: string | null
          tipo?: string
          trabalho_id: string
        }
        Update: {
          created_at?: string
          id?: string
          revisor_email?: string
          revisor_nome?: string | null
          tipo?: string
          trabalho_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trabalho_revisores_trabalho_id_fkey"
            columns: ["trabalho_id"]
            isOneToOne: false
            referencedRelation: "trabalhos"
            referencedColumns: ["id"]
          },
        ]
      }
      trabalhos: {
        Row: {
          autores: string
          categoria_id: string | null
          coautores: Json
          correcoes_enviadas_em: string | null
          created_at: string
          data_submissao: string
          id: string
          orientador_email: string | null
          owner_id: string | null
          palavras_chave: string[]
          pdf_url: string | null
          resumo: string | null
          status: string
          tipo_resumo: string
          titulo: string
          video_url: string | null
        }
        Insert: {
          autores: string
          categoria_id?: string | null
          coautores?: Json
          correcoes_enviadas_em?: string | null
          created_at?: string
          data_submissao?: string
          id?: string
          orientador_email?: string | null
          owner_id?: string | null
          palavras_chave?: string[]
          pdf_url?: string | null
          resumo?: string | null
          status?: string
          tipo_resumo?: string
          titulo: string
          video_url?: string | null
        }
        Update: {
          autores?: string
          categoria_id?: string | null
          coautores?: Json
          correcoes_enviadas_em?: string | null
          created_at?: string
          data_submissao?: string
          id?: string
          orientador_email?: string | null
          owner_id?: string | null
          palavras_chave?: string[]
          pdf_url?: string | null
          resumo?: string | null
          status?: string
          tipo_resumo?: string
          titulo?: string
          video_url?: string | null
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
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: string
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
      _conflitos_por_trabalho: {
        Args: never
        Returns: {
          email: string
          motivo: string
          trabalho_id: string
        }[]
      }
      _pool_revisores: {
        Args: never
        Returns: {
          email: string
          nome: string
          tipo: string
        }[]
      }
      aplicar_decisao: { Args: { _trabalho_id: string }; Returns: string }
      close_event_and_issue_certificates: {
        Args: { _carga_horaria: number; _event_id: string; _event_type: string }
        Returns: {
          certificate_id: string
          created: boolean
          user_id: string
        }[]
      }
      confirmar_distribuicao: { Args: { _pares: Json }; Returns: number }
      confirmar_email: { Args: { p_token: string }; Returns: string }
      conflitos_do_trabalho: {
        Args: { _trabalho_id: string }
        Returns: {
          email: string
          motivo: string
        }[]
      }
      conflitos_por_trabalho: {
        Args: never
        Returns: {
          email: string
          motivo: string
          trabalho_id: string
        }[]
      }
      consume_rate_limit: {
        Args: { _key: string; _max: number; _window_seconds: number }
        Returns: boolean
      }
      consumir_token_redefinicao: {
        Args: { p_token: string }
        Returns: {
          status: string
          user_id: string
        }[]
      }
      criar_token_email: {
        Args: { p_proposito?: string; p_user_id: string }
        Returns: string
      }
      criar_token_redefinicao: {
        Args: { p_email: string; p_ip?: string }
        Returns: {
          motivo: string
          nome: string
          segundos: number
          token: string
        }[]
      }
      data_local: { Args: never; Returns: string }
      decisao_consolidada: { Args: { _trabalho_id: string }; Returns: string }
      distribuir_revisores: { Args: { _trabalho_id: string }; Returns: number }
      editar_submissao: {
        Args: {
          _palavras_chave: string[]
          _pdf_url?: string
          _tipo_resumo: string
          _titulo: string
          _trabalho_id: string
          _video_url: string
        }
        Returns: string
      }
      email_confirmado: { Args: never; Returns: boolean }
      enviar_correcao: {
        Args: {
          _palavras_chave: string[]
          _pdf_url?: string
          _tipo_resumo: string
          _titulo: string
          _trabalho_id: string
          _video_url: string
        }
        Returns: string
      }
      exigir_email_confirmado: { Args: never; Returns: undefined }
      get_my_roles: { Args: never; Returns: string[] }
      has_role: { Args: { _role: string; _user_id: string }; Returns: boolean }
      is_app_admin: { Args: never; Returns: boolean }
      is_event_staff: { Args: never; Returns: boolean }
      liberar_email_nao_confirmado: {
        Args: { p_email: string }
        Returns: string
      }
      links_downloads: {
        Args: never
        Returns: {
          link_codigo_etica: string
          link_diretrizes_avaliacao: string
          link_edital_congresso: string
          link_manual_revisor: string
          link_normas_formatacao: string
          link_template_latex: string
          link_template_slides: string
          link_template_word: string
        }[]
      }
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
      minicourse_occupancy: {
        Args: never
        Returns: {
          inscritos: number
          minicourse_id: string
        }[]
      }
      pareceres_do_meu_trabalho: {
        Args: { _trabalho_id: string }
        Returns: {
          comentario_geral: string
          itens: Json
          ordem: number
          resultado: string
        }[]
      }
      pool_revisores: {
        Args: never
        Returns: {
          email: string
          nome: string
          tipo: string
        }[]
      }
      prazo_submissoes: {
        Args: never
        Returns: {
          aberto: boolean
          abertura: string
          encerramento: string
          hoje: string
        }[]
      }
      recomendar_distribuicao: {
        Args: never
        Returns: {
          revisor_email: string
          revisor_nome: string
          tipo: string
          trabalho_id: string
        }[]
      }
      submissoes_abertas: { Args: never; Returns: boolean }
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
      avaliacao_status: "pendente" | "em_avaliacao" | "concluida"
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
      avaliacao_status: ["pendente", "em_avaliacao", "concluida"],
      registration_status: ["pending", "approved", "cancelled"],
    },
  },
} as const
