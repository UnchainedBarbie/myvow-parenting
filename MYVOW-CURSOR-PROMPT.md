# MyVow Parenting - MVP Build Specification for Cursor

## Project Overview
MyVow Parenting is an AI-mediated co-parenting communication platform. Parents never see each other's raw messages — all communication flows through an AI layer that de-escalates, rewrites neutral, flags coercive patterns, and maintains an immutable audit trail. Court-ready documentation is generated automatically.

This is NOT a chat app. This is conflict containment infrastructure with forensic-grade documentation.

## Tech Stack
- **Framework:** Next.js 14+ (App Router)
- **Database/Auth/Storage:** Supabase (already set up with schema — see below)
- **Payments:** Stripe (subscription model)
- **AI:** Anthropic Claude API (Sonnet 4.6) for message mediation
- **Styling:** Tailwind CSS
- **Deployment:** Vercel
- **PWA:** Progressive Web App (mobile-first, native apps in Phase 2)

## Design System

### Philosophy
Trauma-informed design. Calm, not clinical. No red alert visuals. No notification gamification. No emoji reactions. The interface should feel like a quiet room, not a courtroom.

### Colors
- Primary (Sage): #7B9E87
- Primary Light: #E8F0EB
- Primary Dark: #5A7D66
- Background: #FAF8F5 (warm cream)
- Background Secondary: #F0EDE8
- Text Primary: #2D3436 (charcoal)
- Text Secondary: #636E72 (soft gray)
- Alert/Flag: #C97B7B (muted rose — NOT red)
- Info: #7BA3C9 (soft blue)
- Success: #4ECB71

### Typography
- Headings: Playfair Display (serif, warmth)
- Body: DM Sans (clean, readable)
- Do NOT use Inter, Roboto, or Arial

### UI Principles
- No aggressive colors or alert styling
- Soft border radius (12-16px)
- Generous whitespace
- Muted, warm tones throughout
- Buttons are rounded pills with sage green
- Cards have subtle shadows (0 1px 3px rgba(0,0,0,0.04))
- The word "conflict" never appears in the UI — use "communication" instead

## Database Schema (Already deployed in Supabase)
The database is already set up. Key tables:

- **users** — app profiles linked to Supabase Auth
- **cases** — a co-parenting relationship (container for all data)
- **case_members** — links users to cases (supports single-parent mode with external_email)
- **children** — name + DOB, linked to a case
- **messages** — immutable log with original_content + ai_rewritten_content + classification + flags
- **message_events** — audit trail for every status change on a message
- **message_flags** — coercive pattern flags with type and AI confidence
- **pattern_summaries** — aggregated pattern data over time per case
- **expenses** — with receipt upload, split calculation, dispute workflow
- **documents** — secure vault with OCR, AI summary, access logging
- **document_access_log** — who viewed what, when
- **calendar_events** — custody schedule, swap requests (AI moderated)
- **court_exports** — log of every export with verification hashes

**IMPORTANT:** All writes go through server-side code (API routes) using Supabase Service Role. The client is read-only via RLS. Never insert/update/delete from the client.

## Authentication Flow
1. User signs up via Supabase Auth (email + password, Google OAuth optional)
2. On signup, a server function creates a row in public.users mirroring auth.users.id
3. User creates a case (or is invited to one)
4. Single-parent mode: one parent can set up a case with just the other parent's email — they don't need an account

## Pages & Routes (App Router)

### Public Pages
- `/` — Landing page (calm, benefit-focused, not fear-based)
- `/login` — Login
- `/signup` — Signup
- `/pricing` — Three tiers: Base ($25), Standard ($35), Premium ($50) per parent/month

### Authenticated Pages (Dashboard)
- `/dashboard` — Case overview (message summary, recent activity, pattern alerts)
- `/messages` — AI-mediated messaging interface (THE core screen)
  - Shows de-escalated incoming messages
  - Compose bar for sending intent → AI rewrite → approval flow
  - Category badges (Health, Expenses, Scheduling, etc.)
  - Pattern flags (muted rose, not alarming)
  - "View original" toggle (behind friction — hidden by default)
  - Comm ID references for each message
- `/expenses` — Expense tracker
  - Submit expense with receipt upload
  - Auto-split calculation based on custody agreement %
  - Approve/dispute workflow (disputes go through AI moderation)
  - Running balance ledger
- `/documents` — Secure document vault
  - Upload PDFs/images
  - Categorize (Medical, School, Legal, Therapy, Financial, Custody)
  - AI auto-summarization
  - Access log visible to user
- `/calendar` — Shared parenting calendar
  - Custody schedule visualization
  - Swap requests (AI moderated)
  - School/medical events
  - Conflict detection
- `/reports` — Court-ready exports
  - Date range selector
  - Export types: messages, expenses, patterns, full report
  - PDF and CSV output
  - Verification hash included in export
- `/settings` — Account & case settings
  - Profile management
  - Messaging window preferences (start/end times)
  - Court date blackout periods
  - Subscription management (Stripe)
  - Case settings (custody split %, AI threshold)

## AI Mediation Pipeline (API Route: /api/mediate)

### Incoming Message Processing
1. Receive raw message (from email ingestion or direct input)
2. Call Claude API with system prompt + message + case history context
3. Claude returns:
   - ai_classification (neutral/escalatory/manipulative/threatening/coercive)
   - ai_confidence_score (0-1)
   - emotional_intensity_score (0-1)
   - ai_rewritten_content (de-escalated version)
   - flags[] (array of {flag_type, description, confidence})
4. Store message with both original and rewritten content
5. Create message_flags entries
6. Create message_event (status: received → ai_processing → delivered)
7. Deliver rewritten version to recipient

### Outgoing Message Processing
1. User types their intent in natural language
2. Call Claude API to rewrite into calm, neutral, child-focused language
3. Present draft to user for approval
4. On approval, create message_event (status: approved → sent)
5. Send via email (or Civil Communicator reply)

### System Prompt (core mediation rules)
- Never deliver raw messages
- Extract factual substance, remove emotional charge
- Flag coercive control patterns (threats, intimidation, guilt-tripping, gaslighting, financial control, medical control, schedule manipulation, parental alienation)
- Keep responses brief — reduce communication volume
- Child-focused framing always
- No DARVO, no JADEing
- Document, don't argue

## API Routes Structure
All API routes use Supabase Service Role for writes.

```
/api/auth/signup — Create user profile on signup
/api/cases/create — Create case + add primary member
/api/cases/invite — Invite co-parent (or set external email)
/api/messages/ingest — Ingest incoming email (from webhook/cron)
/api/messages/draft — AI rewrite user intent → return draft
/api/messages/approve — Approve draft, send via email, log events
/api/expenses/submit — Submit expense with optional receipt
/api/expenses/respond — Approve or dispute (dispute goes through AI)
/api/documents/upload — Upload to Supabase Storage + create metadata
/api/calendar/create — Create event
/api/calendar/swap — Request swap (AI moderated)
/api/reports/export — Generate court-ready export
/api/stripe/webhook — Handle subscription events
```

## Supabase Connection
Environment variables needed:
```
NEXT_PUBLIC_SUPABASE_URL=your_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
ANTHROPIC_API_KEY=your_claude_api_key
STRIPE_SECRET_KEY=your_stripe_key
STRIPE_WEBHOOK_SECRET=your_webhook_secret
```

## File Structure
```
myvow-parenting/
├── app/
│   ├── layout.tsx              # Root layout with fonts + providers
│   ├── page.tsx                # Landing page
│   ├── login/page.tsx
│   ├── signup/page.tsx
│   ├── pricing/page.tsx
│   ├── (dashboard)/
│   │   ├── layout.tsx          # Dashboard layout with sidebar nav
│   │   ├── dashboard/page.tsx  # Case overview
│   │   ├── messages/page.tsx   # Core messaging interface
│   │   ├── expenses/page.tsx
│   │   ├── documents/page.tsx
│   │   ├── calendar/page.tsx
│   │   ├── reports/page.tsx
│   │   └── settings/page.tsx
│   └── api/
│       ├── auth/signup/route.ts
│       ├── messages/
│       │   ├── ingest/route.ts
│       │   ├── draft/route.ts
│       │   └── approve/route.ts
│       ├── expenses/
│       │   ├── submit/route.ts
│       │   └── respond/route.ts
│       ├── documents/upload/route.ts
│       ├── calendar/
│       │   ├── create/route.ts
│       │   └── swap/route.ts
│       ├── reports/export/route.ts
│       └── stripe/webhook/route.ts
├── components/
│   ├── ui/                     # Reusable UI components
│   ├── messages/               # Messaging-specific components
│   ├── expenses/               # Expense-specific components
│   ├── documents/              # Document-specific components
│   └── calendar/               # Calendar-specific components
├── lib/
│   ├── supabase/
│   │   ├── client.ts           # Browser client (anon key, read-only)
│   │   └── server.ts           # Server client (service role, writes)
│   ├── ai/
│   │   ├── mediate.ts          # Claude API integration
│   │   └── prompts.ts          # System prompts
│   ├── stripe.ts               # Stripe integration
│   └── utils.ts                # Helpers
├── public/
├── tailwind.config.ts
├── .env.local
└── package.json
```

## Build Priority (what to scaffold first)
1. Project setup (Next.js + Tailwind + Supabase client)
2. Auth flow (signup/login)
3. Dashboard layout with sidebar
4. Messages page (the core product — most important screen)
5. API route for message drafting (/api/messages/draft)
6. Expenses page
7. Documents page
8. Calendar page
9. Reports/export page
10. Stripe integration
11. Landing page + pricing

## Key Reminders
- Mobile-first responsive design (PWA)
- All writes through API routes with service role — NEVER client-side writes
- Messages are immutable — use message_events for status changes
- The UI should feel calm, not clinical or corporate
- Every action that touches data should be auditable
- The messaging interface IS the product — spend 60% of UI effort there
