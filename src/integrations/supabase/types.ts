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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      admin_seed: {
        Row: {
          created_at: string
          id: string
          identifier: string
          note: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          identifier: string
          note?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          identifier?: string
          note?: string | null
        }
        Relationships: []
      }
      alert_job_notifications: {
        Row: {
          alert_id: string
          id: string
          job_id: string
          notified_at: string
        }
        Insert: {
          alert_id: string
          id?: string
          job_id: string
          notified_at?: string
        }
        Update: {
          alert_id?: string
          id?: string
          job_id?: string
          notified_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_job_notifications_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "candidate_job_alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_job_notifications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      application_ai_scores: {
        Row: {
          application_id: string
          candidate_id: string
          computed_at: string
          id: string
          job_id: string
          reasons: string[]
          score: number
          summary: string | null
        }
        Insert: {
          application_id: string
          candidate_id: string
          computed_at?: string
          id?: string
          job_id: string
          reasons?: string[]
          score: number
          summary?: string | null
        }
        Update: {
          application_id?: string
          candidate_id?: string
          computed_at?: string
          id?: string
          job_id?: string
          reasons?: string[]
          score?: number
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "application_ai_scores_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_ai_scores_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      application_match_scores: {
        Row: {
          application_id: string
          candidate_id: string
          company_id: string
          created_at: string
          gaps: Json | null
          job_id: string
          score: number | null
          status: string
          strengths: Json | null
          summary: string | null
          updated_at: string
        }
        Insert: {
          application_id: string
          candidate_id: string
          company_id: string
          created_at?: string
          gaps?: Json | null
          job_id: string
          score?: number | null
          status?: string
          strengths?: Json | null
          summary?: string | null
          updated_at?: string
        }
        Update: {
          application_id?: string
          candidate_id?: string
          company_id?: string
          created_at?: string
          gaps?: Json | null
          job_id?: string
          score?: number | null
          status?: string
          strengths?: Json | null
          summary?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_match_scores_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: true
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      application_notes: {
        Row: {
          application_id: string
          author_id: string
          body: string
          created_at: string
          id: string
        }
        Insert: {
          application_id: string
          author_id: string
          body: string
          created_at?: string
          id?: string
        }
        Update: {
          application_id?: string
          author_id?: string
          body?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_notes_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      application_status_history: {
        Row: {
          application_id: string
          changed_by: string | null
          created_at: string
          from_status: string | null
          id: string
          to_status: string
        }
        Insert: {
          application_id: string
          changed_by?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          to_status: string
        }
        Update: {
          application_id?: string
          changed_by?: string | null
          created_at?: string
          from_status?: string | null
          id?: string
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "application_status_history_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
        ]
      }
      applications: {
        Row: {
          available_from: string | null
          candidate_id: string
          company_id: string
          cover_note: string | null
          created_at: string
          employer_notes: string | null
          expected_salary: number | null
          id: string
          job_id: string
          status: Database["public"]["Enums"]["application_status"]
          updated_at: string
          viewed_by_employer_at: string | null
        }
        Insert: {
          available_from?: string | null
          candidate_id: string
          company_id: string
          cover_note?: string | null
          created_at?: string
          employer_notes?: string | null
          expected_salary?: number | null
          id?: string
          job_id: string
          status?: Database["public"]["Enums"]["application_status"]
          updated_at?: string
          viewed_by_employer_at?: string | null
        }
        Update: {
          available_from?: string | null
          candidate_id?: string
          company_id?: string
          cover_note?: string | null
          created_at?: string
          employer_notes?: string | null
          expected_salary?: number | null
          id?: string
          job_id?: string
          status?: Database["public"]["Enums"]["application_status"]
          updated_at?: string
          viewed_by_employer_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "applications_candidate_id_profiles_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_rules: {
        Row: {
          action: Database["public"]["Enums"]["crm_action"]
          action_payload: Json
          company_id: string
          conditions: Json
          cooldown_hours: number
          created_at: string
          created_by: string
          enabled: boolean
          id: string
          max_fires_per_lead: number
          name: string
          trigger: Database["public"]["Enums"]["crm_trigger"]
          updated_at: string
        }
        Insert: {
          action: Database["public"]["Enums"]["crm_action"]
          action_payload?: Json
          company_id: string
          conditions?: Json
          cooldown_hours?: number
          created_at?: string
          created_by: string
          enabled?: boolean
          id?: string
          max_fires_per_lead?: number
          name: string
          trigger: Database["public"]["Enums"]["crm_trigger"]
          updated_at?: string
        }
        Update: {
          action?: Database["public"]["Enums"]["crm_action"]
          action_payload?: Json
          company_id?: string
          conditions?: Json
          cooldown_hours?: number
          created_at?: string
          created_by?: string
          enabled?: boolean
          id?: string
          max_fires_per_lead?: number
          name?: string
          trigger?: Database["public"]["Enums"]["crm_trigger"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_rules_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_runs: {
        Row: {
          application_id: string | null
          candidate_id: string | null
          company_id: string
          detail: Json
          fired_at: string
          id: string
          result: string
          rule_id: string
          trigger_key: string
        }
        Insert: {
          application_id?: string | null
          candidate_id?: string | null
          company_id: string
          detail?: Json
          fired_at?: string
          id?: string
          result: string
          rule_id: string
          trigger_key: string
        }
        Update: {
          application_id?: string | null
          candidate_id?: string | null
          company_id?: string
          detail?: Json
          fired_at?: string
          id?: string
          result?: string
          rule_id?: string
          trigger_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_runs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_runs_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "automation_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      benefit_reconciliation_checks: {
        Row: {
          checked_at: string
          drift: Json
          drift_count: number
          id: string
        }
        Insert: {
          checked_at?: string
          drift?: Json
          drift_count: number
          id?: string
        }
        Update: {
          checked_at?: string
          drift?: Json
          drift_count?: number
          id?: string
        }
        Relationships: []
      }
      billing_product_entitlements: {
        Row: {
          benefit_type: Database["public"]["Enums"]["benefit_type"]
          id: string
          product_id: string
          quantity: number
          validity_days: number | null
        }
        Insert: {
          benefit_type: Database["public"]["Enums"]["benefit_type"]
          id?: string
          product_id: string
          quantity: number
          validity_days?: number | null
        }
        Update: {
          benefit_type?: Database["public"]["Enums"]["benefit_type"]
          id?: string
          product_id?: string
          quantity?: number
          validity_days?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_product_entitlements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "billing_products"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_products: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: string
          kind: string
          legacy_credit_pack_id: string | null
          name: string
          price_inr: number
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: string
          kind: string
          legacy_credit_pack_id?: string | null
          name: string
          price_inr: number
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          kind?: string
          legacy_credit_pack_id?: string | null
          name?: string
          price_inr?: number
        }
        Relationships: [
          {
            foreignKeyName: "billing_products_legacy_credit_pack_id_fkey"
            columns: ["legacy_credit_pack_id"]
            isOneToOne: false
            referencedRelation: "credit_packs"
            referencedColumns: ["id"]
          },
        ]
      }
      boost_settings: {
        Row: {
          boost_weight: number
          cost_credits: number
          enabled: boolean
          freshness_weight: number
          id: number
          max_boosts_per_company_day: number
          quality_weight: number
          trending_weight: number
          updated_at: string
          window_hours: number
        }
        Insert: {
          boost_weight?: number
          cost_credits?: number
          enabled?: boolean
          freshness_weight?: number
          id?: number
          max_boosts_per_company_day?: number
          quality_weight?: number
          trending_weight?: number
          updated_at?: string
          window_hours?: number
        }
        Update: {
          boost_weight?: number
          cost_credits?: number
          enabled?: boolean
          freshness_weight?: number
          id?: number
          max_boosts_per_company_day?: number
          quality_weight?: number
          trending_weight?: number
          updated_at?: string
          window_hours?: number
        }
        Relationships: []
      }
      call_logs: {
        Row: {
          application_id: string | null
          caller_id: string
          candidate_id: string
          company_id: string
          contact_source: string
          created_at: string
          duration_sec: number | null
          id: string
          job_id: string | null
          notes: string | null
          outcome: Database["public"]["Enums"]["call_outcome"]
        }
        Insert: {
          application_id?: string | null
          caller_id: string
          candidate_id: string
          company_id: string
          contact_source: string
          created_at?: string
          duration_sec?: number | null
          id?: string
          job_id?: string | null
          notes?: string | null
          outcome: Database["public"]["Enums"]["call_outcome"]
        }
        Update: {
          application_id?: string | null
          caller_id?: string
          candidate_id?: string
          company_id?: string
          contact_source?: string
          created_at?: string
          duration_sec?: number | null
          id?: string
          job_id?: string | null
          notes?: string | null
          outcome?: Database["public"]["Enums"]["call_outcome"]
        }
        Relationships: [
          {
            foreignKeyName: "call_logs_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_logs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_logs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_assets_master: {
        Row: {
          category: string
          created_at: string
          id: string
          is_active: boolean
          label: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          id?: string
          is_active?: boolean
          label: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      candidate_documents: {
        Row: {
          created_at: string
          doc_type: string
          file_name: string
          file_path: string
          id: string
          size_bytes: number | null
          user_id: string
        }
        Insert: {
          created_at?: string
          doc_type: string
          file_name: string
          file_path: string
          id?: string
          size_bytes?: number | null
          user_id: string
        }
        Update: {
          created_at?: string
          doc_type?: string
          file_name?: string
          file_path?: string
          id?: string
          size_bytes?: number | null
          user_id?: string
        }
        Relationships: []
      }
      candidate_education: {
        Row: {
          board_or_university: string | null
          created_at: string
          id: string
          institute: string | null
          level: string
          marks: string | null
          source_import_id: string | null
          source_kind: string | null
          updated_at: string
          user_id: string
          year_of_passing: number | null
        }
        Insert: {
          board_or_university?: string | null
          created_at?: string
          id?: string
          institute?: string | null
          level: string
          marks?: string | null
          source_import_id?: string | null
          source_kind?: string | null
          updated_at?: string
          user_id: string
          year_of_passing?: number | null
        }
        Update: {
          board_or_university?: string | null
          created_at?: string
          id?: string
          institute?: string | null
          level?: string
          marks?: string | null
          source_import_id?: string | null
          source_kind?: string | null
          updated_at?: string
          user_id?: string
          year_of_passing?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "candidate_education_source_import_id_fkey"
            columns: ["source_import_id"]
            isOneToOne: false
            referencedRelation: "candidate_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_experiences: {
        Row: {
          company_name: string
          created_at: string
          description: string | null
          end_date: string | null
          id: string
          is_current: boolean
          job_title: string
          source_import_id: string | null
          source_kind: string | null
          start_date: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          company_name: string
          created_at?: string
          description?: string | null
          end_date?: string | null
          id?: string
          is_current?: boolean
          job_title: string
          source_import_id?: string | null
          source_kind?: string | null
          start_date?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          company_name?: string
          created_at?: string
          description?: string | null
          end_date?: string | null
          id?: string
          is_current?: boolean
          job_title?: string
          source_import_id?: string | null
          source_kind?: string | null
          start_date?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_experiences_source_import_id_fkey"
            columns: ["source_import_id"]
            isOneToOne: false
            referencedRelation: "candidate_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_imports: {
        Row: {
          candidate_id: string
          created_at: string
          error_code: string | null
          file_name: string | null
          file_path: string | null
          id: string
          mime_type: string | null
          parser_version: string
          size_bytes: number | null
          source: string
          status: string
        }
        Insert: {
          candidate_id: string
          created_at?: string
          error_code?: string | null
          file_name?: string | null
          file_path?: string | null
          id?: string
          mime_type?: string | null
          parser_version?: string
          size_bytes?: number | null
          source: string
          status?: string
        }
        Update: {
          candidate_id?: string
          created_at?: string
          error_code?: string | null
          file_name?: string | null
          file_path?: string | null
          id?: string
          mime_type?: string | null
          parser_version?: string
          size_bytes?: number | null
          source?: string
          status?: string
        }
        Relationships: []
      }
      candidate_job_alerts: {
        Row: {
          created_at: string
          email_enabled: boolean
          frequency: string
          id: string
          is_active: boolean
          last_sent_at: string | null
          name: string
          query: Json
          updated_at: string
          user_id: string
          whatsapp_enabled: boolean
        }
        Insert: {
          created_at?: string
          email_enabled?: boolean
          frequency?: string
          id?: string
          is_active?: boolean
          last_sent_at?: string | null
          name: string
          query?: Json
          updated_at?: string
          user_id: string
          whatsapp_enabled?: boolean
        }
        Update: {
          created_at?: string
          email_enabled?: boolean
          frequency?: string
          id?: string
          is_active?: boolean
          last_sent_at?: string | null
          name?: string
          query?: Json
          updated_at?: string
          user_id?: string
          whatsapp_enabled?: boolean
        }
        Relationships: []
      }
      candidate_languages: {
        Row: {
          can_read: boolean
          can_write: boolean
          created_at: string
          id: string
          language: string
          proficiency: string
          user_id: string
        }
        Insert: {
          can_read?: boolean
          can_write?: boolean
          created_at?: string
          id?: string
          language: string
          proficiency: string
          user_id: string
        }
        Update: {
          can_read?: boolean
          can_write?: boolean
          created_at?: string
          id?: string
          language?: string
          proficiency?: string
          user_id?: string
        }
        Relationships: []
      }
      candidate_nudges: {
        Row: {
          created_at: string
          dismissed_at: string | null
          id: string
          kind: string
          last_shown_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          dismissed_at?: string | null
          id?: string
          kind: string
          last_shown_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          dismissed_at?: string | null
          id?: string
          kind?: string
          last_shown_at?: string
          user_id?: string
        }
        Relationships: []
      }
      candidate_orders: {
        Row: {
          amount: number | null
          certification_id: string | null
          course_id: string | null
          created_at: string | null
          currency: string | null
          id: string
          item_type: string
          razorpay_order_id: string | null
          razorpay_payment_id: string | null
          status: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          amount?: number | null
          certification_id?: string | null
          course_id?: string | null
          created_at?: string | null
          currency?: string | null
          id?: string
          item_type?: string
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          status?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          amount?: number | null
          certification_id?: string | null
          course_id?: string | null
          created_at?: string | null
          currency?: string | null
          id?: string
          item_type?: string
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          status?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidate_orders_certification_id_fkey"
            columns: ["certification_id"]
            isOneToOne: false
            referencedRelation: "certifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_orders_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      candidate_preferences: {
        Row: {
          city_ids: string[]
          created_at: string
          job_types: string[]
          max_experience_years: number | null
          max_salary_monthly: number | null
          min_experience_years: number | null
          min_salary_monthly: number | null
          skill_ids: string[]
          source: string
          updated_at: string
          user_id: string
          work_modes: string[]
        }
        Insert: {
          city_ids?: string[]
          created_at?: string
          job_types?: string[]
          max_experience_years?: number | null
          max_salary_monthly?: number | null
          min_experience_years?: number | null
          min_salary_monthly?: number | null
          skill_ids?: string[]
          source?: string
          updated_at?: string
          user_id: string
          work_modes?: string[]
        }
        Update: {
          city_ids?: string[]
          created_at?: string
          job_types?: string[]
          max_experience_years?: number | null
          max_salary_monthly?: number | null
          min_experience_years?: number | null
          min_salary_monthly?: number | null
          skill_ids?: string[]
          source?: string
          updated_at?: string
          user_id?: string
          work_modes?: string[]
        }
        Relationships: []
      }
      candidate_profile_events: {
        Row: {
          candidate_id: string
          context: Json
          created_at: string
          event_key: string
          id: string
        }
        Insert: {
          candidate_id: string
          context?: Json
          created_at?: string
          event_key: string
          id?: string
        }
        Update: {
          candidate_id?: string
          context?: Json
          created_at?: string
          event_key?: string
          id?: string
        }
        Relationships: []
      }
      candidate_profile_tasks: {
        Row: {
          candidate_id: string
          created_at: string
          id: string
          last_shown_at: string | null
          snoozed_until: string | null
          status: string
          task_key: string
          updated_at: string
        }
        Insert: {
          candidate_id: string
          created_at?: string
          id?: string
          last_shown_at?: string | null
          snoozed_until?: string | null
          status?: string
          task_key: string
          updated_at?: string
        }
        Update: {
          candidate_id?: string
          created_at?: string
          id?: string
          last_shown_at?: string | null
          snoozed_until?: string | null
          status?: string
          task_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      candidate_profiles: {
        Row: {
          assets: string[]
          bio: string | null
          created_at: string
          current_salary: number | null
          date_of_birth: string | null
          expected_salary: number | null
          expected_salary_choice_kind: string | null
          expected_salary_period: string
          experience_status: Database["public"]["Enums"]["experience_status"]
          gender: string | null
          government_id_last4: string | null
          government_id_type: string | null
          headline: string | null
          highest_qualification: string | null
          interested_roles: string[]
          kyc_status: string
          last_role: string | null
          marital_status: string | null
          notice_period_days: number | null
          notification_prefs: Json
          onboarding_completed: boolean
          preferred_cities: string[]
          preferred_job_types: string[]
          preferred_work_mode: string | null
          profile_slug: string | null
          profile_strength: number
          profile_views: number
          resume_name: string | null
          resume_url: string | null
          skills: string[]
          updated_at: string
          user_id: string
          whatsapp_number: string | null
          whatsapp_opt_in: boolean
          years_experience: number
        }
        Insert: {
          assets?: string[]
          bio?: string | null
          created_at?: string
          current_salary?: number | null
          date_of_birth?: string | null
          expected_salary?: number | null
          expected_salary_choice_kind?: string | null
          expected_salary_period?: string
          experience_status?: Database["public"]["Enums"]["experience_status"]
          gender?: string | null
          government_id_last4?: string | null
          government_id_type?: string | null
          headline?: string | null
          highest_qualification?: string | null
          interested_roles?: string[]
          kyc_status?: string
          last_role?: string | null
          marital_status?: string | null
          notice_period_days?: number | null
          notification_prefs?: Json
          onboarding_completed?: boolean
          preferred_cities?: string[]
          preferred_job_types?: string[]
          preferred_work_mode?: string | null
          profile_slug?: string | null
          profile_strength?: number
          profile_views?: number
          resume_name?: string | null
          resume_url?: string | null
          skills?: string[]
          updated_at?: string
          user_id: string
          whatsapp_number?: string | null
          whatsapp_opt_in?: boolean
          years_experience?: number
        }
        Update: {
          assets?: string[]
          bio?: string | null
          created_at?: string
          current_salary?: number | null
          date_of_birth?: string | null
          expected_salary?: number | null
          expected_salary_choice_kind?: string | null
          expected_salary_period?: string
          experience_status?: Database["public"]["Enums"]["experience_status"]
          gender?: string | null
          government_id_last4?: string | null
          government_id_type?: string | null
          headline?: string | null
          highest_qualification?: string | null
          interested_roles?: string[]
          kyc_status?: string
          last_role?: string | null
          marital_status?: string | null
          notice_period_days?: number | null
          notification_prefs?: Json
          onboarding_completed?: boolean
          preferred_cities?: string[]
          preferred_job_types?: string[]
          preferred_work_mode?: string | null
          profile_slug?: string | null
          profile_strength?: number
          profile_views?: number
          resume_name?: string | null
          resume_url?: string | null
          skills?: string[]
          updated_at?: string
          user_id?: string
          whatsapp_number?: string | null
          whatsapp_opt_in?: boolean
          years_experience?: number
        }
        Relationships: []
      }
      candidate_unlocks: {
        Row: {
          candidate_user_id: string
          company_id: string
          created_at: string
          credits_spent: number
          id: string
          job_id: string | null
          source: string
          unlocked_by: string | null
        }
        Insert: {
          candidate_user_id: string
          company_id: string
          created_at?: string
          credits_spent?: number
          id?: string
          job_id?: string | null
          source: string
          unlocked_by?: string | null
        }
        Update: {
          candidate_user_id?: string
          company_id?: string
          created_at?: string
          credits_spent?: number
          id?: string
          job_id?: string | null
          source?: string
          unlocked_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "candidate_unlocks_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidate_unlocks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      canonical_skills: {
        Row: {
          aliases: string[]
          category: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          aliases?: string[]
          category?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          aliases?: string[]
          category?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      cert_attempts: {
        Row: {
          answers: Json
          attempt_number: number
          certification_id: string
          id: string
          passed: boolean
          score: number
          submitted_at: string
          user_id: string
        }
        Insert: {
          answers: Json
          attempt_number: number
          certification_id: string
          id?: string
          passed: boolean
          score: number
          submitted_at?: string
          user_id: string
        }
        Update: {
          answers?: Json
          attempt_number?: number
          certification_id?: string
          id?: string
          passed?: boolean
          score?: number
          submitted_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cert_attempts_certification_id_fkey"
            columns: ["certification_id"]
            isOneToOne: false
            referencedRelation: "certifications"
            referencedColumns: ["id"]
          },
        ]
      }
      cert_purchases: {
        Row: {
          certificate_no: string | null
          certification_id: string
          id: string
          purchased_at: string | null
          user_id: string
        }
        Insert: {
          certificate_no?: string | null
          certification_id: string
          id?: string
          purchased_at?: string | null
          user_id: string
        }
        Update: {
          certificate_no?: string | null
          certification_id?: string
          id?: string
          purchased_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cert_purchases_certification_id_fkey"
            columns: ["certification_id"]
            isOneToOne: false
            referencedRelation: "certifications"
            referencedColumns: ["id"]
          },
        ]
      }
      cert_questions: {
        Row: {
          certification_id: string
          id: string
          question_jsonb: Json
        }
        Insert: {
          certification_id: string
          id?: string
          question_jsonb: Json
        }
        Update: {
          certification_id?: string
          id?: string
          question_jsonb?: Json
        }
        Relationships: [
          {
            foreignKeyName: "cert_questions_certification_id_fkey"
            columns: ["certification_id"]
            isOneToOne: false
            referencedRelation: "certifications"
            referencedColumns: ["id"]
          },
        ]
      }
      certifications: {
        Row: {
          id: string
          max_attempts: number
          partner_name: string | null
          pass_mark: number
          price_inr: number
          provider: string
          questions: Json | null
          validity_months: number | null
        }
        Insert: {
          id: string
          max_attempts?: number
          partner_name?: string | null
          pass_mark?: number
          price_inr?: number
          provider?: string
          questions?: Json | null
          validity_months?: number | null
        }
        Update: {
          id?: string
          max_attempts?: number
          partner_name?: string | null
          pass_mark?: number
          price_inr?: number
          provider?: string
          questions?: Json | null
          validity_months?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "certifications_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
        ]
      }
      cities: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_launched: boolean
          is_metro: boolean
          name: string
          slug: string
          state: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_launched?: boolean
          is_metro?: boolean
          name: string
          slug: string
          state?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_launched?: boolean
          is_metro?: boolean
          name?: string
          slug?: string
          state?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      companies: {
        Row: {
          about: string | null
          allow_brand_display: boolean
          company_type: Database["public"]["Enums"]["company_type"] | null
          cover_url: string | null
          created_at: string
          created_by: string | null
          description: string | null
          founded_year: number | null
          gst_number: string | null
          hq_city: string | null
          id: string
          industry: string | null
          is_consultant: boolean
          is_verified: boolean
          logo_url: string | null
          name: string
          onboarding_completed: boolean
          pan_number: string | null
          pincode: string | null
          primary_city: string | null
          size: Database["public"]["Enums"]["company_size"] | null
          slug: string | null
          social_links: Json
          spam_suspected: boolean
          updated_at: string
          verification_notes: string | null
          verification_status: string
          website: string | null
        }
        Insert: {
          about?: string | null
          allow_brand_display?: boolean
          company_type?: Database["public"]["Enums"]["company_type"] | null
          cover_url?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          founded_year?: number | null
          gst_number?: string | null
          hq_city?: string | null
          id?: string
          industry?: string | null
          is_consultant?: boolean
          is_verified?: boolean
          logo_url?: string | null
          name: string
          onboarding_completed?: boolean
          pan_number?: string | null
          pincode?: string | null
          primary_city?: string | null
          size?: Database["public"]["Enums"]["company_size"] | null
          slug?: string | null
          social_links?: Json
          spam_suspected?: boolean
          updated_at?: string
          verification_notes?: string | null
          verification_status?: string
          website?: string | null
        }
        Update: {
          about?: string | null
          allow_brand_display?: boolean
          company_type?: Database["public"]["Enums"]["company_type"] | null
          cover_url?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          founded_year?: number | null
          gst_number?: string | null
          hq_city?: string | null
          id?: string
          industry?: string | null
          is_consultant?: boolean
          is_verified?: boolean
          logo_url?: string | null
          name?: string
          onboarding_completed?: boolean
          pan_number?: string | null
          pincode?: string | null
          primary_city?: string | null
          size?: Database["public"]["Enums"]["company_size"] | null
          slug?: string | null
          social_links?: Json
          spam_suspected?: boolean
          updated_at?: string
          verification_notes?: string | null
          verification_status?: string
          website?: string | null
        }
        Relationships: []
      }
      company_benefit_grants: {
        Row: {
          benefit_type: Database["public"]["Enums"]["benefit_type"]
          company_id: string
          created_by: string | null
          expires_at: string | null
          granted_at: string
          id: string
          quantity: number
          reference: Json
          remaining: number
          source: string
        }
        Insert: {
          benefit_type: Database["public"]["Enums"]["benefit_type"]
          company_id: string
          created_by?: string | null
          expires_at?: string | null
          granted_at?: string
          id?: string
          quantity: number
          reference?: Json
          remaining: number
          source: string
        }
        Update: {
          benefit_type?: Database["public"]["Enums"]["benefit_type"]
          company_id?: string
          created_by?: string | null
          expires_at?: string | null
          granted_at?: string
          id?: string
          quantity?: number
          reference?: Json
          remaining?: number
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_benefit_grants_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_benefit_ledger: {
        Row: {
          benefit_type: Database["public"]["Enums"]["benefit_type"]
          company_id: string
          created_at: string
          created_by: string | null
          delta: number
          event: string
          grant_id: string | null
          id: string
          reference: Json
          resource_key: string | null
        }
        Insert: {
          benefit_type: Database["public"]["Enums"]["benefit_type"]
          company_id: string
          created_at?: string
          created_by?: string | null
          delta: number
          event: string
          grant_id?: string | null
          id?: string
          reference?: Json
          resource_key?: string | null
        }
        Update: {
          benefit_type?: Database["public"]["Enums"]["benefit_type"]
          company_id?: string
          created_at?: string
          created_by?: string | null
          delta?: number
          event?: string
          grant_id?: string | null
          id?: string
          reference?: Json
          resource_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_benefit_ledger_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_benefit_ledger_grant_id_fkey"
            columns: ["grant_id"]
            isOneToOne: false
            referencedRelation: "company_benefit_grants"
            referencedColumns: ["id"]
          },
        ]
      }
      company_documents: {
        Row: {
          company_id: string
          created_at: string
          doc_type: string
          file_name: string | null
          file_path: string
          id: string
          notes: string | null
          status: string
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          doc_type: string
          file_name?: string | null
          file_path: string
          id?: string
          notes?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          doc_type?: string
          file_name?: string | null
          file_path?: string
          id?: string
          notes?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_documents_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      company_plans: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          ends_at: string | null
          id: string
          plan_id: string
          starts_at: string
          status: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          id?: string
          plan_id: string
          starts_at?: string
          status?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          id?: string
          plan_id?: string
          starts_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_plans_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_plans_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      company_verifications: {
        Row: {
          company_id: string
          created_at: string
          docs: Json
          id: string
          method: Database["public"]["Enums"]["kyc_method"]
          notes: string | null
          reference: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["kyc_status"]
          submitted_by: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          docs?: Json
          id?: string
          method: Database["public"]["Enums"]["kyc_method"]
          notes?: string | null
          reference?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["kyc_status"]
          submitted_by?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          docs?: Json
          id?: string
          method?: Database["public"]["Enums"]["kyc_method"]
          notes?: string | null
          reference?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["kyc_status"]
          submitted_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_verifications_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_messages: {
        Row: {
          body: string
          created_at: string
          email: string
          id: string
          name: string
          subject: string | null
        }
        Insert: {
          body: string
          created_at?: string
          email: string
          id?: string
          name: string
          subject?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          email?: string
          id?: string
          name?: string
          subject?: string | null
        }
        Relationships: []
      }
      content_items: {
        Row: {
          category: string | null
          content_type: string
          cover_url: string | null
          created_at: string | null
          excerpt: string | null
          id: string
          published_at: string | null
          slug: string
          status: string
          tags: string[] | null
          title: string
          updated_at: string | null
          views_count: number | null
        }
        Insert: {
          category?: string | null
          content_type: string
          cover_url?: string | null
          created_at?: string | null
          excerpt?: string | null
          id?: string
          published_at?: string | null
          slug: string
          status?: string
          tags?: string[] | null
          title: string
          updated_at?: string | null
          views_count?: number | null
        }
        Update: {
          category?: string | null
          content_type?: string
          cover_url?: string | null
          created_at?: string | null
          excerpt?: string | null
          id?: string
          published_at?: string | null
          slug?: string
          status?: string
          tags?: string[] | null
          title?: string
          updated_at?: string | null
          views_count?: number | null
        }
        Relationships: []
      }
      content_posts: {
        Row: {
          body_md: string | null
          id: string
          og_image_url: string | null
          seo_description: string | null
          seo_title: string | null
        }
        Insert: {
          body_md?: string | null
          id: string
          og_image_url?: string | null
          seo_description?: string | null
          seo_title?: string | null
        }
        Update: {
          body_md?: string | null
          id?: string
          og_image_url?: string | null
          seo_description?: string | null
          seo_title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "content_posts_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
        ]
      }
      content_settings: {
        Row: {
          key: string
          value: Json | null
        }
        Insert: {
          key: string
          value?: Json | null
        }
        Update: {
          key?: string
          value?: Json | null
        }
        Relationships: []
      }
      course_lessons: {
        Row: {
          body_md: string | null
          duration_minutes: number | null
          free_preview: boolean | null
          id: string
          kind: string
          module_id: string
          position: number
          quiz: Json | null
          title: string
          video_url: string | null
        }
        Insert: {
          body_md?: string | null
          duration_minutes?: number | null
          free_preview?: boolean | null
          id?: string
          kind: string
          module_id: string
          position: number
          quiz?: Json | null
          title: string
          video_url?: string | null
        }
        Update: {
          body_md?: string | null
          duration_minutes?: number | null
          free_preview?: boolean | null
          id?: string
          kind?: string
          module_id?: string
          position?: number
          quiz?: Json | null
          title?: string
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "course_lessons_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "course_modules"
            referencedColumns: ["id"]
          },
        ]
      }
      course_modules: {
        Row: {
          body_md: string | null
          course_id: string
          duration_minutes: number | null
          free_preview: boolean | null
          id: string
          kind: string
          position: number
          quiz: Json | null
          title: string
          video_url: string | null
        }
        Insert: {
          body_md?: string | null
          course_id: string
          duration_minutes?: number | null
          free_preview?: boolean | null
          id?: string
          kind: string
          position: number
          quiz?: Json | null
          title: string
          video_url?: string | null
        }
        Update: {
          body_md?: string | null
          course_id?: string
          duration_minutes?: number | null
          free_preview?: boolean | null
          id?: string
          kind?: string
          position?: number
          quiz?: Json | null
          title?: string
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "course_modules_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
        ]
      }
      course_purchases: {
        Row: {
          course_id: string
          id: string
          purchased_at: string
          user_id: string
        }
        Insert: {
          course_id: string
          id?: string
          purchased_at?: string
          user_id: string
        }
        Update: {
          course_id?: string
          id?: string
          purchased_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_purchases_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      courses: {
        Row: {
          id: string
          price_inr: number
        }
        Insert: {
          id: string
          price_inr?: number
        }
        Update: {
          id?: string
          price_inr?: number
        }
        Relationships: [
          {
            foreignKeyName: "courses_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_packs: {
        Row: {
          active: boolean
          badge: string | null
          benefit_type: Database["public"]["Enums"]["benefit_type"]
          created_at: string
          credits: number
          id: string
          name: string
          price_inr: number
          sort: number
        }
        Insert: {
          active?: boolean
          badge?: string | null
          benefit_type?: Database["public"]["Enums"]["benefit_type"]
          created_at?: string
          credits: number
          id?: string
          name: string
          price_inr: number
          sort?: number
        }
        Update: {
          active?: boolean
          badge?: string | null
          benefit_type?: Database["public"]["Enums"]["benefit_type"]
          created_at?: string
          credits?: number
          id?: string
          name?: string
          price_inr?: number
          sort?: number
        }
        Relationships: []
      }
      credit_transactions: {
        Row: {
          balance_after: number
          benefit_type: Database["public"]["Enums"]["benefit_type"]
          company_id: string
          created_at: string
          created_by: string | null
          delta: number
          id: string
          kind: Database["public"]["Enums"]["credit_txn_kind"]
          reference: Json | null
        }
        Insert: {
          balance_after: number
          benefit_type: Database["public"]["Enums"]["benefit_type"]
          company_id: string
          created_at?: string
          created_by?: string | null
          delta: number
          id?: string
          kind: Database["public"]["Enums"]["credit_txn_kind"]
          reference?: Json | null
        }
        Update: {
          balance_after?: number
          benefit_type?: Database["public"]["Enums"]["benefit_type"]
          company_id?: string
          created_at?: string
          created_by?: string | null
          delta?: number
          id?: string
          kind?: Database["public"]["Enums"]["credit_txn_kind"]
          reference?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "credit_transactions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_settings: {
        Row: {
          automation_batch: number
          id: number
          outcome_followup_hours: Json
          updated_at: string
          weights: Json
        }
        Insert: {
          automation_batch?: number
          id?: number
          outcome_followup_hours: Json
          updated_at?: string
          weights: Json
        }
        Update: {
          automation_batch?: number
          id?: number
          outcome_followup_hours?: Json
          updated_at?: string
          weights?: Json
        }
        Relationships: []
      }
      download_events: {
        Row: {
          company_id: string | null
          created_at: string
          id: string
          kind: string
          row_count: number
          user_id: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          id?: string
          kind: string
          row_count?: number
          user_id: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          row_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "download_events_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      download_ledger: {
        Row: {
          count: number
          day: string
          kind: string
          user_id: string
        }
        Insert: {
          count?: number
          day: string
          kind: string
          user_id: string
        }
        Update: {
          count?: number
          day?: string
          kind?: string
          user_id?: string
        }
        Relationships: []
      }
      employer_activity: {
        Row: {
          actor_id: string | null
          body: string | null
          company_id: string
          created_at: string
          id: string
          kind: string
          link: string | null
          metadata: Json
          title: string
        }
        Insert: {
          actor_id?: string | null
          body?: string | null
          company_id: string
          created_at?: string
          id?: string
          kind: string
          link?: string | null
          metadata?: Json
          title: string
        }
        Update: {
          actor_id?: string | null
          body?: string | null
          company_id?: string
          created_at?: string
          id?: string
          kind?: string
          link?: string | null
          metadata?: Json
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "employer_activity_actor_id_profiles_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employer_activity_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      employer_credit_wallets: {
        Row: {
          boost_balance: number
          company_id: string
          contact_balance: number
          job_post_balance: number
          updated_at: string
        }
        Insert: {
          boost_balance?: number
          company_id: string
          contact_balance?: number
          job_post_balance?: number
          updated_at?: string
        }
        Update: {
          boost_balance?: number
          company_id?: string
          contact_balance?: number
          job_post_balance?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employer_credit_wallets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      employer_invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          company_id: string
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          role: Database["public"]["Enums"]["employer_role"]
          token: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          company_id: string
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          role?: Database["public"]["Enums"]["employer_role"]
          token?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          company_id?: string
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          role?: Database["public"]["Enums"]["employer_role"]
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "employer_invites_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      employer_members: {
        Row: {
          company_id: string
          created_at: string
          id: string
          revoked_at: string | null
          revoked_by: string | null
          role: Database["public"]["Enums"]["employer_role"]
          status: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          revoked_at?: string | null
          revoked_by?: string | null
          role?: Database["public"]["Enums"]["employer_role"]
          status?: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          revoked_at?: string | null
          revoked_by?: string | null
          role?: Database["public"]["Enums"]["employer_role"]
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "employer_members_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employer_members_user_id_profiles_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      follow_up_tasks: {
        Row: {
          application_id: string | null
          assignee_id: string | null
          body: string | null
          candidate_id: string
          company_id: string
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string
          due_at: string
          due_notified_at: string | null
          id: string
          job_id: string | null
          priority: number
          source: string
          source_ref: string | null
          status: Database["public"]["Enums"]["followup_task_status"]
          title: string
          updated_at: string
        }
        Insert: {
          application_id?: string | null
          assignee_id?: string | null
          body?: string | null
          candidate_id: string
          company_id: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by: string
          due_at: string
          due_notified_at?: string | null
          id?: string
          job_id?: string | null
          priority?: number
          source?: string
          source_ref?: string | null
          status?: Database["public"]["Enums"]["followup_task_status"]
          title: string
          updated_at?: string
        }
        Update: {
          application_id?: string | null
          assignee_id?: string | null
          body?: string | null
          candidate_id?: string
          company_id?: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string
          due_at?: string
          due_notified_at?: string | null
          id?: string
          job_id?: string | null
          priority?: number
          source?: string
          source_ref?: string | null
          status?: Database["public"]["Enums"]["followup_task_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "follow_up_tasks_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_up_tasks_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_up_tasks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      industries: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      interview_prep_answers: {
        Row: {
          answer_text: string
          attempt: number
          candidate_id: string
          created_at: string
          feedback: Json | null
          feedback_language: string
          feedback_source: string | null
          id: string
          model_info: string | null
          prompt_version: string | null
          rubric_version: number | null
          session_question_id: string
          source: string
          voice_metrics: Json | null
        }
        Insert: {
          answer_text: string
          attempt?: number
          candidate_id: string
          created_at?: string
          feedback?: Json | null
          feedback_language?: string
          feedback_source?: string | null
          id?: string
          model_info?: string | null
          prompt_version?: string | null
          rubric_version?: number | null
          session_question_id: string
          source?: string
          voice_metrics?: Json | null
        }
        Update: {
          answer_text?: string
          attempt?: number
          candidate_id?: string
          created_at?: string
          feedback?: Json | null
          feedback_language?: string
          feedback_source?: string | null
          id?: string
          model_info?: string | null
          prompt_version?: string | null
          rubric_version?: number | null
          session_question_id?: string
          source?: string
          voice_metrics?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "interview_prep_answers_session_question_id_fkey"
            columns: ["session_question_id"]
            isOneToOne: false
            referencedRelation: "interview_prep_session_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      interview_prep_question_prefs: {
        Row: {
          candidate_id: string
          created_at: string
          pref: string
          template_id: string
        }
        Insert: {
          candidate_id: string
          created_at?: string
          pref: string
          template_id: string
        }
        Update: {
          candidate_id?: string
          created_at?: string
          pref?: string
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "interview_prep_question_prefs_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "interview_prep_question_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      interview_prep_question_template_translations: {
        Row: {
          created_at: string
          created_by: string | null
          framework: Json
          language: string
          question: string
          reviewed_by: string | null
          status: string
          template_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          framework?: Json
          language: string
          question: string
          reviewed_by?: string | null
          status?: string
          template_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          framework?: Json
          language?: string
          question?: string
          reviewed_by?: string | null
          status?: string
          template_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "interview_prep_question_template_translations_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "interview_prep_question_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      interview_prep_question_templates: {
        Row: {
          category: string
          created_at: string
          created_by: string | null
          difficulty: string
          framework: Json
          id: string
          language: string
          question: string
          reviewed_by: string | null
          role_keywords: string[] | null
          rubric_version: number
          skill_tags: string[]
          status: string
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          created_by?: string | null
          difficulty?: string
          framework?: Json
          id?: string
          language?: string
          question: string
          reviewed_by?: string | null
          role_keywords?: string[] | null
          rubric_version?: number
          skill_tags?: string[]
          status?: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string | null
          difficulty?: string
          framework?: Json
          id?: string
          language?: string
          question?: string
          reviewed_by?: string | null
          role_keywords?: string[] | null
          rubric_version?: number
          skill_tags?: string[]
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      interview_prep_reminders_sent: {
        Row: {
          candidate_id: string
          interview_id: string
          sent_at: string
        }
        Insert: {
          candidate_id: string
          interview_id: string
          sent_at?: string
        }
        Update: {
          candidate_id?: string
          interview_id?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "interview_prep_reminders_sent_interview_id_fkey"
            columns: ["interview_id"]
            isOneToOne: true
            referencedRelation: "interviews"
            referencedColumns: ["id"]
          },
        ]
      }
      interview_prep_reports: {
        Row: {
          answer_id: string | null
          category: string
          created_at: string
          details: string | null
          id: string
          reporter_id: string
          session_question_id: string | null
          status: string
          target_type: string
          template_id: string | null
        }
        Insert: {
          answer_id?: string | null
          category: string
          created_at?: string
          details?: string | null
          id?: string
          reporter_id: string
          session_question_id?: string | null
          status?: string
          target_type: string
          template_id?: string | null
        }
        Update: {
          answer_id?: string | null
          category?: string
          created_at?: string
          details?: string | null
          id?: string
          reporter_id?: string
          session_question_id?: string | null
          status?: string
          target_type?: string
          template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "interview_prep_reports_answer_id_fkey"
            columns: ["answer_id"]
            isOneToOne: false
            referencedRelation: "interview_prep_answers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interview_prep_reports_session_question_id_fkey"
            columns: ["session_question_id"]
            isOneToOne: false
            referencedRelation: "interview_prep_session_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interview_prep_reports_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "interview_prep_question_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      interview_prep_session_questions: {
        Row: {
          candidate_id: string
          category: string
          framework: Json
          id: string
          position: number
          question_text: string
          rubric_version: number
          session_id: string
          state: string
          template_id: string | null
        }
        Insert: {
          candidate_id: string
          category: string
          framework?: Json
          id?: string
          position: number
          question_text: string
          rubric_version?: number
          session_id: string
          state?: string
          template_id?: string | null
        }
        Update: {
          candidate_id?: string
          category?: string
          framework?: Json
          id?: string
          position?: number
          question_text?: string
          rubric_version?: number
          session_id?: string
          state?: string
          template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "interview_prep_session_questions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "interview_prep_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interview_prep_session_questions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "interview_prep_question_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      interview_prep_sessions: {
        Row: {
          candidate_id: string
          context: Json
          context_type: string
          finished_at: string | null
          id: string
          interview_id: string | null
          job_id: string | null
          language: string
          mode: string
          role_title: string
          self_check: number | null
          started_at: string
          status: string
        }
        Insert: {
          candidate_id: string
          context?: Json
          context_type: string
          finished_at?: string | null
          id?: string
          interview_id?: string | null
          job_id?: string | null
          language?: string
          mode?: string
          role_title: string
          self_check?: number | null
          started_at?: string
          status?: string
        }
        Update: {
          candidate_id?: string
          context?: Json
          context_type?: string
          finished_at?: string | null
          id?: string
          interview_id?: string | null
          job_id?: string | null
          language?: string
          mode?: string
          role_title?: string
          self_check?: number | null
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "interview_prep_sessions_interview_id_fkey"
            columns: ["interview_id"]
            isOneToOne: false
            referencedRelation: "interviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interview_prep_sessions_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      interview_prep_usage_ledger: {
        Row: {
          candidate_id: string
          created_at: string
          id: string
          kind: string
        }
        Insert: {
          candidate_id: string
          created_at?: string
          id?: string
          kind: string
        }
        Update: {
          candidate_id?: string
          created_at?: string
          id?: string
          kind?: string
        }
        Relationships: []
      }
      interview_prep_voice_consent: {
        Row: {
          candidate_id: string
          consented_at: string
          version: number
        }
        Insert: {
          candidate_id: string
          consented_at?: string
          version: number
        }
        Update: {
          candidate_id?: string
          consented_at?: string
          version?: number
        }
        Relationships: []
      }
      interview_zoom_secrets: {
        Row: {
          created_at: string
          interview_id: string
          updated_at: string
          zoom_host_user_id: string
          zoom_join_url: string | null
          zoom_meeting_id: string
          zoom_meeting_uuid: string | null
          zoom_password: string
          zoom_start_url: string | null
        }
        Insert: {
          created_at?: string
          interview_id: string
          updated_at?: string
          zoom_host_user_id: string
          zoom_join_url?: string | null
          zoom_meeting_id: string
          zoom_meeting_uuid?: string | null
          zoom_password: string
          zoom_start_url?: string | null
        }
        Update: {
          created_at?: string
          interview_id?: string
          updated_at?: string
          zoom_host_user_id?: string
          zoom_join_url?: string | null
          zoom_meeting_id?: string
          zoom_meeting_uuid?: string | null
          zoom_password?: string
          zoom_start_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "interview_zoom_secrets_interview_id_fkey"
            columns: ["interview_id"]
            isOneToOne: true
            referencedRelation: "interviews"
            referencedColumns: ["id"]
          },
        ]
      }
      interviews: {
        Row: {
          application_id: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          candidate_id: string
          company_id: string
          created_at: string
          created_by: string | null
          duration_min: number
          host_user_id: string | null
          id: string
          job_id: string | null
          location: string | null
          meeting_url: string | null
          mode: Database["public"]["Enums"]["interview_mode"]
          notes: string | null
          provider: Database["public"]["Enums"]["interview_provider"]
          reminder_email_sent_at: string | null
          scheduled_at: string
          scheduled_email_sent_at: string | null
          status: Database["public"]["Enums"]["interview_status"]
          timezone: string
          updated_at: string
        }
        Insert: {
          application_id?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          candidate_id: string
          company_id: string
          created_at?: string
          created_by?: string | null
          duration_min?: number
          host_user_id?: string | null
          id?: string
          job_id?: string | null
          location?: string | null
          meeting_url?: string | null
          mode?: Database["public"]["Enums"]["interview_mode"]
          notes?: string | null
          provider?: Database["public"]["Enums"]["interview_provider"]
          reminder_email_sent_at?: string | null
          scheduled_at: string
          scheduled_email_sent_at?: string | null
          status?: Database["public"]["Enums"]["interview_status"]
          timezone?: string
          updated_at?: string
        }
        Update: {
          application_id?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          candidate_id?: string
          company_id?: string
          created_at?: string
          created_by?: string | null
          duration_min?: number
          host_user_id?: string | null
          id?: string
          job_id?: string | null
          location?: string | null
          meeting_url?: string | null
          mode?: Database["public"]["Enums"]["interview_mode"]
          notes?: string | null
          provider?: Database["public"]["Enums"]["interview_provider"]
          reminder_email_sent_at?: string | null
          scheduled_at?: string
          scheduled_email_sent_at?: string | null
          status?: Database["public"]["Enums"]["interview_status"]
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "interviews_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interviews_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "interviews_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_counters: {
        Row: {
          financial_year: string
          last_seq: number
        }
        Insert: {
          financial_year: string
          last_seq?: number
        }
        Update: {
          financial_year?: string
          last_seq?: number
        }
        Relationships: []
      }
      invoices: {
        Row: {
          buyer_snapshot: Json
          cgst_inr: number
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          igst_inr: number
          invoice_number: string
          issue_date: string
          line_items: Json
          payment_method: string
          payment_reference: string | null
          payment_status: string
          sgst_inr: number
          source: string
          source_id: string | null
          status: string
          subtotal_inr: number
          total_inr: number
        }
        Insert: {
          buyer_snapshot: Json
          cgst_inr?: number
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          igst_inr?: number
          invoice_number: string
          issue_date?: string
          line_items: Json
          payment_method: string
          payment_reference?: string | null
          payment_status?: string
          sgst_inr?: number
          source: string
          source_id?: string | null
          status?: string
          subtotal_inr: number
          total_inr: number
        }
        Update: {
          buyer_snapshot?: Json
          cgst_inr?: number
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          igst_inr?: number
          invoice_number?: string
          issue_date?: string
          line_items?: Json
          payment_method?: string
          payment_reference?: string | null
          payment_status?: string
          sgst_inr?: number
          source?: string
          source_id?: string | null
          status?: string
          subtotal_inr?: number
          total_inr?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      job_boosts: {
        Row: {
          boost_day: string
          boosted_by: string | null
          company_id: string
          created_at: string
          credits_spent: number
          ends_at: string
          id: string
          job_id: string
          source: string
          starts_at: string
        }
        Insert: {
          boost_day?: string
          boosted_by?: string | null
          company_id: string
          created_at?: string
          credits_spent: number
          ends_at: string
          id?: string
          job_id: string
          source?: string
          starts_at?: string
        }
        Update: {
          boost_day?: string
          boosted_by?: string | null
          company_id?: string
          created_at?: string
          credits_spent?: number
          ends_at?: string
          id?: string
          job_id?: string
          source?: string
          starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_boosts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_boosts_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_candidate_dismissals: {
        Row: {
          candidate_user_id: string
          created_at: string
          dismissed_by: string | null
          job_id: string
        }
        Insert: {
          candidate_user_id: string
          created_at?: string
          dismissed_by?: string | null
          job_id: string
        }
        Update: {
          candidate_user_id?: string
          created_at?: string
          dismissed_by?: string | null
          job_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_candidate_dismissals_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_categories: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      job_expiry_reminders: {
        Row: {
          job_id: string
          sent_at: string
          threshold_days: number
        }
        Insert: {
          job_id: string
          sent_at?: string
          threshold_days: number
        }
        Update: {
          job_id?: string
          sent_at?: string
          threshold_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "job_expiry_reminders_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_purge_reminders: {
        Row: {
          job_id: string
          sent_at: string
        }
        Insert: {
          job_id: string
          sent_at?: string
        }
        Update: {
          job_id?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_purge_reminders_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_reports: {
        Row: {
          created_at: string
          details: string | null
          id: string
          job_id: string
          reason: string
          reporter_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          details?: string | null
          id?: string
          job_id: string
          reason: string
          reporter_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          details?: string | null
          id?: string
          job_id?: string
          reason?: string
          reporter_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_reports_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_response_purges: {
        Row: {
          id: string
          job_id: string
          purged_at: string
          purged_count: number
        }
        Insert: {
          id?: string
          job_id: string
          purged_at?: string
          purged_count?: number
        }
        Update: {
          id?: string
          job_id?: string
          purged_at?: string
          purged_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "job_response_purges_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_shares: {
        Row: {
          channel: string | null
          created_at: string
          id: string
          job_id: string
          user_id: string | null
        }
        Insert: {
          channel?: string | null
          created_at?: string
          id?: string
          job_id: string
          user_id?: string | null
        }
        Update: {
          channel?: string | null
          created_at?: string
          id?: string
          job_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_shares_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_titles_master: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_custom: boolean
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_custom?: boolean
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_custom?: boolean
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      job_unlock_allowance: {
        Row: {
          company_id: string
          created_at: string
          job_id: string
          total: number
          updated_at: string
          used: number
        }
        Insert: {
          company_id: string
          created_at?: string
          job_id: string
          total: number
          updated_at?: string
          used?: number
        }
        Update: {
          company_id?: string
          created_at?: string
          job_id?: string
          total?: number
          updated_at?: string
          used?: number
        }
        Relationships: [
          {
            foreignKeyName: "job_unlock_allowance_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_unlock_allowance_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          age_max: number | null
          age_min: number | null
          applications_count: number | null
          auto_renew: boolean
          auto_shortlist_threshold: number | null
          avg_incentive_monthly: number | null
          boosted_until: string | null
          category: string | null
          certifications: string[] | null
          city: string | null
          closed_at: string | null
          company_id: string
          contact_pref: string | null
          created_at: string
          degree: string | null
          description: string
          description_html: string | null
          education: string | null
          english_level: string | null
          experience_bucket: string | null
          expires_at: string | null
          fixed_pay: boolean | null
          gender_pref: string | null
          hiring_for_company: string | null
          id: string
          incentives_text: string | null
          industry: string | null
          interview_address: string | null
          interview_city: string | null
          interview_locality: string | null
          interview_same_as_company: boolean | null
          interview_type: string | null
          is_featured: boolean
          job_type: Database["public"]["Enums"]["job_type"]
          joining_fee_required: boolean | null
          last_renewed_at: string | null
          locality: string | null
          max_experience_years: number | null
          max_salary: number | null
          min_experience_years: number | null
          min_salary: number | null
          openings: number | null
          pan_india_ok: boolean
          pay_type: string | null
          perks: string[] | null
          pincode: string | null
          posted_by: string | null
          preferred_industries: string[] | null
          preferred_languages: string[] | null
          quality_score: number | null
          renewed_count: number
          reopened_at: string | null
          repost_count: number
          reposted_from: string | null
          required_assets: string[] | null
          responses_locked_after: string | null
          responses_purge_at: string | null
          role_type: string | null
          salary_period: string | null
          screening_questions: Json
          shift: Database["public"]["Enums"]["job_shift"] | null
          skills: string[] | null
          slug: string | null
          specialisation: string | null
          state: string | null
          status: Database["public"]["Enums"]["job_status"]
          tier: Database["public"]["Enums"]["job_tier"]
          tier_source: string | null
          title: string
          updated_at: string
          views_count: number | null
          walkin: boolean | null
          walkin_details: string | null
          work_mode: Database["public"]["Enums"]["work_mode"]
          working_days: number | null
        }
        Insert: {
          age_max?: number | null
          age_min?: number | null
          applications_count?: number | null
          auto_renew?: boolean
          auto_shortlist_threshold?: number | null
          avg_incentive_monthly?: number | null
          boosted_until?: string | null
          category?: string | null
          certifications?: string[] | null
          city?: string | null
          closed_at?: string | null
          company_id: string
          contact_pref?: string | null
          created_at?: string
          degree?: string | null
          description?: string
          description_html?: string | null
          education?: string | null
          english_level?: string | null
          experience_bucket?: string | null
          expires_at?: string | null
          fixed_pay?: boolean | null
          gender_pref?: string | null
          hiring_for_company?: string | null
          id?: string
          incentives_text?: string | null
          industry?: string | null
          interview_address?: string | null
          interview_city?: string | null
          interview_locality?: string | null
          interview_same_as_company?: boolean | null
          interview_type?: string | null
          is_featured?: boolean
          job_type?: Database["public"]["Enums"]["job_type"]
          joining_fee_required?: boolean | null
          last_renewed_at?: string | null
          locality?: string | null
          max_experience_years?: number | null
          max_salary?: number | null
          min_experience_years?: number | null
          min_salary?: number | null
          openings?: number | null
          pan_india_ok?: boolean
          pay_type?: string | null
          perks?: string[] | null
          pincode?: string | null
          posted_by?: string | null
          preferred_industries?: string[] | null
          preferred_languages?: string[] | null
          quality_score?: number | null
          renewed_count?: number
          reopened_at?: string | null
          repost_count?: number
          reposted_from?: string | null
          required_assets?: string[] | null
          responses_locked_after?: string | null
          responses_purge_at?: string | null
          role_type?: string | null
          salary_period?: string | null
          screening_questions?: Json
          shift?: Database["public"]["Enums"]["job_shift"] | null
          skills?: string[] | null
          slug?: string | null
          specialisation?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          tier?: Database["public"]["Enums"]["job_tier"]
          tier_source?: string | null
          title: string
          updated_at?: string
          views_count?: number | null
          walkin?: boolean | null
          walkin_details?: string | null
          work_mode?: Database["public"]["Enums"]["work_mode"]
          working_days?: number | null
        }
        Update: {
          age_max?: number | null
          age_min?: number | null
          applications_count?: number | null
          auto_renew?: boolean
          auto_shortlist_threshold?: number | null
          avg_incentive_monthly?: number | null
          boosted_until?: string | null
          category?: string | null
          certifications?: string[] | null
          city?: string | null
          closed_at?: string | null
          company_id?: string
          contact_pref?: string | null
          created_at?: string
          degree?: string | null
          description?: string
          description_html?: string | null
          education?: string | null
          english_level?: string | null
          experience_bucket?: string | null
          expires_at?: string | null
          fixed_pay?: boolean | null
          gender_pref?: string | null
          hiring_for_company?: string | null
          id?: string
          incentives_text?: string | null
          industry?: string | null
          interview_address?: string | null
          interview_city?: string | null
          interview_locality?: string | null
          interview_same_as_company?: boolean | null
          interview_type?: string | null
          is_featured?: boolean
          job_type?: Database["public"]["Enums"]["job_type"]
          joining_fee_required?: boolean | null
          last_renewed_at?: string | null
          locality?: string | null
          max_experience_years?: number | null
          max_salary?: number | null
          min_experience_years?: number | null
          min_salary?: number | null
          openings?: number | null
          pan_india_ok?: boolean
          pay_type?: string | null
          perks?: string[] | null
          pincode?: string | null
          posted_by?: string | null
          preferred_industries?: string[] | null
          preferred_languages?: string[] | null
          quality_score?: number | null
          renewed_count?: number
          reopened_at?: string | null
          repost_count?: number
          reposted_from?: string | null
          required_assets?: string[] | null
          responses_locked_after?: string | null
          responses_purge_at?: string | null
          role_type?: string | null
          salary_period?: string | null
          screening_questions?: Json
          shift?: Database["public"]["Enums"]["job_shift"] | null
          skills?: string[] | null
          slug?: string | null
          specialisation?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          tier?: Database["public"]["Enums"]["job_tier"]
          tier_source?: string | null
          title?: string
          updated_at?: string
          views_count?: number | null
          walkin?: boolean | null
          walkin_details?: string | null
          work_mode?: Database["public"]["Enums"]["work_mode"]
          working_days?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "jobs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_reposted_from_fkey"
            columns: ["reposted_from"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      languages_master: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      learning_resources: {
        Row: {
          category: string | null
          content_url: string
          cover_url: string | null
          created_at: string
          description: string | null
          id: string
          is_published: boolean
          kind: string
          slug: string
          title: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          content_url: string
          cover_url?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_published?: boolean
          kind?: string
          slug: string
          title: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          content_url?: string
          cover_url?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_published?: boolean
          kind?: string
          slug?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      match_scoring_config: {
        Row: {
          id: number
          updated_at: string
          weights: Json
        }
        Insert: {
          id?: number
          updated_at?: string
          weights?: Json
        }
        Update: {
          id?: number
          updated_at?: string
          weights?: Json
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          image_url: string | null
          link: string | null
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          link?: string | null
          read_at?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          image_url?: string | null
          link?: string | null
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      otp_verifications: {
        Row: {
          attempts: number
          channel: string
          created_at: string
          expires_at: string
          id: string
          metadata: Json | null
          mobile: string
          otp_hash: string
          verified: boolean
          verified_at: string | null
        }
        Insert: {
          attempts?: number
          channel?: string
          created_at?: string
          expires_at: string
          id?: string
          metadata?: Json | null
          mobile: string
          otp_hash: string
          verified?: boolean
          verified_at?: string | null
        }
        Update: {
          attempts?: number
          channel?: string
          created_at?: string
          expires_at?: string
          id?: string
          metadata?: Json | null
          mobile?: string
          otp_hash?: string
          verified?: boolean
          verified_at?: string | null
        }
        Relationships: []
      }
      plan_settings: {
        Row: {
          auto_renew_enabled: boolean
          auto_renew_max_times: number
          credits_per_unlock: number
          crm_automation_enabled: boolean
          crm_automation_rules_max: number
          custom_plan_min_amount: number
          db_rows_per_day: number
          db_searches_per_hour: number
          expiry_reminder_days: number[]
          free_plan_validity_days: number | null
          free_post_enabled: boolean
          free_response_cap: number
          free_validity_days: number
          free_whatsapp_cap_per_post: number
          free_whatsapp_per_post: number | null
          free_whatsapp_rajasthan_only: boolean
          id: number
          spam_jobs_per_hour: number
          tier_prices: Json
          unlocks_per_job: number
          updated_at: string
        }
        Insert: {
          auto_renew_enabled?: boolean
          auto_renew_max_times?: number
          credits_per_unlock?: number
          crm_automation_enabled?: boolean
          crm_automation_rules_max?: number
          custom_plan_min_amount?: number
          db_rows_per_day?: number
          db_searches_per_hour?: number
          expiry_reminder_days?: number[]
          free_plan_validity_days?: number | null
          free_post_enabled?: boolean
          free_response_cap?: number
          free_validity_days?: number
          free_whatsapp_cap_per_post?: number
          free_whatsapp_per_post?: number | null
          free_whatsapp_rajasthan_only?: boolean
          id?: number
          spam_jobs_per_hour?: number
          tier_prices?: Json
          unlocks_per_job?: number
          updated_at?: string
        }
        Update: {
          auto_renew_enabled?: boolean
          auto_renew_max_times?: number
          credits_per_unlock?: number
          crm_automation_enabled?: boolean
          crm_automation_rules_max?: number
          custom_plan_min_amount?: number
          db_rows_per_day?: number
          db_searches_per_hour?: number
          expiry_reminder_days?: number[]
          free_plan_validity_days?: number | null
          free_post_enabled?: boolean
          free_response_cap?: number
          free_validity_days?: number
          free_whatsapp_cap_per_post?: number
          free_whatsapp_per_post?: number | null
          free_whatsapp_rajasthan_only?: boolean
          id?: number
          spam_jobs_per_hour?: number
          tier_prices?: Json
          unlocks_per_job?: number
          updated_at?: string
        }
        Relationships: []
      }
      plans: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_custom: boolean
          limits: Json
          name: string
          price_inr: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_custom?: boolean
          limits?: Json
          name: string
          price_inr?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_custom?: boolean
          limits?: Json
          name?: string
          price_inr?: number
          updated_at?: string
        }
        Relationships: []
      }
      platform_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_platform_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_platform_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_platform_role"]
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          city: string | null
          created_at: string
          email: string | null
          full_name: string
          id: string
          mobile: string | null
          mobile_verified: boolean
          signup_intent: string | null
          state: string | null
          status: string
          updated_at: string
          user_type: Database["public"]["Enums"]["user_type"]
        }
        Insert: {
          avatar_url?: string | null
          city?: string | null
          created_at?: string
          email?: string | null
          full_name?: string
          id: string
          mobile?: string | null
          mobile_verified?: boolean
          signup_intent?: string | null
          state?: string | null
          status?: string
          updated_at?: string
          user_type?: Database["public"]["Enums"]["user_type"]
        }
        Update: {
          avatar_url?: string | null
          city?: string | null
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          mobile?: string | null
          mobile_verified?: boolean
          signup_intent?: string | null
          state?: string | null
          status?: string
          updated_at?: string
          user_type?: Database["public"]["Enums"]["user_type"]
        }
        Relationships: []
      }
      promo_banners: {
        Row: {
          audience: string
          created_at: string
          cta_label: string | null
          cta_url: string | null
          ends_at: string | null
          id: string
          image_url: string | null
          is_active: boolean
          sort: number
          starts_at: string | null
          subtitle: string | null
          title: string
          updated_at: string
        }
        Insert: {
          audience?: string
          created_at?: string
          cta_label?: string | null
          cta_url?: string | null
          ends_at?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          sort?: number
          starts_at?: string | null
          subtitle?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          audience?: string
          created_at?: string
          cta_label?: string | null
          cta_url?: string | null
          ends_at?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          sort?: number
          starts_at?: string | null
          subtitle?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      razorpay_orders: {
        Row: {
          amount_inr: number
          amount_paise: number | null
          benefit_type: Database["public"]["Enums"]["benefit_type"] | null
          company_id: string
          created_at: string
          created_by: string | null
          credits: number
          failure_reason: string | null
          fulfilled_via: string | null
          gst_inr: number | null
          id: string
          pack_id: string | null
          plan_id: string | null
          razorpay_order_id: string | null
          razorpay_payment_id: string | null
          status: string
          subtotal_inr: number | null
          updated_at: string
        }
        Insert: {
          amount_inr: number
          amount_paise?: number | null
          benefit_type?: Database["public"]["Enums"]["benefit_type"] | null
          company_id: string
          created_at?: string
          created_by?: string | null
          credits: number
          failure_reason?: string | null
          fulfilled_via?: string | null
          gst_inr?: number | null
          id?: string
          pack_id?: string | null
          plan_id?: string | null
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          status?: string
          subtotal_inr?: number | null
          updated_at?: string
        }
        Update: {
          amount_inr?: number
          amount_paise?: number | null
          benefit_type?: Database["public"]["Enums"]["benefit_type"] | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          credits?: number
          failure_reason?: string | null
          fulfilled_via?: string | null
          gst_inr?: number | null
          id?: string
          pack_id?: string | null
          plan_id?: string | null
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          status?: string
          subtotal_inr?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "razorpay_orders_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "razorpay_orders_pack_id_fkey"
            columns: ["pack_id"]
            isOneToOne: false
            referencedRelation: "credit_packs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "razorpay_orders_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      recommendation_settings: {
        Row: {
          boost_bonus_max: number
          boost_weight: number
          boost_window_hours: number
          cold_start_min_applications: number
          experience_weight: number
          freshness_weight: number
          id: number
          location_weight: number
          max_same_company_in_top: number
          salary_weight: number
          skill_weight: number
          trending_bonus_max: number
          trending_weight: number
          updated_at: string
        }
        Insert: {
          boost_bonus_max?: number
          boost_weight?: number
          boost_window_hours?: number
          cold_start_min_applications?: number
          experience_weight?: number
          freshness_weight?: number
          id?: number
          location_weight?: number
          max_same_company_in_top?: number
          salary_weight?: number
          skill_weight?: number
          trending_bonus_max?: number
          trending_weight?: number
          updated_at?: string
        }
        Update: {
          boost_bonus_max?: number
          boost_weight?: number
          boost_window_hours?: number
          cold_start_min_applications?: number
          experience_weight?: number
          freshness_weight?: number
          id?: number
          location_weight?: number
          max_same_company_in_top?: number
          salary_weight?: number
          skill_weight?: number
          trending_bonus_max?: number
          trending_weight?: number
          updated_at?: string
        }
        Relationships: []
      }
      resume_drafts: {
        Row: {
          extras: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          extras?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          extras?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      resume_versions: {
        Row: {
          created_at: string
          id: string
          snapshot: Json
          template_id: string
          user_id: string
          version_number: number
        }
        Insert: {
          created_at?: string
          id?: string
          snapshot: Json
          template_id: string
          user_id: string
          version_number: number
        }
        Update: {
          created_at?: string
          id?: string
          snapshot?: Json
          template_id?: string
          user_id?: string
          version_number?: number
        }
        Relationships: []
      }
      salary_bands: {
        Row: {
          category: string | null
          city: string | null
          created_at: string
          experience_bucket: string
          id: string
          is_active: boolean
          max_salary: number
          median_salary: number
          min_salary: number
          p25: number
          p75: number
          pay_type: string
          sample_count: number
          source: string
          state: string | null
          title_key: string
          updated_at: string
          valid_until: string | null
        }
        Insert: {
          category?: string | null
          city?: string | null
          created_at?: string
          experience_bucket?: string
          id?: string
          is_active?: boolean
          max_salary: number
          median_salary: number
          min_salary: number
          p25: number
          p75: number
          pay_type?: string
          sample_count?: number
          source?: string
          state?: string | null
          title_key: string
          updated_at?: string
          valid_until?: string | null
        }
        Update: {
          category?: string | null
          city?: string | null
          created_at?: string
          experience_bucket?: string
          id?: string
          is_active?: boolean
          max_salary?: number
          median_salary?: number
          min_salary?: number
          p25?: number
          p75?: number
          pay_type?: string
          sample_count?: number
          source?: string
          state?: string | null
          title_key?: string
          updated_at?: string
          valid_until?: string | null
        }
        Relationships: []
      }
      saved_jobs: {
        Row: {
          created_at: string
          id: string
          job_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          job_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          job_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_jobs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      skills_master: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          pending_review: boolean
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          pending_review?: boolean
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          pending_review?: boolean
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_content_progress: {
        Row: {
          completed_at: string | null
          content_id: string
          content_type: string
          last_accessed_at: string | null
          progress_percent: number | null
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          content_id: string
          content_type: string
          last_accessed_at?: string | null
          progress_percent?: number | null
          user_id: string
        }
        Update: {
          completed_at?: string | null
          content_id?: string
          content_type?: string
          last_accessed_at?: string | null
          progress_percent?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_content_progress_content_id_fkey"
            columns: ["content_id"]
            isOneToOne: false
            referencedRelation: "content_items"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_send_ledger: {
        Row: {
          count: number
          day: string
          user_id: string
        }
        Insert: {
          count?: number
          day: string
          user_id: string
        }
        Update: {
          count?: number
          day?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      public_candidate_view: {
        Row: {
          avatar_url: string | null
          bio: string | null
          city: string | null
          experience_status:
            | Database["public"]["Enums"]["experience_status"]
            | null
          full_name: string | null
          headline: string | null
          kyc_status: string | null
          last_role: string | null
          preferred_cities: string[] | null
          preferred_job_types: string[] | null
          profile_slug: string | null
          profile_strength: number | null
          skills: string[] | null
          user_id: string | null
          years_experience: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      accept_invite: { Args: { _token: string }; Returns: string }
      activate_company_plan: {
        Args: { _actor: string; _company_id: string; _plan_id: string }
        Returns: undefined
      }
      activate_job_with_tier: {
        Args: {
          _job_id: string
          _tier: Database["public"]["Enums"]["job_tier"]
        }
        Returns: Json
      }
      admin_grant_company_benefit: {
        Args: {
          _benefit_type: Database["public"]["Enums"]["benefit_type"]
          _company_id: string
          _quantity: number
          _reason: string
          _validity_days: number
        }
        Returns: string
      }
      admin_launch_state: { Args: { _state: string }; Returns: number }
      admin_refund_job_post_credit: {
        Args: { _job_id: string; _reason: string }
        Returns: Json
      }
      admin_set_verification: {
        Args: { _id: string; _notes: string; _status: string }
        Returns: undefined
      }
      apply_boost: { Args: { _job_id: string }; Returns: Json }
      apply_credit_delta: {
        Args: {
          _actor?: string
          _benefit_type?: Database["public"]["Enums"]["benefit_type"]
          _company_id: string
          _delta: number
          _kind: Database["public"]["Enums"]["credit_txn_kind"]
          _reference?: Json
        }
        Returns: number
      }
      attach_zoom_meeting_secrets: {
        Args: {
          _interview_id: string
          _zoom_host_user_id: string
          _zoom_join_url?: string
          _zoom_meeting_id: string
          _zoom_meeting_uuid: string
          _zoom_password: string
          _zoom_start_url?: string
        }
        Returns: undefined
      }
      benefit_reconciliation_report: {
        Args: never
        Returns: {
          benefit_type: Database["public"]["Enums"]["benefit_type"]
          company_id: string
          drift: number
          grants_remaining: number
          wallet_balance: number
        }[]
      }
      buyer_gst_state_code: {
        Args: { _gstin: string; _pincode: string }
        Returns: string
      }
      can_access_job_responses: { Args: { _job_id: string }; Returns: boolean }
      cancel_employer_invite: {
        Args: { _company_id: string; _invite_id: string }
        Returns: undefined
      }
      cancel_video_interview: {
        Args: { _actor?: string; _interview_id: string; _reason?: string }
        Returns: {
          application_id: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          candidate_id: string
          company_id: string
          created_at: string
          created_by: string | null
          duration_min: number
          host_user_id: string | null
          id: string
          job_id: string | null
          location: string | null
          meeting_url: string | null
          mode: Database["public"]["Enums"]["interview_mode"]
          notes: string | null
          provider: Database["public"]["Enums"]["interview_provider"]
          reminder_email_sent_at: string | null
          scheduled_at: string
          scheduled_email_sent_at: string | null
          status: Database["public"]["Enums"]["interview_status"]
          timezone: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "interviews"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_due_crm_tasks: { Args: never; Returns: Json }
      claim_due_expiry_reminders: { Args: never; Returns: Json }
      claim_due_purge_reminders: { Args: never; Returns: Json }
      cleanup_expired_otps: { Args: never; Returns: number }
      company_auto_renew: {
        Args: { _company_id: string }
        Returns: {
          enabled: boolean
          max_times: number
        }[]
      }
      company_benefit_balances: {
        Args: { _company_id: string }
        Returns: {
          benefit_type: Database["public"]["Enums"]["benefit_type"]
          nearest_expiry: string
          remaining: number
        }[]
      }
      company_crm_entitlement: {
        Args: { _company_id: string }
        Returns: {
          automation_enabled: boolean
          rules_max: number
        }[]
      }
      compute_candidate_match: {
        Args: {
          _candidate_user_id: string
          _job_id: string
          _with_bonuses?: boolean
        }
        Returns: Json
      }
      compute_job_quality: {
        Args: { j: Database["public"]["Tables"]["jobs"]["Row"] }
        Returns: number
      }
      consume_company_benefit: {
        Args: {
          _actor?: string
          _benefit_type: Database["public"]["Enums"]["benefit_type"]
          _company_id: string
          _quantity: number
          _reference?: Json
          _resource_key?: string
        }
        Returns: number
      }
      consume_interview_prep_quota: {
        Args: { _kind: string }
        Returns: undefined
      }
      create_certification_order: {
        Args: { _actor: string; _certification_id: string }
        Returns: Json
      }
      create_company_with_owner: {
        Args: {
          _about: string
          _founded_year: number
          _gst: string
          _hq_city: string
          _industry: string
          _name: string
          _size: Database["public"]["Enums"]["company_size"]
          _website: string
        }
        Returns: string
      }
      create_course_order: {
        Args: { _actor: string; _course_id: string }
        Returns: Json
      }
      create_credit_pack_order: {
        Args: { _actor: string; _company_id: string; _pack_id: string }
        Returns: Json
      }
      create_plan_order: {
        Args: { _actor: string; _company_id: string; _plan_id: string }
        Returns: Json
      }
      crm_admin_update_settings: {
        Args: { _outcome_hours: Json; _weights: Json }
        Returns: undefined
      }
      crm_ensure_default_rules: {
        Args: { _actor?: string; _company_id: string }
        Returns: number
      }
      crm_log_call: {
        Args: {
          _actor?: string
          _application_id?: string
          _candidate_id: string
          _company_id: string
          _duration_sec?: number
          _follow_up_at?: string
          _job_id?: string
          _notes?: string
          _outcome: Database["public"]["Enums"]["call_outcome"]
        }
        Returns: Json
      }
      crm_rule_candidates: {
        Args: {
          _company_id: string
          _conditions: Json
          _limit: number
          _trigger: Database["public"]["Enums"]["crm_trigger"]
        }
        Returns: {
          application_id: string
          candidate_id: string
          trigger_key: string
        }[]
      }
      crm_save_rule: {
        Args: {
          _action: Database["public"]["Enums"]["crm_action"]
          _action_payload?: Json
          _actor?: string
          _company_id: string
          _conditions?: Json
          _cooldown_hours?: number
          _enabled: boolean
          _max_fires_per_lead?: number
          _name: string
          _rule_id?: string
          _trigger: Database["public"]["Enums"]["crm_trigger"]
        }
        Returns: string
      }
      crm_save_task: {
        Args: {
          _actor?: string
          _application_id?: string
          _assignee_id?: string
          _body?: string
          _candidate_id: string
          _company_id: string
          _due_at: string
          _job_id?: string
          _priority?: number
          _task_id?: string
          _title: string
        }
        Returns: string
      }
      crm_set_task_status: {
        Args: {
          _actor?: string
          _new_due_at?: string
          _status: Database["public"]["Enums"]["followup_task_status"]
          _task_id: string
        }
        Returns: undefined
      }
      crm_tick_automation: { Args: { _batch?: number }; Returns: Json }
      current_financial_year: { Args: never; Returns: string }
      dismiss_recommended_candidate: {
        Args: { _candidate_user_id: string; _job_id: string }
        Returns: undefined
      }
      expire_benefit_grants: { Args: never; Returns: number }
      feed_jobs: {
        Args: {
          _category?: string
          _city?: string
          _company?: string
          _education?: string
          _english_level?: string
          _job_type?: string
          _limit?: number
          _max_exp?: number
          _max_salary?: number
          _min_exp?: number
          _min_salary?: number
          _offset?: number
          _posted_after?: string
          _q?: string
          _shift?: string
          _vehicle?: boolean
          _verified_only?: boolean
          _work_mode?: string
        }
        Returns: {
          avg_incentive_monthly: number
          boosted: boolean
          city: string
          company_id: string
          company_is_verified: boolean
          company_name: string
          created_at: string
          education: string
          id: string
          job_type: string
          locality: string
          max_experience_years: number
          max_salary: number
          min_experience_years: number
          min_salary: number
          pay_type: string
          salary_period: string
          score: number
          skills: string[]
          state: string
          title: string
          total_count: number
          work_mode: string
        }[]
      }
      feed_jobs_for_candidate: {
        Args: {
          _category?: string
          _city?: string
          _company?: string
          _education?: string
          _english_level?: string
          _job_type?: string
          _limit?: number
          _max_exp?: number
          _max_salary?: number
          _min_exp?: number
          _min_salary?: number
          _offset?: number
          _posted_after?: string
          _q?: string
          _shift?: string
          _sort?: string
          _vehicle?: boolean
          _verified_only?: boolean
          _work_mode?: string
        }
        Returns: {
          avg_incentive_monthly: number
          boosted: boolean
          city: string
          company_id: string
          company_is_verified: boolean
          company_name: string
          created_at: string
          education: string
          id: string
          job_type: string
          locality: string
          match_score: number
          matched_skills: number
          max_experience_years: number
          max_salary: number
          min_experience_years: number
          min_salary: number
          pay_type: string
          salary_period: string
          score: number
          skills: string[]
          state: string
          title: string
          total_count: number
          total_required_skills: number
          work_mode: string
        }[]
      }
      find_auth_user_by_phone_or_email: {
        Args: { _email: string; _phone: string }
        Returns: {
          email: string
          id: string
          phone: string
        }[]
      }
      fulfil_candidate_order: {
        Args: {
          _actor: string
          _amount_paise: number
          _razorpay_order_id: string
          _razorpay_payment_id: string
          _via: string
        }
        Returns: Json
      }
      fulfill_razorpay_order: {
        Args: {
          _actor: string
          _amount_paise: number
          _razorpay_order_id: string
          _razorpay_payment_id: string
          _via: string
        }
        Returns: Json
      }
      get_certification_exam: {
        Args: { _certification_id: string }
        Returns: Json
      }
      get_company_entitlements: { Args: { _company_id: string }; Returns: Json }
      get_company_private: {
        Args: { _company_id: string }
        Returns: {
          gst_number: string
          pan_number: string
          spam_suspected: boolean
          verification_notes: string
        }[]
      }
      get_crm_leads: {
        Args: {
          _company_id: string
          _contacted?: boolean
          _job_id?: string
          _limit?: number
          _offset?: number
          _source?: string
          _stage?: string
        }
        Returns: {
          application_id: string
          applied_at: string
          avatar_url: string
          candidate_id: string
          city: string
          contacted: boolean
          full_name: string
          headline: string
          job_id: string
          job_title: string
          last_call_at: string
          last_outcome: string
          next_follow_up_at: string
          open_tasks: number
          source: string
          stage: string
          total_count: number
          unlocked_at: string
        }[]
      }
      get_crm_next_best_actions: {
        Args: { _company_id: string; _limit?: number }
        Returns: {
          application_id: string
          candidate_id: string
          job_id: string
          kind: string
          link: string
          reason: string
          score: number
        }[]
      }
      get_invite_by_token: {
        Args: { _token: string }
        Returns: {
          accepted_at: string
          company_id: string
          company_name: string
          email: string
          expires_at: string
          id: string
          role: Database["public"]["Enums"]["employer_role"]
        }[]
      }
      get_lesson_content: { Args: { _lesson_id: string }; Returns: Json }
      get_public_candidate: {
        Args: { _slug: string }
        Returns: {
          avatar_url: string
          bio: string
          city: string
          experience_status: string
          full_name: string
          headline: string
          kyc_status: string
          last_role: string
          preferred_cities: string[]
          preferred_job_types: string[]
          profile_slug: string
          profile_strength: number
          skills: string[]
          user_id: string
          years_experience: number
        }[]
      }
      get_public_company: {
        Args: { _slug: string }
        Returns: {
          about: string
          cover_url: string
          founded_year: number
          hq_city: string
          id: string
          industry: string
          logo_url: string
          name: string
          size: Database["public"]["Enums"]["company_size"]
          slug: string
          social_links: Json
          verification_status: string
          website: string
        }[]
      }
      get_ranked_job_applicants: {
        Args: { _job_id: string; _sort_by?: string; _status?: string }
        Returns: {
          application_id: string
          candidate_id: string
          city: string
          created_at: string
          full_name: string
          headline: string
          last_role: string
          match_breakdown: Json
          match_score: number
          skills: string[]
          status: string
          tags: string[]
          years_experience: number
        }[]
      }
      get_recommended_candidates_digest: {
        Args: { _company_id: string }
        Returns: {
          active_count: number
          hot_count: number
          nearby_count: number
          top_job_id: string
          top_job_matches: number
          top_job_title: string
          total_matches: number
        }[]
      }
      get_recommended_candidates_for_job: {
        Args: {
          _filter?: string
          _job_id: string
          _limit?: number
          _min_score?: number
          _offset?: number
        }
        Returns: {
          avatar_url: string
          city: string
          full_name: string
          headline: string
          is_unlocked: boolean
          last_role: string
          match_breakdown: Json
          match_score: number
          preferred_cities: string[]
          preferred_work_mode: string
          profile_slug: string
          skills: string[]
          tags: string[]
          total_count: number
          user_id: string
          years_experience: number
        }[]
      }
      get_salary_suggestion: {
        Args: {
          _category?: string
          _city?: string
          _experience_bucket?: string
          _pay_type?: string
          _title: string
        }
        Returns: Json
      }
      get_unlocked_candidate_contact: {
        Args: { _candidate_user_id: string; _company_id: string }
        Returns: {
          email: string
          mobile: string
        }[]
      }
      grant_company_benefit:
        | {
            Args: {
              _actor?: string
              _benefit_type: Database["public"]["Enums"]["benefit_type"]
              _company_id: string
              _quantity: number
              _reference?: Json
              _source?: string
              _validity_days?: number
            }
            Returns: string
          }
        | {
            Args: {
              _actor?: string
              _benefit_type: Database["public"]["Enums"]["benefit_type"]
              _company_id: string
              _event?: string
              _quantity: number
              _reference?: Json
              _source?: string
              _validity_days?: number
            }
            Returns: string
          }
      gst_state_name: { Args: { _code: string }; Returns: string }
      has_company_membership: {
        Args: { _company_id: string; _user_id: string }
        Returns: boolean
      }
      has_company_role: {
        Args: {
          _company_id: string
          _role: Database["public"]["Enums"]["employer_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_platform_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_platform_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_profile_views: { Args: { _slug: string }; Returns: undefined }
      invite_candidate_to_apply: {
        Args: { _candidate_user_id: string; _job_id: string; _message?: string }
        Returns: undefined
      }
      issue_credit_pack_invoice: {
        Args: { _order_id: string; _razorpay_payment_id: string }
        Returns: string
      }
      issue_plan_invoice: {
        Args: { _order_id: string; _razorpay_payment_id: string }
        Returns: string
      }
      log_contact_viewed: {
        Args: {
          _actor: string
          _candidate_user_id: string
          _company_id: string
          _job_id: string
        }
        Returns: undefined
      }
      log_employer_activity: {
        Args: {
          _actor: string
          _body?: string
          _company_id: string
          _kind: string
          _link?: string
          _metadata?: Json
          _title: string
        }
        Returns: undefined
      }
      log_salary_event: {
        Args: { _company_id: string; _kind: string; _meta?: Json }
        Returns: undefined
      }
      mark_application_viewed: {
        Args: { _application_id: string }
        Returns: undefined
      }
      mark_candidate_order_failed: {
        Args: { _razorpay_order_id: string; _razorpay_payment_id: string }
        Returns: undefined
      }
      mark_razorpay_order_failed: {
        Args: {
          _razorpay_order_id: string
          _razorpay_payment_id: string
          _reason: string
        }
        Returns: undefined
      }
      next_invoice_number: { Args: never; Returns: string }
      normalize_candidate_skills: {
        Args: { _skills: string[] }
        Returns: string[]
      }
      normalize_phone_e164: { Args: { _phone: string }; Returns: string }
      process_job_expiry_batch: { Args: never; Returns: Json }
      purge_expired_responses: { Args: never; Returns: Json }
      reactivate_member: {
        Args: {
          _company_id: string
          _role?: Database["public"]["Enums"]["employer_role"]
          _user_id: string
        }
        Returns: undefined
      }
      recommend_jobs_for_candidate: {
        Args: {
          _category?: string
          _city?: string
          _company?: string
          _education?: string
          _english_level?: string
          _job_type?: string
          _limit?: number
          _max_exp?: number
          _max_salary?: number
          _min_exp?: number
          _min_salary?: number
          _offset?: number
          _posted_after?: string
          _q?: string
          _shift?: string
          _vehicle?: boolean
          _verified_only?: boolean
          _work_mode?: string
        }
        Returns: {
          avg_incentive_monthly: number
          boosted: boolean
          city: string
          company_id: string
          company_is_verified: boolean
          company_name: string
          created_at: string
          education: string
          id: string
          job_type: string
          locality: string
          max_experience_years: number
          max_salary: number
          min_experience_years: number
          min_salary: number
          pay_type: string
          salary_period: string
          score: number
          score_breakdown: Json
          skills: string[]
          state: string
          title: string
          total_count: number
          work_mode: string
        }[]
      }
      refresh_computed_salary_bands: { Args: never; Returns: number }
      register_download: {
        Args: { _company_id: string; _count: number; _kind: string }
        Returns: number
      }
      register_whatsapp_send: { Args: { _count: number }; Returns: number }
      remove_member: {
        Args: { _company_id: string; _user_id: string }
        Returns: undefined
      }
      renew_job: { Args: { _job_id: string }; Returns: Json }
      reschedule_video_interview: {
        Args: {
          _actor?: string
          _interview_id: string
          _new_duration_min?: number
          _new_scheduled_at: string
          _notes?: string
        }
        Returns: {
          application_id: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          candidate_id: string
          company_id: string
          created_at: string
          created_by: string | null
          duration_min: number
          host_user_id: string | null
          id: string
          job_id: string | null
          location: string | null
          meeting_url: string | null
          mode: Database["public"]["Enums"]["interview_mode"]
          notes: string | null
          provider: Database["public"]["Enums"]["interview_provider"]
          reminder_email_sent_at: string | null
          scheduled_at: string
          scheduled_email_sent_at: string | null
          status: Database["public"]["Enums"]["interview_status"]
          timezone: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "interviews"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resend_employer_invite: {
        Args: { _company_id: string; _invite_id: string }
        Returns: Json
      }
      reserve_video_interview_slot: {
        Args: {
          _actor?: string
          _application_id: string
          _duration_min: number
          _host_user_id?: string
          _location?: string
          _meeting_url?: string
          _mode: Database["public"]["Enums"]["interview_mode"]
          _notes?: string
          _provider: Database["public"]["Enums"]["interview_provider"]
          _scheduled_at: string
        }
        Returns: {
          application_id: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          candidate_id: string
          company_id: string
          created_at: string
          created_by: string | null
          duration_min: number
          host_user_id: string | null
          id: string
          job_id: string | null
          location: string | null
          meeting_url: string | null
          mode: Database["public"]["Enums"]["interview_mode"]
          notes: string | null
          provider: Database["public"]["Enums"]["interview_provider"]
          reminder_email_sent_at: string | null
          scheduled_at: string
          scheduled_email_sent_at: string | null
          status: Database["public"]["Enums"]["interview_status"]
          timezone: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "interviews"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resolve_company_plan_limit: {
        Args: { _company_id: string; _fallback?: number; _key: string }
        Returns: number
      }
      run_benefit_reconciliation_check: { Args: never; Returns: number }
      search_candidates_for_company: {
        Args: {
          _cities?: string[]
          _company_id: string
          _job_id: string
          _limit?: number
          _min_experience?: number
          _offset?: number
          _query?: string
          _sort_by?: string
        }
        Returns: {
          avatar_url: string
          city: string
          full_name: string
          headline: string
          last_role: string
          match_breakdown: Json
          match_score: number
          preferred_cities: string[]
          preferred_work_mode: string
          profile_slug: string
          skills: string[]
          tags: string[]
          total_count: number
          user_id: string
          years_experience: number
        }[]
      }
      send_interview_prep_reminders: { Args: never; Returns: number }
      set_job_auto_renew: {
        Args: { _enabled: boolean; _job_id: string }
        Returns: undefined
      }
      slugify: { Args: { _text: string }; Returns: string }
      start_interview_prep_session: {
        Args: {
          _categories?: string[]
          _context_type: string
          _interview_id?: string
          _job_id?: string
          _language?: string
          _question_count?: number
          _role_title?: string
        }
        Returns: string
      }
      submit_certification_exam: {
        Args: { _answers: Json; _certification_id: string }
        Returns: Json
      }
      suggest_skills_for_roles: {
        Args: { _roles: string[] }
        Returns: {
          name: string
          uses: number
        }[]
      }
      switch_company_plan_to_basic: {
        Args: { _actor: string; _company_id: string }
        Returns: undefined
      }
      unlock_candidate: {
        Args: {
          _actor?: string
          _candidate_user_id: string
          _company_id: string
          _job_id: string
        }
        Returns: {
          allowance_left: number
          already_unlocked: boolean
          balance_after: number
          source: string
        }[]
      }
      update_application_status: {
        Args: {
          _application_ids: string[]
          _status: Database["public"]["Enums"]["application_status"]
        }
        Returns: undefined
      }
      update_member_role: {
        Args: {
          _company_id: string
          _role: Database["public"]["Enums"]["employer_role"]
          _user_id: string
        }
        Returns: undefined
      }
      user_companies: { Args: { _user_id: string }; Returns: string[] }
    }
    Enums: {
      app_platform_role: "super_admin"
      application_status:
        | "applied"
        | "shortlisted"
        | "interview"
        | "hired"
        | "rejected"
        | "withdrawn"
      benefit_type: "job_post" | "contact" | "boost"
      call_outcome:
        | "connected_interested"
        | "connected_neutral"
        | "connected_not_interested"
        | "no_answer"
        | "switched_off"
        | "wrong_number"
      company_size: "1-10" | "11-50" | "51-200" | "201-500" | "500+"
      company_type:
        | "proprietorship"
        | "pvt_ltd"
        | "llp"
        | "public_ltd"
        | "ngo"
        | "government"
      credit_txn_kind:
        | "purchase"
        | "unlock"
        | "refund"
        | "bonus"
        | "adjustment"
        | "grant"
        | "boost"
        | "job_post"
        | "repost"
      crm_action: "create_task" | "notify" | "move_stage"
      crm_trigger:
        | "application_uncontacted_h"
        | "call_no_answer"
        | "stage_stalled_h"
        | "task_overdue_h"
        | "unlock_unused_h"
      employer_role: "super_admin" | "hr_admin" | "recruiter"
      experience_status: "fresher" | "experienced" | "student"
      followup_task_status: "open" | "done" | "snoozed" | "cancelled"
      interview_mode: "video" | "phone" | "onsite"
      interview_provider: "jobskart_zoom" | "external_link"
      interview_status:
        | "scheduled"
        | "confirmed"
        | "rescheduled"
        | "cancelled"
        | "completed"
      job_shift: "day" | "night" | "rotational" | "flexible"
      job_status: "draft" | "active" | "paused" | "closed" | "expired"
      job_tier: "classic" | "classic_plus" | "trending"
      job_type:
        | "full_time"
        | "part_time"
        | "contract"
        | "internship"
        | "temporary"
      kyc_method: "gst" | "email" | "manual"
      kyc_status: "pending" | "verified" | "rejected"
      user_type: "candidate" | "employer"
      work_mode: "onsite" | "remote" | "hybrid" | "field"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_platform_role: ["super_admin"],
      application_status: [
        "applied",
        "shortlisted",
        "interview",
        "hired",
        "rejected",
        "withdrawn",
      ],
      benefit_type: ["job_post", "contact", "boost"],
      call_outcome: [
        "connected_interested",
        "connected_neutral",
        "connected_not_interested",
        "no_answer",
        "switched_off",
        "wrong_number",
      ],
      company_size: ["1-10", "11-50", "51-200", "201-500", "500+"],
      company_type: [
        "proprietorship",
        "pvt_ltd",
        "llp",
        "public_ltd",
        "ngo",
        "government",
      ],
      credit_txn_kind: [
        "purchase",
        "unlock",
        "refund",
        "bonus",
        "adjustment",
        "grant",
        "boost",
        "job_post",
        "repost",
      ],
      crm_action: ["create_task", "notify", "move_stage"],
      crm_trigger: [
        "application_uncontacted_h",
        "call_no_answer",
        "stage_stalled_h",
        "task_overdue_h",
        "unlock_unused_h",
      ],
      employer_role: ["super_admin", "hr_admin", "recruiter"],
      experience_status: ["fresher", "experienced", "student"],
      followup_task_status: ["open", "done", "snoozed", "cancelled"],
      interview_mode: ["video", "phone", "onsite"],
      interview_provider: ["jobskart_zoom", "external_link"],
      interview_status: [
        "scheduled",
        "confirmed",
        "rescheduled",
        "cancelled",
        "completed",
      ],
      job_shift: ["day", "night", "rotational", "flexible"],
      job_status: ["draft", "active", "paused", "closed", "expired"],
      job_tier: ["classic", "classic_plus", "trending"],
      job_type: [
        "full_time",
        "part_time",
        "contract",
        "internship",
        "temporary",
      ],
      kyc_method: ["gst", "email", "manual"],
      kyc_status: ["pending", "verified", "rejected"],
      user_type: ["candidate", "employer"],
      work_mode: ["onsite", "remote", "hybrid", "field"],
    },
  },
} as const
