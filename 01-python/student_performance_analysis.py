from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd


BASE_DIR = Path(__file__).resolve().parent
DATA_FILE = BASE_DIR / "students.csv"
OUTPUT_DIR = BASE_DIR / "output"


def load_and_prepare_data() -> pd.DataFrame:
    """Load student data and add calculated performance columns."""
    data = pd.read_csv(DATA_FILE)

    score_columns = ["math", "science", "english"]
    data["total"] = data[score_columns].sum(axis=1)
    data["average"] = data[score_columns].mean(axis=1).round(2)
    data["attendance"] = data["attendance"].round(1)

    bins = [0, 40, 60, 75, 90, 100]
    labels = ["F", "C", "B", "A", "A+"]
    data["grade"] = pd.cut(
        data["average"], bins=bins, labels=labels, include_lowest=True
    )
    data["passed"] = data["average"] >= 40
    data["rank"] = data["average"].rank(method="min", ascending=False).astype(int)
    return data.sort_values("rank")


def create_visualizations(data: pd.DataFrame) -> None:
    """Create and save charts for the student performance data."""
    OUTPUT_DIR.mkdir(exist_ok=True)

    subject_means = data[["math", "science", "english"]].mean()
    grade_counts = data["grade"].value_counts().reindex(
        ["F", "C", "B", "A", "A+"], fill_value=0
    )

    fig, axes = plt.subplots(2, 2, figsize=(13, 9))
    fig.suptitle("Student Performance Dashboard", fontsize=16, fontweight="bold")

    axes[0, 0].bar(subject_means.index.str.title(), subject_means.values, color="#4C78A8")
    axes[0, 0].set_title("Average Score by Subject")
    axes[0, 0].set_ylabel("Score")
    axes[0, 0].set_ylim(0, 100)
    axes[0, 0].grid(axis="y", alpha=0.3)

    axes[0, 1].bar(grade_counts.index, grade_counts.values, color="#F58518")
    axes[0, 1].set_title("Grade Distribution")
    axes[0, 1].set_xlabel("Grade")
    axes[0, 1].set_ylabel("Number of Students")
    axes[0, 1].grid(axis="y", alpha=0.3)

    axes[1, 0].scatter(
        data["attendance"],
        data["average"],
        c=data["average"],
        cmap="viridis",
        s=80,
        edgecolors="black",
        alpha=0.85,
    )
    trend = np.polyfit(data["attendance"], data["average"], 1)
    trend_line = np.poly1d(trend)
    x_values = np.linspace(data["attendance"].min(), data["attendance"].max(), 100)
    axes[1, 0].plot(x_values, trend_line(x_values), color="crimson", linewidth=2)
    axes[1, 0].set_title("Attendance vs Average Score")
    axes[1, 0].set_xlabel("Attendance (%)")
    axes[1, 0].set_ylabel("Average Score")
    axes[1, 0].grid(alpha=0.3)

    top_students = data.head(5).sort_values("average")
    axes[1, 1].barh(top_students["name"], top_students["average"], color="#54A24B")
    axes[1, 1].set_title("Top 5 Students")
    axes[1, 1].set_xlabel("Average Score")
    axes[1, 1].set_xlim(0, 100)
    axes[1, 1].grid(axis="x", alpha=0.3)

    plt.tight_layout()
    plt.savefig(OUTPUT_DIR / "student_performance_dashboard.png", dpi=150)
    plt.close(fig)


def write_report(data: pd.DataFrame) -> None:
    """Write a concise text summary and export the ranked data."""
    subject_columns = ["math", "science", "english"]
    subject_means = data[subject_columns].mean()
    correlation = data["attendance"].corr(data["average"])
    pass_rate = data["passed"].mean() * 100

    report = f"""STUDENT PERFORMANCE ANALYSIS
================================
Students analysed: {len(data)}
Pass rate: {pass_rate:.1f}%
Class average: {data["average"].mean():.2f}
Highest average: {data["average"].max():.2f}
Lowest average: {data["average"].min():.2f}
Attendance/score correlation: {correlation:.2f}

Subject averages:
  Math:    {subject_means["math"]:.2f}
  Science: {subject_means["science"]:.2f}
  English: {subject_means["english"]:.2f}

Top student: {data.iloc[0]["name"]} ({data.iloc[0]["average"]:.2f})
"""
    (OUTPUT_DIR / "analysis_report.txt").write_text(report, encoding="utf-8")
    data.to_csv(OUTPUT_DIR / "ranked_students.csv", index=False)


def main() -> None:
    data = load_and_prepare_data()
    create_visualizations(data)
    write_report(data)

    print("Student performance analysis completed.")
    print(f"Files saved in: {OUTPUT_DIR}")
    print(f"Class average: {data['average'].mean():.2f}")
    print(f"Pass rate: {data['passed'].mean() * 100:.1f}%")
    print("\nTop 3 students:")
    print(data[["rank", "name", "average", "grade"]].head(3).to_string(index=False))


if __name__ == "__main__":
    main()
