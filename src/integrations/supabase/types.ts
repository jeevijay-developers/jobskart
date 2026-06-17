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
          years_experience?: number
        }
        Relationships: []
      }
      companies: {
        Row: {
          company_type: Database["public"]["Enums"]["company_type"] | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          industry: string | null
          is_verified: boolean
          logo_url: string | null
          name: string
          pincode: string | null
          primary_city: string | null
          size: Database["public"]["Enums"]["company_size"] | null
          updated_at: string
          website: string | null
        }
        Insert: {
          company_type?: Database["public"]["Enums"]["company_type"] | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          industry?: string | null
          is_verified?: boolean
          logo_url?: string | null
          name: string
          pincode?: string | null
          primary_city?: string | null
          size?: Database["public"]["Enums"]["company_size"] | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          company_type?: Database["public"]["Enums"]["company_type"] | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          industry?: string | null
          is_verified?: boolean
          logo_url?: string | null
          name?: string
          pincode?: string | null
          primary_city?: string | null
          size?: Database["public"]["Enums"]["company_size"] | null
          updated_at?: string
          website?: string | null
        }
        Relationships: []
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
          shift: Database["public"]["Enums"]["job_shift"] | null
          skills: string[] | null
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
          shift?: Database["public"]["Enums"]["job_shift"] | null
          skills?: string[] | null
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
          shift?: Database["public"]["Enums"]["job_shift"] | null
          skills?: string[] | null
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
      profiles: {
        Row: {
          avatar_url: string | null
          city: string | null
          created_at: string
          email: string | null
          full_name: string
          id: string
          mobile: string | null
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
          updated_at?: string
          user_type?: Database["public"]["Enums"]["user_type"]
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
      user_companies: { Args: { _user_id: string }; Returns: string[] }
    }
    Enums: {
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
