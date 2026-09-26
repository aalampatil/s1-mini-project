"""Flask web UI for the Student Performance Analytics project."""

from flask import Flask, jsonify, render_template, send_from_directory

from student_performance_analysis import (
    OUTPUT_DIR,
    create_visualizations,
    load_and_prepare_data,
    write_report,
)


app = Flask(__name__)


def get_dashboard_data() -> dict:
    """Prepare dashboard data in a JSON-friendly format."""
    data = load_and_prepare_data()
    return {
        "summary": {
            "students": len(data),
            "average": round(float(data["average"].mean()), 2),
            "pass_rate": round(float(data["passed"].mean() * 100), 1),
            "top_student": str(data.iloc[0]["name"]),
        },
        "students": [
            {
                "rank": int(row["rank"]),
                "name": str(row["name"]),
                "attendance": float(row["attendance"]),
                "average": float(row["average"]),
                "grade": str(row["grade"]),
                "status": "Passed" if row["passed"] else "Failed",
            }
            for _, row in data.iterrows()
        ],
    }


@app.route("/")
def dashboard():
    """Render the HTML dashboard."""
    data = load_and_prepare_data()
    create_visualizations(data)
    return render_template("index.html")


@app.route("/api/dashboard")
def dashboard_api():
    """Return dashboard data for the browser."""
    return jsonify(get_dashboard_data())


@app.route("/output/<path:filename>")
def output_file(filename: str):
    """Serve generated dashboard files."""
    return send_from_directory(OUTPUT_DIR, filename)


@app.post("/api/export")
def export_report():
    """Generate the report files from the latest data."""
    data = load_and_prepare_data()
    create_visualizations(data)
    write_report(data)
    return jsonify({"message": "Reports exported successfully."})


if __name__ == "__main__":
    app.run(debug=True)
