# Student Performance Analytics

A beginner-friendly Python mini project using **NumPy**, **pandas**, and
**matplotlib** to analyse student marks and attendance.

## Features

- Loads student records from `students.csv`
- Calculates total marks, average marks, grades, pass/fail status, and rank
- Finds subject averages and the attendance/score correlation
- Creates a four-chart dashboard
- Exports a ranked CSV file and a text report

## Setup

```bash
python -m pip install -r requirements.txt
```

## Run

```bash
python student_performance_analysis.py
```

## Launch the UI

```bash
python student_performance_ui.py
```

The desktop interface is built with Python's built-in **Tkinter** library. It
shows summary cards, a ranked student table, interactive charts, and an
**Export Report** button.

## Launch the HTML UI

Install Flask from `requirements.txt`, then run:

```bash
python web_app.py
```

Open **http://127.0.0.1:5000** in your browser. Press `Ctrl+C` in the
terminal to stop the web server.

The generated files are saved in the `output` folder:

- `student_performance_dashboard.png`
- `analysis_report.txt`
- `ranked_students.csv`

## Libraries used

- **NumPy**: trend-line calculation and numerical score analysis
- **pandas**: CSV loading, data transformation, grouping, ranking, and export
- **matplotlib**: dashboard charts
