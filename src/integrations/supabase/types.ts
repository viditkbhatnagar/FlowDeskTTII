export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
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
      departments: {
        Row: {
          code: string | null
          created_at: string
          description: string | null
          head_user_id: string | null
          id: string
          name: string
          organization_id: string
          status: Database["public"]["Enums"]["organization_status"]
          updated_at: string
        }
        Insert: {
          code?: string | null
          created_at?: string
          description?: string | null
          head_user_id?: string | null
          id?: string
          name: string
          organization_id: string
          status?: Database["public"]["Enums"]["organization_status"]
          updated_at?: string
        }
        Update: {
          code?: string | null
          created_at?: string
          description?: string | null
          head_user_id?: string | null
          id?: string
          name?: string
          organization_id?: string
          status?: Database["public"]["Enums"]["organization_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "departments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_memberships: {
        Row: {
          created_at: string
          department_id: string | null
          designation: string | null
          id: string
          is_primary: boolean
          organization_id: string
          reporting_manager_id: string | null
          role_id: string | null
          status: Database["public"]["Enums"]["organization_status"]
          team_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          department_id?: string | null
          designation?: string | null
          id?: string
          is_primary?: boolean
          organization_id: string
          reporting_manager_id?: string | null
          role_id?: string | null
          status?: Database["public"]["Enums"]["organization_status"]
          team_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          department_id?: string | null
          designation?: string | null
          id?: string
          is_primary?: boolean
          organization_id?: string
          reporting_manager_id?: string | null
          role_id?: string | null
          status?: Database["public"]["Enums"]["organization_status"]
          team_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_memberships_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_memberships_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_memberships_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          code: string
          country: string
          created_at: string
          id: string
          logo_url: string | null
          name: string
          official_email: string | null
          phone: string | null
          status: Database["public"]["Enums"]["organization_status"]
          timezone: string
          updated_at: string
          website: string | null
        }
        Insert: {
          code: string
          country: string
          created_at?: string
          id?: string
          logo_url?: string | null
          name: string
          official_email?: string | null
          phone?: string | null
          status?: Database["public"]["Enums"]["organization_status"]
          timezone: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          code?: string
          country?: string
          created_at?: string
          id?: string
          logo_url?: string | null
          name?: string
          official_email?: string | null
          phone?: string | null
          status?: Database["public"]["Enums"]["organization_status"]
          timezone?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          employee_id: string | null
          full_name: string | null
          id: string
          joining_date: string | null
          phone: string | null
          role: string | null
          status: Database["public"]["Enums"]["organization_status"]
          updated_at: string
          user_id: string
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          employee_id?: string | null
          full_name?: string | null
          id?: string
          joining_date?: string | null
          phone?: string | null
          role?: string | null
          status?: Database["public"]["Enums"]["organization_status"]
          updated_at?: string
          user_id: string
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          employee_id?: string | null
          full_name?: string | null
          id?: string
          joining_date?: string | null
          phone?: string | null
          role?: string | null
          status?: Database["public"]["Enums"]["organization_status"]
          updated_at?: string
          user_id?: string
          username?: string | null
        }
        Relationships: []
      }
      project_categories: {
        Row: {
          color: string | null
          created_at: string
          description: string | null
          id: string
          name: string
          organization_id: string
          sort_order: number
          status: Database["public"]["Enums"]["organization_status"]
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          organization_id: string
          sort_order?: number
          status?: Database["public"]["Enums"]["organization_status"]
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
          sort_order?: number
          status?: Database["public"]["Enums"]["organization_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      project_members: {
        Row: {
          created_at: string
          id: string
          project_id: string
          role_label: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          project_id: string
          role_label?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string
          role_label?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "work_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_milestones: {
        Row: {
          completed_at: string | null
          created_at: string
          due_at: string | null
          due_date: string | null
          id: string
          organization_id: string
          owner_id: string | null
          project_id: string
          title: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          due_at?: string | null
          due_date?: string | null
          id?: string
          organization_id: string
          owner_id?: string | null
          project_id: string
          title: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          due_at?: string | null
          due_date?: string | null
          id?: string
          organization_id?: string
          owner_id?: string | null
          project_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_milestones_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_milestones_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "work_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_status_settings: {
        Row: {
          color: string | null
          created_at: string
          id: string
          label: string
          organization_id: string
          sort_order: number
          status: Database["public"]["Enums"]["organization_status"]
          updated_at: string
          value: Database["public"]["Enums"]["project_lifecycle_status"]
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          label: string
          organization_id: string
          sort_order?: number
          status?: Database["public"]["Enums"]["organization_status"]
          updated_at?: string
          value: Database["public"]["Enums"]["project_lifecycle_status"]
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          label?: string
          organization_id?: string
          sort_order?: number
          status?: Database["public"]["Enums"]["organization_status"]
          updated_at?: string
          value?: Database["public"]["Enums"]["project_lifecycle_status"]
        }
        Relationships: [
          {
            foreignKeyName: "project_status_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          base_role: Database["public"]["Enums"]["app_role"]
          created_at: string
          description: string | null
          id: string
          is_system: boolean
          name: string
          organization_id: string
          permissions: string[]
          scope: string
          settings: Json
          status: Database["public"]["Enums"]["organization_status"]
          updated_at: string
        }
        Insert: {
          base_role: Database["public"]["Enums"]["app_role"]
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean
          name: string
          organization_id: string
          permissions?: string[]
          scope?: string
          settings?: Json
          status?: Database["public"]["Enums"]["organization_status"]
          updated_at?: string
        }
        Update: {
          base_role?: Database["public"]["Enums"]["app_role"]
          created_at?: string
          description?: string | null
          id?: string
          is_system?: boolean
          name?: string
          organization_id?: string
          permissions?: string[]
          scope?: string
          settings?: Json
          status?: Database["public"]["Enums"]["organization_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      task_priority_settings: {
        Row: {
          color: string | null
          created_at: string
          id: string
          label: string
          organization_id: string
          sort_order: number
          status: Database["public"]["Enums"]["organization_status"]
          updated_at: string
          value: Database["public"]["Enums"]["work_priority"]
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          label: string
          organization_id: string
          sort_order?: number
          status?: Database["public"]["Enums"]["organization_status"]
          updated_at?: string
          value: Database["public"]["Enums"]["work_priority"]
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          label?: string
          organization_id?: string
          sort_order?: number
          status?: Database["public"]["Enums"]["organization_status"]
          updated_at?: string
          value?: Database["public"]["Enums"]["work_priority"]
        }
        Relationships: [
          {
            foreignKeyName: "task_priority_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      task_recurrences: {
        Row: {
          active: boolean
          assignee_id: string | null
          created_at: string
          created_by: string
          creation_mode: string
          description: string | null
          end_date: string | null
          end_mode: string
          estimated_hours: number | null
          frequency: string
          id: string
          interval_count: number
          max_occurrences: number | null
          monthly_pattern: string
          next_due_date: string | null
          occurrences_created: number
          organization_id: string
          priority: Database["public"]["Enums"]["work_priority"]
          project_id: string | null
          reviewer_id: string | null
          tags: string[]
          task_status: Database["public"]["Enums"]["work_task_status"]
          title: string
          updated_at: string
          weekdays: number[]
        }
        Insert: {
          active?: boolean
          assignee_id?: string | null
          created_at?: string
          created_by: string
          creation_mode?: string
          description?: string | null
          end_date?: string | null
          end_mode?: string
          estimated_hours?: number | null
          frequency: string
          id?: string
          interval_count?: number
          max_occurrences?: number | null
          monthly_pattern?: string
          next_due_date?: string | null
          occurrences_created?: number
          organization_id: string
          priority?: Database["public"]["Enums"]["work_priority"]
          project_id?: string | null
          reviewer_id?: string | null
          tags?: string[]
          task_status?: Database["public"]["Enums"]["work_task_status"]
          title: string
          updated_at?: string
          weekdays?: number[]
        }
        Update: {
          active?: boolean
          assignee_id?: string | null
          created_at?: string
          created_by?: string
          creation_mode?: string
          description?: string | null
          end_date?: string | null
          end_mode?: string
          estimated_hours?: number | null
          frequency?: string
          id?: string
          interval_count?: number
          max_occurrences?: number | null
          monthly_pattern?: string
          next_due_date?: string | null
          occurrences_created?: number
          organization_id?: string
          priority?: Database["public"]["Enums"]["work_priority"]
          project_id?: string | null
          reviewer_id?: string | null
          tags?: string[]
          task_status?: Database["public"]["Enums"]["work_task_status"]
          title?: string
          updated_at?: string
          weekdays?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "task_recurrences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_recurrences_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "work_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      task_status_settings: {
        Row: {
          color: string | null
          created_at: string
          id: string
          is_completed: boolean
          is_default: boolean
          label: string
          organization_id: string
          sort_order: number
          status: Database["public"]["Enums"]["organization_status"]
          updated_at: string
          value: Database["public"]["Enums"]["work_task_status"]
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          is_completed?: boolean
          is_default?: boolean
          label: string
          organization_id: string
          sort_order?: number
          status?: Database["public"]["Enums"]["organization_status"]
          updated_at?: string
          value: Database["public"]["Enums"]["work_task_status"]
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          is_completed?: boolean
          is_default?: boolean
          label?: string
          organization_id?: string
          sort_order?: number
          status?: Database["public"]["Enums"]["organization_status"]
          updated_at?: string
          value?: Database["public"]["Enums"]["work_task_status"]
        }
        Relationships: [
          {
            foreignKeyName: "task_status_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      task_tags: {
        Row: {
          color: string | null
          created_at: string
          id: string
          name: string
          organization_id: string
          status: Database["public"]["Enums"]["organization_status"]
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          name: string
          organization_id: string
          status?: Database["public"]["Enums"]["organization_status"]
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
          status?: Database["public"]["Enums"]["organization_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_tags_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string
          department_id: string | null
          description: string | null
          id: string
          lead_user_id: string | null
          name: string
          organization_id: string
          status: Database["public"]["Enums"]["organization_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          department_id?: string | null
          description?: string | null
          id?: string
          lead_user_id?: string | null
          name: string
          organization_id: string
          status?: Database["public"]["Enums"]["organization_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          department_id?: string | null
          description?: string | null
          id?: string
          lead_user_id?: string | null
          name?: string
          organization_id?: string
          status?: Database["public"]["Enums"]["organization_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          role_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          role?: Database["public"]["Enums"]["app_role"]
          role_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          role_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      work_activity: {
        Row: {
          actor_id: string
          details: Json
          event_type: Database["public"]["Enums"]["activity_event_type"]
          id: string
          milestone_id: string | null
          occurred_at: string
          organization_id: string
          project_id: string | null
          task_id: string | null
        }
        Insert: {
          actor_id: string
          details?: Json
          event_type: Database["public"]["Enums"]["activity_event_type"]
          id?: string
          milestone_id?: string | null
          occurred_at?: string
          organization_id: string
          project_id?: string | null
          task_id?: string | null
        }
        Update: {
          actor_id?: string
          details?: Json
          event_type?: Database["public"]["Enums"]["activity_event_type"]
          id?: string
          milestone_id?: string | null
          occurred_at?: string
          organization_id?: string
          project_id?: string | null
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "work_activity_milestone_id_fkey"
            columns: ["milestone_id"]
            isOneToOne: false
            referencedRelation: "project_milestones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_activity_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_activity_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "work_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_activity_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "work_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      work_projects: {
        Row: {
          archived_at: string | null
          category_id: string | null
          client_name: string | null
          created_at: string
          department_id: string | null
          description: string | null
          due_date: string | null
          id: string
          manager_id: string | null
          name: string
          organization_id: string
          owner_id: string
          priority: Database["public"]["Enums"]["work_priority"]
          project_type: string
          start_date: string | null
          status: Database["public"]["Enums"]["project_lifecycle_status"]
          team_id: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          category_id?: string | null
          client_name?: string | null
          created_at?: string
          department_id?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          manager_id?: string | null
          name: string
          organization_id: string
          owner_id: string
          priority?: Database["public"]["Enums"]["work_priority"]
          project_type?: string
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_lifecycle_status"]
          team_id?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          category_id?: string | null
          client_name?: string | null
          created_at?: string
          department_id?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          manager_id?: string | null
          name?: string
          organization_id?: string
          owner_id?: string
          priority?: Database["public"]["Enums"]["work_priority"]
          project_type?: string
          start_date?: string | null
          status?: Database["public"]["Enums"]["project_lifecycle_status"]
          team_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_projects_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "project_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_projects_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_projects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_projects_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      work_tasks: {
        Row: {
          archived_at: string | null
          assignee_id: string | null
          blocked: boolean
          blocked_reason: string | null
          completed_at: string | null
          created_at: string
          created_by: string
          description: string | null
          due_at: string | null
          due_date: string | null
          estimated_hours: number | null
          id: string
          occurrence_number: number | null
          organization_id: string
          priority: Database["public"]["Enums"]["work_priority"]
          progress: number
          project_id: string | null
          recurrence_id: string | null
          reviewer_id: string | null
          status: Database["public"]["Enums"]["work_task_status"]
          tags: string[]
          title: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          assignee_id?: string | null
          blocked?: boolean
          blocked_reason?: string | null
          completed_at?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          due_at?: string | null
          due_date?: string | null
          estimated_hours?: number | null
          id?: string
          occurrence_number?: number | null
          organization_id: string
          priority?: Database["public"]["Enums"]["work_priority"]
          progress?: number
          project_id?: string | null
          recurrence_id?: string | null
          reviewer_id?: string | null
          status?: Database["public"]["Enums"]["work_task_status"]
          tags?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          assignee_id?: string | null
          blocked?: boolean
          blocked_reason?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          due_at?: string | null
          due_date?: string | null
          estimated_hours?: number | null
          id?: string
          occurrence_number?: number | null
          organization_id?: string
          priority?: Database["public"]["Enums"]["work_priority"]
          progress?: number
          project_id?: string | null
          recurrence_id?: string | null
          reviewer_id?: string | null
          status?: Database["public"]["Enums"]["work_task_status"]
          tags?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "work_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_tasks_recurrence_id_fkey"
            columns: ["recurrence_id"]
            isOneToOne: false
            referencedRelation: "task_recurrences"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      process_scheduled_task_recurrences: { Args: never; Returns: number }
    }
    Enums: {
      activity_event_type:
        | "task_created"
        | "task_completed"
        | "task_review_submitted"
        | "task_assignee_changed"
        | "task_due_date_changed"
        | "milestone_completed"
      app_role: "admin" | "manager" | "team_lead" | "employee" | "viewer"
      organization_status: "active" | "inactive"
      project_lifecycle_status:
        | "planning"
        | "active"
        | "on_hold"
        | "completed"
        | "cancelled"
        | "archived"
      work_priority: "low" | "medium" | "high" | "critical"
      work_task_status: "todo" | "progress" | "review" | "done" | "cancelled"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      activity_event_type: [
        "task_created",
        "task_completed",
        "task_review_submitted",
        "task_assignee_changed",
        "task_due_date_changed",
        "milestone_completed",
      ],
      app_role: ["admin", "manager", "team_lead", "employee", "viewer"],
      organization_status: ["active", "inactive"],
      project_lifecycle_status: [
        "planning",
        "active",
        "on_hold",
        "completed",
        "cancelled",
        "archived",
      ],
      work_priority: ["low", "medium", "high", "critical"],
      work_task_status: ["todo", "progress", "review", "done", "cancelled"],
    },
  },
} as const

