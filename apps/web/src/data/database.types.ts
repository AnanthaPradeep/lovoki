
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "blocks": {
                  Row: {
                    "blocked_id": string,"blocker_id": string,"created_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "blocked_id": string,"blocker_id": string,"created_at"?: string
                  }
                  Update: {
                    "blocked_id"?: string,"blocker_id"?: string,"created_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"content_reports": {
                  Row: {
                    "created_at": string,"details": string,"id": string,"reason": string,"reporter_id": string,"status": string,"target_id": string,"target_type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"details"?: string,"id"?: string,"reason": string,"reporter_id": string,"status"?: string,"target_id": string,"target_type": string
                  }
                  Update: {
                    "created_at"?: string,"details"?: string,"id"?: string,"reason"?: string,"reporter_id"?: string,"status"?: string,"target_id"?: string,"target_type"?: string
                  }
                  Relationships: [
                    
                  ]
                },"dating_preferences": {
                  Row: {
                    "age_max": number,"age_min": number,"created_at": string,"interested_in": (string)[],"max_distance_km": number | null,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "age_max"?: number,"age_min"?: number,"created_at"?: string,"interested_in"?: (string)[],"max_distance_km"?: number | null,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "age_max"?: number,"age_min"?: number,"created_at"?: string,"interested_in"?: (string)[],"max_distance_km"?: number | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"follows": {
                  Row: {
                    "accepted_at": string | null,"created_at": string,"followee_id": string,"follower_id": string,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string | null,"created_at"?: string,"followee_id": string,"follower_id": string,"status": string
                  }
                  Update: {
                    "accepted_at"?: string | null,"created_at"?: string,"followee_id"?: string,"follower_id"?: string,"status"?: string
                  }
                  Relationships: [
                    
                  ]
                },"interests": {
                  Row: {
                    "label": string,"slug": string
                  }
                  ComputedFields: never
                  Insert: {
                    "label": string,"slug": string
                  }
                  Update: {
                    "label"?: string,"slug"?: string
                  }
                  Relationships: [
                    
                  ]
                },"notifications": {
                  Row: {
                    "actor_id": string,"comment_id": string | null,"created_at": string,"id": string,"post_id": string | null,"read_at": string | null,"recipient_id": string,"type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id": string,"comment_id"?: string | null,"created_at"?: string,"id"?: string,"post_id"?: string | null,"read_at"?: string | null,"recipient_id": string,"type": string
                  }
                  Update: {
                    "actor_id"?: string,"comment_id"?: string | null,"created_at"?: string,"id"?: string,"post_id"?: string | null,"read_at"?: string | null,"recipient_id"?: string,"type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notifications_comment_id_fkey"
      columns: ["comment_id"]
isOneToOne: false
      referencedRelation: "post_comments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "notifications_post_id_fkey"
      columns: ["post_id"]
isOneToOne: false
      referencedRelation: "posts"
      referencedColumns: ["id"]
    }
                  ]
                },"onboarding_state": {
                  Row: {
                    "completed_at": string | null,"current_step": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "completed_at"?: string | null,"current_step"?: string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "completed_at"?: string | null,"current_step"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"post_comments": {
                  Row: {
                    "author_id": string,"body": string,"created_at": string,"id": string,"post_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author_id": string,"body": string,"created_at"?: string,"id"?: string,"post_id": string
                  }
                  Update: {
                    "author_id"?: string,"body"?: string,"created_at"?: string,"id"?: string,"post_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "post_comments_post_id_fkey"
      columns: ["post_id"]
isOneToOne: false
      referencedRelation: "posts"
      referencedColumns: ["id"]
    }
                  ]
                },"post_likes": {
                  Row: {
                    "created_at": string,"post_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"post_id": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"post_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "post_likes_post_id_fkey"
      columns: ["post_id"]
isOneToOne: false
      referencedRelation: "posts"
      referencedColumns: ["id"]
    }
                  ]
                },"post_media": {
                  Row: {
                    "content_type": string,"created_at": string,"id": string,"position": number,"post_id": string,"size_bytes": number,"storage_path": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "content_type": string,"created_at"?: string,"id"?: string,"position"?: number,"post_id": string,"size_bytes": number,"storage_path": string,"user_id": string
                  }
                  Update: {
                    "content_type"?: string,"created_at"?: string,"id"?: string,"position"?: number,"post_id"?: string,"size_bytes"?: number,"storage_path"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "post_media_post_id_fkey"
      columns: ["post_id"]
isOneToOne: false
      referencedRelation: "posts"
      referencedColumns: ["id"]
    }
                  ]
                },"post_saves": {
                  Row: {
                    "created_at": string,"post_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"post_id": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"post_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "post_saves_post_id_fkey"
      columns: ["post_id"]
isOneToOne: false
      referencedRelation: "posts"
      referencedColumns: ["id"]
    }
                  ]
                },"posts": {
                  Row: {
                    "audience": string,"author_id": string,"caption": string,"created_at": string,"id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "audience": string,"author_id": string,"caption"?: string,"created_at"?: string,"id"?: string
                  }
                  Update: {
                    "audience"?: string,"author_id"?: string,"caption"?: string,"created_at"?: string,"id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"profile_interests": {
                  Row: {
                    "slug": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "slug": string,"user_id": string
                  }
                  Update: {
                    "slug"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "profile_interests_slug_fkey"
      columns: ["slug"]
isOneToOne: false
      referencedRelation: "interests"
      referencedColumns: ["slug"]
    }
                  ]
                },"profile_photos": {
                  Row: {
                    "content_type": string,"created_at": string,"id": string,"position": number,"size_bytes": number,"storage_path": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "content_type": string,"created_at"?: string,"id"?: string,"position": number,"size_bytes": number,"storage_path": string,"user_id": string
                  }
                  Update: {
                    "content_type"?: string,"created_at"?: string,"id"?: string,"position"?: number,"size_bytes"?: number,"storage_path"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"profile_prompts": {
                  Row: {
                    "answer": string,"position": number,"question": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "answer": string,"position": number,"question": string,"user_id": string
                  }
                  Update: {
                    "answer"?: string,"position"?: number,"question"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"profiles": {
                  Row: {
                    "area_label": string,"bio": string,"created_at": string,"dating_discoverable": boolean,"display_name": string | null,"intention": string | null,"pronouns": string,"social_visibility": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "area_label"?: string,"bio"?: string,"created_at"?: string,"dating_discoverable"?: boolean,"display_name"?: string | null,"intention"?: string | null,"pronouns"?: string,"social_visibility"?: string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "area_label"?: string,"bio"?: string,"created_at"?: string,"dating_discoverable"?: boolean,"display_name"?: string | null,"intention"?: string | null,"pronouns"?: string,"social_visibility"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"profiles_private": {
                  Row: {
                    "created_at": string,"date_of_birth": string | null,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"date_of_birth"?: string | null,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"date_of_birth"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            "discoverable_profiles": {
                  Row: {
                    "age": number | null,"area_label": string,"bio": string,"display_name": string | null,"intention": string | null,"pronouns": string,"user_id": string
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                },"public_profiles": {
                  Row: {
                    "age": number | null,"area_label": string,"bio": string,"display_name": string | null,"intention": string | null,"pronouns": string,"user_id": string
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                }
          }
          Functions: {
            "_blocked_between":
{ Args: { "p_a": string,"p_b": string }; Returns: boolean
                           },
"_comment_count":
{ Args: { "p_post": string,"p_viewer": string }; Returns: number
                           },
"_create_account_rows":
{ Args: { "p_user": string }; Returns: undefined
                           },
"_cursor_id":
{ Args: { "p_cursor": string }; Returns: string
                           },
"_cursor_ts":
{ Args: { "p_cursor": string }; Returns: string
                           },
"_is_completed":
{ Args: { "p_user": string }; Returns: boolean
                           },
"_like_count":
{ Args: { "p_post": string,"p_viewer": string }; Returns: number
                           },
"_make_cursor":
{ Args: { "p_id": string,"p_ts": string }; Returns: string
                           },
"_notify":
{ Args: { "p_actor": string,"p_comment"?: string,"p_post"?: string,"p_recipient": string,"p_type": string }; Returns: undefined
                           },
"_page_size":
{ Args: { "p_limit": number }; Returns: number
                           },
"_post_rows":
{ Args: { "p_author": string,"p_cursor": string,"p_limit": number,"p_mode": string,"p_viewer": string }; Returns: {
              "audience": string,"author_id": string,"author_name": string,"author_photo_path": string,"caption": string,"comment_count": number,"created_at": string,"is_mine": boolean,"like_count": number,"liked_by_me": boolean,"media_path": string,"media_type": string,"page_cursor": string,"post_id": string,"saved_by_me": boolean
            }[]
                           },
"_require_completed":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"_require_uid":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"_visible_post_author":
{ Args: { "p_post": string,"p_viewer": string }; Returns: string
                           },
"add_comment":
{ Args: { "p_body": string,"p_post": string }; Returns: string
                           },
"age_of":
{ Args: { "dob": string }; Returns: number
                           },
"block_user":
{ Args: { "p_user": string }; Returns: undefined
                           },
"can_read_post_media":
{ Args: { "p_name": string }; Returns: boolean
                           },
"can_view_content":
{ Args: { "p_audience": string,"p_author": string,"p_viewer": string }; Returns: boolean
                           },
"can_view_photos_of":
{ Args: { "p_owner": string }; Returns: boolean
                           },
"comments_page":
{ Args: { "p_cursor"?: string,"p_limit"?: number,"p_post": string }; Returns: {
              "author_id": string,"author_name": string,"body": string,"can_delete": boolean,"comment_id": string,"created_at": string,"page_cursor": string
            }[]
                           },
"complete_onboarding":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"create_post":
{ Args: { "p_audience": string,"p_caption": string,"p_media_path"?: string,"p_post_id": string }; Returns: string
                           },
"delete_comment":
{ Args: { "p_comment": string }; Returns: undefined
                           },
"delete_photo":
{ Args: { "p_id": string }; Returns: string
                           },
"delete_post":
{ Args: { "p_post": string }; Returns: (string)[]
                           },
"ensure_account":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"feed_page":
{ Args: { "p_cursor"?: string,"p_feed": string,"p_limit"?: number }; Returns: {
              "audience": string,"author_id": string,"author_name": string,"author_photo_path": string,"caption": string,"comment_count": number,"created_at": string,"is_mine": boolean,"like_count": number,"liked_by_me": boolean,"media_path": string,"media_type": string,"page_cursor": string,"post_id": string,"saved_by_me": boolean
            }[]
                           },
"follow_user":
{ Args: { "p_user": string }; Returns: string
                           },
"is_adult_on":
{ Args: { "dob": string,"min_years"?: number,"ref": string }; Returns: boolean
                           },
"like_post":
{ Args: { "p_post": string }; Returns: {
              "like_count": number,"liked": boolean
            }[]
                           },
"list_blocks":
{ Args: Record<PropertyKey, never>; Returns: {
              "created_at": string,"display_name": string,"user_id": string
            }[]
                           },
"list_follows":
{ Args: { "p_cursor"?: string,"p_kind": string,"p_limit"?: number }; Returns: {
              "created_at": string,"display_name": string,"page_cursor": string,"photo_path": string,"status": string,"user_id": string
            }[]
                           },
"mark_notifications_read":
{ Args: { "p_ids"?: (string)[] }; Returns: number
                           },
"notifications_page":
{ Args: { "p_cursor"?: string,"p_limit"?: number }; Returns: {
              "actor_id": string,"actor_name": string,"comment_id": string,"created_at": string,"follow_status": string,"id": string,"page_cursor": string,"post_id": string,"read": boolean,"type": string
            }[]
                           },
"orphan_post_media":
{ Args: { "p_older_than"?: string }; Returns: string[]
                           },
"own_photo_object_count":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"own_post_media_object_count":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"profile_posts_page":
{ Args: { "p_author": string,"p_cursor"?: string,"p_limit"?: number }; Returns: {
              "audience": string,"author_id": string,"author_name": string,"author_photo_path": string,"caption": string,"comment_count": number,"created_at": string,"is_mine": boolean,"like_count": number,"liked_by_me": boolean,"media_path": string,"media_type": string,"page_cursor": string,"post_id": string,"saved_by_me": boolean
            }[]
                           },
"register_photo":
{ Args: { "p_path": string }; Returns: string
                           },
"remove_follower":
{ Args: { "p_follower": string }; Returns: undefined
                           },
"reorder_photos":
{ Args: { "p_ids": (string)[] }; Returns: undefined
                           },
"report_content":
{ Args: { "p_details"?: string,"p_reason": string,"p_target": string,"p_type": string }; Returns: string
                           },
"respond_follow_request":
{ Args: { "p_accept": boolean,"p_follower": string }; Returns: undefined
                           },
"save_about":
{ Args: { "p_bio": string,"p_interests": (string)[],"p_prompts": Json }; Returns: undefined
                           },
"save_basics":
{ Args: { "p_date_of_birth": string,"p_display_name": string,"p_pronouns"?: string }; Returns: undefined
                           },
"save_post":
{ Args: { "p_post": string }; Returns: boolean
                           },
"save_preferences":
{ Args: { "p_age_max": number,"p_age_min": number,"p_intention": string,"p_interested_in": (string)[],"p_max_distance": number }; Returns: undefined
                           },
"save_privacy":
{ Args: { "p_area_label": string,"p_dating_discoverable": boolean,"p_social_visibility": string }; Returns: undefined
                           },
"saved_posts_page":
{ Args: { "p_cursor"?: string,"p_limit"?: number }; Returns: {
              "audience": string,"author_id": string,"author_name": string,"author_photo_path": string,"caption": string,"comment_count": number,"created_at": string,"is_mine": boolean,"like_count": number,"liked_by_me": boolean,"media_path": string,"media_type": string,"page_cursor": string,"post_id": string,"saved_by_me": boolean
            }[]
                           },
"set_onboarding_step":
{ Args: { "p_step": string }; Returns: undefined
                           },
"set_post_audience":
{ Args: { "p_audience": string,"p_post": string }; Returns: undefined
                           },
"social_counts":
{ Args: Record<PropertyKey, never>; Returns: {
              "followers": number,"following": number,"requests": number
            }[]
                           },
"social_profile":
{ Args: { "p_user": string }; Returns: {
              "age": number,"area_label": string,"bio": string,"display_name": string,"follow_status": string,"follower_count": number,"following_count": number,"follows_me_status": string,"is_self": boolean,"photo_path": string,"post_count": number,"pronouns": string,"restricted": boolean,"user_id": string
            }[]
                           },
"unblock_user":
{ Args: { "p_user": string }; Returns: undefined
                           },
"unfollow_user":
{ Args: { "p_user": string }; Returns: undefined
                           },
"unlike_post":
{ Args: { "p_post": string }; Returns: {
              "like_count": number,"liked": boolean
            }[]
                           },
"unread_notification_count":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"unsave_post":
{ Args: { "p_post": string }; Returns: boolean
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const
