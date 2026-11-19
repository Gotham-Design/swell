
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
            "account_tax_lines": {
                  Row: {
                    "account_id": string,"business_id": string,"created_at": string,"form": string,"id": string,"tax_line_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"business_id": string,"created_at"?: string,"form": string,"id"?: string,"tax_line_id": string,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"business_id"?: string,"created_at"?: string,"form"?: string,"id"?: string,"tax_line_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "account_tax_lines_business_id_account_id_fkey"
      columns: ["business_id","account_id"]
isOneToOne: false
      referencedRelation: "account_balances"
      referencedColumns: ["business_id","account_id"]
    },{
      foreignKeyName: "account_tax_lines_business_id_account_id_fkey"
      columns: ["business_id","account_id"]
isOneToOne: false
      referencedRelation: "account_usage"
      referencedColumns: ["business_id","account_id"]
    },{
      foreignKeyName: "account_tax_lines_business_id_account_id_fkey"
      columns: ["business_id","account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "account_tax_lines_business_id_account_id_fkey"
      columns: ["business_id","account_id"]
isOneToOne: false
      referencedRelation: "category_picker"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "account_tax_lines_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "account_tax_lines_tax_line_id_form_fkey"
      columns: ["tax_line_id","form"]
isOneToOne: false
      referencedRelation: "tax_lines"
      referencedColumns: ["id","form"]
    }
                  ]
                },"accounts": {
                  Row: {
                    "archived_at": string | null,"business_id": string,"created_at": string,"description": string | null,"id": string,"is_hidden": boolean,"is_money_account": boolean,"is_standard": boolean,"is_system": boolean,"last4": string | null,"name": string,"opening_transaction_id": string | null,"parent_id": string | null,"subtype": string | null,"type": Database["public"]['Enums']["account_type"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"business_id": string,"created_at"?: string,"description"?: string | null,"id"?: string,"is_hidden"?: boolean,"is_money_account"?: boolean,"is_standard"?: boolean,"is_system"?: boolean,"last4"?: string | null,"name": string,"opening_transaction_id"?: string | null,"parent_id"?: string | null,"subtype"?: string | null,"type": Database["public"]['Enums']["account_type"],"updated_at"?: string
                  }
                  Update: {
                    "archived_at"?: string | null,"business_id"?: string,"created_at"?: string,"description"?: string | null,"id"?: string,"is_hidden"?: boolean,"is_money_account"?: boolean,"is_standard"?: boolean,"is_system"?: boolean,"last4"?: string | null,"name"?: string,"opening_transaction_id"?: string | null,"parent_id"?: string | null,"subtype"?: string | null,"type"?: Database["public"]['Enums']["account_type"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "accounts_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "accounts_business_id_opening_transaction_id_fkey"
      columns: ["business_id","opening_transaction_id"]
isOneToOne: false
      referencedRelation: "transactions"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "accounts_business_id_parent_id_fkey"
      columns: ["business_id","parent_id"]
isOneToOne: false
      referencedRelation: "account_balances"
      referencedColumns: ["business_id","account_id"]
    },{
      foreignKeyName: "accounts_business_id_parent_id_fkey"
      columns: ["business_id","parent_id"]
isOneToOne: false
      referencedRelation: "account_usage"
      referencedColumns: ["business_id","account_id"]
    },{
      foreignKeyName: "accounts_business_id_parent_id_fkey"
      columns: ["business_id","parent_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "accounts_business_id_parent_id_fkey"
      columns: ["business_id","parent_id"]
isOneToOne: false
      referencedRelation: "category_picker"
      referencedColumns: ["business_id","id"]
    }
                  ]
                },"ai_explanations": {
                  Row: {
                    "business_id": string,"created_at": string,"created_by": string | null,"id": string,"input_hash": string,"input_tokens": number | null,"latency_ms": number | null,"model": string,"output_tokens": number | null,"period_from": string,"period_to": string,"prompt_version": string,"summary": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"input_hash": string,"input_tokens"?: number | null,"latency_ms"?: number | null,"model": string,"output_tokens"?: number | null,"period_from": string,"period_to": string,"prompt_version": string,"summary": string,"updated_at"?: string
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"input_hash"?: string,"input_tokens"?: number | null,"latency_ms"?: number | null,"model"?: string,"output_tokens"?: number | null,"period_from"?: string,"period_to"?: string,"prompt_version"?: string,"summary"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_explanations_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"ai_suggestions": {
                  Row: {
                    "business_id": string,"category_account_id": string,"confidence": number,"created_at": string,"decided_at": string | null,"decided_by": string | null,"flags": (string)[],"id": string,"input_tokens": number | null,"latency_ms": number | null,"model": string,"output_tokens": number | null,"prompt_version": string,"reason": string | null,"request_key": string,"runner_up_category_account_id": string | null,"runner_up_confidence": number | null,"status": Database["public"]['Enums']["ai_suggestion_status"],"transaction_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"category_account_id": string,"confidence": number,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"flags"?: (string)[],"id"?: string,"input_tokens"?: number | null,"latency_ms"?: number | null,"model": string,"output_tokens"?: number | null,"prompt_version": string,"reason"?: string | null,"request_key": string,"runner_up_category_account_id"?: string | null,"runner_up_confidence"?: number | null,"status"?: Database["public"]['Enums']["ai_suggestion_status"],"transaction_id": string,"updated_at"?: string
                  }
                  Update: {
                    "business_id"?: string,"category_account_id"?: string,"confidence"?: number,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"flags"?: (string)[],"id"?: string,"input_tokens"?: number | null,"latency_ms"?: number | null,"model"?: string,"output_tokens"?: number | null,"prompt_version"?: string,"reason"?: string | null,"request_key"?: string,"runner_up_category_account_id"?: string | null,"runner_up_confidence"?: number | null,"status"?: Database["public"]['Enums']["ai_suggestion_status"],"transaction_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_suggestions_business_id_category_account_id_fkey"
      columns: ["business_id","category_account_id"]
isOneToOne: false
      referencedRelation: "account_balances"
      referencedColumns: ["business_id","account_id"]
    },{
      foreignKeyName: "ai_suggestions_business_id_category_account_id_fkey"
      columns: ["business_id","category_account_id"]
isOneToOne: false
      referencedRelation: "account_usage"
      referencedColumns: ["business_id","account_id"]
    },{
      foreignKeyName: "ai_suggestions_business_id_category_account_id_fkey"
      columns: ["business_id","category_account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "ai_suggestions_business_id_category_account_id_fkey"
      columns: ["business_id","category_account_id"]
isOneToOne: false
      referencedRelation: "category_picker"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "ai_suggestions_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ai_suggestions_business_id_transaction_id_fkey"
      columns: ["business_id","transaction_id"]
isOneToOne: false
      referencedRelation: "transactions"
      referencedColumns: ["business_id","id"]
    }
                  ]
                },"ai_usage": {
                  Row: {
                    "business_id": string,"calls": number,"created_at": string,"input_tokens": number,"month": string,"output_tokens": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"calls"?: number,"created_at"?: string,"input_tokens"?: number,"month": string,"output_tokens"?: number,"updated_at"?: string
                  }
                  Update: {
                    "business_id"?: string,"calls"?: number,"created_at"?: string,"input_tokens"?: number,"month"?: string,"output_tokens"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_usage_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"audit_log": {
                  Row: {
                    "action": string,"actor": string | null,"after": Json | null,"before": Json | null,"business_id": string,"created_at": string,"entity": string,"entity_id": string | null,"id": string,"seq": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor"?: string | null,"after"?: Json | null,"before"?: Json | null,"business_id": string,"created_at"?: string,"entity": string,"entity_id"?: string | null,"id"?: string,"seq"?: never,"updated_at"?: string
                  }
                  Update: {
                    "action"?: string,"actor"?: string | null,"after"?: Json | null,"before"?: Json | null,"business_id"?: string,"created_at"?: string,"entity"?: string,"entity_id"?: string | null,"id"?: string,"seq"?: never,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_log_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"business_invites": {
                  Row: {
                    "accepted_at": string | null,"accepted_by": string | null,"business_id": string,"created_at": string,"email": string,"expires_at": string,"id": string,"invited_by": string | null,"role": Database["public"]['Enums']["member_role"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string | null,"accepted_by"?: string | null,"business_id": string,"created_at"?: string,"email": string,"expires_at"?: string,"id"?: string,"invited_by"?: string | null,"role": Database["public"]['Enums']["member_role"],"updated_at"?: string
                  }
                  Update: {
                    "accepted_at"?: string | null,"accepted_by"?: string | null,"business_id"?: string,"created_at"?: string,"email"?: string,"expires_at"?: string,"id"?: string,"invited_by"?: string | null,"role"?: Database["public"]['Enums']["member_role"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "business_invites_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"business_members": {
                  Row: {
                    "firm_id": string | null,
                    "business_id": string,"created_at": string,"id": string,"role": Database["public"]['Enums']["member_role"],"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "firm_id"?: string | null,
                    "business_id": string,"created_at"?: string,"id"?: string,"role": Database["public"]['Enums']["member_role"],"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "firm_id"?: string | null,
                    "business_id"?: string,"created_at"?: string,"id"?: string,"role"?: Database["public"]['Enums']["member_role"],"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "business_members_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"businesses": {
                  Row: {
                    "firm_id": string | null,
                    "ai_auto_apply": boolean,"ai_auto_file": boolean,"ai_enabled": boolean,"ai_model": string | null,"ai_monthly_token_budget": number,"ai_share_memos": boolean,"books_start_date": string | null,"created_at": string,"created_by": string | null,"currency": string,"fiscal_year_start_month": number,"id": string,"large_threshold_cents": number | null,"archived_at": string | null,"industry": string | null,"legal_name": string | null,"lock_date": string | null,"name": string,"tax_form": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "firm_id"?: string | null,
                    "ai_auto_apply"?: boolean,"ai_auto_file"?: boolean,"ai_enabled"?: boolean,"ai_model"?: string | null,"ai_monthly_token_budget"?: number,"ai_share_memos"?: boolean,"books_start_date"?: string | null,"created_at"?: string,"created_by"?: string | null,"currency"?: string,"fiscal_year_start_month"?: number,"id"?: string,"large_threshold_cents"?: number | null,"archived_at"?: string | null,"industry"?: string | null,"legal_name"?: string | null,"lock_date"?: string | null,"name": string,"tax_form"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "firm_id"?: string | null,
                    "ai_auto_apply"?: boolean,"ai_auto_file"?: boolean,"ai_enabled"?: boolean,"ai_model"?: string | null,"ai_monthly_token_budget"?: number,"ai_share_memos"?: boolean,"books_start_date"?: string | null,"created_at"?: string,"created_by"?: string | null,"currency"?: string,"fiscal_year_start_month"?: number,"id"?: string,"large_threshold_cents"?: number | null,"archived_at"?: string | null,"industry"?: string | null,"legal_name"?: string | null,"lock_date"?: string | null,"name"?: string,"tax_form"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"category_rules": {
                  Row: {
                    "business_id": string,"category_account_id": string | null,"confirmations": number,"created_at": string,"created_by": string | null,"deleted_at": string | null,"enabled": boolean,"id": string,"last_applied_at": string | null,"match_mode": string,"name": string,"origin": string,"priority": number,"source": Database["public"]['Enums']["category_rule_source"],"status": string,"stop_processing": boolean,"times_applied": number,"updated_at": string,"vendor_normalized": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"category_account_id"?: string | null,"confirmations"?: number,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"enabled"?: boolean,"id"?: string,"last_applied_at"?: string | null,"match_mode"?: string,"name": string,"origin"?: string,"priority"?: number,"source"?: Database["public"]['Enums']["category_rule_source"],"status"?: string,"stop_processing"?: boolean,"times_applied"?: number,"updated_at"?: string,"vendor_normalized"?: string | null
                  }
                  Update: {
                    "business_id"?: string,"category_account_id"?: string | null,"confirmations"?: number,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"enabled"?: boolean,"id"?: string,"last_applied_at"?: string | null,"match_mode"?: string,"name"?: string,"origin"?: string,"priority"?: number,"source"?: Database["public"]['Enums']["category_rule_source"],"status"?: string,"stop_processing"?: boolean,"times_applied"?: number,"updated_at"?: string,"vendor_normalized"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "category_rules_business_id_category_account_id_fkey"
      columns: ["business_id","category_account_id"]
isOneToOne: false
      referencedRelation: "account_balances"
      referencedColumns: ["business_id","account_id"]
    },{
      foreignKeyName: "category_rules_business_id_category_account_id_fkey"
      columns: ["business_id","category_account_id"]
isOneToOne: false
      referencedRelation: "account_usage"
      referencedColumns: ["business_id","account_id"]
    },{
      foreignKeyName: "category_rules_business_id_category_account_id_fkey"
      columns: ["business_id","category_account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "category_rules_business_id_category_account_id_fkey"
      columns: ["business_id","category_account_id"]
isOneToOne: false
      referencedRelation: "category_picker"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "category_rules_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"import_batches": {
                  Row: {
                    "balance_check": Json | null,"business_id": string,"category_map": NonNullable<Json>,"committed_at": string | null,"committed_count": number | null,"created_at": string,"created_by": string | null,"date_from": string | null,"date_to": string | null,"encoding": string | null,"file_name": string | null,"file_size_bytes": number | null,"header_signature": string | null,"id": string,"mapping": Json | null,"money_account_id": string,"row_count": number | null,"skipped_count": number | null,"source_text": string | null,"status": Database["public"]['Enums']["import_batch_status"],"total_in_cents": number | null,"total_out_cents": number | null,"undone_at": string | null,"updated_at": string,"verified_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "balance_check"?: Json | null,"business_id": string,"category_map"?: NonNullable<Json>,"committed_at"?: string | null,"committed_count"?: number | null,"created_at"?: string,"created_by"?: string | null,"date_from"?: string | null,"date_to"?: string | null,"encoding"?: string | null,"file_name"?: string | null,"file_size_bytes"?: number | null,"header_signature"?: string | null,"id"?: string,"mapping"?: Json | null,"money_account_id": string,"row_count"?: number | null,"skipped_count"?: number | null,"source_text"?: string | null,"status"?: Database["public"]['Enums']["import_batch_status"],"total_in_cents"?: number | null,"total_out_cents"?: number | null,"undone_at"?: string | null,"updated_at"?: string,"verified_at"?: string | null
                  }
                  Update: {
                    "balance_check"?: Json | null,"business_id"?: string,"category_map"?: NonNullable<Json>,"committed_at"?: string | null,"committed_count"?: number | null,"created_at"?: string,"created_by"?: string | null,"date_from"?: string | null,"date_to"?: string | null,"encoding"?: string | null,"file_name"?: string | null,"file_size_bytes"?: number | null,"header_signature"?: string | null,"id"?: string,"mapping"?: Json | null,"money_account_id"?: string,"row_count"?: number | null,"skipped_count"?: number | null,"source_text"?: string | null,"status"?: Database["public"]['Enums']["import_batch_status"],"total_in_cents"?: number | null,"total_out_cents"?: number | null,"undone_at"?: string | null,"updated_at"?: string,"verified_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "import_batches_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "import_batches_business_id_money_account_id_fkey"
      columns: ["business_id","money_account_id"]
isOneToOne: false
      referencedRelation: "account_balances"
      referencedColumns: ["business_id","account_id"]
    },{
      foreignKeyName: "import_batches_business_id_money_account_id_fkey"
      columns: ["business_id","money_account_id"]
isOneToOne: false
      referencedRelation: "account_usage"
      referencedColumns: ["business_id","account_id"]
    },{
      foreignKeyName: "import_batches_business_id_money_account_id_fkey"
      columns: ["business_id","money_account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "import_batches_business_id_money_account_id_fkey"
      columns: ["business_id","money_account_id"]
isOneToOne: false
      referencedRelation: "category_picker"
      referencedColumns: ["business_id","id"]
    }
                  ]
                },"import_rows": {
                  Row: {
                    "amount_cents": number | null,"balance_cents": number | null,"business_id": string,"category_account_id": string | null,"category_name": string | null,"check_issues": NonNullable<Json>,"created_at": string,"date": string | null,"decision": Database["public"]['Enums']["import_row_decision"] | null,"dedupe_hash": string | null,"description_clean": string | null,"description_raw": string | null,"duplicate_of_row": number | null,"duplicate_of_transaction": string | null,"id": string,"import_batch_id": string,"included": boolean | null,"memo": string | null,"near_duplicate_of": string | null,"parse_issues": NonNullable<Json>,"raw": (string)[],"reference": string | null,"row_index": number,"status": Database["public"]['Enums']["import_row_status"],"transaction_id": string | null,"updated_at": string,"vendor_normalized": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents"?: number | null,"balance_cents"?: number | null,"business_id": string,"category_account_id"?: string | null,"category_name"?: string | null,"check_issues"?: NonNullable<Json>,"created_at"?: string,"date"?: string | null,"decision"?: Database["public"]['Enums']["import_row_decision"] | null,"dedupe_hash"?: string | null,"description_clean"?: string | null,"description_raw"?: string | null,"duplicate_of_row"?: number | null,"duplicate_of_transaction"?: string | null,"id"?: string,"import_batch_id": string,"included"?: never,"memo"?: string | null,"near_duplicate_of"?: string | null,"parse_issues"?: NonNullable<Json>,"raw": (string)[],"reference"?: string | null,"row_index": number,"status"?: Database["public"]['Enums']["import_row_status"],"transaction_id"?: string | null,"updated_at"?: string,"vendor_normalized"?: string | null
                  }
                  Update: {
                    "amount_cents"?: number | null,"balance_cents"?: number | null,"business_id"?: string,"category_account_id"?: string | null,"category_name"?: string | null,"check_issues"?: NonNullable<Json>,"created_at"?: string,"date"?: string | null,"decision"?: Database["public"]['Enums']["import_row_decision"] | null,"dedupe_hash"?: string | null,"description_clean"?: string | null,"description_raw"?: string | null,"duplicate_of_row"?: number | null,"duplicate_of_transaction"?: string | null,"id"?: string,"import_batch_id"?: string,"included"?: never,"memo"?: string | null,"near_duplicate_of"?: string | null,"parse_issues"?: NonNullable<Json>,"raw"?: (string)[],"reference"?: string | null,"row_index"?: number,"status"?: Database["public"]['Enums']["import_row_status"],"transaction_id"?: string | null,"updated_at"?: string,"vendor_normalized"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "import_rows_business_id_category_account_id_fkey"
      columns: ["business_id","category_account_id"]
isOneToOne: false
      referencedRelation: "account_balances"
      referencedColumns: ["business_id","account_id"]
    },{
      foreignKeyName: "import_rows_business_id_category_account_id_fkey"
      columns: ["business_id","category_account_id"]
isOneToOne: false
      referencedRelation: "account_usage"
      referencedColumns: ["business_id","account_id"]
    },{
      foreignKeyName: "import_rows_business_id_category_account_id_fkey"
      columns: ["business_id","category_account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "import_rows_business_id_category_account_id_fkey"
      columns: ["business_id","category_account_id"]
isOneToOne: false
      referencedRelation: "category_picker"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "import_rows_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "import_rows_business_id_import_batch_id_fkey"
      columns: ["business_id","import_batch_id"]
isOneToOne: false
      referencedRelation: "import_batches"
      referencedColumns: ["business_id","id"]
    }
                  ]
                },"statement_requests": {
                  Row: {
                    "account_ids": string[],"business_id": string,"created_at": string,"created_by": string | null,"expires_at": string,"from_name": string,"id": string,"note": string | null,"revoked_at": string | null,"token_hash": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_ids"?: string[],"business_id": string,"created_at"?: string,"created_by"?: string | null,"expires_at"?: string,"from_name": string,"id"?: string,"note"?: string | null,"revoked_at"?: string | null,"token_hash": string,"updated_at"?: string
                  }
                  Update: {
                    "account_ids"?: string[],"business_id"?: string,"created_at"?: string,"created_by"?: string | null,"expires_at"?: string,"from_name"?: string,"id"?: string,"note"?: string | null,"revoked_at"?: string | null,"token_hash"?: string,"updated_at"?: string
                  }
                  Relationships: []
                },"statement_schedules": {
                  Row: {
                    "id": string,"business_id": string,"client_email": string,"from_name": string,"note": string | null,"account_ids": string[],"day_of_month": number,"active": boolean,"next_send_on": string,"period_month": string | null,"sends_in_period": number,"last_sent_at": string | null,"last_request_id": string | null,"last_error": string | null,"created_by": string | null,"created_at": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string,"business_id": string,"client_email": string,"from_name": string,"note"?: string | null,"account_ids"?: string[],"day_of_month"?: number,"active"?: boolean,"next_send_on": string,"period_month"?: string | null,"sends_in_period"?: number,"last_sent_at"?: string | null,"last_request_id"?: string | null,"last_error"?: string | null,"created_by"?: string | null,"created_at"?: string,"updated_at"?: string
                  }
                  Update: {
                    "id"?: string,"business_id"?: string,"client_email"?: string,"from_name"?: string,"note"?: string | null,"account_ids"?: string[],"day_of_month"?: number,"active"?: boolean,"next_send_on"?: string,"period_month"?: string | null,"sends_in_period"?: number,"last_sent_at"?: string | null,"last_request_id"?: string | null,"last_error"?: string | null,"created_by"?: string | null,"created_at"?: string,"updated_at"?: string
                  }
                  Relationships: []
                },"fixed_assets": {
                  Row: {
                    "id": string,"business_id": string,"name": string,"kind": string,"acquired_on": string,"in_service_on": string,"cost_cents": number,"salvage_cents": number,"method": string,"life_months": number | null,"asset_account_id": string,"purchase_transaction_id": string | null,"disposed_on": string | null,"notes": string | null,"created_by": string | null,"created_at": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string,"business_id": string,"name": string,"kind": string,"acquired_on": string,"in_service_on": string,"cost_cents": number,"salvage_cents"?: number,"method": string,"life_months"?: number | null,"asset_account_id": string,"purchase_transaction_id"?: string | null,"disposed_on"?: string | null,"notes"?: string | null,"created_by"?: string | null,"created_at"?: string,"updated_at"?: string
                  }
                  Update: {
                    "id"?: string,"business_id"?: string,"name"?: string,"kind"?: string,"acquired_on"?: string,"in_service_on"?: string,"cost_cents"?: number,"salvage_cents"?: number,"method"?: string,"life_months"?: number | null,"asset_account_id"?: string,"purchase_transaction_id"?: string | null,"disposed_on"?: string | null,"notes"?: string | null,"created_by"?: string | null,"created_at"?: string,"updated_at"?: string
                  }
                  Relationships: []
                },"depreciation_entries": {
                  Row: {
                    "id": string,"business_id": string,"asset_id": string,"through": string,"amount_cents": number,"transaction_id": string,"created_by": string | null,"created_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string,"business_id": string,"asset_id": string,"through": string,"amount_cents": number,"transaction_id": string,"created_by"?: string | null,"created_at"?: string
                  }
                  Update: {
                    "id"?: string,"business_id"?: string,"asset_id"?: string,"through"?: string,"amount_cents"?: number,"transaction_id"?: string,"created_by"?: string | null,"created_at"?: string
                  }
                  Relationships: []
                },"tax_skips": {
                  Row: {
                    "business_id": string,"transaction_id": string,"what": string,"created_by": string | null,"created_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"transaction_id": string,"what": string,"created_by"?: string | null,"created_at"?: string
                  }
                  Update: {
                    "business_id"?: string,"transaction_id"?: string,"what"?: string,"created_by"?: string | null,"created_at"?: string
                  }
                  Relationships: []
                },"tax_items": {
                  Row: {
                    "id": string,"business_id": string,"kind": string,"item_type": string,"person": string | null,"date": string,"amount_cents": number,"description": string,"transaction_id": string | null,"note": string | null,"created_by": string | null,"created_at": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string,"business_id": string,"kind": string,"item_type": string,"person"?: string | null,"date": string,"amount_cents": number,"description": string,"transaction_id"?: string | null,"note"?: string | null,"created_by"?: string | null,"created_at"?: string,"updated_at"?: string
                  }
                  Update: {
                    "id"?: string,"business_id"?: string,"kind"?: string,"item_type"?: string,"person"?: string | null,"date"?: string,"amount_cents"?: number,"description"?: string,"transaction_id"?: string | null,"note"?: string | null,"created_by"?: string | null,"created_at"?: string,"updated_at"?: string
                  }
                  Relationships: []
                },"mileage_rates": {
                  Row: {
                    "effective_from": string,"rate_tenth_cents": number,"source": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "effective_from": string,"rate_tenth_cents": number,"source"?: string | null
                  }
                  Update: {
                    "effective_from"?: string,"rate_tenth_cents"?: number,"source"?: string | null
                  }
                  Relationships: []
                },"mileage_trips": {
                  Row: {
                    "id": string,"business_id": string,"date": string,"miles_tenths": number,"purpose": string,"start_place": string | null,"end_place": string | null,"vehicle": string | null,"created_by": string | null,"created_at": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string,"business_id": string,"date": string,"miles_tenths": number,"purpose": string,"start_place"?: string | null,"end_place"?: string | null,"vehicle"?: string | null,"created_by"?: string | null,"created_at"?: string,"updated_at"?: string
                  }
                  Update: {
                    "id"?: string,"business_id"?: string,"date"?: string,"miles_tenths"?: number,"purpose"?: string,"start_place"?: string | null,"end_place"?: string | null,"vehicle"?: string | null,"created_by"?: string | null,"created_at"?: string,"updated_at"?: string
                  }
                  Relationships: []
                },"documents": {
                  Row: {
                    "id": string,"business_id": string,"file_name": string,"content_type": string,"size_bytes": number,"storage_path": string,"kind": string,"transaction_id": string | null,"asset_id": string | null,"tax_item_id": string | null,"note": string | null,"uploaded_by": string | null,"created_at": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string,"business_id": string,"file_name": string,"content_type": string,"size_bytes": number,"storage_path": string,"kind"?: string,"transaction_id"?: string | null,"asset_id"?: string | null,"tax_item_id"?: string | null,"note"?: string | null,"uploaded_by"?: string | null,"created_at"?: string,"updated_at"?: string
                  }
                  Update: {
                    "id"?: string,"business_id"?: string,"file_name"?: string,"content_type"?: string,"size_bytes"?: number,"storage_path"?: string,"kind"?: string,"transaction_id"?: string | null,"asset_id"?: string | null,"tax_item_id"?: string | null,"note"?: string | null,"uploaded_by"?: string | null,"created_at"?: string,"updated_at"?: string
                  }
                  Relationships: []
                },"firms": {
                  Row: {
                    "id": string,"name": string,"created_by": string | null,"created_at": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string,"name": string,"created_by"?: string | null,"created_at"?: string,"updated_at"?: string
                  }
                  Update: {
                    "id"?: string,"name"?: string,"created_by"?: string | null,"created_at"?: string,"updated_at"?: string
                  }
                  Relationships: []
                },"firm_members": {
                  Row: {
                    "firm_id": string,"user_id": string,"role": Database["public"]["Enums"]["firm_role"],"all_clients": boolean,"client_role": Database["public"]["Enums"]["member_role"],"created_at": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "firm_id": string,"user_id": string,"role": Database["public"]["Enums"]["firm_role"],"all_clients"?: boolean,"client_role"?: Database["public"]["Enums"]["member_role"],"created_at"?: string,"updated_at"?: string
                  }
                  Update: {
                    "firm_id"?: string,"user_id"?: string,"role"?: Database["public"]["Enums"]["firm_role"],"all_clients"?: boolean,"client_role"?: Database["public"]["Enums"]["member_role"],"created_at"?: string,"updated_at"?: string
                  }
                  Relationships: []
                },"firm_member_clients": {
                  Row: {
                    "firm_id": string,"user_id": string,"business_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "firm_id": string,"user_id": string,"business_id": string
                  }
                  Update: {
                    "firm_id"?: string,"user_id"?: string,"business_id"?: string
                  }
                  Relationships: []
                },"firm_invites": {
                  Row: {
                    "id": string,"firm_id": string,"email": string,"role": Database["public"]["Enums"]["firm_role"],"all_clients": boolean,"client_role": Database["public"]["Enums"]["member_role"],"business_ids": string[],"invited_by": string | null,"expires_at": string,"accepted_at": string | null,"accepted_by": string | null,"created_at": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string,"firm_id": string,"email": string,"role": Database["public"]["Enums"]["firm_role"],"all_clients"?: boolean,"client_role"?: Database["public"]["Enums"]["member_role"],"business_ids"?: string[],"invited_by"?: string | null,"expires_at"?: string,"accepted_at"?: string | null,"accepted_by"?: string | null,"created_at"?: string,"updated_at"?: string
                  }
                  Update: {
                    "id"?: string,"firm_id"?: string,"email"?: string,"role"?: Database["public"]["Enums"]["firm_role"],"all_clients"?: boolean,"client_role"?: Database["public"]["Enums"]["member_role"],"business_ids"?: string[],"invited_by"?: string | null,"expires_at"?: string,"accepted_at"?: string | null,"accepted_by"?: string | null,"created_at"?: string,"updated_at"?: string
                  }
                  Relationships: []
                },"transfer_matches": {
                  Row: {
                    "business_id": string,"created_at": string,"created_by": string | null,"id": string,"in_prev_category_id": string | null,"in_transaction_id": string | null,"out_prev_category_id": string | null,"out_transaction_id": string,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"in_prev_category_id"?: string | null,"in_transaction_id"?: string | null,"out_prev_category_id"?: string | null,"out_transaction_id"?: string,"status"?: string
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"in_prev_category_id"?: string | null,"in_transaction_id"?: string | null,"out_prev_category_id"?: string | null,"out_transaction_id"?: string,"status"?: string
                  }
                  Relationships: []
                },"statement_uploads": {
                  Row: {
                    "business_id": string,"content_type": string,"deleted_at": string | null,"file_name": string,"file_size_bytes": number,"id": string,"import_batch_id": string | null,"imported_at": string | null,"request_id": string,"storage_path": string,"updated_at": string,"uploaded_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"content_type": string,"deleted_at"?: string | null,"file_name": string,"file_size_bytes": number,"id"?: string,"import_batch_id"?: string | null,"imported_at"?: string | null,"request_id": string,"storage_path": string,"updated_at"?: string,"uploaded_at"?: string
                  }
                  Update: {
                    "business_id"?: string,"content_type"?: string,"deleted_at"?: string | null,"file_name"?: string,"file_size_bytes"?: number,"id"?: string,"import_batch_id"?: string | null,"imported_at"?: string | null,"request_id"?: string,"storage_path"?: string,"updated_at"?: string,"uploaded_at"?: string
                  }
                  Relationships: []
                },"import_templates": {
                  Row: {
                    "business_id": string,"created_at": string,"created_by": string | null,"header_signature": string,"id": string,"mapping": NonNullable<Json>,"money_account_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"created_by"?: string | null,"header_signature": string,"id"?: string,"mapping": NonNullable<Json>,"money_account_id": string,"updated_at"?: string
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"created_by"?: string | null,"header_signature"?: string,"id"?: string,"mapping"?: NonNullable<Json>,"money_account_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "import_templates_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "import_templates_business_id_money_account_id_fkey"
      columns: ["business_id","money_account_id"]
isOneToOne: false
      referencedRelation: "account_balances"
      referencedColumns: ["business_id","account_id"]
    },{
      foreignKeyName: "import_templates_business_id_money_account_id_fkey"
      columns: ["business_id","money_account_id"]
isOneToOne: false
      referencedRelation: "account_usage"
      referencedColumns: ["business_id","account_id"]
    },{
      foreignKeyName: "import_templates_business_id_money_account_id_fkey"
      columns: ["business_id","money_account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "import_templates_business_id_money_account_id_fkey"
      columns: ["business_id","money_account_id"]
isOneToOne: false
      referencedRelation: "category_picker"
      referencedColumns: ["business_id","id"]
    }
                  ]
                },"journal_lines": {
                  Row: {
                    "account_id": string,"amount_cents": number,"business_id": string,"created_at": string,"id": string,"transaction_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id": string,"amount_cents": number,"business_id": string,"created_at"?: string,"id"?: string,"transaction_id": string,"updated_at"?: string
                  }
                  Update: {
                    "account_id"?: string,"amount_cents"?: number,"business_id"?: string,"created_at"?: string,"id"?: string,"transaction_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "journal_lines_business_id_account_id_fkey"
      columns: ["business_id","account_id"]
isOneToOne: false
      referencedRelation: "account_balances"
      referencedColumns: ["business_id","account_id"]
    },{
      foreignKeyName: "journal_lines_business_id_account_id_fkey"
      columns: ["business_id","account_id"]
isOneToOne: false
      referencedRelation: "account_usage"
      referencedColumns: ["business_id","account_id"]
    },{
      foreignKeyName: "journal_lines_business_id_account_id_fkey"
      columns: ["business_id","account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "journal_lines_business_id_account_id_fkey"
      columns: ["business_id","account_id"]
isOneToOne: false
      referencedRelation: "category_picker"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "journal_lines_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "journal_lines_business_id_transaction_id_fkey"
      columns: ["business_id","transaction_id"]
isOneToOne: false
      referencedRelation: "transactions"
      referencedColumns: ["business_id","id"]
    }
                  ]
                },"ledger_alerts": {
                  Row: {
                    "business_id": string,"created_at": string,"detail": NonNullable<Json>,"detected_at": string,"id": string,"kind": string,"last_seen_at": string,"resolved_at": string | null,"transaction_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"detail"?: NonNullable<Json>,"detected_at"?: string,"id"?: string,"kind": string,"last_seen_at"?: string,"resolved_at"?: string | null,"transaction_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"detail"?: NonNullable<Json>,"detected_at"?: string,"id"?: string,"kind"?: string,"last_seen_at"?: string,"resolved_at"?: string | null,"transaction_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ledger_alerts_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"reconciliation_items": {
                  Row: {
                    "business_id": string,"created_at": string,"money_account_id": string,"reconciliation_id": string,"transaction_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"created_at"?: string,"money_account_id": string,"reconciliation_id": string,"transaction_id": string
                  }
                  Update: {
                    "business_id"?: string,"created_at"?: string,"money_account_id"?: string,"reconciliation_id"?: string,"transaction_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "reconciliation_items_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reconciliation_items_business_id_reconciliation_id_fkey"
      columns: ["business_id","reconciliation_id"]
isOneToOne: false
      referencedRelation: "reconciliations"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "reconciliation_items_business_id_transaction_id_fkey"
      columns: ["business_id","transaction_id"]
isOneToOne: false
      referencedRelation: "transactions"
      referencedColumns: ["business_id","id"]
    }
                  ]
                },"reconciliations": {
                  Row: {
                    "beginning_balance_cents": number,"business_id": string,"completed_at": string | null,"completed_by": string | null,"created_at": string,"created_by": string | null,"id": string,"money_account_id": string,"statement_balance_cents": number,"statement_date": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "beginning_balance_cents"?: number,"business_id": string,"completed_at"?: string | null,"completed_by"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"money_account_id": string,"statement_balance_cents": number,"statement_date": string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "beginning_balance_cents"?: number,"business_id"?: string,"completed_at"?: string | null,"completed_by"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"money_account_id"?: string,"statement_balance_cents"?: number,"statement_date"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "reconciliations_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reconciliations_business_id_money_account_id_fkey"
      columns: ["business_id","money_account_id"]
isOneToOne: false
      referencedRelation: "account_balances"
      referencedColumns: ["business_id","account_id"]
    },{
      foreignKeyName: "reconciliations_business_id_money_account_id_fkey"
      columns: ["business_id","money_account_id"]
isOneToOne: false
      referencedRelation: "account_usage"
      referencedColumns: ["business_id","account_id"]
    },{
      foreignKeyName: "reconciliations_business_id_money_account_id_fkey"
      columns: ["business_id","money_account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "reconciliations_business_id_money_account_id_fkey"
      columns: ["business_id","money_account_id"]
isOneToOne: false
      referencedRelation: "category_picker"
      referencedColumns: ["business_id","id"]
    }
                  ]
                },"rule_actions": {
                  Row: {
                    "account_id": string | null,"action": string,"business_id": string,"created_at": string,"id": string,"position": number,"rule_id": string,"updated_at": string,"value": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "account_id"?: string | null,"action": string,"business_id": string,"created_at"?: string,"id"?: string,"position"?: number,"rule_id": string,"updated_at"?: string,"value"?: NonNullable<Json>
                  }
                  Update: {
                    "account_id"?: string | null,"action"?: string,"business_id"?: string,"created_at"?: string,"id"?: string,"position"?: number,"rule_id"?: string,"updated_at"?: string,"value"?: NonNullable<Json>
                  }
                  Relationships: [
                    {
      foreignKeyName: "rule_actions_business_id_account_id_fkey"
      columns: ["business_id","account_id"]
isOneToOne: false
      referencedRelation: "account_balances"
      referencedColumns: ["business_id","account_id"]
    },{
      foreignKeyName: "rule_actions_business_id_account_id_fkey"
      columns: ["business_id","account_id"]
isOneToOne: false
      referencedRelation: "account_usage"
      referencedColumns: ["business_id","account_id"]
    },{
      foreignKeyName: "rule_actions_business_id_account_id_fkey"
      columns: ["business_id","account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "rule_actions_business_id_account_id_fkey"
      columns: ["business_id","account_id"]
isOneToOne: false
      referencedRelation: "category_picker"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "rule_actions_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "rule_actions_business_id_rule_id_fkey"
      columns: ["business_id","rule_id"]
isOneToOne: false
      referencedRelation: "category_rules"
      referencedColumns: ["business_id","id"]
    }
                  ]
                },"rule_applications": {
                  Row: {
                    "applied_at": string,"business_id": string,"created_at": string,"created_by": string | null,"id": string,"mode": string,"new_category_id": string | null,"new_memo": string | null,"previous_category_id": string | null,"previous_category_source": Database["public"]['Enums']["category_source"] | null,"previous_memo": string | null,"previous_rule_id": string | null,"rule_id": string,"run_id": string | null,"transaction_id": string,"undone_at": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "applied_at"?: string,"business_id": string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"mode": string,"new_category_id"?: string | null,"new_memo"?: string | null,"previous_category_id"?: string | null,"previous_category_source"?: Database["public"]['Enums']["category_source"] | null,"previous_memo"?: string | null,"previous_rule_id"?: string | null,"rule_id": string,"run_id"?: string | null,"transaction_id": string,"undone_at"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "applied_at"?: string,"business_id"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"mode"?: string,"new_category_id"?: string | null,"new_memo"?: string | null,"previous_category_id"?: string | null,"previous_category_source"?: Database["public"]['Enums']["category_source"] | null,"previous_memo"?: string | null,"previous_rule_id"?: string | null,"rule_id"?: string,"run_id"?: string | null,"transaction_id"?: string,"undone_at"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "rule_applications_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "rule_applications_business_id_rule_id_fkey"
      columns: ["business_id","rule_id"]
isOneToOne: false
      referencedRelation: "category_rules"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "rule_applications_business_id_transaction_id_fkey"
      columns: ["business_id","transaction_id"]
isOneToOne: false
      referencedRelation: "transactions"
      referencedColumns: ["business_id","id"]
    }
                  ]
                },"rule_conditions": {
                  Row: {
                    "business_id": string,"case_sensitive": boolean,"created_at": string,"field": string,"id": string,"operator": string,"position": number,"rule_id": string,"updated_at": string,"value": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "business_id": string,"case_sensitive"?: boolean,"created_at"?: string,"field": string,"id"?: string,"operator": string,"position"?: number,"rule_id": string,"updated_at"?: string,"value": NonNullable<Json>
                  }
                  Update: {
                    "business_id"?: string,"case_sensitive"?: boolean,"created_at"?: string,"field"?: string,"id"?: string,"operator"?: string,"position"?: number,"rule_id"?: string,"updated_at"?: string,"value"?: NonNullable<Json>
                  }
                  Relationships: [
                    {
      foreignKeyName: "rule_conditions_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "rule_conditions_business_id_rule_id_fkey"
      columns: ["business_id","rule_id"]
isOneToOne: false
      referencedRelation: "category_rules"
      referencedColumns: ["business_id","id"]
    }
                  ]
                },"tax_lines": {
                  Row: {
                    "form": string,"id": string,"label": string,"line": string,"sort": number,"tax_year": number
                  }
                  ComputedFields: never
                  Insert: {
                    "form": string,"id": string,"label": string,"line": string,"sort": number,"tax_year": number
                  }
                  Update: {
                    "form"?: string,"id"?: string,"label"?: string,"line"?: string,"sort"?: number,"tax_year"?: number
                  }
                  Relationships: [
                    
                  ]
                },"transaction_patterns": {
                  Row: {
                    "amount_cents": number | null,"amount_match": string | null,"business_id": string,"cadence": string | null,"computed_at": string,"created_at": string,"direction": string | null,"expected_amount_cents": number | null,"expected_next_date": string | null,"first_seen": string | null,"id": string,"kind": Database["public"]['Enums']["pattern_kind"],"large_rules": (string)[] | null,"last_amount_cents": number | null,"last_date": string | null,"last_seen": string | null,"status": string | null,"transaction_id": string | null,"txn_count": number | null,"typical_amount_cents": number | null,"typical_category_id": string | null,"updated_at": string,"vendor_normalized": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents"?: number | null,"amount_match"?: string | null,"business_id": string,"cadence"?: string | null,"computed_at"?: string,"created_at"?: string,"direction"?: string | null,"expected_amount_cents"?: number | null,"expected_next_date"?: string | null,"first_seen"?: string | null,"id"?: string,"kind": Database["public"]['Enums']["pattern_kind"],"large_rules"?: (string)[] | null,"last_amount_cents"?: number | null,"last_date"?: string | null,"last_seen"?: string | null,"status"?: string | null,"transaction_id"?: string | null,"txn_count"?: number | null,"typical_amount_cents"?: number | null,"typical_category_id"?: string | null,"updated_at"?: string,"vendor_normalized"?: string | null
                  }
                  Update: {
                    "amount_cents"?: number | null,"amount_match"?: string | null,"business_id"?: string,"cadence"?: string | null,"computed_at"?: string,"created_at"?: string,"direction"?: string | null,"expected_amount_cents"?: number | null,"expected_next_date"?: string | null,"first_seen"?: string | null,"id"?: string,"kind"?: Database["public"]['Enums']["pattern_kind"],"large_rules"?: (string)[] | null,"last_amount_cents"?: number | null,"last_date"?: string | null,"last_seen"?: string | null,"status"?: string | null,"transaction_id"?: string | null,"txn_count"?: number | null,"typical_amount_cents"?: number | null,"typical_category_id"?: string | null,"updated_at"?: string,"vendor_normalized"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "transaction_patterns_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "transaction_patterns_business_id_transaction_id_fkey"
      columns: ["business_id","transaction_id"]
isOneToOne: false
      referencedRelation: "transactions"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "transaction_patterns_business_id_typical_category_id_fkey"
      columns: ["business_id","typical_category_id"]
isOneToOne: false
      referencedRelation: "account_balances"
      referencedColumns: ["business_id","account_id"]
    },{
      foreignKeyName: "transaction_patterns_business_id_typical_category_id_fkey"
      columns: ["business_id","typical_category_id"]
isOneToOne: false
      referencedRelation: "account_usage"
      referencedColumns: ["business_id","account_id"]
    },{
      foreignKeyName: "transaction_patterns_business_id_typical_category_id_fkey"
      columns: ["business_id","typical_category_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "transaction_patterns_business_id_typical_category_id_fkey"
      columns: ["business_id","typical_category_id"]
isOneToOne: false
      referencedRelation: "category_picker"
      referencedColumns: ["business_id","id"]
    }
                  ]
                },"transactions": {
                  Row: {
                    "amount_cents": number,"business_id": string,"category_account_id": string | null,"category_rule_id": string | null,"category_source": Database["public"]['Enums']["category_source"] | null,"created_at": string,"created_by": string | null,"date": string,"dedupe_hash": string | null,"deleted_at": string | null,"deleted_by": string | null,"description_clean": string | null,"description_raw": string,"id": string,"import_batch_id": string | null,"kind": Database["public"]['Enums']["transaction_kind"],"memo": string | null,"money_account_id": string,"reference": string | null,"source": Database["public"]['Enums']["transaction_source"],"updated_at": string,"vendor_normalized": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_cents": number,"business_id": string,"category_account_id"?: string | null,"category_rule_id"?: string | null,"category_source"?: Database["public"]['Enums']["category_source"] | null,"created_at"?: string,"created_by"?: string | null,"date": string,"dedupe_hash"?: string | null,"deleted_at"?: string | null,"deleted_by"?: string | null,"description_clean"?: string | null,"description_raw": string,"id"?: string,"import_batch_id"?: string | null,"kind": Database["public"]['Enums']["transaction_kind"],"memo"?: string | null,"money_account_id": string,"reference"?: string | null,"source"?: Database["public"]['Enums']["transaction_source"],"updated_at"?: string,"vendor_normalized"?: string | null
                  }
                  Update: {
                    "amount_cents"?: number,"business_id"?: string,"category_account_id"?: string | null,"category_rule_id"?: string | null,"category_source"?: Database["public"]['Enums']["category_source"] | null,"created_at"?: string,"created_by"?: string | null,"date"?: string,"dedupe_hash"?: string | null,"deleted_at"?: string | null,"deleted_by"?: string | null,"description_clean"?: string | null,"description_raw"?: string,"id"?: string,"import_batch_id"?: string | null,"kind"?: Database["public"]['Enums']["transaction_kind"],"memo"?: string | null,"money_account_id"?: string,"reference"?: string | null,"source"?: Database["public"]['Enums']["transaction_source"],"updated_at"?: string,"vendor_normalized"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "transactions_business_id_category_account_id_fkey"
      columns: ["business_id","category_account_id"]
isOneToOne: false
      referencedRelation: "account_balances"
      referencedColumns: ["business_id","account_id"]
    },{
      foreignKeyName: "transactions_business_id_category_account_id_fkey"
      columns: ["business_id","category_account_id"]
isOneToOne: false
      referencedRelation: "account_usage"
      referencedColumns: ["business_id","account_id"]
    },{
      foreignKeyName: "transactions_business_id_category_account_id_fkey"
      columns: ["business_id","category_account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "transactions_business_id_category_account_id_fkey"
      columns: ["business_id","category_account_id"]
isOneToOne: false
      referencedRelation: "category_picker"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "transactions_business_id_category_rule_id_fkey"
      columns: ["business_id","category_rule_id"]
isOneToOne: false
      referencedRelation: "category_rules"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "transactions_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "transactions_business_id_import_batch_id_fkey"
      columns: ["business_id","import_batch_id"]
isOneToOne: false
      referencedRelation: "import_batches"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "transactions_business_id_money_account_id_fkey"
      columns: ["business_id","money_account_id"]
isOneToOne: false
      referencedRelation: "account_balances"
      referencedColumns: ["business_id","account_id"]
    },{
      foreignKeyName: "transactions_business_id_money_account_id_fkey"
      columns: ["business_id","money_account_id"]
isOneToOne: false
      referencedRelation: "account_usage"
      referencedColumns: ["business_id","account_id"]
    },{
      foreignKeyName: "transactions_business_id_money_account_id_fkey"
      columns: ["business_id","money_account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "transactions_business_id_money_account_id_fkey"
      columns: ["business_id","money_account_id"]
isOneToOne: false
      referencedRelation: "category_picker"
      referencedColumns: ["business_id","id"]
    }
                  ]
                }
          }
          Views: {
            "mileage_trips_rated": {
                  Row: {
                    "id": string | null,"business_id": string | null,"date": string | null,"miles_tenths": number | null,"purpose": string | null,"start_place": string | null,"end_place": string | null,"vehicle": string | null,"created_at": string | null,"rate_tenth_cents": number | null,"deduction_cents": number | null
                  }
                  ComputedFields: never
                  Relationships: []
                },"account_balances": {
                  Row: {
                    "account_id": string | null,"balance_cents": number | null,"business_id": string | null,"is_money_account": boolean | null,"name": string | null,"natural_balance_cents": number | null,"type": Database["public"]['Enums']["account_type"] | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "accounts_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"account_usage": {
                  Row: {
                    "account_id": string | null,"business_id": string | null,"child_count": number | null,"line_count": number | null,"rule_count": number | null
                  }
                  ComputedFields: never
                  Insert: {
                           "account_id"?: string | null,"business_id"?: string | null,"child_count"?: never,"line_count"?: never,"rule_count"?: never
                         }
                        Update: {
                           "account_id"?: string | null,"business_id"?: string | null,"child_count"?: never,"line_count"?: never,"rule_count"?: never
                         }
                        Relationships: [
                    {
      foreignKeyName: "accounts_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    }
                  ]
                },"money_account_last_import": {
                  Row: {
                    "business_id": string | null,"last_committed_at": string | null,"last_statement_date": string | null,"money_account_id": string | null
                  }
                  ComputedFields: never
                  Relationships: []
                },"ai_suggestion_queue": {
                  Row: {
                    "amount_cents": number | null,"business_id": string | null,"category_account_id": string | null,"category_name": string | null,"confidence": number | null,"created_at": string | null,"date": string | null,"description_clean": string | null,"description_raw": string | null,"flags": (string)[] | null,"id": string | null,"model": string | null,"money_account_id": string | null,"reason": string | null,"runner_up_category_account_id": string | null,"runner_up_confidence": number | null,"runner_up_name": string | null,"transaction_id": string | null,"vendor_has_history": boolean | null,"vendor_normalized": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "ai_suggestions_business_id_category_account_id_fkey"
      columns: ["business_id","category_account_id"]
isOneToOne: false
      referencedRelation: "account_balances"
      referencedColumns: ["business_id","account_id"]
    },{
      foreignKeyName: "ai_suggestions_business_id_category_account_id_fkey"
      columns: ["business_id","category_account_id"]
isOneToOne: false
      referencedRelation: "account_usage"
      referencedColumns: ["business_id","account_id"]
    },{
      foreignKeyName: "ai_suggestions_business_id_category_account_id_fkey"
      columns: ["business_id","category_account_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "ai_suggestions_business_id_category_account_id_fkey"
      columns: ["business_id","category_account_id"]
isOneToOne: false
      referencedRelation: "category_picker"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "ai_suggestions_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ai_suggestions_business_id_transaction_id_fkey"
      columns: ["business_id","transaction_id"]
isOneToOne: false
      referencedRelation: "transactions"
      referencedColumns: ["business_id","id"]
    }
                  ]
                },"category_picker": {
                  Row: {
                    "business_id": string | null,"description": string | null,"id": string | null,"is_money_account": boolean | null,"is_standard": boolean | null,"name": string | null,"parent_id": string | null,"subtype": string | null,"type": Database["public"]['Enums']["account_type"] | null
                  }
                  ComputedFields: never
                  Insert: {
                           "business_id"?: string | null,"description"?: string | null,"id"?: string | null,"is_money_account"?: boolean | null,"is_standard"?: boolean | null,"name"?: string | null,"parent_id"?: string | null,"subtype"?: string | null,"type"?: Database["public"]['Enums']["account_type"] | null
                         }
                        Update: {
                           "business_id"?: string | null,"description"?: string | null,"id"?: string | null,"is_money_account"?: boolean | null,"is_standard"?: boolean | null,"name"?: string | null,"parent_id"?: string | null,"subtype"?: string | null,"type"?: Database["public"]['Enums']["account_type"] | null
                         }
                        Relationships: [
                    {
      foreignKeyName: "accounts_business_id_fkey"
      columns: ["business_id"]
isOneToOne: false
      referencedRelation: "businesses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "accounts_business_id_parent_id_fkey"
      columns: ["business_id","parent_id"]
isOneToOne: false
      referencedRelation: "account_balances"
      referencedColumns: ["business_id","account_id"]
    },{
      foreignKeyName: "accounts_business_id_parent_id_fkey"
      columns: ["business_id","parent_id"]
isOneToOne: false
      referencedRelation: "account_usage"
      referencedColumns: ["business_id","account_id"]
    },{
      foreignKeyName: "accounts_business_id_parent_id_fkey"
      columns: ["business_id","parent_id"]
isOneToOne: false
      referencedRelation: "accounts"
      referencedColumns: ["business_id","id"]
    },{
      foreignKeyName: "accounts_business_id_parent_id_fkey"
      columns: ["business_id","parent_id"]
isOneToOne: false
      referencedRelation: "category_picker"
      referencedColumns: ["business_id","id"]
    }
                  ]
                }
          }
          Functions: {
            "accept_ai_suggestion":
{ Args: { "p_suggestion_id": string }; Returns: string
                           },
"accept_ai_suggestions_above":
{ Args: { "p_business_id": string,"p_expected_count": number,"p_min_confidence": number }; Returns: number
                           },
"accept_my_invites":
{ Args: Record<PropertyKey, never>; Returns: string[]
                           },
"rate_limit_hit":
{ Args: { "p_bucket": string,"p_key": string,"p_max": number,"p_window_seconds": number }; Returns: boolean
                           },
"ai_budget":
{ Args: { "p_business_id": string }; Returns: {
              "budget": number,"month": string,"remaining": number,"used": number
            }[]
                           },
"ai_candidates":
{ Args: { "p_business_id": string,"p_limit"?: number }; Returns: {
              "amount_cents": number,"date": string,"description_clean": string,"id": string,"is_large": boolean,"memo": string,"money_account_kind": string,"recurring_cadence": string,"vendor_categories": (string)[],"vendor_normalized": string
            }[]
                           },
"ai_context":
{ Args: { "p_business_id": string }; Returns: Json
                           },
"ai_request_done":
{ Args: { "p_business_id": string,"p_request_key": string }; Returns: boolean
                           },
"monthly_income_expense":
{ Args: { "p_business_id": string,"p_months": number,"p_through"?: string }; Returns: {
              "expense_cents": number,"income_cents": number,"month": string
            }[]
                           },
"money_movement":
{ Args: { "p_business_id": string,"p_from": string,"p_to": string }; Returns: {
              "amount_cents": number,"direction": string,"is_vendor": boolean,"label": string,"rank": number,"total_cents": number
            }[]
                           },
"overview_notes":
{ Args: { "p_business_id": string,"p_from": string,"p_to": string }; Returns: {
              "detail": string,"headline": string,"kind": string,"link_params": Json
            }[]
                           },
"auto_file_suggestions":
{ Args: { "p_business_id": string }; Returns: number
                           },
"set_business_archived":
{ Args: { "p_archived": boolean,"p_business_id": string }; Returns: undefined
                           },
"category_period_stats":
{ Args: { "p_business_id": string,"p_from": string,"p_to": string }; Returns: {
              "category_account_id": string | null,"grp": string,"is_new": boolean,"total_cents": number,"tx_count": number
            }[]
                           },
"category_monthly":
{ Args: { "p_account_id": string,"p_business_id": string,"p_months": number,"p_through"?: string }; Returns: {
              "month": string,"total_cents": number,"tx_count": number
            }[]
                           },
"flip_committed_import":
{ Args: { "p_batch_id": string }; Returns: number
                           },
"transfer_match_candidates":
{ Args: { "p_business_id": string,"p_limit"?: number }; Returns: {
              "amount_cents": number,"days": number | null,"in_account_id": string | null,"in_date": string | null,"in_description": string | null,"in_transaction_id": string | null,"kind": string,"out_account_id": string,"out_date": string,"out_description": string,"out_transaction_id": string,"worded": boolean
            }[]
                           },
"confirm_transfer_match":
{ Args: { "p_in_transaction_id": string,"p_out_transaction_id": string }; Returns: string
                           },
"unmatch_transfer":
{ Args: { "p_match_id": string }; Returns: undefined
                           },
"dismiss_transfer_candidate":
{ Args: { "p_in_transaction_id"?: string,"p_out_transaction_id": string }; Returns: undefined
                           },
"depreciation_through":
{ Args: { "p_method": string,"p_cost": number,"p_salvage": number,"p_life_months": number,"p_in_service": string,"p_disposed": string,"p_through": string }; Returns: number
                           },
"create_fixed_asset":
{ Args: { "p_business_id": string,"p_name": string,"p_kind": string,"p_acquired_on": string,"p_in_service_on": string,"p_cost_cents": number,"p_salvage_cents"?: number,"p_method"?: string,"p_life_months"?: number,"p_purchase_transaction_id"?: string,"p_notes"?: string }; Returns: string
                           },
"update_fixed_asset":
{ Args: { "p_asset_id": string,"p_name": string,"p_kind": string,"p_acquired_on": string,"p_in_service_on": string,"p_cost_cents": number,"p_salvage_cents": number,"p_method": string,"p_life_months": number,"p_disposed_on": string,"p_notes": string }; Returns: undefined
                           },
"delete_fixed_asset":
{ Args: { "p_asset_id": string }; Returns: undefined
                           },
"post_depreciation":
{ Args: { "p_business_id": string,"p_through": string }; Returns: number
                           },
"undo_depreciation":
{ Args: { "p_business_id": string }; Returns: number
                           },
"fixed_asset_summary":
{ Args: { "p_business_id": string,"p_as_of": string }; Returns: {
              "asset_id": string,"posted_cents": number,"scheduled_cents": number,"last_through": string | null,"book_value_cents": number,"monthly_cents": number
            }[]
                           },
"large_purchase_candidates":
{ Args: { "p_business_id": string,"p_min_cents"?: number,"p_since"?: string }; Returns: {
              "transaction_id": string,"date": string,"description": string,"amount_cents": number,"category_account_id": string | null,"money_account_id": string
            }[]
                           },
"tax_item_candidates":
{ Args: { "p_business_id": string,"p_from": string,"p_to": string }; Returns: {
              "kind": string,"transaction_id": string,"date": string,"description": string,"amount_cents": number
            }[]
                           },
"my_firms":
{ Args: never; Returns: { "firm_id": string,"name": string,"role": Database["public"]["Enums"]["firm_role"] }[]
                           },
"rename_firm":
{ Args: { "p_firm_id": string,"p_name": string }; Returns: undefined
                           },
"firm_member_list":
{ Args: { "p_firm_id": string }; Returns: { "user_id": string,"email": string,"role": Database["public"]["Enums"]["firm_role"],"all_clients": boolean,"client_role": Database["public"]["Enums"]["member_role"],"business_ids": string[],"joined_at": string }[]
                           },
"invite_firm_member":
{ Args: { "p_firm_id": string,"p_email": string,"p_role": Database["public"]["Enums"]["firm_role"],"p_all_clients"?: boolean,"p_client_role"?: Database["public"]["Enums"]["member_role"],"p_business_ids"?: string[] }; Returns: string
                           },
"cancel_firm_invite":
{ Args: { "p_invite_id": string }; Returns: undefined
                           },
"update_firm_member":
{ Args: { "p_firm_id": string,"p_user_id": string,"p_role": Database["public"]["Enums"]["firm_role"],"p_all_clients": boolean,"p_client_role": Database["public"]["Enums"]["member_role"],"p_business_ids": string[] }; Returns: undefined
                           },
"remove_firm_member":
{ Args: { "p_firm_id": string,"p_user_id": string }; Returns: undefined
                           },
"vendor_totals":
{ Args: { "p_business_id": string,"p_direction"?: string,"p_from"?: string,"p_limit"?: number,"p_to"?: string }; Returns: {
              "label": string,"total_cents": number,"tx_count": number,"vendor_normalized": string
            }[]
                           },
"category_top_vendors":
{ Args: { "p_account_id": string,"p_business_id": string,"p_from": string,"p_limit"?: number,"p_to": string }; Returns: {
              "total_cents": number,"tx_count": number,"vendor": string
            }[]
                           },
"money_account_month_end":
{ Args: { "p_account_id": string,"p_business_id": string,"p_months": number,"p_through"?: string }; Returns: {
              "balance_cents": number,"month_end": string
            }[]
                           },
"ai_vendor_history":
{ Args: { "p_business_id": string,"p_vendors": (string)[] }; Returns: {
              "category_account_id": string,"n": number,"vendor_normalized": string,"vendor_total": number
            }[]
                           },
"apply_rule_run":
{ Args: { "p_business_id": string,"p_expected_count": number,"p_from": string,"p_rule_ids": (string)[],"p_to": string,"p_transaction_ids": (string)[] }; Returns: Json
                           },
"approve_rule":
{ Args: { "p_rule_id": string }; Returns: undefined
                           },
"business_member_list":
{ Args: { "p_business_id": string }; Returns: {
              "email": string,"joined_at": string,"role": Database["public"]['Enums']["member_role"],"user_id": string
            }[]
                           },
"categorize_transactions":
{ Args: { "p_category_account_id": string,"p_transaction_ids": (string)[] }; Returns: number
                           },
"commit_import":
{ Args: { "p_batch_id": string,"p_expected_count": number }; Returns: number
                           },
"count_ai_suggestions_above":
{ Args: { "p_business_id": string,"p_min_confidence": number }; Returns: number
                           },
"create_business":
{ Args: { "p_books_start_date"?: string,"p_currency"?: string,"p_fiscal_year_start_month"?: number,"p_legal_name"?: string,"p_name": string }; Returns: string
                           },
"create_money_account":
{ Args: { "p_business_id": string,"p_kind": string,"p_last4"?: string,"p_name": string,"p_opening_balance_cents"?: number,"p_opening_date"?: string }; Returns: string
                           },
"delete_category_rule":
{ Args: { "p_rule_id": string }; Returns: undefined
                           },
"delete_rule":
{ Args: { "p_revert"?: boolean,"p_rule_id": string }; Returns: number
                           },
"discard_reconciliation":
{ Args: { "p_reconciliation_id": string }; Returns: undefined
                           },
"duplicate_rule":
{ Args: { "p_rule_id": string }; Returns: string
                           },
"finish_reconciliation":
{ Args: { "p_reconciliation_id": string }; Returns: undefined
                           },
"flip_import_sign":
{ Args: { "p_batch_id": string }; Returns: undefined
                           },
"insights":
{ Args: { "p_business_id": string,"p_from": string,"p_to": string }; Returns: Json
                           },
"invite_member":
{ Args: { "p_business_id": string,"p_email": string,"p_role": Database["public"]['Enums']["member_role"] }; Returns: string
                           },
"mark_transaction_rule":
{ Args: { "p_rule_id": string,"p_transaction_id": string }; Returns: boolean
                           },
"merge_category":
{ Args: { "p_from": string,"p_into": string }; Returns: number
                           },
"post_transaction":
{ Args: { "p_amount_cents": number,"p_business_id": string,"p_category_account_id"?: string,"p_date": string,"p_dedupe_hash"?: string,"p_description_clean"?: string,"p_description_raw": string,"p_import_batch_id"?: string,"p_memo"?: string,"p_money_account_id": string,"p_reference"?: string,"p_source"?: Database["public"]['Enums']["transaction_source"],"p_vendor_normalized"?: string }; Returns: string
                           },
"preview_rule_run":
{ Args: { "p_business_id": string,"p_from"?: string,"p_rule_ids"?: (string)[],"p_to"?: string }; Returns: {
              "amount_cents": number,"current_category_id": string,"current_memo": string,"date": string,"description": string,"new_category_id": string,"new_memo": string,"rule_id": string,"rule_name": string,"transaction_id": string
            }[]
                           },
"reconciliation_lines":
{ Args: { "p_reconciliation_id": string }; Returns: {
              "amount_cents": number,"cleared": boolean,"date": string,"description": string,"transaction_id": string
            }[]
                           },
"reconciliation_summary":
{ Args: { "p_reconciliation_id": string }; Returns: {
              "beginning_cents": number,"cleared_balance_cents": number,"cleared_cents": number,"cleared_count": number,"difference_cents": number,"statement_balance_cents": number
            }[]
                           },
"record_ai_explanation":
{ Args: { "p_business_id": string,"p_from": string,"p_input_hash": string,"p_input_tokens": number,"p_latency_ms": number,"p_model": string,"p_output_tokens": number,"p_prompt_version": string,"p_summary": string,"p_to": string }; Returns: undefined
                           },
"record_ai_suggestions":
{ Args: { "p_business_id": string,"p_input_tokens": number,"p_latency_ms": number,"p_model": string,"p_output_tokens": number,"p_prompt_version": string,"p_request_key": string,"p_suggestions": Json }; Returns: Json
                           },
"refresh_patterns":
{ Args: { "p_business_id": string }; Returns: Json
                           },
"reject_ai_suggestion":
{ Args: { "p_suggestion_id": string }; Returns: undefined
                           },
"reorder_rules":
{ Args: { "p_business_id": string,"p_rule_ids": (string)[] }; Returns: undefined
                           },
"report_balance_sheet":
{ Args: { "p_as_of": string,"p_business_id": string,"p_cmp_as_of"?: string }; Returns: {
              "account_id": string,"cmp_own_cents": number,"cmp_total_cents": number,"depth": number,"has_children": boolean,"is_money_account": boolean,"key": string,"line_type": string,"name": string,"own_cents": number,"parent_id": string,"section": string,"sort_order": number,"subtree_ids": (string)[],"subtype": string,"total_cents": number
            }[]
                           },
"report_pnl":
{ Args: { "p_business_id": string,"p_cmp_from"?: string,"p_cmp_to"?: string,"p_from": string,"p_to": string }; Returns: {
              "account_id": string,"cmp_own_cents": number,"cmp_total_cents": number,"depth": number,"has_children": boolean,"is_uncategorized": boolean,"key": string,"line_type": string,"name": string,"own_cents": number,"parent_id": string,"section": string,"sort_order": number,"subtree_ids": (string)[],"total_cents": number
            }[]
                           },
"restore_transaction":
{ Args: { "p_transaction_id": string }; Returns: undefined
                           },
"restore_transactions":
{ Args: { "p_transaction_ids": (string)[] }; Returns: number
                           },
"rule_conflicts":
{ Args: { "p_business_id": string,"p_rule": Json }; Returns: {
              "category_id": string,"name": string,"overlap": number,"priority": number,"rule_id": string
            }[]
                           },
"rule_draft_matches":
{ Args: { "p_business_id": string,"p_limit"?: number,"p_rule": Json }; Returns: Json
                           },
"save_category_rule":
{ Args: { "p_business_id": string,"p_category_account_id": string,"p_vendor_normalized": string }; Returns: string
                           },
"save_rule":
{ Args: { "p_business_id": string,"p_rule": Json }; Returns: string
                           },
"search_transactions":
{ Args: { "p_amount_max"?: number,"p_amount_min"?: number,"p_business_id": string,"p_categorized_by"?: (string)[],"p_category_ids"?: (string)[],"p_deleted"?: boolean,"p_from"?: string,"p_import_batch_id"?: string,"p_money_account_ids"?: (string)[],"p_query"?: string,"p_query_cents"?: number,"p_sources"?: (Database["public"]['Enums']["transaction_source"])[],"p_to"?: string,"p_types"?: (string)[] }; Returns: {
              "amount_cents": number,
"business_id": string,
"category_account_id": string | null,
"category_rule_id": string | null,
"category_source": Database["public"]['Enums']["category_source"] | null,
"created_at": string,
"created_by": string | null,
"date": string,
"dedupe_hash": string | null,
"deleted_at": string | null,
"deleted_by": string | null,
"description_clean": string | null,
"description_raw": string,
"id": string,
"import_batch_id": string | null,
"kind": Database["public"]['Enums']["transaction_kind"],
"memo": string | null,
"money_account_id": string,
"reference": string | null,
"source": Database["public"]['Enums']["transaction_source"],
"updated_at": string,
"vendor_normalized": string | null
            }[]
                          SetofOptions: {
        from: "*"
        to: "transactions"
        isOneToOne: false
        isSetofReturn: true
      } },
"set_opening_balance":
{ Args: { "p_account_id": string,"p_balance_cents": number,"p_date": string }; Returns: string
                           },
"set_reconciliation_cleared":
{ Args: { "p_cleared": boolean,"p_reconciliation_id": string,"p_transaction_ids": (string)[] }; Returns: number
                           },
"set_rule_enabled":
{ Args: { "p_enabled": boolean,"p_rule_id": string }; Returns: undefined
                           },
"soft_delete_transaction":
{ Args: { "p_transaction_id": string }; Returns: undefined
                           },
"soft_delete_transactions":
{ Args: { "p_transaction_ids": (string)[] }; Returns: number
                           },
"start_reconciliation":
{ Args: { "p_money_account_id": string,"p_statement_balance_cents": number,"p_statement_date": string }; Returns: string
                           },
"summarize_transactions":
{ Args: { "p_amount_max"?: number,"p_amount_min"?: number,"p_business_id": string,"p_categorized_by"?: (string)[],"p_category_ids"?: (string)[],"p_deleted"?: boolean,"p_from"?: string,"p_import_batch_id"?: string,"p_money_account_ids"?: (string)[],"p_query"?: string,"p_query_cents"?: number,"p_sources"?: (Database["public"]['Enums']["transaction_source"])[],"p_to"?: string,"p_types"?: (string)[] }; Returns: {
              "count": number,"count_in": number,"count_out": number,"net": number,"total_in": number,"total_out": number,"uncategorized": number
            }[]
                           },
"test_rules":
{ Args: { "p_business_id": string,"p_row": Json }; Returns: Json
                           },
"transaction_history":
{ Args: { "p_transaction_id": string }; Returns: {
              "action": string,"actor_email": string,"after": Json,"at": string,"before": Json
            }[]
                           },
"undo_import":
{ Args: { "p_batch_id": string }; Returns: number
                           },
"undo_rule_run":
{ Args: { "p_run_id": string }; Returns: Json
                           },
"update_category_rule":
{ Args: { "p_category_account_id": string,"p_enabled": boolean,"p_rule_id": string }; Returns: undefined
                           },
"update_transaction":
{ Args: { "p_amount_cents": number,"p_category_account_id": string,"p_date": string,"p_dedupe_hash": string,"p_description_clean": string,"p_description_raw": string,"p_memo": string,"p_money_account_id": string,"p_reference": string,"p_transaction_id": string,"p_vendor_normalized": string }; Returns: string
                           },
"verify_import":
{ Args: { "p_batch_id": string }; Returns: undefined
                           }
          }
          Enums: {
            "account_type": "income"|"expense"|"asset"|"liability"|"equity","ai_suggestion_status": "pending"|"accepted"|"rejected"|"superseded","category_rule_source": "auto"|"manual","category_source": "user"|"rule"|"import"|"ai","import_batch_status": "staged"|"verified"|"committed"|"undone","import_row_decision": "include"|"exclude","import_row_status": "ok"|"error"|"duplicate"|"near_duplicate","firm_role": "admin"|"staff",
"member_role": "owner"|"editor"|"viewer","pattern_kind": "vendor"|"recurring"|"large","transaction_kind": "income"|"expense"|"transfer"|"equity"|"other","transaction_source": "manual"|"import"|"api"|"journal"
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
            "account_type": ["income", "expense", "asset", "liability", "equity"],"ai_suggestion_status": ["pending", "accepted", "rejected", "superseded"],"category_rule_source": ["auto", "manual"],"category_source": ["user", "rule", "import", "ai"],"import_batch_status": ["staged", "verified", "committed", "undone"],"import_row_decision": ["include", "exclude"],"import_row_status": ["ok", "error", "duplicate", "near_duplicate"],"firm_role": ["admin", "staff"],
"member_role": ["owner", "editor", "viewer"],"pattern_kind": ["vendor", "recurring", "large"],"transaction_kind": ["income", "expense", "transfer", "equity", "other"],"transaction_source": ["manual", "import", "api", "journal"]
          }
        }
} as const
