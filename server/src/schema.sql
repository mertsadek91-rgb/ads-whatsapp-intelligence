-- MySQL schema (tables in connection DB, prefixed ads_). Idempotent.

create table if not exists ads_meta_daily (
    `date` date not null, level varchar(32) not null, entity_id varchar(191) not null,
    entity_name text, campaign_id varchar(191), campaign_name text,
    spend_aed decimal(14,2), impressions bigint, reach bigint, clicks bigint,
    ctr_pct decimal(6,3), cpc_aed decimal(10,3), cpm_aed decimal(10,3), frequency decimal(6,3),
    results int, cost_per_result_aed decimal(12,3), effective_status varchar(64),
    loaded_at datetime default current_timestamp,
    primary key (`date`, level, entity_id)
);

create table if not exists ads_meta_country_daily (
    `date` date not null, country varchar(8) not null,
    spend_aed decimal(14,2), impressions bigint, clicks bigint,
    ctr_pct decimal(6,3), cpc_aed decimal(10,3), cpm_aed decimal(10,3),
    loaded_at datetime default current_timestamp,
    primary key (`date`, country)
);

create table if not exists ads_wati_contacts (
    wa_id varchar(191) primary key, bsuid varchar(191), full_name text, phone varchar(64),
    created_date date, created_at datetime, country varchar(64), source varchar(64),
    ctwa_clid varchar(191), source_ad_id varchar(191), source_url text, source_headline text,
    lead_stage varchar(128), stage varchar(32), contact_owner varchar(191), assigned_agent varchar(191),
    tags json, attributes json, first_response_min decimal(8,1), num_messages int, is_answered tinyint(1),
    last_status varchar(64), last_message_at datetime, cx_score varchar(64), lead_score int,
    score_band varchar(16), score_reasons text, deposit_flag tinyint(1) default 0,
    -- Which connected WhatsApp business number the contact belongs to (from the
    -- Wati whatsapp_<number> custom param). msg_unavailable=1 means Wati has no
    -- readable conversation for this contact under the token we hold (a SECOND
    -- business number whose API credentials aren't configured) — such contacts
    -- must NOT be counted as "not contacted / negligence" in reports.
    business_channel varchar(32), msg_unavailable tinyint(1) default 0,
    -- ISO-2 country DERIVED FROM THE PHONE dial code (Wati's own `country`
    -- field is empty for every contact). Stored rather than computed per
    -- request so the assignment page can filter/paginate by country in SQL.
    country_iso2 varchar(2),
    -- Wati's own internal contact id (Mongo-style, e.g. "6a7308210a15b3763c06c318")
    -- and its "Allow Campaign" toggle. Both come straight off getContacts —
    -- needed because Wati's real broadcast-send endpoint (see lib/broadcast.js)
    -- targets contacts by THIS id, not by wa_id/phone.
    wati_contact_id varchar(64), allow_broadcast tinyint(1) default 1,
    raw json, loaded_at datetime default current_timestamp,
    index ix_wati_ad (source_ad_id), index ix_wati_day (created_date),
    index ix_wati_stage (stage), index ix_wati_phone (phone), index ix_wati_channel (business_channel)
);

create table if not exists ads_meta_ad_perf (
    ad_id varchar(191) primary key, ad_name text, campaign_id varchar(191), campaign_name text,
    adset_id varchar(191), adset_name text,
    status varchar(32), spend_aed decimal(14,2), impressions bigint, reach bigint, clicks bigint,
    ctr_pct decimal(6,3), cpc_aed decimal(10,3), cpm_aed decimal(10,3), frequency decimal(6,3),
    results int, cpr_aed decimal(12,3), period_since date, period_until date,
    -- Creative image (signed Meta CDN URL, refreshed by every sync — expires
    -- eventually, so never treat as a permanent asset link).
    thumbnail_url text,
    -- The REAL post text (caption) from the creative — what content analysis
    -- must read; the ad NAME is an internal label and can be misleading.
    creative_body text,
    -- video | carousel | image, from the creative's object_story_spec shape.
    media_type varchar(16),
    loaded_at datetime default current_timestamp,
    index ix_ad_campaign (campaign_id), index ix_ad_adset (adset_id)
);

create table if not exists ads_meta_adset_perf (
    adset_id varchar(191) primary key, adset_name text, campaign_id varchar(191), campaign_name text,
    status varchar(32), spend_aed decimal(14,2), impressions bigint, clicks bigint,
    ctr_pct decimal(6,3), cpc_aed decimal(10,3), cpm_aed decimal(10,3), frequency decimal(6,3),
    result_type varchar(128), results int, cpr_aed decimal(12,3), period_since date, period_until date,
    loaded_at datetime default current_timestamp,
    index ix_adset_campaign (campaign_id)
);

create table if not exists ads_meta_campaign_perf (
    campaign_id varchar(191) primary key, campaign_name text, objective varchar(64), status varchar(32),
    spend_aed decimal(14,2), impressions bigint, clicks bigint, ctr_pct decimal(6,3), cpm_aed decimal(10,3),
    frequency decimal(6,3), result_type varchar(128), results int, cpr_aed decimal(12,3),
    period_since date, period_until date, loaded_at datetime default current_timestamp
);

create table if not exists ads_meta_month (
    month varchar(7), campaign_id varchar(191), spend_aed decimal(14,2), impressions bigint,
    clicks bigint, results int, primary key (month, campaign_id)
);

create table if not exists ads_report_runs (
    run_date date primary key, built_at datetime default current_timestamp, summary text
);

-- key/value settings (Meta token + expiry live here so it survives restarts & auto-refresh)
create table if not exists ads_settings (
    k varchar(64) primary key,
    v text,
    updated_at datetime default current_timestamp on update current_timestamp
);

-- Cheap (no-AI) conversation engagement metrics + classification. Powers
-- re-engagement lists, smart pre-filtering, and staleness detection.
create table if not exists ads_conversation_meta (
    wa_id varchar(191) primary key,
    msg_total int default 0,
    customer_msgs int default 0,
    agent_msgs int default 0,          -- human agents (operator != Bot)
    bot_msgs int default 0,
    human_replied tinyint(1) default 0,
    conv_type varchar(20),             -- bot_only | human_handled | awaiting_human | abandoned | no_customer
    last_dir varchar(4),               -- in | out
    -- Did the customer say anything AFTER a human employee replied? Read from
    -- the message ORDER, not the counts: "hi" then "hello?" before anyone
    -- answers is two customer messages and still no reply to us. This is the
    -- conversion denominator's gate — an employee cannot convert someone who
    -- never came back, so those leads are measured as lead quality, not as a
    -- conversion failure.
    replied_after_agent tinyint(1) default 0,
    first_human_response_min numeric(10,1),
    last_activity datetime,
    synced_at datetime default current_timestamp on update current_timestamp,
    index ix_meta_type (conv_type)
);

-- cached AI aggregate insights (themes / coaching) — generated on demand
create table if not exists ads_ai_insights (
    k varchar(64) primary key,         -- e.g. 'themes', 'coaching:<agent>'
    data json,
    generated_at datetime default current_timestamp on update current_timestamp
);

-- AI conversation analysis (DeepSeek) — one row per contact/conversation.
create table if not exists ads_conversation_analysis (
    wa_id varchar(191) primary key,
    conv_score int,                       -- 0..100 conversation quality / conversion likelihood
    lead_intent varchar(16),              -- hot | warm | cold
    lead_status varchar(191),             -- short label e.g. "مهتم بحساب حقيقي"
    summary text,                         -- what happened (Arabic)
    customer_details json,                -- needs, objections, deposit_intent, account_type…
    agent_name varchar(191),
    agent_score int,                      -- 0..100 employee performance
    agent_eval json,                      -- communication, follow_up, persuasion issues, tips…
    follow_up_min numeric(10,1),          -- avg agent response gap (computed)
    wrong_persuasion tinyint(1) default 0,
    flags json,
    message_count int,
    model varchar(64),
    raw json,
    -- The exact message thread (ts/dir/sender/type/body) fed to the AI at
    -- analysis time (BUG-018 fix). Wati's live API isn't guaranteed to
    -- return identical data forever, so this is what makes a stored
    -- analysis reproducible/auditable — and it's what a manager/employee
    -- actually reviews for coaching, not just the AI's summary of it.
    -- Approved for storage 2026-07-08 (educational/training use only).
    thread_snapshot json,
    analyzed_at datetime default current_timestamp on update current_timestamp,
    index ix_conv_agent (agent_name)
);

-- Minimum-viable auth (BUG-002/SEC-2 fix): real per-user accounts replacing
-- the single shared APP_PASSWORD. Full RBAC (roles/permissions matrix,
-- planning/16) is a later phase — this just retires the shared password.
create table if not exists ads_users (
    id int auto_increment primary key,
    email varchar(191) not null,
    password_hash varchar(255) not null,
    role varchar(32) not null default 'admin',
    status enum('active','disabled') not null default 'active',
    created_at datetime default current_timestamp,
    last_login_at datetime,
    unique key ux_users_email (email)
);

create table if not exists ads_login_logs (
    id bigint auto_increment primary key,
    email varchar(191),
    success tinyint(1) not null,
    ip varchar(64),
    user_agent varchar(255),
    created_at datetime default current_timestamp,
    index ix_login_email_time (email, created_at)
);

-- Manual review data entered by the user for qualified leads.
create table if not exists ads_lead_review (
    wa_id varchar(191) primary key, phone varchar(64),
    account_type enum('unknown','demo','real') default 'unknown',
    deposit_count int default 0, deposit_total_aed decimal(14,2) default 0,
    review_status enum('new','reviewing','contacted','converted','lost') default 'new',
    reviewed_by varchar(128), reviewed_at datetime, notes text,
    updated_at datetime default current_timestamp on update current_timestamp
);

-- BUG-025 fix: append-only history of every review edit (who changed what,
-- when) — `ads_lead_review` above only ever held the latest snapshot with a
-- hardcoded "admin" author, which made every deposit/status edit untraceable.
create table if not exists ads_lead_review_events (
    id bigint auto_increment primary key,
    wa_id varchar(191) not null,
    account_type enum('unknown','demo','real'),
    deposit_count int,
    deposit_total_aed decimal(14,2),
    review_status enum('new','reviewing','contacted','converted','lost'),
    notes text,
    changed_by varchar(191) not null,
    changed_at datetime default current_timestamp,
    index ix_review_events_wa (wa_id, changed_at)
);

-- BUG-010 fix: sessions used to live in express-session's default MemoryStore,
-- so every server restart/redeploy silently logged everyone out and memory
-- grew unbounded under load. Schema matches express-mysql-session's default
-- layout (session_id/expires/data) so the store can point at this table with
-- createDatabaseTable:false — schema ownership stays in this file like every
-- other ads_ table, instead of being auto-created by a third-party library.
create table if not exists ads_sessions (
    session_id varchar(128) collate utf8mb4_bin not null primary key,
    expires int(11) unsigned not null,
    data mediumtext collate utf8mb4_bin
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_bin;

-- BUG-012 fix: sync/analyze job status (admin update-wati/update-meta,
-- conversations sync-batch/analyze-batch) used to live in plain module-level
-- variables, so a server restart mid-run silently reset the status to "idle"
-- instead of surfacing that the job never finished. One row per named job.
create table if not exists ads_job_state (
    job_name varchar(64) not null primary key,
    state_json json not null,
    updated_at datetime default current_timestamp on update current_timestamp
);

-- BUG-017 fix: no API/audit trail existed at all — every request only ever
-- reached `console.log`, invisible after the fact. Minimal slice of doc 06
-- Group E: one table covering "who called what, when, how long, what status"
-- (the two highest-frequency polling routes are excluded at the middleware
-- level, not here, to avoid drowning the table — see middleware/apiLog.js).
-- Retention/partitioning policy (doc 06) is intentionally NOT implemented yet.
create table if not exists ads_api_logs (
    id bigint auto_increment primary key,
    method varchar(8) not null,
    path varchar(255) not null,
    status smallint not null,
    user_email varchar(191),
    duration_ms int not null,
    ip varchar(64),
    created_at datetime default current_timestamp,
    index ix_api_logs_created (created_at),
    index ix_api_logs_user (user_email, created_at)
);

-- Per-post AI content evaluation: EVERY post (not just the winners) gets a
-- verdict judged against the success patterns derived from the top posts,
-- so weak ads are evaluated with the winning formula in hand. One row per
-- post per language (the UI shows the evaluation in the viewer's language).
create table if not exists ads_post_insights (
    post_url varchar(512) not null,
    lang varchar(2) not null,
    verdict varchar(16),              -- successful | average | unsuccessful
    score int,                        -- 0..100 AI content score
    why text,                         -- why it worked / why it underperformed
    improve text,                     -- one concrete suggestion
    generated_at datetime default current_timestamp on update current_timestamp,
    primary key (post_url(191), lang)
);

-- BUG-017 slice 2: server-side errors persisted, not just console.error'd —
-- an operator can see what actually failed after the fact. Retention for
-- both log tables is enforced by the daily job (90 days), not partitioning.
create table if not exists ads_error_logs (
    id bigint auto_increment primary key,
    method varchar(8),
    path varchar(255),
    message text,
    stack text,
    user_email varchar(191),
    created_at datetime default current_timestamp,
    index ix_error_logs_created (created_at)
);

-- BUG-027 fix: DeepSeek calls had no cost/version/eval logging at all —
-- unbounded spend risk and no way to see model drift after a version change.
-- cost_usd is an estimate (config.deepseek.*CostPer1M), not an exact invoice
-- match — good enough for a budget guard and trend visibility, not billing.
create table if not exists ads_ai_runs (
    id bigint auto_increment primary key,
    context varchar(191),
    model varchar(64) not null,
    prompt_tokens int,
    completion_tokens int,
    cost_usd decimal(10,4),
    success tinyint(1) not null,
    error text,
    duration_ms int not null,
    created_at datetime default current_timestamp,
    index ix_ai_runs_created (created_at)
);

-- Employee directory for the nightly email reports: maps a sales agent's
-- Wati contact_owner name to an email + role. Roles decide who receives what:
--   agent            -> their OWN weekly performance report (Monday)
--   campaign_manager -> the daily campaign report
--   general_manager  -> CC'd on every report email
-- owner_name is null for manager/GM rows (they aren't sales agents). No real
-- names/emails ship in source — this table is populated by the admin at runtime.
create table if not exists ads_employees (
    id int auto_increment primary key,
    owner_name varchar(191),
    email varchar(191) not null,
    full_name varchar(191),
    role enum('agent','campaign_manager','general_manager') not null default 'agent',
    lang varchar(2) not null default 'ar',
    active tinyint(1) not null default 1,
    -- ISO-2 codes of the countries this agent works on (multi-select). Used to
    -- show "who works this country" in the campaign report's country section.
    countries json,
    -- The agent's WATI LOGIN email — distinct from `email` above, which is the
    -- report-recipient address. assignOperator requires this exact address, so
    -- a wrong value silently assigns to the wrong person (or to the Bot).
    wati_email varchar(191),
    notes text,
    created_at datetime default current_timestamp,
    updated_at datetime default current_timestamp on update current_timestamp,
    unique key uq_employee_owner (owner_name),
    index ix_employee_role (role)
);

-- Idempotency + audit for outbound report emails: one row per (kind, recipient,
-- period). The nightly job checks this before sending so a manual re-run the
-- same day/week never double-sends; a `force` flag bypasses the check.
create table if not exists ads_email_log (
    id bigint auto_increment primary key,
    kind varchar(32) not null,          -- employee_weekly | campaign_daily | alert | test
    recipient varchar(191) not null,
    period_key varchar(64) not null,    -- e.g. 2026-W30 (weekly) or 2026-07-20 (daily)
    status varchar(16) not null,        -- sent | skipped | error
    error text,
    sent_at datetime default current_timestamp,
    unique key uq_email_once (kind, recipient, period_key),
    index ix_email_sent (sent_at)
);

-- Persisted per-lead contact/follow-up status, snapshotted nightly. Lets
-- historical reports read "as of" status and detect LATE contacts (a lead that
-- was pending on its arrival day but a human replied a day+ later):
-- contacted_at is stamped only on the first 0->1 transition we observe.
create table if not exists ads_lead_followup (
    wa_id varchar(191) primary key,
    created_date date, country varchar(8), owner varchar(191),
    contacted tinyint(1) default 0,
    contacted_at datetime,                 -- when we first saw a human reply
    first_human_response_min numeric(10,1),
    after_hours tinyint(1) default 0,       -- arrived outside working hours
    status varchar(32),                     -- contacted|pending_in_hours|pending_after_hours|expired_no_contact|no_human_needed
    stage varchar(32), source_ad_id varchar(191),
    est_cost_aed decimal(12,3),
    first_seen_date date,                   -- first snapshot date (for late-contact detection)
    updated_at datetime default current_timestamp on update current_timestamp,
    index ix_followup_owner (owner), index ix_followup_date (created_date), index ix_followup_status (status)
);

-- Audit trail for every conversation re-assignment pushed to Wati. This is the
-- ONLY record of who moved which customer to whom, and it's what the "undo"
-- reads to put a conversation back with its previous owner — so a row is
-- written for failures too (status='error'), never silently dropped.
create table if not exists ads_assignment_log (
    id bigint auto_increment primary key,
    wa_id varchar(191) not null,
    from_owner varchar(191),                -- contact_owner before the move (null = unassigned)
    to_owner varchar(191),                  -- employee display name
    to_email varchar(191),                  -- the Wati login email actually sent to the API
    batch_id varchar(64),                   -- groups one bulk operation (for undo-as-a-whole)
    reason varchar(64),                     -- manual | employee_exit | bot_cleanup | undo
    performed_by varchar(191),              -- app user who clicked
    status varchar(16) not null,            -- sent | error | skipped
    error text,
    created_at datetime default current_timestamp,
    index ix_assign_wa (wa_id), index ix_assign_batch (batch_id), index ix_assign_time (created_at)
);

-- Knowledge Base: self-learning Q&A pairs distilled from real customer
-- conversations (AI, budget-guarded) + hand-written entries. Drafts are
-- reviewed/approved by a human here; the approved set is what will later feed
-- an AI chatbot. q_hash (of the normalized question) is unique so periodic
-- re-generation MERGES into existing rows (bumping times_seen) instead of
-- duplicating — that's the "self-learning" accumulation.
create table if not exists ads_kb_qa (
    id bigint auto_increment primary key,
    q_hash char(40) not null,               -- sha1 of the normalized question
    question text not null,
    answer text not null,
    category varchar(64),                   -- e.g. deposit | account | risk | withdrawal | platform | general
    lang varchar(4) not null default 'ar',  -- ar | en
    source varchar(8) not null default 'ai',-- ai | manual
    status varchar(8) not null default 'draft', -- draft | approved
    times_seen int not null default 1,       -- how often this question recurred across generations
    created_at datetime default current_timestamp,
    updated_at datetime default current_timestamp on update current_timestamp,
    unique key uq_kb_qhash (q_hash, lang),
    index ix_kb_status (status), index ix_kb_category (category)
);

-- ---- quality & compliance evaluation (the sales-room quality board) ----
-- Deliberately SEPARATE from ads_conversation_analysis rather than more columns
-- on it: the evaluation is keyed by (wa_id, policy_version), so re-analysing
-- under new rules adds a row instead of overwriting the interested-customer
-- detection that the existing board and reports depend on.
create table if not exists ads_conversation_eval (
    wa_id varchar(191) not null,
    policy_version varchar(16) not null,     -- compliancePolicy.POLICY_VERSION
    model varchar(64),
    prompt_version varchar(32),
    -- the seven per-conversation employee marks (0..100, null = not assessable)
    persuasion_score int, compliance_score int, objection_score int,
    continuity_score int, professionalism_score int, next_step_score int,
    classification_score int,
    -- customer side
    customer_intent_score int, qualification_score int, engagement_score int,
    customer_risk_flags json,                -- describes the CUSTOMER, never a violation
    -- outcome
    next_step_reached tinyint(1) default 0,
    next_step_type varchar(48),              -- compliancePolicy.NEXT_STEP_TYPES
    completed_correctly tinyint(1) default 0,
    follow_up_required tinyint(1) default 0,
    confidence decimal(3,2),                 -- 0..1, gates whether issues cost points
    requires_human_review tinyint(1) default 0,
    warnings json,                           -- validator drops, so drift stays visible
    analyzed_at datetime default current_timestamp on update current_timestamp,
    primary key (wa_id, policy_version),
    index ix_eval_at (analyzed_at),
    index ix_eval_review (requires_human_review)
);

-- One row per detected issue (not per conversation) because severity and
-- supervisor review are per-issue. `evidence` is a verbatim employee quote —
-- the validator drops any issue that arrives without one, since an issue that
-- can't be shown to the employee can't fairly cost them points.
create table if not exists ads_conversation_issue (
    id bigint auto_increment primary key,
    wa_id varchar(191) not null,
    policy_version varchar(16) not null,
    type varchar(64) not null,               -- compliancePolicy.ISSUE_TYPES
    severity varchar(16) not null,           -- informational|minor|moderate|major|critical
    confidence decimal(3,2) not null,
    evidence text not null,
    -- sha1 of (type + normalized evidence): makes re-analysis idempotent, and
    -- because the upsert never writes review_status, a supervisor's confirm or
    -- reject survives every later re-analysis of the same conversation.
    evidence_hash char(40) not null,
    employee_message_id varchar(191),
    context_explanation text,
    recommended_alternative text,
    review_status varchar(16) not null default 'pending', -- pending|confirmed|rejected
    reviewed_by varchar(191), reviewed_at datetime, reviewer_note text,
    created_at datetime default current_timestamp,
    unique key uq_issue (wa_id, policy_version, evidence_hash),
    index ix_issue_wa (wa_id),
    index ix_issue_status (review_status),
    index ix_issue_severity (severity)
);

-- Per-employee score snapshot. The wall board reads THIS, never raw messages:
-- a dashboard request must not aggregate 5k conversations, and a snapshot also
-- gives the day-over-day comparison something stable to compare against.
create table if not exists ads_employee_score_snapshot (
    snapshot_date date not null,
    agent_name varchar(191) not null,
    window_days int not null,
    productivity decimal(5,1), persuasion decimal(5,1), compliance decimal(5,1),
    conversion decimal(5,1), response decimal(5,1), overall decimal(5,1),
    overall_raw decimal(5,1),                -- before any critical-violation cap
    sample_size int not null default 0,
    analyzed_pct decimal(5,1),
    confidence varchar(8),                   -- low | medium | high
    eligible_top tinyint(1) default 0,
    ineligible_reasons json,
    components json,                         -- the raw inputs, for the drill-down
    created_at datetime default current_timestamp,
    primary key (snapshot_date, agent_name, window_days),
    index ix_snap_date (snapshot_date)
);

-- ---- analytics views ----
create or replace view ads_v_ad_funnel as
select p.ad_id, p.ad_name, p.campaign_name, p.status, p.spend_aed, p.impressions, p.clicks,
       p.ctr_pct, p.cpc_aed, p.cpm_aed, p.frequency, p.results as convos_meta, p.cpr_aed,
       count(w.wa_id) as contacts_wati,
       sum(case when w.stage in ('qualified','interested','demo','deposit') then 1 else 0 end) as qualified,
       sum(case when w.deposit_flag=1 then 1 else 0 end) as deposits,
       round(100.0*count(w.wa_id)/nullif(p.results,0),1) as wati_capture_pct,
       round(p.spend_aed / nullif(count(w.wa_id),0),2) as cost_per_contact,
       round(100.0*sum(case when w.stage in ('qualified','interested','demo','deposit') then 1 else 0 end)/nullif(count(w.wa_id),0),1) as qual_rate_pct,
       round(p.spend_aed / nullif(sum(case when w.stage in ('qualified','interested','demo','deposit') then 1 else 0 end),0),2) as cost_per_qualified
from ads_meta_ad_perf p
left join ads_wati_contacts w on w.source_ad_id = p.ad_id
group by p.ad_id, p.ad_name, p.campaign_name, p.status, p.spend_aed, p.impressions,
         p.clicks, p.ctr_pct, p.cpc_aed, p.cpm_aed, p.frequency, p.results, p.cpr_aed;

-- BUG-024 fix: ad_count exposes when sample_ad/campaign below is arbitrarily
-- one of several ads sharing this post, instead of implying it's the only one.
create or replace view ads_v_post_funnel as
select w.source_url as post_url, max(p.ad_name) as sample_ad, max(p.campaign_name) as campaign,
       count(distinct p.ad_id) as ad_count,
       count(*) as contacts,
       sum(case when w.stage in ('qualified','interested','demo','deposit') then 1 else 0 end) as qualified,
       sum(case when w.deposit_flag=1 then 1 else 0 end) as deposits,
       round(100.0*sum(case when w.stage in ('qualified','interested','demo','deposit') then 1 else 0 end)/nullif(count(*),0),1) as qual_rate_pct
from ads_wati_contacts w
left join ads_meta_ad_perf p on p.ad_id = w.source_ad_id
where w.source_url is not null and w.source_url <> ''
group by w.source_url;

create or replace view ads_v_agent_perf as
select coalesce(contact_owner,'(unassigned)') as agent, count(*) as contacts,
       sum(case when stage in ('qualified','interested','demo','deposit') then 1 else 0 end) as qualified,
       sum(case when deposit_flag=1 then 1 else 0 end) as deposits,
       round(avg(first_response_min),1) as avg_first_response_min,
       round(100.0*sum(case when stage in ('qualified','interested','demo','deposit') then 1 else 0 end)/nullif(count(*),0),1) as qual_rate_pct
from ads_wati_contacts
group by coalesce(contact_owner,'(unassigned)');

create or replace view ads_v_daily as
select m.`date` as day, m.spend_aed, m.convos_meta,
       coalesce(w.contacts,0) as contacts, coalesce(w.qualified,0) as qualified
from (select `date`, sum(spend_aed) spend_aed, sum(results) convos_meta
      from ads_meta_daily where level='campaign' group by `date`) m
left join (select created_date as day, count(*) contacts,
            sum(case when stage in ('qualified','interested','demo','deposit') then 1 else 0 end) qualified
           from ads_wati_contacts where created_date is not null group by created_date) w
       on w.day = m.`date`;

create or replace view ads_v_monthly as
select m.month, sum(m.spend_aed) as spend, sum(m.results) as convos,
       coalesce(w.contacts,0) as contacts, coalesce(w.qualified,0) as qualified
from ads_meta_month m
left join (select date_format(created_date,'%Y-%m') mm, count(*) contacts,
            sum(case when stage in ('qualified','interested','demo','deposit') then 1 else 0 end) qualified
           from ads_wati_contacts where created_date is not null group by date_format(created_date,'%Y-%m')) w
       on w.mm = m.month
group by m.month, w.contacts, w.qualified;

create or replace view ads_v_weekly as
select date_format(created_date - interval weekday(created_date) day, '%Y-%m-%d') as wk,
       count(*) as contacts,
       sum(case when stage in ('qualified','interested','demo','deposit') then 1 else 0 end) as qualified
from ads_wati_contacts where created_date is not null
group by date_format(created_date - interval weekday(created_date) day, '%Y-%m-%d');

-- Customer-type tags (the Wati taxonomy in tagTaxonomy.js). One row per
-- (conversation, tag) rather than a JSON blob on the contact, because the whole
-- point of this table is to be filtered on: "show me every HOT lead who wants
-- gold and objected to the minimum deposit" is a join, not a JSON scan.
--
-- `source` records WHO decided, and that is the column that keeps the data
-- honest: `rule` tags are recomputed exactly from our own data, `ai` tags are a
-- reading of what was said and carry evidence + confidence, `manual` is a human
-- overriding either. A tag whose truth lives in the trading platform or the
-- compliance system is never written here by us at all.
create table if not exists ads_conversation_tag (
    wa_id varchar(191) not null,
    tag varchar(64) not null,
    category varchar(48) not null,
    source varchar(16) not null,             -- rule | ai | manual
    confidence decimal(3,2),                 -- ai only; rule tags are exact
    evidence text,                           -- ai only: the customer's own words
    tag_version varchar(16),                 -- which prompt/rule generation wrote it
    -- A human can reject an AI tag without deleting it: rejected tags stay
    -- visible as a training signal and stop counting in every filter.
    review_status varchar(16) not null default 'auto',  -- auto | confirmed | rejected
    reviewed_by varchar(191), reviewed_at datetime,
    created_at datetime default current_timestamp,
    updated_at datetime default current_timestamp on update current_timestamp,
    primary key (wa_id, tag),
    index ix_ctag_tag (tag),
    index ix_ctag_cat (category),
    index ix_ctag_src (source)
);

-- One row per tagging run, so the backfill is resumable and a re-tag after a
-- prompt change is detectable without re-reading every conversation.
create table if not exists ads_conversation_tag_run (
    wa_id varchar(191) primary key,
    tag_version varchar(16) not null,
    tags_found int default 0,
    model varchar(64),
    tagged_at datetime default current_timestamp on update current_timestamp,
    index ix_ctagrun_ver (tag_version)
);

-- WhatsApp broadcast campaigns: our own native version of Wati's "Create New
-- Campaign" wizard (name -> channel -> template -> audience -> send). One row
-- per campaign attempt; `filter_json` is the exact audience filter used so a
-- run's audience can be explained or reproduced later.
create table if not exists ads_broadcast_run (
    id bigint auto_increment primary key,
    name varchar(160) not null,
    template_name varchar(160) not null,
    channel varchar(32),                    -- business_channel (Wati channel_number)
    filter_json text,                       -- audience filter as submitted
    param_map_json text,                    -- how each {{n}} variable was filled
    total int default 0,                    -- eligible audience size at execute time
    sent int default 0, failed int default 0, skipped int default 0,
    status varchar(16) not null default 'draft',   -- draft | running | done | error
    created_by varchar(191),
    created_at datetime default current_timestamp,
    finished_at datetime,
    index ix_bcrun_time (created_at)
);

-- Per-recipient outcome, mirroring ads_assignment_log's audit pattern. `status`
-- is 'queued' (Wati accepted it into the batch — NOT a delivery confirmation;
-- this app has no delivery webhook) or 'error' (Wati rejected the number or a
-- custom param, or the API call itself failed).
create table if not exists ads_broadcast_recipient (
    id bigint auto_increment primary key,
    run_id bigint not null,
    wa_id varchar(191) not null,
    status varchar(16) not null,            -- queued | error
    error varchar(255),
    created_at datetime default current_timestamp,
    index ix_bcrecip_run (run_id), index ix_bcrecip_wa (wa_id)
);

-- Full customer view: qualified contact + ad/campaign + manual review.
-- BUG-014 fix: a contact whose source_ad_id doesn't match any row in
-- ads_meta_ad_perf used to silently show a NULL ad_name/campaign_name with
-- no way to tell "never attributed" from "attributed to an ad we haven't
-- synced yet". unattributed_reason makes that distinction visible. This is a
-- minimal slice of doc 05's full T0-T5 attribution-confidence design (not
-- implemented) — it surfaces today's silent gap, it doesn't fix attribution
-- coverage itself.
create or replace view ads_v_customer_360 as
select w.wa_id, w.full_name, w.phone, w.country, w.stage, w.lead_score, w.score_band,
       w.source_ad_id, p.ad_name, p.campaign_name, w.source_url as post_url,
       w.contact_owner, w.created_date, w.num_messages, w.is_answered, w.last_message_at,
       coalesce(r.account_type,'unknown') as account_type,
       coalesce(r.deposit_count,0) as deposit_count,
       coalesce(r.deposit_total_aed,0) as deposit_total_aed,
       coalesce(r.review_status,'new') as review_status,
       r.reviewed_by, r.reviewed_at, r.notes,
       case
         when w.source_ad_id is null or w.source_ad_id = '' then 'no_source_id'
         when p.ad_id is null then 'ad_not_synced'
         else null
       end as unattributed_reason
from ads_wati_contacts w
left join ads_meta_ad_perf p on p.ad_id = w.source_ad_id
left join ads_lead_review r on r.wa_id = w.wa_id
where w.stage in ('qualified','interested','demo','deposit');

-- ---------------------------------------------------------------------------
-- Operator-entered configuration written by the setup wizard and the Settings
-- page: Meta / Wati / AI / SMTP credentials, schedules, locale.
--
-- Deliberately NOT folded into ads_settings. That table is already owned by
-- lib/metaAuth.js for live token STATE (meta_access_token and its expiry),
-- plus currency rates, the kiosk token and work hours. Mixing operator
-- configuration into the same flat key space risks collisions, and it has no
-- is_secret flag and no updated_by — both of which matter here. Keeping them
-- apart also means metaAuth.js needs no change at all.
--
-- Keys are namespaced to mirror the config object: "meta.appSecret",
-- "wati.token", "deepseek.apiKey". Rows with is_secret=1 hold an AES-256-GCM
-- envelope from lib/secretBox.js, so a database dump does not hand over every
-- credential in plaintext.
create table if not exists app_config (
    k varchar(96) primary key,
    v text,
    is_secret tinyint(1) not null default 0,
    updated_by varchar(191),
    updated_at datetime default current_timestamp on update current_timestamp
);
