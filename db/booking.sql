-- =====================================================================
-- db/booking.sql  (Booking service, owner: Eman)
-- Run by Ghada on the Neon dev branch first, then on main.
-- Safe to run more than once.
-- =====================================================================

-- Needed so a car ID (=) and a date range (&&) can be used together in
-- one exclusion constraint. Ghada runs this as the database owner.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE SCHEMA IF NOT EXISTS booking;

-- ---------------------------------------------------------------------
-- bookings
-- Life: pending -> confirmed -> picked_up -> completed
--       pending -> declined
--       pending / confirmed -> cancelled   (before pick-up only)
-- Rows are never deleted.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS booking.bookings (
    id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

    -- IDs that belong to other services: plain columns, NO foreign keys,
    -- because services never read each other's tables.
    car_id           UUID          NOT NULL,   -- Catalogue's car
    office_id        UUID          NOT NULL,   -- from the Catalogue quote (C10)
    customer_id      TEXT          NOT NULL,   -- Cognito user ID, taken from the token

    -- start_date = pick-up day, end_date = return day (the return day is
    -- not charged), so 10 Dec -> 14 Dec = 4 days.
    start_date       DATE          NOT NULL,
    end_date         DATE          NOT NULL,

    daily_price      NUMERIC(10,2) NOT NULL,   -- EGP per day, from the quote
    total_price      NUMERIC(10,2) NOT NULL,   -- EGP, from the quote

    status           TEXT          NOT NULL DEFAULT 'pending',
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),

    CONSTRAINT bookings_status_valid
        CHECK (status IN ('pending', 'confirmed', 'declined',
                          'picked_up', 'completed', 'cancelled')),
    CONSTRAINT bookings_dates_valid
        CHECK (end_date > start_date),
    CONSTRAINT bookings_prices_valid
        CHECK (daily_price >= 0 AND total_price >= 0),

    -- Two active bookings for the same car can never overlap, even if two
    -- staff members click "confirm" at the same moment.
    -- 'confirmed' AND 'picked_up' both count: the car is still out.
    -- Declined, cancelled and completed bookings do not block anything.
    CONSTRAINT bookings_no_overlap
        EXCLUDE USING gist (
            car_id WITH =,
            daterange(start_date, end_date, '[)') WITH &&
        )
        WHERE (status IN ('confirmed', 'picked_up'))
);

CREATE INDEX IF NOT EXISTS idx_bookings_customer
    ON booking.bookings (customer_id);               -- B2 (customer)
CREATE INDEX IF NOT EXISTS idx_bookings_office_status
    ON booking.bookings (office_id, status);         -- B2 (staff)
CREATE INDEX IF NOT EXISTS idx_bookings_car_status
    ON booking.bookings (car_id, status);            -- B6, B7 availability

-- ---------------------------------------------------------------------
-- Only allow valid status changes, and keep updated_at fresh.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION booking.check_booking_update()
RETURNS trigger AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF NOT (
            (OLD.status = 'pending'   AND NEW.status IN ('confirmed', 'declined', 'cancelled')) OR
            (OLD.status = 'confirmed' AND NEW.status IN ('picked_up', 'cancelled')) OR
            (OLD.status = 'picked_up' AND NEW.status = 'completed')
        ) THEN
            RAISE EXCEPTION 'Invalid booking status change: % -> %', OLD.status, NEW.status
                USING ERRCODE = '23514';
        END IF;
    END IF;

    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bookings_update ON booking.bookings;
CREATE TRIGGER trg_bookings_update
    BEFORE UPDATE ON booking.bookings
    FOR EACH ROW EXECUTE FUNCTION booking.check_booking_update();

-- ---------------------------------------------------------------------
-- audit_log: who confirmed, declined, cancelled or changed what, and when.
-- The app only ever inserts here (roles.sql should give the booking role
-- INSERT and SELECT on this table, nothing else).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS booking.audit_log (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id   UUID        NOT NULL REFERENCES booking.bookings (id),
    actor_id     TEXT        NOT NULL,   -- Cognito user ID, or the calling service's name
    actor_role   TEXT        NOT NULL,   -- 'customer', 'staff' or 'service'
    action       TEXT        NOT NULL,   -- e.g. 'created', 'confirmed', 'declined', 'cancelled'
    old_status   TEXT,
    new_status   TEXT,
    request_id   TEXT,                   -- same ID that appears in the CloudWatch logs
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_booking
    ON booking.audit_log (booking_id, created_at);
