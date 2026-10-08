-- Runs as formation_app. All sample rows are rolled back.
BEGIN;

WITH inspection AS (
  INSERT INTO formation.appearance_inspections
    (process, team, operator_name, tray_id, cell_id, channel, jig_line, hot_jig, defect_types, defect_map)
  VALUES ('formation', '1A', 'Schema Test', 'TESTTRAY1', 'TESTCELL1', 1, '4-1', 1,
          ARRAY['Unsealing pouch']::text[], '[{"x":50,"y":50}]'::jsonb)
  RETURNING id
)
INSERT INTO formation.appearance_photos (inspection_id, original_name, mime_type, image_data)
SELECT id, 'test.png', 'image/png', decode('89504e47', 'hex') FROM inspection;

INSERT INTO formation.hta_readings
  (team, operator_name, hta11, hta12, hta21, hta22, hta31, hta32, hta41, hta42, spec_result)
VALUES ('1A', 'Schema Test', 60, 60, 60, 60, 60, 60, 60, 60, 'Spec in');

INSERT INTO formation.eol_maintenance (team, operator_name, line, equipment, maintenance, taping_line)
VALUES ('1A', 'Schema Test', 'EOL 4-1', 'Tape', 'Cleaning', 'A');

INSERT INTO formation.conductive_maintenance
  (team, operator_name, rubber_process, line, measurement, units, action)
VALUES ('1A', 'Schema Test', 'Degas', '4-1', 'IR', ARRAY['1A']::text[], 'Flip');

INSERT INTO formation.temperature_readings (area, team, operator_name, line, readings, in_spec)
VALUES ('temp_eol', '1A', 'Schema Test', '4-1', '{"eol": 23.5}'::jsonb, 'Yes');

WITH startup AS (
  INSERT INTO formation.startup_checks
    (process, team, operator_name, line_values, check_completed, frequency)
  VALUES ('startup_degas', '1A', 'Schema Test', ARRAY['4-1']::text[], 'Yes', 'Shift')
  RETURNING id
)
INSERT INTO formation.startup_check_items (check_id, position, item, status)
SELECT id, 1, 'Clean Degas Chamber Nests', 'Pass' FROM startup;

INSERT INTO formation.resealing_checks
  (operator_name, shift, work_today, inspection_status, cleaning_status)
VALUES ('Schema Test', 'Day', 'Inspect tool', 'Pass', 'Completed');

WITH ip AS (
  INSERT INTO formation.ip_checks (check_date, line)
  VALUES (current_date, 'EOL #5-1') RETURNING id
)
INSERT INTO formation.ip_measurements
  (check_id, position, measure_id, process_label, point, measure_name, target,
   lane, plus_value, minus_value, in_range)
SELECT id, 1, 'third-wing-a-a', '3rd Wing Press', 'a',
       'Gap between upper block and lower block', '0.8 < X < 1.0',
       'A', 0.9, 0.9, true FROM ip;

WITH ir AS (
  INSERT INTO formation.ir_checks (team, operator_name, location, pkg_lot_id, tray1_id, tray2_id)
  VALUES ('1A', 'Schema Test', 'Shipping Aging', '7AMFJ015J2', 'LHEE039851', 'LHEE047613') RETURNING id
)
INSERT INTO formation.ir_values (check_id, tray, channel, ir_value, result)
SELECT id, 1, 1, NULL, 'OK' FROM ir
UNION ALL SELECT id, 1, 2, 95, 'NG' FROM ir
UNION ALL SELECT id, 2, 1, 120, 'OK' FROM ir;

SELECT 'appearance' AS category, count(*) AS test_rows FROM formation.appearance_inspections
UNION ALL SELECT 'hta', count(*) FROM formation.hta_readings
UNION ALL SELECT 'temperature', count(*) FROM formation.temperature_readings
UNION ALL SELECT 'maintenance', count(*) FROM formation.eol_maintenance
UNION ALL SELECT 'conductive', count(*) FROM formation.conductive_maintenance
UNION ALL SELECT 'startup', count(*) FROM formation.startup_checks
UNION ALL SELECT 'resealing', count(*) FROM formation.resealing_checks
UNION ALL SELECT 'ip', count(*) FROM formation.ip_checks
UNION ALL SELECT 'ir', count(*) FROM formation.ir_checks;

ROLLBACK;
