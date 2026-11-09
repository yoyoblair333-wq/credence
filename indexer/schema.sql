-- ===========================================================================
-- Credence indexer — reference schema (PostgreSQL)
-- ===========================================================================
-- A queryable store for Credence's 8 events + the companion vault's `Admitted`,
-- grounded field-for-field in docs/EVENTS.md and the `_emit(...)` call sites in
-- contracts/credence.py. Plus a `reconciliation_snapshot` store fed from the
-- contract's own views (get_pool / stats / page_borrowers), because Credence
-- events are BEST-EFFORT — the contract state is the source of truth, not the
-- event stream (docs/EVENTS.md). Index the events for a push/history view;
-- reconcile against snapshots for ground truth.
--
-- MONEY COLUMNS ARE NUMERIC(78,0): every money field is a decimal string in
-- base units (1 token = 1e18) emitted as str(...) to avoid bigint truncation
-- across the ABI. uint256 has up to 78 decimal digits; NEVER store these as
-- BIGINT/float — you will truncate. Parse the event string straight into
-- NUMERIC. (docs/EVENTS.md "Money fields are decimal strings in base units".)
--
-- #CreditWithoutCollateral · GenLayer referral JTR01FHP
-- ===========================================================================

CREATE SCHEMA IF NOT EXISTS credence;
SET search_path TO credence, public;

-- --------------------------------------------------------------------------
-- Common on-chain provenance carried on every event row.
-- (block_number / tx_hash / log_index identify the emission; the composite
-- PK makes ingestion idempotent so replays never double-insert.)
-- --------------------------------------------------------------------------
-- Each event table repeats these columns rather than inheriting, to stay
-- portable across engines that lack table inheritance.

-- CreditRequested — request_credit. Indexed: borrower.
CREATE TABLE IF NOT EXISTS credit_requested (
    block_number     BIGINT       NOT NULL,
    tx_hash          TEXT         NOT NULL,
    log_index        INTEGER      NOT NULL,
    emitted_at       TIMESTAMPTZ,                 -- consensus datetime, if available
    contract_address TEXT         NOT NULL,
    borrower         TEXT         NOT NULL,        -- indexed topic (address, 0x+40hex)
    requested_tokens NUMERIC(78,0) NOT NULL,       -- WHOLE tokens requested (not base units)
    evidence_items   INTEGER      NOT NULL,
    PRIMARY KEY (tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS ix_credit_requested_borrower ON credit_requested (borrower, block_number);

-- CreditAssessed — assess OR appeal (both via _apply_result). Indexed: borrower.
-- tier: 0 = original assessment, 1 = appeal result.
CREATE TABLE IF NOT EXISTS credit_assessed (
    block_number     BIGINT       NOT NULL,
    tx_hash          TEXT         NOT NULL,
    log_index        INTEGER      NOT NULL,
    emitted_at       TIMESTAMPTZ,
    contract_address TEXT         NOT NULL,
    borrower         TEXT         NOT NULL,
    grade            TEXT         NOT NULL CHECK (grade IN ('DENY','C','B','A','AA','AAA')),
    credit_limit     NUMERIC(78,0) NOT NULL,       -- base units (0 on DENY)
    ownership_proven BOOLEAN      NOT NULL,
    tier             INTEGER      NOT NULL,         -- 0 original, 1 appeal
    PRIMARY KEY (tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS ix_credit_assessed_borrower ON credit_assessed (borrower, block_number);

-- Drawn — draw. Indexed: borrower.
CREATE TABLE IF NOT EXISTS drawn (
    block_number     BIGINT       NOT NULL,
    tx_hash          TEXT         NOT NULL,
    log_index        INTEGER      NOT NULL,
    emitted_at       TIMESTAMPTZ,
    contract_address TEXT         NOT NULL,
    borrower         TEXT         NOT NULL,
    amount           NUMERIC(78,0) NOT NULL,        -- base units drawn this call
    fee              NUMERIC(78,0) NOT NULL,        -- origination fee accrued this draw
    principal        NUMERIC(78,0) NOT NULL,        -- outstanding principal AFTER the draw
    due_at           BIGINT       NOT NULL,         -- epoch seconds the line is due
    PRIMARY KEY (tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS ix_drawn_borrower ON drawn (borrower, block_number);

-- Repaid — repay (fires on partials too). Indexed: borrower.
-- Repayment applies value in order principal -> fee -> interest.
CREATE TABLE IF NOT EXISTS repaid (
    block_number     BIGINT       NOT NULL,
    tx_hash          TEXT         NOT NULL,
    log_index        INTEGER      NOT NULL,
    emitted_at       TIMESTAMPTZ,
    contract_address TEXT         NOT NULL,
    borrower         TEXT         NOT NULL,
    amount           NUMERIC(78,0) NOT NULL,        -- base units repaid this call
    principal        NUMERIC(78,0) NOT NULL,        -- principal still outstanding AFTER
    fee_paid         NUMERIC(78,0) NOT NULL,        -- fee portion settled this call
    interest_paid    NUMERIC(78,0) NOT NULL,        -- interest portion settled this call ("0" if APR off)
    on_time          BOOLEAN      NOT NULL,         -- repaid on/before due_at
    PRIMARY KEY (tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS ix_repaid_borrower ON repaid (borrower, block_number);

-- Defaulted — service_book, ONLY on the transition into defaulted. Indexed: borrower.
CREATE TABLE IF NOT EXISTS defaulted (
    block_number     BIGINT       NOT NULL,
    tx_hash          TEXT         NOT NULL,
    log_index        INTEGER      NOT NULL,
    emitted_at       TIMESTAMPTZ,
    contract_address TEXT         NOT NULL,
    borrower         TEXT         NOT NULL,
    debt             NUMERIC(78,0) NOT NULL,        -- principal + fee (+ interest) at default
    defaults         INTEGER      NOT NULL,         -- lifetime default count AFTER this one
    PRIMARY KEY (tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS ix_defaulted_borrower ON defaulted (borrower, block_number);

-- Funded — fund (payable). Indexed: lender.
CREATE TABLE IF NOT EXISTS funded (
    block_number     BIGINT       NOT NULL,
    tx_hash          TEXT         NOT NULL,
    log_index        INTEGER      NOT NULL,
    emitted_at       TIMESTAMPTZ,
    contract_address TEXT         NOT NULL,
    lender           TEXT         NOT NULL,
    amount           NUMERIC(78,0) NOT NULL,        -- base units deposited this call
    funded           NUMERIC(78,0) NOT NULL,        -- lender's running contributed total
    PRIMARY KEY (tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS ix_funded_lender ON funded (lender, block_number);

-- Defunded — defund. Indexed: lender.
CREATE TABLE IF NOT EXISTS defunded (
    block_number     BIGINT       NOT NULL,
    tx_hash          TEXT         NOT NULL,
    log_index        INTEGER      NOT NULL,
    emitted_at       TIMESTAMPTZ,
    contract_address TEXT         NOT NULL,
    lender           TEXT         NOT NULL,
    amount           NUMERIC(78,0) NOT NULL,        -- base units redeemed this call
    funded           NUMERIC(78,0) NOT NULL,        -- lender's remaining total AFTER
    PRIMARY KEY (tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS ix_defunded_lender ON defunded (lender, block_number);

-- YieldClaimed — claim_yield. Indexed: lender.
CREATE TABLE IF NOT EXISTS yield_claimed (
    block_number     BIGINT       NOT NULL,
    tx_hash          TEXT         NOT NULL,
    log_index        INTEGER      NOT NULL,
    emitted_at       TIMESTAMPTZ,
    contract_address TEXT         NOT NULL,
    lender           TEXT         NOT NULL,
    amount           NUMERIC(78,0) NOT NULL,        -- base units of yield claimed
    PRIMARY KEY (tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS ix_yield_claimed_lender ON yield_claimed (lender, block_number);

-- Admitted — companion CredenceGatedVault.claim (docs/EVENTS.md "composability consumer").
-- Indexed: member. Lives on the VAULT contract, not core Credence.
CREATE TABLE IF NOT EXISTS admitted (
    block_number     BIGINT       NOT NULL,
    tx_hash          TEXT         NOT NULL,
    log_index        INTEGER      NOT NULL,
    emitted_at       TIMESTAMPTZ,
    contract_address TEXT         NOT NULL,          -- the vault address
    member           TEXT         NOT NULL,
    grade            TEXT         NOT NULL,           -- grade snapshotted from Credence at admission
    min_grade        TEXT         NOT NULL,           -- the vault's bar
    seq              INTEGER      NOT NULL,           -- 1-based admission order
    PRIMARY KEY (tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS ix_admitted_member ON admitted (member, block_number);

-- --------------------------------------------------------------------------
-- RECONCILIATION SNAPSHOTS — ground truth from the contract's VIEWS.
-- Events are best-effort; poll these from get_pool()/stats()/page_borrowers()
-- on a cadence (e.g. after each keeper service_book run) so analytics can
-- reconcile and tolerate a missing event. See indexer/poll_example.py.
-- --------------------------------------------------------------------------

-- One row per poll: the whole-pool state (from get_pool() + stats()).
CREATE TABLE IF NOT EXISTS pool_snapshot (
    snapshot_id          BIGSERIAL PRIMARY KEY,
    observed_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    contract_address     TEXT          NOT NULL,
    cash                 NUMERIC(78,0) NOT NULL,
    total_funded         NUMERIC(78,0) NOT NULL,
    total_drawn          NUMERIC(78,0) NOT NULL,
    total_repaid         NUMERIC(78,0) NOT NULL,
    outstanding_principal NUMERIC(78,0) NOT NULL,
    outstanding_fees     NUMERIC(78,0) NOT NULL,
    outstanding_interest NUMERIC(78,0) NOT NULL,
    fee_revenue          NUMERIC(78,0) NOT NULL,
    yield_distributed    NUMERIC(78,0) NOT NULL,
    active_lines         INTEGER       NOT NULL,
    utilization_bps      INTEGER       NOT NULL,
    borrowers            INTEGER,                      -- from stats()
    approved             INTEGER,
    defaulted            INTEGER,
    service_cursor       BIGINT
);
CREATE INDEX IF NOT EXISTS ix_pool_snapshot_time ON pool_snapshot (contract_address, observed_at);

-- Per-borrower state as of a poll (from page_borrowers() / credit_of()).
-- Upsert on (contract_address, borrower) for a live table, or append-only with
-- snapshot_id for a time series — this reference keeps the latest observation.
CREATE TABLE IF NOT EXISTS borrower_snapshot (
    contract_address TEXT          NOT NULL,
    borrower         TEXT          NOT NULL,
    observed_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    status           TEXT          NOT NULL,          -- none|assessing|approved|denied|defaulted
    grade            TEXT          NOT NULL,
    standing         INTEGER       NOT NULL,
    principal        NUMERIC(78,0) NOT NULL,
    credit_limit     NUMERIC(78,0) NOT NULL,
    PRIMARY KEY (contract_address, borrower)
);
CREATE INDEX IF NOT EXISTS ix_borrower_snapshot_status ON borrower_snapshot (contract_address, status);

-- --------------------------------------------------------------------------
-- DERIVED VIEWS — common dApp/analytics questions, from the event log.
-- These are convenience reads; where correctness matters, cross-check against
-- the reconciliation snapshots above.
-- --------------------------------------------------------------------------

-- Latest assessed grade/limit per borrower (newest CreditAssessed wins).
CREATE OR REPLACE VIEW v_latest_assessment AS
SELECT DISTINCT ON (borrower)
       borrower, grade, credit_limit, ownership_proven, tier, block_number, tx_hash
FROM credit_assessed
ORDER BY borrower, block_number DESC, log_index DESC;

-- Lifetime default count per borrower from the event log (max is authoritative,
-- since `defaults` is the running count after each default).
CREATE OR REPLACE VIEW v_borrower_defaults AS
SELECT borrower, MAX(defaults) AS lifetime_defaults, COUNT(*) AS default_events
FROM defaulted
GROUP BY borrower;

-- Net lender position from the event log: contributed - redeemed, plus yield claimed.
-- (Reconcile against lender_balance()/pending_yield() views for the live figure.)
CREATE OR REPLACE VIEW v_lender_position AS
SELECT addr AS lender,
       SUM(deposited)  AS total_deposited,
       SUM(redeemed)   AS total_redeemed,
       SUM(deposited) - SUM(redeemed) AS net_contributed,
       SUM(yield_claimed) AS total_yield_claimed
FROM (
    SELECT lender AS addr, amount AS deposited, 0 AS redeemed, 0 AS yield_claimed FROM funded
    UNION ALL
    SELECT lender AS addr, 0, amount, 0 FROM defunded
    UNION ALL
    SELECT lender AS addr, 0, 0, amount FROM yield_claimed
) t
GROUP BY addr;

-- Flow of originations: fees charged vs. principal drawn, by grade (joins Drawn to the
-- borrower's latest assessed grade). Useful for risk-priced-fee revenue analysis.
CREATE OR REPLACE VIEW v_origination_flow AS
SELECT d.borrower,
       a.grade,
       COUNT(*)        AS draws,
       SUM(d.amount)   AS total_drawn,
       SUM(d.fee)      AS total_fees
FROM drawn d
LEFT JOIN v_latest_assessment a ON a.borrower = d.borrower
GROUP BY d.borrower, a.grade;
