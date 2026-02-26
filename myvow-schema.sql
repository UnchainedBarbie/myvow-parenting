-- ============================================================
-- MyVow Parenting - Database Schema
-- Supabase (PostgreSQL)
-- ============================================================
-- Design principles:
--   1. Immutable message logs (no deletes, no edits after send)
--   2. Every action timestamped and attributed
--   3. Court-ready: every record exportable with chain of custody
--   4. Role-based access: parents see different views
--   5. AI processing is auditable (original + rewritten stored)
-- ============================================================

-- ========================
-- ENUMS
-- ========================

CREATE TYPE user_role AS ENUM ('parent', 'professional', 'admin');
CREATE TYPE case_status AS ENUM ('active', 'paused', 'closed');
CREATE TYPE message_direction AS ENUM ('incoming', 'outgoing');
CREATE TYPE message_status AS ENUM ('received', 'ai_processing', 'delivered', 'draft', 'pending_approval', 'approved', 'sent', 'failed');
CREATE TYPE ai_classification AS ENUM ('neutral', 'escalatory', 'manipulative', 'threatening', 'coercive');
CREATE TYPE expense_status AS ENUM ('submitted', 'approved', 'disputed', 'resolved');
CREATE TYPE expense_category AS ENUM ('medical', 'dental', 'therapy', 'school', 'extracurricular', 'clothing', 'childcare', 'transportation', 'other');
CREATE TYPE document_category AS ENUM ('medical', 'school', 'legal', 'therapy', 'financial', 'custody', 'other');
CREATE TYPE flag_type AS ENUM ('coercive_control', 'financial_threat', 'legal_intimidation', 'gaslighting', 'guilt_tripping', 'medical_control', 'schedule_manipulation', 'parental_alienation', 'verbal_aggression', 'other');
CREATE TYPE subscription_tier AS ENUM ('base', 'standard', 'premium');

-- ========================
-- USERS & AUTH
-- ========================

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    phone TEXT,
    role user_role DEFAULT 'parent',
    subscription_tier subscription_tier DEFAULT 'base',
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    timezone TEXT DEFAULT 'America/Denver',
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    last_login_at TIMESTAMPTZ,
    two_factor_enabled BOOLEAN DEFAULT false
);

-- ========================
-- CASES (a co-parenting pair)
-- ========================

CREATE TABLE cases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status case_status DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    
    -- Custody agreement details
    custody_split_percent DECIMAL(5,2) DEFAULT 50.00,  -- default 50/50 expense split
    custody_agreement_uploaded BOOLEAN DEFAULT false,
    
    -- AI settings per case
    ai_escalation_threshold DECIMAL(3,2) DEFAULT 0.70,  -- confidence below this = flag for review
    message_delay_minutes INT DEFAULT 0,                 -- buffered messaging (Phase 2)
    messaging_window_start TIME,                         -- time-based messaging windows (Phase 2)
    messaging_window_end TIME
);

-- ========================
-- CASE MEMBERS (links users to cases)
-- ========================

CREATE TABLE case_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id UUID REFERENCES cases(id) NOT NULL,
    user_id UUID REFERENCES users(id) NOT NULL,
    role TEXT DEFAULT 'parent',  -- 'parent', 'professional_viewer'
    is_primary BOOLEAN DEFAULT false,  -- the parent who created the case
    display_name TEXT,  -- how this person appears in the UI
    
    -- Single-parent mode: non-participating parent's email
    external_email TEXT,  -- Civil Communicator email or direct email
    is_participating BOOLEAN DEFAULT true,  -- false = email-only, not on platform
    
    joined_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    
    UNIQUE(case_id, user_id)
);

-- ========================
-- CHILDREN
-- ========================

CREATE TABLE children (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id UUID REFERENCES cases(id) NOT NULL,
    first_name TEXT NOT NULL,
    date_of_birth DATE,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- ========================
-- MESSAGES (the core - immutable log)
-- ========================

CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id UUID REFERENCES cases(id) NOT NULL,
    
    -- Direction & participants
    direction message_direction NOT NULL,
    sender_id UUID REFERENCES users(id),       -- NULL if from non-participating parent
    sender_external_email TEXT,                  -- for email-ingested messages
    
    -- Content (both versions stored for audit)
    original_content TEXT NOT NULL,              -- what was actually written/received
    ai_rewritten_content TEXT,                   -- the de-escalated/neutral version
    
    -- AI analysis
    ai_classification ai_classification,
    ai_confidence_score DECIMAL(3,2),           -- 0.00 to 1.00
    emotional_intensity_score DECIMAL(3,2),     -- 0.00 to 1.00
    ai_processing_metadata JSONB,               -- full AI response for audit
    
    -- Categorization
    category TEXT,                               -- Health, Expenses, Scheduling, etc.
    sub_category TEXT,                           -- Illness, School, etc.
    
    -- Status tracking
    current_status message_status DEFAULT 'received' NOT NULL,
    approved_at TIMESTAMPTZ,                    -- when sender approved the rewrite
    delivered_at TIMESTAMPTZ,                   -- when delivered to recipient
    read_at TIMESTAMPTZ,                        -- read receipt
    
    -- External system references
    external_comm_id TEXT,                       -- Civil Communicator Comm ID
    external_message_id TEXT,                    -- email Message-ID for threading
    
    -- Attachments flag
    has_attachments BOOLEAN DEFAULT false,
    
    -- Immutability
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    -- NO updated_at - messages are immutable after creation
    
    -- Hash for chain of custody
    content_hash TEXT  -- SHA-256 of original_content for integrity verification
);

-- Index for fast case-based queries
CREATE INDEX idx_messages_case_id ON messages(case_id);
CREATE INDEX idx_messages_created_at ON messages(created_at);
CREATE INDEX idx_messages_external_comm_id ON messages(external_comm_id);

-- ========================
-- MESSAGE FLAGS (pattern detection)
-- ========================

CREATE TABLE message_flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID REFERENCES messages(id) NOT NULL,
    case_id UUID REFERENCES cases(id) NOT NULL,
    
    flag_type flag_type NOT NULL,
    description TEXT,                            -- human-readable description
    ai_confidence DECIMAL(3,2),                 -- how confident the AI is in this flag
    
    -- Pattern tracking
    pattern_count INT DEFAULT 1,                -- how many times this pattern has appeared in the case
    
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX idx_flags_case_id ON message_flags(case_id);
CREATE INDEX idx_flags_type ON message_flags(flag_type);

-- ========================
-- EXPENSES
-- ========================

CREATE TABLE expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id UUID REFERENCES cases(id) NOT NULL,
    submitted_by UUID REFERENCES users(id) NOT NULL,
    
    -- Expense details
    description TEXT NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    category expense_category NOT NULL,
    child_id UUID REFERENCES children(id),      -- which child this is for
    
    -- Split calculation
    split_percent DECIMAL(5,2),                 -- override per-expense, or uses case default
    amount_owed DECIMAL(10,2),                  -- calculated: amount * other parent's split %
    
    -- Receipt
    receipt_file_id UUID,                       -- references documents table
    
    -- Approval workflow
    status expense_status DEFAULT 'submitted',
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    dispute_reason TEXT,                         -- if disputed, AI-moderated reason
    dispute_ai_rewritten TEXT,                   -- de-escalated dispute text
    resolved_at TIMESTAMPTZ,
    
    -- Immutable
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    content_hash TEXT
);

CREATE INDEX idx_expenses_case_id ON expenses(case_id);

-- ========================
-- DOCUMENTS (secure vault)
-- ========================

CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id UUID REFERENCES cases(id) NOT NULL,
    uploaded_by UUID REFERENCES users(id) NOT NULL,
    
    -- File details
    file_name TEXT NOT NULL,
    file_size_bytes BIGINT,
    mime_type TEXT,
    storage_path TEXT NOT NULL,                  -- Supabase Storage path
    
    -- Categorization
    category document_category NOT NULL,
    child_id UUID REFERENCES children(id),
    description TEXT,
    
    -- AI processing
    ai_summary TEXT,                            -- auto-generated summary
    ocr_text TEXT,                              -- extracted text from images/PDFs
    searchable_content TSVECTOR,                -- full-text search
    
    -- Integrity
    content_hash TEXT NOT NULL,                  -- SHA-256 of file
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX idx_documents_case_id ON documents(case_id);
CREATE INDEX idx_documents_search ON documents USING GIN(searchable_content);

-- ========================
-- DOCUMENT ACCESS LOG (who viewed what, when)
-- ========================

CREATE TABLE document_access_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID REFERENCES documents(id) NOT NULL,
    user_id UUID REFERENCES users(id) NOT NULL,
    action TEXT NOT NULL,  -- 'viewed', 'downloaded', 'exported'
    ip_address INET,
    accessed_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- ========================
-- CALENDAR EVENTS
-- ========================

CREATE TABLE calendar_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id UUID REFERENCES cases(id) NOT NULL,
    created_by UUID REFERENCES users(id) NOT NULL,
    
    -- Event details
    title TEXT NOT NULL,
    description TEXT,
    event_type TEXT,  -- 'custody', 'medical', 'school', 'extracurricular', 'swap_request'
    child_id UUID REFERENCES children(id),
    
    -- Timing
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ,
    all_day BOOLEAN DEFAULT false,
    recurring_rule TEXT,  -- iCal RRULE format
    
    -- Swap requests (go through AI moderation)
    is_swap_request BOOLEAN DEFAULT false,
    swap_status TEXT,  -- 'requested', 'approved', 'declined'
    swap_original_message TEXT,
    swap_ai_rewritten TEXT,
    swap_responded_by UUID REFERENCES users(id),
    swap_responded_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX idx_calendar_case_id ON calendar_events(case_id);
CREATE INDEX idx_calendar_start ON calendar_events(start_time);

-- ========================
-- COURT EXPORT LOG (audit trail of exports)
-- ========================

CREATE TABLE court_exports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id UUID REFERENCES cases(id) NOT NULL,
    exported_by UUID REFERENCES users(id) NOT NULL,
    
    -- Export details
    export_type TEXT NOT NULL,  -- 'messages', 'expenses', 'patterns', 'full_report'
    date_range_start TIMESTAMPTZ,
    date_range_end TIMESTAMPTZ,
    
    -- File
    file_path TEXT,
    file_hash TEXT,  -- SHA-256 of exported file
    
    -- Verification
    verification_hash TEXT,  -- hash of all included records for integrity check
    record_count INT,
    
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- ========================
-- PATTERN SUMMARIES (aggregated over time)
-- ========================

CREATE TABLE pattern_summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id UUID REFERENCES cases(id) NOT NULL,
    
    -- Pattern data
    flag_type flag_type NOT NULL,
    occurrence_count INT DEFAULT 0,
    first_detected_at TIMESTAMPTZ,
    last_detected_at TIMESTAMPTZ,
    
    -- AI-generated neutral summary
    ai_summary TEXT,
    
    -- Escalation scoring
    escalation_score DECIMAL(3,2),  -- 0.00 to 1.00, trends over time
    trend TEXT,  -- 'increasing', 'stable', 'decreasing'
    
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX idx_patterns_case_id ON pattern_summaries(case_id);

-- ========================
-- ROW LEVEL SECURITY (Supabase)
-- ========================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE children ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_access_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE court_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE pattern_summaries ENABLE ROW LEVEL SECURITY;

-- Users can only see their own profile
CREATE POLICY "users_own_profile" ON users
    FOR ALL USING (auth.uid() = id);

-- Parents can only see cases they belong to
CREATE POLICY "case_members_own" ON case_members
    FOR ALL USING (user_id = auth.uid());

-- Messages visible only to case members
CREATE POLICY "messages_case_members" ON messages
    FOR SELECT USING (
        case_id IN (
            SELECT case_id FROM case_members WHERE user_id = auth.uid()
        )
    );

-- Messages can be inserted but never updated or deleted
CREATE POLICY "messages_insert_only" ON messages
    FOR INSERT WITH CHECK (true);

-- No update or delete policies for messages = immutable

-- Expenses visible to case members
CREATE POLICY "expenses_case_members" ON expenses
    FOR ALL USING (
        case_id IN (
            SELECT case_id FROM case_members WHERE user_id = auth.uid()
        )
    );

-- Documents visible to case members
CREATE POLICY "documents_case_members" ON documents
    FOR ALL USING (
        case_id IN (
            SELECT case_id FROM case_members WHERE user_id = auth.uid()
        )
    );

-- Calendar visible to case members
CREATE POLICY "calendar_case_members" ON calendar_events
    FOR ALL USING (
        case_id IN (
            SELECT case_id FROM case_members WHERE user_id = auth.uid()
        )
    );

-- ========================
-- FUNCTIONS
-- ========================

-- Auto-hash message content on insert
CREATE OR REPLACE FUNCTION hash_message_content()
RETURNS TRIGGER AS $$
BEGIN
    NEW.content_hash := encode(sha256(NEW.original_content::bytea), 'hex');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_hash_message
    BEFORE INSERT ON messages
    FOR EACH ROW EXECUTE FUNCTION hash_message_content();

-- Auto-hash expense content on insert
CREATE OR REPLACE FUNCTION hash_expense_content()
RETURNS TRIGGER AS $$
BEGIN
    NEW.content_hash := encode(sha256((NEW.description || NEW.amount::text)::bytea), 'hex');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_hash_expense
    BEFORE INSERT ON expenses
    FOR EACH ROW EXECUTE FUNCTION hash_expense_content();

-- Update pattern summary when flag is created
CREATE OR REPLACE FUNCTION update_pattern_summary()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO pattern_summaries (case_id, flag_type, occurrence_count, first_detected_at, last_detected_at)
    VALUES (NEW.case_id, NEW.flag_type, 1, now(), now())
    ON CONFLICT (case_id, flag_type)
    DO UPDATE SET
        occurrence_count = pattern_summaries.occurrence_count + 1,
        last_detected_at = now(),
        updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Need unique constraint for upsert
ALTER TABLE pattern_summaries ADD CONSTRAINT unique_case_flag UNIQUE (case_id, flag_type);

CREATE TRIGGER trigger_update_patterns
    AFTER INSERT ON message_flags
    FOR EACH ROW EXECUTE FUNCTION update_pattern_summary();

-- Prevent message deletion
CREATE OR REPLACE FUNCTION prevent_message_delete()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Messages cannot be deleted. This is an immutable audit log.';
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_no_message_delete
    BEFORE DELETE ON messages
    FOR EACH ROW EXECUTE FUNCTION prevent_message_delete();

-- Prevent message content updates (allow status updates only)
CREATE OR REPLACE FUNCTION restrict_message_update()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.original_content != OLD.original_content THEN
        RAISE EXCEPTION 'Original message content cannot be modified.';
    END IF;
    IF NEW.ai_rewritten_content IS DISTINCT FROM OLD.ai_rewritten_content 
       AND OLD.ai_rewritten_content IS NOT NULL THEN
        RAISE EXCEPTION 'AI rewritten content cannot be modified after initial processing.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_restrict_message_update
    BEFORE UPDATE ON messages
    FOR EACH ROW EXECUTE FUNCTION restrict_message_update();
