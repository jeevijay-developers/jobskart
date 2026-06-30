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
          updated_at?: string
          user_id?: string
          year_of_passing?: number | null
        }
        Relationships: []
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
          start_date?: string | null
          updated_at?: string
          user_id?: string
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
      candidate_profiles: {
        Row: {
          assets: string[]
          bio: string | null
          created_at: string
          current_salary: number | null
          date_of_birth: string | null
          expected_salary: number | null
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
          unlocked_by: string | null
        }
        Insert: {
          candidate_user_id: string
          company_id: string
          created_at?: string
          credits_spent?: number
          id?: string
          unlocked_by?: string | null
        }
        Update: {
          candidate_user_id?: string
          company_id?: string
          created_at?: string
          credits_spent?: number
          id?: string
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
        ]
      }
      cities: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          slug: string
          state: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          slug: string
          state?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
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
          updated_at: string
          verification_notes: string | null
          verification_status: string
          website: string | null
        }
        Insert: {
          about?: string | null
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
          updated_at?: string
          verification_notes?: string | null
          verification_status?: string
          website?: string | null
        }
        Update: {
          about?: string | null
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
          updated_at?: string
          verification_notes?: string | null
          verification_status?: string
          website?: string | null
        }
        Relationships: []
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
      credit_packs: {
        Row: {
          active: boolean
          badge: string | null
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
          balance: number
          company_id: string
          updated_at: string
        }
        Insert: {
          balance?: number
          company_id: string
          updated_at?: string
        }
        Update: {
          balance?: number
          company_id?: string
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
          role: Database["public"]["Enums"]["employer_role"]
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["employer_role"]
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["employer_role"]
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
      jobs: {
        Row: {
          age_max: number | null
          age_min: number | null
          applications_count: number | null
          boosted_until: string | null
          category: string | null
          city: string | null
          company_id: string
          contact_pref: string | null
          created_at: string
          description: string
          education: string | null
          english_level: string | null
          expires_at: string | null
          fixed_pay: boolean | null
          gender_pref: string | null
          id: string
          incentives_text: string | null
          is_featured: boolean
          job_type: Database["public"]["Enums"]["job_type"]
          locality: string | null
          max_experience_years: number | null
          max_salary: number | null
          min_experience_years: number | null
          min_salary: number | null
          openings: number | null
          perks: string[] | null
          pincode: string | null
          posted_by: string | null
          quality_score: number | null
          role_type: string | null
          salary_period: string | null
          screening_questions: Json
          shift: Database["public"]["Enums"]["job_shift"] | null
          skills: string[] | null
          slug: string | null
          state: string | null
          status: Database["public"]["Enums"]["job_status"]
          title: string
          updated_at: string
          views_count: number | null
          walkin: boolean | null
          walkin_details: string | null
          work_mode: Database["public"]["Enums"]["work_mode"]
        }
        Insert: {
          age_max?: number | null
          age_min?: number | null
          applications_count?: number | null
          boosted_until?: string | null
          category?: string | null
          city?: string | null
          company_id: string
          contact_pref?: string | null
          created_at?: string
          description?: string
          education?: string | null
          english_level?: string | null
          expires_at?: string | null
          fixed_pay?: boolean | null
          gender_pref?: string | null
          id?: string
          incentives_text?: string | null
          is_featured?: boolean
          job_type?: Database["public"]["Enums"]["job_type"]
          locality?: string | null
          max_experience_years?: number | null
          max_salary?: number | null
          min_experience_years?: number | null
          min_salary?: number | null
          openings?: number | null
          perks?: string[] | null
          pincode?: string | null
          posted_by?: string | null
          quality_score?: number | null
          role_type?: string | null
          salary_period?: string | null
          screening_questions?: Json
          shift?: Database["public"]["Enums"]["job_shift"] | null
          skills?: string[] | null
          slug?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          title: string
          updated_at?: string
          views_count?: number | null
          walkin?: boolean | null
          walkin_details?: string | null
          work_mode?: Database["public"]["Enums"]["work_mode"]
        }
        Update: {
          age_max?: number | null
          age_min?: number | null
          applications_count?: number | null
          boosted_until?: string | null
          category?: string | null
          city?: string | null
          company_id?: string
          contact_pref?: string | null
          created_at?: string
          description?: string
          education?: string | null
          english_level?: string | null
          expires_at?: string | null
          fixed_pay?: boolean | null
          gender_pref?: string | null
          id?: string
          incentives_text?: string | null
          is_featured?: boolean
          job_type?: Database["public"]["Enums"]["job_type"]
          locality?: string | null
          max_experience_years?: number | null
          max_salary?: number | null
          min_experience_years?: number | null
          min_salary?: number | null
          openings?: number | null
          perks?: string[] | null
          pincode?: string | null
          posted_by?: string | null
          quality_score?: number | null
          role_type?: string | null
          salary_period?: string | null
          screening_questions?: Json
          shift?: Database["public"]["Enums"]["job_shift"] | null
          skills?: string[] | null
          slug?: string | null
          state?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          title?: string
          updated_at?: string
          views_count?: number | null
          walkin?: boolean | null
          walkin_details?: string | null
          work_mode?: Database["public"]["Enums"]["work_mode"]
        }
        Relationships: [
          {
            foreignKeyName: "jobs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
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
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
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
          link?: string | null
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
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
          company_id: string
          created_at: string
          created_by: string | null
          credits: number
          id: string
          pack_id: string
          razorpay_order_id: string | null
          razorpay_payment_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount_inr: number
          company_id: string
          created_at?: string
          created_by?: string | null
          credits: number
          id?: string
          pack_id: string
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount_inr?: number
          company_id?: string
          created_at?: string
          created_by?: string | null
          credits?: number
          id?: string
          pack_id?: string
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          status?: string
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
        ]
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
      apply_credit_delta: {
        Args: {
          _actor?: string
          _company_id: string
          _delta: number
          _kind: Database["public"]["Enums"]["credit_txn_kind"]
          _reference?: Json
        }
        Returns: number
      }
      find_auth_user_by_phone_or_email: {
        Args: { _email: string; _phone: string }
        Returns: {
          email: string
          id: string
          phone: string
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
      remove_member: {
        Args: { _company_id: string; _user_id: string }
        Returns: undefined
      }
      slugify: { Args: { _text: string }; Returns: string }
      unlock_candidate: {
        Args: {
          _actor?: string
          _candidate_user_id: string
          _company_id: string
        }
        Returns: {
          already_unlocked: boolean
          balance_after: number
        }[]
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
      company_size: "1-10" | "11-50" | "51-200" | "201-500" | "500+"
      company_type:
        | "proprietorship"
        | "pvt_ltd"
        | "llp"
        | "public_ltd"
        | "ngo"
        | "government"
      credit_txn_kind: "purchase" | "unlock" | "refund" | "bonus" | "adjustment"
      employer_role: "super_admin" | "hr_admin" | "recruiter"
      experience_status: "fresher" | "experienced" | "student"
      job_shift: "day" | "night" | "rotational" | "flexible"
      job_status: "draft" | "active" | "paused" | "closed" | "expired"
      job_type:
        | "full_time"
        | "part_time"
        | "contract"
        | "internship"
        | "temporary"
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
      app_platform_role: ["super_admin"],
      application_status: [
        "applied",
        "shortlisted",
        "interview",
        "hired",
        "rejected",
        "withdrawn",
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
      credit_txn_kind: ["purchase", "unlock", "refund", "bonus", "adjustment"],
      employer_role: ["super_admin", "hr_admin", "recruiter"],
      experience_status: ["fresher", "experienced", "student"],
      job_shift: ["day", "night", "rotational", "flexible"],
      job_status: ["draft", "active", "paused", "closed", "expired"],
      job_type: [
        "full_time",
        "part_time",
        "contract",
        "internship",
        "temporary",
      ],
      user_type: ["candidate", "employer"],
      work_mode: ["onsite", "remote", "hybrid", "field"],
    },
  },
} as const
