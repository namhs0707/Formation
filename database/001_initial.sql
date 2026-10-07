-- Formation Inspection database, PostgreSQL 15 or newer.
-- Run as the postgres administrator in formation_inspection.
-- This script creates empty tables. It does not import or change Google Sheet data.

CREATE SCHEMA IF NOT EXISTS formation;

CREATE TABLE IF NOT EXISTS formation.appearance_inspections (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    process text NOT NULL CHECK (process IN ('before_hpcd', 'formation', 'degas')),
    team text NOT NULL CHECK (team IN ('1A', '1B', '2A', '2B')),
    operator_name varchar(120) NOT NULL,
    tray_id varchar(32) NOT NULL CHECK (tray_id ~ '^[A-Z0-9]+$'),
    cell_id varchar(32),
    channel integer CHECK (channel > 0),
    jig_line varchar(16),
    hot_jig smallint CHECK (hot_jig > 0),
    degas_line varchar(16),
    defect_types text[] NOT NULL CHECK (
        cardinality(defect_types) > 0
        AND defect_types <@ ARRAY[
            'All OK', 'Dent', 'Contamination', 'Scratch',
            'Lead bending', 'Wrinkles', 'Unsealing pouch', 'Others'
        ]::text[]
        AND (NOT ('All OK' = ANY(defect_types)) OR cardinality(defect_types) = 1)
    ),
    comment text NOT NULL DEFAULT '',
    defect_map jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(defect_map) = 'array'),
    legacy_photo_url text,
    source_key text UNIQUE,
    CHECK (defect_types = ARRAY['All OK']::text[] OR (cell_id IS NOT NULL AND channel IS NOT NULL)),
    CHECK (process <> 'formation' OR defect_types = ARRAY['All OK']::text[] OR (jig_line IS NOT NULL AND hot_jig IS NOT NULL)),
    CHECK (process <> 'degas' OR defect_types = ARRAY['All OK']::text[] OR degas_line IS NOT NULL)
);

-- Images are kept in PostgreSQL, so a database backup also includes new photos.
CREATE TABLE IF NOT EXISTS formation.appearance_photos (
    inspection_id bigint PRIMARY KEY REFERENCES formation.appearance_inspections(id) ON DELETE CASCADE,
    original_name varchar(160) NOT NULL,
    mime_type varchar(64) NOT NULL CHECK (mime_type LIKE 'image/%'),
    image_data bytea NOT NULL CHECK (octet_length(image_data) <= 8388608),
    uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS formation.hta_readings (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    team text NOT NULL CHECK (team IN ('1A', '1B', '2A', '2B')),
    operator_name varchar(120) NOT NULL,
    hta11 numeric(6,2) NOT NULL,
    hta12 numeric(6,2) NOT NULL,
    hta21 numeric(6,2) NOT NULL,
    hta22 numeric(6,2) NOT NULL,
    hta31 numeric(6,2) NOT NULL,
    hta32 numeric(6,2) NOT NULL,
    hta41 numeric(6,2) NOT NULL,
    hta42 numeric(6,2) NOT NULL,
    spec_result text NOT NULL CHECK (length(spec_result) > 0),
    source_key text UNIQUE
);

CREATE TABLE IF NOT EXISTS formation.eol_maintenance (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    team text NOT NULL CHECK (team IN ('1A', '1B', '2A', '2B')),
    operator_name varchar(120) NOT NULL,
    line text NOT NULL CHECK (line IN ('EOL 4-1', 'EOL 4-2', 'EOL 5-1', 'EOL 5-2')),
    equipment text NOT NULL CHECK (equipment IN ('Tape', 'Knife')),
    maintenance text NOT NULL CHECK (maintenance IN ('Cleaning', 'Replace')),
    taping_line text NOT NULL CHECK (taping_line IN ('Both', 'A', 'B')),
    source_key text UNIQUE
);

CREATE TABLE IF NOT EXISTS formation.conductive_maintenance (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    team text NOT NULL CHECK (team IN ('1A', '1B', '2A', '2B')),
    operator_name varchar(120) NOT NULL,
    rubber_process text NOT NULL CHECK (rubber_process IN ('Degas', 'EOL')),
    line text NOT NULL CHECK (line IN ('4-1', '4-2', '5-1', '5-2')),
    measurement text NOT NULL CHECK (measurement IN ('IR', 'IV')),
    units text[] NOT NULL CHECK (cardinality(units) > 0 AND units <@ ARRAY['1A','1B','1C','1D','2A','2B','2C','2D']::text[]),
    action text NOT NULL CHECK (action IN ('Flip', 'Change', 'Other')),
    comment text NOT NULL DEFAULT '',
    source_key text UNIQUE,
    CHECK (rubber_process <> 'Degas' OR measurement = 'IR')
);

-- One completed form is one parent row; its individual checklist answers are child rows.
CREATE TABLE IF NOT EXISTS formation.startup_checks (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    process text NOT NULL CHECK (process IN (
        'startup_hpcd', 'startup_jig', 'startup_degas',
        'startup_cdc', 'startup_eol', 'startup_selector'
    )),
    team text NOT NULL CHECK (team IN ('1A', '1B', '2A', '2B')),
    operator_name varchar(120),
    line_values text[] NOT NULL DEFAULT '{}'::text[],
    cdc_line varchar(32),
    cdc_floor varchar(16),
    selector_type text CHECK (selector_type IN ('Jig Selector', 'CDC Selector', 'OCV Selector')),
    check_completed text NOT NULL CHECK (check_completed IN ('Yes', 'No')),
    frequency text NOT NULL CHECK (frequency IN ('Shift', 'Weekly', 'Monthly')),
    source_key text UNIQUE,
    CHECK (process = 'startup_cdc' OR cardinality(line_values) > 0),
    CHECK (process <> 'startup_cdc' OR (cdc_line IS NOT NULL AND cdc_floor IS NOT NULL)),
    CHECK (process <> 'startup_selector' OR selector_type IS NOT NULL),
    CHECK (process NOT IN ('startup_degas', 'startup_eol', 'startup_selector') OR cardinality(line_values) = 1)
);

CREATE TABLE IF NOT EXISTS formation.startup_check_items (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    check_id bigint NOT NULL REFERENCES formation.startup_checks(id) ON DELETE CASCADE,
    position smallint NOT NULL CHECK (position > 0),
    item text NOT NULL,
    status text NOT NULL CHECK (status IN ('Pass', 'Flagged', 'Incomplete', 'Completed', 'N/A', 'No')),
    comment text NOT NULL DEFAULT '',
    UNIQUE (check_id, position),
    CHECK (status NOT IN ('Flagged', 'Incomplete', 'No') OR length(btrim(comment)) > 0)
);

CREATE TABLE IF NOT EXISTS formation.resealing_checks (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    operator_name varchar(120) NOT NULL,
    shift varchar(40) NOT NULL,
    work_today varchar(160) NOT NULL,
    inspection_status text NOT NULL CHECK (inspection_status IN ('Pass', 'Flagged', 'N/A')),
    cleaning_status text NOT NULL CHECK (cleaning_status IN ('Completed', 'Incomplete', 'N/A')),
    comment text NOT NULL DEFAULT '',
    source_key text UNIQUE,
    CHECK ((inspection_status <> 'Flagged' AND cleaning_status <> 'Incomplete') OR length(btrim(comment)) > 0)
);

CREATE TABLE IF NOT EXISTS formation.ip_checks (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    check_date date NOT NULL,
    line varchar(60) NOT NULL,
    source_key text UNIQUE
);

-- Store the target and range result at the time of measurement; future target changes do not rewrite history.
CREATE TABLE IF NOT EXISTS formation.ip_measurements (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    check_id bigint NOT NULL REFERENCES formation.ip_checks(id) ON DELETE CASCADE,
    position smallint NOT NULL CHECK (position > 0),
    measure_id varchar(80) NOT NULL,
    process_label varchar(80) NOT NULL,
    point varchar(8) NOT NULL,
    measure_name text NOT NULL,
    target text NOT NULL,
    lane text NOT NULL CHECK (lane IN ('Common', 'A', 'B')),
    plus_value numeric(12,4) NOT NULL,
    minus_value numeric(12,4) NOT NULL,
    in_range boolean NOT NULL,
    UNIQUE (check_id, measure_id),
    UNIQUE (check_id, position)
);

-- Area temperatures (CDC, PLT, DGS, EOL, JIG, PRA, RTA, SHA); HTA stays in hta_readings.
-- Each area has its own set of probes, so the readings are stored as {"fieldKey": value}.
CREATE TABLE IF NOT EXISTS formation.temperature_readings (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    recorded_at timestamptz NOT NULL DEFAULT now(),
    area text NOT NULL CHECK (area IN (
        'temp_cdc', 'temp_plt', 'temp_dgs', 'temp_eol',
        'temp_jig', 'temp_pra', 'temp_rta', 'temp_sha'
    )),
    team text NOT NULL CHECK (team IN ('1A', '1B', '2A', '2B')),
    operator_name varchar(120) NOT NULL,
    line varchar(32),
    readings jsonb NOT NULL CHECK (jsonb_typeof(readings) = 'object' AND readings <> '{}'::jsonb),
    in_spec text NOT NULL CHECK (in_spec IN ('Yes', 'No')),
    source_key text UNIQUE
);

-- Which device submitted each record. Submitters do not log in, and only registered fixed IPs can reach the app,
-- so the IP identifies the device. The app sets formation.client_ip for its transaction; rows added any other way stay NULL.
DO $$
DECLARE
    target text;
BEGIN
    FOREACH target IN ARRAY ARRAY[
        'appearance_inspections', 'hta_readings', 'temperature_readings', 'eol_maintenance',
        'conductive_maintenance', 'startup_checks', 'resealing_checks', 'ip_checks'
    ] LOOP
        EXECUTE format(
            'ALTER TABLE formation.%I ADD COLUMN IF NOT EXISTS client_ip inet '
            'DEFAULT (nullif(current_setting(''formation.client_ip'', true), ''''))::inet',
            target
        );
    END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS appearance_process_time_idx ON formation.appearance_inspections (process, recorded_at DESC);
CREATE INDEX IF NOT EXISTS appearance_tray_idx ON formation.appearance_inspections (tray_id);
CREATE INDEX IF NOT EXISTS appearance_cell_idx ON formation.appearance_inspections (cell_id);
CREATE INDEX IF NOT EXISTS appearance_defects_idx ON formation.appearance_inspections USING gin (defect_types);
CREATE INDEX IF NOT EXISTS hta_time_idx ON formation.hta_readings (recorded_at DESC);
CREATE INDEX IF NOT EXISTS eol_maintenance_time_idx ON formation.eol_maintenance (recorded_at DESC);
CREATE INDEX IF NOT EXISTS conductive_time_idx ON formation.conductive_maintenance (recorded_at DESC);
CREATE INDEX IF NOT EXISTS startup_process_time_idx ON formation.startup_checks (process, recorded_at DESC);
CREATE INDEX IF NOT EXISTS ip_date_line_idx ON formation.ip_checks (check_date DESC, line);
CREATE INDEX IF NOT EXISTS resealing_time_idx ON formation.resealing_checks (recorded_at DESC);
CREATE INDEX IF NOT EXISTS temperature_area_time_idx ON formation.temperature_readings (area, recorded_at DESC);

-- The application role may read and add data. Schema changes and deletion remain admin operations.
GRANT CONNECT ON DATABASE formation_inspection TO formation_app;
GRANT USAGE ON SCHEMA formation TO formation_app;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA formation TO formation_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA formation TO formation_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA formation GRANT SELECT, INSERT ON TABLES TO formation_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA formation GRANT USAGE, SELECT ON SEQUENCES TO formation_app;
