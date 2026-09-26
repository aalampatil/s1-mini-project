CREATE OR REPLACE PACKAGE airline_reservation_pkg AS
  e_flight_not_found   EXCEPTION;
  e_passenger_not_found EXCEPTION;
  e_seat_not_found     EXCEPTION;
  e_seat_unavailable   EXCEPTION;
  e_seat_locked        EXCEPTION;
  e_booking_not_found  EXCEPTION;
  e_already_cancelled  EXCEPTION;
  e_cancellation_closed EXCEPTION;

  PRAGMA EXCEPTION_INIT(e_seat_locked, -54);

  PROCEDURE create_passenger(
    p_full_name IN passengers.full_name%TYPE,
    p_email     IN passengers.email%TYPE,
    p_phone     IN passengers.phone%TYPE,
    p_passenger_id OUT passengers.passenger_id%TYPE
  );

  PROCEDURE book_seat(
    p_flight_id   IN flights.flight_id%TYPE,
    p_passenger_id IN passengers.passenger_id%TYPE,
    p_seat_no     IN seats.seat_no%TYPE,
    p_booking_id  OUT bookings.booking_id%TYPE,
    p_booking_ref OUT bookings.booking_ref%TYPE
  );

  PROCEDURE cancel_booking(
    p_booking_ref IN bookings.booking_ref%TYPE,
    p_refund_amount OUT bookings.refund_amount%TYPE
  );
END airline_reservation_pkg;
/

CREATE OR REPLACE PACKAGE BODY airline_reservation_pkg AS
  PROCEDURE create_passenger(
    p_full_name IN passengers.full_name%TYPE,
    p_email     IN passengers.email%TYPE,
    p_phone     IN passengers.phone%TYPE,
    p_passenger_id OUT passengers.passenger_id%TYPE
  ) IS
  BEGIN
    INSERT INTO passengers(full_name, email, phone)
    VALUES (TRIM(p_full_name), LOWER(TRIM(p_email)), TRIM(p_phone))
    RETURNING passenger_id INTO p_passenger_id;
    COMMIT;
  EXCEPTION
    WHEN DUP_VAL_ON_INDEX THEN
      SELECT passenger_id INTO p_passenger_id
      FROM passengers
      WHERE email = LOWER(TRIM(p_email));
      COMMIT;
  END create_passenger;

  PROCEDURE book_seat(
    p_flight_id   IN flights.flight_id%TYPE,
    p_passenger_id IN passengers.passenger_id%TYPE,
    p_seat_no     IN seats.seat_no%TYPE,
    p_booking_id  OUT bookings.booking_id%TYPE,
    p_booking_ref OUT bookings.booking_ref%TYPE
  ) IS
    l_departure flights.departure_time%TYPE;
    l_fare      flights.base_fare%TYPE;
    l_seat_id   seats.seat_id%TYPE;
    l_status    seats.status%TYPE;
    l_passenger_id passengers.passenger_id%TYPE;
  BEGIN
    BEGIN
      SELECT departure_time, base_fare
      INTO l_departure, l_fare
      FROM flights
      WHERE flight_id = p_flight_id
        AND status IN ('SCHEDULED', 'BOARDING');
    EXCEPTION WHEN NO_DATA_FOUND THEN
      RAISE e_flight_not_found;
    END;

    IF l_departure <= SYSTIMESTAMP THEN
      RAISE e_flight_not_found;
    END IF;

    BEGIN
      SELECT passenger_id INTO l_passenger_id
      FROM passengers
      WHERE passenger_id = p_passenger_id;
    EXCEPTION WHEN NO_DATA_FOUND THEN
      RAISE e_passenger_not_found;
    END;

    BEGIN
      SELECT seat_id, status
      INTO l_seat_id, l_status
      FROM seats
      WHERE flight_id = p_flight_id AND UPPER(seat_no) = UPPER(TRIM(p_seat_no))
      FOR UPDATE NOWAIT;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN RAISE e_seat_not_found;
      WHEN e_seat_locked THEN RAISE;
    END;

    IF l_status <> 'AVAILABLE' THEN
      RAISE e_seat_unavailable;
    END IF;

    UPDATE seats SET status = 'BOOKED' WHERE seat_id = l_seat_id;

    INSERT INTO bookings(booking_ref, flight_id, seat_id, passenger_id, fare_amount)
    VALUES (
      'AR' || TO_CHAR(SYSTIMESTAMP, 'YYMMDDHH24MISSFF3'),
      p_flight_id, l_seat_id, p_passenger_id, l_fare
    )
    RETURNING booking_id, booking_ref INTO p_booking_id, p_booking_ref;
    COMMIT;
  EXCEPTION
    WHEN e_seat_locked THEN
      ROLLBACK;
      RAISE_APPLICATION_ERROR(-20011, 'Seat is being updated by another session. Try again.');
    WHEN e_flight_not_found THEN
      ROLLBACK;
      RAISE_APPLICATION_ERROR(-20012, 'Flight is unavailable or has already departed.');
    WHEN e_passenger_not_found THEN
      ROLLBACK;
      RAISE_APPLICATION_ERROR(-20013, 'Passenger was not found.');
    WHEN e_seat_not_found THEN
      ROLLBACK;
      RAISE_APPLICATION_ERROR(-20014, 'Seat does not exist for this flight.');
    WHEN e_seat_unavailable THEN
      ROLLBACK;
      RAISE_APPLICATION_ERROR(-20015, 'Seat is already booked.');
  END book_seat;

  PROCEDURE cancel_booking(
    p_booking_ref IN bookings.booking_ref%TYPE,
    p_refund_amount OUT bookings.refund_amount%TYPE
  ) IS
    l_booking bookings%ROWTYPE;
    l_hours NUMBER;
    l_rate NUMBER;
  BEGIN
    BEGIN
      SELECT b.* INTO l_booking
      FROM bookings b
      WHERE b.booking_ref = UPPER(TRIM(p_booking_ref))
      FOR UPDATE;
    EXCEPTION WHEN NO_DATA_FOUND THEN RAISE e_booking_not_found;
    END;

    IF l_booking.status = 'CANCELLED' THEN
      RAISE e_already_cancelled;
    END IF;

    SELECT (CAST(f.departure_time AS DATE) - SYSDATE) * 24
    INTO l_hours
    FROM flights f
    WHERE f.flight_id = l_booking.flight_id;

    IF l_hours <= 0 THEN
      RAISE e_cancellation_closed;
    ELSIF l_hours >= 48 THEN
      l_rate := 1;
    ELSIF l_hours >= 24 THEN
      l_rate := 0.75;
    ELSE
      l_rate := 0;
    END IF;

    p_refund_amount := ROUND(l_booking.fare_amount * l_rate, 2);
    UPDATE bookings
    SET status = 'CANCELLED', refund_amount = p_refund_amount, cancelled_at = SYSTIMESTAMP
    WHERE booking_id = l_booking.booking_id;
    UPDATE seats SET status = 'AVAILABLE' WHERE seat_id = l_booking.seat_id;
    COMMIT;
  EXCEPTION
    WHEN e_booking_not_found THEN
      ROLLBACK;
      RAISE_APPLICATION_ERROR(-20021, 'Booking reference was not found.');
    WHEN e_already_cancelled THEN
      ROLLBACK;
      RAISE_APPLICATION_ERROR(-20022, 'Booking is already cancelled.');
    WHEN e_cancellation_closed THEN
      ROLLBACK;
      RAISE_APPLICATION_ERROR(-20023, 'Cancellation is closed after departure.');
  END cancel_booking;
END airline_reservation_pkg;
/
