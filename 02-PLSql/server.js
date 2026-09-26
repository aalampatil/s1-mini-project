const path = require("node:path");
const express = require("express");
const oracledb = require("oracledb");

const app = express();
const port = Number(process.env.PORT || 5000);
let pool;

async function getPool() {
  if (!pool) {
    pool = await oracledb.createPool({
      user: process.env.AIRLINE_DB_USER,
      password: process.env.AIRLINE_DB_PASSWORD,
      connectString: process.env.AIRLINE_DB_DSN,
      poolMin: 1,
      poolMax: 5,
      poolIncrement: 1
    });
  }
  return pool;
}

async function withConnection(work) {
  const connection = await (await getPool()).getConnection();
  try {
    return await work(connection);
  } finally {
    await connection.close();
  }
}

function errorMessage(error) {
  return error?.message?.split("\n")[0] || "Database operation failed.";
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/flights", async (_request, response) => {
  try {
    const flights = await withConnection(async (connection) => {
      const result = await connection.execute(
        `select flight_id, flight_no, origin, destination,
                to_char(departure_time, 'YYYY-MM-DD HH24:MI') departure_time,
                base_fare
           from flights
          where status in ('SCHEDULED', 'BOARDING')
            and departure_time > systimestamp
          order by departure_time`
      );
      return result.rows.map((row) => ({
        id: row[0],
        flight_no: row[1],
        route: `${row[2]} -> ${row[3]}`,
        departure: row[4],
        fare: Number(row[5])
      }));
    });
    response.json(flights);
  } catch (error) {
    response.status(503).json({ error: errorMessage(error) });
  }
});

app.get("/api/flights/:flightId/seats", async (request, response) => {
  try {
    const seats = await withConnection(async (connection) => {
      const result = await connection.execute(
        `select seat_no
           from seats
          where flight_id = :flight_id
            and status = 'AVAILABLE'
          order by seat_no`,
        { flight_id: Number(request.params.flightId) }
      );
      return result.rows.map((row) => row[0]);
    });
    response.json(seats);
  } catch (error) {
    response.status(503).json({ error: errorMessage(error) });
  }
});

app.post("/api/book", async (request, response) => {
  const { flight_id, full_name, email, phone, seat_no } = request.body || {};
  if (![flight_id, full_name, email, phone, seat_no].every(Boolean)) {
    return response.status(400).json({ error: "All booking fields are required." });
  }

  try {
    const booking = await withConnection(async (connection) => {
      const passenger = await connection.execute(
        `begin airline_reservation_pkg.create_passenger(
           :full_name, :email, :phone, :passenger_id
         ); end;`,
        {
          full_name,
          email,
          phone,
          passenger_id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
        }
      );
      const passengerId = passenger.outBinds.passenger_id;
      const result = await connection.execute(
        `begin airline_reservation_pkg.book_seat(
           :flight_id, :passenger_id, :seat_no, :booking_id, :booking_ref
         ); end;`,
        {
          flight_id: Number(flight_id),
          passenger_id: passengerId,
          seat_no,
          booking_id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
          booking_ref: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 20 }
        }
      );
      return {
        booking_id: result.outBinds.booking_id,
        booking_ref: result.outBinds.booking_ref
      };
    });
    return response.json(booking);
  } catch (error) {
    return response.status(409).json({ error: errorMessage(error) });
  }
});

app.post("/api/cancel", async (request, response) => {
  const { booking_ref } = request.body || {};
  if (!booking_ref) {
    return response.status(400).json({ error: "Booking reference is required." });
  }

  try {
    const refund = await withConnection(async (connection) => {
      const result = await connection.execute(
        `begin airline_reservation_pkg.cancel_booking(
           :booking_ref, :refund_amount
         ); end;`,
        {
          booking_ref,
          refund_amount: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
        }
      );
      return Number(result.outBinds.refund_amount);
    });
    return response.json({ refund });
  } catch (error) {
    return response.status(409).json({ error: errorMessage(error) });
  }
});

const server = app.listen(port, () => {
  console.log(`Airline Reservation UI: http://127.0.0.1:${port}`);
});

async function shutdown() {
  server.close();
  if (pool) await pool.close(10);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
