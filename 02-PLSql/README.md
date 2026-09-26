# Airline Reservation System

Mini Oracle PL/SQL project for managing flights, seats, passengers, and
bookings.

## Features

- Seat inventory per flight with a unique `(flight_id, seat_no)` constraint.
- Booking uses `SELECT ... FOR UPDATE NOWAIT`, so two sessions cannot reserve
  the same seat.
- Cancellation applies refund rules:
  - 48 or more hours before departure: 100%
  - 24 to less than 48 hours: 75%
  - Less than 24 hours: no refund
- PL/SQL exceptions for missing records, unavailable seats, locked seats, and
  invalid cancellation timing.
- Minimal JavaScript/Express UI for flight selection, booking, and cancellation.

## Database setup

Run these scripts in SQL\*Plus, SQLcl, or SQL Developer as the application
schema owner:

```sql
@schema.sql
@package.sql
@seed.sql
```

The scripts are rerunnable in a development schema. `schema.sql` removes only
the objects belonging to this sample project.

## JavaScript UI setup

Install Node.js 18+ and the dependencies:

```powershell
npm install
```

Set an Oracle connection string, then start the app:

```powershell
$env:AIRLINE_DB_USER="airline_app"
$env:AIRLINE_DB_PASSWORD="your-password"
$env:AIRLINE_DB_DSN="localhost:1521/XEPDB1"
npm start
```

Open <http://127.0.0.1:5000>.

The UI uses the stored package procedures rather than duplicating booking
logic in JavaScript. On connection or PL/SQL errors, the API returns a useful
message instead of reporting a false success.

Start-Service OracleServiceXE
Start-Service OracleOraDB21Home1TNSListener
Get-Service OracleServiceXE, OracleOraDB21Home1TNSListener
& "C:\app\Aalam\product\21c\dbhomeXE\bin\sqlplus.exe" / as sysdba
SHOW PDBS;
