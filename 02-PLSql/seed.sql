INSERT INTO flights (flight_no, origin, destination, departure_time, arrival_time, base_fare)
VALUES ('AR101', 'Mumbai', 'Delhi', SYSTIMESTAMP + INTERVAL '72' HOUR,
        SYSTIMESTAMP + INTERVAL '74' HOUR, 5200);

INSERT INTO flights (flight_no, origin, destination, departure_time, arrival_time, base_fare)
VALUES ('AR202', 'Bengaluru', 'Kolkata', SYSTIMESTAMP + INTERVAL '30' HOUR,
        SYSTIMESTAMP + INTERVAL '33' HOUR, 6100);

INSERT INTO seats (flight_id, seat_no, seat_class)
SELECT f.flight_id, x.seat_no, 'BUSINESS'
FROM flights f
CROSS JOIN (
  SELECT 'J1' seat_no FROM dual
  UNION ALL SELECT 'J2' FROM dual
) x
WHERE f.flight_no IN ('AR101', 'AR202');

INSERT INTO seats (flight_id, seat_no)
SELECT f.flight_id, CHR(64 + r.row_no) || c.col_no
FROM flights f
CROSS JOIN (SELECT LEVEL row_no FROM dual CONNECT BY LEVEL <= 5) r
CROSS JOIN (SELECT LEVEL col_no FROM dual CONNECT BY LEVEL <= 4) c
WHERE f.flight_no IN ('AR101', 'AR202');

COMMIT;
