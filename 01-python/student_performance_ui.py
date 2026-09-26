"""Desktop UI for the Student Performance Analytics project."""

import tkinter as tk
from tkinter import messagebox, ttk

import matplotlib
import numpy as np

from student_performance_analysis import (
    OUTPUT_DIR,
    create_visualizations,
    load_and_prepare_data,
    write_report,
)


matplotlib.use("TkAgg")
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
from matplotlib.figure import Figure


class StudentPerformanceApp(tk.Tk):
    """Interactive dashboard for viewing student performance."""

    def __init__(self) -> None:
        super().__init__()
        self.title("Student Performance Analytics")
        self.geometry("1200x780")
        self.minsize(950, 650)
        self.configure(bg="#F4F7FB")

        self.data = load_and_prepare_data()
        self._configure_style()
        self._build_header()
        self._build_summary_cards()
        self._build_content()
        self._refresh_dashboard()

    def _configure_style(self) -> None:
        style = ttk.Style(self)
        style.theme_use("clam")
        style.configure("TFrame", background="#F4F7FB")
        style.configure("Card.TFrame", background="white")
        style.configure("Title.TLabel", background="#183B56", foreground="white",
                        font=("Segoe UI", 22, "bold"))
        style.configure("Subtitle.TLabel", background="#183B56", foreground="#D9EAF7",
                        font=("Segoe UI", 10))
        style.configure("CardTitle.TLabel", background="white", foreground="#607D8B",
                        font=("Segoe UI", 10))
        style.configure("CardValue.TLabel", background="white", foreground="#183B56",
                        font=("Segoe UI", 20, "bold"))
        style.configure("Section.TLabel", background="#F4F7FB", foreground="#183B56",
                        font=("Segoe UI", 14, "bold"))
        style.configure("Treeview", rowheight=28, font=("Segoe UI", 10))
        style.configure("Treeview.Heading", font=("Segoe UI", 10, "bold"))

    def _build_header(self) -> None:
        header = tk.Frame(self, bg="#183B56", height=86)
        header.pack(fill="x")
        header.pack_propagate(False)
        ttk.Label(header, text="Student Performance Analytics",
                  style="Title.TLabel").pack(anchor="w", padx=24, pady=(14, 0))
        ttk.Label(header, text="Explore marks, attendance, grades, and rankings",
                  style="Subtitle.TLabel").pack(anchor="w", padx=26)

    def _build_summary_cards(self) -> None:
        cards = ttk.Frame(self)
        cards.pack(fill="x", padx=20, pady=18)
        self.card_values = {}
        card_definitions = [
            ("Students", "students"),
            ("Class Average", "average"),
            ("Pass Rate", "pass_rate"),
            ("Top Student", "top_student"),
        ]
        for title, key in card_definitions:
            card = ttk.Frame(cards, style="Card.TFrame", padding=14)
            card.pack(side="left", fill="both", expand=True, padx=6)
            ttk.Label(card, text=title, style="CardTitle.TLabel").pack(anchor="w")
            value = ttk.Label(card, text="-", style="CardValue.TLabel")
            value.pack(anchor="w", pady=(5, 0))
            self.card_values[key] = value

    def _build_content(self) -> None:
        content = ttk.Frame(self)
        content.pack(fill="both", expand=True, padx=20, pady=(0, 20))

        left = ttk.Frame(content)
        left.pack(side="left", fill="both", expand=True, padx=(0, 10))
        ttk.Label(left, text="Ranked Students", style="Section.TLabel").pack(anchor="w", pady=(0, 8))

        table_frame = ttk.Frame(left)
        table_frame.pack(fill="both", expand=True)
        columns = ("rank", "name", "attendance", "average", "grade", "status")
        self.table = ttk.Treeview(table_frame, columns=columns, show="headings")
        headings = {
            "rank": "Rank", "name": "Name", "attendance": "Attendance",
            "average": "Average", "grade": "Grade", "status": "Status",
        }
        widths = {"rank": 55, "name": 130, "attendance": 90, "average": 80,
                  "grade": 65, "status": 80}
        for column in columns:
            self.table.heading(column, text=headings[column])
            self.table.column(column, width=widths[column], anchor="center")
        scrollbar = ttk.Scrollbar(table_frame, orient="vertical", command=self.table.yview)
        self.table.configure(yscrollcommand=scrollbar.set)
        self.table.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        buttons = ttk.Frame(left)
        buttons.pack(fill="x", pady=(12, 0))
        ttk.Button(buttons, text="Refresh Data", command=self._refresh_dashboard).pack(side="left")
        ttk.Button(buttons, text="Export Report", command=self._export_report).pack(side="left", padx=8)

        right = ttk.Frame(content)
        right.pack(side="right", fill="both", expand=True, padx=(10, 0))
        ttk.Label(right, text="Performance Charts", style="Section.TLabel").pack(anchor="w", pady=(0, 8))
        self.figure = Figure(figsize=(6.3, 5.4), dpi=100, facecolor="white")
        self.canvas = FigureCanvasTkAgg(self.figure, master=right)
        self.canvas.get_tk_widget().pack(fill="both", expand=True)

    def _refresh_dashboard(self) -> None:
        self.data = load_and_prepare_data()
        data = self.data
        self.card_values["students"].configure(text=str(len(data)))
        self.card_values["average"].configure(text=f"{data['average'].mean():.2f}")
        self.card_values["pass_rate"].configure(text=f"{data['passed'].mean() * 100:.1f}%")
        self.card_values["top_student"].configure(text=str(data.iloc[0]["name"]))

        for item in self.table.get_children():
            self.table.delete(item)
        for _, row in data.iterrows():
            status = "Passed" if row["passed"] else "Failed"
            self.table.insert(
                "", "end",
                values=(row["rank"], row["name"], f"{row['attendance']:.1f}%",
                        f"{row['average']:.2f}", row["grade"], status),
            )
        self._draw_charts()

    def _draw_charts(self) -> None:
        data = self.data
        self.figure.clear()
        axes = self.figure.subplots(2, 2)
        self.figure.suptitle("Performance Overview", fontsize=13, fontweight="bold")

        means = data[["math", "science", "english"]].mean()
        axes[0, 0].bar(means.index.str.title(), means.values, color="#4C78A8")
        axes[0, 0].set_title("Subject Averages", fontsize=9)
        axes[0, 0].set_ylim(0, 100)
        axes[0, 0].tick_params(labelsize=8)

        grades = data["grade"].value_counts().reindex(["F", "C", "B", "A", "A+"], fill_value=0)
        axes[0, 1].bar(grades.index, grades.values, color="#F58518")
        axes[0, 1].set_title("Grade Distribution", fontsize=9)
        axes[0, 1].tick_params(labelsize=8)

        axes[1, 0].scatter(data["attendance"], data["average"], c=data["average"],
                           cmap="viridis", edgecolors="black", s=35)
        trend = np.polyfit(data["attendance"], data["average"], 1)
        x_values = np.linspace(data["attendance"].min(), data["attendance"].max(), 50)
        axes[1, 0].plot(x_values, np.poly1d(trend)(x_values), color="crimson")
        axes[1, 0].set_title("Attendance vs Average", fontsize=9)
        axes[1, 0].tick_params(labelsize=8)

        top = data.head(5).sort_values("average")
        axes[1, 1].barh(top["name"], top["average"], color="#54A24B")
        axes[1, 1].set_title("Top 5 Students", fontsize=9)
        axes[1, 1].set_xlim(0, 100)
        axes[1, 1].tick_params(labelsize=8)

        self.figure.tight_layout()
        self.canvas.draw()

    def _export_report(self) -> None:
        create_visualizations(self.data)
        write_report(self.data)
        messagebox.showinfo(
            "Export Complete",
            f"Report, ranked CSV, and dashboard saved to:\n{OUTPUT_DIR}",
        )


if __name__ == "__main__":
    StudentPerformanceApp().mainloop()
